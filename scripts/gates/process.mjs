import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
export function processGroupExists(pid) {
  if (!pid || process.platform === 'win32') return false;
  try { process.kill(-pid, 0); return true; }
  catch (error) { if (error.code === 'ESRCH') return false; throw error; }
}
export async function retireProcessGroup(pid, { graceMs = 5000, killMs = 5000 } = {}) {
  if (process.platform === 'win32') {
    if (!pid) return { status: 'passed', boundary: 'not-spawned' };
    const result = await new Promise(resolve => {
      const child = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: ['ignore','pipe','pipe'] });
      let error, output = '';const timer=setTimeout(()=>{error='taskkill exceeded cleanup budget';child.kill();},graceMs+killMs);
      child.stdout.on('data', data => { output += data; }); child.stderr.on('data', data => { output += data; });
      child.on('error', failure => { error = failure.message; });
      child.on('close', code => {clearTimeout(timer);resolve({ code, error: error ?? null, output });});
    });
    // An absent process is already retired. Other taskkill failures stay unknown.
    return { status: result.code === 0 || /not found|not running|不存在|没有运行/i.test(result.output) ? 'passed' : 'failed',
      boundary: 'windows-taskkill-tree', ...result };
  }
  if (!processGroupExists(pid)) return { status: 'passed', boundary: 'original-process-group', observed: 'absent' };
  try{process.kill(-pid, 'SIGTERM');}catch(error){if(error.code!=='ESRCH')throw error;}
  const grace = Date.now() + graceMs;
  while (processGroupExists(pid) && Date.now() < grace) await sleep(25);
  if (processGroupExists(pid)) {
    try { process.kill(-pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
  }
  const kill = Date.now() + killMs;
  while (processGroupExists(pid) && Date.now() < kill) await sleep(25);
  return { status: processGroupExists(pid) ? 'failed' : 'passed', boundary: 'original-process-group',
    observed: processGroupExists(pid) ? 'still-present' : 'absent' };
}

// Process completion, deadline and resource retirement are separate facts.
export async function runProcess(file, args, { cwd = process.cwd(), env = process.env,
  deadline, logPath, signal, onLine, quiet = false, terminationGraceMs = 5000, drainMs=5000 } = {}) {
  assert(Number.isFinite(deadline) && deadline > Date.now(), 'A future absolute process deadline is required');
  assert(deadline-Date.now()<=0x7fffffff,'Process budget exceeds the supported timer ceiling');
  let log;
  if (logPath) { fs.mkdirSync(path.dirname(logPath), { recursive: true }); log = fs.createWriteStream(logPath, { flags: 'wx' }); }
  const child = spawn(file, args, { cwd, env, shell: false, detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let timedOut = false, cancelled = false, firstError, termination, closed = false,residualGroup=false,drainTimedOut=false;
  let exitAt = null, observedResidualGroup = false;
  const terminate = () => {
    // Record the original residual before retirement changes the observation.
    // A deadline/abort racing this call must not erase a child that outlived
    // its successful parent.
    if (exitAt !== null && processGroupExists(child.pid)) residualGroup = true;
    termination ??= retireProcessGroup(child.pid, { graceMs: terminationGraceMs });
  };
  const pending = { stdout: '', stderr: '' };
  const output = (chunk, name, stream) => {
    log?.write(chunk); if (!quiet) stream.write(chunk);
    if (onLine) {
      pending[name] += chunk.toString();
      while (pending[name].includes('\n')) {
        const end = pending[name].indexOf('\n'); const line = pending[name].slice(0, end); pending[name] = pending[name].slice(end + 1);
        onLine(line, name);
      }
      if (pending[name].length > 65536) pending[name] = pending[name].slice(-65536);
    }
  };
  child.stdout.on('data', chunk => output(chunk, 'stdout', process.stdout));
  child.stderr.on('data', chunk => output(chunk, 'stderr', process.stderr));
  const timer = setTimeout(() => { timedOut = true; terminate(); }, Math.max(1, deadline - Date.now()));
  const abort = () => { cancelled = true; terminate(); };
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  let code = null, exitSignal = null;
  await new Promise(resolve => {
    let drainTimer;
    const beginDrain=()=>{drainTimer??=setTimeout(()=>{
      drainTimedOut=true;child.stdout.destroy();child.stderr.destroy();resolve();
    },terminationGraceMs+drainMs+5000);};
    child.once('error', error => { firstError ??= error;beginDrain(); });
    child.once('exit',(status,receivedSignal)=>{
      code=status;exitSignal=receivedSignal;exitAt=Date.now();observedResidualGroup=processGroupExists(child.pid);
      // EOF-driven library services can close just after their parent. Observe
      // natural retirement within the same bounded drain before calling it a
      // leak; killing a persistent child must still fail the action.
      beginDrain();
    });
    child.once('close', (status, receivedSignal) => { code = status; exitSignal = receivedSignal; closed = true;
      clearTimeout(drainTimer);resolve(); });
  });
  const naturalDrainDeadline = Math.min(deadline, (exitAt ?? Date.now()) + drainMs);
  while (!termination && processGroupExists(child.pid) && Date.now() < naturalDrainDeadline) await sleep(25);
  const remainingGroup = processGroupExists(child.pid);
  residualGroup ||= remainingGroup;
  if (remainingGroup) terminate();
  clearTimeout(timer); signal?.removeEventListener('abort', abort);
  const cleanup = termination ? await termination : { status: 'passed', boundary: process.platform === 'win32'
    ? 'child-close; owning task observes additional resources' : 'original-process-group', observed: 'absent' };
  if (onLine) for (const [name, text] of Object.entries(pending)) if (text) onLine(text, name);
  if (log) await new Promise((resolve, reject) => { log.once('error', reject); log.end(resolve); });
  return { code, signal: exitSignal, timedOut, cancelled, pid: child.pid ?? null,
    error: firstError?.message ?? null, exited: closed && (code !== null || exitSignal !== null),
    residualGroup,observedResidualGroup,drainTimedOut, cleanup,
    status: cancelled ? 'cancelled' : timedOut || firstError || code !== 0 || exitSignal
      || residualGroup || drainTimedOut || cleanup.status !== 'passed' ? 'failed' : 'passed' };
}
export const nodeCommand = args => ({ file: process.execPath, args });
export function npmCommand(args) {
  const npmEntry = process.env.npm_execpath;
  if (npmEntry && /npm(?:-cli)?\.js$/.test(npmEntry)) return nodeCommand([npmEntry, ...args]);
  if (process.platform === 'win32') {
    const entry = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
    assert(fs.existsSync(entry), 'The fixed Node distribution must include npm');
    return nodeCommand([entry, ...args]);
  }
  return { file: 'npm', args };
}
