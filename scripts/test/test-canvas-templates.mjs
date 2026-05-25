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
    buildCanvasTemplateMarketMetadataPath,
    captureCanvasTemplateFromState,
    encodeCanvasTemplateDocument,
    formatCanvasTemplateStats,
    normalizeCanvasTemplateWorkspaceRelativePath,
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

  const marketTemplate = {
    ...userTemplate,
    id: 'market-review-loop',
    name: 'Review Loop',
    createdAt: '2026-05-09T00:00:00.000Z',
    updatedAt: '2026-05-09T00:00:00.000Z'
  };
  const savedMarketTemplate = await store.writeUserTemplate(marketTemplate, {
    relativeDirectory: 'marketplace',
    marketMetadata: {
      marketTemplateId: 'tmpl-review-loop',
      marketTemplateSlug: 'review-loop',
      marketVersionId: 'tmpl-review-loop-v1',
      installedVersionNumber: 1,
      installedAt: '2026-05-10T14:00:00.000Z',
      sourceUrl: 'https://dscanvas-template-marketplace.wzy0304.workers.dev/templates/review-loop',
      publisher: {
        id: 'official',
        githubLogin: 'devsessioncanvas',
        displayName: 'Dev Session Canvas',
        avatarUrl: ''
      },
      thumbnailKey: 'templates/tmpl-review-loop/versions/1/thumbnail.png',
      checksum: {
        sha256: '005e90644dae8084a612d6a9d2e198508618eaa792648eb19bc56113cbcc4e92',
        sizeBytes: 1897
      }
    }
  });
  assert.strictEqual(savedMarketTemplate.relativeDirectory, 'marketplace');
  assert.strictEqual(savedMarketTemplate.storageLocation?.scope, 'global');
  assert.strictEqual(savedMarketTemplate.marketplace?.marketTemplateSlug, 'review-loop');
  const marketSidecarPath = buildCanvasTemplateMarketMetadataPath(savedMarketTemplate.filePath);
  const marketSidecarDocument = JSON.parse(await readFile(marketSidecarPath, 'utf8'));
  assert.strictEqual(marketSidecarDocument.marketTemplateId, 'tmpl-review-loop');

  const catalogWithMarket = await store.listTemplates();
  assert.deepStrictEqual(
    catalogWithMarket.templates.map((entry) => entry.template.id),
    ['builtin-a', 'builtin-b', 'market-review-loop', 'user-workspace', 'user-a']
  );
  assert.strictEqual(catalogWithMarket.issues.length, 1);
  assert.strictEqual(
    catalogWithMarket.templates.find((entry) => entry.template.id === 'market-review-loop')?.marketplace?.marketVersionId,
    'tmpl-review-loop-v1'
  );

  const workspaceMarketTemplate = {
    ...marketTemplate,
    id: 'market-release-readiness',
    name: 'Release Readiness',
    createdAt: '2026-05-10T00:00:00.000Z',
    updatedAt: '2026-05-10T00:00:00.000Z'
  };
  const savedWorkspaceMarketTemplate = await store.writeUserTemplate(workspaceMarketTemplate, {
    targetRootPath: workspaceUserDir,
    relativeDirectory: 'marketplace',
    marketMetadata: {
      marketTemplateId: 'tmpl-release-readiness',
      marketTemplateSlug: 'release-readiness',
      marketVersionId: 'tmpl-release-readiness-v1',
      installedVersionNumber: 1,
      installedAt: '2026-05-10T15:00:00.000Z',
      sourceUrl: 'https://dscanvas-template-marketplace.wzy0304.workers.dev/templates/release-readiness',
      checksum: {
        sha256: 'e63a9f3666284df207184414a75afb1a86f6536a53668279fe825577a400bef0',
        sizeBytes: 2045
      }
    }
  });
  assert.strictEqual(savedWorkspaceMarketTemplate.storageLocation?.scope, 'workspace');
  assert.strictEqual(savedWorkspaceMarketTemplate.relativeDirectory, 'marketplace');
  assert.strictEqual(
    JSON.parse(await readFile(buildCanvasTemplateMarketMetadataPath(savedWorkspaceMarketTemplate.filePath), 'utf8')).marketTemplateSlug,
    'release-readiness'
  );

  const catalogWithWorkspaceMarket = await store.listTemplates();
  assert.strictEqual(
    catalogWithWorkspaceMarket.templates.find((entry) => entry.template.id === 'market-release-readiness')?.storageLocation?.scope,
    'workspace'
  );

  const updatedSavedMarketTemplate = await store.writeUserTemplate(
    {
      ...marketTemplate,
      name: 'Review Loop Updated',
      updatedAt: '2026-05-10T16:00:00.000Z'
    },
    {
      filePath: savedMarketTemplate.filePath,
      marketMetadata: {
        marketTemplateId: 'tmpl-review-loop',
        marketTemplateSlug: 'review-loop',
        marketVersionId: 'tmpl-review-loop-v2',
        installedVersionNumber: 2,
        installedAt: '2026-05-10T16:00:00.000Z',
        sourceUrl: 'https://dscanvas-template-marketplace.wzy0304.workers.dev/templates/review-loop',
        checksum: {
          sha256: '2e0d6d5e9bc0f5b8a5a3d12f822bdcb05da0f7ff1d9e2d2b52f2c43886c42d5a',
          sizeBytes: 1999
        }
      }
    }
  );
  assert.strictEqual(updatedSavedMarketTemplate.filePath, savedMarketTemplate.filePath);
  assert.strictEqual(updatedSavedMarketTemplate.marketplace?.marketVersionId, 'tmpl-review-loop-v2');
  assert.strictEqual(
    JSON.parse(await readFile(buildCanvasTemplateMarketMetadataPath(savedMarketTemplate.filePath), 'utf8')).installedVersionNumber,
    2
  );

  const rewrittenMarketTemplate = await store.writeUserTemplate(marketTemplate, {
    filePath: savedMarketTemplate.filePath
  });
  assert.strictEqual(rewrittenMarketTemplate.marketplace, undefined);
  const catalogAfterMarketRewrite = await store.listTemplates();
  assert.strictEqual(
    catalogAfterMarketRewrite.templates.find((entry) => entry.template.id === 'market-review-loop')?.marketplace,
    undefined
  );

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

  const capturedPathOnlyNote = captureCanvasTemplateFromState({
    state: captureState,
    name: 'Captured Path Only Note',
    templateId: 'captured-path-only-note',
    category: 'user',
    agentProviderSelection: 'default',
    associatedNoteSaveSelection: {
      'note-1': {
        mode: 'workspace-file-path-only',
        relativePath: 'docs/plan.md',
        content: 'must not be saved'
      }
    },
    now: '2026-05-06T10:00:00.000Z'
  });
  const capturedPathOnlyNoteMetadata = capturedPathOnlyNote.template.nodes[2].metadata.note;
  assert.strictEqual(capturedPathOnlyNoteMetadata.templateContentMode, 'workspace-file-path-only');
  assert.strictEqual(capturedPathOnlyNoteMetadata.relativePath, 'docs/plan.md');
  assert.strictEqual(capturedPathOnlyNoteMetadata.content, '');
  assert.doesNotMatch(JSON.stringify(capturedPathOnlyNote.template), /resourceUri|must not be saved/u);

  const capturedContentBackedNote = captureCanvasTemplateFromState({
    state: captureState,
    name: 'Captured Content Backed Note',
    templateId: 'captured-content-backed-note',
    category: 'user',
    agentProviderSelection: 'default',
    associatedNoteSaveSelection: {
      'note-1': {
        mode: 'workspace-file-with-content',
        relativePath: './docs/from-template.markdown',
        content: '# Template file\n'
      }
    },
    now: '2026-05-06T10:00:00.000Z'
  });
  const capturedContentBackedNoteMetadata = capturedContentBackedNote.template.nodes[2].metadata.note;
  assert.strictEqual(capturedContentBackedNoteMetadata.templateContentMode, 'workspace-file-with-content');
  assert.strictEqual(capturedContentBackedNoteMetadata.relativePath, 'docs/from-template.markdown');
  assert.strictEqual(capturedContentBackedNoteMetadata.content, '# Template file\n');

  assert.strictEqual(normalizeCanvasTemplateWorkspaceRelativePath(' ./docs/a.md '), 'docs/a.md');
  assert.strictEqual(normalizeCanvasTemplateWorkspaceRelativePath('../secret.md'), undefined);
  assert.throws(
    () => parseCanvasTemplateDocument({
      version: 1,
      template: {
        ...capturedPathOnlyNote.template,
        nodes: [
          {
            ...capturedPathOnlyNote.template.nodes[2],
            metadata: {
              note: {
                templateContentMode: 'workspace-file-path-only',
                relativePath: '../secret.md'
              }
            }
          }
        ]
      }
    }),
    /缺少合法 workspace 相对 Markdown 路径/u
  );

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
  const packageManifest = JSON.parse(await readFile('package.json', 'utf8'));
  assert.match(packageManifest.scripts.test, /npm run test:marketplace/u);
  assert.match(packageManifest.scripts['test:marketplace'], /npm run typecheck:marketplace/u);
  assert.match(packageManifest.scripts['test:marketplace'], /npm run test:marketplace-shared/u);
  assert.match(packageManifest.scripts['test:marketplace'], /npm run test:marketplace-api/u);
  assert.match(packageManifest.scripts['test:marketplace'], /npm run test:marketplace-web/u);
  assert.strictEqual(packageManifest.scripts['test:marketplace-vscode-e2e'], 'npm run test:marketplace-vscode-fixture-e2e');
  assert.strictEqual(
    packageManifest.scripts['test:marketplace-vscode-fixture-e2e'],
    'npm run build && node scripts/smoke/run-template-marketplace-vscode-e2e.mjs'
  );
  assert.strictEqual(
    packageManifest.scripts['test:marketplace-vscode-preview-e2e'],
    'npm run build && node scripts/smoke/run-template-marketplace-vscode-preview-e2e.mjs'
  );
  assert.ok(packageManifest.activationEvents.includes('onUri'));
  assert.ok(packageManifest.activationEvents.includes('onCommand:devSessionCanvas.openTemplateMarketplace'));
  assert.ok(packageManifest.activationEvents.includes('onCommand:devSessionCanvas.publishTemplateToMarketplace'));
  assert.ok(packageManifest.contributes.commands.some((entry) => entry.command === 'devSessionCanvas.openTemplateMarketplace'));
  assert.ok(packageManifest.contributes.commands.some((entry) => entry.command === 'devSessionCanvas.publishTemplateToMarketplace'));
  assert.match(extensionSource, /new TemplateMarketplaceClient\(\s*panelManager,\s*context,\s*context\.extensionMode\s*\)/u);
  assert.match(
    extensionSource,
    /new CanvasTemplateMarketplacePanelController\(\s*templateMarketplaceClient,\s*context\.extensionUri,\s*context\.extensionMode\s*\)/u
  );
  assert.match(extensionSource, /registerCommand\(context, COMMAND_IDS\.openTemplateMarketplace/u);
  assert.match(extensionSource, /registerCommand\(context, COMMAND_IDS\.publishTemplateToMarketplace/u);
  assert.match(extensionSource, /templateMarketplacePanel\.openTemplatePublishForm/u);
  assert.doesNotMatch(extensionSource, /isPublishCurrentCanvasCommandArg/u);
  assert.doesNotMatch(extensionSource, /publishCurrentCanvas/u);
  assert.match(extensionSource, /vscode\.window\.registerUriHandler/u);
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
  assert.match(extensionSource, /associatedNoteNodes: panelManager\.getCanvasTemplateAssociatedNoteSaveItems\(\)/u);
  assert.match(extensionSource, /associatedNoteSaveModes: formResult\.associatedNoteSaveModes/u);
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
  assert.match(defaultTemplateInitializationSource, /resolveFirstOpenCanvasTemplateRecord/u);
  assert.match(defaultTemplateInitializationSource, /preservedDefaultTemplateId/u);
  assert.doesNotMatch(defaultTemplateInitializationSource, /applyDefaultCanvasTemplate/u);
  assert.doesNotMatch(defaultTemplateInitializationSource, /globalState\.update/u);
  const firstOpenResolverSource = sliceBetween(
    panelManagerSource,
    'private async resolveFirstOpenCanvasTemplateRecord',
    'private async applyCanvasTemplateRecord'
  );
  assert.match(firstOpenResolverSource, /DEFAULT_BUILTIN_CANVAS_TEMPLATE_ID/u);
  assert.doesNotMatch(firstOpenResolverSource, /node\.kind === 'note'/u);
  assert.doesNotMatch(firstOpenResolverSource, /catalog\.templates\[0\]/u);
  assert.doesNotMatch(firstOpenResolverSource, /globalState\.update/u);
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
  assert.match(applyTemplateMethodSource, /resolveCanvasTemplateNoteMaterializations/u);
  assert.match(applyTemplateMethodSource, /noteMaterializations/u);
  assert.match(applyTemplateMethodSource, /requestTemplateNodeGroupFocus\(applyResult\.nodeIds\)/u);
  const pathOnlyNoteMaterializationSource = sliceBetween(
    panelManagerSource,
    'private async resolvePathOnlyCanvasTemplateNoteMaterialization',
    'private async resolveContentBackedCanvasTemplateNoteMaterialization'
  );
  assert.doesNotMatch(pathOnlyNoteMaterializationSource, /showWarningMessage/u);
  assert.match(pathOnlyNoteMaterializationSource, /status: 'missing'/u);
  const contentBackedNoteMaterializationSource = sliceBetween(
    panelManagerSource,
    'private async resolveContentBackedCanvasTemplateNoteMaterialization',
    'private async createCanvasTemplateMarkdownFileAndMaterialization'
  );
  assert.doesNotMatch(contentBackedNoteMaterializationSource, /showWarningMessage/u);
  assert.match(contentBackedNoteMaterializationSource, /status: 'dirty-conflict'/u);
  assert.match(contentBackedNoteMaterializationSource, /createStoredNoteMarkdownRecoverableDraft/u);
  assert.match(contentBackedNoteMaterializationSource, /content: templateContent/u);
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
  assert.doesNotMatch(protocolSource, /webview\/publishCanvasTemplate/u);
  assert.doesNotMatch(panelManagerSource, /case 'webview\/publishCanvasTemplate':/u);
  assert.doesNotMatch(panelManagerSource, /publishCurrentCanvas/u);
  assert.match(protocolSource, /webview\/createMissingAssociatedNoteMarkdownFile/u);

  const webviewSource = await readFile('src/webview/main.tsx', 'utf8');
  const webviewStylesSource = await readFile('src/webview/styles.css', 'utf8');
  const canvasNodeVisualsSource = await readFile('src/common/canvasNodeVisuals.ts', 'utf8');
  const thumbnailSource = await readFile('packages/marketplace-shared/src/thumbnail.ts', 'utf8');
  assert.match(webviewSource, /case 'host\/focusNodes':\s*requestNodeGroupFocus\(message\.payload\.nodeIds\);/u);
  assert.match(webviewSource, /创建空文件并关联/u);
  assert.match(webviewSource, /const knownNodeIds = latestHostNodeIdsRef\.current;/u);
  assert.match(webviewSource, /nodes: targetNodeIds\.map\(\(id\) => \(\{ id \}\)\)/u);
  assert.match(webviewSource, /schedulePendingNodeGroupViewportRetry\(\);/u);
  assert.doesNotMatch(webviewSource, /webview\/publishCanvasTemplate/u);
  assert.doesNotMatch(webviewSource, /data-context-menu-action="publish-canvas-template"/u);
  assert.doesNotMatch(webviewSource, /onPublishCanvasTemplate/u);
  assert.match(webviewSource, /保存后可从模板侧栏或市场面板发布/u);
  assert.doesNotMatch(webviewSource, /codicon-cloud-upload/u);
  for (const [kind, color] of [
    ['agent', '#22c55e'],
    ['terminal', '#38bdf8'],
    ['note', '#a78bfa']
  ]) {
    assert.match(canvasNodeVisualsSource, new RegExp(`case '${kind}':[\\s\\S]*return '${color}'`, 'u'));
    assert.match(webviewStylesSource, new RegExp(`\\.canvas-node\\.kind-${kind} \\{[\\s\\S]*--canvas-node-color: ${color};`, 'u'));
    assert.match(thumbnailSource, new RegExp(`${kind}: '${color}'`, 'u'));
  }

  const saveFormSource = await readFile('src/panel/CanvasTemplateSaveFormPanel.ts', 'utf8');
  assert.match(saveFormSource, /associatedNoteNodes/u);
  assert.match(saveFormSource, /associatedNoteModes/u);
  assert.match(saveFormSource, /workspace-file-path-only/u);
  assert.match(saveFormSource, /workspace-file-with-content/u);
  assert.doesNotMatch(saveFormSource, /不保存此 Note/u);
  assert.ok(!saveFormSource.includes("['skip'"));

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
  assert.match(sidebarTemplateViewSource, /sourceKind: resolveCanvasSidebarTemplateSourceKind\(storedTemplate\)/u);
  assert.match(sidebarTemplateViewSource, /locationLabel: resolveCanvasSidebarTemplateLocationLabel\(storedTemplate\)/u);
  assert.match(sidebarTemplateViewSource, /canPublish: storedTemplate\.template\.category === 'user' && !storedTemplate\.marketplace/u);
  assert.match(sidebarTemplateViewSource, /sidebarTemplates\/publishTemplate/u);
  assert.match(sidebarTemplateViewSource, /COMMAND_IDS\.publishTemplateToMarketplace/u);
  assert.match(sidebarTemplateViewSource, /publishAction\.hidden = !item\.canPublish/u);
  assert.match(sidebarTemplateViewSource, /codicon-cloud-upload/u);
  assert.match(sidebarTemplateViewSource, /resolveCanvasSidebarTemplateSourceLabel/u);
  assert.match(sidebarTemplateViewSource, /resolveCanvasSidebarTemplatePositionLabel/u);
  assert.match(sidebarTemplateViewSource, /return '内置';/u);
  assert.match(sidebarTemplateViewSource, /return '自建';/u);
  assert.match(sidebarTemplateViewSource, /return '市场';/u);
  assert.doesNotMatch(sidebarTemplateViewSource, /插件内置|用户保存\/导入|市场下载|扩展内/u);
  assert.match(sidebarTemplateViewSource, /storageLocation\?\.scope === 'workspace' \? '工作区' : '本地'/u);
  assert.match(sidebarTemplateViewSource, /codicon-cloud-download/u);
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

  assert.doesNotMatch(templateProductSpecSource, /首次打开(?:画布)?时[^\n]*当前设置的默认模板/u);
  assert.doesNotMatch(templateDesignDocSource, /首次打开画布时[^\n]*当前默认模板/u);

  const marketplacePanelSource = await readFile('src/panel/CanvasTemplateMarketplacePanel.ts', 'utf8');
  const marketplaceClientSource = await readFile('src/panel/TemplateMarketplaceClient.ts', 'utf8');
  const marketplaceWorkerAppSource = await readFile('apps/template-marketplace/src/worker/app.ts', 'utf8');
  const marketplaceWorkerPublishSource = await readFile('apps/template-marketplace/src/worker/publish.ts', 'utf8');
  const marketplaceWorkerAppTestSource = await readFile('apps/template-marketplace/src/worker/app.test.ts', 'utf8');
  const marketplaceDetailViewSource = await readFile('apps/template-marketplace/src/web/components/TemplateDetailView.tsx', 'utf8');
  const marketplacePublishViewSource = await readFile('apps/template-marketplace/src/web/components/TemplatePublishView.tsx', 'utf8');
  const marketplaceVscodePreviewE2eRunnerSource = await readFile('scripts/smoke/run-template-marketplace-vscode-preview-e2e.mjs', 'utf8');
  const marketplaceVscodePreviewE2eTestSource = await readFile('tests/vscode-smoke/template-marketplace-preview-tests.cjs', 'utf8');
  const marketplaceDesignDocSource = await readFile('docs/design-docs/template-marketplace.md', 'utf8');
  assert.match(panelManagerSource, /installMarketplaceTemplateDocument\([\s\S]*targetRootPath\?: string/u);
  assert.match(panelManagerSource, /overwriteFilePath\?: string/u);
  assert.match(panelManagerSource, /preserveTemplateId\?: string/u);
  assert.match(panelManagerSource, /preserveCreatedAt\?: string/u);
  assert.match(panelManagerSource, /template\.id = options\?\.preserveTemplateId \?\? `market-template-\$\{randomUUID\(\)\}`;/u);
  assert.match(panelManagerSource, /filePath: options\?\.overwriteFilePath/u);
  assert.match(marketplaceClientSource, /listInstalledTemplates/u);
  assert.match(marketplaceClientSource, /listInstallTargets/u);
  assert.match(marketplaceClientSource, /targetStorageLocationId/u);
  assert.match(marketplaceClientSource, /TemplateMarketplaceInstallOperation = 'installed' \| 'updated' \| 'reinstalled'/u);
  assert.match(marketplaceClientSource, /export function parseTrustedMarketplaceSourceUrl/u);
  assert.match(marketplaceClientSource, /saveMarketplaceTemplateDocument/u);
  assert.match(marketplaceClientSource, /findInstalledMarketplaceTemplate/u);
  assert.match(marketplaceClientSource, /resolveInstallTarget/u);
  assert.match(marketplaceClientSource, /overwriteFilePath: existingTemplate\?\.filePath/u);
  assert.match(marketplaceClientSource, /preserveTemplateId: existingTemplate\?\.template\.id/u);
  assert.match(marketplaceClientSource, /resolveMarketplaceInstallOperation/u);
  assert.match(marketplaceClientSource, /getCanvasTemplateCatalog/u);
  assert.match(marketplaceClientSource, /marketTemplateSlug/u);
  assert.match(marketplaceClientSource, /listPublishableTemplateDrafts/u);
  assert.match(marketplaceClientSource, /publishTemplateDraft/u);
  assert.match(marketplaceClientSource, /generateMarketplaceTemplateThumbnailPngBase64/u);
  assert.match(marketplaceClientSource, /thumbnailPngBase64: generateMarketplaceTemplateThumbnailPngBase64\(templateDocument\)/u);
  assert.match(marketplaceClientSource, /vscode\.authentication\.getSession\('github', \['read:user'\], \{ createIfNone: true \}\)/u);
  assert.match(marketplaceClientSource, /context\.secrets\.store\(MARKETPLACE_TOKEN_SECRET_KEY, tokenResponse\.token\)/u);
  assert.match(marketplaceClientSource, /findPublishableStoredTemplate/u);
  assert.match(marketplaceClientSource, /marketplaceTemplateDocumentSchema/u);
  assert.match(marketplaceClientSource, /parseMarketplaceTemplateDocumentJson\(request\.templateJson\)/u);
  assert.doesNotMatch(marketplaceClientSource, /workspaceState\.update|globalState\.update/u);
  assert.match(marketplaceWorkerAppSource, /PUBLIC_READ_CORS_ROUTES/u);
  assert.match(marketplaceWorkerAppSource, /createPublicReadCorsMiddleware/u);
  assert.match(marketplaceWorkerAppSource, /requestedMethod && requestedMethod !== 'GET'/u);
  assert.doesNotMatch(marketplaceWorkerAppSource, /app\.use\(\s*'\/api\/v1\/\*'[\s\S]*origin: '\*'/u);
  assert.match(marketplaceWorkerPublishSource, /metadata\.note\.relativePath/u);
  assert.match(marketplaceWorkerPublishSource, /metadata\.note\.templateContentMode/u);
  assert.match(marketplaceWorkerPublishSource, /versions\/\$\{versionId\}\/template\.json/u);
  assert.match(marketplaceWorkerPublishSource, /versions\/\$\{versionId\}\/thumbnail\.png/u);
  assert.doesNotMatch(marketplaceWorkerPublishSource, /versions\/\$\{nextVersionNumber\}\/template\.json/u);
  assert.match(marketplaceWorkerAppTestSource, /does not apply public CORS to authenticated write API preflights/u);
  assert.match(marketplaceWorkerAppTestSource, /does not add public CORS headers to authenticated write API responses/u);
  assert.match(marketplaceWorkerAppTestSource, /body\.template\.latestVersion\.objectKey\)\.toBe\([\s\S]*versions\/\$\{body\.template\.latestVersion\.id\}\/template\.json/u);
  assert.match(marketplaceDesignDocSource, /templates\/\{templateId\}\/versions\/\{versionId\}\/template\.json/u);
  assert.match(marketplaceDesignDocSource, /对象 key 使用不可复用的 `versionId`/u);
  assert.doesNotMatch(marketplaceDesignDocSource, /templates\/\{templateId\}\/versions\/\{versionNumber\}\/template\.json/u);
  assert.match(marketplacePublishViewSource, /type PublishTextField = 'name' \| 'slug' \| 'description' \| 'tags' \| 'readme' \| 'changelog' \| 'templateJson';/u);
  assert.match(marketplacePublishViewSource, /function updateFormField\(field: PublishTextField, value: string\): void/u);
  assert.doesNotMatch(marketplacePublishViewSource, /setForm\(\(current\)\s*=>[\s\S]{0,200}event\.(?:currentTarget|target)\.value/u);
  assert.match(marketplaceDetailViewSource, /type DetailTab = 'readme' \| 'changelog';/u);
  assert.match(marketplaceDetailViewSource, /role="tablist"[\s\S]*README[\s\S]*CHANGELOG/u);
  assert.match(marketplaceDetailViewSource, /template-detail-changelog-panel/u);
  assert.match(marketplaceDetailViewSource, /version\.changelog\.trim\(\)/u);
  assert.match(extensionSource, /context\.extensionMode/u);
  assert.match(extensionSource, /templateMarketplacePanel\.openTemplateDetailFromUri\(uri\)/u);
  assert.doesNotMatch(extensionSource, /保存当前画布为市场模板草稿/u);
  assert.doesNotMatch(extensionSource, /保存并打开发布表单/u);
  assert.doesNotMatch(extensionSource, /publishStoredTemplate/u);
  assert.match(extensionSource, /打开市场模板详情失败/u);
  assert.doesNotMatch(extensionSource, /installTemplateFromUri\(uri\)/u);
  assert.match(marketplacePanelSource, /marketplace\/installedTemplates/u);
  assert.match(marketplacePanelSource, /marketplace\/installedTemplatesError/u);
  assert.match(marketplacePanelSource, /marketplace\/openTemplateDetail/u);
  assert.match(marketplacePanelSource, /marketplace\/openTemplateIndex/u);
  assert.match(marketplacePanelSource, /marketplace\/publishTemplate/u);
  assert.match(marketplacePanelSource, /marketplace\/openTemplatePublishForm/u);
  assert.match(marketplacePanelSource, /marketplace\/submitTemplatePublish/u);
  assert.match(marketplacePanelSource, /marketplace\/templatePublishResult/u);
  assert.match(marketplacePanelSource, /marketplace\/refreshInstalledTemplates/u);
  assert.match(marketplacePanelSource, /openTemplatePublishForm/u);
  assert.match(marketplacePanelSource, /publishTemplateButton/u);
  assert.match(marketplacePanelSource, /发布自建模板/u);
  assert.match(marketplacePanelSource, /codicon-cloud-upload/u);
  assert.match(marketplacePanelSource, /选择安装位置后可安装模板；进入详情页可查看 README、CHANGELOG 和版本历史。/u);
  assert.match(marketplacePanelSource, /查看详情/u);
  assert.match(marketplacePanelSource, /detail-view/u);
  assert.match(marketplacePanelSource, /getVersionedWebviewResourceUri/u);
  assert.match(marketplacePanelSource, /MARKETPLACE_BUNDLED_CODICON_PATH_SEGMENTS/u);
  assert.match(marketplacePanelSource, /font-src \$\{webview\.cspSource\}/u);
  assert.match(marketplacePanelSource, /<link rel="stylesheet" href="\$\{codiconCssUri\}" \/>/u);
  assert.match(marketplacePanelSource, /codicon-chevron-down/u);
  assert.match(marketplacePanelSource, /createDropdownChevronIcon/u);
  assert.doesNotMatch(marketplacePanelSource, /textContent = '▼'/u);
  assert.match(marketplacePanelSource, /\[hidden\]\s*\{\s*display: none !important;/u);
  assert.match(marketplacePanelSource, /grid-template-columns: 112px minmax\(0, 1fr\) minmax\(224px, 284px\);/u);
  assert.match(marketplacePanelSource, /"thumb title actions"[\s\S]*"thumb description actions"[\s\S]*"thumb publisher actions"/u);
  assert.match(marketplacePanelSource, /\.detail-controls[\s\S]*grid-template-columns: minmax\(0, 1fr\);/u);
  assert.match(marketplacePanelSource, /\.actions[\s\S]*align-self: start;/u);
  assert.match(marketplacePanelSource, /\.install-target-row[\s\S]*align-self: start;/u);
  assert.match(marketplacePanelSource, /\.publish-field-grid[\s\S]*align-items: start;/u);
  assert.match(marketplacePanelSource, /\.publish-field[\s\S]*grid-template-rows: 16px 28px 18px;/u);
  assert.match(marketplacePanelSource, /\.publish-field-label[\s\S]*min-height: 16px;/u);
  assert.match(marketplacePanelSource, /\.publish-field-textarea[\s\S]*grid-template-rows: auto auto auto;/u);
  assert.match(marketplacePanelSource, /\.publish-field-textarea textarea[\s\S]*box-sizing: border-box;[\s\S]*width: 100%;/u);
  assert.match(marketplacePanelSource, /\.publish-field-textarea textarea\.publish-readme[\s\S]*min-height: 140px;/u);
  assert.match(marketplacePanelSource, /\.publish-field-textarea textarea\.publish-changelog[\s\S]*min-height: 96px;/u);
  assert.match(marketplacePanelSource, /\.publish-json[\s\S]*min-height: 220px;/u);
  assert.match(marketplacePanelSource, /createPublishInput\('name', '名称', state\.publishForm\.name, \{ required: true, reserveNote: true \}\)/u);
  assert.match(marketplacePanelSource, /\.publish-field-note[\s\S]*overflow: hidden;[\s\S]*min-height: 18px;/u);
  assert.match(marketplacePanelSource, /wrapper\.append\(labelText, input\);/u);
  assert.match(marketplacePanelSource, /wrapper\.append\(labelText, textarea\);/u);
  assert.match(marketplacePanelSource, /\.detail-controls \.install-target-row[\s\S]*grid-column: 1 \/ -1;/u);
  assert.match(marketplacePanelSource, /createInstallTargetSelect/u);
  assert.match(marketplacePanelSource, /createInstallTargetSelectRow/u);
  assert.match(marketplacePanelSource, /installTargetIdsByTemplateSlug/u);
  assert.match(marketplacePanelSource, /formatInstallTargetLabel/u);
  assert.match(marketplacePanelSource, /formatTemplatePublisherLabel/u);
  assert.match(marketplacePanelSource, /activeDetailTab: 'readme'/u);
  assert.match(marketplacePanelSource, /selectDetailTab/u);
  assert.match(marketplacePanelSource, /createDetailTabs/u);
  assert.match(marketplacePanelSource, /createDetailTabPanel/u);
  assert.match(marketplacePanelSource, /detailChangelogText/u);
  assert.match(marketplacePanelSource, /targetStorageLocationId: targetId/u);
  assert.match(marketplacePanelSource, /operation: result\.operation/u);
  assert.match(marketplacePanelSource, /formatInstallResultStatus/u);
  assert.match(marketplacePanelSource, /更新到 v/u);
  assert.match(marketplacePanelSource, /split-install/u);
  assert.match(marketplacePanelSource, /is-installed-split/u);
  assert.match(marketplacePanelSource, /切换安装版本/u);
  assert.match(marketplacePanelSource, /loadTemplateDetail/u);
  assert.match(marketplacePanelSource, /collectInstallableVersions/u);
  assert.match(marketplacePanelSource, /installTemplateVersion\(template, version\)/u);
  assert.doesNotMatch(marketplacePanelSource, /下载 JSON/u);
  assert.doesNotMatch(marketplacePanelSource, /切换下载版本/u);
  assert.doesNotMatch(marketplacePanelSource, /openDownloadVersionMenuSlug/u);
  assert.doesNotMatch(marketplacePanelSource, /downloadTemplateVersion/u);
  assert.doesNotMatch(marketplacePanelSource, /buildTemplateDownloadUrl/u);
  assert.doesNotMatch(marketplacePanelSource, /createDownloadSplitButton/u);
  assert.doesNotMatch(marketplacePanelSource, /toggleDownloadVersionMenu/u);
  assert.match(marketplacePanelSource, /buildTemplateThumbnailUrl/u);
  assert.doesNotMatch(marketplacePanelSource, /Button\.textContent = ['"][^'"]*应用到 Canvas/u);
  assert.doesNotMatch(marketplacePanelSource, /marketplace\/applyInstalledTemplate/u);
  assert.match(marketplacePanelSource, /installedTemplate\.storageLocationId === selectedInstallTargetId/u);
  assert.match(marketplacePanelSource, /normalizeInstalledTemplates/u);
  assert.match(marketplacePanelSource, /normalizePersistedState/u);
  assert.match(marketplacePanelSource, /persistState/u);
  assert.match(marketplacePanelSource, /renderLoadErrorCard/u);
  assert.match(marketplacePanelSource, /renderOfflineInstalledTemplateCard/u);
  assert.match(marketplacePanelSource, /网络请求失败，可能无法访问模板市场 API 或代理阻断/u);
  assert.match(marketplacePanelSource, /请到模板侧栏应用到 Canvas/u);
  assert.match(marketplacePanelSource, /已安装到/u);
  assert.match(marketplacePanelSource, /本地 ·/u);
  assert.match(marketplacePanelSource, /当前workspace/u);
  assert.match(marketplacePanelSource, /已安装 v/u);
  assert.match(marketplacePanelSource, /MARKETPLACE_OFFICIAL_SOURCE_URL/u);
  assert.match(marketplacePanelSource, /MARKETPLACE_DEBUG_SOURCE_URL/u);
  assert.match(marketplacePanelSource, /resolveDefaultMarketplaceSourceUrl/u);
  assert.match(marketplacePanelSource, /vscode\.ExtensionMode\.Production/u);
  assert.match(marketplacePanelSource, /resolveCompatibleMarketplaceSourceUrl/u);
  assert.match(marketplacePanelSource, /formatMarketplaceSourceMismatchError/u);
  assert.match(marketplacePanelSource, /当前扩展为\$\{expectedInstall\}/u);
  assert.match(marketplacePanelSource, /MARKETPLACE_LOCAL_DEVELOPMENT_SOURCES/u);
  assert.match(marketplacePanelSource, /'http:\/\/\[::1\]:\*'/u);
  assert.match(marketplacePanelSource, /'https:\/\/\[::1\]:\*'/u);
  assert.match(marketplacePanelSource, /MARKETPLACE_CONNECT_SOURCES/u);
  assert.match(marketplacePanelSource, /MARKETPLACE_IMAGE_SOURCES/u);
  assert.match(marketplacePanelSource, /connect-src \$\{MARKETPLACE_CONNECT_SOURCES\}/u);
  assert.match(marketplacePanelSource, /img-src \$\{MARKETPLACE_IMAGE_SOURCES\}/u);
  assert.match(marketplacePanelSource, /parseTrustedMarketplaceSourceUrl/u);
  assert.match(marketplacePanelSource, /sourceUrl: resolvedSourceUrl\?\.toString\(\)/u);
  assert.match(marketplacePanelSource, /refreshList: options\.refreshList === true/u);
  assert.match(marketplacePanelSource, /sourceChanged \|\| Boolean\(message\.payload && message\.payload\.refreshList\)/u);
  assert.match(marketplacePanelSource, /sortSelect\.value = 'updated';/u);
  assert.match(marketplacePanelSource, /buildPublishFormShell/u);
  assert.match(marketplacePanelSource, /checkPublishSlugAvailability/u);
  assert.match(marketplacePanelSource, /marketplaceSourceUrl: marketplaceSourceUrl\.toString\(\)/u);
  assert.match(marketplacePanelSource, /setMarketplaceSourceUrl\(message\.payload && message\.payload\.sourceUrl\)/u);
  assert.match(marketplacePanelSource, /sourceUrl: buildMarketplaceBrowserUrl\(\)/u);
  assert.match(marketplacePanelSource, /sourceUrl: buildTemplateSourceUrl\(template\.slug\)/u);
  assert.match(marketplacePanelSource, /this\.defaultMarketplaceSourceUrl = resolveDefaultMarketplaceSourceUrl\(extensionMode\);/u);
  assert.match(marketplacePanelSource, /this\.marketplaceSourceUrl = new URL\(this\.defaultMarketplaceSourceUrl\);/u);
  assert.match(marketplacePanelSource, /this\.pendingDetailRequest = undefined;/u);
  assert.match(marketplacePanelSource, /void this\.postOpenTemplateIndex\(\);/u);
  assert.match(marketplacePanelSource, /private revealPanel\(\): void/u);
  assert.match(marketplacePanelSource, /this\.revealPanel\(\);\s*void this\.postOpenTemplateDetail\(\);/u);
  assert.match(marketplacePanelSource, /setMarketplaceSourceUrl\(message\.payload && message\.payload\.sourceUrl\);[\s\S]*showTemplateList\(\);/u);
  assert.doesNotMatch(marketplacePanelSource, /openExternal\(vscode\.Uri\.parse\(`\$\{MARKETPLACE_DEBUG_ORIGIN\}\/templates`\)\)/u);
  assert.doesNotMatch(marketplacePanelSource, /sourceUrl: apiOrigin \+ '\/templates\//u);
  assert.match(marketplacePanelSource, /installTemplateFromInlinePayload/u);
  assert.doesNotMatch(marketplacePanelSource, /<iframe/u);
  assert.match(
    marketplaceVscodePreviewE2eRunnerSource,
    /DEFAULT_PREVIEW_MARKETPLACE_SOURCE_URL = 'https:\/\/dscanvas-template-marketplace\.wzy0304\.workers\.dev\/templates'/u
  );
  assert.match(marketplaceVscodePreviewE2eRunnerSource, /DEV_SESSION_CANVAS_TEMPLATE_MARKETPLACE_PREVIEW_SOURCE_URL/u);
  assert.match(marketplaceVscodePreviewE2eRunnerSource, /preflightMarketplaceSource\(marketplaceSourceUrl\)/u);
  assert.match(marketplaceVscodePreviewE2eRunnerSource, /Continuing with the VS Code Webview E2E/u);
  assert.match(marketplaceVscodePreviewE2eRunnerSource, /MARKETPLACE_PREFLIGHT_TIMEOUT_MS = 10000/u);
  assert.doesNotMatch(marketplaceVscodePreviewE2eRunnerSource, /findAvailablePort|createServer/u);
  assert.match(marketplaceVscodePreviewE2eTestSource, /templateCount > 0/u);
  assert.match(marketplaceVscodePreviewE2eTestSource, /entry\.marketplace\.sourceUrl\.startsWith\(`\$\{sourceUrl\}\/`\)/u);
  assert.doesNotMatch(marketplaceVscodePreviewE2eTestSource, /publish|token exchange|POST \/api\/v1\/templates/u);

  const marketplaceCardSource = sliceBetween(
    marketplacePanelSource,
    'function renderTemplateCard(template) {',
    'function createDropdownChevronIcon() {'
  );
  assert.match(marketplaceCardSource, /formatTemplatePublisherLabel\(template\)/u);
  assert.match(marketplaceCardSource, /createInstallSplitButton\(template, installedTemplate, template\.latestVersion\.id\)/u);
  assert.match(marketplaceCardSource, /actions\.append\(installTargetRow, installButtonGroup\);/u);
  assert.doesNotMatch(marketplaceCardSource, /article\.append\(installTargetRow\);/u);
  assert.doesNotMatch(marketplaceCardSource, /createDownloadSplitButton/u);

  const marketplaceInstallButtonSource = sliceBetween(
    marketplacePanelSource,
    'function createInstallSplitButton(template, installedTemplate, preferredVersionId) {',
    'function closeVersionMenus(render = true) {'
  );
  assert.match(marketplaceInstallButtonSource, /安装/u);
  assert.match(marketplaceInstallButtonSource, /更新到 v/u);
  assert.match(marketplaceInstallButtonSource, /已安装 v/u);
  assert.match(marketplaceInstallButtonSource, /切换安装版本/u);

  const marketplaceDetailControlsSource = sliceBetween(
    marketplacePanelSource,
    "const controls = document.createElement('div');",
    "const metrics = document.createElement('dl');"
  );
  assert.match(marketplaceDetailControlsSource, /controls\.append\(installTargetRow, installButtonGroup\);/u);

  const marketplaceDetailSource = sliceBetween(
    marketplacePanelSource,
    'function buildDetailShell(template) {',
    'function closeTemplateDetail() {'
  );
  assert.match(marketplaceDetailSource, /const selectedVersion = resolvePreferredDetailVersion\(template, state\.activeTemplateVersionId\);/u);
  assert.match(marketplaceDetailSource, /formatTemplatePublisherLabel\(template\)/u);
  assert.match(marketplaceDetailSource, /createDetailTabs\(activeDetailTab\)/u);
  assert.match(marketplaceDetailSource, /createDetailTabPanel\(template, activeDetailTab, selectedVersion\)/u);
  assert.match(marketplaceDetailSource, /CHANGELOG/u);
  assert.match(marketplaceDetailSource, /createInstallSplitButton\(template, installedTemplate, selectedVersion\.id\)/u);
  assert.doesNotMatch(marketplaceDetailSource, /createDownloadSplitButton/u);
  assert.match(marketplaceDetailSource, /selectedVersion\.id === version\.id/u);
  assert.doesNotMatch(marketplaceDetailSource, /integrityValue\.textContent/u);
  assert.doesNotMatch(marketplaceDetailSource, /integrityValue\.textContent = template\.latestVersion\.sha256;/u);
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
