const fs = require('node:fs/promises');
const path = require('node:path');
const { performance } = require('node:perf_hooks');

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
  constructor(cli, smokeHostRoot) {
    this.cli = cli;
    this.smokeHostRoot = smokeHostRoot;
    this.started = performance.now();
    this.entries = new Map();
    this.roots = new Set();
    this.events = [];
    this.failures = [];
  }
  async addRoot(pid, role) {
    const current = await identity(pid);
    if (!current) throw new Error(`Confirmed ${role} PID is already unavailable: ${pid}`);
    this.roots.add(pid);
    await this.adopt(current, role);
  }
  async adopt(current, forcedRole) {
    const key = `${current.pid}:${current.startTicks}`;
    if (this.entries.has(key)) return this.entries.get(key);
    let role = forcedRole ?? 'descendant';
    if (!forcedRole) {
      const argv = (await fs.readFile(`/proc/${current.pid}/cmdline`, 'utf8').catch(() => '')).split('\0');
      if (current.executable === this.cli.realpath && path.basename(this.cli.realpath) !== 'codex.js') role = 'cli';
      else if (path.basename(current.executable ?? '') === 'codex') role = 'cli';
      else if (argv.includes(this.cli.entry) || argv.includes(this.cli.realpath)) role = 'wrapper';
      else if (argv.some(value => value === path.join(this.smokeHostRoot, 'dist/linux-execution-provider.js'))) role = 'provider';
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
    return { samplePeriodMs: 25, entries: [...this.entries.values()], events: this.events,
      failures: this.failures, error: this.error,
      timingScope: 'Observed intervals only; overlapping disappearance intervals do not establish exact exit ordering.' };
  }
  async cleanupKnownExecution() {
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
