const fs = require('node:fs/promises');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { execFile } = require('node:child_process');

async function identity(pid) {
  try {
    const stat = await fs.readFile(`/proc/${pid}/stat`, 'utf8');
    const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
    const executable = await fs.readlink(`/proc/${pid}/exe`).catch(error => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    return { pid, ppid: Number(fields[1]), state: fields[0], startTicks: fields[19], executable };
  } catch (error) { if (['ENOENT', 'ESRCH'].includes(error.code)) return undefined; throw error; }
}

class AgentProcessObserver {
  constructor(cli, smokeHostRoot, options) {
    this.cli = cli;
    this.smokeHostRoot = smokeHostRoot;
    this.started = performance.now();
    this.entries = new Map();
    this.roots = new Set();
    this.events = [];
    this.failures = [];
    this.samples = [];
    this.helperQueue = Promise.resolve();
    if (process.platform === 'darwin') {
      if (!options || !path.isAbsolute(options.python)) throw new Error('An explicit Darwin observer Python runtime is required.');
      this.python = options.python;
    }
  }
  async addRoot(pid, role) {
    let current;
    if (this.python) {
      const response = await this.darwinRequest({ operation: 'sample', targets: [{ pid }], descend: false });
      const record = response.records?.find(record => record.pid === pid);
      if (record?.status !== 'present') throw new Error(`Confirmed ${role} identity is unavailable: ${pid}`);
      const { argv, ...value } = record.identity;
      current = value;
    } else current = await identity(pid);
    if (!current) throw new Error(`Confirmed ${role} PID is already unavailable: ${pid}`);
    this.roots.add(pid);
    await this.adopt(current, role);
  }
  async adopt(current, forcedRole, observedArgv) {
    const key = `${current.pid}:${current.startTicks}`;
    if (this.entries.has(key)) return this.entries.get(key);
    let role = forcedRole ?? 'descendant';
    if (!forcedRole) {
      const argv = observedArgv ?? (await fs.readFile(`/proc/${current.pid}/cmdline`, 'utf8').catch(() => '')).split('\0');
      if (current.executable === this.cli.realpath && path.basename(this.cli.realpath) !== 'codex.js') role = 'cli';
      else if (path.basename(current.executable ?? '') === 'codex') role = 'cli';
      else if (argv.includes(this.cli.entry) || argv.includes(this.cli.realpath)) role = 'wrapper';
      else if (argv.some(value => value === path.join(this.smokeHostRoot,
        this.python ? 'dist/macos-execution-provider.js' : 'dist/linux-execution-provider.js'))) role = 'provider';
    }
    const ms = performance.now() - this.started;
    const entry = { ...current, role, firstPpid: current.ppid, firstSeenMs: ms, lastSeenMs: ms, lastLiveMs: ms, active: true };
    this.entries.set(key, entry);
    this.events.push({ ms, event: 'first-seen', ...current, role });
    return entry;
  }
  sample() {
    if (!this.sampling) this.sampling = this.sampleOnce().finally(() => { this.sampling = undefined; });
    return this.sampling;
  }
  async sampleOnce() {
    if (this.python) return this.sampleDarwinOnce();
    const queue = [...this.entries.values()].filter(entry => entry.active).map(entry => entry.pid);
    const visited = new Set();
    while (queue.length) {
      const pid = queue.shift();
      if (visited.has(pid)) continue;
      visited.add(pid);
      const current = await identity(pid);
      const previous = [...this.entries.values()].find(entry => entry.pid === pid && entry.active);
      if (!current || (previous && current.startTicks !== previous.startTicks)) {
        if (previous) {
          previous.active = false;
          previous.firstAbsentMs = performance.now() - this.started;
          this.events.push({ ms: previous.firstAbsentMs, event: 'absent', pid,
            startTicks: previous.startTicks, role: previous.role });
        }
        continue;
      }
      const entry = await this.adopt(current);
      if (entry.role === 'descendant' && current.executable !== entry.executable &&
          (current.executable === this.cli.realpath || path.basename(current.executable ?? '') === 'codex')) {
        entry.role = 'cli';
      }
      entry.lastSeenMs = performance.now() - this.started;
      if (!['Z', 'X'].includes(current.state)) entry.lastLiveMs = entry.lastSeenMs;
      if (entry.state !== current.state || entry.ppid !== current.ppid) {
        this.events.push({ ms: entry.lastSeenMs, event: 'state', ...current, role: entry.role });
      }
      Object.assign(entry, current);
      const children = await fs.readFile(`/proc/${pid}/task/${pid}/children`, 'utf8').catch(error => {
        if (['ENOENT', 'ESRCH'].includes(error.code)) return '';
        throw error;
      });
      for (const child of children.trim().split(/\s+/).filter(Boolean).map(Number)) queue.push(child);
    }
    for (const entry of this.entries.values()) {
      if (entry.role !== 'cli' || !entry.active || ['Z', 'X'].includes(entry.state)) continue;
      const wrapper = [...this.entries.values()].find(parent => parent.role === 'wrapper' && parent.pid === entry.firstPpid);
      if (wrapper && (!wrapper.active || ['Z', 'X'].includes(wrapper.state))) {
        this.failures.push({ kind: 'wrapper-ended-while-cli-live', wrapper: wrapper.pid, cli: entry.pid });
      }
    }
    if (this.events.length > 50000) throw new Error('The fixed process observation exceeded its event budget.');
  }
  darwinRequest(request) {
    const task = this.helperQueue.then(async () => {
      const observation = { operation: request.operation, startedMs: performance.now() - this.started };
      try {
        const value = await new Promise((resolve, reject) => {
          const child = execFile(this.python, [path.join(__dirname, 'agent-candidate-process-observer.py')], {
            timeout: 3000, maxBuffer: 2 * 1024 * 1024,
            env: { PATH: process.env.PATH ?? '', PYTHONDONTWRITEBYTECODE: '1' }
          }, (error, stdout) => {
            if (error) return reject(new Error('Darwin process identity helper failed or exceeded its deadline.'));
            try {
              const response = JSON.parse(stdout);
              if (response.version !== 1 || response.operation !== request.operation || response.error) throw new Error('invalid response');
              resolve(response);
            } catch { reject(new Error('Darwin process identity helper returned an invalid response.')); }
          });
          child.stdin.on('error', () => {});
          child.stdin.end(JSON.stringify({ version: 1, ...request }));
        });
        observation.complete = true;
        return value;
      } finally {
        observation.finishedMs = performance.now() - this.started;
        this.samples.push(observation);
      }
    });
    this.helperQueue = task.catch(() => {});
    return task;
  }
  unknownDarwin(pid, reason) {
    this.error ??= `Darwin process observation is unknown (${reason}).`;
    this.running = false;
    for (const entry of this.entries.values()) if (entry.pid === pid && entry.active) entry.observationUnknown = true;
    this.failures.push({ kind: 'process-observation-unknown', pid, reason });
  }
  async sampleDarwinOnce() {
    const targets = [...this.entries.values()].filter(entry => entry.active).map(({ pid, startTicks }) => ({ pid, startTicks }));
    if (!targets.length) return;
    try {
      const response = await this.darwinRequest({ operation: 'sample', targets });
      if (!Array.isArray(response.records)) throw new Error('invalid records');
      const observed = new Set();
      for (const record of response.records) {
        if (!Number.isSafeInteger(record.pid) || record.pid < 1) throw new Error('invalid process identity');
        observed.add(record.pid);
        const previous = [...this.entries.values()].find(entry => entry.pid === record.pid && entry.active);
        if (record.status === 'unknown') { this.unknownDarwin(record.pid, record.reason); continue; }
        if (record.status === 'absent') {
          if (previous) {
            previous.active = false;
            previous.firstAbsentMs = performance.now() - this.started;
            this.events.push({ ms: previous.firstAbsentMs, event: 'absent', pid: previous.pid,
              startTicks: previous.startTicks, role: previous.role });
          }
          continue;
        }
        const { argv, ...current } = record.identity ?? {};
        if (record.status !== 'present' || current.pid !== record.pid || !/^darwin:\d+:\d{6}$/.test(current.startTicks ?? '')
          || !Array.isArray(argv) || !argv.every(value => typeof value === 'string')) throw new Error('invalid process identity');
        if (previous && previous.startTicks !== current.startTicks) throw new Error('unconfirmed process replacement');
        const entry = await this.adopt(current, undefined, argv);
        if (entry.role === 'descendant' && current.executable !== entry.executable &&
            (current.executable === this.cli.realpath || path.basename(current.executable ?? '') === 'codex')) entry.role = 'cli';
        const firstParentStartTicks = entry.firstParentStartTicks;
        entry.lastSeenMs = performance.now() - this.started;
        if (!['Z', 'X'].includes(current.state)) entry.lastLiveMs = entry.lastSeenMs;
        if (entry.state !== current.state || entry.ppid !== current.ppid) {
          this.events.push({ ms: entry.lastSeenMs, event: 'state', ...current, role: entry.role });
        }
        Object.assign(entry, current);
        if (firstParentStartTicks) entry.firstParentStartTicks = firstParentStartTicks;
      }
      if (targets.some(target => !observed.has(target.pid))) throw new Error('missing original process observation');
      for (const entry of this.entries.values()) {
        if (entry.role !== 'cli' || !entry.active || ['Z', 'X'].includes(entry.state)) continue;
        const wrapper = [...this.entries.values()].find(parent => parent.role === 'wrapper' && parent.pid === entry.firstPpid
          && parent.startTicks === entry.firstParentStartTicks);
        if (wrapper && (!wrapper.active || ['Z', 'X'].includes(wrapper.state))) {
          this.failures.push({ kind: 'wrapper-ended-while-cli-live', wrapper: wrapper.pid, cli: entry.pid });
        }
      }
      if (this.events.length > 50000) throw new Error('fixed event budget exceeded');
    } catch {
      for (const target of targets) this.unknownDarwin(target.pid, 'helper-or-observation-failed');
    }
  }
  start() {
    this.running = true;
    this.loop = (async () => {
      while (this.running) {
        await this.sample();
        await new Promise(resolve => setTimeout(resolve, 25));
      }
    })().catch(error => { this.error = String(error); this.running = false; });
  }
  async stop() { this.running = false; await this.loop; await this.sample(); }
  result() {
    return { samplePeriodMs: this.python ? null : 25,
      ...(this.python ? { backend: 'darwin-psutil-7.0.0-libproc', requestedDelayMs: 25, samples: this.samples } : {}),
      entries: [...this.entries.values()], events: this.events,
      failures: this.failures, error: this.error,
      timingScope: 'Observed intervals only; overlapping disappearance intervals do not establish exact exit ordering.' };
  }
  async cleanupKnownExecution() {
    if (this.python) {
      const targets = [...this.entries.values()].filter(entry => entry.active && ['cli', 'wrapper', 'provider'].includes(entry.role))
        .map(({ pid, startTicks, executable }) => ({ pid, startTicks, executable }));
      if (!targets.length) return [];
      try {
        const response = await this.darwinRequest({ operation: 'cleanup', targets });
        if (!Array.isArray(response.results) || response.results.length !== targets.length) throw new Error('invalid cleanup result');
        for (const result of response.results) if (result.action.includes('unconfirmed')) this.unknownDarwin(result.pid, result.action);
        return response.results.filter(result => !['already-absent-no-signal', 'already-ended-no-signal'].includes(result.action));
      } catch {
        return targets.map(target => {
          this.unknownDarwin(target.pid, 'cleanup-helper-failed');
          return { pid: target.pid, startTicks: target.startTicks, action: 'signal-unconfirmed' };
        });
      }
    }
    const results = [];
    for (const entry of this.entries.values()) {
      if (!['cli', 'wrapper', 'provider'].includes(entry.role)) continue;
      const current = await identity(entry.pid);
      if (!current || current.startTicks !== entry.startTicks || ['Z', 'X'].includes(current.state)) continue;
      if (current.executable !== entry.executable) { results.push({ pid: entry.pid, action: 'identity-changed-no-signal' }); continue; }
      try {
        process.kill(entry.pid, 'SIGKILL');
        results.push({ pid: entry.pid, startTicks: entry.startTicks, action: 'SIGKILL-after-product-cleanup-failed' });
      } catch (error) { if (error.code !== 'ESRCH') throw error; }
    }
    return results;
  }
}

module.exports = { AgentProcessObserver };
