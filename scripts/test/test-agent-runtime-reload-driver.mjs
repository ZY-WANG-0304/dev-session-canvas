import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import ts from 'typescript';
import contract from '../../tests/vscode-smoke/runtime-reload-contract.cjs';
import windows from '../../tests/vscode-smoke/agent-candidate-windows-observer.cjs';
import processObserver from '../../tests/vscode-smoke/agent-candidate-process-observer.cjs';
import cliHelpers from '../../tests/vscode-smoke/agent-candidate-cli.cjs';
import storageContainment from '../../tests/vscode-smoke/runtime-storage-containment.cjs';
import { createDeepSeekConfiguration } from '../smoke/agent-candidate-deepseek.mjs';

const source = await fs.readFile('tests/vscode-smoke/agent-runtime-reload-driver.cjs', 'utf8');
const ast = ts.createSourceFile('agent-runtime-reload-driver.cjs', source, ts.ScriptTarget.Latest, true);
const functions = new Map(ast.statements.filter(ts.isFunctionDeclaration).map(node => [node.name.text, node.getText(ast)]));
const resourceFunctions = ['startProcessObserver', 'releaseProcessObserver', 'assertOriginalResourcesLive', 'originalResourcesExited',
  'assertRuntimeOwnerBinding', 'captureSetupProcessObservation', 'recordStartupOwnership'];
const compile = (names, context) => new Function(...Object.keys(context),
  `${names.map(name => functions.get(name)).join('\n')}\nreturn { ${names.join(',')} };`)(...Object.values(context));
const launcherSource = await fs.readFile('scripts/smoke/run-vscode-agent-runtime-reload-candidate.mjs', 'utf8');
const launcherAst = ts.createSourceFile('reload-launcher.mjs', launcherSource, ts.ScriptTarget.Latest, true);
const configureSource = launcherAst.statements.find(node => ts.isFunctionDeclaration(node) &&
  node.name.text === 'configureWindowsReloadWorkspace').getText(launcherAst);
const configureFor = (platform, filesystem = fs, paths = path) => new Function('assert', 'fs', 'path', 'process',
  `${configureSource}\nreturn configureWindowsReloadWorkspace;`)(assert, filesystem, paths, { platform });
const launchFunctions = ['selectAgentReloadProvider', 'buildAgentReloadLaunchArguments', 'assertRootWindowPairSelection'];
const launchApi = new Function('assert', 'path', 'cliHelpers', launcherAst.statements.filter(node =>
  ts.isFunctionDeclaration(node) && launchFunctions.includes(node.name.text)).map(node => node.getText(launcherAst)).join('\n') +
  `\nreturn { ${launchFunctions.join(',')} };`)(assert, path, cliHelpers);
const ownershipBundle = await build({ entryPoints: ['extensions/vscode/dev-session-canvas/src/common/runtimeRootOwnership.ts'],
  bundle: true, platform: 'node', format: 'cjs', write: false, logLevel: 'silent' });
const ownershipModule = { exports: {} };
new Function('require', 'module', 'exports', ownershipBundle.outputFiles[0].text)(
  createRequire(import.meta.url), ownershipModule, ownershipModule.exports);
const ownership = ownershipModule.exports;
const identity = (pid, role, parent = 0, wrapperKind) => ({ pid, ppid: parent, startTicks: `win32:${pid}00`,
  executable: `/isolated/${role}-${pid}.exe`, role, wrapperKind, firstPpid: parent,
  firstParentStartTicks: parent ? `win32:${parent}00` : null, platform: 'win32', active: true,
  observationUnknown: false, hasExited: false, exitConfirmed: false, exitCode: null });
const ended = entry => ({ ...entry, active: false, hasExited: true, exitConfirmed: true, exitCode: 0 });
const chain = () => [identity(10, 'host'), identity(20, 'supervisor'), identity(30, 'provider', 20),
  identity(40, 'wrapper', 30, 'cmd'), identity(50, 'wrapper', 40, 'node'), identity(60, 'cli', 50)];
const resources = entries => entries.filter(entry => ['cli', 'wrapper', 'provider'].includes(entry.role));

test('reload provider selection preserves Codex default and rejects unrecognized providers', () => {
  assert.equal(launchApi.selectAgentReloadProvider(), 'codex');
  assert.equal(launchApi.selectAgentReloadProvider('claude'), 'claude');
  for (const provider of ['', 'all', 'other']) assert.throws(() => launchApi.selectAgentReloadProvider(provider));
});

test('the explicit root window pair is fixed to Linux x64 Codex and leaves default reload selection unchanged', () => {
  const selected = { 'root-window-pair': true, 'root-owner': true, provider: 'codex' };
  launchApi.assertRootWindowPairSelection(selected, 'linux', 'x64');
  for (const [platform, arch, changes] of [['darwin', 'arm64', {}], ['win32', 'x64', {}], ['linux', 'arm64', {}],
    ['linux', 'x64', { provider: 'claude' }], ['linux', 'x64', { 'root-owner': false }]]) {
    assert.throws(() => launchApi.assertRootWindowPairSelection({ ...selected, ...changes }, platform, arch));
    launchApi.assertRootWindowPairSelection({ ...selected, ...changes, 'root-window-pair': false }, platform, arch);
  }
  assert.match(launcherSource, /extensionDevelopmentPath: rootWindowPair \? \[\] : driverRoot/);
  assert(launcherSource.indexOf("name: 'agent-runtime-reload-driver'") < launcherSource.indexOf('await installCandidateVsix('));
});

test('fixed pair topology rejects attach-only, changed owner and replacement startup identities', () => {
  const resource = (pid, role) => ({ pid, ppid: 20, startTicks: String(pid * 10), executable: `/fixture/${role}`, state: 'S', role });
  const multi = { host: resource(10, 'host'), binding: { runtimeOwner: { root: 'A' }, runtimeBackend: 'legacy-detached',
    runtimeStoragePath: '/private/storage', runtimeGuarantee: 'best-effort', runtimeSessionId: 'multi' },
    supervisor: resource(20, 'supervisor'), reader: { sessionId: 'multi', authorityId: 'multi-authority' },
    resources: [resource(30, 'provider'), resource(40, 'cli')] };
  const single = { ...structuredClone(multi), host: resource(11, 'host'),
    binding: { ...structuredClone(multi.binding), runtimeSessionId: 'single' },
    reader: { sessionId: 'single', authorityId: 'single-authority' }, resources: [resource(31, 'provider'), resource(41, 'cli')] };
  const api = compile(['assertPairTopology'], { assert, sameIdentity: contract.sameIdentity, sameLiveIdentity: contract.sameLiveIdentity });
  api.assertPairTopology(multi, single);
  for (const mutate of [value => { value.host = multi.host; }, value => { value.binding.runtimeOwner = null; },
    value => { value.binding.runtimeStoragePath += '-other'; }, value => { value.binding.runtimeBackend = 'systemd-user'; },
    value => { value.binding.runtimeGuarantee = 'strong'; }, value => { value.binding.runtimeSessionId = multi.binding.runtimeSessionId; },
    value => { value.supervisor.startTicks += '1'; }, value => { value.reader.authorityId = multi.reader.authorityId; },
    value => { value.resources[0] = multi.resources[0]; }, value => { value.resources[1] = multi.resources[1]; }]) {
    const changed = structuredClone(single); mutate(changed);
    assert.throws(() => api.assertPairTopology(multi, changed));
  }
});

test('pair resource separation excludes only the recorded original peer identities', () => {
  const f = fixture({ platform: 'linux' });
  const peer = resources(f.entries).map(entry => ({ ...entry, pid: entry.pid + 100, startTicks: `${entry.pid + 100}00` }));
  f.entries = [...f.entries, ...peer];
  const api = compile(resourceFunctions, f.context);
  assert.throws(() => api.assertOriginalResourcesLive(f.original));
  assert.deepEqual(api.assertOriginalResourcesLive(f.original, peer), f.original);
  f.entries = f.entries.map(entry => entry.pid === peer[0].pid ? { ...entry, startTicks: 'replaced' } : entry);
  assert.throws(() => api.assertOriginalResourcesLive(f.original, peer));
});

test('pair uses original session identity across composed node IDs and presentation reader remounts', async () => {
  for (const changed of [undefined, 'binding', 'authority', 'process']) {
    const binding = { runtimeOwner: { root: 'A' }, runtimeBackend: 'legacy-detached', runtimeStoragePath: '/private/storage',
      runtimeSessionId: 'session', runtimeGuarantee: 'best-effort' };
    const supervisor = { pid: 20, startTicks: '200', executable: '/code', state: 'S' };
    const cli = { pid: 30, startTicks: '300', executable: '/codex', state: 'S' };
    const expected = { nodeId: 'uncomposed-id', binding, supervisor, reader: { authorityId: 'authority', readId: 'old' }, resources: [cli] };
    const current = structuredClone(binding);
    if (changed === 'binding') current.runtimeStoragePath += '-other';
    const state = { state: { nodes: [{ id: 'composed-id', kind: 'agent', position: { x: 0, y: 0 }, metadata: {
      agent: { ...current, liveSession: true, attachmentState: 'attached-live' } } }] } };
    let attachRequests = 0;
    const api = compile(['pairNode', 'pairCapture'], { assert, currentNodeId: undefined, surface: 'editor', randomUUID: () => 'request',
      process: { pid: 10 }, snapshot: async () => state, command: async (name, message, target) => {
        if (message?.type !== 'webview/attachExecutionSession') return;
        assert.equal(name, 'dispatchWebviewMessage'); assert.equal(target, 'editor');
        assert.deepEqual(message.payload, { kind: 'agent', nodeId: 'composed-id', executionSessionId: 'session', requestId: 'request' });
        attachRequests++;
      },
      poll: async (_label, get, accept) => { const value = await get(); assert(accept(value)); return value; },
      vscode: { commands: { executeCommand: async () => {} } }, runtimePaths: () => ({ socketPath: '/socket' }),
      rpc: async () => ({ pid: 20 }), assertRuntimeOwnerBinding: async () => {}, sameLiveIdentity: contract.sameLiveIdentity,
      readIdentity: async pid => pid === 20 ? supervisor : pid === 30 ? { ...cli, startTicks: changed === 'process' ? 'replaced' : '300' }
        : { pid: 10 },
      mountedReader: async (id, requested) => {
        assert.equal(attachRequests, 1); assert.equal(id, 'composed-id');
        assert.deepEqual(requested, { requestId: 'request', sessionId: 'session', authorityId: 'authority' });
        return { sessionId: 'session',
        authorityId: changed === 'authority' ? 'changed' : 'authority', readId: 'new' }; }
    });
    if (changed) await assert.rejects(api.pairCapture('session', expected));
    else assert.equal((await api.pairCapture('session', expected)).reader.readId, 'new');
  }
});

test('pair reader requires its requested snapshot and actual mounted page, not an old message cache', async () => {
  for (const changed of [undefined, 'missing', 'request', 'node', 'session', 'authority', 'read', 'page', 'columns']) {
    const requested = { requestId: 'fresh-request', sessionId: 'original-session', authorityId: 'original-authority' };
    const fresh = { type: 'host/executionSnapshot', payload: { nodeId: 'node', requestId: requested.requestId,
      terminalRead: { sessionId: requested.sessionId, authorityId: requested.authorityId, readId: 'current-reader' } } };
    if (changed === 'request') fresh.payload.requestId = 'other-request';
    if (changed === 'node') fresh.payload.nodeId = 'other-node';
    if (changed === 'session') fresh.payload.terminalRead.sessionId = 'replacement-session';
    if (changed === 'authority') fresh.payload.terminalRead.authorityId = 'replacement-authority';
    if (changed === 'read') fresh.payload.terminalRead.readId = '';
    const old = { type: 'host/executionSnapshot', payload: { nodeId: 'node', requestId: 'old-request',
      terminalRead: { sessionId: requested.sessionId, authorityId: requested.authorityId, readId: 'old-reader' } } };
    const messages = changed === 'missing' ? [old] : [old, fresh];
    const api = compile(['mountedReader'], { assert,
      probe: async () => ({ nodes: changed === 'page' ? [] : [{ nodeId: 'node', terminalCols: changed === 'columns' ? 63 : 100 }] }),
      command: async name => { assert.equal(name, 'getHostMessages'); return messages; },
      poll: async (_label, get, accept) => { const value = await get(); assert(accept(value)); return value; }
    });
    if (changed) await assert.rejects(api.mountedReader('node', requested), undefined, changed);
    else assert.equal((await api.mountedReader('node', requested)).readId, 'current-reader');
  }
});

test('PaneGallery round trip observes actual group frames and rejects a replacement execution', async () => {
  for (const starts of [[], [{ kind: 'execution/started' }]]) {
    let mode = 'rootGroups';
    const updates = [], captures = [], cleared = [];
    const subject = { binding: { runtimeSessionId: 'original' } };
    const api = compile(['pairSwitchGallery'], { assert,
      snapshot: async () => ({ state: { groups: ['A', 'B'].map(id => ({ id, role: 'workspace-root' })) } }),
      vscode: { ConfigurationTarget: { Workspace: 2 }, workspace: { getConfiguration: section => {
        assert.equal(section, 'devSessionCanvas'); return { update: async (key, value, target) => {
          assert.equal(key, 'canvas.multiRootPresentationMode'); assert.equal(target, 2); mode = value; updates.push(value);
        } }; } } },
      command: async name => {
        if (name.startsWith('clear')) { cleared.push(name); return; }
        if (name === 'getDiagnosticEvents') return starts;
        return [{ type: 'host/stateUpdated', payload: { runtime: { multiRootPresentationMode: mode } } }];
      },
      probe: async () => ({ groups: mode === 'paneGallery' ? [] : ['A', 'B'].map(groupId => ({ groupId })) }),
      poll: async (_label, get, accept) => { const value = await get(); assert(accept(value)); return value; },
      pairCapture: async (id, expected) => { assert.equal(expected, subject); captures.push(id); return { binding: subject.binding, reader: {} }; }
    });
    if (starts.length) await assert.rejects(api.pairSwitchGallery(subject));
    else assert.deepEqual((await api.pairSwitchGallery(subject)).map(value => value.mode), ['paneGallery', 'rootGroups']);
    assert.deepEqual(updates, ['paneGallery', 'rootGroups']);
    assert.deepEqual(captures, ['original', 'original']);
    assert.deepEqual(cleared, ['clearDiagnosticEvents', 'clearHostMessages', 'clearHostMessages']);
  }
});

test('pair Agent creation targets the actual composed root and archives ownership before the first model turn', async () => {
  const events = [], writes = new Map();
  const group = { id: 'actual-A', role: 'workspace-root', workspaceRootPath: '/private/A', position: { x: 10, y: 20 } };
  const old = { id: 'old', kind: 'agent', metadata: { agent: { liveSession: true, runtimeSessionId: 'old-session' } } };
  const created = { id: 'new', kind: 'agent', metadata: { agent: { liveSession: true, persistenceMode: 'live-runtime', runtimeSessionId: 'new-session' } } };
  const provider = { pid: 30, ppid: 20, startTicks: '300', state: 'S', executable: '/provider', role: 'provider' };
  const cli = { pid: 40, ppid: 30, startTicks: '400', state: 'S', executable: '/codex', role: 'cli' };
  const originals = [provider, cli], excluded = [{ pid: 50 }];
  let dispatched = false;
  const api = compile(['pairCreate'], { assert, structuredClone, surface: 'editor', control: { nonce: 'nonce' },
    config: { provider: 'codex', workspacePath: '/private/A', cli: { entry: '/private/codex' }, launchArguments: ['--no-daemon'] },
    snapshot: async () => ({ state: { nodes: dispatched ? [old, created] : [old], groups: [group] } }),
    command: async (name, ...args) => {
      events.push(name);
      if (name === 'dispatchWebviewMessage') {
        const message = args[0]; assert.equal(message.type, 'webview/createDemoNode');
        assert.deepEqual(message.payload, { kind: 'agent', agentProvider: 'codex', agentLaunchPreset: 'custom',
          agentCustomLaunchCommand: "'/private/codex' '--no-daemon'", cwd: '/private/A', targetGroupId: 'actual-A',
          preferredPosition: { x: 50, y: 60 } });
        dispatched = true;
      }
      if (name === 'flushPersistedState') return { exists: true };
    },
    poll: async (_label, get, accept) => { const value = await get(); assert(accept(value)); return value; },
    pairCapture: async (sessionId, expected, role) => {
      assert.equal(sessionId, 'new-session'); assert.equal(expected, undefined); assert.equal(role, 'multi');
      events.push('observe-supervisor', 'multi-owner');
      return { binding: { runtimeSessionId: sessionId }, supervisor: { pid: 20 } };
    },
    observer: { addRoot: async () => events.push('observe-supervisor'), sample: async () => {} },
    waitForAgentReady: async () => events.push('ready'),
    assertOriginalResourcesLive: (expected, prior) => { assert.equal(expected, undefined); assert.equal(prior, excluded); return originals; },
    readIdentity: async pid => { assert.equal(pid, 30); return provider; }, sameLiveIdentity: contract.sameLiveIdentity,
    pairPublish: async (name, value) => { events.push(name); writes.set(name, structuredClone(value)); },
    pairTurn: async () => { events.push('model-turn'); return { applied: true }; }
  });
  const result = await api.pairCreate('multi', excluded);
  assert(events.indexOf('multi-owner') < events.indexOf('ready'));
  assert(events.indexOf('multi-ownership') < events.indexOf('model-turn'));
  assert(events.indexOf('flushPersistedState') < events.indexOf('multi-created'));
  originals[0].startTicks = 'mutated-observer-entry';
  assert.equal(result.resources[0].startTicks, '300', 'Keep immutable original identities while the observer updates.');
  assert.equal(writes.get('multi-created').interaction.applied, true);
});

test('pair archives the checked owner before reader mounting or CLI readiness can fail', async () => {
  const events = [];
  const binding = { runtimeOwner: { root: 'A' }, runtimeBackend: 'legacy-detached', runtimeStoragePath: '/private/storage',
    runtimeSessionId: 'session', runtimeGuarantee: 'best-effort' };
  const supervisor = { pid: 20, startTicks: '200', executable: '/code', state: 'S' };
  const state = { state: { nodes: [{ id: 'node', kind: 'agent', position: { x: 0, y: 0 }, metadata: {
    agent: { ...binding, liveSession: true, attachmentState: 'attached-live' } } }] } };
  const api = compile(['pairNode', 'pairCapture'], { assert, currentNodeId: undefined, surface: 'editor', randomUUID: () => 'request',
    snapshot: async () => state, command: async () => {}, vscode: { commands: { executeCommand: async () => {} } },
    poll: async (_label, get, accept) => { const value = await get(); assert(accept(value)); return value; },
    runtimePaths: () => ({ socketPath: '/socket' }), rpc: async () => ({ pid: 20 }),
    assertRuntimeOwnerBinding: async () => events.push('checked-owner'), readIdentity: async () => supervisor,
    observer: { addRoot: async () => events.push('observe-supervisor') },
    pairPublish: async (name, receipt) => { assert.equal(name, 'multi-owner'); assert.deepEqual(receipt, { binding, supervisor }); events.push('receipt'); },
    mountedReader: async () => { events.push('reader'); throw new Error('reader mount failed'); }
  });
  await assert.rejects(api.pairCapture('session', undefined, 'multi'), /reader mount failed/);
  assert.deepEqual(events, ['checked-owner', 'observe-supervisor', 'receipt', 'reader']);
});

test('pair stop requires the current reader applied settlement and original resource exits', async () => {
  for (const changed of [undefined, 'readId', 'sessionId', 'outcome', 'binding', 'history', 'live', 'resources']) {
    const expected = { binding: { runtimeSessionId: 'session' }, resources: ['original'] };
    const detail = { sessionId: 'session', readId: 'current-reader', outcome: { kind: 'applied' } };
    if (changed === 'readId') detail.readId = 'old-reader';
    if (changed === 'sessionId') detail.sessionId = 'other-session';
    if (changed === 'outcome') detail.outcome.kind = 'detached';
    let stopped = false;
    const api = compile(['pairStop'], { assert, surface: 'editor',
      pairCapture: async (id, subject) => {
        assert.equal(id, 'session'); assert.equal(subject, expected);
        return { nodeId: 'current-node', binding: expected.binding, reader: { readId: 'current-reader' } };
      },
      command: async (name, message) => {
        if (name === 'dispatchWebviewMessage') {
          assert.deepEqual(message, { type: 'webview/stopExecutionSession', payload: { kind: 'agent', nodeId: 'current-node' } });
          stopped = true; return;
        }
        if (name === 'getDiagnosticEvents') return [{ kind: 'runtime/terminalReadSettled', detail }];
        return { bindings: changed === 'binding' ? [{ nodeId: 'current-node' }] : [] };
      },
      snapshot: async () => ({ state: { nodes: [{ id: 'current-node', status: 'stopped', metadata: {
        agent: { liveSession: changed === 'live', terminalHistoryDiscarded: changed !== 'history' } } }] } }),
      nodeOf: (state, id) => state.state.nodes.find(node => node.id === id),
      poll: async (_label, get, accept) => { const value = await get(); assert(accept(value)); return value; },
      originalResourcesExited: async originals => { assert.equal(originals, expected.resources); return { pass: changed !== 'resources' }; }
    });
    if (changed) await assert.rejects(api.pairStop(expected));
    else assert.equal((await api.pairStop(expected)).pass, true);
    assert(stopped);
  }
});

test('pair fallback signals only recorded live original identities under its private storage', async () => {
  const body = launcherAst.statements.find(node => ts.isFunctionDeclaration(node) &&
    node.name.text === 'cleanupRootWindowPair').getText(launcherAst);
  for (const outside of [false, true]) {
    const resource = (pid, role) => ({ pid, startTicks: String(pid * 10), executable: `/fixture/${role}`, state: 'S', role });
    const ui = resource(10, 'ui'), host = resource(11, 'host'), supervisor = resource(20, 'supervisor');
    const cli = resource(30, 'cli'), provider = resource(40, 'provider');
    const current = new Map([ui, host, supervisor, provider, { ...cli, startTicks: 'replacement' }].map(value => [value.pid, value]));
    const killed = [], written = new Map();
    const binding = { runtimeStoragePath: outside ? '/private/elsewhere' : '/private/profile/User/globalStorage/root' };
    const receipts = new Map([['pair-multi-activation.json', { host }], ['pair-multi-owner.json', { binding, supervisor }],
      ['pair-multi-ownership.json', { binding, supervisor, resources: [cli, provider] }]]);
    const identities = { ...contract, readIdentity: async pid => current.get(pid),
      signalOwned: (original, signal) => contract.signalOwned(original, signal, {
        read: async pid => current.get(pid), kill: pid => { killed.push(pid); current.delete(pid); }
      }) };
    const filesystem = { readFile: async file => {
      const receipt = receipts.get(path.basename(file));
      if (!receipt) throw Object.assign(new Error('missing receipt'), { code: 'ENOENT' });
      return JSON.stringify(receipt);
    }, writeFile: async (file, data) => written.set(path.basename(file), JSON.parse(data)) };
    const cleanup = new Function('assert', 'fs', 'path', 'identity', 'setTimeout', `${body}\nreturn cleanupRootWindowPair;`)(
      assert, filesystem, path, identities, callback => { callback(); });
    const run = cleanup({ artifactsDir: '/private/artifacts', userDataDir: '/private/profile' }, ui);
    if (outside) { await assert.rejects(run); assert.deepEqual(killed, []); }
    else {
      await run;
      assert.deepEqual(killed, [10, 11, 20, 40]);
      assert(!killed.includes(cli.pid), 'PID reuse cannot authorize a signal.');
      const receipt = written.get('pair-fallback.json');
      assert.equal(receipt.pass, false);
      assert.deepEqual(receipt.missing, ['single-activation', 'single-owner', 'single-ownership']);
      assert.deepEqual(receipt.remaining, []);
    }
  }
});

test('the fixed pair creates in multi first and stops both original sessions only after the multi Host exits', async () => {
  for (const role of ['multi', 'single']) {
    const events = [], records = new Map();
    const multi = { binding: { runtimeSessionId: 'multi' }, supervisor: { pid: 20 }, host: { pid: 11 }, reader: { readId: 'old' }, resources: ['original'] };
    const single = { binding: { runtimeSessionId: 'single' }, supervisor: { pid: 20 }, host: { pid: 12 } };
    const ui = { pid: 10, startTicks: '100', executable: '/code', state: 'S' };
    const context = { assert, path, phase: '', currentNodeId: '', observer: { addRoot: async () => {}, sample: async () => {} },
      config: { rootOwner: true, provider: 'codex', rootWindowPair: true, multiWorkspace: '/private/multi.code-workspace',
        workspacePath: '/private/A', peerRoot: '/private/B', installedVsixExpectation: '/private/expected.json' },
      control: { nonce: 'nonce' }, process: { platform: 'linux', pid: role === 'multi' ? 11 : 12 }, surface: 'editor',
      vscode: { workspace: { workspaceFile: role === 'multi' ? { fsPath: '/private/multi.code-workspace' } : undefined,
        workspaceFolders: (role === 'multi' ? ['/private/A', '/private/B'] : ['/private/A']).map(fsPath => ({ uri: { fsPath } })) },
      Uri: { file: value => value }, commands: { executeCommand: async (name, target) => {
        events.push(name); if (name === 'vscode.openFolder') assert.equal(target, '/private/A');
      } } },
      readIdentity: async pid => pid === 10 ? ui : { pid, ppid: 10, startTicks: String(pid * 10), executable: '/code', state: 'S' },
      sameLiveIdentity: contract.sameLiveIdentity, exitedIdentity: () => true,
      pairWait: async name => { events.push(`wait:${name}`); return name === 'launcher' ? { ui }
        : name === 'multi-created' ? multi : name === 'single-created' ? single : { pass: true }; },
      pairPublish: async (name, value) => { events.push(`publish:${name}`); records.set(name, value); },
      activateVisibleExtension: async () => ({}), waitForCommand: async () => {}, captureInstalledExtensionReceipt: async () => ({ hash: 'fixed' }),
      startProcessObserver: async () => events.push('observe'), releaseProcessObserver: async () => events.push('release'),
      snapshot: async () => ({ state: { nodes: [] } }),
      pairCreate: async (actualRole, excluded) => { assert.equal(actualRole, role); events.push(`create:${actualRole}`);
        assert.equal(excluded, role === 'single' ? multi.resources : undefined); return role === 'multi' ? multi : single; },
      assertPairTopology: (first, second) => { assert.equal(first, multi); assert.equal(second, single); },
      pairSwitchGallery: async value => { assert.equal(value, multi); events.push('gallery'); return []; },
      pairTurn: async value => { events.push(`turn:${value.binding.runtimeSessionId}`); return { applied: true }; },
      pairCapture: async () => ({ reader: { readId: 'single-reader' } }), assertOriginalResourcesLive: () => {},
      poll: async (label, get, accept) => { events.push(label); const value = await get(); assert(accept(value)); return value; },
      pairStop: async value => { events.push(`stop:${value.binding.runtimeSessionId}`); return { pass: true }; },
      command: async name => { events.push(name); return name === 'flushPersistedState' ? { exists: true }
        : { bindings: [], pendingRuntimeSupervisorOperationCount: 0 }; },
      runtimePaths: () => ({ registryPath: '/private/registry.json' }), fs: { readFile: async () => '{"sessions":[]}' }
    };
    await compile(['runRootWindowPair'], context).runRootWindowPair();
    assert.equal(records.get(`${role}-finished`).pass, true);
    assert(!events.includes('resetState'));
    if (role === 'multi') {
      assert(events.indexOf('create:multi') < events.indexOf('vscode.openFolder'));
      assert(events.indexOf('wait:single-created') < events.indexOf('gallery'));
      assert(events.indexOf('gallery') < events.indexOf('turn:multi'));
      assert(!events.some(value => value.startsWith('stop:')));
    } else {
      assert(events.indexOf('wait:multi-created') < events.indexOf('create:single'));
      assert(events.indexOf('pair original multi Host exited') < events.indexOf('flushPersistedState'));
      assert(events.indexOf('flushPersistedState') < events.indexOf('stop:multi'));
      assert.equal(records.get('cleanup').pass, true);
    }
    assert(events.indexOf('release') < events.indexOf('workbench.action.closeWindow'));
  }
});

test('pair failure captures existing probe and Host messages once before closing without replacing the first error', async () => {
  for (const probeFails of [false, true]) {
    const failure = new Error('original pair failure'), events = [], written = new Map();
    const context = { assert, phase: '', config: { rootOwner: true, provider: 'codex', multiWorkspace: '/multi',
      workspacePath: '/A', peerRoot: '/B' }, process: { platform: 'linux', pid: 10 }, observer: undefined,
      vscode: { workspace: { workspaceFolders: [{ uri: { fsPath: '/A' } }] }, commands: {
        executeCommand: async () => events.push('close') } },
      readIdentity: async () => ({ pid: 10 }), pairWait: async () => { throw failure; },
      pairPublish: async (name, value) => { events.push(name); written.set(name, value); },
      write: async (name, value) => { events.push(name); written.set(name, value); },
      probe: async () => { events.push('probe'); if (probeFails) throw new Error('probe failed'); return { actual: 'page' }; },
      command: async name => { assert.equal(name, 'getHostMessages'); events.push(name); return [{ actual: 'message' }]; },
      releaseProcessObserver: async () => events.push('release')
    };
    await assert.rejects(compile(['runRootWindowPair'], context).runRootWindowPair(), error => error === failure);
    assert.equal(written.get('single-failure').error, String(failure));
    assert.equal(written.get('single-finished').pass, false);
    assert.equal(events.filter(value => value === 'probe').length, 1);
    assert.equal(events.filter(value => value === 'getHostMessages').length, 1);
    if (!probeFails) assert.deepEqual(written.get('pair-single-failure-webview-probe.json'), { actual: 'page' });
    assert.deepEqual(written.get('pair-single-failure-host-messages.json'), [{ actual: 'message' }]);
    assert(events.indexOf('pair-single-failure-host-messages.json') < events.indexOf('close'));
  }
});

test('Claude reload uses the existing isolated tool-free interactive launch with one fixed session identity', () => {
  const settings = path.resolve('/isolated/claude/settings.json');
  const args = launchApi.buildAgentReloadLaunchArguments('claude', { claudeSettingsPath: settings });
  const id = args.at(-1);
  assert.deepEqual(args, cliHelpers.buildClaudeCandidateArguments({ lifecycle: 'stop',
    configurationArguments: ['--settings', settings], sessionId: id }));
  assert(!args.includes('-p'), 'The reload subject must remain interactive across both model turns.');
  assert.throws(() => launchApi.buildAgentReloadLaunchArguments('claude', { claudeSettingsPath: 'relative.json' }));
  const codexIsolation = { arguments: ['--disable', 'hooks'], configuredServersVerifiedDisabled: true };
  assert.deepEqual(launchApi.buildAgentReloadLaunchArguments('codex', { codexIsolation }),
    ['--disable', 'hooks', '--no-daemon', '--no-alt-screen', '--sandbox', 'read-only', '-a', 'never']);
});

test('Windows reload config trusts only its exact empty workspace and preserves the isolated backend config', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dsc-reload-config-test-'));
  let backend;
  try {
    const fakeKey = 'test-only-secret-not-an-artifact';
    backend = await createDeepSeekConfiguration({ apiKey: fakeKey, temporaryRoot: root });
    const runtimeRoot = path.join(root, 'runtime');
    const workspacePath = path.join(runtimeRoot, 'workspace');
    await fs.mkdir(workspacePath, { recursive: true });
    const configPath = path.join(backend.authReferences.CODEX_HOME, 'config.toml');
    const original = await fs.readFile(configPath, 'utf8');
    const claude = await fs.readFile(backend.claudeSettingsPath, 'utf8');
    const models = await fs.readFile(path.join(backend.authReferences.CODEX_HOME, 'models.json'), 'utf8');
    const receipt = await configureFor('win32')({ backend, workspacePath, runtimeRoot });
    const appended = (await fs.readFile(configPath, 'utf8')).slice(original.length);
    const workspace = await fs.realpath(workspacePath);
    assert.equal(await fs.readFile(configPath, 'utf8'), original + appended, 'Do not rewrite provider/auth configuration.');
    assert.equal(appended, `\n[projects.${JSON.stringify(workspace)}]\ntrust_level = "trusted"\n\n[windows]\nsandbox = "unelevated"\n`);
    assert.deepEqual(receipt, { workspacePath: workspace, trustLevel: 'trusted', windowsSandbox: 'unelevated', source: 'isolated-CODEX_HOME' });
    assert(!JSON.stringify(receipt).includes(fakeKey));
    assert(!appended.includes(fakeKey));
    assert.equal(await fs.readFile(backend.claudeSettingsPath, 'utf8'), claude);
    assert.equal(await fs.readFile(path.join(backend.authReferences.CODEX_HOME, 'models.json'), 'utf8'), models);
  } finally { await backend?.dispose(); await fs.rm(root, { recursive: true, force: true }); }
});

test('reload preconfiguration is Windows-only and rejects unowned or unknown paths before writing', async () => {
  const noIo = new Proxy({}, { get() { throw new Error('Non-Windows must not access configuration.'); } });
  for (const platform of ['linux', 'darwin']) assert.equal(await configureFor(platform, noIo)({}), undefined);
  const windowsPaths = path.win32;
  const root = 'D:\\isolated';
  const backend = { directory: `${root}\\backend`, descriptor: { backend: 'deepseek' },
    authReferences: { CODEX_HOME: `${root}\\backend\\codex` } };
  const workspacePath = `${root}\\runtime\\workspace`;
  const runtimeRoot = `${root}\\runtime`;
  const configPath = `${root}\\backend\\codex\\config.toml`;
  for (const problem of ['missing', 'different-workspace', 'nonempty-workspace', 'different-home', 'redirected-config']) {
    let writes = 0;
    const filesystem = { realpath: async value => {
      if (problem === 'missing' && value === workspacePath) throw Object.assign(new Error('Missing workspace'), { code: 'ENOENT' });
      if (problem === 'different-workspace' && value === workspacePath) return 'D:\\other-workspace';
      if (problem === 'different-home' && value === backend.authReferences.CODEX_HOME) return 'D:\\user\\.codex';
      if (problem === 'redirected-config' && value === configPath) return 'D:\\user\\.codex\\config.toml';
      return value;
    }, readdir: async () => problem === 'nonempty-workspace' ? ['unexpected-file'] : [],
    appendFile: async () => { writes++; } };
    await assert.rejects(configureFor('win32', filesystem, windowsPaths)({ backend, workspacePath, runtimeRoot }));
    assert.equal(writes, 0, problem);
  }
  const writes = [];
  const filesystem = { realpath: async value => value, readdir: async () => [],
    appendFile: async (file, text) => writes.push({ file, text }) };
  await configureFor('win32', filesystem, windowsPaths)({ backend, workspacePath, runtimeRoot });
  assert.equal(writes.length, 1);
  assert.equal(writes[0].file, configPath);
  const key = /^\n\[projects\.(.+)\]/u.exec(writes[0].text)[1];
  assert.equal(JSON.parse(key), workspacePath, 'Windows backslashes must remain one exact TOML key.');
});

test('Codex loading composer is not model readiness, and late onboarding still receives confirmation', async () => {
  const loading = 'model: loading /model to change\n\u203a Ask Codex to do anything\n? for shortcuts';
  const ready = 'DeepSeek-Flash high\n\u203a Ask Codex to do anything';
  const trust = 'Folder access\nTrust this folder?\n1. Trust and continue\n2. Quit';
  let clock = 0;
  let cursor = 0;
  const inputs = [];
  const screens = [loading, ready, trust, trust, ready, ready];
  const api = compile(['hasLoadedAgentComposer', 'waitForAgentReady'], {
    config: { provider: 'codex' }, stripVt: value => value, control: { deadlineAt: 100000 }, currentNodeId: 'node',
    Date: { now: () => clock }, sleep: async ms => { clock += ms; },
    probe: async () => { assert(cursor < screens.length, 'Ready must be reached without retrying a model request.'); return screens[cursor++]; },
    textOf: value => value, dom: async action => inputs.push(action)
  });
  for (const notReady of [loading, 'Try Codex', 'Send\n? for shortcuts', '\u203a Ask Codex to do anything']) {
    assert.equal(api.hasLoadedAgentComposer(notReady), false);
  }
  assert.equal(api.hasLoadedAgentComposer(ready), true);
  await api.waitForAgentReady();
  assert.equal(cursor, screens.length, 'Confirmation must recheck readiness after late trust UI.');
  assert.deepEqual(inputs, [{ kind: 'sendExecutionInput', nodeId: 'node', data: '\r' }]);
});

test('Windows sandbox onboarding must be completed before the loaded composer becomes ready', async () => {
  const ready = 'model: DeepSeek-Flash high /model to change\n\u203a Ask Codex to do anything';
  // Text reconstructed from the frozen Windows 37608896439 registry VT at revision 124.
  const sandbox = ['model: DeepSeek-Flash high /model to change',
    'Set up the Codex agent sandbox to protect your files and control network access. Learn more',
    '<https://developers.openai.com/codex/windows>',
    '\u203a 1. Set up default sandbox (requires Administrator permissions)',
    '  2. Use non-admin sandbox (higher risk if prompt injected)', '  3. Quit', 'enter select - esc back'].join('\n');
  for (const selection of ['default', 'non-admin', 'unknown', 'not-dismissed']) {
    const selected = selection === 'non-admin' ? sandbox.replace('\u203a 1.', '  1.').replace('  2.', '\u203a 2.')
      : selection === 'unknown' ? sandbox.replace('\u203a 1.', '  1.').replace('  3.', '\u203a 3.') : sandbox;
    let clock = 0;
    let cursor = 0;
    const inputs = [];
    const screens = [ready, selected, selected, selected, ready, ready];
    const api = compile(['hasLoadedAgentComposer', 'waitForAgentReady'], {
      assert, config: { provider: 'codex' }, process: { platform: 'win32' }, stripVt: value => value,
      control: { deadlineAt: 40000 }, currentNodeId: 'node',
      Date: { now: () => clock }, sleep: async ms => { clock += ms; },
      probe: async () => selection === 'not-dismissed' ? selected : screens[cursor++],
      textOf: value => value, dom: async action => inputs.push(action)
    });
    assert.equal(api.hasLoadedAgentComposer(selected), false, 'The loaded model header alone does not complete onboarding.');
    if (['unknown', 'not-dismissed'].includes(selection)) await assert.rejects(api.waitForAgentReady());
    else { await api.waitForAgentReady(); assert.equal(cursor, screens.length); }
    assert.deepEqual(inputs, selection === 'unknown' ? [] : [{ kind: 'sendExecutionInput', nodeId: 'node',
      data: selection === 'non-admin' ? '\r' : '\u001b[B\r' }]);
  }
});

test('Claude readiness requires its model and composer and confirms known onboarding before a model turn', async () => {
  const ready = 'Claude Code v2.1.280\ndeepseek-flash\n\u276f Try "explain this code"';
  const prompts = ['Choose the text style\n1. Dark mode',
    'Accessing workspace:\n /isolated/workspace\n  No, exit\n\u276f Yes, I trust this folder\nEnter to confirm \u00b7 Esc to cancel',
    'Detected a custom API key\nDo you want to use this API key?'];
  let clock = 0;
  let cursor = 0;
  const inputs = [];
  const screens = [ready, prompts[0], prompts[0], prompts[1], prompts[1], prompts[2], ready, ready];
  const context = { assert, config: { provider: 'claude' }, process: { platform: 'linux' },
    stripVt: value => value, control: { deadlineAt: 100000 }, currentNodeId: 'node',
    Date: { now: () => clock }, sleep: async ms => { clock += ms; },
    probe: async () => { assert(cursor < screens.length); return screens[cursor++]; },
    textOf: value => value, dom: async action => inputs.push(action) };
  const api = compile(['hasLoadedAgentComposer', 'waitForAgentReady'], context);
  assert.equal(api.hasLoadedAgentComposer(ready), true);
  for (const text of ['Claude Code', 'Claude Code\n\u276f', 'deepseek-flash\n\u276f',
    'DeepSeek-Flash high\n\u203a Ask Codex to do anything']) assert.equal(api.hasLoadedAgentComposer(text), false);
  await api.waitForAgentReady();
  assert.equal(cursor, screens.length);
  assert.deepEqual(inputs, prompts.map(() => ({ kind: 'sendExecutionInput', nodeId: 'node', data: '\r' })));
  for (const text of ['Select login method:', 'Not logged in', 'Invalid API key']) {
    const rejected = compile(['hasLoadedAgentComposer', 'waitForAgentReady'], { ...context, probe: async () => text });
    await assert.rejects(rejected.waitForAgentReady(), /authenticated surface/);
  }
});

test('Claude composer recognizes observed NBSP horizontal spacing without accepting another line or missing model', async () => {
  const ready = 'Claude Code v2.1.280\ndeepseek-flash\n\u276f\u00a0';
  let clock = 0, probes = 0;
  const api = compile(['hasLoadedAgentComposer', 'waitForAgentReady'], {
    assert, config: { provider: 'claude' }, stripVt: value => value, control: { deadlineAt: 32000 }, currentNodeId: 'node',
    Date: { now: () => clock }, sleep: async ms => { clock += ms; }, textOf: value => value,
    probe: async () => { probes++; return ready; }, dom: async () => assert.fail('A ready composer needs no input.')
  });
  assert.equal(api.hasLoadedAgentComposer(ready), true);
  for (const notReady of ['Claude Code v2.1.280\ndeepseek-flash\n\u276f\u00a0not a composer',
    'Claude Code v2.1.280\n\u276f\u00a0', 'deepseek-flash\n\u276f\u00a0',
    'Claude Code v2.1.280\ndeepseek-\nflash\n\u276f\u00a0']) {
    assert.equal(api.hasLoadedAgentComposer(notReady), false);
  }
  await api.waitForAgentReady();
  assert.equal(probes, 2);
});

const claudeTrustScreen = [' Accessing workspace:', '', ' /isolated/workspace', '',
  ' Quick safety check: Is this a project you created or one you trust?', '',
  ' \u276f No, exit', '   Yes, I trust this folder', '', ' Enter to confirm \u00b7 Esc to cancel'].join('\n');
const claudeTrustYes = claudeTrustScreen.replace(' \u276f No, exit', '   No, exit')
  .replace('   Yes, I trust this folder', ' \u276f Yes, I trust this folder');
const claudeComposer = 'Claude Code v2.1.280\ndeepseek-flash\n\u276f Try "explain this code"';

function trustFixture({ screen, input = async () => {} }) {
  let clock = 0, visible;
  const inputs = [];
  const api = compile(['hasLoadedAgentComposer', 'waitForAgentReady'], {
    assert, config: { provider: 'claude' }, process: { platform: 'linux' }, stripVt: value => value,
    control: { deadlineAt: 32000 }, currentNodeId: 'node', Date: { now: () => clock },
    sleep: async ms => { clock += ms; }, textOf: value => value,
    probe: async () => { visible = screen(clock, inputs); return visible; },
    dom: async action => {
      assert.equal(action.data, visible === claudeTrustYes ? '\r' : '\u001b[F',
        'Only the observed affirmative option may receive Enter; navigation selects the last option.');
      inputs.push({ at: clock, data: action.data });
      await input(action.data, clock);
    }
  });
  return { run: api.waitForAgentReady, inputs, now: () => clock };
}

test('Claude trust keeps exact page checks and requires two consecutive affirmative observations', async () => {
  for (const screen of [claudeTrustScreen.replace('\u276f', ' '), claudeTrustScreen.replace('\u276f', '\u203a'),
    claudeTrustScreen.replace(' \u276f No, exit\n   Yes, I trust this folder',
      '   Yes, I trust this folder\n \u276f No, exit'), claudeTrustScreen.replace('Accessing workspace:', 'Unknown confirmation:')]) {
    const f = trustFixture({ screen: () => screen });
    await assert.rejects(f.run(), /Claude workspace trust selection is not confirmed/);
    assert.deepEqual(f.inputs, []);
  }
  for (const initial of [claudeTrustScreen, claudeTrustYes]) {
    const f = trustFixture({ screen: (_now, inputs) => inputs.some(x => x.data === '\r') ? claudeComposer
      : inputs.length ? claudeTrustYes : initial });
    await f.run();
    assert.deepEqual(f.inputs, initial === claudeTrustYes ? [{ at: 100, data: '\r' }]
      : [{ at: 0, data: '\u001b[F' }, { at: 200, data: '\r' }]);
  }
});

test('Claude trust recovers a reset even when the entire affirmative interval falls between probes', async () => {
  // Original CI source timing relative to input: Yes at 9ms, No again at 46ms.
  for (const resetAt of [46, 150]) {
    const f = trustFixture({ screen: (now, inputs) => {
      if (inputs.some(x => x.data === '\r')) return claudeComposer;
      const moves = inputs.filter(x => x.data === '\u001b[F');
      if (moves.length >= 2) return now >= moves.at(-1).at + 9 ? claudeTrustYes : claudeTrustScreen;
      return moves.length && now >= 9 && now < resetAt ? claudeTrustYes : claudeTrustScreen;
    } });
    await f.run();
    assert.deepEqual(f.inputs.map(x => x.data), ['\u001b[F', '\u001b[F', '\r']);
    assert(f.inputs.at(-1).at > resetAt);
  }
});

test('Claude trust tolerates delayed End without toggling and fails closed at its navigation bound', async () => {
  const delayed = trustFixture({ screen: (now, inputs) => inputs.some(x => x.data === '\r') ? claudeComposer
    : now >= 250 ? claudeTrustYes : claudeTrustScreen });
  await delayed.run();
  assert.deepEqual(delayed.inputs.map(x => x.data), ['\u001b[F', '\u001b[F', '\u001b[F', '\r']);
  assert.equal(delayed.inputs.at(-1).at, 400);
  const stuck = trustFixture({ screen: () => claudeTrustScreen });
  await assert.rejects(stuck.run(), /navigation limit/);
  assert.deepEqual(stuck.inputs.map(x => x.data), ['\u001b[F', '\u001b[F', '\u001b[F']);
  assert(stuck.now() <= 2000);
});

test('Claude trust never navigates or submits again after its single confirmation', async () => {
  for (const remaining of [claudeTrustScreen, claudeTrustYes]) {
    const f = trustFixture({ screen: (_now, inputs) => inputs.length ? remaining : claudeTrustYes });
    await assert.rejects(f.run(), /interactive surface/);
    assert.deepEqual(f.inputs, [{ at: 100, data: '\r' }]);
    assert.equal(f.now(), 2000);
  }
});

test('Claude trust input rejection preserves unknown outcome and is never retried', async () => {
  for (const initial of [claudeTrustScreen, claudeTrustYes]) {
    const original = new Error('clientRequestTimeout: outcome unknown');
    const f = trustFixture({ screen: () => initial, input: async () => { throw original; } });
    await assert.rejects(f.run(), error => error === original);
    assert.equal(f.inputs.length, 1);
  }
});

test('Claude security notes require their exact continuation prompt and dismissal before a model turn', async () => {
  const security = 'Welcome to Claude Code v2.1.280\nSecurity notes:\n1. Claude can make mistakes.\nPress Enter to continue\u2026';
  const ready = 'Claude Code v2.1.280\ndeepseek-flash\n\u276f Try "explain this code"';
  for (const outcome of ['dismissed', 'still-visible', 'unrecognized']) {
    let clock = 0, cursor = 0;
    const inputs = [];
    const screens = [security, security, ready, ready];
    const api = compile(['hasLoadedAgentComposer', 'waitForAgentReady'], {
      assert, config: { provider: 'claude' }, process: { platform: 'linux' }, stripVt: value => value,
      control: { deadlineAt: 32000 }, currentNodeId: 'node', Date: { now: () => clock },
      sleep: async ms => { clock += ms; }, textOf: value => value,
      probe: async () => outcome === 'still-visible' ? security : outcome === 'unrecognized'
        ? 'Unknown prompt\nPress Enter to continue\u2026' : screens[cursor++],
      dom: async action => inputs.push(action)
    });
    if (outcome === 'dismissed') { await api.waitForAgentReady(); assert.equal(cursor, screens.length); }
    else await assert.rejects(api.waitForAgentReady(), /interactive surface/);
    assert.deepEqual(inputs, outcome === 'unrecognized' ? [] : [{ kind: 'sendExecutionInput', nodeId: 'node', data: '\r' }]);
  }
});

function rootBindingFixture() {
  const profile = { linux: 'linux-owner-v1-candidate', darwin: 'macos-owner-v1-candidate',
    win32: 'windows-owner-v1-candidate' }[process.platform];
  const userDataDir = path.resolve('/isolated/user-data');
  const workspacePath = path.resolve('/isolated/workspace');
  const globalStorage = path.join(userDataDir, 'User', 'globalStorage', 'devsessioncanvas.dev-session-canvas');
  const runtimeOwner = ownership.createRuntimeOwnerDescriptor({ environmentKey: 'a'.repeat(64),
    userStorageScopeKey: 'b'.repeat(64), rootPath: workspacePath,
    generation: ownership.resolveRootRuntimeSupervisorGeneration(profile) });
  const metadata = { runtimeOwner, runtimeBackend: 'legacy-detached', runtimeGuarantee: 'best-effort',
    runtimeStoragePath: ownership.resolveRuntimeRootOwnerBaseStoragePath(globalStorage, runtimeOwner), runtimeSessionId: 'session' };
  const hello = { serverVersion: 1, pid: 20, runtimeOwner: structuredClone(runtimeOwner),
    runtimeBackend: metadata.runtimeBackend, runtimeGuarantee: metadata.runtimeGuarantee, executionProfile: profile,
    ownerCompatibilityFingerprint: ownership.createRuntimeOwnerCompatibilityFingerprint(runtimeOwner.generation, profile),
    capabilities: { terminalCurrentStateV1: true, terminalHostOutputCreditV1: true, executionCandidateProfiles: [profile] } };
  const context = { assert, path, process, ...ownership,
    config: { rootOwner: true, userDataDir, workspacePath, permittedStorageRoots: [userDataDir] },
    fs: { realpath: async value => value },
    runtimePaths: value => ({ storageDir: path.join(value.runtimeStoragePath, 'runtime-supervisor') }),
    assertRuntimeStorageContained: (storage, roots) => storageContainment.assertRuntimeStorageContained(
      storage, roots, process.platform, async value => value) };
  return { metadata, hello, context };
}

test('root reload acceptance requires complete owner storage and hello identity without weakening legacy mode', async () => {
  const baseline = rootBindingFixture();
  await compile(['assertRuntimeOwnerBinding'], baseline.context).assertRuntimeOwnerBinding(baseline.metadata, baseline.hello);
  for (const mutate of [
    f => { delete f.metadata.runtimeOwner; },
    f => { f.metadata.runtimeOwner = null; },
    f => { f.metadata.runtimeOwner.extra = true; },
    f => { f.metadata.runtimeOwner.root.normalizedPath = path.resolve('/other-root'); },
    f => { delete f.metadata.runtimeSessionId; },
    f => { delete f.metadata.runtimeBackend; delete f.hello.runtimeBackend; },
    f => { delete f.metadata.runtimeGuarantee; delete f.hello.runtimeGuarantee; },
    f => { f.metadata.runtimeStoragePath = path.resolve('/other-storage'); },
    f => { f.context.config.userDataDir = path.resolve('/other-user'); },
    f => { f.hello.runtimeOwner.environmentKey = 'c'.repeat(64); },
    f => { f.hello.runtimeOwner.userStorageScopeKey = 'c'.repeat(64); },
    f => { f.hello.runtimeBackend = 'systemd-user'; },
    f => { f.hello.runtimeGuarantee = 'different'; },
    f => { f.hello.serverVersion = 2; },
    f => { f.hello.executionProfile = 'different'; },
    f => { f.hello.ownerCompatibilityFingerprint = 'c'.repeat(64); },
    f => { delete f.hello.capabilities.terminalCurrentStateV1; },
    f => { delete f.hello.capabilities.terminalHostOutputCreditV1; },
    f => { f.hello.capabilities.executionCandidateProfiles = []; }
  ]) {
    const f = rootBindingFixture(); mutate(f);
    await assert.rejects(compile(['assertRuntimeOwnerBinding'], f.context).assertRuntimeOwnerBinding(f.metadata, f.hello));
  }
  baseline.context.config.rootOwner = false;
  await compile(['assertRuntimeOwnerBinding'], baseline.context).assertRuntimeOwnerBinding({}, { pid: 20 });
});

function fixture({ resetFails = false, nonemptyRegistry = false, platform = 'win32', provider = 'codex' } = {}) {
  const events = [];
  const writes = new Map();
  let entries = chain();
  if (provider === 'claude') entries = entries.filter(entry => entry.wrapperKind !== 'node').map(entry =>
    entry.role === 'cli' ? { ...entry, ppid: 40, firstPpid: 40, firstParentStartTicks: 'win32:4000' } : entry);
  let stopped = false;
  const original = resources(structuredClone(entries));
  const supervisor = entries.find(entry => entry.role === 'supervisor');
  const observer = {
    error: undefined, failures: [],
    start() { events.push('observe-start'); }, async stop() { events.push('observe-stop'); },
    async sample() { events.push('sample'); }, async dispose() { events.push('dispose'); },
    async setLaunch(spec) { events.push('set-launch'); assert.equal(spec.args, '/d /s /c fixed'); },
    async addRoot(pid, role) { events.push(`root:${role}`); },
    result() { return { entries, failures: [], error: this.error }; },
    async cleanupKnownExecution() { events.push('fallback'); return [{ action: 'terminated-original-handle' }]; },
    async cleanupSupervisor(expected) {
      assert.equal(expected.pid, supervisor.pid);
      events.push('stop-supervisor');
      entries = entries.map(entry => entry.role === 'supervisor' ? ended(entry) : entry);
      return [{ pid: expected.pid, startTicks: expected.startTicks, action: 'terminated-original-handle' }];
    }
  };
  const binding = { runtimeBackend: 'legacy-detached', runtimeStoragePath: '/isolated/storage', runtimeSessionId: 'session' };
  const reader = { sessionId: 'session', authorityId: 'authority', readId: 'new-reader' };
  const metadata = () => ({ ...binding, liveSession: !stopped, persistenceMode: 'live-runtime', terminalHistoryDiscarded: stopped });
  const node = () => ({ id: 'node', kind: 'agent', status: stopped ? 'stopped' : 'running', position: { x: 0, y: 0 }, metadata: { agent: metadata() } });
  const setup = { host: identity(11, 'host'), nodeId: 'node', binding, supervisor, reader: { ...reader, readId: 'old-reader' },
    resources: original, frameId: 'old-frame' };
  const control = { phase: 'verify', nonce: 'nonce', deadlineAt: Date.now() + 100000, setup };
  const context = {
    assert, path, observer, observerReleased: false, setupProcessObservationAttempted: false,
    currentNodeId: 'node', reloading: false, phase: 'verify',
    config: { provider, cli: { entry: `/${provider}.cmd` }, launchArguments: [], permittedStorageRoots: ['/isolated'], workspacePath: '/isolated/workspace' },
    control, controlPath: '/control', artifacts: '/artifacts', surface: 'editor',
    process: { pid: 10, platform, env: {}, kill() { throw new Error('Windows cleanup must not signal a PID.'); } },
    AgentProcessObserver: function () { return observer; }, resolveExecutionSessionSpawnSpec: () => ({ args: '/d /s /c fixed' }),
    executionEnded: processObserver.executionEnded, hasLiveWindowsStartupChain: windows.hasLiveWindowsStartupChain,
    sameIdentity: contract.sameIdentity, sameLiveIdentity: contract.sameLiveIdentity, exitedIdentity: contract.exitedIdentity,
    readIdentity: async pid => {
      events.push(`read:${pid}`);
      if (pid === 11) return undefined;
      if (pid === 20) return supervisor;
      if (pid === 10) return entries[0];
      throw new Error('Original Windows execution identities must be read through retained handles.');
    },
    command: async (name, ...args) => {
      events.push(name);
      if (name === 'resetState') { if (resetFails) throw new Error('reset failed'); stopped = true; return; }
      if (name === 'createNode') { stopped = false; return; }
      if (name === 'getRuntimeSupervisorState') return { bindings: [], pendingRuntimeSupervisorOperationCount: 0 };
      if (name === 'getDiagnosticEvents') return stopped ? [{ kind: 'runtime/terminalReadSettled', detail: {
        nodeId: 'node', sessionId: 'session', readId: 'new-reader', outcome: { kind: 'applied' } } }] : [];
      if (name === 'dispatchWebviewMessage' && args[0].type === 'webview/stopExecutionSession') {
        events.push('product-stop'); stopped = true; entries = entries.map(entry => resources([entry]).length ? ended(entry) : entry);
      }
    },
    poll: async (label, get, accept) => { const value = await get(); assert(accept(value), label); return value; },
    snapshot: async () => ({ state: { nodes: stopped ? [] : [node()] }, surfaceLifecycle: { editor: { frameId: 'new-frame' } } }),
    nodeOf: (_state, id) => id === 'node' ? node() : undefined,
    runtimePaths: () => ({ registryPath: '/isolated/registry.json', socketPath: '/isolated/socket' }),
    fs: { readFile: async () => { events.push('read-registry'); return JSON.stringify({ sessions: nonemptyRegistry ? [{}] : [] }); } },
    rpc: async () => { events.push('hello'); return { pid: 20 }; },
    read: async () => ({ host: identity(10, 'host') }),
    write: async (name, value) => { events.push(`write:${name}`); writes.set(name, structuredClone(value)); },
    mountedReader: async () => reader, waitForAgentReady: async () => {}, sendAgentTurn: async () => {},
    probe: async () => ({}), hasAgentMarkerResponse: () => true,
    atomic: async () => {},
    vscode: { commands: { executeCommand: async name => events.push(name) } },
    closeWindowsIdentityObserver: async () => events.push('identity-close'), console
  };
  return { context, observer, events, writes, original, control,
    set entries(value) { entries = value; }, get entries() { return entries; },
    endResources() { entries = entries.map(entry => resources([entry]).length ? ended(entry) : entry); } };
}

test('both reload phases configure the Windows launch before observing its fixed chain', async () => {
  const f = fixture();
  await compile(resourceFunctions, f.context).startProcessObserver({ extensionPath: '/extension' });
  assert(f.events.indexOf('set-launch') < f.events.indexOf('observe-start'));
});

test('actual setup releases retained observer handles before requesting Reload Window', async () => {
  const f = fixture();
  f.context.control.phase = 'setup';
  await compile([...resourceFunctions, 'setup'], f.context).setup({ extensionPath: '/extension' });
  assert(f.events.indexOf('dispose') < f.events.indexOf('workbench.action.reloadWindow'));
  assert.equal(f.writes.get('setup.json').resources.length, 4);
  assert.equal(f.writes.has('setup-process-observation.json'), false);
});

test('Claude setup records safe process identities before rejecting duplicate CLI without replacing the first error', async () => {
  for (const diagnosticFails of [false, true]) {
    const f = fixture({ provider: 'claude' });
    const cli = f.entries.find(entry => entry.role === 'cli');
    f.entries.push({ ...ended(cli), pid: 61, ppid: cli.pid, firstPpid: cli.pid,
      startTicks: 'win32:6100', firstParentStartTicks: cli.startTicks,
      argv: ['private-argument'], env: { SECRET: 'private-environment' } });
    const write = f.context.write;
    f.context.write = async (name, value) => {
      if (name === 'setup-process-observation.json' && diagnosticFails) throw new Error('diagnostic write failed');
      await write(name, value);
    };
    await assert.rejects(compile([...resourceFunctions, 'setup'], f.context).setup({ extensionPath: '/extension' }),
      error => error.code === 'ERR_ASSERTION' && error.message.includes('Exactly one original cli is required.'));
    assert.equal(f.writes.has('setup.json'), false);
    assert(!f.events.includes('workbench.action.reloadWindow'));
    if (!diagnosticFails) {
      const observation = f.writes.get('setup-process-observation.json');
      assert.equal(observation.nonce, 'nonce');
      const originals = observation.entries.filter(entry => entry.role === 'cli');
      assert.deepEqual(originals.map(({ pid, ppid, startTicks, firstPpid, active }) =>
        ({ pid, ppid, startTicks, firstPpid, active })), [
        { pid: 60, ppid: 40, startTicks: 'win32:6000', firstPpid: 40, active: true },
        { pid: 61, ppid: 60, startTicks: 'win32:6100', firstPpid: 60, active: false }
      ]);
      assert.equal(originals[1].firstParentStartTicks, 'win32:6000');
      assert(!/argv|env|private-argument|private-environment/.test(JSON.stringify(observation)));
    }
  }
  const workflow = await fs.readFile('.github/workflows/runtime-production-acceptance.yml', 'utf8');
  assert(workflow.includes('${{ runner.temp }}/dsc-root-agent-*/runtime/artifacts/*.json'));
});

test('Claude setup and reload retain the native provider/cmd/CLI chain without inventing a Codex node wrapper', async () => {
  const f = fixture({ provider: 'claude' });
  const command = f.context.command;
  f.context.command = async (name, ...args) => {
    if (name === 'createNode') assert.equal(args[1], 'claude');
    return command(name, ...args);
  };
  await compile([...resourceFunctions, 'setup'], f.context).setup({ extensionPath: '/extension' });
  assert.equal(f.writes.get('setup.json').resources.length, 3);
  assert.equal(f.writes.get('setup.json').provider, 'claude');
  const verified = fixture({ provider: 'claude' });
  await compile([...resourceFunctions, 'verify'], verified.context).verify({ extensionPath: '/extension' });
  assert.equal(verified.writes.get('verify.json').retainedResources.length, 3);
  assert.equal(verified.writes.get('verify.json').provider, 'claude');
});

test('setup persists original startup ownership before reader, readiness and model-turn failures', async () => {
  for (const stage of ['mountedReader', 'waitForAgentReady', 'sendAgentTurn']) {
    const f = fixture({ provider: 'claude' });
    delete f.context.control.setup;
    f.context.control.phase = 'setup';
    const saved = [];
    f.context.atomic = async (_file, value) => saved.push(structuredClone(value));
    const failure = new Error(`${stage} failed`);
    f.context[stage] = async () => {
      assert.equal(saved.length, 1, 'Ownership must be durable before any fallible interaction.');
      assert.deepEqual(saved[0].startup.resources, f.original);
      assert.equal(saved[0].setup, undefined);
      throw failure;
    };
    const api = compile([...resourceFunctions, 'setup', 'cleanup'], f.context);
    await assert.rejects(api.setup({ extensionPath: '/extension' }), error => error === failure);
    assert.equal(f.writes.has('setup.json'), false);
    assert(!f.events.includes('workbench.action.reloadWindow'));
    f.endResources();
    await api.cleanup();
    assert.equal(f.writes.get('cleanup.json').pass, true);
    assert.equal(f.writes.get('cleanup.json').resourceBaseline, 'startup');
    assert.deepEqual(f.writes.get('cleanup.json').resources.checks.map(x => x.expected), f.original);
  }
});

test('setup cannot promote a replaced startup identity after the model response', async () => {
  for (const inPlace of [false, true]) {
    const f = fixture({ provider: 'claude' });
    delete f.context.control.setup;
    f.context.sendAgentTurn = async () => {
      if (inPlace) f.entries.find(entry => entry.role === 'cli').executable = '/changed-executable';
      else f.entries = f.entries.map(entry => entry.role === 'cli' ? { ...entry, startTicks: 'replacement' } : entry);
    };
    await assert.rejects(compile([...resourceFunctions, 'setup'], f.context).setup({ extensionPath: '/extension' }),
      /Original Agent startup identity must still be live/);
    assert(f.writes.has('startup-ownership.json'));
    assert.equal(f.writes.has('setup.json'), false);
    assert(!f.events.includes('workbench.action.reloadWindow'));
  }
});

test('startup ownership persistence failure stops before interaction; a missing baseline cannot pass cleanup', async () => {
  const f = fixture({ provider: 'claude' });
  delete f.context.control.setup;
  f.context.atomic = async () => { throw new Error('ownership write failed'); };
  f.context.mountedReader = async () => assert.fail('No interaction before durable ownership.');
  const api = compile([...resourceFunctions, 'setup', 'cleanup'], f.context);
  await assert.rejects(api.setup({ extensionPath: '/extension' }), /ownership write failed/);
  f.endResources();
  await assert.rejects(api.cleanup(), /Missing original startup resources/);
  assert.equal(f.writes.get('cleanup.json').pass, false);
  assert(!f.events.includes('stop-supervisor'));
});

test('live identity proof rejects empty, missing, replaced and ended originals', () => {
  for (const change of [() => [], entries => entries.filter(entry => entry.role !== 'provider'),
    entries => entries.filter(entry => entry.wrapperKind !== 'cmd'),
    entries => entries.map(entry => entry.role === 'cli' ? { ...entry, startTicks: 'win32:reused' } : entry),
    entries => entries.map(entry => entry.role === 'cli' ? ended(entry) : entry)]) {
    const f = fixture();
    const api = compile(resourceFunctions, f.context);
    assert.equal(api.assertOriginalResourcesLive(f.original).length, 4);
    f.entries = change(f.entries);
    assert.throws(() => api.assertOriginalResourcesLive(f.original));
  }
});

test('Windows resource release uses retained exits and never reopens the execution PIDs', async () => {
  const f = fixture();
  const api = compile(resourceFunctions, f.context);
  assert.equal((await api.originalResourcesExited(f.original)).pass, false);
  f.endResources();
  assert.equal((await api.originalResourcesExited(f.original)).pass, true);
  assert(!f.events.some(value => value.startsWith('read:')));
  f.entries = f.entries.filter(entry => entry.role !== 'cli');
  assert.equal((await api.originalResourcesExited(f.original)).pass, false);
  await assert.rejects(api.originalResourcesExited([]));
});

test('actual verify admits stop only after complete original live identity proof', async () => {
  for (const replaced of [false, true]) {
    const f = fixture();
    if (replaced) f.entries = f.entries.map(entry => entry.role === 'cli' ? { ...entry, startTicks: 'win32:999' } : entry);
    const api = compile([...resourceFunctions, 'verify'], f.context);
    if (replaced) {
      await assert.rejects(api.verify({ extensionPath: '/extension' }));
      assert(!f.events.includes('product-stop'));
    } else {
      await api.verify({ extensionPath: '/extension' });
      assert(f.events.indexOf('set-launch') < f.events.indexOf('product-stop'));
      assert(f.events.indexOf('write:pre-stop-ownership.json') < f.events.indexOf('product-stop'));
      assert.equal(f.writes.get('verify.json').originalResourcesExited, true);
    }
  }
});

test('actual reload verify rejects changed original owner fields before model input or product stop', async () => {
  for (const mutate of [
    owner => { owner.environmentKey = 'c'.repeat(64); },
    owner => { owner.userStorageScopeKey = 'c'.repeat(64); },
    owner => { owner.root.normalizedPath = path.resolve('/other-root'); },
    owner => { owner.generation = 'unsupported'; }
  ]) {
    const f = fixture();
    const { metadata } = rootBindingFixture();
    f.control.setup.binding.runtimeOwner = structuredClone(metadata.runtimeOwner);
    const originalNodeOf = f.context.nodeOf;
    f.context.nodeOf = (...args) => {
      const node = originalNodeOf(...args);
      const owner = structuredClone(metadata.runtimeOwner); mutate(owner);
      return { ...node, metadata: { agent: { ...node.metadata.agent, runtimeOwner: owner } } };
    };
    f.context.sendAgentTurn = async () => assert.fail('An altered original owner must not receive a model turn.');
    await assert.rejects(compile([...resourceFunctions, 'verify'], f.context).verify({ extensionPath: '/extension' }));
    assert(!f.events.includes('hello'));
    assert(!f.events.includes('product-stop'));
  }
});

test('model response gate accepts actual assistant markers and rejects echoed prompts for both providers', () => {
  const declaration = ast.statements.filter(ts.isVariableStatement).flatMap(node => [...node.declarationList.declarations])
    .find(node => node.name.getText(ast) === 'hasAgentMarkerResponse');
  const matches = new Function('currentNodeId', 'stripVt', `return ${declaration.initializer.getText(ast)};`)(
    'node', value => value);
  const marker = 'DSC_AGENT_RELOAD_BEFORE_nonce';
  for (const prefix of ['', '\u2022 ', '\u25cf ', '\u23fa ', '* ']) {
    assert.equal(matches({ nodes: [{ nodeId: 'node', terminalVisibleLines: [`${prefix}${marker}`] }] }, marker), true);
  }
  for (const line of [`Reply with exactly ${marker} and nothing else.`, `\u276f Reply with exactly ${marker}`,
    'Claude Code\ndeepseek-flash', 'Ask Codex to do anything']) {
    assert.equal(matches({ nodes: [{ nodeId: 'node', terminalVisibleLines: [line] }] }, marker), false);
  }
  assert.equal(matches({ nodes: [{ nodeId: 'other-node', terminalVisibleLines: [marker] }] }, marker), false);
});

test('normal cleanup proves empty registry before Supervisor stop and releases observer', async () => {
  const f = fixture(); f.endResources();
  await compile([...resourceFunctions, 'cleanup'], f.context).cleanup();
  assert(f.events.indexOf('read-registry') < f.events.indexOf('stop-supervisor'));
  assert(f.events.indexOf('stop-supervisor') < f.events.indexOf('dispose'));
  assert.deepEqual(f.writes.get('cleanup.json').fallback, []);
  assert.equal(f.writes.get('cleanup.json').pass, true);
});

test('failed reset or nonempty registry cannot stop Supervisor or turn fallback into success', async () => {
  for (const options of [{ resetFails: true }, { nonemptyRegistry: true }]) {
    const f = fixture(options); f.endResources();
    await assert.rejects(compile([...resourceFunctions, 'cleanup'], f.context).cleanup());
    assert(!f.events.includes('stop-supervisor'));
    assert(f.events.includes('fallback'));
    assert(f.events.includes('dispose'));
    assert.equal(f.writes.get('cleanup.json').pass, false);
  }
});

test('observer disposal remains idempotent and runs even when stop fails', async () => {
  const f = fixture();
  f.observer.stop = async () => { throw new Error('stop failed'); };
  const api = compile(resourceFunctions, f.context);
  await assert.rejects(api.releaseProcessObserver());
  await api.releaseProcessObserver();
  assert.equal(f.events.filter(value => value === 'dispose').length, 1);
});

test('actual run quits only the isolated macOS application, leaving other platform commands unchanged', async () => {
  for (const platform of ['darwin', 'linux', 'win32']) {
    const f = fixture({ platform });
    f.context.fs.readFile = async file => JSON.stringify(file === '/control' ? { phase: 'verify', nonce: 'nonce' } : {});
    f.context.process.env.DEV_SESSION_CANVAS_AGENT_RELOAD_CONFIG = '/config';
    Object.assign(f.context, {
      activateVisibleExtension: async () => ({}), waitForCommand: async () => {},
      captureInstalledExtensionReceipt: async () => ({}), verify: async () => {}, cleanup: async () => {},
      setup: async () => { throw new Error('Unexpected setup phase'); }
    });
    await compile(['run'], f.context).run();
    assert(f.events.includes(platform === 'darwin' ? 'workbench.action.quit' : 'workbench.action.closeWindow'));
    assert.equal(f.writes.get('driver-finished.json').pass, true);
  }
});

test('failure captures the actual Webview probe without replacing the original failure', async () => {
  for (const captureFails of [false, true]) {
    const f = fixture();
    const original = new Error('original readiness failure');
    const visible = { nodes: [{ nodeId: 'node', terminalVisibleLines: ['Trust this folder?'] }] };
    f.context.fs.readFile = async file => JSON.stringify(file === '/control' ? { phase: 'verify', nonce: 'nonce' } : {});
    f.context.process.env.DEV_SESSION_CANVAS_AGENT_RELOAD_CONFIG = '/config';
    Object.assign(f.context, {
      activateVisibleExtension: async () => ({}), waitForCommand: async () => {},
      captureInstalledExtensionReceipt: async () => ({}), verify: async () => { throw original; }, cleanup: async () => {},
      probe: async () => { f.events.push('failure-probe'); if (captureFails) throw new Error('secondary probe failure'); return visible; }
    });
    await compile(['run'], f.context).run();
    assert.equal(f.events.filter(value => value === 'failure-probe').length, 1);
    assert.equal(f.writes.get('verify-failure.json').error, String(original));
    assert.equal(f.writes.get('driver-finished.json').pass, false);
    assert.deepEqual(f.writes.get('failure-webview-probe.json'), captureFails ? undefined : visible);
    assert(f.writes.has('failure-getDiagnosticEvents.json'), 'A failed probe must not skip remaining evidence.');
  }
});

test('Claude setup failure captures the same safe process observation once before cleanup and preserves its first error', async () => {
  for (const scenario of ['early', 'resource', 'diagnostic-failed', 'resource-diagnostic-failed', 'codex']) {
    const f = fixture({ provider: scenario === 'codex' ? 'codex' : 'claude' });
    const original = new Error('original readiness failure');
    const config = f.context.config;
    f.context.fs.readFile = async file => JSON.stringify(file === '/control' ? { phase: 'setup', nonce: 'nonce' } : config);
    f.context.process.env.DEV_SESSION_CANVAS_AGENT_RELOAD_CONFIG = '/config';
    f.entries[0].argv = ['private-argument'];
    f.entries[0].env = { SECRET: 'private-environment' };
    if (scenario.startsWith('resource')) f.entries.push({ ...f.entries.find(entry => entry.role === 'cli'), pid: 61, startTicks: 'win32:6100' });
    Object.assign(f.context, {
      activateVisibleExtension: async () => ({}), waitForCommand: async () => {},
      captureInstalledExtensionReceipt: async () => ({}), cleanup: async () => f.events.push('cleanup'),
      waitForAgentReady: async () => { if (!scenario.startsWith('resource')) throw original; }
    });
    const write = f.context.write;
    f.context.write = async (name, value) => {
      if (name === 'setup-process-observation.json') {
        f.events.push('observation-attempt');
        if (scenario.endsWith('diagnostic-failed')) throw new Error('diagnostic write failed');
      }
      await write(name, value);
    };
    await compile(['run', 'setup', ...resourceFunctions], f.context).run();
    assert.equal(f.events.filter(event => event === 'observation-attempt').length, scenario === 'codex' ? 0 : 1);
    const failure = f.writes.get('setup-failure.json');
    if (scenario.startsWith('resource')) assert.match(failure.error, /Exactly one original cli is required/);
    else assert.equal(failure.error, String(original));
    assert.equal(f.writes.get('driver-finished.json').pass, false);
    if (scenario !== 'codex') {
      assert(f.events.indexOf('observation-attempt') < f.events.indexOf('cleanup'));
      if (!scenario.startsWith('resource')) assert(f.events.indexOf('write:setup-failure.json') < f.events.indexOf('observation-attempt'));
    }
    if (scenario === 'early' || scenario === 'resource') {
      const observation = f.writes.get('setup-process-observation.json');
      assert.equal(observation.nonce, 'nonce');
      assert.equal(observation.entries.length, f.entries.length);
      assert(!/argv|env|private-argument|private-environment/.test(JSON.stringify(observation)));
    }
  }
});
