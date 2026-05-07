import assert from 'node:assert/strict';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
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
    resolveShellEnvironmentPatch
  } = require(outfile);

  const baseEnv = {
    PATH: ['/tmp/host-tools', '/usr/bin'].join(path.delimiter),
    HOME: '/Users/example',
    TERM: 'xterm-256color',
    KEEP_BASE: '1'
  };
  const shellEnv = {
    PATH: ['/opt/homebrew/bin', '/usr/bin'].join(path.delimiter),
    HOME: '/Users/other',
    TERM: 'screen',
    PWD: '/tmp/project',
    PS1: 'prompt',
    NVM_DIR: '/Users/example/.nvm',
    CUSTOM_TOOLCHAIN_TOKEN: 'shell-value'
  };

  const patch = buildControlledShellEnvironmentPatch(baseEnv, shellEnv);
  assert.equal(patch.PATH, shellEnv.PATH);
  assert.equal(patch.NVM_DIR, shellEnv.NVM_DIR);
  assert.equal(patch.CUSTOM_TOOLCHAIN_TOKEN, shellEnv.CUSTOM_TOOLCHAIN_TOKEN);
  assert.equal('HOME' in patch, false);
  assert.equal('TERM' in patch, false);
  assert.equal('PWD' in patch, false);
  assert.equal('PS1' in patch, false);

  const mergedEnv = applyShellEnvironmentPatch(baseEnv, patch, 'darwin');
  assert.equal(mergedEnv.PATH, ['/tmp/host-tools', '/opt/homebrew/bin', '/usr/bin'].join(':'));
  assert.equal(mergedEnv.NVM_DIR, shellEnv.NVM_DIR);
  assert.equal(mergedEnv.CUSTOM_TOOLCHAIN_TOKEN, shellEnv.CUSTOM_TOOLCHAIN_TOKEN);
  assert.equal(mergedEnv.HOME, baseEnv.HOME);

  const skippedPatch = await resolveShellEnvironmentPatch({
    env: {
      ...baseEnv,
      VSCODE_CLI: '1'
    },
    platform: 'darwin'
  });
  assert.equal(skippedPatch.source, 'none');
  assert.equal(skippedPatch.skippedReason, 'launched-from-cli');

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
      env: baseEnv,
      platform: 'darwin',
      shellPath: fakeShellPath,
      processExecPath: process.execPath,
      timeoutMs: 2000
    });
    assert.equal(resolvedPatch.source, 'posix-login-shell');
    assert.equal(resolvedPatch.shellPath, fakeShellPath);
    assert.equal(resolvedPatch.envPatch.CUSTOM_TOOLCHAIN_TOKEN, 'from-shell');
    assert.equal(resolvedPatch.envPatch.NVM_DIR, '/Users/example/.nvm');
    assert.equal('HOME' in resolvedPatch.envPatch, false);
    assert.equal('TERM' in resolvedPatch.envPatch, false);
    assert.equal(resolvedPatch.appliedKeys.includes('CUSTOM_TOOLCHAIN_TOKEN'), true);
    assert.equal(resolvedPatch.appliedKeys.includes('NVM_DIR'), true);
  }

  console.log('shellEnvironmentResolver tests passed');
} finally {
  await rm(tempDir, { recursive: true, force: true });
}
