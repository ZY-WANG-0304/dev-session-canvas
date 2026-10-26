import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import ts from 'typescript';
import esbuild from 'esbuild';

// Execute the actual methods and configuration helpers, with only the VS Code
// environment replaced. Real API cost is measured separately in a real Host.
const directory = await mkdtemp(path.join(os.tmpdir(), 'dsc-config-reuse-'));
const filename = path.resolve('extensions/vscode/dev-session-canvas/src/panel/CanvasPanelManager.ts');
const source = await readFile(filename, 'utf8');
const ast = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true);
const declaration = ast.statements.find(n => ts.isClassDeclaration(n) && n.name?.text === 'CanvasPanelManager');
const names = ['getRuntimeContext', 'getSidebarState', 'getCanvasFileViewConfiguration', 'getAgentCliConfig',
  'getAgentLaunchDefaults', 'getAgentLaunchDefaultsByProvider', 'getTerminalScrollback',
  'getCanvasOverviewMode', 'getCanvasOverviewZoomThreshold', 'getCanvasMultiRootPresentationMode',
  'getWorkspaceRootWatermarksEnabled', 'getConfiguredSurface', 'getWorkspaceFoldersForDisplay',
  'getNoteMarkdownImageWorkspaceRoots'];
const methods = names.map(name => declaration.members.find(n => n.name?.getText(ast) === name).getText(ast)).join('\n');
let values = {}, inspections = {}, acquisitions = [], reads = [];
const vscode = {
  ExtensionMode: { Production: 1, Development: 2, Test: 3 },
  env: { shell: '/bin/sh' },
  workspace: { isTrusted: true, workspaceFolders: [{ name: 'fixture', uri: { fsPath: '/fixture' } }],
    getConfiguration(section, scope) {
      acquisitions.push({ section, scope });
      const snapshot = structuredClone(values), inspected = structuredClone(inspections);
      return {
        get(key, fallback) { const full = section ? `${section}.${key}` : key;
          reads.push(full); return snapshot[full] ?? fallback; },
        inspect(key) { return inspected[key]; }
      };
    }
  }
};
globalThis.__dscConfigurationTest = vscode;
try {
  const outfile = path.join(directory, 'harness.cjs');
  await esbuild.build({ stdin: { contents: `${ast.statements.filter(ts.isImportDeclaration).map(n => n.getText(ast)).join('\n')}
    const cloneJsonValue = value => JSON.parse(JSON.stringify(value));
    export class Harness {
      context = { extensionMode: 2 }; activeSurface = 'panel';
      appliedStartupConfiguration = { defaultSurface: 'editor', filesFeatureEnabled: true, runtimePersistenceEnabled: true };
      fileFilterState = { includeGlobs: ['**/*.ts'], excludeGlobs: ['**/node_modules/**'] };
      state = { nodes: [{ id: 'a' }, { id: 't' }] }; agentSessions = new Map([['a', {}]]); terminalSessions = new Map([['t', {}]]);
      enabledAttentionSignals = new Set(['osc9']); attentionNotificationBridgeMode = 'system';
      strongTerminalAttentionReminderMode = 'title'; agentAbnormalOutputTextNotificationMode = 'off';
      getActiveWebview() { return undefined; } getSurfaceVisibility() { return 'visible'; }
      resolveTerminalShellPathForConfigurationCwd(value) { return value; }
      formatWebviewResourceBaseUri(webview, uri) { return 'resource:' + uri.fsPath; }
      ${methods}
    }`, loader: 'ts', resolveDir: path.dirname(filename) },
    bundle: true, platform: 'node', format: 'cjs', outfile,
    plugins: [{ name: 'vscode-fixture', setup(build) {
      build.onResolve({ filter: /^vscode$/ }, () => ({ path: 'vscode', namespace: 'fixture' }));
      build.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: 'module.exports = globalThis.__dscConfigurationTest;' }));
    } }] });
  const { Harness } = createRequire(import.meta.url)(outfile);
  const host = new Harness();
  values = {
    'devSessionCanvas.agent.defaultProvider': 'claude',
    'devSessionCanvas.agent.codexCommand': '  /fixture/codex  ',
    'devSessionCanvas.agent.claudeCommand': '  /fixture/claude  ',
    'devSessionCanvas.agent.codexDefaultArgs': ' --model test ',
    'devSessionCanvas.agent.claudeDefaultArgs': ' --verbose ',
    'devSessionCanvas.files.presentationMode': 'nodes',
    'devSessionCanvas.fileNode.displayStyle': 'card',
    'devSessionCanvas.files.nodeDisplayMode': 'path-only',
    'devSessionCanvas.files.pathDisplayMode': 'relative-path',
    'devSessionCanvas.canvas.overviewMode': 'off',
    'devSessionCanvas.canvas.workspaceRootWatermarks.enabled': false,
    'terminal.integrated.scrollback': 7654,
    'terminal.integrated.wordSeparators': ' |;',
    'editor.multiCursorModifier': 'ctrlCmd'
  };
  const runtime = host.getRuntimeContext({});
  assert.equal(runtime.defaultAgentProvider, 'claude');
  assert.deepEqual(runtime.agentLaunchDefaults, { codex: { command: '/fixture/codex', defaultArgs: '--model test' },
    claude: { command: '/fixture/claude', defaultArgs: '--verbose' } });
  assert.equal(runtime.filePresentationMode, 'nodes'); assert.equal(runtime.fileNodeDisplayStyle, 'card');
  assert.equal(runtime.fileNodeDisplayMode, 'path-only'); assert.equal(runtime.filePathDisplayMode, 'relative-path');
  assert.equal(runtime.terminalScrollback, 7654); assert.equal(runtime.editorMultiCursorModifier, 'ctrlCmd');
  assert.equal(runtime.terminalWordSeparators, ' |;'); assert.equal(runtime.workspaceRootWatermarksEnabled, false);
  assert.deepEqual(runtime.noteMarkdownImageWorkspaceRoots, [{ name: 'fixture', webviewResourceBaseUri: 'resource:/fixture' }]);
  assert.deepEqual(acquisitions.map(a => a.section), [undefined, 'terminal.integrated', 'editor', 'terminal.integrated']);
  assert(acquisitions.every(a => a.scope === undefined));
  for (const key of ['defaultProvider', 'codexCommand', 'claudeCommand', 'codexDefaultArgs', 'claudeDefaultArgs']) {
    assert.equal(reads.filter(k => k === `devSessionCanvas.agent.${key}`).length, 1);
  }
  inspections = {
    'devSessionCanvas.terminal.shell': { defaultValue: 'default', globalValue: 'bash', workspaceValue: 'default' },
    'devSessionCanvas.terminal.shellPath': { globalValue: '/global/sh', workspaceValue: '/workspace/sh', workspaceFolderValue: '/folder/sh' }
  };
  acquisitions = []; reads = [];
  const sidebar = host.getSidebarState();
  assert.equal(sidebar.terminalShellPath, '/folder/sh');
  assert.equal(sidebar.agentCodexCommand, runtime.agentLaunchDefaults.codex.command);
  assert.equal(sidebar.agentClaudeCommand, runtime.agentLaunchDefaults.claude.command);
  assert.equal(sidebar.nodeCount, 2); assert.equal(sidebar.runningExecutionCount, 2);
  assert.equal(sidebar.filePresentationMode, runtime.filePresentationMode);
  assert.deepEqual(acquisitions, [{ section: undefined, scope: undefined }]);
  sidebar.fileFilters.includeGlobs.push('mutated');
  assert.deepEqual(host.fileFilterState.includeGlobs, ['**/*.ts']);
  values = { 'devSessionCanvas.agent.codexCommand': '  ', 'devSessionCanvas.agent.defaultProvider': 'invalid',
    'devSessionCanvas.files.presentationMode': 'invalid' };
  inspections = {};
  const fresh = host.getRuntimeContext();
  assert.equal(fresh.defaultAgentProvider, 'codex');
  assert.equal(fresh.agentLaunchDefaults.codex.command, 'codex');
  assert.equal(fresh.agentLaunchDefaults.claude.command, 'claude');
  assert.equal(fresh.filePresentationMode, 'lists');
  assert.equal(fresh.noteMarkdownImageWorkspaceRoots, undefined);
  assert.equal(host.getSidebarState().terminalShellPath, '/bin/sh');
  assert.equal(runtime.agentLaunchDefaults.codex.command, '/fixture/codex', 'later calls do not mutate prior payload');
  const previous = process.env.DEV_SESSION_CANVAS_TEST_CODEX_COMMAND;
  try {
    host.context.extensionMode = 3; process.env.DEV_SESSION_CANVAS_TEST_CODEX_COMMAND = ' /fixture/override ';
    assert.equal(host.getRuntimeContext().agentLaunchDefaults.codex.command, '/fixture/override');
    assert.equal(host.getAgentLaunchDefaults('codex').command, '/fixture/override');
  } finally {
    if (previous === undefined) delete process.env.DEV_SESSION_CANVAS_TEST_CODEX_COMMAND;
    else process.env.DEV_SESSION_CANVAS_TEST_CODEX_COMMAND = previous;
  }
  console.log('PASS actual runtime/sidebar methods: scoped configuration, one acquisition, provider defaults, fresh reads, shell inspect precedence, payload independence, test override');
} finally { delete globalThis.__dscConfigurationTest; await rm(directory, { recursive: true, force: true }); }
