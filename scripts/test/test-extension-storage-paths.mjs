import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

import esbuild from 'esbuild';

const tempDir = await mkdtemp(path.join(os.tmpdir(), 'dsc-extension-storage-paths-'));
const storagePath = path.posix;

try {
  const outfile = path.join(tempDir, 'extensionStoragePaths.cjs');
  await esbuild.build({
    entryPoints: [path.resolve('src/common/extensionStoragePaths.ts')],
    bundle: true,
    format: 'cjs',
    outfile,
    platform: 'node',
    target: 'node18'
  });

  const require = createRequire(import.meta.url);
  const {
    resolvePreferredExtensionStoragePath,
    selectPreferredExtensionStorageRecoverySource,
    selectUntitledMultiRootWorkspaceStorageForkSource
  } = require(outfile);

  const stablePath =
    '/home/users/example/.vscode-server/data/User/workspaceStorage/' +
    '33709ceba1e836bc24c67b57ee72421c/devsessioncanvas.dev-session-canvas';
  const indexedPathOne =
    '/home/users/example/.vscode-server/data/User/workspaceStorage/' +
    '33709ceba1e836bc24c67b57ee72421c-1/devsessioncanvas.dev-session-canvas';
  const indexedPathTwo =
    '/home/users/example/.vscode-server/data/User/workspaceStorage/' +
    '33709ceba1e836bc24c67b57ee72421c-2/devsessioncanvas.dev-session-canvas';
  const workspaceStorageEntries = [
    '33709ceba1e836bc24c67b57ee72421c',
    '33709ceba1e836bc24c67b57ee72421c-1',
    '33709ceba1e836bc24c67b57ee72421c-2'
  ];

  const unchangedResult = selectPreferredExtensionStorageRecoverySource(stablePath, {
    pathExists: () => false
  });
  assert.equal(unchangedResult.currentPath, stablePath);
  assert.equal(unchangedResult.writePath, stablePath);
  assert.equal(unchangedResult.sourcePath, stablePath);
  assert.equal(unchangedResult.recoveryReason, undefined);
  assert.equal(unchangedResult.selectionBasis, 'current-slot');

  const windowsStablePath = path.win32.join(
    'C:\\Users\\example',
    'AppData',
    'Roaming',
    'Code',
    'User',
    'workspaceStorage',
    '33709ceba1e836bc24c67b57ee72421c',
    'devsessioncanvas.dev-session-canvas'
  );
  const unchangedWindowsResult = selectPreferredExtensionStorageRecoverySource(windowsStablePath, {
    pathExists: () => false
  });
  assert.equal(unchangedWindowsResult.currentPath, windowsStablePath);
  assert.equal(unchangedWindowsResult.writePath, windowsStablePath);
  assert.equal(unchangedWindowsResult.sourcePath, windowsStablePath);

  const fresherSiblingSnapshots = buildSnapshotFixture([
    [storagePath.join(indexedPathOne, 'canvas-state.json'), createSnapshotText({
      title: 'CURRENT-OLD',
      writtenAt: '2026-04-15T09:00:00.000Z',
      updatedAt: '2026-04-15T08:59:00.000Z'
    })],
    [storagePath.join(stablePath, 'canvas-state.json'), createSnapshotText({
      title: 'SIBLING-NEW',
      writtenAt: '2026-04-16T09:00:00.000Z',
      updatedAt: '2026-04-16T08:59:00.000Z'
    })]
  ]);
  const fresherSiblingResult = selectPreferredExtensionStorageRecoverySource(indexedPathOne, {
    ...fresherSiblingSnapshots,
    listDirectoryEntries: () => workspaceStorageEntries
  });
  assert.equal(fresherSiblingResult.sourcePath, stablePath);
  assert.equal(fresherSiblingResult.writePath, indexedPathOne);
  assert.equal(fresherSiblingResult.recoveryReason, 'workspace-storage-slot-fallback');
  assert.equal(fresherSiblingResult.selectionBasis, 'freshest-snapshot');
  assert.equal(fresherSiblingResult.sourceCandidate.snapshot.stateHash, hashStateTitle('SIBLING-NEW'));
  assert.equal(
    resolvePreferredExtensionStoragePath(indexedPathOne, {
      ...fresherSiblingSnapshots,
      listDirectoryEntries: () => workspaceStorageEntries
    }).resolvedPath,
    stablePath
  );

  const preferCurrentWhenNewestSnapshots = buildSnapshotFixture([
    [storagePath.join(indexedPathOne, 'canvas-state.json'), createSnapshotText({
      title: 'CURRENT-NEW',
      writtenAt: '2026-04-16T10:00:00.000Z',
      updatedAt: '2026-04-16T09:59:00.000Z'
    })],
    [storagePath.join(stablePath, 'canvas-state.json'), createSnapshotText({
      title: 'SIBLING-OLD',
      writtenAt: '2026-04-16T09:00:00.000Z',
      updatedAt: '2026-04-16T08:59:00.000Z'
    })]
  ]);
  const preferCurrentWhenNewestResult = selectPreferredExtensionStorageRecoverySource(indexedPathOne, {
    ...preferCurrentWhenNewestSnapshots,
    listDirectoryEntries: () => workspaceStorageEntries
  });
  assert.equal(preferCurrentWhenNewestResult.sourcePath, indexedPathOne);
  assert.equal(preferCurrentWhenNewestResult.recoveryReason, undefined);
  assert.equal(preferCurrentWhenNewestResult.selectionBasis, 'current-slot');

  const missingCurrentSnapshotResult = selectPreferredExtensionStorageRecoverySource(indexedPathTwo, {
    ...buildSnapshotFixture([
      [storagePath.join(indexedPathOne, 'canvas-state.json'), createSnapshotText({
        title: 'INDEXED-SIBLING',
        writtenAt: '2026-04-16T10:00:00.000Z',
        updatedAt: '2026-04-16T09:59:00.000Z'
      })]
    ]),
    listDirectoryEntries: () => workspaceStorageEntries
  });
  assert.equal(missingCurrentSnapshotResult.sourcePath, indexedPathOne);
  assert.equal(missingCurrentSnapshotResult.selectionBasis, 'freshest-snapshot');

  const invalidSiblingTimestampResult = selectPreferredExtensionStorageRecoverySource(indexedPathOne, {
    ...buildSnapshotFixture([
      [storagePath.join(indexedPathOne, 'canvas-state.json'), createSnapshotText({
        title: 'CURRENT-VALID',
        writtenAt: '2026-04-16T10:00:00.000Z',
        updatedAt: '2026-04-16T09:59:00.000Z'
      })],
      [storagePath.join(stablePath, 'canvas-state.json'), createSnapshotText({
        title: 'SIBLING-INVALID',
        writtenAt: 'not-a-timestamp',
        updatedAt: 'still-not-a-timestamp'
      })]
    ]),
    listDirectoryEntries: () => workspaceStorageEntries
  });
  assert.equal(invalidSiblingTimestampResult.sourcePath, indexedPathOne);
  assert.equal(invalidSiblingTimestampResult.recoveryReason, undefined);

  const fallbackToNearestRecoverableStateResult = selectPreferredExtensionStorageRecoverySource(indexedPathTwo, {
    pathExists: (candidatePath) =>
      candidatePath === storagePath.join(stablePath, 'runtime-supervisor', 'registry.json') ||
      candidatePath === storagePath.join(indexedPathOne, 'agent-runtime'),
    listDirectoryEntries: () => workspaceStorageEntries,
    readTextFile: () => {
      throw new Error('Should not attempt to read snapshot text in pure recoverable fallback case.');
    }
  });
  assert.equal(fallbackToNearestRecoverableStateResult.sourcePath, indexedPathOne);
  assert.equal(fallbackToNearestRecoverableStateResult.selectionBasis, 'recoverable-state-fallback');

  const untitledSingleRootPath =
    '/home/users/example/.config/Code/User/workspaceStorage/' +
    'abc123/devsessioncanvas.dev-session-canvas';
  const untitledExpandedWorkspacePath =
    '/home/users/example/.config/Code/User/workspaceStorage/' +
    'def456/devsessioncanvas.dev-session-canvas';
  const untitledExpandedResult = selectPreferredExtensionStorageRecoverySource(untitledExpandedWorkspacePath, {
    ...buildSnapshotFixture([
      [storagePath.join(untitledSingleRootPath, 'canvas-state.json'), createSnapshotText({
        title: 'SINGLE-ROOT-SNAPSHOT',
        writtenAt: '2026-05-29T08:00:00.000Z',
        updatedAt: '2026-05-29T07:59:00.000Z'
      })],
      [storagePath.join(untitledExpandedWorkspacePath, 'canvas-state.json'), createSnapshotText({
        title: 'UNTITLED-EXPANDED-SNAPSHOT',
        writtenAt: '2026-05-29T08:30:00.000Z',
        updatedAt: '2026-05-29T08:29:00.000Z'
      })]
    ]),
    listDirectoryEntries: () => ['abc123', 'def456']
  });
  assert.equal(
    untitledExpandedResult.sourcePath,
    untitledExpandedWorkspacePath,
    'Unrelated VS Code Untitled workspace hashes must not recover from single-root snapshots by freshness.'
  );
  assert.equal(untitledExpandedResult.selectionBasis, 'current-slot');
  assert.equal(untitledExpandedResult.recoveryReason, undefined);

  const untitledWorkspaceStorageRoot = '/home/users/example/.config/Code/User/workspaceStorage';
  const untitledMultiRootCurrentPath = storagePath.join(
    untitledWorkspaceStorageRoot,
    'untitled-multiroot-hash',
    'devsessioncanvas.dev-session-canvas'
  );
  const rootASingleRootPath = storagePath.join(
    untitledWorkspaceStorageRoot,
    'root-a-single-hash',
    'devsessioncanvas.dev-session-canvas'
  );
  const rootAOlderSingleRootPath = storagePath.join(
    untitledWorkspaceStorageRoot,
    'root-a-older-single-hash',
    'devsessioncanvas.dev-session-canvas'
  );
  const rootBSingleRootPath = storagePath.join(
    untitledWorkspaceStorageRoot,
    'root-b-single-hash',
    'devsessioncanvas.dev-session-canvas'
  );
  const untitledForkEntries = [
    'untitled-multiroot-hash',
    'root-a-single-hash',
    'root-a-older-single-hash',
    'root-b-single-hash'
  ];
  const untitledForkFixture = buildSnapshotFixture([
    [
      storagePath.join(untitledWorkspaceStorageRoot, 'untitled-multiroot-hash', 'meta.json'),
      createWorkspaceMetaText({
        id: 'untitled-multiroot-hash',
        name: 'Untitled (Workspace)'
      })
    ],
    [
      storagePath.join(untitledWorkspaceStorageRoot, 'root-a-single-hash', 'meta.json'),
      createWorkspaceMetaText({
        id: 'root-a-single-hash',
        name: 'root-a'
      })
    ],
    [storagePath.join(rootASingleRootPath, 'canvas-state.json'), createSnapshotText({
      title: 'ROOT-A-NEW',
      writtenAt: '2026-05-29T08:00:00.000Z',
      updatedAt: '2026-05-29T07:59:00.000Z'
    })],
    [
      storagePath.join(untitledWorkspaceStorageRoot, 'root-a-older-single-hash', 'meta.json'),
      createWorkspaceMetaText({
        id: 'root-a-older-single-hash',
        name: 'root-a'
      })
    ],
    [storagePath.join(rootAOlderSingleRootPath, 'canvas-state.json'), createSnapshotText({
      title: 'ROOT-A-OLD',
      writtenAt: '2026-05-28T08:00:00.000Z',
      updatedAt: '2026-05-28T07:59:00.000Z'
    })],
    [
      storagePath.join(untitledWorkspaceStorageRoot, 'root-b-single-hash', 'meta.json'),
      createWorkspaceMetaText({
        id: 'root-b-single-hash',
        name: 'root-b'
      })
    ],
    [storagePath.join(rootBSingleRootPath, 'canvas-state.json'), createSnapshotText({
      title: 'ROOT-B-NEWER-BUT-NOT-FIRST-ROOT',
      writtenAt: '2026-05-29T09:00:00.000Z',
      updatedAt: '2026-05-29T08:59:00.000Z'
    })]
  ]);
  const untitledForkResult = selectUntitledMultiRootWorkspaceStorageForkSource(untitledMultiRootCurrentPath, {
    ...untitledForkFixture,
    listDirectoryEntries: () => untitledForkEntries,
    workspaceFolders: [{ name: 'root-a' }, { name: 'root-b' }]
  });
  assert.ok(untitledForkResult, 'Expected Untitled multi-root fork to find the first-root source snapshot.');
  assert.equal(untitledForkResult.sourcePath, rootASingleRootPath);
  assert.equal(untitledForkResult.selectionBasis, 'first-root-name-match');
  assert.equal(untitledForkResult.sourceCandidate.workspaceName, 'root-a');
  assert.equal(
    untitledForkResult.sourceCandidate.snapshot.stateHash,
    hashStateTitleWithUpdatedAt('ROOT-A-NEW', '2026-05-29T07:59:00.000Z')
  );
  assert.equal(untitledForkResult.sourceCandidate.snapshot.nodeCount, 1);
  assert.equal(untitledForkResult.currentCandidate.snapshot.exists, false);

  const currentEmptySnapshotForkFixture = buildSnapshotFixture([
    [
      storagePath.join(untitledWorkspaceStorageRoot, 'untitled-multiroot-hash', 'meta.json'),
      createWorkspaceMetaText({
        id: 'untitled-multiroot-hash',
        name: 'Untitled (Workspace)'
      })
    ],
    [storagePath.join(untitledMultiRootCurrentPath, 'canvas-state.json'), createEmptySnapshotText({
      writtenAt: '2026-05-29T09:30:00.000Z',
      updatedAt: '2026-05-29T09:29:00.000Z'
    })],
    [
      storagePath.join(untitledWorkspaceStorageRoot, 'root-a-single-hash', 'meta.json'),
      createWorkspaceMetaText({
        id: 'root-a-single-hash',
        name: 'root-a'
      })
    ],
    [storagePath.join(rootASingleRootPath, 'canvas-state.json'), createSnapshotText({
      title: 'ROOT-A-FORK-OVER-EMPTY',
      writtenAt: '2026-05-29T08:00:00.000Z',
      updatedAt: '2026-05-29T07:59:00.000Z'
    })]
  ]);
  const currentEmptySnapshotForkResult = selectUntitledMultiRootWorkspaceStorageForkSource(
    untitledMultiRootCurrentPath,
    {
      ...currentEmptySnapshotForkFixture,
      listDirectoryEntries: () => ['untitled-multiroot-hash', 'root-a-single-hash'],
      workspaceFolders: [{ name: 'root-a' }, { name: 'root-b' }]
    }
  );
  assert.ok(currentEmptySnapshotForkResult, 'Expected empty current snapshot to still allow startup fork.');
  assert.equal(currentEmptySnapshotForkResult.sourcePath, rootASingleRootPath);
  assert.equal(currentEmptySnapshotForkResult.currentCandidate.snapshot.nodeCount, 0);

  const currentNonEmptySnapshotForkResult = selectUntitledMultiRootWorkspaceStorageForkSource(
    untitledMultiRootCurrentPath,
    {
      ...buildSnapshotFixture([
        [storagePath.join(untitledWorkspaceStorageRoot, 'untitled-multiroot-hash', 'meta.json'), createWorkspaceMetaText({
          id: 'untitled-multiroot-hash',
          name: 'Untitled (Workspace)'
        })],
        [storagePath.join(untitledMultiRootCurrentPath, 'canvas-state.json'), createSnapshotText({
          title: 'CURRENT-MULTIROOT-HAS-NODES',
          writtenAt: '2026-05-29T09:30:00.000Z',
          updatedAt: '2026-05-29T09:29:00.000Z'
        })],
        [storagePath.join(untitledWorkspaceStorageRoot, 'root-a-single-hash', 'meta.json'), createWorkspaceMetaText({
          id: 'root-a-single-hash',
          name: 'root-a'
        })],
        [storagePath.join(rootASingleRootPath, 'canvas-state.json'), createSnapshotText({
          title: 'ROOT-A-SHOULD-NOT-OVERRIDE-CURRENT',
          writtenAt: '2026-05-29T08:00:00.000Z',
          updatedAt: '2026-05-29T07:59:00.000Z'
        })]
      ]),
      listDirectoryEntries: () => ['untitled-multiroot-hash', 'root-a-single-hash'],
      workspaceFolders: [{ name: 'root-a' }, { name: 'root-b' }]
    }
  );
  assert.equal(
    currentNonEmptySnapshotForkResult,
    undefined,
    'Current Untitled multi-root snapshots with nodes must never be overwritten by startup fork.'
  );

  const unrelatedPath = '/home/users/example/.config/dev-session-canvas';
  const unrelatedResult = selectPreferredExtensionStorageRecoverySource(unrelatedPath, {
    pathExists: () => true
  });
  assert.equal(unrelatedResult.sourcePath, unrelatedPath);
  assert.equal(unrelatedResult.writePath, unrelatedPath);

  console.log('extensionStoragePaths tests passed');
} finally {
  await rm(tempDir, { recursive: true, force: true });
}

function buildSnapshotFixture(entries) {
  const textFiles = new Map(entries);
  return {
    pathExists(candidatePath) {
      if (textFiles.has(candidatePath)) {
        return true;
      }

      for (const existingPath of textFiles.keys()) {
        if (existingPath.startsWith(`${candidatePath}${storagePath.sep}`)) {
          return true;
        }
      }

      return false;
    },
    readTextFile(candidatePath) {
      const content = textFiles.get(candidatePath);
      if (content === undefined) {
        throw new Error(`Missing mock file: ${candidatePath}`);
      }
      return content;
    }
  };
}

function createSnapshotText({ title, writtenAt, updatedAt }) {
  const state = {
    version: 1,
    updatedAt,
    nodes: [
      {
        id: 'note-1',
        kind: 'note',
        title,
        status: 'ready',
        summary: 'fixture',
        position: { x: 40, y: 40 },
        size: { width: 420, height: 320 },
        metadata: {
          note: {
            content: title
          }
        }
      }
    ]
  };

  return `${JSON.stringify({
    version: 1,
    writtenAt,
    stateHash: createHash('sha256').update(JSON.stringify(state)).digest('hex').slice(0, 12),
    state,
    activeSurface: 'panel'
  })}\n`;
}

function createEmptySnapshotText({ writtenAt, updatedAt }) {
  const state = {
    version: 1,
    updatedAt,
    nodes: []
  };

  return `${JSON.stringify({
    version: 1,
    writtenAt,
    stateHash: createHash('sha256').update(JSON.stringify(state)).digest('hex').slice(0, 12),
    state,
    activeSurface: 'panel'
  })}\n`;
}

function hashStateTitle(title) {
  return hashStateTitleWithUpdatedAt(title, '2026-04-16T08:59:00.000Z');
}

function hashStateTitleWithUpdatedAt(title, updatedAt) {
  const state = {
    version: 1,
    updatedAt,
    nodes: [
      {
        id: 'note-1',
        kind: 'note',
        title,
        status: 'ready',
        summary: 'fixture',
        position: { x: 40, y: 40 },
        size: { width: 420, height: 320 },
        metadata: {
          note: {
            content: title
          }
        }
      }
    ]
  };
  return createHash('sha256').update(JSON.stringify(state)).digest('hex').slice(0, 12);
}

function createWorkspaceMetaText(meta) {
  return `${JSON.stringify(meta)}\n`;
}
