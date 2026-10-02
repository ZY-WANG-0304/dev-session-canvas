import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';

import { ensureCandidateHelperPermissions, resolveCommand } from '../release/package-vsix.mjs';

const tempDir = await mkdtemp(path.join(os.tmpdir(), 'dsc-package-vsix-command-'));

try {
  for (const platform of ['DOS', 'UNIX']) {
    const zip = new JSZip();
    const date = new Date('2026-10-01T00:00:00Z');
    zip.comment = 'unsigned VSCE fixture';
    const payloads = new Map();
    const add = (name, bytes, unixPermissions = 0o100640) => {
      payloads.set(name, Buffer.from(bytes));
      zip.file(name, bytes, { date, comment: name, unixPermissions, createFolders: false });
    };
    add('extension/unchanged.bin', Buffer.from([0, 255, 1, 254]));
    for (const arch of ['x64', 'arm64']) {
      const prefix = `extension/dist/native/macos-execution-candidate/darwin-${arch}/`;
      const helper = Buffer.from(`synthetic ${arch} helper; never executed`);
      add(`${prefix}spawn-helper`, helper, 0o100755);
      add(`${prefix}manifest.json`, JSON.stringify({ helper: { file: 'spawn-helper',
        sha256: createHash('sha256').update(helper).digest('hex') } }));
    }
    const original = await zip.generateAsync({ type: 'nodebuffer', platform, compression: 'DEFLATE' });
    let normalized = await ensureCandidateHelperPermissions(original);
    if (platform === 'UNIX') {
      assert.strictEqual(normalized, original, 'Correct UNIX packages remain byte-identical');
      // VSCE/yazl writes UNIX entries even on Windows, but receives nonexecutable stat modes.
      for (const name of payloads.keys()) {
        if (name.endsWith('/spawn-helper')) zip.file(name).unixPermissions = 0o100644;
      }
      normalized = await ensureCandidateHelperPermissions(await zip.generateAsync({ type: 'nodebuffer', platform }));
    }
    const result = await JSZip.loadAsync(normalized, { checkCRC32: true });
    assert.equal(result.comment, zip.comment);
    assert.deepEqual(Object.keys(result.files).sort(), [...payloads.keys()].sort());
    for (const [name, expected] of payloads) {
      const file = result.file(name);
      assert.deepEqual(await file.async('nodebuffer'), expected, `Unchanged payload: ${name}`);
      assert.equal(file.date.getTime(), date.getTime());
      assert.equal(file.comment, name);
      if (name.endsWith('/spawn-helper')) assert.equal(file.unixPermissions, 0o100755);
      else if (platform === 'UNIX') assert.equal(file.unixPermissions, 0o100640);
    }
    zip.file('extension/dist/native/macos-execution-candidate/darwin-x64/spawn-helper', 'corrupted');
    await assert.rejects(ensureCandidateHelperPermissions(await zip.generateAsync({ type: 'nodebuffer', platform })), /hash/);
    zip.file('extension/dist/native/macos-execution-candidate/darwin-x64/spawn-helper',
      payloads.get('extension/dist/native/macos-execution-candidate/darwin-x64/spawn-helper'));
    zip.remove('extension/dist/native/macos-execution-candidate/darwin-arm64/spawn-helper');
    const incomplete = await zip.generateAsync({ type: 'nodebuffer', platform });
    await assert.rejects(ensureCandidateHelperPermissions(incomplete), /helper is missing/);
    console.log(`PASS candidate helper VSIX permissions: ${platform} payloads and metadata`);
  }
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
