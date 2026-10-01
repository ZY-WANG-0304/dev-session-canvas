import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL('../../', import.meta.url));
const source = fs.readFileSync(path.join(root, 'tests/vscode-smoke/agent-candidate-process-observer.cjs'), 'utf8');
const fixture = (pid, ppid, executable, argv = [], extra = {}) => ({ pid, status: 'present', identity: {
  pid, ppid, executable, argv, state: 'running', startTicks: `darwin:170000000${pid}:123456`, ...extra
} });

function harness(responder) {
  const calls = [];
  let inFlight = 0;
  let maximumInFlight = 0;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', 'process', '__dirname', source)(name => {
    if (name === 'node:path') return path.posix;
    if (name === 'node:child_process') return { execFile(python, args, options, callback) {
      inFlight++;
      maximumInFlight = Math.max(maximumInFlight, inFlight);
      const stdin = new EventEmitter();
      stdin.end = input => {
        const request = JSON.parse(input);
        calls.push({ python, args, options, request });
        setImmediate(() => {
          inFlight--;
          try { callback(null, JSON.stringify({ version: 1, operation: request.operation, ...responder(request) })); }
          catch { callback(new Error('controlled helper failure'), ''); }
        });
      };
      return { stdin };
    } };
    return require(name);
  }, module, module.exports, { platform: 'darwin', env: { PATH: '/bin', DEEPSEEK_API_KEY: 'not-forwarded' } }, '/staged/tests');
  const observer = new module.exports.AgentProcessObserver({ entry: '/cli/codex.js', realpath: '/cli/codex.js' }, '/smoke', { python: '/venv/bin/python' });
  return { observer, calls, get maximumInFlight() { return maximumInFlight; } };
}

let phase = 0;
const birth = pid => `darwin:170000000${pid}:123456`;
const normal = harness(request => {
  if (request.descend === false) return { records: [fixture(request.targets[0].pid, 0, '/host')] };
  if (request.operation === 'cleanup') return { results: request.targets.map(target => ({ ...target, action: 'identity-changed-no-signal' })) };
  if (phase === 1) return { records: [fixture(1, 0, '/host'), { pid: 2, status: 'absent' },
    fixture(3, 1, '/cli/codex', [], { firstParentStartTicks: birth(2) }), fixture(4, 1, '/node', ['/smoke/dist/macos-execution-provider.js'])] };
  return { records: [fixture(1, 0, '/host'), fixture(2, 1, '/node', ['/node', '/cli/codex.js'], { firstParentStartTicks: birth(1) }),
    fixture(3, 2, '/cli/codex', ['private-argv-marker'], { firstParentStartTicks: birth(2) }),
    fixture(4, 1, '/node', ['/smoke/dist/macos-execution-provider.js'], { firstParentStartTicks: birth(1) })] };
});
await normal.observer.addRoot(1, 'host');
const first = normal.observer.sample();
assert.strictEqual(normal.observer.sample(), first);
await first;
assert.deepEqual(normal.observer.result().entries.map(entry => entry.role), ['host', 'wrapper', 'cli', 'provider']);
assert(!JSON.stringify(normal.observer.result()).includes('private-argv-marker'));
assert(normal.observer.result().entries.every(entry => !Object.hasOwn(entry, 'argv')));
assert.equal(normal.observer.result().samplePeriodMs, null);
assert.equal(normal.observer.result().requestedDelayMs, 25);
assert(normal.observer.result().samples.every(sample => sample.finishedMs >= sample.startedMs));
assert.equal(normal.calls[0].options.timeout, 3000);
assert.equal(normal.calls[0].options.env.DEEPSEEK_API_KEY, undefined);
assert.equal(normal.calls[0].args[0], '/staged/tests/agent-candidate-process-observer.py');
await Promise.all([normal.observer.sample(), normal.observer.cleanupKnownExecution()]);
assert.equal(normal.maximumInFlight, 1);
const cleanup = normal.calls.find(call => call.request.operation === 'cleanup');
assert.deepEqual(cleanup.request.targets.map(target => target.pid), [2, 3, 4]);
assert(cleanup.request.targets.every(target => target.startTicks && target.executable));
phase = 1;
await normal.observer.sample();
assert(normal.observer.failures.some(failure => failure.kind === 'wrapper-ended-while-cli-live'));

let unknown = false;
const failed = harness(request => {
  if (request.descend === false) return { records: [fixture(1, 0, '/host')] };
  if (unknown) throw new Error('helper unavailable');
  return { records: [{ pid: 1, status: 'unknown', reason: 'AccessDenied' }] };
});
await failed.observer.addRoot(1, 'host');
await failed.observer.sample();
assert(failed.observer.error);
assert.equal(failed.observer.result().entries[0].active, true);
assert.equal(failed.observer.result().entries[0].observationUnknown, true);
unknown = true;
await failed.observer.sample();
assert.equal(failed.observer.result().entries[0].active, true);
assert(failed.observer.result().samples.some(sample => !sample.complete));

if (process.platform === 'linux') {
  const { AgentProcessObserver } = require(path.join(root, 'tests/vscode-smoke/agent-candidate-process-observer.cjs'));
  const observer = new AgentProcessObserver({ entry: '/unselected', realpath: '/unselected' }, '/unselected');
  await observer.addRoot(process.pid, 'host');
  await observer.sample();
  assert.equal(observer.result().samplePeriodMs, 25);
  assert.equal(observer.result().backend, undefined);
  assert(observer.result().entries.some(entry => entry.pid === process.pid && entry.role === 'host'));
}

console.log('Agent process observer: Darwin single-flight, lineage, argv redaction, unknown and cleanup controls passed; Linux path retained.');
