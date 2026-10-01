const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const path = require('node:path');

function terminalCommand(launcher, executable, subject, receipt) {
  return [launcher, executable, subject, receipt].map(value => {
    assert(typeof value === 'string' && value && !/["%!\r\n&<>|^]/.test(value), 'Unsupported fixed cmd fixture path');
    return `"${value}"`;
  }).join(' ') + '\r';
}
function exitFact(observer) {
  const started = observer?.events.find(event => event.kind === 'observing');
  const exited = observer?.events.find(event => event.kind === 'exited');
  if (!observer?.bound || observer.error || observer.result?.code !== 0 || observer.result?.signal !== null
    || observer.events.some(event => event.kind === 'unknown') || !started || !exited
    || started.pid !== observer.subject.pid || started.nonce !== observer.nonce
    || exited.pid !== started.pid || exited.nonce !== started.nonce || exited.startTime !== started.startTime
    || exited.hasExited !== true || !Number.isInteger(exited.exitCode)) return undefined;
  return exited;
}
function startObserver(subject, executable, script) {
  assert.equal(process.platform, 'win32');
  const observer = { subject, nonce: randomBytes(16).toString('hex'), bound: false, events: [], stdout: '', stderr: '', pending: '' };
  const powershell = path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe');
  const child = spawn(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-File', script, '-SubjectPid', String(subject.pid), '-ExpectedExecutable', executable,
    '-ObservationNonce', observer.nonce], { stdio: ['ignore', 'pipe', 'pipe'], shell: false });
  child.on('error', error => { observer.error ??= String(error); });
  child.on('close', (code, signal) => { observer.result = { code, signal }; });
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', text => {
    if (observer.stdout.length + text.length > 8192) { observer.error ??= 'Observer output limit exceeded'; return; }
    observer.stdout += text; observer.pending += text;
    for (let index; (index = observer.pending.indexOf('\n')) !== -1;) {
      const line = observer.pending.slice(0, index).trim(); observer.pending = observer.pending.slice(index + 1);
      try { observer.events.push(JSON.parse(line)); } catch { observer.error ??= 'Invalid observer evidence'; }
    }
  });
  child.stderr.on('data', bytes => {
    if (observer.stderr.length + bytes.length > 8192) observer.error ??= 'Observer error output limit exceeded';
    else observer.stderr += bytes.toString('utf8');
  });
  return observer;
}
function bindObserver(observer, receipt) {
  const first = observer.events[0];
  assert.equal(observer.error, undefined); assert.equal(first?.kind, 'observing');
  assert.equal(first.pid, observer.subject.pid); assert.equal(first.nonce, observer.nonce);
  assert.equal(typeof first.startTime, 'string'); assert(first.startTime.length);
  assert.deepEqual(receipt, { pid: observer.subject.pid, ppid: observer.subject.ppid, nonce: observer.nonce });
  observer.bound = true;
}
function assertCompleted(observer, safety) {
  const exited = exitFact(observer);
  assert(exited, 'The identity-bound original Windows writer exit remains unconfirmed');
  assert.equal(safety, undefined, 'The Windows writer safety timer cannot satisfy product completion');
  assert.equal(exited.exitCode, 0, 'The actual Windows writer must complete normally');
  return exited;
}
module.exports = { terminalCommand, startObserver, bindObserver, exitFact, assertCompleted };
