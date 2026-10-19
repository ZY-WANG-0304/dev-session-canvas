const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const vscode = require('vscode');
const { execFileSync } = require('node:child_process');
const { runtimeIsRetired, verifyOriginalLocalRetirement } = require('./gate-runtime-state.cjs');

async function write(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
}
async function identity() {
  if (process.platform === 'darwin') return { pid: process.pid, platform: process.platform,
    startTime: execFileSync('ps', ['-p', String(process.pid), '-o', 'lstart='], { encoding: 'utf8', timeout: 5000 }).trim() };
  if (process.platform === 'win32') return { pid: process.pid, platform: process.platform,
    startTime: execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      `(Get-CimInstance Win32_Process -Filter "ProcessId = ${process.pid}").CreationDate.ToUniversalTime().ToString("o")`],
    { encoding: 'utf8', timeout: 5000 }).trim() };
  const stat = await fs.readFile(`/proc/${process.pid}/stat`, 'utf8');
  return { pid: process.pid, startTicks: stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19], platform: process.platform };
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function bounded(label, read, predicate, deadline) {
  let value;
  while (Date.now() < deadline) {
    value = await read(); if (predicate(value)) return value;
    await sleep(Math.min(100, Math.max(0, deadline - Date.now())));
  }
  throw new Error(`${label} exceeded cleanup deadline: ${JSON.stringify(value)}`);
}

// Cleanup uses instrumented-suite commands only. The installed-pair driver does
// not import this module or enable the product's test mode.
async function cleanupOwnedFixtures() {
  const extension=vscode.extensions.getExtension('devsessioncanvas.dev-session-canvas');
  assert(extension,'Fixture main extension unavailable');await extension.activate();
  const commands = await vscode.commands.getCommands(true);
  const stateCommand = 'devSessionCanvas.__test.getDebugState';
  assert(commands.includes(stateCommand), 'Fixture cleanup needs an actual product state observation');
  const command = (name, ...args) => vscode.commands.executeCommand(`devSessionCanvas.__test.${name}`, ...args);
  const inherited=Number(process.env.DEV_SESSION_CANVAS_GATE_CLEANUP_DEADLINE);
  const deadline = Math.min(Date.now()+60000,Number.isFinite(inherited)&&inherited>0?inherited:Infinity);
  let state = await command('getDebugState');
  const originalRuntime = await command('getRuntimeSupervisorState');
  const storageRoot = process.env.DEV_SESSION_CANVAS_GATE_STORAGE_ROOT;
  assert(storageRoot, 'Private fixture storage root is required for Supervisor cleanup');
  const { capturePrivateSupervisors, retirePrivateSupervisors } = require('./gate-supervisor-cleanup.cjs');
  const storageRoots = process.env.DEV_SESSION_CANVAS_GATE_STORAGE_ROOTS
    ? JSON.parse(process.env.DEV_SESSION_CANVAS_GATE_STORAGE_ROOTS) : [storageRoot];
  const supervisorScope = await capturePrivateSupervisors(originalRuntime, storageRoots, deadline);
  const originalLocal = state.localExecutions.map(record => ({ ...record,
    identity: { ...record.identity } }));
  const nodes = state.state.nodes.filter(node => ['agent', 'terminal'].includes(node.kind));
  const expected = nodes.map(node => ({ id: node.id, kind: node.kind,
    session: node.metadata?.[node.kind]?.runtimeSessionId ?? null }));
  const liveRuntime=nodes.filter(node=>node.metadata?.[node.kind]?.liveSession&&node.metadata[node.kind].persistenceMode==='live-runtime');
  if(liveRuntime.length) {
    const {captureRuntimeExecution,stopRuntimeExecutionsAfterRetirement}=require('./runtime-retirement.cjs');
    await stopRuntimeExecutionsAfterRetirement({executions:liveRuntime.map(node=>captureRuntimeExecution(state,node.kind,node.id)),
      stop:execution=>command('dispatchWebviewMessage',{type:'webview/stopExecutionSession',
        payload:{nodeId:execution.nodeId,kind:execution.kind}}),
      getSnapshot:()=>command('getDebugState'),getRuntimeSupervisorState:()=>command('getRuntimeSupervisorState'),
      timeoutMs:Math.max(1,deadline-Date.now())});
  }
  for (const node of nodes) {
    if (node.metadata?.[node.kind]?.liveSession) await command('dispatchWebviewMessage', {
      type: 'webview/stopExecutionSession', payload: { nodeId: node.id, kind: node.kind }
    });
  }
  state = await bounded('Original fixture Stop', () => command('getDebugState'), snapshot => expected.every(target => {
    const node = snapshot.state.nodes.find(item => item.id === target.id);
    return !node || node.metadata?.[target.kind]?.liveSession === false;
  }), deadline);
  // live=false is a node state, not final persistence or original retirement.
  // Verify each original record before reset removes the ability to identify it.
  state = await bounded('Original local fixture persistence and retirement', () => command('getDebugState'), snapshot => {
    return originalLocal.every(original => {
      const retained = snapshot.localExecutions.find(record => record.identity.executionId === original.identity.executionId
        && record.identity.generation === original.identity.generation);
      assert(!['failed', 'unconfirmed'].includes(retained?.persistence?.result?.kind),
        `Original fixture save failed: ${JSON.stringify(retained?.persistence?.result)}`);
      return !retained;
    });
  }, deadline);
  const diagnostics = await command('getDiagnosticEvents');
  const localRetirement = verifyOriginalLocalRetirement(originalLocal, state, diagnostics);
  // A causal suite may already have reset and closed its page, starting the
  // asynchronous mode departure. An empty graph needs observation, not a new
  // competing mutation. Nonempty fixtures still require the original reset.
  const resetRequired = state.state.nodes.length > 0;
  if (resetRequired) {
    const { resetCanvasAfterFinalPersistence } = require('./reset-canvas.cjs');
    await resetCanvasAfterFinalPersistence({ reset: () => command('resetState'),
      getSnapshot: () => command('getDebugState'), getDiagnosticEvents: () => command('getDiagnosticEvents'),
      expectedExecutions: expected, timeoutMs: Math.max(1, deadline - Date.now()) });
  }
  const empty = await command('getDebugState');
  assert.equal(empty.state.nodes.length, 0, 'Fixture graph must be empty before private Supervisor retirement');
  const runtime = await bounded('Fixture sessions retired', () => command('getRuntimeSupervisorState'), runtimeIsRetired, deadline);
  const supervisors = await retirePrivateSupervisors(runtime, supervisorScope, deadline);
  return { expected, nodes: state.state.nodes.map(node => node.id), originalRuntime, runtime,
    supervisorScope, supervisors, localRetirement, resetRequired };
}

exports.runWrapped = async function runWrapped(testFile) {
  const output = process.env.DEV_SESSION_CANVAS_GATE_HOST_RECEIPTS;
  assert(output, 'Formal Host requires its evidence directory');
  const nonce = process.env.DEV_SESSION_CANVAS_GATE_RUN_NONCE;
  assert(nonce, 'Formal Host requires an execution identity');
  const subject = path.join(__dirname, testFile);
  const host = await identity();
  const deadline = Number(process.env.DEV_SESSION_CANVAS_GATE_DEADLINE);
  const cleanupDeadline = Number(process.env.DEV_SESSION_CANVAS_GATE_CLEANUP_DEADLINE);
  assert(Number.isFinite(deadline) && deadline > Date.now(), 'Original Host work deadline is required');
  assert(Number.isFinite(cleanupDeadline) && cleanupDeadline >= deadline, 'Original Host cleanup reserve is required');
  const caseID = process.env.DEV_SESSION_CANVAS_GATE_CASE_ID ?? process.env.DEV_SESSION_CANVAS_SMOKE_SCENARIO;
  assert(caseID, 'Original planned case identity is required');
  let role = 'main';
  if (testFile === 'real-reopen-tests.cjs') {
    const control = JSON.parse(await fs.readFile(process.env.DEV_SESSION_CANVAS_REAL_REOPEN_CONTROL_FILE, 'utf8'));
    role = control.phase;
  } else if (process.env.DEV_SESSION_CANVAS_SNAPSHOT_HOST_CONTROL_FILE) {
    const control = JSON.parse(await fs.readFile(process.env.DEV_SESSION_CANVAS_SNAPSHOT_HOST_CONTROL_FILE, 'utf8'));
    role = control.phase;
  } else if (testFile === 'two-window-shared-runtime-tests.cjs') role = process.env.DEV_SESSION_CANVAS_TWO_WINDOW_ROLE;
  else if (['notifier-locale-tests.cjs', 'ui-copy-locale-tests.cjs'].includes(testFile)) role = process.env.DEV_SESSION_CANVAS_EXPECTED_LOCALE;
  const { pathToFileURL } = require('node:url');
  const { smokeCatalog } = await import(pathToFileURL(path.join(__dirname, 'smoke-catalog.mjs')).href);
  const selected = smokeCatalog.find(entry => entry.id === caseID);
  const file = path.join(output, `${host.pid}-${crypto.randomUUID()}.host.json`);
  const receipt = { schemaVersion: 1, nonce, testFile, subjectHash: crypto.createHash('sha256')
    .update(await fs.readFile(subject)).digest('hex'), host,
    caseID, role, deadline, cleanupDeadline,
    environment: { vscode: vscode.version, node: process.versions.node, platform: process.platform, arch: process.arch },
    steps: (Array.isArray(selected?.steps) ? selected.steps : selected?.steps?.[role] ?? [])
      .map(id => ({ caseID, id, status: 'not-run' })),
    startedAt: new Date().toISOString(), action: 'not-run', assert: 'not-run', cleanup: 'not-run', failures: [] };
  // Atomic snapshots may be updated; the path and nonce are private to this run.
  const save = async () => { await fs.mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.pending`; await fs.writeFile(tmp, `${JSON.stringify(receipt, null, 2)}\n`); await fs.rename(tmp, file); };
  await save();
  // Setup completion and a deliberate retained Host are different events.
  // The remote suite emits this only after all setup assertions and persistence
  // succeed, before awaiting the controlled disconnect forever.
  let transferred = false;
  const setupCompleted = async () => {
    assert.equal(testFile, 'real-reopen-tests.cjs');
    assert(!transferred, 'Duplicate real-reopen setup completion');
    assert(Date.now() <= deadline, 'Original setup work deadline exhausted');
    transferred = true; receipt.phase = 'setup';
    receipt.action = receipt.assert = 'passed'; receipt.cleanup = 'transferred-to-verify';
    receipt.actionCompletedAt = new Date().toISOString();
    receipt.completedAt = new Date().toISOString(); await save();
  };
  const gateRecordStep = async ({ caseID, id, phase }, operation) => {
    assert.equal(caseID, receipt.caseID, 'Case step belongs to another scenario');
    const step = receipt.steps.find(step => step.id === id);
    assert(step && step.status === 'not-run' && !step.startedAt, 'Unplanned or duplicate actual case step');
    assert(receipt.steps.slice(0, receipt.steps.indexOf(step)).every(step => step.status === 'passed'),
      'Case steps cannot run before their predecessors pass');
    step.phase = phase; step.startedAt = new Date().toISOString(); step.deadline = deadline; await save();
    try {
      const value = await operation();
      assert(Date.now() <= deadline, 'Original case work deadline exhausted');
      step.status = 'passed'; step.completedAt = new Date().toISOString();
      if (value) step.evidence = value;
      await save(); return value;
    } catch (error) {
      step.status = 'failed'; step.reason = error.message; step.completedAt = new Date().toISOString();
      await save(); throw error;
    }
  };
  const gateStepBoundary = async ({ id, status, phase = 'action/assert' }) => {
    const step = receipt.steps.find(step => step.id === id);
    assert(step, 'Unplanned causal case step');
    if (status === 'started') {
      assert.equal(step.status, 'not-run'); assert(!step.startedAt, 'Duplicate causal case step');
      assert(receipt.steps.slice(0, receipt.steps.indexOf(step)).every(step => step.status === 'passed'),
        'Causal case step cannot precede its prerequisite');
      step.phase = phase; step.startedAt = new Date().toISOString(); step.deadline = deadline;
    } else {
      assert.equal(status, 'passed'); assert(step.startedAt && step.status === 'not-run');
      assert(Date.now()<=deadline, 'Original causal case work deadline exhausted');
      step.status = 'passed'; step.completedAt = new Date().toISOString();
    }
    await save();
  };
  let original;
  try {
    await require(subject).run({ gateSetupCompleted: setupCompleted, gateRecordStep, gateStepBoundary });
    assert(Date.now() <= deadline, 'Original Host work deadline exhausted');
    receipt.actionCompletedAt = new Date().toISOString();
    receipt.action = receipt.assert = 'passed';
  } catch (error) {
    original = error; receipt.action = receipt.assert = 'failed';
    for (const step of receipt.steps.filter(step=>step.startedAt&&step.status==='not-run')) {
      step.status='failed';step.reason=error.message;step.completedAt=new Date().toISOString();
    }
    receipt.failures.push({ stage: 'action/assert', reason: error.message });
  }
  await save();
  // A real-reopen setup intentionally retains its sessions for verify. Its
  // final verify Host owns cleanup; do not kill the test's causal prerequisite.
  let setup = false;
  const controlFile = process.env.DEV_SESSION_CANVAS_REAL_REOPEN_CONTROL_FILE;
  if (testFile === 'real-reopen-tests.cjs' && controlFile) setup = JSON.parse(await fs.readFile(controlFile, 'utf8')).phase === 'setup';
  if (process.env.DEV_SESSION_CANVAS_SNAPSHOT_HOST_CONTROL_FILE) setup =
    JSON.parse(await fs.readFile(process.env.DEV_SESSION_CANVAS_SNAPSHOT_HOST_CONTROL_FILE, 'utf8')).phase === 'setup';
  if ((setup || transferred) && !original) {
    receipt.cleanup = 'transferred-to-verify';
    receipt.phase = 'setup';
  } else {
    receipt.cleanupStartedAt = new Date().toISOString();
    try { receipt.cleanupEvidence = await cleanupOwnedFixtures();
      assert(Date.now()<=cleanupDeadline, 'Original Host cleanup deadline exhausted'); receipt.cleanup = 'passed'; }
    catch (error) { receipt.cleanup = 'failed'; receipt.failures.push({ stage: 'cleanup', reason: error.message }); original ??= error; }
    receipt.cleanupCompletedAt = new Date().toISOString();
  }
  receipt.completedAt = new Date().toISOString(); await save();
  if (original) throw original;
};
