import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const scriptPath = path.join(repoRoot, 'scripts', 'release', 'publish-marketplaces.mjs');
const tempDir = await mkdtemp(path.join(os.tmpdir(), 'dsc-publish-marketplaces-'));

try {
  await writePackageJson(path.join(tempDir, 'package.json'), {
    name: 'dev-session-canvas',
    version: '0.10.0'
  });
  await writePackageJson(
    path.join(tempDir, 'extensions', 'vscode', 'dev-session-canvas-notifier', 'package.json'),
    {
      name: 'dev-session-canvas-notifier',
      version: '0.10.0'
    }
  );
  await writeFile(path.join(tempDir, 'dev-session-canvas-0.10.0.vsix'), 'stale package\n', 'utf8');

  const binDir = path.join(tempDir, 'bin');
  await mkdir(binDir, { recursive: true });
  const commandLogPath = path.join(tempDir, 'commands.log');
  await writeFakeCommand(binDir, 'npm', 'npm', 7);
  await writeFakeCommand(binDir, 'python3', 'python3', 0);

  const result = spawnSync(
    process.execPath,
    [
      scriptPath,
      '--yes',
      '--continue-on-error',
      '--target',
      'open-vsx',
      '--extension',
      'main'
    ],
    {
      cwd: tempDir,
      env: {
        ...process.env,
        PATH: `${binDir}${path.delimiter}${process.env.PATH || ''}`,
        PUBLISH_MARKETPLACES_TEST_LOG: commandLogPath
      },
      encoding: 'utf8'
    }
  );

  assert.equal(result.status, 7, result.stderr || result.stdout);
  assert.match(result.stderr, /打包失败，停止后续发布/u);

  const commandLog = await readFile(commandLogPath, 'utf8');
  assert.match(commandLog, /^npm /u, commandLog);
  assert.doesNotMatch(commandLog, /^python3 /mu, commandLog);

  console.log('publish-marketplaces tests passed');
} finally {
  await rm(tempDir, { recursive: true, force: true });
}

async function writePackageJson(filePath, contents) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(contents, null, 2)}\n`, 'utf8');
}

async function writeFakeCommand(binDir, commandName, logLabel, exitCode) {
  if (process.platform === 'win32') {
    const commandPath = path.join(binDir, `${commandName}.cmd`);
    await writeFile(
      commandPath,
      `@echo off\r\necho ${logLabel} %*>> "%PUBLISH_MARKETPLACES_TEST_LOG%"\r\nexit /b ${exitCode}\r\n`,
      'utf8'
    );
    return;
  }

  const commandPath = path.join(binDir, commandName);
  await writeFile(
    commandPath,
    `#!/usr/bin/env sh\necho "${logLabel} $*" >> "$PUBLISH_MARKETPLACES_TEST_LOG"\nexit ${exitCode}\n`,
    {
      encoding: 'utf8',
      mode: 0o755
    }
  );
}
