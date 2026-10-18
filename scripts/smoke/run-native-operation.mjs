import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { performance } from 'node:perf_hooks';
import { fileDigest, writeJSON } from '../gates/receipts.mjs';
import { processIdentity, waitForHostAbsence } from './host-evidence.mjs';
import { withinDeadline } from '../gates/deadline.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(import.meta.url);
export async function retireNativeResources(owner, original, deadline) {
  if (!owner) return { kind: 'settled', pending: [], boundary: 'provider-not-constructed' };
  assert(!original?.unsettled, 'Original native action has not settled; concurrent cleanup refused');
  // Only this finite driver owns the readers. Cancellation follows the
  // original failed action's settlement, then owner.close retires resources.
  if (original) for (const record of owner.list()) record.settleReaders('cancelled');
  const cleanup = await withinDeadline('Native private resources', deadline,
    () => owner.close({ reason: 'native gate fixture cleanup', permanent: true }));
  assert.equal(cleanup.kind, 'settled', 'Native gate cleanup must settle');
  assert.equal(owner.list().length, 0, 'No original native reservation may remain');
  return cleanup;
}
export async function runNativeOperation({ assets, output }) {
  const target = process.platform === 'linux' ? `linux-${process.arch}-glibc` : `${process.platform}-${process.arch}`;
  const directory = path.resolve(output); await fs.mkdir(directory, { recursive: true });
  const startedAt = new Date().toISOString();
  const inherited = Number(process.env.DEV_SESSION_CANVAS_GATE_DEADLINE);
  const workDeadline = Number.isFinite(inherited) && inherited > 0 ? inherited : Date.now() + 150000;
  const inheritedCleanup = Number(process.env.DEV_SESSION_CANVAS_GATE_CLEANUP_DEADLINE);
  const cleanupDeadline = Number.isFinite(inheritedCleanup) && inheritedCleanup >= workDeadline
    ? inheritedCleanup : workDeadline + 60000;
  const actionDeadline = () => Math.min(workDeadline, Date.now() + 15000);
  let actionCompletedAt, cleanupStartedAt, cleanupCompletedAt;
  let owner, original, cleanup = { kind: 'not-run' }, executionApiCalled = false;
  const cases = [], failures = [];
  try {
  assert.equal(path.basename(assets), target, 'Operate the asset built on this actual target');
  const extensionRoot = path.join(directory, 'provider'); const dist = path.join(extensionRoot, 'dist');
  const ownerName = { linux: 'Linux', darwin: 'Macos', win32: 'Windows' }[process.platform];
  assert(ownerName, 'Unsupported native operation platform');
  const stem = ownerName.toLowerCase();
  const nativeRoot = path.join(dist, `native/${stem}-execution-candidate`, target);
  await fs.mkdir(path.dirname(nativeRoot), { recursive: true }); await fs.cp(assets, nativeRoot, { recursive: true });
  if(process.platform==='win32')await fs.cp(path.join(root,'node_modules/node-pty'),path.join(extensionRoot,'node_modules/node-pty'),
    {recursive:true,dereference:true});
  await build({ absWorkingDir: root, entryPoints: {
    [`${stem}-execution-provider`]: `extensions/vscode/dev-session-canvas/src/panel/${stem}ExecutionProviderMain.ts`,
    ...(process.platform === 'win32' ? { 'windows-execution-output-worker':
      'extensions/vscode/dev-session-canvas/src/panel/windowsExecutionOutputWorker.ts' } : {})
  }, bundle: true, platform: 'node', format: 'cjs', target: 'node18', outdir: dist,
    external: ['node-pty'] });
  const apiFile = path.join(directory, 'operation-api.cjs');
  await build({ stdin: { contents:
    `export { create${ownerName}ExecutionOwnerOptions } from './extensions/vscode/dev-session-canvas/src/panel/${stem}ExecutionOwnerFactory';\n`
    + "export { ExecutionOwnerLifecycle } from './extensions/vscode/dev-session-canvas/src/panel/executionOwnerLifecycle';\n",
    resolveDir: root, sourcefile: 'native-gate-entry.js' },
  bundle: true, platform: 'node', format: 'cjs', target: 'node18', outfile: apiFile });
  const api = require(apiFile);
  owner = new api.ExecutionOwnerLifecycle(api[`create${ownerName}ExecutionOwnerOptions`]({
    extensionRoot, mode: 'live-runtime' }));
  executionApiCalled = true;
  const wait = async (label, read, predicate, deadline) => {
    assert(Number.isFinite(deadline), 'Each native action needs its original absolute deadline');
    let value;
    do { assert(Date.now() <= deadline, `${label} original deadline exhausted`);
      value = await read(); if (Date.now() <= deadline && predicate(value)) return value;
      if (Date.now() >= deadline) throw new Error(`${label} timed out: ${JSON.stringify(value)}`);
      await new Promise(resolve => setTimeout(resolve, Math.min(20, Math.max(0, deadline - Date.now()))));
    } while (true);
  };
  const start = async name => {
    const record = owner.reserve(name); let outputText = '', processResult;
    const shell = process.platform === 'win32' ? path.join(process.env.SystemRoot, 'System32/cmd.exe') : '/bin/sh';
    let revision=0;
    const startedDeadline = actionDeadline();
    const observation = record.start({ file: shell, args: process.platform === 'win32' ? ['/d', '/q'] : ['-i'],
      cwd: directory, env: Object.fromEntries(Object.entries(process.env).filter(([,value])=>typeof value==='string')),
      cols: 80, rows: 24, stopStrategy: 'hangup' }, {
      consume: async batches => { for (const batch of batches) outputText += batch.text; },
      flushFinal: async () => ++revision,
      processResult: result => { processResult = result; }
    });
    let startedResult, startFailure;
    observation.first.then(value => { startedResult = value; }, error => { startFailure = error; });
    const result = await wait('Native start', () => { if (startFailure) throw startFailure; return startedResult; },
      value => value !== undefined, startedDeadline);
    assert.equal(result.kind, 'started');
    const identity = await processIdentity(result.pid); assert(identity, 'Started PTY process must be independently observed');
    return { record, identity, text: () => outputText, result: () => processResult };
  };
    const io = await start('io-resize-exit');
    const marker = `GATE_IO_${io.identity.pid}`;
    const now=()=>performance.now();
    const ioDeadline = actionDeadline();
    assert.equal((await io.record.write(`echo ${marker}\r`, now() + 5000).first).kind, 'written');
    await wait('PTY output', io.text, text => text.split(/\r?\n/).some(line=>line.trim()===marker), ioDeadline);
    const geometryDeadline = actionDeadline();
    assert.equal((await io.record.resize(113, 37, now() + 5000).first).kind, 'resized');
    if (process.platform === 'win32') {
      const observer = path.join(directory, 'observe-geometry.ps1');
      await fs.writeFile(observer, 'Write-Output ("GATE_GEOMETRY={0},{1}" -f $Host.UI.RawUI.WindowSize.Width,$Host.UI.RawUI.WindowSize.Height)\n');
      assert.equal((await io.record.write(`powershell.exe -NoProfile -File "${observer}"\r`,
        now() + Math.min(5000, Math.max(1, geometryDeadline - Date.now()))).first).kind, 'written');
      await wait('Actual ConPTY child geometry', io.text, text => /GATE_GEOMETRY=113,37/.test(text), geometryDeadline);
    } else {
      assert.equal((await io.record.write("printf 'GATE_GEOMETRY='; stty size\r",
        now() + Math.min(5000, Math.max(1, geometryDeadline - Date.now()))).first).kind, 'written');
      await wait('Actual PTY child geometry', io.text, text => /GATE_GEOMETRY=37 113/.test(text), geometryDeadline);
    }
    const exitDeadline = actionDeadline();
    assert.equal((await io.record.write('exit 17\r', now() + 5000).first).kind, 'written');
    await wait('Natural process result', io.result, result => result?.kind === 'exited' && result.exitCode === 17, exitDeadline);
    io.record.settleReaders('settled');
    await wait('Original native resources retired', () => io.record.snapshot(), result => result.retired === true, exitDeadline);
    const absence = await waitForHostAbsence(io.identity, exitDeadline);
    cases.push({ id: 'spawn-input-output-resize-natural-exit', identity: io.identity,
      processResult: io.result(), final: io.record.snapshot(), absence });
    const stop = await start('provider-stop');
    const stopReadyDeadline = actionDeadline();
    const stopMarker = `GATE_STOP_READY_${stop.identity.pid}`;
    assert.equal((await stop.record.write(`echo ${stopMarker}\r`, now() + 5000).first).kind, 'written');
    await wait('Original Stop subject is interactive', stop.text,
      text => text.split(/\r?\n/).some(line => line.trim() === stopMarker), stopReadyDeadline);
    assert.equal(stop.result(), undefined, 'Stop must target a still-running original process');
    const beforeStop = await processIdentity(stop.identity.pid);
    assert.equal(beforeStop?.startTicks ?? beforeStop?.startTime, stop.identity.startTicks ?? stop.identity.startTime);
    const stopDeadline = actionDeadline();
    const stopped = await withinDeadline('Original provider Stop', stopDeadline,
      () => stop.record.requestStop('native gate original provider Stop'),
      { settlementDeadline: Math.min(cleanupDeadline, stopDeadline + 10000) });
    assert.equal(stopped.kind, 'settled');
    const processResult = await wait('Provider Stop confirms original process termination', stop.result,
      result => ['exited', 'signaled'].includes(result?.kind), stopDeadline);
    if (process.platform === 'win32') {
      assert.equal(processResult.kind, 'exited', 'ConPTY Stop requires an observed Windows exit code');
      assert(Number.isSafeInteger(processResult.exitCode) && processResult.exitCode >= 0 && processResult.exitCode <= 0xffffffff);
    } else {
      assert.equal(processResult.kind, 'signaled'); assert.equal(processResult.signal, 'SIGHUP');
    }
    stop.record.settleReaders('settled');
    await wait('Stopped resources retired', () => stop.record.snapshot(), result => result.retired === true, stopDeadline);
    cases.push({ id: 'provider-stop', identity: stop.identity, processResult: stop.result(), final: stop.record.snapshot(),
      absence: await waitForHostAbsence(stop.identity, stopDeadline) });
    assert(Date.now() <= workDeadline, 'Native business completion exceeded its original work deadline');
    actionCompletedAt = new Date().toISOString();
  } catch (error) { original = error; failures.push({ stage: executionApiCalled ? 'action/assert' : 'prepare', reason: error.message }); }
  cleanupStartedAt = new Date().toISOString();
  try {
    cleanup = await retireNativeResources(owner, original, Math.min(cleanupDeadline, Date.now() + 60000));
  } catch (error) {
    cleanup = { kind: 'unconfirmed', reason: error.message,
      pending: owner?.list().map(record => record.snapshot()) ?? [] };
    failures.push({ stage: 'cleanup', reason: error.message }); original ??= error;
  }
  cleanupCompletedAt = new Date().toISOString();
  const receipt = { schemaVersion: 1, target,
    nativeManifestHash: await fileDigest(path.join(assets, 'manifest.json')).catch(() => null),
    executionApiCalled, scope: 'finite-native-provider-operation', status: original ? 'failed' : 'passed',
    startedAt, actionCompletedAt: actionCompletedAt ?? null, cleanupStartedAt, cleanupCompletedAt,
    completedAt: new Date().toISOString(), deadline: workDeadline, cleanupDeadline,
    cases, cleanup, failures, failure: original?.message ?? null };
  await writeJSON(path.join(directory, 'native-operation.json'), receipt);
  if (original) throw original;
  return receipt;
}
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const { values } = parseArgs({ options: { assets: { type: 'string' }, output: { type: 'string' } } });
  assert(values.assets && values.output); await runNativeOperation(values);
}
