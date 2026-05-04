import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

import esbuild from 'esbuild';

const tempDir = await mkdtemp(path.join(os.tmpdir(), 'dsc-terminal-shell-config-'));

try {
  const outfile = path.join(tempDir, 'terminalShellConfiguration.cjs');
  await esbuild.build({
    entryPoints: [path.resolve('src/panel/terminalShellConfiguration.ts')],
    bundle: true,
    format: 'cjs',
    outfile,
    platform: 'node',
    target: 'node18'
  });

  const require = createRequire(import.meta.url);
  const {
    normalizeConfiguredTerminalShell,
    resolveConfiguredTerminalShell,
    resolveDefaultTerminalShellPath,
    resolveNamedTerminalShellPath
  } = require(outfile);

  assert.equal(normalizeConfiguredTerminalShell('bash'), 'bash');
  assert.equal(normalizeConfiguredTerminalShell('cmd'), 'cmd');
  assert.equal(normalizeConfiguredTerminalShell('not-a-shell'), 'default');

  assert.equal(
    resolveDefaultTerminalShellPath('linux', {
      SHELL: '/bin/zsh'
    }),
    '/bin/zsh'
  );
  assert.equal(resolveDefaultTerminalShellPath('linux', {}), '/bin/bash');
  assert.equal(
    resolveDefaultTerminalShellPath('win32', {
      ComSpec: 'C:\\Windows\\System32\\cmd.exe'
    }),
    'C:\\Windows\\System32\\cmd.exe'
  );
  assert.equal(resolveDefaultTerminalShellPath('win32', {}), 'powershell.exe');

  assert.equal(resolveNamedTerminalShellPath('bash', 'linux'), 'bash');
  assert.equal(resolveNamedTerminalShellPath('pwsh', 'linux'), 'pwsh');
  assert.equal(resolveNamedTerminalShellPath('powershell', 'win32'), 'powershell.exe');
  assert.equal(resolveNamedTerminalShellPath('cmd', 'win32'), 'cmd.exe');

  assert.deepEqual(
    resolveConfiguredTerminalShell({
      configuredShell: 'zsh',
      configuredPath: '  ',
      platform: 'linux',
      env: {
        SHELL: '/bin/bash'
      }
    }),
    {
      configuredShell: 'zsh',
      configuredPath: '',
      resolvedPath: 'zsh',
      resolutionSource: 'named-shell'
    }
  );

  assert.deepEqual(
    resolveConfiguredTerminalShell({
      configuredShell: 'bash',
      configuredPath: ' /custom/shell ',
      platform: 'linux',
      env: {
        SHELL: '/bin/zsh'
      }
    }),
    {
      configuredShell: 'bash',
      configuredPath: '/custom/shell',
      resolvedPath: '/custom/shell',
      resolutionSource: 'path'
    }
  );

  assert.deepEqual(
    resolveConfiguredTerminalShell({
      configuredShell: 'default',
      configuredPath: '',
      platform: 'win32',
      env: {
        COMSPEC: 'C:\\Windows\\System32\\cmd.exe'
      }
    }),
    {
      configuredShell: 'default',
      configuredPath: '',
      resolvedPath: 'C:\\Windows\\System32\\cmd.exe',
      resolutionSource: 'default-shell'
    }
  );

  console.log('terminal shell configuration tests passed');
} finally {
  await rm(tempDir, { recursive: true, force: true });
}
