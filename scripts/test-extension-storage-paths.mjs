import assert from 'node:assert/strict';
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
  const { resolvePreferredExtensionStoragePath } = require(outfile);

  const stablePath =
    '/home/users/example/.vscode-server/data/User/workspaceStorage/' +
    '33709ceba1e836bc24c67b57ee72421c/devsessioncanvas.dev-session-canvas';
  const indexedPath =
    '/home/users/example/.vscode-server/data/User/workspaceStorage/' +
    '33709ceba1e836bc24c67b57ee72421c-1/devsessioncanvas.dev-session-canvas';

  const unchangedResult = resolvePreferredExtensionStoragePath(stablePath, {
    pathExists: () => false
  });
  assert.equal(unchangedResult.currentPath, stablePath);
  assert.equal(unchangedResult.resolvedPath, stablePath);
  assert.equal(unchangedResult.recoveryReason, undefined);

  const snapshotFallbackResult = resolvePreferredExtensionStoragePath(indexedPath, {
    pathExists: (candidatePath) => candidatePath === path.join(stablePath, 'canvas-state.json')
  });
  assert.equal(snapshotFallbackResult.currentPath, indexedPath);
  assert.equal(snapshotFallbackResult.resolvedPath, stablePath);
  assert.equal(snapshotFallbackResult.recoveryReason, 'workspace-storage-slot-fallback');

  const runtimeRegistryFallbackResult = resolvePreferredExtensionStoragePath(indexedPath, {
    pathExists: (candidatePath) =>
      candidatePath === path.join(stablePath, 'runtime-supervisor', 'registry.json')
  });
  assert.equal(runtimeRegistryFallbackResult.resolvedPath, stablePath);

  const agentRuntimeFallbackResult = resolvePreferredExtensionStoragePath(indexedPath, {
    pathExists: (candidatePath) => candidatePath === path.join(stablePath, 'agent-runtime')
  });
  assert.equal(agentRuntimeFallbackResult.resolvedPath, stablePath);

  const preferCurrentIndexedPathResult = resolvePreferredExtensionStoragePath(indexedPath, {
    pathExists: (candidatePath) => candidatePath === path.join(indexedPath, 'canvas-state.json')
  });
  assert.equal(preferCurrentIndexedPathResult.resolvedPath, indexedPath);
  assert.equal(preferCurrentIndexedPathResult.recoveryReason, undefined);

  const unrelatedPath = '/home/users/example/.config/dev-session-canvas';
  const unrelatedResult = resolvePreferredExtensionStoragePath(unrelatedPath, {
    pathExists: () => true
  });
  assert.equal(unrelatedResult.resolvedPath, unrelatedPath);

  console.log('extensionStoragePaths tests passed');
} finally {
  await rm(tempDir, { recursive: true, force: true });
}
