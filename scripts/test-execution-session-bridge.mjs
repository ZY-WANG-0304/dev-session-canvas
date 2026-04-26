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
  assert.deepEqual(wrappedBatchSpec.args, [
    '/d',
    '/s',
    '/c',
    'call',
    'C:\\Users\\Jane Doe\\AppData\\Roaming\\npm\\codex.cmd',
    'resume',
    'session-123',
    '--settings',
    'C:\\Users\\Jane Doe\\Project Space\\settings.json'
  ]);

  const wrappedBatSpec = resolveExecutionSessionSpawnSpec(
    {
      file: 'C:\\tools\\provider-wrapper.bat',
      args: ['start'],
      env: {}
    },
    'win32'
  );
  assert.equal(path.win32.basename(wrappedBatSpec.file).toLowerCase(), 'cmd.exe');
  assert.deepEqual(wrappedBatSpec.args, ['/d', '/s', '/c', 'call', 'C:\\tools\\provider-wrapper.bat', 'start']);

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
    const fixtureDir = path.join(tempDir, 'fixture with spaces');
    await mkdir(fixtureDir, { recursive: true });
    const fixturePath = path.join(fixtureDir, 'echo-args.cmd');
    await writeFile(
      fixturePath,
      ['@echo off', 'echo arg1=%~1', 'echo arg2=%~2', 'echo arg3=%~3'].join('\r\n'),
      'utf8'
    );

    const runtimeWrappedSpec = resolveExecutionSessionSpawnSpec(
      {
        file: fixturePath,
        args: ['hello world', 'C:\\Path With Spaces\\settings.json', 'plain'],
        env: {
          ComSpec: 'C:\\Windows\\System32\\cmd.exe'
        }
      },
      'win32'
    );

    const runtimeResult = spawnSync(runtimeWrappedSpec.file, runtimeWrappedSpec.args, {
      encoding: 'utf8',
      windowsHide: true
    });
    assert.equal(runtimeResult.status, 0, runtimeResult.stderr || runtimeResult.stdout);
    assert.match(runtimeResult.stdout, /arg1=hello world/i);
    assert.match(runtimeResult.stdout, /arg2=C:\\Path With Spaces\\settings\.json/i);
    assert.match(runtimeResult.stdout, /arg3=plain/i);
  }

  console.log('executionSessionBridge tests passed');
} finally {
  await rm(tempDir, { recursive: true, force: true });
}
