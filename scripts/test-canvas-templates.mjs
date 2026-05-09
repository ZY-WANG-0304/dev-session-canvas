import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

import esbuild from 'esbuild';

const tempDir = await mkdtemp(path.join(os.tmpdir(), 'dsc-canvas-templates-'));

try {
  const outfile = path.join(tempDir, 'canvasTemplates.cjs');

  await esbuild.build({
    stdin: {
      contents: `
        export * from './src/common/canvasTemplates';
        export * from './src/panel/CanvasTemplateStore';
      `,
      resolveDir: process.cwd(),
      sourcefile: 'canvas-templates-entry.ts'
    },
    bundle: true,
    format: 'cjs',
    outfile,
    platform: 'node',
    target: 'node18'
  });

  const require = createRequire(import.meta.url);
  const {
    CanvasTemplateStore,
    buildCanvasTemplateDocument,
    captureCanvasTemplateFromState,
    encodeCanvasTemplateDocument,
    formatCanvasTemplateStats,
    parseCanvasTemplateDocument,
    sanitizeCanvasTemplateFileStem
  } = require(outfile);

  const builtinDir = path.join(tempDir, 'builtin');
  const workspaceUserDir = path.join(tempDir, 'workspace-user');
  const globalUserDir = path.join(tempDir, 'global-user');
  await mkdir(builtinDir, { recursive: true });
  await mkdir(workspaceUserDir, { recursive: true });
  await mkdir(globalUserDir, { recursive: true });

  const builtinTemplateA = {
    id: 'builtin-a',
    name: 'Builtin A',
    category: 'builtin',
    createdAt: '2026-05-06T00:00:00.000Z',
    updatedAt: '2026-05-06T00:00:00.000Z',
    nodes: [
      {
        kind: 'note',
        title: 'Welcome',
        position: { x: 0, y: 0 },
        size: { width: 320, height: 240 },
        metadata: { note: { content: 'hello' } }
      }
    ],
    edges: []
  };
  const builtinTemplateB = {
    id: 'builtin-b',
    name: 'Builtin B',
    category: 'builtin',
    createdAt: '2026-05-06T00:00:00.000Z',
    updatedAt: '2026-05-06T00:00:00.000Z',
    nodes: [
      {
        kind: 'agent',
        title: 'Agent A',
        position: { x: 0, y: 0 },
        size: { width: 320, height: 240 },
        metadata: { agent: { provider: 'default' } }
      },
      {
        kind: 'terminal',
        title: 'Terminal B',
        position: { x: 360, y: 0 },
        size: { width: 320, height: 240 }
      }
    ],
    edges: []
  };
  const userTemplate = {
    id: 'user-a',
    name: 'User Template',
    category: 'user',
    createdAt: '2026-05-07T00:00:00.000Z',
    updatedAt: '2026-05-07T00:00:00.000Z',
    nodes: [
      {
        kind: 'note',
        title: 'User Note',
        position: { x: 0, y: 0 },
        size: { width: 320, height: 240 },
        metadata: { note: { content: 'world' } }
      }
    ],
    edges: []
  };

  await writeFile(
    path.join(builtinDir, '01-a.json'),
    `${JSON.stringify(buildCanvasTemplateDocument(builtinTemplateA), null, 2)}\n`
  );
  await writeFile(
    path.join(builtinDir, '02-b.json'),
    `${JSON.stringify(buildCanvasTemplateDocument(builtinTemplateB), null, 2)}\n`
  );
  await writeFile(path.join(globalUserDir, 'broken.json'), '{ this is not valid json\n');

  const store = new CanvasTemplateStore(builtinDir, [
    {
      id: 'workspace',
      label: 'Workspace',
      rootPath: workspaceUserDir,
      scope: 'workspace'
    },
    {
      id: 'global',
      label: 'Current Device',
      rootPath: globalUserDir,
      scope: 'global'
    }
  ]);
  const savedUserTemplate = await store.writeUserTemplate(userTemplate);
  assert.ok(savedUserTemplate.filePath.startsWith(globalUserDir));
  assert.match(path.basename(savedUserTemplate.filePath), /User-Template-user-a\.json$/);

  const workspaceTemplate = {
    ...userTemplate,
    id: 'user-workspace',
    name: 'Workspace Template',
    createdAt: '2026-05-08T00:00:00.000Z',
    updatedAt: '2026-05-08T00:00:00.000Z'
  };
  const savedWorkspaceTemplate = await store.writeUserTemplate(workspaceTemplate, {
    targetRootPath: workspaceUserDir,
    relativeDirectory: 'team/backend'
  });
  assert.ok(savedWorkspaceTemplate.filePath.startsWith(workspaceUserDir));
  assert.strictEqual(savedWorkspaceTemplate.relativeDirectory, path.join('team', 'backend'));

  const catalog = await store.listTemplates();
  assert.deepStrictEqual(
    catalog.templates.map((entry) => entry.template.id),
    ['builtin-a', 'builtin-b', 'user-workspace', 'user-a']
  );
  assert.strictEqual(catalog.issues.length, 1);
  assert.match(catalog.issues[0].message, /JSON/);
  assert.strictEqual(formatCanvasTemplateStats(builtinTemplateB), '1 Agent, 1 Terminal');

  const exportPath = path.join(tempDir, 'exports', 'template-export.json');
  await store.exportTemplateToFile(userTemplate, exportPath);
  const exportedText = await readFile(exportPath, 'utf8');
  assert.deepStrictEqual(parseCanvasTemplateDocument(JSON.parse(exportedText)).document.template, userTemplate);

  const captureState = {
    version: 1,
    updatedAt: '2026-05-06T10:00:00.000Z',
    nodes: [
      {
        id: 'agent-1',
        kind: 'agent',
        title: 'Planner',
        status: 'running',
        summary: 'summary',
        position: { x: 100, y: 140 },
        size: { width: 520, height: 380 },
        metadata: { agent: { provider: 'claude', templateArgv: ['--model', 'sonnet'] } }
      },
      {
        id: 'terminal-1',
        kind: 'terminal',
        title: 'Terminal',
        status: 'running',
        summary: 'summary',
        position: { x: 700, y: 140 },
        size: { width: 500, height: 360 },
        metadata: { terminal: {} }
      },
      {
        id: 'note-1',
        kind: 'note',
        title: 'Notes',
        status: 'ready',
        summary: 'summary',
        position: { x: 220, y: 560 },
        size: { width: 420, height: 240 },
        metadata: { note: { content: 'remember this' } }
      },
      {
        id: 'file-1',
        kind: 'file',
        title: 'ignore.ts',
        status: 'ready',
        summary: 'summary',
        position: { x: 1500, y: 300 },
        size: { width: 280, height: 120 },
        metadata: { file: { filePath: 'src/ignore.ts', ownerNodeIds: ['agent-1'], accessMode: 'read' } }
      }
    ],
    edges: [
      {
        id: 'edge-user',
        sourceNodeId: 'agent-1',
        targetNodeId: 'terminal-1',
        sourceAnchor: 'right',
        targetAnchor: 'left',
        arrowMode: 'forward',
        owner: 'user',
        label: 'run'
      },
      {
        id: 'edge-auto',
        sourceNodeId: 'agent-1',
        targetNodeId: 'file-1',
        sourceAnchor: 'bottom',
        targetAnchor: 'top',
        arrowMode: 'none',
        owner: 'automatic'
      }
    ],
    fileReferences: [],
    suppressedFileActivityEdgeIds: [],
    suppressedAutomaticFileArtifactNodeIds: []
  };

  const capturedDefault = captureCanvasTemplateFromState({
    state: captureState,
    name: 'Captured Template',
    templateId: 'captured-template',
    category: 'user',
    agentProviderSelection: 'default',
    now: '2026-05-06T10:00:00.000Z'
  });

  assert.deepStrictEqual(capturedDefault.ignoredNodeIds, ['file-1']);
  assert.deepStrictEqual(capturedDefault.ignoredEdgeIds, ['edge-auto']);
  assert.strictEqual(capturedDefault.template.nodes.length, 3);
  assert.deepStrictEqual(capturedDefault.template.nodes[0].position, { x: 0, y: 0 });
  assert.strictEqual(capturedDefault.template.nodes[0].metadata.agent.provider, 'default');
  assert.deepStrictEqual(capturedDefault.template.nodes[0].metadata.agent.argv, ['--model', 'sonnet']);
  assert.strictEqual(capturedDefault.template.edges.length, 1);
  assert.strictEqual(capturedDefault.template.edges[0].label, 'run');

  const capturedPreserved = captureCanvasTemplateFromState({
    state: captureState,
    name: 'Captured Template',
    templateId: 'captured-template-preserved',
    category: 'user',
    agentProviderSelection: 'preserve',
    now: '2026-05-06T10:00:00.000Z'
  });
  assert.strictEqual(capturedPreserved.template.nodes[0].metadata.agent.provider, 'claude');
  assert.deepStrictEqual(capturedPreserved.template.nodes[0].metadata.agent.argv, ['--model', 'sonnet']);

  const capturedPerAgent = captureCanvasTemplateFromState({
    state: captureState,
    name: 'Captured Template',
    templateId: 'captured-template-per-agent',
    category: 'user',
    agentProviderSelection: {
      'agent-1': 'default'
    },
    now: '2026-05-06T10:00:00.000Z'
  });
  assert.strictEqual(capturedPerAgent.template.nodes[0].metadata.agent.provider, 'default');

  const objectAgentId = 'agent-7-11111111-1111-4111-8111-111111111111';
  const objectTerminalId = 'terminal-8-22222222-2222-4222-8222-222222222222';
  const objectNoteId = 'note-9-33333333-3333-4333-8333-333333333333';
  const capturedObjectIds = captureCanvasTemplateFromState({
    state: {
      version: 1,
      updatedAt: '2026-05-09T00:00:00.000Z',
      nodes: [
        {
          id: objectAgentId,
          kind: 'agent',
          title: 'Object Identity Agent',
          status: 'idle',
          summary: '',
          position: { x: 20, y: 30 },
          size: { width: 320, height: 240 },
          metadata: { agent: { provider: 'codex', templateArgv: ['--yolo'] } }
        },
        {
          id: objectTerminalId,
          kind: 'terminal',
          title: 'Object Identity Terminal',
          status: 'idle',
          summary: '',
          position: { x: 380, y: 30 },
          size: { width: 320, height: 240 },
          metadata: { terminal: {} }
        },
        {
          id: objectNoteId,
          kind: 'note',
          title: 'Object Identity Note',
          status: 'ready',
          summary: '',
          position: { x: 20, y: 320 },
          size: { width: 320, height: 180 },
          metadata: { note: { content: 'saved without object ids' } }
        }
      ],
      edges: [
        {
          id: 'object-edge',
          sourceNodeId: objectAgentId,
          targetNodeId: objectNoteId,
          sourceAnchor: 'bottom',
          targetAnchor: 'top',
          arrowMode: 'forward',
          owner: 'user'
        }
      ],
      fileReferences: [],
      suppressedFileActivityEdgeIds: [],
      suppressedAutomaticFileArtifactNodeIds: []
    },
    name: 'Captured Object Identity Template',
    templateId: 'captured-object-identity-template',
    category: 'user',
    agentProviderSelection: {
      [objectAgentId]: 'claude'
    },
    now: '2026-05-09T00:00:00.000Z'
  });
  assert.strictEqual(capturedObjectIds.template.nodes[0].metadata.agent.provider, 'claude');
  assert.deepStrictEqual(capturedObjectIds.template.nodes[0].metadata.agent.argv, ['--yolo']);
  assert.deepStrictEqual(capturedObjectIds.template.edges[0], {
    sourceNodeIndex: 0,
    targetNodeIndex: 2,
    sourceAnchor: 'bottom',
    targetAnchor: 'top',
    arrowMode: 'forward',
    color: undefined,
    label: undefined
  });
  const capturedObjectIdTemplateText = JSON.stringify(capturedObjectIds.template);
  assert.ok(!capturedObjectIdTemplateText.includes(objectAgentId));
  assert.ok(!capturedObjectIdTemplateText.includes(objectTerminalId));
  assert.ok(!capturedObjectIdTemplateText.includes(objectNoteId));

  assert.strictEqual(
    sanitizeCanvasTemplateFileStem('  team workflow / draft  ', 'user-template-1234567890'),
    'team-workflow-draft-user-templat'
  );

  const roundTripText = encodeCanvasTemplateDocument(userTemplate);
  assert.deepStrictEqual(parseCanvasTemplateDocument(JSON.parse(roundTripText)).document.template, userTemplate);

  const extensionSource = await readFile('src/extension.ts', 'utf8');
  const exportCommandSource = sliceBetween(
    extensionSource,
    'async function exportCanvasTemplateFromCommand',
    'async function deleteCanvasTemplateFromCommand'
  );
  assert.match(
    exportCommandSource,
    /exportCanvasTemplateById\(selectedTemplate\.template\.id, targetUri\)/u
  );
  assert.doesNotMatch(exportCommandSource, /targetUri\.fsPath/u);
  assert.match(extensionSource, /resetDefaultCanvasTemplateWithConfirmation/u);
  assert.match(extensionSource, /resetCanvasTemplateByIdWithConfirmation\(selectedTemplate\.template\.id/u);
  const applyDefaultCommandSource = sliceBetween(
    extensionSource,
    'vscode.commands.registerCommand(COMMAND_IDS.applyDefaultTemplate',
    'vscode.commands.registerCommand(COMMAND_IDS.resetToTemplate'
  );
  assert.match(applyDefaultCommandSource, /const appliedNodeIds = await panelManager\.applyDefaultCanvasTemplate\(\)/u);
  assert.match(
    applyDefaultCommandSource,
    /await panelManager\.revealOrCreate\(\);[\s\S]*panelManager\.focusCanvasTemplateNodeGroup\(appliedNodeIds\)/u
  );
  assert.doesNotMatch(applyDefaultCommandSource, /focusAppliedNodes: true/u);
  const resetDefaultCommandSource = sliceBetween(
    extensionSource,
    'vscode.commands.registerCommand(COMMAND_IDS.resetToDefaultTemplate',
    'vscode.commands.registerCommand(COMMAND_IDS.saveCanvasAsTemplate'
  );
  assert.match(resetDefaultCommandSource, /const appliedNodeIds = await panelManager\.resetDefaultCanvasTemplateWithConfirmation\(\)/u);
  assert.match(
    resetDefaultCommandSource,
    /if \(appliedNodeIds\) \{[\s\S]*await panelManager\.revealOrCreate\(\);[\s\S]*panelManager\.focusCanvasTemplateNodeGroup\(appliedNodeIds\)/u
  );
  assert.doesNotMatch(resetDefaultCommandSource, /focusAppliedNodes: true/u);
  const applyTemplateCommandSource = sliceBetween(
    extensionSource,
    'async function applyTemplateFromCommand',
    'async function resetToTemplateFromCommand'
  );
  assert.match(applyTemplateCommandSource, /const appliedNodeIds = await panelManager\.applyCanvasTemplateById/u);
  assert.match(
    applyTemplateCommandSource,
    /await panelManager\.revealOrCreate\(\);[\s\S]*panelManager\.focusCanvasTemplateNodeGroup\(appliedNodeIds\)/u
  );
  assert.doesNotMatch(applyTemplateCommandSource, /focusAppliedNodes: true/u);
  const resetTemplateCommandSource = sliceBetween(
    extensionSource,
    'async function resetToTemplateFromCommand',
    'async function saveCurrentCanvasAsTemplateFromCommand'
  );
  assert.match(resetTemplateCommandSource, /const appliedNodeIds = await panelManager\.resetCanvasTemplateByIdWithConfirmation/u);
  assert.match(
    resetTemplateCommandSource,
    /if \(appliedNodeIds\) \{[\s\S]*await panelManager\.revealOrCreate\(\);[\s\S]*panelManager\.focusCanvasTemplateNodeGroup\(appliedNodeIds\)/u
  );
  assert.doesNotMatch(resetTemplateCommandSource, /focusAppliedNodes: true/u);

  const panelManagerSource = await readFile('src/panel/CanvasPanelManager.ts', 'utf8');
  const exportTemplateMethodSource = sliceBetween(
    panelManagerSource,
    'public async exportCanvasTemplateById',
    'public async deleteCanvasTemplateById'
  );
  assert.match(exportTemplateMethodSource, /vscode\.workspace\.fs\.writeFile/u);
  assert.match(exportTemplateMethodSource, /encodeCanvasTemplateDocument/u);
  assert.match(panelManagerSource, /private async confirmCanvasTemplateReset/u);
  assert.match(panelManagerSource, /vscode\.window\.showWarningMessage/u);
  assert.match(panelManagerSource, /public focusCanvasTemplateNodeGroup\(nodeIds: readonly string\[\]\): void/u);
  const resetDefaultTemplateMethodSource = sliceBetween(
    panelManagerSource,
    'public async resetDefaultCanvasTemplateWithConfirmation',
    'public async resetCanvasTemplateByIdWithConfirmation'
  );
  assert.match(resetDefaultTemplateMethodSource, /Promise<string\[\] \| undefined>/u);
  assert.match(resetDefaultTemplateMethodSource, /return this\.applyCanvasTemplateRecord/u);
  const resetTemplateMethodSource = sliceBetween(
    panelManagerSource,
    'public async resetCanvasTemplateByIdWithConfirmation',
    'public focusCanvasTemplateNodeGroup'
  );
  assert.match(resetTemplateMethodSource, /Promise<string\[\] \| undefined>/u);
  assert.match(resetTemplateMethodSource, /return this\.applyCanvasTemplateRecord/u);
  const defaultTemplateInitializationSource = sliceBetween(
    panelManagerSource,
    'private async ensureDefaultTemplateAppliedIfNeeded',
    'private async resolveDefaultCanvasTemplateRecord'
  );
  assert.match(defaultTemplateInitializationSource, /resolveFirstOpenFallbackCanvasTemplateRecord/u);
  assert.match(defaultTemplateInitializationSource, /preservedDefaultTemplateId: selectedDefaultTemplateId/u);
  assert.doesNotMatch(defaultTemplateInitializationSource, /globalState\.update/u);
  const firstOpenFallbackResolverSource = sliceBetween(
    panelManagerSource,
    'private async resolveFirstOpenFallbackCanvasTemplateRecord',
    'private async applyCanvasTemplateRecord'
  );
  assert.match(firstOpenFallbackResolverSource, /DEFAULT_BUILTIN_CANVAS_TEMPLATE_ID/u);
  assert.match(firstOpenFallbackResolverSource, /node\.kind === 'note'/u);
  assert.doesNotMatch(firstOpenFallbackResolverSource, /globalState\.update/u);
  const webviewReadyHandlerSource = sliceBetween(
    panelManagerSource,
    "if (parsedMessage.type === 'webview/ready')",
    'private async bootstrapInteractiveSurface'
  );
  assert.match(webviewReadyHandlerSource, /bootstrapInteractiveSurface\(sourceSurface\)/u);
  assert.doesNotMatch(webviewReadyHandlerSource, /postState\('host\/bootstrap'\)/u);
  const bootstrapSurfaceSource = sliceBetween(
    panelManagerSource,
    'private async bootstrapInteractiveSurface',
    'private handleActiveWebviewMessage'
  );
  assert.match(bootstrapSurfaceSource, /await this\.ensureDefaultTemplateAppliedIfNeeded\(\)/u);
  assert.match(bootstrapSurfaceSource, /postState\('host\/bootstrap'\)/u);
  const resetDefaultWebviewCaseSource = sliceBetween(
    panelManagerSource,
    "case 'webview/resetToDefaultTemplate':",
    "case 'webview/resetToTemplate':"
  );
  assert.match(resetDefaultWebviewCaseSource, /resetDefaultCanvasTemplateWithConfirmation/u);
  assert.doesNotMatch(resetDefaultWebviewCaseSource, /applyDefaultCanvasTemplate\(\{\s*reset: true/u);
  const resetTemplateWebviewCaseSource = sliceBetween(
    panelManagerSource,
    "case 'webview/resetToTemplate':",
    "case 'webview/saveCanvasAsTemplate':"
  );
  assert.match(resetTemplateWebviewCaseSource, /resetCanvasTemplateByIdWithConfirmation/u);
  assert.doesNotMatch(resetTemplateWebviewCaseSource, /applyCanvasTemplateById\(parsedMessage\.payload\.templateId, \{\s*reset: true/u);
  const applyTemplateMethodSource = sliceBetween(
    panelManagerSource,
    'private async applyCanvasTemplateRecord',
    'private async validateCanvasTemplateForApply'
  );
  assert.match(applyTemplateMethodSource, /focusAppliedNodes\?: boolean/u);
  assert.match(applyTemplateMethodSource, /requestTemplateNodeGroupFocus\(applyResult\.nodeIds\)/u);
  const applyTemplateHelperSource = sliceBetween(
    panelManagerSource,
    'function applyCanvasTemplateToState',
    'function materializeTemplateNode'
  );
  assert.match(applyTemplateHelperSource, /nodeIds: materializedNodes\.map\(\(node\) => node\.id\)/u);
  const createNodeSource = sliceBetween(
    panelManagerSource,
    'function createNode(',
    'function createNodePosition'
  );
  assert.match(createNodeSource, /createCanvasNodeObjectId\(kind, sequence\)/u);
  assert.match(createNodeSource, /randomUUID\(\)/u);
  const nodeSequenceSource = sliceBetween(
    panelManagerSource,
    'function readCanvasNodeDisplaySequence',
    'function createNodeMetadata'
  );
  assert.match(nodeSequenceSource, /agent\|terminal\|note/u);
  assert.match(nodeSequenceSource, /\(\?:-\.\+\)\?/u);
  const templateGroupFocusSource = sliceBetween(
    panelManagerSource,
    'private requestTemplateNodeGroupFocus',
    'private async focusNodeInCanvas'
  );
  assert.match(templateGroupFocusSource, /type: 'host\/focusNodes'/u);

  const protocolSource = await readFile('src/common/protocol.ts', 'utf8');
  assert.match(protocolSource, /type: 'host\/focusNodes'/u);

  const webviewSource = await readFile('src/webview/main.tsx', 'utf8');
  assert.match(webviewSource, /case 'host\/focusNodes':\s*requestNodeGroupFocus\(message\.payload\.nodeIds\);/u);
  assert.match(webviewSource, /const knownNodeIds = latestHostNodeIdsRef\.current;/u);
  assert.match(webviewSource, /nodes: targetNodeIds\.map\(\(id\) => \(\{ id \}\)\)/u);
  assert.match(webviewSource, /schedulePendingNodeGroupViewportRetry\(\);/u);

  const sidebarTemplateViewSource = await readFile('src/sidebar/CanvasSidebarTemplateView.ts', 'utf8');
  const rowClickHandler = sliceBetween(
    sidebarTemplateViewSource,
    "row.addEventListener('click', () => {",
    "row.addEventListener('focus'"
  );
  const rowKeyboardHandler = sliceBetween(
    sidebarTemplateViewSource,
    "row.addEventListener('keydown', (event) => {",
    "const main = document.createElement('div');"
  );
  const applyActionClickHandler = sliceBetween(
    sidebarTemplateViewSource,
    "applyAction.addEventListener('click', (event) => {",
    "const resetAction = document.createElement('button');"
  );
  assert.match(rowClickHandler, /setSelectedId\(item\.id\)/u);
  assert.doesNotMatch(rowClickHandler, /postTemplateMessage\('sidebarTemplates\/applyTemplate'/u);
  assert.match(rowKeyboardHandler, /setSelectedId\(item\.id\)/u);
  assert.doesNotMatch(rowKeyboardHandler, /postTemplateMessage\('sidebarTemplates\/applyTemplate'/u);
  assert.match(applyActionClickHandler, /postTemplateMessage\('sidebarTemplates\/applyTemplate', item\.templateId\)/u);
  assert.match(sidebarTemplateViewSource, /titleLine\.append\(actions\);/u);
  assert.match(sidebarTemplateViewSource, /row\.append\(main\);/u);
  assert.doesNotMatch(sidebarTemplateViewSource, /row\.append\(main, actions\);/u);
  assert.match(sidebarTemplateViewSource, /grid-template-columns: minmax\(0, 1fr\);/u);
  assert.doesNotMatch(sidebarTemplateViewSource, /grid-template-columns: minmax\(0, 1fr\) auto;/u);
  assert.match(sidebarTemplateViewSource, /flex-wrap: nowrap;/u);
  assert.match(sidebarTemplateViewSource, /text-overflow: ellipsis;/u);
  assert.doesNotMatch(sidebarTemplateViewSource, /hintNote|hint-note|canSaveCurrentCanvas/u);
  assert.match(sidebarTemplateViewSource, /locationLabel: resolveCanvasSidebarTemplateLocationLabel\(storedTemplate\)/u);
  assert.match(sidebarTemplateViewSource, /storageLocation\?\.scope === 'workspace' \? '工作区' : '用户'/u);
  assert.match(sidebarTemplateViewSource, /locationBadge\.textContent = item\.locationLabel;/u);
  assert.doesNotMatch(sidebarTemplateViewSource, /textContent = item\.category === 'builtin' \? '内置' : '用户';/u);
  assert.match(sidebarTemplateViewSource, /title\.textContent = item\.isDefault \? '\(默认\) ' \+ item\.name : item\.name;/u);
  assert.doesNotMatch(sidebarTemplateViewSource, /defaultBadge|badge is-default|defaultAction\.hidden = item\.isDefault/u);
  assert.match(sidebarTemplateViewSource, /item\.isDefault \? 'codicon-star-full' : 'codicon-star-empty'/u);
  assert.match(sidebarTemplateViewSource, /if \(item\.isDefault\) \{\s*return;\s*\}\s*postTemplateMessage\('sidebarTemplates\/setDefaultTemplate', item\.templateId\);/u);

  const builtinResourceNames = (await readdir('resources/templates'))
    .filter((fileName) => fileName.endsWith('.json'))
    .sort();
  assert.deepStrictEqual(builtinResourceNames, ['01-getting-started.json', '02-basic-workflow.json']);
  const builtinResourceTemplateNames = [];
  for (const fileName of builtinResourceNames) {
    const document = JSON.parse(await readFile(path.join('resources/templates', fileName), 'utf8'));
    builtinResourceTemplateNames.push(document.template.name);
  }
  assert.deepStrictEqual(builtinResourceTemplateNames, ['使用说明', '示例模板']);

  const templateProductSpecSource = await readFile('docs/product-specs/canvas-template-feature.md', 'utf8');
  const templateDesignDocSource = await readFile('docs/design-docs/canvas-template-feature.md', 'utf8');
  const templateExecPlanSource = await readFile('docs/exec-plans/active/canvas-template-feature.md', 'utf8');
  for (const source of [templateProductSpecSource, templateDesignDocSource, templateExecPlanSource]) {
    assert.doesNotMatch(source, /3 个内置|3个|Anthropic Harness|基础工作流/u);
  }
  assert.match(templateProductSpecSource, /内置模板（2 个）/u);
  assert.match(templateProductSpecSource, /示例模板 - 1 Agent, 1 Terminal, 1 Note/u);
} finally {
  await rm(tempDir, { recursive: true, force: true });
}

function sliceBetween(source, startMarker, endMarker) {
  const startIndex = source.indexOf(startMarker);
  assert.notStrictEqual(startIndex, -1, `Expected source to contain start marker: ${startMarker}`);
  const endIndex = source.indexOf(endMarker, startIndex + startMarker.length);
  assert.notStrictEqual(endIndex, -1, `Expected source to contain end marker: ${endMarker}`);
  return source.slice(startIndex, endIndex);
}
