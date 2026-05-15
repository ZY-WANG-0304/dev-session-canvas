import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

import esbuild from 'esbuild';

const tempDir = await mkdtemp(path.join(os.tmpdir(), 'dsc-execution-session-bridge-'));

try {
  const outfile = path.join(tempDir, 'executionSessionBridge.cjs');
  await esbuild.build({
    entryPoints: [path.resolve('src/panel/executionSessionBridge.ts')],
    bundle: true,
    external: ['node-pty'],
    format: 'cjs',
    outfile,
    platform: 'node',
    target: 'node18'
  });

  const require = createRequire(import.meta.url);
  const { resolveExecutionSessionSpawnSpec } = require(outfile);

  const wrappedBatchSpec = resolveExecutionSessionSpawnSpec(
    {
      file: 'C:\\Users\\Jane Doe\\AppData\\Roaming\\npm\\codex.cmd',
      args: ['resume', 'session-123', '--settings', 'C:\\Users\\Jane Doe\\Project Space\\settings.json'],
      env: {
        ComSpec: 'C:\\Windows\\System32\\cmd.exe'
      }
    },
    'win32'
  );
  assert.equal(wrappedBatchSpec.file, 'C:\\Windows\\System32\\cmd.exe');
  assert.equal(
    wrappedBatchSpec.args,
    '/d /s /c "C:\\Users\\Jane^ Doe\\AppData\\Roaming\\npm\\codex.cmd ^"resume^" ^"session-123^" ^"--settings^" ^"C:\\Users\\Jane^ Doe\\Project^ Space\\settings.json^""'
  );

  const wrappedBatSpec = resolveExecutionSessionSpawnSpec(
    {
      file: 'C:\\tools\\A&B Space\\provider-wrapper.bat',
      args: ['hello&world', '100%done', 'literal^caret'],
      env: {}
    },
    'win32'
  );
  assert.equal(path.win32.basename(wrappedBatSpec.file).toLowerCase(), 'cmd.exe');
  assert.equal(
    wrappedBatSpec.args,
    '/d /s /c "C:\\tools\\A^&B^ Space\\provider-wrapper.bat ^"hello^&world^" ^"100^%done^" ^"literal^^caret^""'
  );

  const directExecutableSpec = resolveExecutionSessionSpawnSpec(
    {
      file: 'C:\\tools\\codex.exe',
      args: ['resume', 'session-123'],
      env: {
        ComSpec: 'C:\\Windows\\System32\\cmd.exe'
      }
    },
    'win32'
  );
  assert.equal(directExecutableSpec.file, 'C:\\tools\\codex.exe');
  assert.deepEqual(directExecutableSpec.args, ['resume', 'session-123']);

  const nonWindowsSpec = resolveExecutionSessionSpawnSpec(
    {
      file: '/usr/local/bin/codex.cmd',
      args: ['resume', 'session-123'],
      env: {}
    },
    'linux'
  );
  assert.equal(nonWindowsSpec.file, '/usr/local/bin/codex.cmd');
  assert.deepEqual(nonWindowsSpec.args, ['resume', 'session-123']);

  if (process.platform === 'win32') {
    const fixtureDir = path.join(tempDir, 'fixture A&B space');
    await mkdir(fixtureDir, { recursive: true });
    const fixturePath = path.join(fixtureDir, 'echo-args.cmd');
    const fixtureScriptPath = path.join(fixtureDir, 'echo-args.js');
    await writeFile(fixtureScriptPath, 'console.log(JSON.stringify(process.argv.slice(2)));\n', 'utf8');
    await writeFile(
      fixturePath,
      ['@echo off', 'node "%~dp0echo-args.js" "%~1" "%~2" "%~3"'].join('\r\n'),
      'utf8'
    );

    const commandShell = process.env.ComSpec || process.env.COMSPEC || 'C:\\Windows\\System32\\cmd.exe';
    const runtimeWrappedSpec = resolveExecutionSessionSpawnSpec(
      {
        file: fixturePath,
        args: ['hello&world', 'C:\\Path With Spaces\\settings.json', 'plain'],
        env: {
          ComSpec: commandShell
        }
      },
      'win32'
    );

    assert.equal(typeof runtimeWrappedSpec.args, 'string');

    const runtimeResult = spawnSync(runtimeWrappedSpec.file, [runtimeWrappedSpec.args], {
      cwd: fixtureDir,
      env: {
        ...process.env,
        ComSpec: commandShell
      },
      encoding: 'utf8',
      windowsHide: true,
      windowsVerbatimArguments: true
    });

    assert.equal(runtimeResult.status, 0, runtimeResult.stderr || runtimeResult.stdout);
    const outputLines = runtimeResult.stdout
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter(Boolean);
    assert.ok(outputLines.length > 0, runtimeResult.stdout);
    assert.deepEqual(JSON.parse(outputLines.at(-1)), [
      'hello&world',
      'C:\\Path With Spaces\\settings.json',
      'plain'
    ]);
  }

  console.log('executionSessionBridge tests passed');
} finally {
  await rm(tempDir, { recursive: true, force: true });
}
