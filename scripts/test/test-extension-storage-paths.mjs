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
    stdin: {
      contents:
        "export { isBuiltinGettingStartedOnlyCanvasState, resolvePreferredExtensionStoragePath, selectPreferredExtensionStorageRecoverySource, selectUntitledMultiRootWorkspaceStorageForkSource } from './src/common/extensionStoragePaths';\n" +
        "export { shouldBlockUntitledMultiRootWorkspaceStorageForkByWorkspaceState } from './src/panel/CanvasPanelManager';",
      resolveDir: process.cwd(),
      sourcefile: 'extension-storage-paths-entry.ts'
    },
    bundle: true,
    format: 'cjs',
    outfile,
    platform: 'node',
    target: 'node18',
    external: ['node-pty'],
    plugins: [createMockVscodePlugin()]
  });

  const require = createRequire(import.meta.url);
  const {
    isBuiltinGettingStartedOnlyCanvasState,
    resolvePreferredExtensionStoragePath,
    selectPreferredExtensionStorageRecoverySource,
    selectUntitledMultiRootWorkspaceStorageForkSource,
    shouldBlockUntitledMultiRootWorkspaceStorageForkByWorkspaceState
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
  const rootACanonicalPath = storagePath.join(
    untitledWorkspaceStorageRoot,
    'root-a-canonical-hash',
    'devsessioncanvas.dev-session-canvas'
  );
  const rootAStaleIndexedPath = storagePath.join(
    untitledWorkspaceStorageRoot,
    'root-a-canonical-hash-2',
    'devsessioncanvas.dev-session-canvas'
  );
  const currentCopiedUntitledPath = storagePath.join(
    untitledWorkspaceStorageRoot,
    'copied-untitled-multiroot-hash',
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
    workspaceFolders: [
      { name: 'root-a', path: '/workspace/root-a' },
      { name: 'root-b', path: '/workspace/root-b' }
    ]
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
      workspaceFolders: [
        { name: 'root-a', path: '/workspace/root-a' },
        { name: 'root-b', path: '/workspace/root-b' }
      ]
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
      workspaceFolders: [
        { name: 'root-a', path: '/workspace/root-a' },
        { name: 'root-b', path: '/workspace/root-b' }
      ]
    }
  );
  assert.equal(
    currentNonEmptySnapshotForkResult,
    undefined,
    'Current Untitled multi-root snapshots with nodes must never be overwritten by startup fork.'
  );

  const missingMetaFirstRootPathHintResult = selectUntitledMultiRootWorkspaceStorageForkSource(
    untitledMultiRootCurrentPath,
    {
      ...buildSnapshotFixture([
        [storagePath.join(untitledWorkspaceStorageRoot, 'untitled-multiroot-hash', 'meta.json'), createWorkspaceMetaText({
          id: 'untitled-multiroot-hash',
          name: 'Untitled (Workspace)'
        })],
        [storagePath.join(rootASingleRootPath, 'canvas-state.json'), createExecutionSnapshotText({
          title: 'ROOT-A-PATH-HINT',
          cwd: '/workspace/root-a/packages/api',
          writtenAt: '2026-05-29T10:00:00.000Z',
          updatedAt: '2026-05-29T09:59:00.000Z'
        })],
        [storagePath.join(rootBSingleRootPath, 'canvas-state.json'), createExecutionSnapshotText({
          title: 'ROOT-B-NEWER-BUT-PATH-HINT-NOT-FIRST',
          cwd: '/workspace/root-b',
          writtenAt: '2026-05-29T11:00:00.000Z',
          updatedAt: '2026-05-29T10:59:00.000Z'
        })]
      ]),
      listDirectoryEntries: () => ['untitled-multiroot-hash', 'root-a-single-hash', 'root-b-single-hash'],
      workspaceFolders: [
        { name: 'root-a', path: '/workspace/root-a' },
        { name: 'root-b', path: '/workspace/root-b' }
      ]
    }
  );
  assert.ok(
    missingMetaFirstRootPathHintResult,
    'Expected missing-meta source to fall back to first-root cwd path hints.'
  );
  assert.equal(missingMetaFirstRootPathHintResult.sourcePath, rootASingleRootPath);
  assert.equal(missingMetaFirstRootPathHintResult.selectionBasis, 'first-root-path-hint');
  assert.equal(missingMetaFirstRootPathHintResult.sourceCandidate.rootPathHintIndex, 0);
  assert.equal(missingMetaFirstRootPathHintResult.sourceCandidate.rootPathHintName, 'root-a');
  assert.deepEqual(missingMetaFirstRootPathHintResult.sourceCandidate.rootPathHintMatchedRootIndexes, [0]);
  assert.equal(missingMetaFirstRootPathHintResult.sourceCandidate.snapshot.builtinGettingStartedOnly, false);

  const canonicalFamilyBeatsStaleIndexedPathHintResult = selectUntitledMultiRootWorkspaceStorageForkSource(
    untitledMultiRootCurrentPath,
    {
      ...buildSnapshotFixture([
        [storagePath.join(rootACanonicalPath, 'canvas-state.json'), createExecutionSnapshotText({
          title: 'ROOT-A-CANONICAL-CURRENT',
          cwd: '/home/users/example',
          writtenAt: '2026-05-29T16:39:33.951Z',
          updatedAt: '2026-05-29T16:39:33.951Z'
        })],
        [storagePath.join(rootAStaleIndexedPath, 'canvas-state.json'), createExecutionSnapshotText({
          title: 'ROOT-A-STALE-INDEXED-PATH-HINT',
          cwd: '/workspace/root-a',
          runtimeStoragePath: storagePath.join(rootACanonicalPath, 'agent-runtime'),
          writtenAt: '2026-05-26T16:49:45.286Z',
          updatedAt: '2026-05-26T16:49:45.286Z'
        })]
      ]),
      listDirectoryEntries: () => [
        'untitled-multiroot-hash',
        'root-a-canonical-hash',
        'root-a-canonical-hash-2'
      ],
      workspaceFolders: [
        { name: 'root-a', path: '/workspace/root-a' },
        { name: 'root-b', path: '/workspace/root-b' }
      ]
    }
  );
  assert.ok(
    canonicalFamilyBeatsStaleIndexedPathHintResult,
    'Expected indexed path-hint evidence to recover the canonical root slot in the same slot family.'
  );
  assert.equal(canonicalFamilyBeatsStaleIndexedPathHintResult.sourcePath, rootACanonicalPath);
  assert.equal(
    canonicalFamilyBeatsStaleIndexedPathHintResult.selectionBasis,
    'first-root-canonical-slot-family'
  );
  assert.equal(canonicalFamilyBeatsStaleIndexedPathHintResult.sourceCandidate.slotName, 'root-a-canonical-hash');
  assert.equal(canonicalFamilyBeatsStaleIndexedPathHintResult.sourceCandidate.slotIndex, 0);
  assert.equal(
    canonicalFamilyBeatsStaleIndexedPathHintResult.evidenceCandidate.slotName,
    'root-a-canonical-hash-2'
  );
  assert.deepEqual(
    canonicalFamilyBeatsStaleIndexedPathHintResult.evidenceCandidate.snapshot.executionStorageSlotHints,
    ['root-a-canonical-hash']
  );
  assert.equal(canonicalFamilyBeatsStaleIndexedPathHintResult.evidenceCandidate.rootPathHintIndex, 0);
  assert.deepEqual(canonicalFamilyBeatsStaleIndexedPathHintResult.evidenceCandidate.rootPathHintMatchedRootIndexes, [0]);

  const runtimeStorageHintBeatsCopiedCurrentPathHintResult = selectUntitledMultiRootWorkspaceStorageForkSource(
    untitledMultiRootCurrentPath,
    {
      ...buildSnapshotFixture([
        [storagePath.join(rootACanonicalPath, 'canvas-state.json'), createExecutionSnapshotText({
          title: 'ROOT-A-CANONICAL-CURRENT-BY-RUNTIME-HINT',
          cwd: '/home/users/example',
          writtenAt: '2026-05-29T16:39:33.951Z',
          updatedAt: '2026-05-29T16:39:33.951Z'
        })],
        [storagePath.join(rootAStaleIndexedPath, 'canvas-state.json'), createExecutionSnapshotText({
          title: 'ROOT-A-STALE-COPIED-INTO-CURRENT',
          cwd: '/workspace/root-a',
          runtimeStoragePath: storagePath.join(rootACanonicalPath, 'agent-runtime'),
          writtenAt: '2026-05-29T16:44:15.871Z',
          updatedAt: '2026-05-29T16:44:15.871Z'
        })]
      ]),
      listDirectoryEntries: () => [
        'untitled-multiroot-hash',
        'root-a-canonical-hash',
        'root-a-canonical-hash-2'
      ],
      workspaceFolders: [
        { name: 'root-a', path: '/workspace/root-a' },
        { name: 'root-b', path: '/workspace/root-b' }
      ]
    }
  );
  assert.ok(
    runtimeStorageHintBeatsCopiedCurrentPathHintResult,
    'Expected runtime storage slot hints to choose the canonical source even if copied evidence is newer.'
  );
  assert.equal(runtimeStorageHintBeatsCopiedCurrentPathHintResult.sourcePath, rootACanonicalPath);
  assert.equal(runtimeStorageHintBeatsCopiedCurrentPathHintResult.selectionBasis, 'first-root-canonical-slot-family');
  assert.equal(runtimeStorageHintBeatsCopiedCurrentPathHintResult.evidenceCandidate.slotName, 'root-a-canonical-hash-2');

  const currentCopiedEvidenceCanRecoverCanonicalResult = selectUntitledMultiRootWorkspaceStorageForkSource(
    currentCopiedUntitledPath,
    {
      ...buildSnapshotFixture([
        [
          storagePath.join(untitledWorkspaceStorageRoot, 'copied-untitled-multiroot-hash', 'meta.json'),
          createWorkspaceMetaText({
            id: 'copied-untitled-multiroot-hash',
            name: 'Untitled (Workspace)'
          })
        ],
        [storagePath.join(currentCopiedUntitledPath, 'canvas-state.json'), createExecutionSnapshotText({
          title: 'ROOT-A-STALE-COPIED-CURRENT-SLOT',
          cwd: '/workspace/root-a',
          runtimeStoragePath: storagePath.join(rootACanonicalPath, 'agent-runtime'),
          writtenAt: '2026-05-29T16:44:15.871Z',
          updatedAt: '2026-05-29T16:44:15.871Z'
        })],
        [storagePath.join(rootACanonicalPath, 'canvas-state.json'), createExecutionSnapshotText({
          title: 'ROOT-A-CANONICAL-CURRENT-FROM-COPIED-SLOT',
          cwd: '/home/users/example',
          writtenAt: '2026-05-29T16:39:33.951Z',
          updatedAt: '2026-05-29T16:39:33.951Z'
        })]
      ]),
      listDirectoryEntries: () => [
        'copied-untitled-multiroot-hash',
        'root-a-canonical-hash'
      ],
      workspaceFolders: [
        { name: 'root-a', path: '/workspace/root-a' },
        { name: 'root-b', path: '/workspace/root-b' }
      ]
    }
  );
  assert.ok(
    currentCopiedEvidenceCanRecoverCanonicalResult,
    'Expected a copied current Untitled snapshot to recover the canonical root slot it references.'
  );
  assert.equal(currentCopiedEvidenceCanRecoverCanonicalResult.sourcePath, rootACanonicalPath);
  assert.equal(
    currentCopiedEvidenceCanRecoverCanonicalResult.selectionBasis,
    'first-root-canonical-slot-family'
  );
  assert.equal(
    currentCopiedEvidenceCanRecoverCanonicalResult.evidenceCandidate.slotName,
    'copied-untitled-multiroot-hash'
  );
  assert.equal(currentCopiedEvidenceCanRecoverCanonicalResult.evidenceCandidate.isCurrent, true);
  assert.equal(currentCopiedEvidenceCanRecoverCanonicalResult.currentCandidate.snapshot.nodeCount, 1);
  assert.deepEqual(
    currentCopiedEvidenceCanRecoverCanonicalResult.currentCandidate.snapshot.executionStorageSlotHints,
    ['root-a-canonical-hash']
  );

  const currentCopiedWorkspaceState = JSON.parse(
    createExecutionSnapshotText({
      title: 'ROOT-A-STALE-COPIED-CURRENT-SLOT',
      cwd: '/workspace/root-a',
      runtimeStoragePath: storagePath.join(rootACanonicalPath, 'agent-runtime'),
      writtenAt: '2026-05-29T16:44:15.871Z',
      updatedAt: '2026-05-29T16:44:15.871Z'
    })
  ).state;
  const currentCopiedWorkspaceStateGuard = shouldBlockUntitledMultiRootWorkspaceStorageForkByWorkspaceState({
    workspaceState: currentCopiedWorkspaceState,
    selection: currentCopiedEvidenceCanRecoverCanonicalResult
  });
  assert.deepEqual(
    currentCopiedWorkspaceStateGuard,
    { blocked: false, workspaceStateNodeCount: 1 },
    'Expected workspaceState copied from the stale current slot not to block canonical recovery.'
  );

  const currentCopiedWorkspaceStateGuardWithoutSelection = shouldBlockUntitledMultiRootWorkspaceStorageForkByWorkspaceState({
    workspaceState: currentCopiedWorkspaceState,
    selection: undefined
  });
  assert.deepEqual(
    currentCopiedWorkspaceStateGuardWithoutSelection,
    { blocked: true, reason: 'current-workspace-state-has-nodes', workspaceStateNodeCount: 1 },
    'Expected meaningful workspaceState to keep blocking ordinary Untitled multi-root fork attempts.'
  );

  const currentCopiedWorkspaceStateGuardWithNonCurrentEvidence = shouldBlockUntitledMultiRootWorkspaceStorageForkByWorkspaceState({
    workspaceState: currentCopiedWorkspaceState,
    selection: runtimeStorageHintBeatsCopiedCurrentPathHintResult
  });
  assert.deepEqual(
    currentCopiedWorkspaceStateGuardWithNonCurrentEvidence,
    { blocked: true, reason: 'current-workspace-state-has-nodes', workspaceStateNodeCount: 1 },
    'Expected workspaceState to allow only current-slot copied evidence, not every canonical source selection.'
  );

  const indexedPathHintStillWorksWhenCanonicalMissingResult = selectUntitledMultiRootWorkspaceStorageForkSource(
    untitledMultiRootCurrentPath,
    {
      ...buildSnapshotFixture([
        [storagePath.join(rootAStaleIndexedPath, 'canvas-state.json'), createExecutionSnapshotText({
          title: 'ROOT-A-INDEXED-ONLY-PATH-HINT',
          cwd: '/workspace/root-a',
          writtenAt: '2026-05-29T10:00:00.000Z',
          updatedAt: '2026-05-29T09:59:00.000Z'
        })]
      ]),
      listDirectoryEntries: () => ['untitled-multiroot-hash', 'root-a-canonical-hash-2'],
      workspaceFolders: [
        { name: 'root-a', path: '/workspace/root-a' },
        { name: 'root-b', path: '/workspace/root-b' }
      ]
    }
  );
  assert.ok(
    indexedPathHintStillWorksWhenCanonicalMissingResult,
    'Expected indexed path-hint fallback to remain usable when the canonical slot has no recoverable snapshot.'
  );
  assert.equal(indexedPathHintStillWorksWhenCanonicalMissingResult.sourcePath, rootAStaleIndexedPath);
  assert.equal(indexedPathHintStillWorksWhenCanonicalMissingResult.selectionBasis, 'first-root-path-hint');

  const exactMetaBeatsPathHintFallbackResult = selectUntitledMultiRootWorkspaceStorageForkSource(
    untitledMultiRootCurrentPath,
    {
      ...buildSnapshotFixture([
        [storagePath.join(untitledWorkspaceStorageRoot, 'root-a-older-single-hash', 'meta.json'), createWorkspaceMetaText({
          id: 'root-a-older-single-hash',
          name: 'root-a'
        })],
        [storagePath.join(rootAOlderSingleRootPath, 'canvas-state.json'), createSnapshotText({
          title: 'ROOT-A-META-MATCH-OLDER',
          writtenAt: '2026-05-29T08:00:00.000Z',
          updatedAt: '2026-05-29T07:59:00.000Z'
        })],
        [storagePath.join(rootASingleRootPath, 'canvas-state.json'), createExecutionSnapshotText({
          title: 'ROOT-A-PATH-HINT-NEWER',
          cwd: '/workspace/root-a',
          writtenAt: '2026-05-29T10:00:00.000Z',
          updatedAt: '2026-05-29T09:59:00.000Z'
        })]
      ]),
      listDirectoryEntries: () => ['untitled-multiroot-hash', 'root-a-older-single-hash', 'root-a-single-hash'],
      workspaceFolders: [
        { name: 'root-a', path: '/workspace/root-a' },
        { name: 'root-b', path: '/workspace/root-b' }
      ]
    }
  );
  assert.ok(exactMetaBeatsPathHintFallbackResult);
  assert.equal(exactMetaBeatsPathHintFallbackResult.sourcePath, rootAOlderSingleRootPath);
  assert.equal(exactMetaBeatsPathHintFallbackResult.selectionBasis, 'first-root-name-match');

  const builtinGettingStartedCurrentSnapshotResult = selectUntitledMultiRootWorkspaceStorageForkSource(
    untitledMultiRootCurrentPath,
    {
      ...buildSnapshotFixture([
        [storagePath.join(untitledMultiRootCurrentPath, 'canvas-state.json'), createBuiltinGettingStartedSnapshotText({
          writtenAt: '2026-05-29T10:30:00.000Z',
          updatedAt: '2026-05-29T10:29:00.000Z'
        })],
        [storagePath.join(rootASingleRootPath, 'canvas-state.json'), createExecutionSnapshotText({
          title: 'ROOT-A-FORK-OVER-BUILTIN',
          cwd: '/workspace/root-a',
          writtenAt: '2026-05-29T10:00:00.000Z',
          updatedAt: '2026-05-29T09:59:00.000Z'
        })]
      ]),
      listDirectoryEntries: () => ['untitled-multiroot-hash', 'root-a-single-hash'],
      workspaceFolders: [
        { name: 'root-a', path: '/workspace/root-a' },
        { name: 'root-b', path: '/workspace/root-b' }
      ]
    }
  );
  assert.ok(
    builtinGettingStartedCurrentSnapshotResult,
    'Expected the builtin getting-started current snapshot to be treated as non-meaningful for fork recovery.'
  );
  assert.equal(builtinGettingStartedCurrentSnapshotResult.sourcePath, rootASingleRootPath);
  assert.equal(builtinGettingStartedCurrentSnapshotResult.selectionBasis, 'first-root-path-hint');
  assert.equal(builtinGettingStartedCurrentSnapshotResult.currentCandidate.snapshot.builtinGettingStartedOnly, true);
  assert.equal(
    isBuiltinGettingStartedOnlyCanvasState(createBuiltinGettingStartedSnapshot({
      updatedAt: '2026-05-29T10:29:00.000Z'
    })),
    true,
    'Expected builtin getting-started state to be reusable by host-level workspaceState fork guards.'
  );
  assert.equal(
    isBuiltinGettingStartedOnlyCanvasState({
      version: 1,
      updatedAt: '2026-05-29T10:29:00.000Z',
      nodes: []
    }),
    false
  );

  const builtinGettingStartedSourceIgnoredResult = selectUntitledMultiRootWorkspaceStorageForkSource(
    untitledMultiRootCurrentPath,
    {
      ...buildSnapshotFixture([
        [storagePath.join(rootASingleRootPath, 'canvas-state.json'), createBuiltinGettingStartedSnapshotText({
          writtenAt: '2026-05-29T10:00:00.000Z',
          updatedAt: '2026-05-29T09:59:00.000Z'
        })]
      ]),
      listDirectoryEntries: () => ['untitled-multiroot-hash', 'root-a-single-hash'],
      workspaceFolders: [
        { name: 'root-a', path: '/workspace/root-a' },
        { name: 'root-b', path: '/workspace/root-b' }
      ]
    }
  );
  assert.equal(
    builtinGettingStartedSourceIgnoredResult,
    undefined,
    'Builtin getting-started snapshots should not become fork sources.'
  );

  const ambiguousPathHintResult = selectUntitledMultiRootWorkspaceStorageForkSource(
    untitledMultiRootCurrentPath,
    {
      ...buildSnapshotFixture([
        [storagePath.join(rootASingleRootPath, 'canvas-state.json'), createExecutionSnapshotText({
          title: 'AMBIGUOUS-ROOTS',
          cwd: '/workspace/root-a',
          extraCwd: '/workspace/root-b',
          writtenAt: '2026-05-29T10:00:00.000Z',
          updatedAt: '2026-05-29T09:59:00.000Z'
        })]
      ]),
      listDirectoryEntries: () => ['untitled-multiroot-hash', 'root-a-single-hash'],
      workspaceFolders: [
        { name: 'root-a', path: '/workspace/root-a' },
        { name: 'root-b', path: '/workspace/root-b' }
      ]
    }
  );
  assert.equal(
    ambiguousPathHintResult,
    undefined,
    'Snapshots with execution hints under multiple roots should not be used as path-hint fallback sources.'
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


function createMockVscodePlugin() {
  return {
    name: 'mock-vscode',
    setup(build) {
      build.onResolve({ filter: /^vscode$/ }, () => ({ path: 'vscode', namespace: 'mock-vscode' }));
      build.onLoad({ filter: /.*/, namespace: 'mock-vscode' }, () => ({
        loader: 'js',
        contents: `
          class Disposable { dispose() {} }
          class EventEmitter { constructor() { this.event = () => new Disposable(); } fire() {} dispose() {} }
          class ThemeIcon { constructor(id) { this.id = id; } }
          class TreeItem { constructor(label, collapsibleState) { this.label = label; this.collapsibleState = collapsibleState; } }
          class Position { constructor(line, character) { this.line = line; this.character = character; } }
          class Range { constructor(start, end) { this.start = start; this.end = end; } }
          class MarkdownString { constructor(value) { this.value = value; } appendMarkdown(value) { this.value = (this.value || '') + value; return this; } }
          const Uri = {
            file: (fsPath) => ({ fsPath, path: fsPath, scheme: 'file', toString: () => fsPath, with(change) { return { ...this, ...change }; } }),
            joinPath: (base, ...segments) => ({ fsPath: [base?.fsPath, ...segments].filter(Boolean).join('/'), path: [base?.path, ...segments].filter(Boolean).join('/'), scheme: base?.scheme ?? 'file', toString() { return this.path; }, with(change) { return { ...this, ...change }; } }),
            parse: (value) => ({ fsPath: value, path: value, scheme: String(value).split(':', 1)[0], toString: () => value, with(change) { return { ...this, ...change }; } })
          };
          module.exports = {
            Disposable,
            EventEmitter,
            ThemeIcon,
            TreeItem,
            Position,
            Range,
            MarkdownString,
            TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
            Uri,
            ViewColumn: { One: 1, Beside: -2 },
            ExtensionMode: { Production: 1, Development: 2, Test: 3 },
            OverviewRulerLane: { Right: 4 },
            DiagnosticSeverity: { Error: 0, Warning: 1, Information: 2, Hint: 3 },
            FileType: { Unknown: 0, File: 1, Directory: 2, SymbolicLink: 64 },
            commands: {
              executeCommand: async () => undefined,
              registerCommand: () => new Disposable()
            },
            env: { appName: 'VS Code Test', remoteName: undefined, shell: '/bin/bash', clipboard: { writeText: async () => undefined } },
            window: {
              activeTextEditor: undefined,
              showInformationMessage: async () => undefined,
              showWarningMessage: async () => undefined,
              showErrorMessage: async () => undefined,
              showQuickPick: async () => undefined,
              registerTreeDataProvider: () => new Disposable(),
              registerWebviewViewProvider: () => new Disposable(),
              registerWebviewPanelSerializer: () => new Disposable(),
              createOutputChannel: () => ({ appendLine() {}, show() {}, dispose() {} }),
              createWebviewPanel: () => ({ webview: { postMessage: async () => true, onDidReceiveMessage: () => new Disposable(), asWebviewUri: (uri) => uri }, onDidDispose: () => new Disposable(), onDidChangeViewState: () => new Disposable(), reveal() {}, dispose() {} })
            },
            workspace: {
              isTrusted: true,
              workspaceFolders: [],
              workspaceFile: undefined,
              getConfiguration: () => ({ get: () => undefined, update: async () => undefined, inspect: () => undefined }),
              onDidChangeConfiguration: () => new Disposable(),
              onDidGrantWorkspaceTrust: () => new Disposable(),
              onDidChangeWorkspaceFolders: () => new Disposable(),
              createFileSystemWatcher: () => ({ onDidChange: () => new Disposable(), onDidCreate: () => new Disposable(), onDidDelete: () => new Disposable(), dispose() {} }),
              getWorkspaceFolder: () => undefined,
              asRelativePath: (value) => value?.fsPath || String(value),
              fs: { stat: async () => ({ type: 1 }), writeFile: async () => undefined, readFile: async () => new Uint8Array(), createDirectory: async () => undefined }
            },
            languages: { createDiagnosticCollection: () => ({ set() {}, delete() {}, clear() {}, dispose() {} }) }
          };
        `
      }));
    }
  };
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

function createExecutionSnapshotText({ title, cwd, runtimeStoragePath, resumeStoragePath, extraCwd, writtenAt, updatedAt }) {
  const nodes = [
    {
      id: 'agent-1',
      kind: 'agent',
      title,
      status: 'idle',
      summary: 'fixture',
      position: { x: 40, y: 40 },
      size: { width: 560, height: 430 },
      metadata: {
        agent: {
          cwd,
          runtimeStoragePath: runtimeStoragePath ?? storagePath.join(cwd, '.runtime-storage'),
          resumeStoragePath: resumeStoragePath ?? storagePath.join(cwd, '.resume-storage')
        }
      }
    }
  ];
  if (extraCwd) {
    nodes.push({
      id: 'terminal-2',
      kind: 'terminal',
      title: `${title}-terminal`,
      status: 'idle',
      summary: 'fixture',
      position: { x: 640, y: 40 },
      size: { width: 540, height: 430 },
      metadata: {
        terminal: {
          cwd: extraCwd
        }
      }
    });
  }

  const state = {
    version: 1,
    updatedAt,
    nodes
  };

  return `${JSON.stringify({
    version: 1,
    writtenAt,
    stateHash: createHash('sha256').update(JSON.stringify(state)).digest('hex').slice(0, 12),
    state,
    activeSurface: 'panel'
  })}\n`;
}

function createBuiltinGettingStartedSnapshotText({ writtenAt, updatedAt }) {
  const state = createBuiltinGettingStartedSnapshot({ updatedAt });

  return `${JSON.stringify({
    version: 1,
    writtenAt,
    stateHash: createHash('sha256').update(JSON.stringify(state)).digest('hex').slice(0, 12),
    state,
    activeSurface: 'panel'
  })}\n`;
}

function createBuiltinGettingStartedSnapshot({ updatedAt }) {
  return {
    version: 1,
    updatedAt,
    nodes: [
      {
        id: 'note-1',
        kind: 'note',
        title: 'Dev Session Canvas \u4f7f\u7528\u6307\u5357',
        status: 'ready',
        summary: 'fixture',
        position: { x: 0, y: 0 },
        size: { width: 900, height: 1150 },
        metadata: {
          note: {
            content:
              '# Dev Session Canvas \u4f7f\u7528\u6307\u5357\n\n**\u63d0\u793a**\uff1a\u8fd9\u4e2a\u6a21\u677f\u4e0d\u4f1a\u81ea\u52a8\u521b\u5efa Agent \u6216 Terminal\uff0c\u4f60\u53ef\u4ee5\u81ea\u5df1\u5c1d\u8bd5\u521b\u5efa\u8282\u70b9\u6765\u719f\u6089\u753b\u5e03\u64cd\u4f5c\uff01'
          }
        }
      }
    ]
  };
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
