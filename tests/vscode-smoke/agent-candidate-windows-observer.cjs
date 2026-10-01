const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');
const { performance } = require('node:perf_hooks');

const ownedRole = role => ['cli', 'wrapper', 'provider'].includes(role);
const ended = entry => entry.observationUnknown !== true && entry.exitConfirmed === true &&
  entry.hasExited === true && Number.isInteger(entry.exitCode);
const recordFields = new Set(['pid', 'ppid', 'startTicks', 'executable', 'role', 'wrapperKind', 'firstPpid',
  'firstParentStartTicks', 'hasExited', 'exitConfirmed', 'exitCode', 'observationUnknown']);

class WindowsAgentProcessObserver {
  constructor(cli, smokeHostRoot, options) {
    assert.equal(options?.backend, 'windows-safehandle-v1');
    assert(path.isAbsolute(options.powershell));
    assert(path.isAbsolute(cli.nativeExecutable));
    this.started = performance.now(); this.entries = new Map(); this.events = []; this.failures = [];
    this.samples = []; this.queue = Promise.resolve(); this.nextId = 0; this.pending = ''; this.stderr = '';
    this.child = (options.spawn ?? spawn)(options.powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-File', path.join(__dirname, 'agent-candidate-process-observer.ps1')], { shell: false,
      stdio: ['pipe', 'pipe', 'pipe'], env: { SystemRoot: process.env.SystemRoot, WINDIR: process.env.WINDIR,
        TEMP: process.env.TEMP, TMP: process.env.TMP } });
    this.child.on('error', () => this.unknown('helper-start-failed'));
    this.child.on('close', (code, signal) => {
      this.closed = { code, signal };
      if (!this.disposing || code !== 0 || signal !== null) this.unknown('helper-ended-before-release');
    });
    this.child.stdin.on('error', () => this.unknown('helper-input-failed'));
    this.child.stderr.on('data', bytes => {
      if (this.stderr.length + bytes.length > 8192) this.unknown('helper-stderr-budget');
      else this.stderr += bytes.toString('utf8');
    });
    this.child.stdout.setEncoding('utf8');
    this.child.stdout.on('data', text => {
      this.pending += text;
      if (this.pending.length > 2 * 1024 * 1024) return this.unknown('helper-response-budget');
      for (let index; (index = this.pending.indexOf('\n')) !== -1;) {
        const line = this.pending.slice(0, index); this.pending = this.pending.slice(index + 1);
        try {
          const value = JSON.parse(line);
          if (!this.waiting || value.id !== this.waiting.id || value.version !== 1) throw new Error('invalid response');
          this.waiting.resolve(value);
        } catch { this.unknown('helper-invalid-response'); }
      }
    });
    this.initialized = this.request({ operation: 'initialize', cli,
      providerPath: path.join(smokeHostRoot, 'dist/windows-execution-provider.js'),
      rootExecutable: process.execPath,
      commandShell: path.join(process.env.SystemRoot, 'System32/cmd.exe') });
    void this.initialized.catch(() => {});
  }
  unknown(reason) {
    this.error ??= `Windows process observation is unknown (${reason}).`;
    this.running = false;
    for (const entry of this.entries.values()) if (!ended(entry)) entry.observationUnknown = true;
    if (!this.failures.some(value => value.kind === reason)) this.failures.push({ kind: reason });
    this.waiting?.reject(new Error(this.error));
  }
  request(request) {
    const task = this.queue.then(async () => {
      if (this.error || this.closed) throw new Error(this.error ?? 'Windows observer is closed.');
      const id = ++this.nextId;
      const sample = { operation: request.operation, startedMs: performance.now() - this.started };
      this.samples.push(sample);
      let timer;
      try {
        const response = await new Promise((resolve, reject) => {
          this.waiting = { id, resolve, reject };
          timer = setTimeout(() => this.unknown('helper-request-deadline'), 10000);
          this.child.stdin.write(`${JSON.stringify({ version: 1, id, ...request })}\n`);
        });
        if (response.error) throw new Error('Windows process identity helper rejected the fixed request.');
        sample.complete = true;
        return response;
      } catch (error) { this.unknown('helper-request-failed'); throw error; }
      finally { clearTimeout(timer); this.waiting = undefined; sample.finishedMs = performance.now() - this.started; }
    });
    this.queue = task.catch(() => {});
    return task;
  }
  apply(response) {
    assert(Array.isArray(response.records));
    const seen = new Set();
    for (const record of response.records) {
      assert(Object.keys(record).every(key => recordFields.has(key)), 'Unexpected Windows process evidence field.');
      assert(Number.isSafeInteger(record.pid) && record.pid > 0 && /^win32:\d+$/.test(record.startTicks));
      assert(['host', 'supervisor', 'provider', 'wrapper', 'cli'].includes(record.role));
      assert(typeof record.executable === 'string' && path.isAbsolute(record.executable));
      assert(Number.isSafeInteger(record.firstPpid) && record.firstPpid >= 0);
      assert(typeof record.observationUnknown === 'boolean' && typeof record.hasExited === 'boolean' &&
        typeof record.exitConfirmed === 'boolean');
      assert(record.exitConfirmed === record.hasExited &&
        (record.hasExited ? Number.isInteger(record.exitCode) : record.exitCode === null));
      if (ownedRole(record.role)) assert(/^win32:\d+$/.test(record.firstParentStartTicks));
      if (record.role === 'wrapper') assert(['cmd', 'node'].includes(record.wrapperKind));
      const key = `${record.pid}:${record.startTicks}`;
      assert(!seen.has(key)); seen.add(key);
      const prior = this.entries.get(key);
      if (prior) for (const field of ['executable', 'role', 'ppid', 'firstPpid', 'firstParentStartTicks', 'wrapperKind']) {
        assert.equal(record[field], prior[field], 'Original Windows process identity changed.');
      }
      if (prior?.exitConfirmed && !ended(record)) throw new Error('Original Windows exit fact changed.');
      if (record.observationUnknown) this.unknown('original-process-unknown');
      const ms = performance.now() - this.started;
      if (!prior || prior.exitConfirmed !== record.exitConfirmed) this.events.push({ ms, event: prior ? 'exited' : 'first-seen', ...record });
      this.entries.set(key, { ...prior, ...record, platform: 'win32', active: !ended(record),
        firstSeenMs: prior?.firstSeenMs ?? ms, lastSeenMs: ms });
    }
    if ([...this.entries.keys()].some(key => !seen.has(key))) this.unknown('missing-original-process');
    for (const cli of this.entries.values()) {
      if (!(cli.role === 'cli' || (cli.role === 'wrapper' && cli.wrapperKind === 'node')) || ended(cli)) continue;
      const wrapper = [...this.entries.values()].find(entry => entry.role === 'wrapper' &&
        entry.pid === cli.firstPpid && entry.startTicks === cli.firstParentStartTicks);
      if (wrapper && ended(wrapper) && !this.failures.some(item => item.kind === 'wrapper-ended-while-cli-live')) {
        this.failures.push({ kind: 'wrapper-ended-while-cli-live', wrapper: wrapper.pid, cli: cli.pid });
      }
    }
    if (this.events.length > 50000) this.unknown('fixed-event-budget');
  }
  async addRoot(pid, role) {
    await this.initialized;
    this.apply(await this.request({ operation: 'root', pid, role }));
  }
  async setLaunch(spec) {
    await this.initialized;
    assert.equal(typeof spec.args, 'string');
    this.apply(await this.request({ operation: 'launch', commandArguments: spec.args }));
  }
  sample() {
    if (!this.sampling) this.sampling = this.request({ operation: 'sample' }).then(value => this.apply(value))
      .catch(() => this.unknown('sample-failed')).finally(() => { this.sampling = undefined; });
    return this.sampling;
  }
  start() {
    this.running = true;
    this.loop = (async () => {
      while (this.running) { await this.sample(); await new Promise(resolve => setTimeout(resolve, 25)); }
    })();
  }
  async stop() { this.running = false; await this.loop; if (!this.error) await this.sample(); }
  async cleanupKnownExecution() {
    if (this.error) return [{ action: 'unknown-identity-no-signal' }];
    const targets = [...this.entries.values()].filter(entry => ownedRole(entry.role) && !ended(entry))
      .map(({ pid, startTicks, executable, role }) => ({ pid, startTicks, executable, role }));
    if (!targets.length) return [];
    try {
      const response = await this.request({ operation: 'cleanup', targets });
      this.apply(response);
      assert(Array.isArray(response.actions) && response.actions.length === targets.length);
      for (const [index, action] of response.actions.entries()) {
        assert.equal(action.pid, targets[index].pid);
        assert.equal(action.startTicks, targets[index].startTicks);
        assert(['already-exited', 'terminated-original-handle'].includes(action.action));
      }
      return response.actions;
    } catch {
      this.unknown('cleanup-observation-unknown');
      return targets.map(({ pid, startTicks }) => ({ pid, startTicks, action: 'original-handle-signal-unconfirmed' }));
    }
  }
  async dispose() {
    await this.stop();
    this.disposing = true;
    this.child.stdin.end();
    if (!this.closed) await new Promise(resolve => {
      const timer = setTimeout(() => { this.unknown('helper-release-deadline'); this.child.kill(); resolve(); }, 3000);
      this.child.once('close', () => { clearTimeout(timer); resolve(); });
    });
  }
  result() {
    return { backend: 'windows-safehandle-v1', samplePeriodMs: null, requestedDelayMs: 25,
      entries: [...this.entries.values()], events: this.events, failures: this.failures, error: this.error,
      samples: this.samples, timingScope: 'Retained original process objects; object disappearance is not required.' };
  }
}
module.exports = { WindowsAgentProcessObserver, ended };
