import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

import esbuild from 'esbuild';

const tempDir = await mkdtemp(path.join(os.tmpdir(), 'dsc-execution-terminal-native-helpers-'));

try {
  const outfile = path.join(tempDir, 'executionTerminalNativeHelpers.cjs');
  const vscodeStubDir = path.join(tempDir, 'node_modules', 'vscode');
  await mkdir(vscodeStubDir, { recursive: true });
  await writeFile(
    path.join(vscodeStubDir, 'index.js'),
    [
      'class Range {',
      '  constructor(startLine, startCharacter, endLine, endCharacter) {',
      '    this.start = { line: startLine, character: startCharacter };',
      '    this.end = { line: endLine, character: endCharacter };',
      '  }',
      '}',
      'exports.Range = Range;',
      'exports.Uri = {',
      '  parse(value) { return { fsPath: value }; },',
      '  file(value) { return { fsPath: value, toString() { return value; } }; }',
      '};',
      'exports.workspace = {};',
      'exports.window = {};',
      ''
    ].join('\n')
  );

  await esbuild.build({
    entryPoints: [path.resolve('src/panel/executionTerminalNativeHelpers.ts')],
    bundle: true,
    external: ['vscode'],
    format: 'cjs',
    outfile,
    platform: 'node',
    target: 'node18'
  });

  const require = createRequire(import.meta.url);
  const { prepareExecutionTerminalDroppedPath } = require(outfile);

  assert.equal(
    prepareExecutionTerminalDroppedPath(
      {
        source: 'files',
        valueKind: 'path',
        value: 'C:\\Program Files\\drop target file.txt'
      },
      createContext('C:\\Program Files\\PowerShell\\7\\pwsh.exe', 'C:\\repo', 'windows')
    ),
    "'C:\\Program Files\\drop target file.txt'"
  );

  assert.equal(
    prepareExecutionTerminalDroppedPath(
      {
        source: 'files',
        valueKind: 'path',
        value: "C:\\Users\\me\\it's (copy).txt"
      },
      createContext('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe', 'C:\\repo', 'windows')
    ),
    "'C:\\Users\\me\\it''s (copy).txt'"
  );

  assert.equal(
    prepareExecutionTerminalDroppedPath(
      {
        source: 'files',
        valueKind: 'path',
        value: 'C:\\Program Files\\drop target file.txt'
      },
      createContext('C:\\Windows\\System32\\wsl.exe', 'C:\\repo', 'windows')
    ),
    "'/mnt/c/Program Files/drop target file.txt'"
  );

  assert.equal(
    prepareExecutionTerminalDroppedPath(
      {
        source: 'files',
        valueKind: 'path',
        value: 'C:\\repo\\plain-file.txt'
      },
      createContext('C:\\Windows\\System32\\wsl.exe', 'C:\\repo', 'windows')
    ),
    '/mnt/c/repo/plain-file.txt'
  );

  assert.equal(
    prepareExecutionTerminalDroppedPath(
      {
        source: 'files',
        valueKind: 'path',
        value: 'C:\\Program Files\\drop target file.txt'
      },
      createContext('C:\\msys64\\usr\\bin\\bash.exe', 'C:\\repo', 'windows')
    ),
    "'/mnt/c/Program Files/drop target file.txt'"
  );

  assert.equal(
    prepareExecutionTerminalDroppedPath(
      {
        source: 'files',
        valueKind: 'path',
        value: "C:\\repo\\it's.txt"
      },
      createContext('C:\\Windows\\System32\\wsl.exe', 'C:\\repo', 'windows')
    ),
    "'/mnt/c/repo/it'\\''s.txt'"
  );

  assert.equal(
    prepareExecutionTerminalDroppedPath(
      {
        source: 'files',
        valueKind: 'path',
        value: '/tmp/a#b!c$d&e.txt'
      },
      createContext('/bin/bash', '/tmp', 'posix')
    ),
    "'/tmp/a#b!c$d&e.txt'"
  );

  assert.equal(
    prepareExecutionTerminalDroppedPath(
      {
        source: 'files',
        valueKind: 'path',
        value: "/tmp/it's.txt"
      },
      createContext('/bin/bash', '/tmp', 'posix')
    ),
    "'/tmp/it'\\''s.txt'"
  );

  console.log('executionTerminalNativeHelpers tests passed');
} finally {
  await rm(tempDir, { recursive: true, force: true });
}

function createContext(shellPath, cwd, pathStyle) {
  return {
    shellPath,
    cwd,
    pathStyle
  };
}
