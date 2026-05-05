import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
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
    buildPersistedTerminalShellSelection,
    detectAvailableTerminalShells,
    inspectConfiguredTerminalShell,
    normalizeConfiguredTerminalShell,
    resolveEffectiveTerminalShellConfiguration,
    resolveConfiguredTerminalShell,
    resolveDefaultTerminalShellPath,
    resolveNamedTerminalShellPath
  } = require(outfile);

  assert.equal(normalizeConfiguredTerminalShell('bash'), 'bash');
  assert.equal(normalizeConfiguredTerminalShell('cmd'), 'cmd');
  assert.equal(normalizeConfiguredTerminalShell('not-a-shell'), 'default');
  assert.deepEqual(
    resolveEffectiveTerminalShellConfiguration({
      defaultConfiguredShell: 'default',
      defaultConfiguredPath: '',
      globalConfiguredShell: 'zsh',
      globalConfiguredPath: '/global/zsh',
      workspaceConfiguredShell: 'bash',
      hasWorkspace: true
    }),
    {
      configuredShell: 'bash',
      configuredPath: '',
      configurationScope: 'workspace'
    }
  );
  assert.deepEqual(
    resolveEffectiveTerminalShellConfiguration({
      defaultConfiguredShell: 'default',
      defaultConfiguredPath: '',
      globalConfiguredShell: 'zsh',
      globalConfiguredPath: '/global/zsh',
      workspaceConfiguredPath: ' /workspace/bash ',
      hasWorkspace: true
    }),
    {
      configuredShell: 'default',
      configuredPath: '/workspace/bash',
      configurationScope: 'workspace'
    }
  );
  assert.deepEqual(
    resolveEffectiveTerminalShellConfiguration({
      defaultConfiguredShell: 'default',
      defaultConfiguredPath: '',
      globalConfiguredShell: 'zsh',
      globalConfiguredPath: ' /global/zsh ',
      workspaceConfiguredShell: 'bash',
      workspaceConfiguredPath: '/workspace/bash',
      hasWorkspace: false
    }),
    {
      configuredShell: 'zsh',
      configuredPath: '/global/zsh',
      configurationScope: 'global'
    }
  );
  assert.deepEqual(buildPersistedTerminalShellSelection({ useDefault: true }), {
    configuredShell: 'default',
    configuredPath: ''
  });
  assert.equal(buildPersistedTerminalShellSelection({ shellName: 'bash', resolvedPath: '  ' }), undefined);

  assert.equal(
    resolveDefaultTerminalShellPath(
      'linux',
      {
        SHELL: '/bin/zsh'
      },
      ' /custom/default-shell '
    ),
    '/custom/default-shell'
  );
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
      configuredShell: 'bash',
      configuredPath: ' /custom/shell ',
      platform: 'linux',
      env: {
        SHELL: '/bin/zsh'
      }
    }),
    {
      configuredPath: '/custom/shell',
      resolvedPath: '/custom/shell',
      resolutionSource: 'path',
      configuredShell: 'bash'
    }
  );

  assert.deepEqual(
    resolveConfiguredTerminalShell({
      configuredShell: 'default',
      configuredPath: '',
      platform: 'win32',
      env: {
        COMSPEC: 'C:\\Windows\\System32\\cmd.exe'
      },
      defaultShellPath: 'C:\\Program Files\\PowerShell\\7\\pwsh.exe'
    }),
    {
      configuredPath: '',
      resolvedPath: 'C:\\Program Files\\PowerShell\\7\\pwsh.exe',
      resolutionSource: 'default-shell',
      configuredShell: 'default'
    }
  );

  const duplicateShellRoot = path.join(tempDir, 'duplicate-bash');
  const firstBashDir = path.join(duplicateShellRoot, 'first');
  const secondBashDir = path.join(duplicateShellRoot, 'second');
  await mkdir(firstBashDir, { recursive: true });
  await mkdir(secondBashDir, { recursive: true });
  const firstBashPath = path.join(firstBashDir, 'bash');
  const secondBashPath = path.join(secondBashDir, 'bash');
  await createExecutable(firstBashPath);
  await createExecutable(secondBashPath);

  assert.deepEqual(
    buildPersistedTerminalShellSelection({
      shellName: 'bash',
      resolvedPath: ` ${secondBashPath} `
    }),
    {
      configuredShell: 'bash',
      configuredPath: secondBashPath
    }
  );
  assert.deepEqual(
    resolveConfiguredTerminalShell({
      configuredShell: 'bash',
      configuredPath: secondBashPath,
      platform: 'linux',
      env: {
        PATH: `${firstBashDir}:${secondBashDir}`
      }
    }),
    {
      configuredPath: secondBashPath,
      resolvedPath: secondBashPath,
      resolutionSource: 'path',
      configuredShell: 'bash'
    }
  );

  const workspaceShellRoot = path.join(tempDir, 'workspace-shell');
  await mkdir(workspaceShellRoot, { recursive: true });
  const relativeShellPath = path.join(workspaceShellRoot, 'fake-shell');
  await createExecutable(relativeShellPath);

  assert.deepEqual(
    inspectConfiguredTerminalShell({
      configuredShell: 'default',
      configuredPath: './fake-shell',
      platform: 'linux',
      env: {},
      cwd: workspaceShellRoot
    }),
    {
      configuredPath: './fake-shell',
      resolvedPath: './fake-shell',
      resolutionSource: 'path',
      configuredShell: 'default',
      resolvedAvailablePath: relativeShellPath,
      isAvailable: true
    }
  );

  const posixShellDir = path.join(tempDir, 'posix-shells');
  await mkdir(posixShellDir, { recursive: true });
  const bashPath = path.join(posixShellDir, 'bash');
  const zshPath = path.join(posixShellDir, 'zsh');
  const nuPath = path.join(posixShellDir, 'nu');
  const falsePath = path.join(posixShellDir, 'false');
  await createExecutable(bashPath);
  await createExecutable(zshPath);
  await createExecutable(nuPath);
  await createExecutable(falsePath);

  assert.deepEqual(
    buildPersistedTerminalShellSelection({
      shellName: 'nu',
      resolvedPath: ` ${nuPath} `
    }),
    {
      configuredShell: 'default',
      configuredPath: nuPath
    }
  );

  assert.deepEqual(
    resolveConfiguredTerminalShell({
      configuredShell: 'zsh',
      configuredPath: '',
      platform: 'linux',
      env: {
        PATH: posixShellDir
      }
    }),
    {
      configuredPath: '',
      resolvedPath: zshPath,
      resolutionSource: 'named-shell',
      configuredShell: 'zsh'
    }
  );

  assert.deepEqual(
    inspectConfiguredTerminalShell({
      configuredShell: 'zsh',
      configuredPath: '',
      platform: 'linux',
      env: {
        PATH: posixShellDir
      }
    }),
    {
      configuredPath: '',
      resolvedPath: zshPath,
      resolutionSource: 'named-shell',
      configuredShell: 'zsh',
      resolvedAvailablePath: zshPath,
      isAvailable: true
    }
  );

  assert.deepEqual(
    inspectConfiguredTerminalShell({
      configuredShell: 'pwsh',
      configuredPath: '',
      platform: 'win32',
      env: {
        PATH: '',
        PATHEXT: '.EXE;.CMD'
      }
    }),
    {
      configuredPath: '',
      resolvedPath: 'pwsh.exe',
      resolutionSource: 'named-shell',
      configuredShell: 'pwsh',
      resolvedAvailablePath: undefined,
      isAvailable: false
    }
  );

  const detectedPosixShells = await detectAvailableTerminalShells({
    platform: 'linux',
    env: {
      PATH: posixShellDir
    },
    defaultShellPath: bashPath,
    etcShellsContent: `# comment\n${bashPath}\n${nuPath}\n${falsePath}\n`
  });

  assert.deepEqual(
    detectedPosixShells.map((shell) => shell.resolvedPath),
    [bashPath, zshPath, nuPath]
  );
  assert.deepEqual(
    detectedPosixShells.map((shell) => shell.source),
    ['default-shell', 'path-env', 'etc-shells']
  );
  assert.deepEqual(
    detectedPosixShells.map((shell) => shell.isDefault),
    [true, false, false]
  );
  assert.equal(detectedPosixShells[2].label, 'nu');

  const windowsShellDir = path.join(tempDir, 'windows-shells');
  await mkdir(windowsShellDir, { recursive: true });
  const cmdPath = path.join(windowsShellDir, 'cmd.exe');
  const powershellPath = path.join(windowsShellDir, 'powershell.exe');
  const pwshPath = path.join(windowsShellDir, 'pwsh.exe');
  await createExecutable(cmdPath, { windows: true });
  await createExecutable(powershellPath, { windows: true });
  await createExecutable(pwshPath, { windows: true });

  assert.deepEqual(
    resolveConfiguredTerminalShell({
      configuredShell: 'cmd',
      configuredPath: '',
      platform: 'win32',
      env: {
        PATH: windowsShellDir,
        PATHEXT: '.EXE;.CMD'
      }
    }),
    {
      configuredPath: '',
      resolvedPath: cmdPath,
      resolutionSource: 'named-shell',
      configuredShell: 'cmd'
    }
  );

  assert.deepEqual(
    resolveConfiguredTerminalShell({
      configuredShell: 'pwsh',
      configuredPath: '',
      platform: 'win32',
      env: {
        PATH: windowsShellDir,
        PATHEXT: '.EXE;.CMD'
      }
    }),
    {
      configuredPath: '',
      resolvedPath: pwshPath,
      resolutionSource: 'named-shell',
      configuredShell: 'pwsh'
    }
  );

  assert.deepEqual(
    inspectConfiguredTerminalShell({
      configuredShell: 'pwsh',
      configuredPath: '',
      platform: 'win32',
      env: {
        PATH: windowsShellDir,
        PATHEXT: '.EXE;.CMD'
      }
    }),
    {
      configuredPath: '',
      resolvedPath: pwshPath,
      resolutionSource: 'named-shell',
      configuredShell: 'pwsh',
      resolvedAvailablePath: pwshPath,
      isAvailable: true
    }
  );

  const detectedWindowsShells = await detectAvailableTerminalShells({
    platform: 'win32',
    env: {
      PATH: `${windowsShellDir};${windowsShellDir}`,
      PATHEXT: '.EXE;.CMD'
    },
    defaultShellPath: 'pwsh.exe'
  });

  assert.deepEqual(
    detectedWindowsShells.map((shell) => shell.resolvedPath),
    [pwshPath, powershellPath, cmdPath]
  );
  assert.deepEqual(
    detectedWindowsShells.map((shell) => shell.source),
    ['default-shell', 'path-env', 'path-env']
  );
  assert.deepEqual(
    detectedWindowsShells.map((shell) => shell.isDefault),
    [true, false, false]
  );

  console.log('terminal shell configuration tests passed');
} finally {
  await rm(tempDir, { recursive: true, force: true });
}

async function createExecutable(filePath, options = {}) {
  const { windows = false } = options;
  await writeFile(filePath, windows ? '@echo off\r\n' : '#!/bin/sh\nexit 0\n', 'utf8');
  if (!windows) {
    await chmod(filePath, 0o755);
  }
}
