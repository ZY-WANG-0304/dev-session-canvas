import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

import esbuild from 'esbuild';

const tempDir = await mkdtemp(path.join(os.tmpdir(), 'dsc-extension-storage-paths-'));

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
    selectPreferredExtensionStorageRecoverySource
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

  const fresherSiblingSnapshots = buildSnapshotFixture([
    [path.join(indexedPathOne, 'canvas-state.json'), createSnapshotText({
      title: 'CURRENT-OLD',
      writtenAt: '2026-04-15T09:00:00.000Z',
      updatedAt: '2026-04-15T08:59:00.000Z'
    })],
    [path.join(stablePath, 'canvas-state.json'), createSnapshotText({
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
    [path.join(indexedPathOne, 'canvas-state.json'), createSnapshotText({
      title: 'CURRENT-NEW',
      writtenAt: '2026-04-16T10:00:00.000Z',
      updatedAt: '2026-04-16T09:59:00.000Z'
    })],
    [path.join(stablePath, 'canvas-state.json'), createSnapshotText({
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
      [path.join(indexedPathOne, 'canvas-state.json'), createSnapshotText({
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
      [path.join(indexedPathOne, 'canvas-state.json'), createSnapshotText({
        title: 'CURRENT-VALID',
        writtenAt: '2026-04-16T10:00:00.000Z',
        updatedAt: '2026-04-16T09:59:00.000Z'
      })],
      [path.join(stablePath, 'canvas-state.json'), createSnapshotText({
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
      candidatePath === path.join(stablePath, 'runtime-supervisor', 'registry.json') ||
      candidatePath === path.join(indexedPathOne, 'agent-runtime'),
    listDirectoryEntries: () => workspaceStorageEntries,
    readTextFile: () => {
      throw new Error('Should not attempt to read snapshot text in pure recoverable fallback case.');
    }
  });
  assert.equal(fallbackToNearestRecoverableStateResult.sourcePath, indexedPathOne);
  assert.equal(fallbackToNearestRecoverableStateResult.selectionBasis, 'recoverable-state-fallback');

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
        if (existingPath.startsWith(`${candidatePath}${path.sep}`)) {
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

function hashStateTitle(title) {
  const state = {
    version: 1,
    updatedAt: '2026-04-16T08:59:00.000Z',
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
