import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const executeFile = promisify(execFile);
const observer = fileURLToPath(new URL('./windows-process-identity.ps1', import.meta.url));

export async function readWindowsProcessIdentity(pid, deadline, { execute = executeFile, systemRoot = process.env.SystemRoot } = {}) {
  assert(Number.isSafeInteger(pid) && pid > 0);
  assert(Number.isFinite(deadline) && deadline > Date.now(), 'Original Windows identity deadline exhausted');
  assert(typeof systemRoot === 'string' && path.win32.isAbsolute(systemRoot), 'Fixed Windows system root is unavailable');
  const executable = path.win32.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  let output;
  try {
    output = await execute(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-File', observer, '-SubjectPid', String(pid)], {
      encoding: 'utf8', timeout: Math.max(1, Math.min(5000, deadline - Date.now())), maxBuffer: 8192, windowsHide: true
    });
  } catch (error) {
    error.observation = { pid, method: 'windows-process-safehandle', status: 'unknown', deadline };
    throw error;
  }
  assert(Date.now() <= deadline, 'Original Windows identity deadline exhausted');
  const result = JSON.parse(output.stdout.trim());
  assert.equal(result.schemaVersion, 1);
  assert.equal(result.pid, pid, 'Windows identity response belongs to another PID');
  assert(['present', 'absent'].includes(result.status), 'Windows original process observation is unknown');
  if (result.status === 'absent') {
    assert.equal(result.startTime, undefined, 'Absent Windows identity is inconsistent');
    return null;
  }
  assert(typeof result.startTime === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{7}Z$/u.test(result.startTime)
    && Number.isFinite(Date.parse(result.startTime)), 'Windows original creation time is unavailable');
  return { pid, startTime: result.startTime };
}
