import assert from 'node:assert/strict';
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

import esbuild from 'esbuild';

const tempDir = await mkdtemp(path.join(os.tmpdir(), 'dsc-shell-env-'));

try {
  const outfile = path.join(tempDir, 'shellEnvironmentResolver.cjs');
  await esbuild.build({
    entryPoints: [path.resolve('src/panel/shellEnvironmentResolver.ts')],
    bundle: true,
    format: 'cjs',
    outfile,
    platform: 'node',
    target: 'node18'
  });

  const require = createRequire(import.meta.url);
  const {
    applyShellEnvironmentPatch,
    buildControlledShellEnvironmentPatch,
    resolveShellEnvironmentPatch,
    shouldResolveShellEnvironmentPatchForExecutionTarget
  } = require(outfile);

  const posixBaseEnv = {
    PATH: ['/tmp/test-bin', '/usr/local/bin', '/usr/bin'].join(':'),
    HOME: '/Users/example',
    TERM: 'xterm-256color',
    KEEP_BASE: '1'
  };
  const posixShellEnv = {
    PATH: ['/opt/homebrew/bin', '/usr/bin'].join(':'),
    HOME: '/Users/other',
    TERM: 'screen',
    PWD: '/tmp/project',
    PS1: 'prompt',
    NVM_DIR: '/Users/example/.nvm',
    CUSTOM_TOOLCHAIN_TOKEN: 'shell-value'
  };

  const posixPatch = buildControlledShellEnvironmentPatch(posixBaseEnv, posixShellEnv, 'darwin');
  assert.equal(posixPatch.PATH, posixShellEnv.PATH);
  assert.equal(posixPatch.NVM_DIR, posixShellEnv.NVM_DIR);
  assert.equal(posixPatch.CUSTOM_TOOLCHAIN_TOKEN, posixShellEnv.CUSTOM_TOOLCHAIN_TOKEN);
  assert.equal('HOME' in posixPatch, false);
  assert.equal('TERM' in posixPatch, false);
  assert.equal('PWD' in posixPatch, false);
  assert.equal('PS1' in posixPatch, false);

  const mergedPosixEnv = applyShellEnvironmentPatch(posixBaseEnv, posixPatch, 'darwin');
  assert.equal(mergedPosixEnv.PATH, ['/opt/homebrew/bin', '/usr/bin', '/tmp/test-bin', '/usr/local/bin'].join(':'));
  const mergedPosixEnvWithPriority = applyShellEnvironmentPatch(posixBaseEnv, posixPatch, 'darwin', {
    prioritizedBasePathEntries: ['/tmp/test-bin']
  });
  assert.equal(
    mergedPosixEnvWithPriority.PATH,
    ['/tmp/test-bin', '/opt/homebrew/bin', '/usr/bin', '/usr/local/bin'].join(':')
  );
  assert.equal(mergedPosixEnv.NVM_DIR, posixShellEnv.NVM_DIR);
  assert.equal(mergedPosixEnv.CUSTOM_TOOLCHAIN_TOKEN, posixShellEnv.CUSTOM_TOOLCHAIN_TOKEN);
  assert.equal(mergedPosixEnv.HOME, posixBaseEnv.HOME);

  const windowsBaseEnv = {
    PATH: ['C:\\test-bin', 'C:\\host-tools', 'C:\\Windows'].join(';'),
    PATHEXT: '.COM;.EXE;.BAT;.CMD',
    PROMPT: 'host$G',
    USERPROFILE: 'C:\\Users\\example',
    KEEP_BASE: '1'
  };
  const windowsShellEnv = {
    Path: ['C:\\Users\\example\\AppData\\Roaming\\npm', 'C:\\Windows'].join(';'),
    PATHEXT: '.COM;.EXE;.BAT;.CMD;.PS1',
    PROMPT: 'profile$G',
    USERPROFILE: 'C:\\Users\\other',
    PNPM_HOME: 'C:\\Users\\example\\AppData\\Local\\pnpm',
    CUSTOM_TOOLCHAIN_TOKEN: 'from-powershell-profile'
  };

  const windowsPatch = buildControlledShellEnvironmentPatch(windowsBaseEnv, windowsShellEnv, 'win32');
  assert.equal(windowsPatch.PATH, windowsShellEnv.Path);
  assert.equal(windowsPatch.PATHEXT, windowsShellEnv.PATHEXT);
  assert.equal(windowsPatch.PNPM_HOME, windowsShellEnv.PNPM_HOME);
  assert.equal(windowsPatch.CUSTOM_TOOLCHAIN_TOKEN, windowsShellEnv.CUSTOM_TOOLCHAIN_TOKEN);
  assert.equal('PROMPT' in windowsPatch, false);
  assert.equal('USERPROFILE' in windowsPatch, false);

  const mergedWindowsEnv = applyShellEnvironmentPatch(windowsBaseEnv, windowsPatch, 'win32');
  assert.equal(
    mergedWindowsEnv.PATH,
    ['C:\\Users\\example\\AppData\\Roaming\\npm', 'C:\\Windows', 'C:\\test-bin', 'C:\\host-tools'].join(';')
  );
  const mergedWindowsEnvWithPriority = applyShellEnvironmentPatch(windowsBaseEnv, windowsPatch, 'win32', {
    prioritizedBasePathEntries: ['C:\\test-bin']
  });
  assert.equal(
    mergedWindowsEnvWithPriority.PATH,
    ['C:\\test-bin', 'C:\\Users\\example\\AppData\\Roaming\\npm', 'C:\\Windows', 'C:\\host-tools'].join(';')
  );
  assert.equal(mergedWindowsEnv.PATHEXT, windowsShellEnv.PATHEXT);
  assert.equal(mergedWindowsEnv.USERPROFILE, windowsBaseEnv.USERPROFILE);

  const skippedCliPatch = await resolveShellEnvironmentPatch({
    env: {
      ...posixBaseEnv,
      VSCODE_CLI: '1'
    },
    platform: 'darwin'
  });
  assert.equal(skippedCliPatch.source, 'none');
  assert.equal(skippedCliPatch.skippedReason, 'launched-from-cli');

  const skippedWindowsCliPatch = await resolveShellEnvironmentPatch({
    env: {
      ...windowsBaseEnv,
      VSCODE_CLI: '1'
    },
    platform: 'win32'
  });
  assert.equal(skippedWindowsCliPatch.source, 'none');
  assert.equal(skippedWindowsCliPatch.skippedReason, 'launched-from-cli');
  assert.equal(shouldResolveShellEnvironmentPatchForExecutionTarget('agent', 'win32'), true);
  assert.equal(shouldResolveShellEnvironmentPatchForExecutionTarget('terminal', 'win32'), false);
  assert.equal(shouldResolveShellEnvironmentPatchForExecutionTarget('terminal', 'darwin'), true);

  if (process.platform !== 'win32') {
    const fakeShellPath = path.join(tempDir, 'fake-login-shell');
    await writeFile(
      fakeShellPath,
      [
        '#!/bin/sh',
        'last=""',
        'for arg in "$@"; do',
        '  last="$arg"',
        'done',
        'export PATH="/opt/homebrew/bin:/usr/bin"',
        'export CUSTOM_TOOLCHAIN_TOKEN="from-shell"',
        'export NVM_DIR="/Users/example/.nvm"',
        'export HOME="/should-not-override"',
        'export TERM="screen"',
        'export PWD="/tmp/project"',
        'export PS1="prompt"',
        'eval "$last"'
      ].join('\n'),
      'utf8'
    );
    await chmod(fakeShellPath, 0o755);

    const resolvedPatch = await resolveShellEnvironmentPatch({
      env: posixBaseEnv,
      platform: 'darwin',
      shellPath: fakeShellPath,
      processExecPath: process.execPath,
      timeoutMs: 2000
    });
    assert.equal(resolvedPatch.source, 'posix-login-shell');
    assert.equal(resolvedPatch.shellFamily, 'posix');
    assert.equal(resolvedPatch.shellPath, fakeShellPath);
    assert.equal(resolvedPatch.envPatch.CUSTOM_TOOLCHAIN_TOKEN, 'from-shell');
    assert.equal(resolvedPatch.envPatch.NVM_DIR, '/Users/example/.nvm');
    assert.equal('HOME' in resolvedPatch.envPatch, false);
    assert.equal('TERM' in resolvedPatch.envPatch, false);
    assert.equal(resolvedPatch.appliedKeys.includes('CUSTOM_TOOLCHAIN_TOKEN'), true);
    assert.equal(resolvedPatch.appliedKeys.includes('NVM_DIR'), true);

    const relativeShellCwd = path.join(tempDir, 'relative-posix-shell');
    await mkdir(relativeShellCwd, { recursive: true });
    const relativeShellPath = path.join(relativeShellCwd, 'fake-relative-shell');
    await writeFile(relativeShellPath, await readFile(fakeShellPath, 'utf8'), 'utf8');
    await chmod(relativeShellPath, 0o755);

    const relativeResolvedPatch = await resolveShellEnvironmentPatch({
      env: posixBaseEnv,
      platform: 'darwin',
      shellPath: './fake-relative-shell',
      cwd: relativeShellCwd,
      processExecPath: process.execPath,
      timeoutMs: 2000
    });
    assert.equal(relativeResolvedPatch.source, 'posix-login-shell');
    assert.equal(relativeResolvedPatch.shellFamily, 'posix');
    assert.equal(relativeResolvedPatch.envPatch.CUSTOM_TOOLCHAIN_TOKEN, 'from-shell');
  } else {
    const windowsPowerShellPath =
      process.env.SystemRoot?.trim() || process.env.SYSTEMROOT?.trim()
        ? path.join(process.env.SystemRoot?.trim() || process.env.SYSTEMROOT?.trim() || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
        : 'powershell.exe';
    const fakeProfileHome = path.join(tempDir, 'windows-profile-home');
    const fakeProfileDir = path.join(fakeProfileHome, 'Documents', 'WindowsPowerShell');
    const fakeProfileBin = path.join(fakeProfileHome, 'profile-bin');
    await mkdir(fakeProfileDir, { recursive: true });
    await mkdir(fakeProfileBin, { recursive: true });
    await writeFile(
      path.join(fakeProfileDir, 'Microsoft.PowerShell_profile.ps1'),
      [
        `$env:CUSTOM_TOOLCHAIN_TOKEN = "from-powershell-profile"`,
        `$env:PNPM_HOME = "${escapePowerShellString(path.join(fakeProfileHome, 'pnpm-home'))}"`,
        `$env:PATH = "${escapePowerShellString(fakeProfileBin)};" + $env:PATH`,
        `$env:PATHEXT = ".CUSTOM;" + $env:PATHEXT`,
        `$env:PROMPT = "profile$G"`,
        `$env:USERPROFILE = "C:\\\\should-not-override"`
      ].join('\n'),
      'utf8'
    );

    const powerShellPatch = await resolveShellEnvironmentPatch({
      env: {
        ...process.env,
        USERPROFILE: fakeProfileHome,
        HOME: fakeProfileHome
      },
      platform: 'win32',
      shellPath: windowsPowerShellPath,
      timeoutMs: 5000
    });
    assert.equal(powerShellPatch.source, 'windows-shell');
    assert.equal(powerShellPatch.shellFamily, 'powershell');
    assert.equal(powerShellPatch.shellPath.toLowerCase(), windowsPowerShellPath.toLowerCase());
    assert.equal(powerShellPatch.envPatch.CUSTOM_TOOLCHAIN_TOKEN, 'from-powershell-profile');
    assert.equal(
      powerShellPatch.envPatch.PNPM_HOME,
      path.join(fakeProfileHome, 'pnpm-home')
    );
    assert.equal(powerShellPatch.envPatch.PATH?.startsWith(`${fakeProfileBin};`), true);
    assert.equal(powerShellPatch.envPatch.PATHEXT?.startsWith('.CUSTOM;'), true);
    assert.equal('PROMPT' in powerShellPatch.envPatch, false);
    assert.equal('USERPROFILE' in powerShellPatch.envPatch, false);
    assert.equal(powerShellPatch.appliedKeys.includes('CUSTOM_TOOLCHAIN_TOKEN'), true);
    assert.equal(powerShellPatch.appliedKeys.includes('PNPM_HOME'), true);

    const cmdPatch = await resolveShellEnvironmentPatch({
      env: {
        ...process.env
      },
      platform: 'win32',
      shellPath: process.env.ComSpec || process.env.COMSPEC || 'cmd.exe',
      timeoutMs: 5000
    });
    assert.equal(cmdPatch.source, 'windows-shell');
    assert.equal(cmdPatch.shellFamily, 'cmd');
    assert.equal(cmdPatch.shellPath.toLowerCase().includes('cmd'), true);

    const relativeShellCwd = path.join(tempDir, 'relative-windows-shell');
    await mkdir(relativeShellCwd, { recursive: true });
    const relativeCmdPath = path.join(relativeShellCwd, 'cmd.exe');
    await copyFile(process.env.ComSpec || process.env.COMSPEC || 'C:\\Windows\\System32\\cmd.exe', relativeCmdPath);

    const relativeCmdPatch = await resolveShellEnvironmentPatch({
      env: {
        ...process.env
      },
      platform: 'win32',
      shellPath: './cmd.exe',
      cwd: relativeShellCwd,
      timeoutMs: 5000
    });
    assert.equal(relativeCmdPatch.source, 'windows-shell');
    assert.equal(relativeCmdPatch.shellFamily, 'cmd');
    assert.equal(relativeCmdPatch.shellPath, './cmd.exe');
  }

  console.log('shellEnvironmentResolver tests passed');
} finally {
  await rm(tempDir, { recursive: true, force: true });
}

function escapePowerShellString(value) {
  return value.replace(/`/g, '``').replace(/\$/g, '`$').replace(/"/g, '`"');
}
