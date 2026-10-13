import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

// Diagnostic-only mutation on an isolated CI checkout. Original branches, budgets and results are retained.
const filename = path.resolve('extensions/vscode/dev-session-canvas/src/supervisor/runtimeRootPreparation.ts');
const original = await readFile(filename, 'utf8');
let source = original;
const replace = (before, after) => {
  assert.equal(source.split(before).length - 1, 1, `Expected one diagnostic anchor: ${before}`);
  source = source.replace(before, after);
};
replace('  let preparingStorage = true;', `  let preparingStorage = true;
  let rcaPhase = 'storage';
  const rcaTrace = (detail: object): void => {
    const output = process.env.DSC_RCA_TRACE_FILE;
    if (!output) return;
    try { require('fs').appendFileSync(output, JSON.stringify({at: new Date().toISOString(), pid: process.pid,
      phase: rcaPhase, storageDir: request.storageDir, preferredBackends: request.preferredBackends, ...detail}) + '\\n'); } catch { }
  };`);
replace('    preparingStorage = false;', "    preparingStorage = false; rcaPhase = 'socket-directory'; rcaTrace({kind: 'stage'});");
replace('    const native = createNativeExecutionOwnerOptions', "    rcaPhase = 'native-assets'; rcaTrace({kind: 'stage'});\n    const native = createNativeExecutionOwnerOptions");
replace('    const deadline = Date.now() + WAIT_TIMEOUT_MS;', "    rcaPhase = 'preparation-claim'; rcaTrace({kind: 'stage'});\n    const deadline = Date.now() + WAIT_TIMEOUT_MS;");
replace('    const discovered = await discoverOwner(request);\n    if (discovered.kind !==', "    rcaPhase = 'owner-discovery'; rcaTrace({kind: 'stage'});\n    const discovered = await discoverOwner(request);\n    if (discovered.kind !==");
replace('    const previous = await inspectRuntimeRootStartup', "    rcaPhase = 'previous-startup'; rcaTrace({kind: 'stage'});\n    const previous = await inspectRuntimeRootStartup");
replace('    await publishRuntimeRootOwner', "    rcaPhase = 'owner-publication'; rcaTrace({kind: 'stage'});\n    await publishRuntimeRootOwner");
replace('    if (!await probeRuntimeUnowned', "    rcaPhase = 'runtime-claim-probe'; rcaTrace({kind: 'stage'});\n    if (!await probeRuntimeUnowned");
replace('    let selected: RuntimeHostBackendKind', "    rcaPhase = 'backend-selection'; rcaTrace({kind: 'stage'});\n    let selected: RuntimeHostBackendKind");
replace('    const intent = createRuntimeRootStartupIntent', "    rcaPhase = 'intent-publication'; rcaTrace({kind: 'stage'});\n    const intent = createRuntimeRootStartupIntent");
replace('    await startRuntimeSupervisor', "    rcaPhase = 'supervisor-submission'; rcaTrace({kind: 'stage', backend: selected});\n    await startRuntimeSupervisor");
replace('    const readyDeadline = Date.now()', "    rcaPhase = 'supervisor-ready'; rcaTrace({kind: 'stage'});\n    const readyDeadline = Date.now()");
replace('  } catch {\n    if (preparingStorage)', `  } catch (rcaError) {
    const e = rcaError as Error & {code?: string | number};
    rcaTrace({kind: 'caught-error', name: e?.name, code: e?.code, message: String(e?.message ?? rcaError).slice(0, 2048),
      stack: String(e?.stack ?? '').split('\\n').slice(0, 8)});
    if (preparingStorage)`);
await writeFile(filename + '.rca-original', original);
await writeFile(filename, source);
console.log('Installed phase-only preparation trace on the isolated diagnostic checkout.');
