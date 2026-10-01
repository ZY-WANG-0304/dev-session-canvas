const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { constants } = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { stripVTControlCharacters } = require('node:util');
const vscode = require('vscode');
const { activateVisibleExtension, waitForCommand } = require('./test-helpers.cjs');
const { AgentProcessObserver, executionEnded } = require('./agent-candidate-process-observer.cjs');
const { hasLiveWindowsStartupChain } = require('./agent-candidate-windows-observer.cjs');
const { invokeCLI, buildClaudeCandidateArguments } = require('./agent-candidate-cli.cjs');
const { collectSnapshotEvidence, acceptsEmptySnapshotStop } = require('./agent-candidate-snapshot-evidence.cjs');
const { runEmptySnapshotReopen } = require('./agent-candidate-reopen.cjs');
const { resolveExecutionSessionSpawnSpec } = require('./agent-candidate-spawn-spec.cjs');
const { resolveLegacyRuntimeSupervisorPaths,
  resolveSystemdUserRuntimeSupervisorPaths } = require('./agent-candidate-runtime-paths.cjs');
const { assertRuntimeStorageContained } = require('./runtime-storage-containment.cjs');

const command = (name, ...args) => vscode.commands.executeCommand(`devSessionCanvas.__test.${name}`, ...args);
const snapshot = () => command('getDebugState');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const quote = value => `'${String(value).replaceAll("'", "'\\''")}'`;
let config;
let observer;
let nodeId;
let executionId;
let hello;
let naturalResponseVerified = false;
const actions = [];
const publicEnvironmentKeys = ['HOME', 'USERPROFILE', 'XDG_CONFIG_HOME', 'XDG_CACHE_HOME', 'XDG_STATE_HOME',
  'XDG_RUNTIME_DIR', 'TMPDIR', 'CODEX_HOME', 'CLAUDE_CONFIG_DIR'];
const writeJson = (name, value) => fs.writeFile(path.join(config.artifactDir, name), `${JSON.stringify(value, null, 2)}\n`);
const probe = () => command('captureWebviewProbe', config.surface, 10000);
const dispatch = (type, payload) => command('dispatchWebviewMessage', { type, payload }, config.surface);
const dom = action => command('performWebviewDomAction', action, config.surface, 10000);
const currentNode = state => state.state.nodes.find(node => node.id === nodeId);
const textOf = value => value.nodes.find(node => node.nodeId === nodeId)?.terminalVisibleLines?.join('\n') ?? '';

module.exports = { run };

async function poll(label, read, accept, timeoutMs = 30000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const value = await read();
    if (accept(value)) return value;
    if (observer?.error) throw new Error(observer.error);
    await sleep(50);
  }
  throw new Error(`Timed out: ${label}`);
}

function launchArguments(finalMessagePath) {
  const prompt = `Reply with exactly ${config.nonce} and nothing else. Do not use tools, read files, browse, or modify files.`;
  if (config.provider === 'codex') {
    assert.equal(config.codexIsolation.configuredServersVerifiedDisabled, true);
    const limited = config.codexIsolation.arguments;
    return config.lifecycle === 'natural'
      ? [...limited, '--no-daemon', '-a', 'never', 'exec', '--ephemeral', '--skip-git-repo-check', '--sandbox', 'read-only',
        '--color', 'never', '--json', '--output-last-message', finalMessagePath, prompt]
      : [...limited, '--no-daemon', '--no-alt-screen', '--sandbox', 'read-only', '-a', 'never'];
  }
  return buildClaudeCandidateArguments({ lifecycle: config.lifecycle,
    configurationArguments: claudeConfigurationArguments(), prompt });
}

function codexPath() {
  assert.equal(config.nodeInterpreter.version, 'v25.6.0');
  assert(path.isAbsolute(config.nodeInterpreter.entry));
  return `${path.dirname(config.nodeInterpreter.entry)}${path.delimiter}${process.env.PATH ?? ''}`;
}

async function run() {
  config = JSON.parse(await fs.readFile(process.env.DEV_SESSION_CANVAS_AGENT_CANDIDATE_CONFIG, 'utf8'));
  assert(['linux', 'darwin', 'win32'].includes(process.platform));
  if (config.stage === 'empty-snapshot-reopen') return runEmptySnapshotReopen({
    config, hostPid: process.pid, workspaceFolders: vscode.workspace.workspaceFolders?.map(folder => folder.uri.fsPath) ?? [],
    activate: async () => {
      await activateVisibleExtension(vscode, 'devsessioncanvas.dev-session-canvas');
      await waitForCommand(vscode, 'devSessionCanvas.__test.getDebugState');
    },
    command,
    openCanvas: () => vscode.commands.executeCommand(config.surface === 'editor'
      ? 'devSessionCanvas.openCanvasInEditor' : 'devSessionCanvas.openCanvasInPanel'),
    probe: id => poll('reopened Agent reader mounted', probe, value => value.nodes.some(node =>
      node.nodeId === id && node.terminalCols > 1 && node.terminalRows > 0)),
    assertBuffer: async (id, expectedLines) => {
      await dom({ kind: 'assertExecutionTerminalBuffer', nodeId: id, expectedLines });
      return true;
    },
    readJson: async file => JSON.parse(await fs.readFile(file, 'utf8')), writeJson
  });
  if (config.authOnly === true) return runAuthenticationOnly();
  assert(['codex', 'claude'].includes(config.provider));
  assert(['natural', 'stop'].includes(config.lifecycle));
  assert(['live-runtime', 'snapshot-only'].includes(config.mode));
  observer = new AgentProcessObserver(config.cli, config.smokeHostRoot, config.processObserver);
  let failure;
  let reopenRequired = false;
  let reopenHandoff;
  let reopenHandoffReady = false;
  try {
    await verifyAuthentication();
    await activateVisibleExtension(vscode, 'devsessioncanvas.dev-session-canvas');
    await waitForCommand(vscode, 'devSessionCanvas.__test.getDebugState');
    await command('resetState');
    await vscode.commands.executeCommand(config.surface === 'editor'
      ? 'devSessionCanvas.openCanvasInEditor' : 'devSessionCanvas.openCanvasInPanel');
    await command('waitForCanvasReady', config.surface, 20000);
    await command('clearHostMessages');
    await command('clearDiagnosticEvents');
    const finalMessagePath = path.join(config.artifactDir, 'codex-final-message.txt');
    const args = launchArguments(finalMessagePath);
    if (process.platform === 'win32') await observer.setLaunch(resolveExecutionSessionSpawnSpec({
      file: config.cli.entry, args, env: process.env }, 'win32'));
    const customLaunchCommand = [config.cli.entry, ...args].map(quote).join(' ');
    await writeJson('launch.json', { ...config, command: config.cli.entry, args, customLaunchCommand,
      hostPid: process.pid, hostExecutable: process.execPath, hostVersions: process.versions, vscode: vscode.version,
      environment: Object.fromEntries(publicEnvironmentKeys.filter(key => process.env[key] !== undefined)
        .map(key => [key, process.env[key]])),
      environmentScope: 'Explicit non-secret directory references only; no environment dump or credentials.',
      stopStrategy: config.provider === 'codex' ? 'interrupt-then-hangup' : 'hangup' });
    await observer.addRoot(process.pid, 'host');
    observer.start();
    actions.push({ at: Date.now(), type: 'create-real-agent', requestedModelTurns: config.lifecycle === 'natural' ? 1 : 0 });
    await command('createNode', 'agent', config.provider, { agentLaunchPreset: 'custom',
      agentCustomLaunchCommand: customLaunchCommand, cwdOverride: config.workspacePath });
    const created = await poll('Agent node created', snapshot,
      state => state.state.nodes.some(node => node.kind === 'agent'));
    nodeId = created.state.nodes.find(node => node.kind === 'agent').id;
    await dispatch('webview/resizeNode', { nodeId, position: currentNode(created).position,
      size: { width: 900, height: 680 } });
    const active = await poll('real Agent live identity', snapshot, state => {
      const metadata = currentNode(state)?.metadata.agent;
      if (metadata?.lastRuntimeError) throw new Error(`Agent startup failed: ${metadata.lastRuntimeError}`);
      return metadata?.liveSession === true;
    });
    assert.equal(currentNode(active).metadata.agent.persistenceMode, config.mode);
    if (config.mode === 'live-runtime') {
      const metadata = currentNode(active).metadata.agent;
      await assertRuntimeStorageContained(metadata.runtimeStoragePath, config.permittedStorageRoots, process.platform);
      hello = await readHello(metadata);
      assert(hello.capabilities?.executionCandidateProfiles?.includes(process.platform === 'darwin'
        ? 'macos-owner-v1-candidate' : process.platform === 'win32'
          ? 'windows-owner-v1-candidate' : 'linux-owner-v1-candidate'));
      await observer.addRoot(hello.pid, 'supervisor');
    }
    await poll('real xterm reader mounted', probe, value => value.nodes.some(node =>
      node.nodeId === nodeId && node.terminalCols >= 64));
    const messages = await command('getHostMessages');
    const initial = messages.findLast(message => message.type === 'host/executionSnapshot' &&
      message.payload.nodeId === nodeId && message.payload.executionSessionId);
    assert(initial, 'Actual Agent reader must supply the execution identity.');
    executionId = initial.payload.executionSessionId;
    if (config.mode === 'live-runtime') assert.equal(executionId, currentNode(active).metadata.agent.runtimeSessionId);
    if (config.lifecycle === 'stop') await interactAndStop();
    const ended = await poll('Agent final product state', snapshot, state => {
      const node = currentNode(state);
      return node?.metadata.agent.liveSession === false && ['stopped', 'error'].includes(node.status) &&
        (config.mode !== 'live-runtime' || node.metadata.agent.terminalHistoryDiscarded === true);
    }, config.lifecycle === 'natural' ? 120000 : 30000);
    assert.equal(currentNode(ended).status, 'stopped');
    if (config.lifecycle === 'natural') {
      assert.equal(currentNode(ended).status, 'stopped');
      assert.equal(currentNode(ended).metadata.agent.lastExitCode, 0);
      assert.equal(currentNode(ended).metadata.agent.lastRuntimeError, undefined);
    }
    await poll('same Agent reader settled', () => command('getDiagnosticEvents'), events =>
      events.some(event => matchesSettlement(event)));
    const sourceEvents = await command('getDiagnosticEvents');
    const sourceEvent = sourceEvents.find(event => event.kind === 'runtime/terminalSourceDisposition' &&
      event.detail?.nodeId === nodeId &&
      (event.detail.executionSessionId === executionId || event.detail.sessionId === executionId));
    assert(sourceEvent, 'Agent completion must expose the sealed source disposition.');
    if (config.lifecycle === 'natural') {
      assert.equal(sourceEvent.detail.sourceDisposition?.kind, 'eof',
        'Natural Agent completion requires actual source EOF, not process exit alone.');
    }
    const saved = await command('flushPersistedState');
    assert(saved.exists && saved.snapshot?.state);
    const savedNode = saved.snapshot.state.nodes.find(node => node.id === nodeId);
    assert.equal(savedNode.metadata.agent.liveSession, false);
    if (config.mode === 'live-runtime') {
      assert.equal(savedNode.metadata.agent.terminalHistoryDiscarded, true);
      for (const key of ['terminalStream', 'serializedTerminalState', 'recentOutput', 'runtimeSessionId', 'pendingLaunch']) {
        assert.equal(savedNode.metadata.agent[key], undefined, `Completed Agent must not retain ${key}.`);
      }
      assert(Buffer.byteLength(JSON.stringify(savedNode)) < 16384);
    } else {
      let snapshotEvidence;
      if (config.lifecycle === 'stop') {
        try {
          snapshotEvidence = await collectSnapshotEvidence({ savedNode, nodeId, executionId,
            messages: await command('getHostMessages'), events: await command('getDiagnosticEvents'),
            helpProbe: JSON.parse(await fs.readFile(path.join(config.artifactDir, 'help-probe.json'), 'utf8')),
            finalProbe: await probe(),
            assertBuffer: async expectedLines => {
              await dom({ kind: 'assertExecutionTerminalBuffer', nodeId, expectedLines });
              return true;
            } });
        } catch {
          snapshotEvidence = { schemaVersion: 1, replayComplete: false, replayReason: 'evidence-inputs-unavailable',
            pageProjectionIndependence: 'not-proven' };
        }
        await writeJson('snapshot-evidence.json', snapshotEvidence);
      }
      if (config.lifecycle === 'stop' && savedNode.metadata.agent.serializedTerminalState?.data === '') {
        assert(acceptsEmptySnapshotStop({ ...config, savedNode, evidence: snapshotEvidence }),
          'Empty snapshot-only stop requires complete output, reader, saved-state and page evidence.');
        reopenRequired = true;
      } else assert(savedNode.metadata.agent.serializedTerminalState?.data);
      const settlements = await command('getDiagnosticEvents');
      assert(settlements.some(event => matchesSettlement(event) &&
        event.detail.outcome.finalOutputSequence === savedNode.metadata.agent.outputSequence));
    }
    const finalMessages = await command('getHostMessages');
    const raw = collectOutput(finalMessages);
    await fs.writeFile(path.join(config.artifactDir, 'host-received-output.txt'), raw);
    if (config.lifecycle === 'natural') {
      await verifyNaturalResponse(raw, finalMessagePath);
      naturalResponseVerified = true;
    }
    await poll('owned CLI and wrapper no longer execute', async () => {
      await observer.sample();
      return observer.result();
    }, result => result.entries.some(entry => entry.role === 'cli') &&
      result.entries.filter(entry => ['cli', 'wrapper', 'provider'].includes(entry.role))
        .every(executionEnded));
    assert.equal(observer.failures.length, 0, 'Wrapper must not finish while the actual CLI remains live.');
    if (config.provider === 'codex') assert(observer.result().entries.some(entry => entry.role === 'wrapper'),
      'The installed npm wrapper must be observed, not replaced with a direct native launch.');
    if (process.platform === 'win32') {
      const entries = observer.result().entries;
      assert.equal(entries.filter(entry => entry.role === 'provider').length, 1);
      assert.equal(entries.filter(entry => entry.role === 'wrapper' && entry.wrapperKind === 'cmd').length, 1);
      assert.equal(entries.filter(entry => entry.role === 'wrapper' && entry.wrapperKind === 'node').length,
        config.provider === 'codex' ? 1 : 0);
      const subjects = entries.filter(entry => entry.role === 'cli');
      assert.equal(subjects.length, 1, 'The installed native Agent subject must be observed.');
      if (config.lifecycle === 'natural') assert.equal(subjects[0].exitCode, 0);
    }
    await archive('completed', { node: currentNode(ended), savedNode, hello, executionId,
      resultKind: config.lifecycle === 'natural' ? 'natural-completion' : 'explicit-product-stop',
      sourceEofClaim: config.lifecycle === 'natural' ? 'requires product source evidence; not inferred from exit' : false });
    if (reopenRequired) reopenHandoff = { schemaVersion: 1, originalChecksPassed: true,
      hostPid: process.pid, nodeId, workspacePath: config.workspacePath, userDataDir: config.userDataDir,
      runtimeDir: config.runtimeDir,
      snapshotPath: saved.snapshotPath, readerFrameId: initial.lifecycle.frameId,
      savedState: savedNode.metadata.agent.serializedTerminalState, outputSequence: savedNode.metadata.agent.outputSequence };
  } catch (error) {
    failure = error;
    await archive('first-failure', { error: String(error), stack: error.stack, nodeId, executionId, hello });
  } finally {
    try {
      try {
        if (!reopenHandoff || failure) await command('resetState');
        await observer.sample();
        await writeJson('cleanup.json', { runtime: await command('getRuntimeSupervisorState'),
          snapshot: await snapshot(), process: observer.result(), forcedSignals: [],
          completedNodePreservedForReopen: !!reopenHandoff && !failure });
      } catch (error) {
        failure ??= error;
        await writeJson('product-cleanup-failure.json', { error: String(error) });
      }
      await observer.stop();
      const remaining = observer.result().entries.filter(entry => ['cli', 'wrapper', 'provider'].includes(entry.role) &&
        !executionEnded(entry));
      if (remaining.length) {
        failure ??= new Error('Product cleanup left owned Agent resources live.');
        const forcedSignals = await observer.cleanupKnownExecution();
        const deadline = Date.now() + 2000;
        while (Date.now() < deadline) {
          await observer.sample();
          if (!observer.result().entries.some(entry => ['cli', 'wrapper', 'provider'].includes(entry.role) &&
            !executionEnded(entry))) break;
          await sleep(25);
        }
        await writeJson('remaining-resources.json', { remaining, forcedSignals, after: observer.result() });
      }
    } catch (error) { failure ??= error; }
    finally {
      try { await observer.dispose?.(); }
      catch (error) { failure ??= error; }
    }
    if (observer.error) failure ??= new Error(observer.error);
    if (observer.failures.length) failure ??= new Error('Process observation or wrapper lifecycle verification failed.');
    if (reopenHandoff && !failure) {
      try {
        await writeJson('reopen-handoff.json', reopenHandoff);
        reopenHandoffReady = true;
      } catch (error) { failure ??= error; }
    }
    if (reopenHandoff && failure) {
      try {
        await command('resetState');
        await writeJson('cleanup.json', { runtime: await command('getRuntimeSupervisorState'),
          snapshot: await snapshot(), process: observer.result(), forcedSignals: [], completedNodePreservedForReopen: false });
      } catch (error) {
        await writeJson('product-cleanup-failure.json', { error: String(error) });
      }
    }
    await writeJson('process-observations.json', observer.result());
    await writeJson('actions.json', actions);
    await writeJson('result.json', { name: config.name, pass: !failure, error: failure ? String(failure) : undefined,
      plannedModelTurns: config.lifecycle === 'natural' ? 1 : 0,
      cliObserved: observer.result().entries.some(entry => entry.role === 'cli'), naturalResponseVerified,
      reopenRequired, reopenHandoffReady,
      modelRequestCount: 'not observed directly', automaticHarnessRetries: 0,
      scope: `Actual ${process.platform} Agent CLI + candidate owner + Webview; not A3 large-tail or A5 acceptance.` });
  }
  if (failure) throw failure;
}

async function verifyAuthentication() {
  const customCodex = config.backend === 'deepseek' && config.provider === 'codex';
  const args = config.provider === 'codex' ? (customCodex ? ['features', 'list'] : ['login', 'status'])
    : [...claudeConfigurationArguments(), '--safe-mode', 'auth', 'status', '--json'];
  const result = invokeCLI(resolveExecutionSessionSpawnSpec, config.cli.entry, args, { encoding: 'utf8', timeout: 10000,
    ...(config.provider === 'codex' ? { env: { ...process.env, PATH: codexPath() } } : {}) });
  const combined = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  if (customCodex) {
    await writeJson('auth-status.json', { exitCode: result.status, configurationParsed: result.status === 0,
      authenticationMode: 'deepseek-provider-config', networkAuthenticationVerified: false,
      credentialContentsRecorded: false });
    assert.equal(result.status, 0, 'DeepSeek provider configuration must parse in the actual Host.');
    return;
  }
  const loggedIn = config.provider === 'codex' ? /Logged in/.test(combined)
    : (() => { try { return JSON.parse(result.stdout).loggedIn === true; } catch { return false; } })();
  await writeJson('auth-status.json', { exitCode: result.status, loggedIn, networkAuthenticationVerified: false,
    credentialContentsRecorded: false });
  assert(result.status === 0 && loggedIn, 'Saved CLI authentication unavailable under directory-reference isolation.');
}

function claudeConfigurationArguments() {
  if (config.backend !== 'deepseek') return [];
  assert(path.isAbsolute(config.claudeSettingsPath), 'DeepSeek requires its private Claude settings file.');
  return ['--settings', config.claudeSettingsPath];
}

function safeProcessResult(result) {
  const text = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  const classes = [];
  for (const [name, pattern] of [
    ['not-logged-in', /not logged in/i], ['permission-denied', /permission denied|EACCES/],
    ['missing-path', /no such file|ENOENT/], ['missing-module', /cannot find module|MODULE_NOT_FOUND/],
    ['configuration-error', /error (?:loading|parsing|reading)|failed to (?:load|parse|read).*config/i],
    ['missing-environment', /(?:environment variable|env var|env_key).*(?:not set|missing|not found|required)/is],
    ['unsupported-option', /unknown (?:option|argument)|unrecognized (?:option|argument)|bad option/i],
    ['node-option-error', /NODE_OPTIONS|not allowed in NODE_OPTIONS/],
    ['keyring-error', /keyring|credential store|keychain/i]
  ]) if (pattern.test(text)) classes.push(name);
  if (result.status !== 0 && !classes.length) classes.push('unclassified-failure');
  return { exitCode: result.status, signal: result.signal,
    errorCode: /^[A-Z][A-Z0-9_]{0,63}$/.test(result.error?.code ?? '') ? result.error.code : undefined,
    timedOut: result.error?.code === 'ETIMEDOUT', classes, rawOutputRecorded: false };
}

async function runAuthenticationOnly() {
  const invoke = (entry, args) => spawnSync(entry, args, { encoding: 'utf8', timeout: 10000, maxBuffer: 1024 * 1024 });
  const environment = Object.fromEntries(publicEnvironmentKeys.filter(key => process.env[key] !== undefined)
    .map(key => [key, process.env[key]]));
  const authReferenceMatches = Object.fromEntries(Object.entries(config.expectedAuthReferences)
    .map(([key, value]) => [key, process.env[key] === value]));
  const electronSwitches = Object.fromEntries(['ELECTRON_RUN_AS_NODE', 'ELECTRON_NO_ASAR',
    'ELECTRON_NO_ATTACH_CONSOLE', 'ELECTRON_ENABLE_LOGGING', 'ELECTRON_ENABLE_STACK_DUMPING']
    .map(key => [key, process.env[key] === undefined ? { present: false }
      : { present: true, value: /^(?:0|1|true|false)$/.test(process.env[key]) ? process.env[key] : 'other' }]));
  let nodePath;
  for (const directory of (process.env.PATH ?? '').split(path.delimiter).filter(Boolean)) {
    const candidate = path.resolve(directory, 'node');
    try { await fs.access(candidate, constants.X_OK); nodePath = { path: candidate, realpath: await fs.realpath(candidate) }; break; }
    catch (error) { if (!['ENOENT', 'EACCES', 'ENOTDIR'].includes(error.code)) throw error; }
  }
  const nodeResult = invoke('/usr/bin/env', ['node', '-e',
    'process.stdout.write(JSON.stringify({executable:process.execPath,version:process.version,electron:process.versions.electron??null}))']);
  let nodeIdentity;
  try {
    const value = JSON.parse(nodeResult.stdout);
    if (typeof value.executable === 'string' && path.isAbsolute(value.executable) &&
      !/[\r\n\0]/.test(value.executable) && /^v\d+\.\d+\.\d+$/.test(value.version) &&
      (value.electron === null || /^\d+\.\d+\.\d+$/.test(value.electron))) {
      nodeIdentity = { executable: value.executable, version: value.version, electron: value.electron };
    }
  } catch {}
  await writeJson('auth-host-environment.json', { hostExecutable: process.execPath, cwd: process.cwd(),
    versions: { node: process.versions.node, electron: process.versions.electron }, environment,
    authReferenceMatches, nodeOptionsPresent: process.env.NODE_OPTIONS !== undefined, electronSwitches,
    wrapperInterpreter: { invocation: '/usr/bin/env node', pathLookup: nodePath,
      ...safeProcessResult(nodeResult), identity: nodeIdentity }, credentialContentsRecorded: false });
  const checks = [];
  for (const provider of ['codex', 'claude']) {
    const cli = config.cliCandidates[provider];
    const versionResult = invoke(cli.entry, ['--version']);
    const versionPattern = provider === 'codex' ? /^codex-cli \d+\.\d+\.\d+$/ : /^\d+\.\d+\.\d+ \(Claude Code\)$/;
    const version = (versionResult.stdout ?? '').trim();
    const result = invoke(cli.entry, provider === 'codex' ? ['login', 'status'] : ['--safe-mode', 'auth', 'status', '--json']);
    const text = `${result.stdout ?? ''}${result.stderr ?? ''}`;
    const loggedIn = provider === 'codex' ? /Logged in/.test(text)
      : (() => { try { return JSON.parse(result.stdout).loggedIn === true; } catch { return false; } })();
    const check = { provider, cli, version: { ...safeProcessResult(versionResult),
      summary: versionPattern.test(version) ? version : undefined },
      authentication: { ...safeProcessResult(result), loggedIn, credentialContentsRecorded: false } };
    checks.push(check);
    await writeJson(`${provider}-auth-status.json`, check);
  }
  const pass = checks.every(check => check.authentication.exitCode === 0 && check.authentication.loggedIn &&
    check.version.exitCode === 0 && check.version.summary === check.cli.version);
  const result = { scope: 'Real Host authentication diagnosis only; not A4 product acceptance', pass,
    requestedModelTurns: 0, executionNodesCreated: 0, automaticHarnessRetries: 0, checks };
  await writeJson('result.json', result);
  if (!pass) {
    await writeJson('first-failure.json', { scope: result.scope,
      failedProviders: checks.filter(check => check.authentication.exitCode !== 0 || !check.authentication.loggedIn ||
        check.version.exitCode !== 0 || check.version.summary !== check.cli.version).map(check => check.provider),
      requestedModelTurns: 0, automaticHarnessRetries: 0 });
    throw new Error('Real Host auth-only inspection failed; sanitized evidence retained.');
  }
}

async function readHello(metadata) {
  const paths = metadata.runtimeBackend === 'systemd-user'
    ? resolveSystemdUserRuntimeSupervisorPaths(metadata.runtimeStoragePath)
    : resolveLegacyRuntimeSupervisorPaths(metadata.runtimeStoragePath);
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(paths.socketPath);
    let data = '';
    const timer = setTimeout(() => finish(new Error('Bound Supervisor hello timed out.')), 3000);
    const finish = (error, result) => { clearTimeout(timer); socket.destroy(); error ? reject(error) : resolve(result); };
    socket.once('error', error => finish(error));
    socket.once('connect', () => socket.write(`${JSON.stringify({ type: 'request', id: 'a4-owner', method: 'hello' })}\n`));
    socket.on('data', chunk => {
      data += chunk.toString();
      if (data.length > 16384) return finish(new Error('Unexpected oversized hello response.'));
      const end = data.indexOf('\n');
      if (end < 0) return;
      try {
        const response = JSON.parse(data.slice(0, end));
        assert(response.ok && response.id === 'a4-owner' && Number.isSafeInteger(response.result?.pid));
        finish(undefined, response.result);
      } catch (error) { finish(error); }
    });
  });
}

async function interactAndStop() {
  const seenPrompts = new Set();
  const readyDeadline = Date.now() + 45000;
  await poll('real CLI interactive readiness', async () => {
    const value = await probe();
    const text = textOf(value);
    for (const [name, pattern] of [['workspace-trust', /(?:Yes, I trust|Do you trust|Trust this (?:folder|directory))/i],
      ['theme', /(?:Choose the text style|Choose.*theme|Select.*theme)/i],
      ['claude-api-key', /Detected a custom API key[\s\S]*Do you want to use this API key/i],
      ['claude-login-method', /Select login method:[\s\S]*Claude account with subscription/i],
      ['update', /Update available.*\n[\s\S]*\b1\.\s*Update now[\s\S]*\b2\.\s*Skip/i]]) {
      if (pattern.test(text) && !seenPrompts.has(name)) {
        seenPrompts.add(name);
        actions.push({ at: Date.now(), type: 'accept-empty-workspace-setup', prompt: name });
        // Select the second entry explicitly; Escape continues the default update action.
        await dom({ kind: 'sendExecutionInput', nodeId, data: name === 'update' ? '\x1b[B\r' : '\r' });
        return '';
      }
    }
    if (process.platform === 'win32') await observer.sample();
    return text;
  }, text => Date.now() < readyDeadline && /(?:codex|claude)/i.test(text) &&
    (/(?:help|shortcuts|ask|prompt|Try|Send)/i.test(text) || /›\s*\[/i.test(text)) &&
    (process.platform !== 'win32' || hasLiveWindowsStartupChain(observer.result(), config.provider, config.mode)), 45000);
  const readyProbe = await probe();
  // Keep the stop matrix focused on resize, product stop, tail settlement and
  // cleanup; provider-specific help/setup screens are recorded but not a gate.
  actions.push({ at: Date.now(), type: 'help-skipped', reason: 'provider-interactive-surface-not-contract' });
  await writeJson('help-probe.json', readyProbe);
  const prior = (await probe()).nodes.find(node => node.nodeId === nodeId);
  const state = await snapshot();
  actions.push({ at: Date.now(), type: 'resize', width: 780, height: 560 });
  await dispatch('webview/resizeNode', { nodeId, position: currentNode(state).position,
    size: { width: 780, height: 560 } });
  await poll('actual xterm resize', probe, value => {
    const current = value.nodes.find(node => node.nodeId === nodeId);
    return current?.terminalCols > 0 && current.terminalCols !== prior.terminalCols;
  });
  actions.push({ at: Date.now(), type: 'product-stop', expectedStrategy:
    config.provider === 'codex' ? 'interrupt-then-hangup' : 'hangup' });
  await dispatch('webview/stopExecutionSession', { kind: 'agent', nodeId });
}

function matchesSettlement(event) {
  const detail = event.detail;
  if (detail?.nodeId !== nodeId) return false;
  const correctIdentity = config.mode === 'live-runtime'
    ? event.kind === 'runtime/terminalReadSettled' && detail.sessionId === executionId
    : event.kind === 'execution/localTerminalReaderSettled' && detail.executionSessionId === executionId;
  return correctIdentity && detail.outcome?.kind === 'applied';
}

function collectOutput(messages) {
  const pages = new Map();
  const chunks = new Map();
  let checkpoint = '';
  let checkpointRevision = -1;
  for (const message of messages) {
    const payload = message.payload;
    if (payload?.nodeId !== nodeId || (payload.executionSessionId && payload.executionSessionId !== executionId)) continue;
    if (message.type === 'host/executionTerminalPage') {
      for (const event of payload.page?.events ?? []) if (event.type === 'output') pages.set(event.revision, event.data);
    } else if (message.type === 'host/executionOutput') chunks.set(payload.outputSequence, payload.chunk);
    else if (message.type === 'host/executionSnapshot') {
      const candidate = payload.serializedTerminalState ?? payload.terminalRead?.checkpoint?.serializedState;
      if (candidate && checkpointRevision < 0) {
        checkpoint = candidate.data;
        checkpointRevision = payload.terminalRead?.checkpoint?.revision ?? candidate.outputSequence ?? 0;
      }
    }
  }
  const body = config.mode === 'live-runtime' ? pages : chunks;
  return checkpoint + [...body.entries()].filter(([revision]) => revision > checkpointRevision)
    .sort(([a], [b]) => a - b).map(([, text]) => text).join('');
}

async function verifyNaturalResponse(raw, finalMessagePath) {
  const lines = stripVTControlCharacters(raw).split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const records = lines.flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
  assert(records.length, 'Actual CLI output must include machine-readable records.');
  if (config.provider === 'codex') {
    assert.equal((await fs.readFile(finalMessagePath, 'utf8')).trim(), config.nonce);
    assert(records.some(record => record.type === 'turn.completed'), 'Codex must complete its real turn.');
    assert(records.some(record => record.item?.type === 'agent_message' && record.item.text?.trim() === config.nonce));
    const knownConfigurationWarning = 'Codex is ignoring 1 unrecognized configuration setting. Check for typos or deprecated settings.\n'
      + `  user (${path.join(process.env.CODEX_HOME, 'config.toml')}): \`disable_response_storage\` is ignored.`;
    assert(!records.some(record => record.type === 'turn.failed' || record.type === 'error' ||
      (record.item?.type && !['agent_message', 'reasoning'].includes(record.item.type) &&
        !(record.item.type === 'error' && record.item.message === knownConfigurationWarning))),
    'The fixed Codex task must not fail or invoke tools.');
    await writeJson('configuration-warnings.json', records.filter(record => record.item?.type === 'error'));
  } else {
    const result = records.find(record => record.type === 'result');
    assert(result && result.is_error === false && result.subtype === 'success');
    assert.equal(result.result?.trim(), config.nonce);
    assert.equal(result.num_turns, 1);
  }
  await dom({ kind: 'scrollTerminalViewport', nodeId, lines: -100000 });
  const rendered = [];
  let previousViewport = -1;
  for (let index = 0; index < 16; index += 1) {
    const value = await probe();
    const terminal = value.nodes.find(node => node.nodeId === nodeId);
    if (!terminal || terminal.terminalViewportY === previousViewport) break;
    previousViewport = terminal.terminalViewportY;
    rendered.push({ viewportY: previousViewport, lines: terminal.terminalVisibleLines });
    await dom({ kind: 'scrollTerminalViewport', nodeId, lines: Math.max(1, terminal.terminalRows - 1) });
  }
  await writeJson('response-records.json', records);
  await writeJson('response-page.json', rendered);
  assert(rendered.some(page => page.lines?.join('').includes(config.nonce)), 'The actual Webview must render the CLI response.');
}

async function archive(prefix, extra) {
  await writeJson(`${prefix}.json`, extra);
  for (const [name, read] of [['snapshot', snapshot], ['probe', probe], ['events', () => command('getDiagnosticEvents')],
    ['messages', () => command('getHostMessages')], ['runtime', () => command('getRuntimeSupervisorState')]]) {
    try { await writeJson(`${prefix}-${name}.json`, await read()); }
    catch (error) { await writeJson(`${prefix}-${name}-error.json`, { error: String(error) }); }
  }
  await writeJson(`${prefix}-process.json`, observer.result());
}
