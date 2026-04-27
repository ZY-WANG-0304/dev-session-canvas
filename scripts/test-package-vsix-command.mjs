import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { resolveCommand } from './package-vsix.mjs';

const tempDir = await mkdtemp(path.join(os.tmpdir(), 'dsc-package-vsix-command-'));

try {
  const nodeScriptCommand = resolveCommand(
    {
      kind: 'node-script',
      path: '/tmp/vsce-entry.js'
    },
    ['package', '--readme-path', 'README.marketplace.md'],
    {
      platform: 'win32',
      env: {
        ComSpec: 'C:\\Windows\\System32\\cmd.exe'
      }
    }
  );
  assert.equal(nodeScriptCommand.file, process.execPath);
  assert.deepEqual(nodeScriptCommand.args, [
    '/tmp/vsce-entry.js',
    'package',
    '--readme-path',
    'README.marketplace.md'
  ]);
  assert.equal(nodeScriptCommand.windowsVerbatimArguments, undefined);

  const nonWindowsCommand = resolveCommand(
    {
      kind: 'direct',
      path: '/usr/local/bin/vsce'
    },
    ['package', '--readme-path', 'README.marketplace.md'],
    {
      platform: 'linux'
    }
  );
  assert.equal(nonWindowsCommand.file, '/usr/local/bin/vsce');
  assert.deepEqual(nonWindowsCommand.args, ['package', '--readme-path', 'README.marketplace.md']);
  assert.equal(nonWindowsCommand.windowsVerbatimArguments, undefined);

  if (process.platform === 'win32') {
    const fixtureDir = path.join(tempDir, 'fixture A&B space');
    await mkdir(fixtureDir, { recursive: true });

    const fixtureScriptPath = path.join(fixtureDir, 'echo-argv.js');
    const fixtureCmdPath = path.join(fixtureDir, 'vsce.cmd');
    await writeFile(fixtureScriptPath, 'console.log(JSON.stringify(process.argv.slice(2)));\n', 'utf8');
    await writeFile(fixtureCmdPath, '@echo off\r\nnode "%~dp0echo-argv.js" %*\r\n', 'utf8');

    const commandShell = process.env.ComSpec || process.env.COMSPEC || 'C:\\Windows\\System32\\cmd.exe';
    const windowsCommand = resolveCommand(
      {
        kind: 'direct',
        path: fixtureCmdPath
      },
      ['package', '--readme-path', 'C:\\Docs & Notes\\README "marketplace".md'],
      {
        platform: 'win32',
        env: {
          ComSpec: commandShell
        }
      }
    );

    assert.equal(windowsCommand.file, commandShell);
    assert.equal(windowsCommand.windowsVerbatimArguments, true);
    assert.equal(windowsCommand.args.length, 1);
    assert.match(
      windowsCommand.args[0],
      /A\^&B\^ space\\vsce\.cmd \^"package\^" \^"--readme-path\^"/i
    );

    const runtimeResult = spawnSync(windowsCommand.file, windowsCommand.args, {
      cwd: fixtureDir,
      env: {
        ...process.env,
        ComSpec: commandShell
      },
      encoding: 'utf8',
      windowsHide: true,
      windowsVerbatimArguments: windowsCommand.windowsVerbatimArguments
    });

    assert.equal(runtimeResult.status, 0, runtimeResult.stderr || runtimeResult.stdout);
    const outputLines = runtimeResult.stdout
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter(Boolean);
    assert.ok(outputLines.length > 0, runtimeResult.stdout);
    assert.deepEqual(JSON.parse(outputLines.at(-1)), [
      'package',
      '--readme-path',
      'C:\\Docs & Notes\\README "marketplace".md'
    ]);
  }

  console.log('package-vsix command tests passed');
} finally {
  await rm(tempDir, { recursive: true, force: true });
}
