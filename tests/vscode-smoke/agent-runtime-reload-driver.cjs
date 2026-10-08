const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs/promises');
const net = require('node:net');
const path = require('node:path');
const vscode = require('vscode');
const { activateVisibleExtension, waitForCommand } = require('./test-helpers.cjs');
const { captureInstalledExtensionReceipt } = require('./installed-execution-candidate.cjs');
const { AgentProcessObserver, executionEnded } = require('./agent-candidate-process-observer.cjs');
const { hasLiveWindowsStartupChain } = require('./agent-candidate-windows-observer.cjs');
const { resolveSystemdUserRuntimeSupervisorPaths, resolveLegacyRuntimeSupervisorPaths } = require('./runtime-reload-paths.cjs');
const { resolveExecutionSessionSpawnSpec } = require('./execution-session-spawn-spec.cjs');
const { readIdentity, sameIdentity, sameLiveIdentity, exitedIdentity, closeWindowsIdentityObserver } = require('./runtime-reload-contract.cjs');
const { createRuntimeOwnerDescriptor, createRuntimeOwnerCompatibilityFingerprint, resolveRootRuntimeSupervisorGeneration,
  resolveRuntimeRootOwnerGlobalStoragePath } = require('./runtime-root-ownership.cjs');
const { assertRuntimeStorageContained } = require('./runtime-storage-containment.cjs');

const artifacts = process.env.DEV_SESSION_CANVAS_SMOKE_ARTIFACT_DIR;
const controlPath = process.env.DEV_SESSION_CANVAS_AGENT_RELOAD_CONTROL;
const surface = 'editor';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const command = (name, ...args) => vscode.commands.executeCommand(`devSessionCanvas.__test.${name}`, ...args);
const snapshot = () => command('getDebugState');
const probe = () => command('captureWebviewProbe', surface, 10000);
const dom = action => command('performWebviewDomAction', action, surface, 10000);
const stripVt = value => String(value).replace(/[\u001b\u009b]\[[0-?]*[ -/]*[@-~]/g, '');
const hasAgentMarkerResponse = (value, marker) => value.nodes.find(node => node.nodeId === currentNodeId)
  ?.terminalVisibleLines?.some(line => stripVt(line).trim().replace(/^(?:\u2022|\u25cf|\u23fa|\*)\s*/, '')
    .startsWith(marker)) === true;
const sendAgentTurn = async (nodeId, marker) => {
  // Codex treats Enter in a fast paste burst as an inserted newline; submit separately.
  await dom({ kind: 'sendExecutionInput', nodeId, data: `Reply with exactly ${marker} and nothing else.` });
  await sleep(200);
  await dom({ kind: 'sendExecutionInput', nodeId, data: '\r' });
};
const write = (name, value) => fs.writeFile(path.join(artifacts, name), `${JSON.stringify(value, null, 2)}\n`);
const read = async name => JSON.parse(await fs.readFile(path.join(artifacts, name), 'utf8'));
const atomic = async (file, value) => {
  const next = `${file}.next`;
  await fs.writeFile(next, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
  await fs.rename(next, file);
};
const nodeOf = (state, id) => state?.state?.nodes?.find(node => node.id === id);
const textOf = value => value.nodes.find(node => node.nodeId === currentNodeId)?.terminalVisibleLines?.join('\n') ?? '';
let config;
let control;
let currentNodeId;
let observer;
let observerReleased = false;
let setupProcessObservationAttempted = false;
let phase = 'initialization';
let reloading = false;

exports.activate = () => {
  void run().catch(async error => {
    try { await write(`${phase}-failure.json`, { phase, error: String(error), stack: error.stack }); }
    catch (writeError) { console.error(writeError); }
  });
};

async function poll(label, get, accept, timeoutMs = 30000) {
  const deadline = Math.min(Date.now() + timeoutMs, control.deadlineAt - (config?.rootWindowPair ? 45000 : 30000));
  while (Date.now() < deadline) {
    const value = await get();
    if (accept(value)) return value;
    if (observer?.error) throw new Error(observer.error);
    await sleep(50);
  }
  throw new Error(`Timed out: ${label}`);
}

async function run() {
  let failure;
  try {
    control = JSON.parse(await fs.readFile(controlPath, 'utf8'));
    config = JSON.parse(await fs.readFile(process.env.DEV_SESSION_CANVAS_AGENT_RELOAD_CONFIG, 'utf8'));
    if (config.rootWindowPair) { await runRootWindowPair(); return; }
    phase = control.phase;
    await write(`${phase}-activation.json`, { phase, host: await readIdentity(process.pid), nonce: control.nonce });
    const extension = await activateVisibleExtension(vscode, 'devsessioncanvas.dev-session-canvas');
    await waitForCommand(vscode, 'devSessionCanvas.__test.getDebugState');
    const installedVsix = await captureInstalledExtensionReceipt(extension, config.installedVsixExpectation);
    await write(`${phase}-environment.json`, { phase, nonce: control.nonce, vscode: vscode.version,
      versions: process.versions, installedVsix });
    await vscode.commands.executeCommand('devSessionCanvas.openCanvasInEditor');
    await command('waitForCanvasReady', surface, 30000);
    if (phase === 'setup') await setup(extension);
    else await verify(extension);
  } catch (error) {
    failure = error;
    await write(`${phase}-failure.json`, { phase, nonce: control?.nonce, error: String(error), stack: error.stack });
    if (phase === 'setup') await captureSetupProcessObservation();
    try { await write('failure-webview-probe.json', await probe()); } catch { /* Preserve the first failure. */ }
    for (const name of ['getDebugState', 'getRuntimeSupervisorState', 'getDiagnosticEvents']) {
      try { await write(`failure-${name}.json`, await command(name)); } catch { /* Preserve the first failure. */ }
    }
  } finally {
    if (!config?.rootWindowPair && !reloading) {
      try { await cleanup(); } catch (error) { failure ??= error; await write('cleanup-failure.json', { error: String(error) }); }
      await closeWindowsIdentityObserver().catch(error => { failure ??= error; });
      await write('driver-finished.json', { nonce: control?.nonce, phase, pass: !failure });
      void vscode.commands.executeCommand(process.platform === 'darwin'
        ? 'workbench.action.quit' : 'workbench.action.closeWindow').catch(console.error);
    } else if (!config?.rootWindowPair) await closeWindowsIdentityObserver().catch(error => { failure ??= error; });
  }
}

function runtimePaths(metadata) {
  return metadata.runtimeBackend === 'systemd-user'
    ? resolveSystemdUserRuntimeSupervisorPaths(metadata.runtimeStoragePath)
    : resolveLegacyRuntimeSupervisorPaths(metadata.runtimeStoragePath);
}

async function assertRuntimeOwnerBinding(metadata, hello) {
  if (!config.rootOwner) return;
  const profile = { linux: 'linux-owner-v1-candidate', darwin: 'macos-owner-v1-candidate',
    win32: 'windows-owner-v1-candidate' }[process.platform];
  const owner = metadata.runtimeOwner;
  assert(owner && typeof owner === 'object', 'Root acceptance requires its original complete runtime owner.');
  assert(['legacy-detached', 'systemd-user'].includes(metadata.runtimeBackend));
  assert.equal(metadata.runtimeGuarantee, metadata.runtimeBackend === 'systemd-user' ? 'strong' : 'best-effort');
  assert(typeof metadata.runtimeSessionId === 'string' && metadata.runtimeSessionId.length > 0);
  const expected = createRuntimeOwnerDescriptor({ environmentKey: owner.environmentKey,
    userStorageScopeKey: owner.userStorageScopeKey, rootPath: config.workspacePath,
    generation: resolveRootRuntimeSupervisorGeneration(profile) });
  assert.deepEqual(owner, expected, 'The original owner must identify this workspace root and platform generation.');
  const globalStorage = resolveRuntimeRootOwnerGlobalStoragePath(runtimePaths(metadata).storageDir, owner);
  const expectedGlobalStorage = path.join(config.userDataDir, 'User', 'globalStorage', 'devsessioncanvas.dev-session-canvas');
  assert.equal(path.relative(await fs.realpath(expectedGlobalStorage), await fs.realpath(globalStorage)), '',
    'Root runtime storage must belong to the installed extension in this isolated VS Code profile.');
  await assertRuntimeStorageContained(metadata.runtimeStoragePath, config.permittedStorageRoots);
  assert.equal(hello.serverVersion, 1);
  assert.deepEqual(hello.runtimeOwner, owner);
  assert.equal(hello.runtimeBackend, metadata.runtimeBackend);
  assert.equal(hello.runtimeGuarantee, metadata.runtimeGuarantee);
  assert.equal(hello.executionProfile, profile);
  assert.equal(hello.ownerCompatibilityFingerprint, createRuntimeOwnerCompatibilityFingerprint(owner.generation, profile));
  assert.equal(hello.capabilities?.terminalCurrentStateV1, true);
  assert.equal(hello.capabilities?.terminalHostOutputCreditV1, true);
  assert(hello.capabilities?.executionCandidateProfiles?.includes(profile));
}

function rpc(socketPath, method, id = 'agent-reload') {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath);
    let data = '';
    const timer = setTimeout(() => finish(new Error(`Supervisor ${method} timed out.`)), 5000);
    const finish = (error, value) => { clearTimeout(timer); socket.destroy(); error ? reject(error) : resolve(value); };
    socket.once('error', finish);
    socket.once('connect', () => socket.write(`${JSON.stringify({ type: 'request', id, method })}\n`));
    socket.on('data', chunk => {
      data += chunk.toString();
      if (data.length > 65536) return finish(new Error('Unexpectedly large Supervisor response.'));
      const end = data.indexOf('\n');
      if (end < 0) return;
      try {
        const response = JSON.parse(data.slice(0, end));
        assert(response.ok && response.id === id, JSON.stringify(response.error));
        finish(undefined, response.result);
      } catch (error) { finish(error); }
    });
  });
}

async function mountedReader(id, requested) {
  if (requested) {
    const matches = message => message.type === 'host/executionSnapshot' && message.payload.nodeId === id &&
      message.payload.requestId === requested.requestId && message.payload.terminalRead?.sessionId === requested.sessionId &&
      typeof message.payload.terminalRead.authorityId === 'string' && message.payload.terminalRead.authorityId.length > 0 &&
      typeof message.payload.terminalRead.readId === 'string' && message.payload.terminalRead.readId.length > 0 &&
      (requested.authorityId === undefined || message.payload.terminalRead.authorityId === requested.authorityId);
    return (await poll('live Agent reader', async () => ({ probe: await probe(), messages: await command('getHostMessages') }),
      value => value.probe.nodes.some(node => node.nodeId === id && node.terminalCols >= 64) &&
        value.messages.some(matches))).messages.findLast(matches).payload.terminalRead;
  }
  return (await poll('live Agent reader', async () => ({ probe: await probe(), messages: await command('getHostMessages') }),
    value => value.probe.nodes.some(node => node.nodeId === id && node.terminalCols >= 64) &&
      value.messages.some(message => message.type === 'host/executionSnapshot' && message.payload.nodeId === id &&
        message.payload.terminalRead?.sessionId))).messages.findLast(message =>
          message.type === 'host/executionSnapshot' && message.payload.nodeId === id).payload.terminalRead;
}

async function setup(extension) {
  await command('resetState');
  await command('clearHostMessages');
  await command('clearDiagnosticEvents');
  await startProcessObserver(extension);
  const custom = [config.cli.entry, ...config.launchArguments].map(value => `'${String(value).replaceAll("'", "'\\''")}'`).join(' ');
  await command('createNode', 'agent', config.provider, { agentLaunchPreset: 'custom', agentCustomLaunchCommand: custom,
    cwdOverride: config.workspacePath });
  const created = await poll('Agent node created', snapshot, state => state.state.nodes.some(node => node.kind === 'agent'));
  currentNodeId = created.state.nodes.find(node => node.kind === 'agent').id;
  const position = nodeOf(created, currentNodeId).position;
  await command('dispatchWebviewMessage', { type: 'webview/resizeNode', payload: {
    nodeId: currentNodeId, position, size: { width: 960, height: 700 } } }, surface);
  const active = await poll('Agent live runtime', snapshot, state => {
    const metadata = nodeOf(state, currentNodeId)?.metadata?.agent;
    if (metadata?.lastRuntimeError) throw new Error(`Agent startup failed: ${metadata.lastRuntimeError}`);
    return metadata?.liveSession === true;
  }, 60000);
  const metadata = nodeOf(active, currentNodeId).metadata.agent;
  assert.equal(metadata.persistenceMode, 'live-runtime');
  const paths = runtimePaths(metadata);
  const hello = await rpc(paths.socketPath, 'hello');
  await assertRuntimeOwnerBinding(metadata, hello);
  const supervisor = await readIdentity(hello.pid);
  assert(supervisor && supervisor.startTicks);
  await observer.addRoot(supervisor.pid, 'supervisor');
  const startup = await recordStartupOwnership(metadata, supervisor);
  const reader = await mountedReader(currentNodeId);
  await waitForAgentReady();
  const before = `DSC_AGENT_RELOAD_BEFORE_${control.nonce}`;
  await sendAgentTurn(currentNodeId, before);
  await poll('pre-reload Agent response', probe, value => hasAgentMarkerResponse(value, before), 90000);
  await observer.sample();
  await captureSetupProcessObservation();
  const resources = assertOriginalResourcesLive(startup.resources);
  const setup = { phase: 'setup', nonce: control.nonce, host: await readIdentity(process.pid), nodeId: currentNodeId,
    binding: { runtimeBackend: metadata.runtimeBackend, runtimeStoragePath: metadata.runtimeStoragePath,
      runtimeSessionId: metadata.runtimeSessionId,
      ...(config.rootOwner ? { runtimeOwner: metadata.runtimeOwner, runtimeGuarantee: metadata.runtimeGuarantee } : {}) },
    provider: config.provider, rootOwner: config.rootOwner === true, supervisor, hello, reader, resources,
    frameId: (await snapshot()).surfaceLifecycle[surface].frameId, before };
  await write('ownership.json', { supervisor, resources });
  await write('setup.json', setup);
  control = { ...control, phase: 'verify', reloadRequests: 1, setup };
  await atomic(controlPath, control);
  await releaseProcessObserver();
  reloading = true;
  void vscode.commands.executeCommand('workbench.action.reloadWindow').catch(error => write('reload-command-rejection.json', { error: String(error) }));
}

async function recordStartupOwnership(metadata, supervisor) {
  await poll('Agent startup resources observed', async () => {
    await observer.sample();
    const result = observer.result();
    assert(!result.error, result.error);
    assert.equal(result.failures.length, 0);
    return result.entries;
  }, entries => ['provider', 'cli'].every(role => entries.some(entry => entry.role === role)), 10000);
  let resources;
  try { resources = structuredClone(assertOriginalResourcesLive()); }
  catch (error) { await captureSetupProcessObservation(); throw error; }
  const startup = { nonce: control.nonce, nodeId: currentNodeId, supervisor, resources,
    binding: { runtimeBackend: metadata.runtimeBackend, runtimeStoragePath: metadata.runtimeStoragePath,
      runtimeSessionId: metadata.runtimeSessionId,
      ...(config.rootOwner ? { runtimeOwner: metadata.runtimeOwner, runtimeGuarantee: metadata.runtimeGuarantee } : {}) } };
  await write('startup-ownership.json', startup);
  const next = { ...control, startup };
  await atomic(controlPath, next);
  control = next;
  return startup;
}

async function captureSetupProcessObservation() {
  if (config.provider !== 'claude' || !observer || setupProcessObservationAttempted) return;
  setupProcessObservationAttempted = true;
  try {
    await write('setup-process-observation.json', { nonce: control.nonce,
      entries: observer.result().entries.map(entry => Object.fromEntries([
        'pid', 'ppid', 'startTicks', 'executable', 'role', 'wrapperKind', 'firstPpid', 'firstParentStartTicks',
        'firstSeenMs', 'lastSeenMs', 'lastLiveMs', 'firstAbsentMs', 'state', 'active', 'platform',
        'hasExited', 'exitConfirmed', 'exitCode', 'observationUnknown'
      ].filter(key => entry[key] !== undefined).map(key => [key, entry[key]]))) });
  } catch { /* Diagnostic failure must not replace the first setup error. */ }
}

async function startProcessObserver(extension) {
  observer = new AgentProcessObserver(config.cli, extension.extensionPath, config.processObserver);
  observerReleased = false;
  if (process.platform === 'win32') await observer.setLaunch(resolveExecutionSessionSpawnSpec({
    file: config.cli.entry, args: config.launchArguments, env: process.env }, 'win32'));
  await observer.addRoot(process.pid, 'host');
  observer.start();
}

async function releaseProcessObserver() {
  if (!observer || observerReleased) return;
  try {
    await observer.stop();
  } finally {
    try { await observer.dispose?.(); } finally { observerReleased = true; }
  }
  assert(!observer.error, observer.error);
  assert.equal(observer.failures.length, 0, 'Process observation must settle without unknown evidence.');
}

function assertOriginalResourcesLive(expected, excluded = []) {
  const result = observer.result();
  assert(!result.error, result.error);
  assert.equal(result.failures.length, 0);
  const resources = result.entries.filter(entry => ['cli', 'wrapper', 'provider'].includes(entry.role) &&
    !excluded.some(original => sameIdentity(original, entry)));
  const original = expected ?? resources;
  for (const role of ['cli', 'provider']) {
    assert.equal(original.filter(entry => entry.role === role).length, 1, `Exactly one original ${role} is required.`);
  }
  assert.equal(resources.length, original.length, 'Reload must retain the complete original startup resource set.');
  for (const entry of original) {
    const current = resources.find(value => sameLiveIdentity(entry, value));
    assert(current && current.role === entry.role && current.wrapperKind === entry.wrapperKind &&
      !executionEnded(current) && !current.observationUnknown, 'Original Agent startup identity must still be live.');
  }
  if (process.platform === 'win32') assert(hasLiveWindowsStartupChain(result, config.provider, 'live-runtime'),
    'The original Windows provider/wrapper/CLI chain must be retained before stop.');
  return resources;
}

async function originalResourcesExited(resources) {
  assert(resources?.length > 0, 'Missing original startup resources cannot count as released.');
  await observer.sample();
  const result = observer.result();
  assert(!result.error, result.error);
  assert.equal(result.failures.length, 0);
  const checks = await Promise.all(resources.map(async expected => {
    const actual = process.platform === 'win32'
      ? result.entries.find(entry => sameIdentity(expected, entry))
      : await readIdentity(expected.pid);
    return { expected, actual: actual ?? null, exited: process.platform === 'win32'
      ? Boolean(actual && executionEnded(actual)) : exitedIdentity(expected, actual) };
  }));
  return { checks, pass: checks.every(check => check.exited) };
}

function hasLoadedAgentComposer(text) {
  const visible = stripVt(text);
  if (config.provider === 'claude') {
    return /\bClaude Code\b/i.test(visible) && /\bdeepseek[- ]?flash\b/i.test(visible) &&
      /^[ \t\u00a0]*(?:\u276f|>)[ \t\u00a0]*(?:Try\b[^\n]*)?$/im.test(visible);
  }
  // Codex renders this composer before onboarding too, with a "model: loading" header.
  return /^\s*\u203a\s*Ask\s+Codex\s+to\s+do\s+anything\s*$/im.test(visible) &&
    /\bdeepseek[- ]?flash\b/i.test(visible) && !/model:\s*loading\b/i.test(visible);
}

async function waitForAgentReady() {
  const prompts = new Set();
  let claudeTrustNavigations = 0;
  let claudeTrustAffirmative = false;
  const startupPrompts = [
    /(?:Yes,?\s*I\s*trust|Do\s*you\s*trust|Trust\s*this\s*(?:folder|directory))/i,
    /(?:Choose the text style|Choose.*theme|Select.*theme)/i,
    /Update available.*\n[\s\S]*\b1\.\s*Update now[\s\S]*\b2\.\s*Skip/i,
    /Set up the Codex agent sandbox[\s\S]*1\.\s*Set up default sandbox[\s\S]*2\.\s*Use non-admin sandbox/i,
    ...(config.provider === 'claude' ? [/Detected a custom API key[\s\S]*Do you want to use this API key/i,
      /Security notes:[\s\S]*Press Enter to continue(?:\u2026|\.{3})/i] : [])
  ];
  const deadline = Math.min(Date.now() + 90000, control.deadlineAt - (config.rootWindowPair ? 45000 : 30000));
  while (Date.now() < deadline) {
    const value = await probe();
    const text = textOf(value);
    const previouslyAffirmative = claudeTrustAffirmative;
    claudeTrustAffirmative = false;
    if (config.provider === 'claude' && /Select login method:|Not logged in|Invalid API key/i.test(text)) {
      throw new Error('The isolated Claude API configuration did not reach its authenticated surface.');
    }
    let handledPrompt = false;
    for (const [name, pattern] of [['workspace-trust', /(?:Yes,?\s*I\s*trust|Do\s*you\s*trust|Trust\s*this\s*(?:folder|directory))/i],
      ['theme', /(?:Choose the text style|Choose.*theme|Select.*theme)/i],
      ['update', /Update available.*\n[\s\S]*\b1\.\s*Update now[\s\S]*\b2\.\s*Skip/i],
      ['windows-sandbox', startupPrompts[3]],
      ...(config.provider === 'claude' ? [['claude-api-key', startupPrompts[4]],
        ['claude-security-notes', startupPrompts[5]]] : [])]) {
      if (pattern.test(text) && !prompts.has(name)) {
        let data = name === 'update' ? '\u001b[B\r' : '\r';
        if (name === 'workspace-trust' && config.provider === 'claude') {
          const selectedNo = /^[ \t]*\u276f[ \t]+No, exit[ \t]*\r?\n[ \t]+Yes, I trust this folder[ \t]*$/m.test(text);
          const selectedYes = /^[ \t]+No, exit[ \t]*\r?\n[ \t]*\u276f[ \t]+Yes, I trust this folder[ \t]*$/m.test(text);
          assert(/^[ \t]*Accessing workspace:[ \t]*$/m.test(text)
            && /^[ \t]*Enter to confirm[ \t]+\u00b7[ \t]+Esc to cancel[ \t]*$/m.test(text)
            && selectedNo !== selectedYes, 'Claude workspace trust selection is not confirmed.');
          if (selectedNo) {
            assert(claudeTrustNavigations < 3, 'Claude workspace trust navigation limit reached.');
            claudeTrustNavigations++;
            // Fixed Claude 2.1.280: End selects Yes without toggling on delayed/repeated navigation.
            await dom({ kind: 'sendExecutionInput', nodeId: currentNodeId, data: '\u001b[F' });
            handledPrompt = true;
            break;
          }
          claudeTrustAffirmative = true;
          if (!previouslyAffirmative) { handledPrompt = true; break; }
          data = '\r';
        }
        if (name === 'windows-sandbox') {
          assert.equal(process.platform, 'win32', 'Only the fixed Windows input may configure its sandbox.');
          const selectedDefault = /^\s*\u203a\s*1\.\s*Set up default sandbox/im.test(text);
          const selectedNonAdmin = /^\s*\u203a\s*2\.\s*Use non-admin sandbox/im.test(text);
          assert(selectedDefault || selectedNonAdmin, 'Windows sandbox selection is not confirmed.');
          // Keep the isolated run non-elevated; the read-only/no-tools launch policy remains unchanged.
          data = selectedDefault ? '\u001b[B\r' : '\r';
        }
        prompts.add(name);
        await dom({ kind: 'sendExecutionInput', nodeId: currentNodeId, data });
        handledPrompt = true;
        break;
      }
    }
    if (handledPrompt) { await sleep(100); continue; }
    if (startupPrompts.some(pattern => pattern.test(text))) {
      await sleep(100);
      continue;
    }
    if (hasLoadedAgentComposer(text)) {
      await sleep(300);
      const confirmed = textOf(await probe());
      if (hasLoadedAgentComposer(confirmed) && !startupPrompts.some(pattern => pattern.test(confirmed))) return;
    }
    await sleep(100);
  }
  throw new Error(`Timed out: ${config.provider} interactive surface`);
}

async function verify(extension) {
  const setup = control.setup;
  currentNodeId = setup.nodeId;
  const oldHost = await poll('original Agent Host exited', () => readIdentity(setup.host.pid), value => exitedIdentity(setup.host, value));
  const activation = await read('verify-activation.json');
  assert(!sameIdentity(setup.host, activation.host), 'Reload must use a new Host identity.');
  const state = await snapshot();
  const node = nodeOf(state, setup.nodeId);
  assert(node?.metadata?.agent?.liveSession === true, 'Reload must retain the live Agent node.');
  const metadata = node.metadata.agent;
  for (const [key, value] of Object.entries(setup.binding)) assert.deepEqual(metadata[key], value);
  const paths = runtimePaths(metadata);
  const hello = await rpc(paths.socketPath, 'hello');
  await assertRuntimeOwnerBinding(metadata, hello);
  assert.equal(hello.pid, setup.supervisor.pid);
  assert(sameLiveIdentity(setup.supervisor, await readIdentity(setup.supervisor.pid)));
  const reader = await mountedReader(setup.nodeId);
  assert.equal(reader.sessionId, setup.binding.runtimeSessionId);
  assert.equal(reader.authorityId, setup.reader.authorityId);
  assert.notEqual(reader.readId, setup.reader.readId, 'Reload must mount a new reader on the same authority.');
  assert.notEqual(state.surfaceLifecycle[surface].frameId, setup.frameId);
  const starts = (await command('getDiagnosticEvents')).filter(event =>
    ['execution/startRequested', 'execution/started'].includes(event.kind) && event.detail?.nodeId === setup.nodeId);
  assert.deepEqual(starts, [], 'Reload must not start a second Agent.');
  await startProcessObserver(extension);
  await observer.addRoot(setup.supervisor.pid, 'supervisor');
  await waitForAgentReady();
  const after = `DSC_AGENT_RELOAD_AFTER_${control.nonce}`;
  await sendAgentTurn(setup.nodeId, after);
  await poll('post-reload Agent response', probe, value => hasAgentMarkerResponse(value, after), 90000);
  await observer.sample();
  const retainedResources = assertOriginalResourcesLive(setup.resources);
  await write('pre-stop-ownership.json', { nonce: control.nonce, retainedResources });
  await command('dispatchWebviewMessage', {
    type: 'webview/stopExecutionSession', payload: { kind: 'agent', nodeId: setup.nodeId }
  }, surface);
  const ended = await poll('Agent stop final state', snapshot, value => {
    const current = nodeOf(value, setup.nodeId);
    return current?.metadata?.agent?.liveSession === false && current.status === 'stopped' &&
      current.metadata.agent.terminalHistoryDiscarded === true;
  }, 60000);
  const settlement = await poll('reloaded Agent reader settlement', async () => {
    const events = await command('getDiagnosticEvents');
    return events.find(event => event.kind === 'runtime/terminalReadSettled' &&
      event.detail?.nodeId === setup.nodeId && event.detail.sessionId === setup.binding.runtimeSessionId &&
      event.detail.readId === reader.readId);
  }, event => event?.detail?.outcome?.kind === 'applied', 15000);
  await write('settlement-observation.json', {
    phase: 'verify', nonce: control.nonce, nodeId: setup.nodeId,
    reader: { readId: reader.readId, sessionId: reader.sessionId, authorityId: reader.authorityId },
    settlement: settlement.detail,
    runtime: await command('getRuntimeSupervisorState')
  });
  await poll('runtime binding removed', command.bind(null, 'getRuntimeSupervisorState'), value =>
    !value.bindings.some(binding => binding.nodeId === setup.nodeId));
  await observer.stop();
  const resourcesExited = await poll('original Agent resources exited', () => originalResourcesExited(setup.resources),
    value => value.pass, 10000);
  await write('verify.json', { phase: 'verify', nonce: control.nonce, pass: true, oldHost, node: nodeOf(ended, setup.nodeId),
    binding: setup.binding, provider: config.provider, rootOwner: config.rootOwner === true,
    supervisor: await readIdentity(setup.supervisor.pid), hello, reader, after,
    noNewExecution: true, retainedResources, resourcesExited, originalResourcesExited: resourcesExited.pass });
}

async function cleanup() {
  if (!observer) return;
  let failure;
  const receipt = { nonce: control.nonce, pass: false, fallback: [],
    resourceBaseline: control.setup ? 'setup' : control.startup ? 'startup' : 'missing' };
  const original = control.setup ?? control.startup;
  try {
    await command('resetState');
    receipt.runtime = await poll('product cleanup bindings removed', command.bind(null, 'getRuntimeSupervisorState'),
      value => value.bindings.length === 0 && value.pendingRuntimeSupervisorOperationCount === 0, 10000);
    receipt.nodesRemaining = (await snapshot()).state.nodes.filter(node => ['terminal', 'agent'].includes(node.kind)).length;
    assert.equal(receipt.nodesRemaining, 0);
    await observer.stop();
    receipt.resources = await poll('product cleanup original resources exited',
      () => originalResourcesExited(original?.resources), value => value.pass, 10000);
    const expected = original?.supervisor;
    const binding = original?.binding;
    assert(expected && binding, 'Only the recorded isolated Supervisor may be stopped.');
    const storage = path.resolve(binding.runtimeStoragePath);
    assert(config.permittedStorageRoots.some(root => {
      const relative = path.relative(path.resolve(root), storage);
      return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`));
    }), 'Supervisor storage must belong to this isolated test.');
    const paths = runtimePaths(binding);
    receipt.registry = await poll('isolated Supervisor registry empty', async () => JSON.parse(await fs.readFile(paths.registryPath, 'utf8')),
      value => Array.isArray(value.sessions) && value.sessions.length === 0, 10000);
    const hello = await rpc(paths.socketPath, 'hello');
    assert.equal(hello.pid, expected.pid);
    await assertRuntimeOwnerBinding(binding, hello);
    if (process.platform === 'win32') {
      receipt.supervisorActions = await observer.cleanupSupervisor(expected);
      await poll('isolated Supervisor retained handle exited', async () => {
        await observer.sample();
        return observer.result().entries.find(entry => entry.role === 'supervisor' && sameIdentity(expected, entry));
      }, value => Boolean(value && executionEnded(value)), 10000);
      assert(receipt.supervisorActions.every(action => ['already-exited', 'terminated-original-handle'].includes(action.action)));
    } else {
      assert(sameLiveIdentity(expected, await readIdentity(expected.pid)));
      process.kill(expected.pid, 'SIGTERM');
      await poll('isolated idle Supervisor exit', () => readIdentity(expected.pid), value => exitedIdentity(expected, value), 10000);
      receipt.supervisorActions = [{ action: 'owned-isolated-idle-supervisor-SIGTERM' }];
    }
  } catch (error) {
    failure = error;
    receipt.error = String(error);
    try {
      if (!observerReleased) receipt.fallback = await observer.cleanupKnownExecution();
    } catch (fallbackError) { receipt.fallbackError = String(fallbackError); }
  } finally {
    try { await releaseProcessObserver(); } catch (error) { failure ??= error; receipt.releaseError = String(error); }
    receipt.pass = !failure;
    await write('cleanup.json', receipt);
  }
  if (failure) throw failure;
}

async function pairPublish(name, value) {
  const file = path.join(artifacts, `pair-${name}.json`), pending = `${file}.pending-${process.pid}`;
  await fs.writeFile(pending, JSON.stringify(value), { flag: 'wx' });
  await fs.link(pending, file);
  await fs.unlink(pending);
}

async function pairWait(name) {
  return poll(`pair ${name}`, async () => {
    const failures = (await fs.readdir(artifacts)).filter(file => /^pair-.*-failure\.json$/.test(file));
    assert.deepEqual(failures, [], 'The other window must not fail.');
    try {
      const value = await read(`pair-${name}.json`);
      assert.notEqual(value.pass, false, 'The peer did not finish successfully.');
      return value;
    }
    catch (error) { if (error.code === 'ENOENT') return undefined; throw error; }
  }, Boolean, 180000);
}

function pairNode(state, sessionId) {
  return state.state.nodes.find(node => node.kind === 'agent' && node.metadata?.agent?.runtimeSessionId === sessionId);
}

function assertPairTopology(multi, single) {
  assert.notEqual(multi.host.pid, single.host.pid, 'Require two actual Extension Hosts.');
  for (const key of ['runtimeOwner', 'runtimeBackend', 'runtimeStoragePath', 'runtimeGuarantee']) {
    assert.deepEqual(single.binding[key], multi.binding[key], `Both new Agents must share ${key}.`);
  }
  assert(sameLiveIdentity(multi.supervisor, single.supervisor));
  assert.notEqual(multi.binding.runtimeSessionId, single.binding.runtimeSessionId, 'The second window must create a new Agent.');
  assert.notEqual(multi.reader.authorityId, single.reader.authorityId);
  for (const role of ['cli', 'provider']) {
    const first = multi.resources.filter(entry => entry.role === role), second = single.resources.filter(entry => entry.role === role);
    assert.equal(first.length, 1); assert.equal(second.length, 1);
    assert(!sameIdentity(first[0], second[0]), `Each new Agent requires its own ${role}.`);
  }
}

async function pairCapture(sessionId, expected, creatingRole) {
  const state = await poll('pair original live Agent', snapshot, value => {
    const node = pairNode(value, sessionId);
    return node?.metadata.agent.liveSession === true && node.metadata.agent.attachmentState === 'attached-live';
  }, 45000);
  const node = pairNode(state, sessionId);
  currentNodeId = node.id;
  await vscode.commands.executeCommand('devSessionCanvas.__internal.focusNode', node.id);
  await command('dispatchWebviewMessage', { type: 'webview/resizeNode', payload: {
    nodeId: node.id, position: node.position, size: { width: 960, height: 700 } } }, surface);
  const binding = Object.fromEntries(['runtimeOwner', 'runtimeBackend', 'runtimeStoragePath', 'runtimeSessionId',
    'runtimeGuarantee'].map(key => [key, node.metadata.agent[key]]));
  const hello = await rpc(runtimePaths(binding).socketPath, 'hello');
  await assertRuntimeOwnerBinding(binding, hello);
  const supervisor = await readIdentity(hello.pid);
  assert(supervisor && supervisor.startTicks);
  if (creatingRole) {
    await observer.addRoot(supervisor.pid, 'supervisor');
    await pairPublish(`${creatingRole}-owner`, { binding, supervisor });
  }
  const requestId = randomUUID();
  await command('dispatchWebviewMessage', { type: 'webview/attachExecutionSession', payload: {
    kind: 'agent', nodeId: node.id, executionSessionId: sessionId, requestId } }, surface);
  const reader = await mountedReader(node.id, { requestId, sessionId, authorityId: expected?.reader.authorityId });
  assert.equal(reader.sessionId, sessionId);
  assert(typeof reader.authorityId === 'string' && reader.authorityId.length > 0);
  assert(typeof reader.readId === 'string' && reader.readId.length > 0);
  if (expected) {
    assert.deepEqual(binding, expected.binding);
    assert(sameLiveIdentity(expected.supervisor, supervisor));
    assert.equal(reader.authorityId, expected.reader.authorityId);
    for (const resource of expected.resources) assert(sameLiveIdentity(resource, await readIdentity(resource.pid)),
      'The original Agent process must remain live.');
  }
  return { nodeId: node.id, binding, hello, supervisor, reader, host: await readIdentity(process.pid) };
}

async function pairTurn(subject, marker) {
  await pairCapture(subject.binding.runtimeSessionId, subject);
  await waitForAgentReady();
  await sendAgentTurn(currentNodeId, marker);
  await poll('pair real Agent nonce response', probe, value => hasAgentMarkerResponse(value, marker), 90000);
  return { marker, sessionId: subject.binding.runtimeSessionId, applied: true };
}

async function pairCreate(role, excluded = []) {
  const before = await snapshot(), ids = new Set(before.state.nodes.map(node => node.id));
  const group = before.state.groups?.find(entry => entry.role === 'workspace-root' &&
    entry.workspaceRootPath === config.workspacePath);
  if (role === 'multi') assert(group, 'Create through the actual multi-root A group.');
  const custom = [config.cli.entry, ...config.launchArguments].map(value => `'${String(value).replaceAll("'", "'\\''")}'`).join(' ');
  await command('dispatchWebviewMessage', { type: 'webview/createDemoNode', payload: {
    kind: 'agent', agentProvider: config.provider, agentLaunchPreset: 'custom', agentCustomLaunchCommand: custom,
    cwd: config.workspacePath, ...(group ? { targetGroupId: group.id,
      preferredPosition: { x: group.position.x + 40, y: group.position.y + 40 } } : {})
  } }, surface);
  const created = await poll('pair independently created Agent', snapshot, value => value.state.nodes.some(node =>
    !ids.has(node.id) && node.kind === 'agent' && node.metadata?.agent?.liveSession === true), 60000);
  const node = created.state.nodes.find(entry => !ids.has(entry.id) && entry.kind === 'agent');
  assert.equal(node.metadata.agent.persistenceMode, 'live-runtime');
  const subject = await pairCapture(node.metadata.agent.runtimeSessionId, undefined, role);
  await waitForAgentReady();
  await observer.sample();
  subject.resources = structuredClone(assertOriginalResourcesLive(undefined, excluded));
  const provider = subject.resources.find(entry => entry.role === 'provider');
  assert.equal(provider.ppid, subject.supervisor.pid);
  let ancestor = subject.resources.find(entry => entry.role === 'cli');
  for (let depth = 0; ancestor && ancestor.pid !== provider.pid && depth < 8; depth++) ancestor = await readIdentity(ancestor.ppid);
  assert(sameLiveIdentity(provider, ancestor), 'The new CLI must descend from its new original provider.');
  await pairPublish(`${role}-ownership`, subject);
  subject.interaction = await pairTurn(subject, `DSC_ROOT_PAIR_${role.toUpperCase()}_BEFORE_${control.nonce}`);
  const saved = await command('flushPersistedState');
  assert(saved.exists && !saved.lastError);
  await pairPublish(`${role}-created`, subject);
  return subject;
}

async function pairSwitchGallery(subject) {
  const roots = (await snapshot()).state.groups.filter(group => group.role === 'workspace-root').map(group => group.id);
  assert.equal(roots.length, 2);
  const observations = [];
  await command('clearDiagnosticEvents');
  for (const mode of ['paneGallery', 'rootGroups']) {
    await command('clearHostMessages');
    await vscode.workspace.getConfiguration('devSessionCanvas').update('canvas.multiRootPresentationMode', mode,
      vscode.ConfigurationTarget.Workspace);
    await poll(`pair ${mode} context`, () => command('getHostMessages'), messages => messages.some(message =>
      message.type === 'host/stateUpdated' && message.payload.runtime.multiRootPresentationMode === mode));
    // PaneGallery renders each root's contents without the composed root group frames.
    const rendered = await poll(`pair ${mode} rendered`, probe, value => roots.every(id =>
      value.groups.some(group => group.groupId === id) === (mode === 'rootGroups')));
    const current = await pairCapture(subject.binding.runtimeSessionId, subject);
    observations.push({ mode, binding: current.binding, reader: current.reader, rootFrames: rendered.groups.map(group => group.groupId) });
  }
  const starts = (await command('getDiagnosticEvents')).filter(event =>
    ['execution/startRequested', 'execution/started'].includes(event.kind));
  assert.deepEqual(starts, [], 'Presentation changes must not start an execution.');
  return observations;
}

async function pairStop(subject) {
  const current = await pairCapture(subject.binding.runtimeSessionId, subject);
  await command('dispatchWebviewMessage', { type: 'webview/stopExecutionSession', payload: {
    kind: 'agent', nodeId: current.nodeId } }, surface);
  await poll('pair Agent stop settled', async () => ({ state: await snapshot(), events: await command('getDiagnosticEvents'),
    runtime: await command('getRuntimeSupervisorState') }), value => {
    const node = nodeOf(value.state, current.nodeId);
    return node?.status === 'stopped' && node.metadata.agent.liveSession === false && node.metadata.agent.terminalHistoryDiscarded === true &&
      !value.runtime.bindings.some(binding => binding.nodeId === current.nodeId) && value.events.some(event =>
        event.kind === 'runtime/terminalReadSettled' && event.detail?.sessionId === current.binding.runtimeSessionId &&
        event.detail?.readId === current.reader.readId && event.detail?.outcome?.kind === 'applied');
  }, 30000);
  return poll('pair original Agent resources exited', () => originalResourcesExited(subject.resources), value => value.pass, 10000);
}

async function runRootWindowPair() {
  assert.equal(process.platform, 'linux'); assert.equal(config.provider, 'codex'); assert.equal(config.rootOwner, true);
  const role = vscode.workspace.workspaceFile?.fsPath === config.multiWorkspace ? 'multi' : 'single';
  phase = `pair-${role}`;
  let failure;
  try {
    const roots = (vscode.workspace.workspaceFolders ?? []).map(folder => folder.uri.fsPath);
    assert.deepEqual(roots, role === 'multi' ? [config.workspacePath, config.peerRoot]
      : [config.workspacePath]);
    const host = await readIdentity(process.pid);
    const launcher = await pairWait('launcher');
    let ancestor = host;
    for (let depth = 0; ancestor && ancestor.pid !== launcher.ui.pid && depth < 12; depth++) ancestor = await readIdentity(ancestor.ppid);
    assert(sameLiveIdentity(launcher.ui, ancestor), 'Both Hosts must belong to the original isolated application.');
    await pairPublish(`${role}-activation`, { host, roots });
    const extension = await activateVisibleExtension(vscode, 'devsessioncanvas.dev-session-canvas');
    await waitForCommand(vscode, 'devSessionCanvas.__test.getDebugState');
    const installedVsix = await captureInstalledExtensionReceipt(extension, config.installedVsixExpectation);
    await pairPublish(`${role}-environment`, { installedVsix, host, roots });
    await vscode.commands.executeCommand('devSessionCanvas.openCanvasInEditor');
    await command('waitForCanvasReady', surface, 30000);
    await startProcessObserver(extension);
    if (role === 'multi') {
      assert.equal((await snapshot()).state.nodes.filter(node => node.kind === 'agent').length, 0);
      const multi = await pairCreate(role);
      await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(config.workspacePath), { forceNewWindow: true });
      const single = await pairWait('single-created');
      assertPairTopology(multi, single);
      const gallery = await pairSwitchGallery(multi);
      const interaction = await pairTurn(multi, `DSC_ROOT_PAIR_MULTI_AFTER_${control.nonce}`);
      await pairPublish('multi-verified', { pass: true, gallery, interaction });
      await pairWait('single-verified');
    } else {
      const multi = await pairWait('multi-created');
      const inherited = await pairCapture(multi.binding.runtimeSessionId, multi);
      assert.notEqual(inherited.reader.readId, multi.reader.readId);
      await observer.addRoot(multi.supervisor.pid, 'supervisor');
      await observer.sample();
      assertOriginalResourcesLive(multi.resources);
      const single = await pairCreate(role, multi.resources);
      assertPairTopology(multi, single);
      await pairWait('multi-verified');
      const interaction = await pairTurn(single, `DSC_ROOT_PAIR_SINGLE_AFTER_${control.nonce}`);
      await pairCapture(multi.binding.runtimeSessionId, multi);
      await pairPublish('single-verified', { pass: true, interaction, multiSession: multi.binding.runtimeSessionId,
        singleSession: single.binding.runtimeSessionId });
      await pairWait('multi-finished');
      await poll('pair original multi Host exited', () => readIdentity(multi.host.pid), value => exitedIdentity(multi.host, value));
      // The surviving single has both A nodes; its save follows the stale multi Host's exit.
      const saved = await command('flushPersistedState');
      assert(saved.exists && !saved.lastError);
      const stopped = [];
      for (const subject of [multi, single]) stopped.push(await pairStop(subject));
      const registry = await poll('pair original registry empty', async () =>
        JSON.parse(await fs.readFile(runtimePaths(single.binding).registryPath, 'utf8')),
      value => Array.isArray(value.sessions) && value.sessions.length === 0);
      const runtime = await command('getRuntimeSupervisorState');
      assert.equal(runtime.bindings.length, 0); assert.equal(runtime.pendingRuntimeSupervisorOperationCount, 0);
      await pairPublish('cleanup', { pass: true, stopped, registry, runtime, forcedSignals: [] });
    }
  } catch (error) {
    failure = error;
    await pairPublish(`${role}-failure`, { error: String(error), stack: error.stack }).catch(() => {});
    try { await write(`pair-${role}-failure-webview-probe.json`, await probe()); } catch { /* Preserve the first failure. */ }
    try { await write(`pair-${role}-failure-host-messages.json`, await command('getHostMessages')); } catch { /* Preserve the first failure. */ }
    if (observer) await write(`pair-${role}-fallback.json`, { pass: false,
      actions: await observer.cleanupKnownExecution().catch(cleanupError => [{ error: String(cleanupError) }]) });
  } finally {
    try { await releaseProcessObserver(); } catch (error) { failure ??= error; }
    await pairPublish(`${role}-finished`, { pass: !failure }).catch(() => {});
    void vscode.commands.executeCommand('workbench.action.closeWindow').catch(() => {});
  }
  if (failure) throw failure;
}
