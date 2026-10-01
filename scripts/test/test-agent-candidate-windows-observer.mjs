import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { EventEmitter, once } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PassThrough, Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import observerModule from '../../tests/vscode-smoke/agent-candidate-windows-observer.cjs';
import genericObserver from '../../tests/vscode-smoke/agent-candidate-process-observer.cjs';

const { WindowsAgentProcessObserver, ended } = observerModule;
const helperSource = await fs.readFile(new URL('../../tests/vscode-smoke/agent-candidate-process-observer.ps1', import.meta.url), 'utf8');
assert.match(helperSource, /\$PSModuleAutoLoadingPreference = 'None'/u);
assert.match(helperSource, /\$env:PSModulePath = \[IO.Path\]::Combine\(\$PSHOME, 'Modules'\)/u);
assert.match(helperSource, /@\('Microsoft.PowerShell.Utility', 'Microsoft.PowerShell.Management', 'CimCmdlets'\)/u);
assert.match(helperSource, /Import-Module -Name \(\[IO.Path\]::Combine\(\$env:PSModulePath, \$module, \$module \+ '\.psd1'\)\) -ErrorAction Stop/u);
assert(helperSource.indexOf('Import-Module') < helperSource.indexOf('New-Object'));
const originalSystemRoot = process.env.SystemRoot;
process.env.SystemRoot ??= path.resolve('fixture-system-root');
const absolute = name => path.resolve('fixed-windows-fixture', name);
const cli = { provider: 'codex', entry: absolute('codex.cmd'), nativeExecutable: absolute('codex.exe'),
  nodeWrapper: absolute('codex.js'), nodeExecutable: absolute('node.exe') };
const record = (pid, role, parent = 0, wrapperKind) => ({ pid, ppid: parent, startTicks: `win32:${pid}00`,
  executable: absolute(`${role}-${pid}.exe`), role, ...(wrapperKind ? { wrapperKind } : {}),
  firstPpid: parent, firstParentStartTicks: parent ? `win32:${parent}00` : null,
  hasExited: false, exitConfirmed: false, exitCode: null, observationUnknown: false });
const host = record(1, 'host');
const chain = [host, record(2, 'provider', 1), record(3, 'wrapper', 2, 'cmd'),
  record(4, 'wrapper', 3, 'node'), record(5, 'cli', 4)];
const exited = value => ({ ...value, hasExited: true, exitConfirmed: true, exitCode: 0 });
function fixture() {
  let records = [host];
  let responseTransform = value => value;
  const requests = [];
  const child = new EventEmitter();
  child.stdout = new PassThrough(); child.stderr = new PassThrough();
  child.stdin = new Writable({ write(bytes, encoding, callback) {
    const request = JSON.parse(bytes.toString()); requests.push(request);
    let actions = [];
    if (request.operation === 'cleanup') {
      actions = request.targets.map(value => ({ pid: value.pid, startTicks: value.startTicks,
        action: 'terminated-original-handle' }));
      records = records.map(value => value.role === 'host' ? value : exited(value));
    }
    const response = responseTransform({ version: 1, id: request.id, records, actions });
    queueMicrotask(() => child.stdout.write(`${JSON.stringify(response)}\n`));
    callback();
  } });
  child.stdin.on('finish', () => queueMicrotask(() => child.emit('close', 0, null)));
  child.kill = () => child.emit('close', null, 'SIGTERM');
  const observer = new WindowsAgentProcessObserver(cli, absolute('host'), {
    backend: 'windows-safehandle-v1', powershell: absolute('powershell.exe'), spawn: () => child
  });
  return { observer, requests, set records(value) { records = value; },
    transform(value) { responseTransform = value; } };
}

try {
  const normal = fixture();
  await normal.observer.addRoot(1, 'host');
  await normal.observer.setLaunch({ args: '/d /s /c "private-launch-marker"' });
  normal.records = chain;
  await normal.observer.sample();
  assert.equal(normal.observer.result().entries.length, 5);
  assert(!JSON.stringify(normal.observer.result()).includes('private-launch-marker'));
  normal.records = chain.map(value => value.role === 'host' ? value : exited(value));
  await normal.observer.sample();
  const retained = normal.observer.result().entries.find(value => value.role === 'cli');
  assert(ended(retained));
  assert(genericObserver.executionEnded({ ...retained, active: true, state: 'object-retained' }));
  assert(!genericObserver.executionEnded({ ...retained, exitConfirmed: false, active: false, state: 'Z' }));
  assert(!genericObserver.executionEnded({ ...retained, observationUnknown: true }));
  assert.deepEqual(await normal.observer.cleanupKnownExecution(), []);
  await normal.observer.dispose();
  assert.equal(normal.observer.error, undefined);

  const missing = fixture();
  await missing.observer.addRoot(1, 'host');
  missing.records = [];
  await missing.observer.sample();
  assert(missing.observer.error);
  assert.equal(missing.observer.result().entries[0].observationUnknown, true);
  assert.deepEqual(await missing.observer.cleanupKnownExecution(), [{ action: 'unknown-identity-no-signal' }]);
  assert(!missing.requests.some(value => value.operation === 'cleanup'));
  await missing.observer.dispose();

  for (const invalid of [value => ({ ...value, executable: absolute('replaced.exe') }),
    value => ({ ...value, argv: ['private-argv-marker'] })]) {
    const changed = fixture();
    await changed.observer.addRoot(1, 'host');
    changed.records = [invalid(host)];
    await changed.observer.sample();
    assert(changed.observer.error);
    assert(!JSON.stringify(changed.observer.result()).includes('private-argv-marker'));
    await changed.observer.dispose();
  }

  const wrapper = fixture();
  await wrapper.observer.addRoot(1, 'host');
  wrapper.records = chain.map(value => value.wrapperKind === 'cmd' ? exited(value) : value);
  await wrapper.observer.sample();
  assert(wrapper.observer.failures.some(value => value.kind === 'wrapper-ended-while-cli-live'));
  const actions = await wrapper.observer.cleanupKnownExecution();
  assert.equal(actions.length, 3);
  assert(wrapper.requests.find(value => value.operation === 'cleanup').targets.every(value =>
    ['provider', 'wrapper', 'cli'].includes(value.role) && value.startTicks && value.executable));
  await wrapper.observer.dispose();

  const wrongCleanup = fixture();
  await wrongCleanup.observer.addRoot(1, 'host');
  wrongCleanup.records = chain;
  await wrongCleanup.observer.sample();
  wrongCleanup.transform(response => ({ ...response, actions: response.actions.map(value => ({ ...value, pid: 999 })) }));
  const unconfirmed = await wrongCleanup.observer.cleanupKnownExecution();
  assert.equal(unconfirmed.length, 4);
  assert(unconfirmed.every(value => value.action === 'original-handle-signal-unconfirmed'),
    'A failed cleanup response must not claim no signals were sent.');
  assert(wrongCleanup.observer.error);
  await wrongCleanup.observer.dispose();

  if (process.platform === 'win32') {
    const powershell = path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe');
    const helper = fileURLToPath(new URL('../../tests/vscode-smoke/agent-candidate-process-observer.ps1', import.meta.url));
    const checkPoll = `
$ErrorActionPreference = 'Stop'
$tokens = $null; $parseErrors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile('${helper.replaceAll("'", "''")}', [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count) { throw 'Helper syntax failed.' }
$function = $ast.Find({ param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Poll-Original' }, $true)
Invoke-Expression $function.Extent.Text
$subject = [pscustomobject]@{ HasExited = $true; ExitCode = 7 }
$subject | Add-Member ScriptMethod WaitForExit { param($timeout) return $false }
$entry = @{ process = $subject; record = @{ hasExited = $false; exitConfirmed = $false; exitCode = $null; observationUnknown = $false } }
Poll-Original $entry
if (!$entry.record.exitConfirmed -or $entry.record.exitCode -ne 7 -or $entry.record.observationUnknown) { throw 'Monotonic exit race rejected.' }
$subject = [pscustomobject]@{ HasExited = $false; ExitCode = 0 }
$subject | Add-Member ScriptMethod WaitForExit { param($timeout) return $true }
$entry = @{ process = $subject; record = @{ hasExited = $false; exitConfirmed = $false; exitCode = $null; observationUnknown = $false } }
$rejected = $false
try { Poll-Original $entry } catch { $rejected = $true }
if (!$rejected -or !$entry.record.observationUnknown -or $entry.record.exitConfirmed) { throw 'Inconsistent exit facts accepted.' }
`;
    const pollResult = spawnSync(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand',
      Buffer.from(checkPoll, 'utf16le').toString('base64')], { encoding: 'utf8', timeout: 10000 });
    assert.equal(pollResult.status, 0, `Windows helper syntax/monotonic exit check failed: ${pollResult.stderr}`);
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-original-handle-'));
    const asset = path.join(directory, 'fixed.js');
    await fs.writeFile(asset, '// Fixed observer asset; no Agent or network request.\n');
    await fs.mkdir(path.join(directory, 'dist'));
    await fs.writeFile(path.join(directory, 'dist/windows-execution-provider.js'), '// Fixed provider identity.\n');
    const subject = spawn(process.execPath, ['-e', 'process.stdin.once("data", () => { process.exitCode = 7; process.stdin.pause(); }); process.stdout.write("ready\\n");'],
      { stdio: ['pipe', 'pipe', 'ignore'] });
    let native;
    const closed = once(subject, 'close');
    const deadline = setTimeout(() => subject.kill(), 15000);
    try {
      await Promise.race([once(subject.stdout, 'data'), closed.then(() => { throw new Error('Controlled Node did not become ready.'); })]);
      native = new WindowsAgentProcessObserver({ ...cli, entry: asset, nativeExecutable: process.execPath,
        nodeExecutable: process.execPath, nodeWrapper: asset }, directory, { backend: 'windows-safehandle-v1',
        powershell });
      // The helper requires the staged provider asset even when this native check only observes a controlled root.
      await native.initialized;
      await native.addRoot(subject.pid, 'host');
      subject.stdin.end('finish\n');
      await closed;
      await native.sample();
      assert.equal(native.error, undefined);
      assert(ended(native.result().entries[0]), 'A retained exited original process must be confirmed without disappearance.');
      assert.equal(native.result().entries[0].exitCode, 7);
      await native.dispose();
      assert.equal(native.error, undefined);
    } finally {
      clearTimeout(deadline);
      if (subject.exitCode === null && subject.signalCode === null) subject.kill();
      await closed;
      if (native && !native.disposing) await native.dispose();
      await fs.rm(directory, { recursive: true, force: true });
    }
  }
  console.log(`Windows Agent observer: fixed identity, retained exits, unknown, wrapper and cleanup checks passed; native helper ${process.platform === 'win32' ? 'verified on Windows' : 'not run on this platform'}.`);
} finally {
  if (originalSystemRoot === undefined) delete process.env.SystemRoot;
  else process.env.SystemRoot = originalSystemRoot;
}
