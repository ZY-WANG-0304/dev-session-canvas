import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

import esbuild from 'esbuild';

const tempDir = await mkdtemp(path.join(os.tmpdir(), 'dsc-runtime-host-backend-'));

try {
  const outfile = path.join(tempDir, 'runtimeHostBackend.cjs');
  await esbuild.build({
    entryPoints: [path.resolve('extensions/vscode/dev-session-canvas/src/panel/runtimeHostBackend.ts')],
    bundle: true,
    format: 'cjs',
    outfile,
    platform: 'node',
    target: 'node18',
    plugins: [
      {
        name: 'mock-vscode',
        setup(build) {
          build.onResolve({ filter: /^vscode$/ }, () => ({ path: 'vscode', namespace: 'mock-vscode' }));
          build.onLoad({ filter: /.*/, namespace: 'mock-vscode' }, () => ({
            loader: 'js',
            contents: 'exports.ExtensionMode = { Test: 3 };'
          }));
        }
      }
    ]
  });

  const require = createRequire(import.meta.url);
  const { renderSystemdUserUnit } = require(outfile);
  const storageDir = '/home/users/example/dev session/runtime-supervisor';
  const unit = renderSystemdUserUnit({
    unitName: 'dev-session-canvas-runtime-supervisor-test.service',
    backend: {
      kind: 'systemd-user',
      guarantee: 'strong',
      label: 'systemd --user',
      paths: {
        storageDir,
        controlDir: '/home/users/example/.local/state/dsc/rh/test',
        socketPath: '/home/users/example/.local/state/dsc/rh/test/s.sock',
        registryPath: path.join(storageDir, 'registry.json'),
        socketLocation: 'control-dir'
      },
      startSupervisor: async () => undefined
    },
    supervisorScriptPath: '/opt/dev session/runtime-supervisor.js'
  });

  assert.match(unit, new RegExp(`^WorkingDirectory=${escapeRegExp(storageDir)}$`, 'm'));
  assert.doesNotMatch(unit, /WorkingDirectory="/u);
  assert.match(unit, /^ExecStart="/m);
  assert.match(unit, /^Environment="ELECTRON_RUN_AS_NODE=1"$/m);
  assert.throws(
    () =>
      renderSystemdUserUnit({
        unitName: 'invalid.service',
        backend: {
          kind: 'systemd-user',
          guarantee: 'strong',
          label: 'systemd --user',
          paths: {
            storageDir: 'relative/runtime-supervisor',
            socketPath: '/tmp/s.sock',
            registryPath: 'relative/registry.json',
            socketLocation: 'control-dir'
          },
          startSupervisor: async () => undefined
        },
        supervisorScriptPath: '/opt/runtime-supervisor.js'
      }),
    /WorkingDirectory must be an absolute single-line path/u
  );

  console.log('runtimeHostBackend tests passed');
} finally {
  await rm(tempDir, { recursive: true, force: true });
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
