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
      "const path = require('node:path');",
      'class Range {',
      '  constructor(startLine, startCharacter, endLine, endCharacter) {',
      '    this.start = { line: startLine, character: startCharacter };',
      '    this.end = { line: endLine, character: endCharacter };',
      '  }',
      '}',
      'class RelativePattern {',
      '  constructor(base, pattern) {',
      '    this.baseUri = base.uri ?? base;',
      '    this.pattern = pattern;',
      '  }',
      '}',
      'const FileType = { Unknown: 0, File: 1, Directory: 2, SymbolicLink: 64 };',
      'const ConfigurationTarget = { Global: 1 };',
      'const state = {',
      '  workspaceFolders: [],',
      '  files: new Map(),',
      '  commands: [],',
      '  showTextDocumentCalls: [],',
      '  allowedLinkSchemes: []',
      '};',
      'function createUri(fsPath, rawValue) {',
      "  const normalizedPath = fsPath.replace(/\\\\/g, '/');",
      '  return {',
      '    fsPath,',
      '    path: normalizedPath.startsWith("/") ? normalizedPath : `/${normalizedPath}`,',
      '    scheme: rawValue && rawValue.includes("://") ? rawValue.slice(0, rawValue.indexOf("://")) : "file",',
      '    toString() { return rawValue ?? fsPath; }',
      '  };',
      '}',
      'function normalizeRelativePath(fsPath, workspaceFolderPath) {',
      "  return path.relative(workspaceFolderPath, fsPath).split(path.sep).join('/');",
      '}',
      'function globPatternToRegExp(pattern) {',
      "  const normalizedPattern = pattern.split(path.sep).join('/');",
      "  const specialCharacters = new Set(['\\\\', '.', '+', '^', '$', '{', '}', '(', ')', '|', '[', ']']);",
      "  let regex = '^';",
      '  for (let index = 0; index < normalizedPattern.length; index += 1) {',
      "    if (normalizedPattern.slice(index, index + 3) === '**/') {",
      "      regex += '(?:.*/)?';",
      '      index += 2;',
      '      continue;',
      '    }',
      '    const current = normalizedPattern[index];',
      "    if (current === '*') {",
      "      regex += '[^/]*';",
      "    } else if (current === '?') {",
      "      regex += '[^/]';",
      '    } else {',
      "      regex += specialCharacters.has(current) ? `\\\\${current}` : current;",
      '    }',
      '  }',
      "  return new RegExp(`${regex}$`);",
      '}',
      'function resetState() {',
      '  state.workspaceFolders = [];',
      '  state.files = new Map();',
      '  state.commands = [];',
      '  state.showTextDocumentCalls = [];',
      '  state.allowedLinkSchemes = [];',
      '}',
      'exports.__reset = resetState;',
      'exports.__setWorkspaceFolders = function setWorkspaceFolders(folders) {',
      '  state.workspaceFolders = folders.map((folder) => ({',
      '    name: folder.name,',
      '    uri: createUri(folder.path)',
      '  }));',
      '};',
      'exports.__setFiles = function setFiles(files) {',
      '  state.files = new Map(files.map((file) => [file.path, {',
      '    uri: createUri(file.path),',
      '    type: file.type === "directory" ? FileType.Directory : FileType.File',
      '  }]));',
      '};',
      'exports.__getExecutedCommands = function getExecutedCommands() {',
      '  return state.commands.slice();',
      '};',
      'exports.__getShowTextDocumentCalls = function getShowTextDocumentCalls() {',
      '  return state.showTextDocumentCalls.slice();',
      '};',
      'exports.Range = Range;',
      'exports.RelativePattern = RelativePattern;',
      'exports.FileType = FileType;',
      'exports.ConfigurationTarget = ConfigurationTarget;',
      'exports.Uri = {',
      '  parse(value) {',
      '    if (value.startsWith("file://")) {',
      '      return createUri(value.replace(/^file:\\/\\/\\/?/, "/"), value);',
      '    }',
      '    return createUri(value, value);',
      '  },',
      '  file(value) { return createUri(value); }',
      '};',
      'exports.workspace = {',
      '  get workspaceFolders() { return state.workspaceFolders; },',
      '  fs: {',
      '    async stat(uri) {',
      '      const entry = state.files.get(uri.fsPath);',
      '      if (!entry) {',
      "        throw new Error('ENOENT');",
      '      }',
      '      return { type: entry.type };',
      '    }',
      '  },',
      '  async openTextDocument(uri) {',
      '    return { uri };',
      '  },',
      '  async findFiles(relativePattern, _exclude, maxResults) {',
      '    const workspaceFolderPath = relativePattern.baseUri.fsPath;',
      '    const matcher = globPatternToRegExp(relativePattern.pattern);',
      '    const results = [];',
      '    for (const entry of state.files.values()) {',
      '      if (!entry.uri.fsPath.startsWith(workspaceFolderPath + path.sep) && entry.uri.fsPath !== workspaceFolderPath) {',
      '        continue;',
      '      }',
      '      const relativePath = normalizeRelativePath(entry.uri.fsPath, workspaceFolderPath);',
      '      if (!matcher.test(relativePath)) {',
      '        continue;',
      '      }',
      '      results.push(entry.uri);',
      '      if (typeof maxResults === "number" && maxResults > 0 && results.length >= maxResults) {',
      '        break;',
      '      }',
      '    }',
      '    return results;',
      '  },',
      '  getWorkspaceFolder(uri) {',
      '    return state.workspaceFolders.find((folder) => uri.fsPath === folder.uri.fsPath || uri.fsPath.startsWith(folder.uri.fsPath + path.sep));',
      '  },',
      '  getConfiguration() {',
      '    return {',
      '      get(key, fallback) {',
      "        return key === 'allowedLinkSchemes' ? state.allowedLinkSchemes.slice() : fallback;",
      '      },',
      '      async update(key, value) {',
      "        if (key === 'allowedLinkSchemes') {",
      '          state.allowedLinkSchemes = Array.isArray(value) ? value.slice() : [];',
      '        }',
      '      }',
      '    };',
      '  }',
      '};',
      'exports.window = {',
      '  async showWarningMessage() {',
      '    return undefined;',
      '  },',
      '  async showTextDocument(document, options) {',
      '    state.showTextDocumentCalls.push({ document, options });',
      '    return { document, selection: options.selection };',
      '  }',
      '};',
      'exports.commands = {',
      '  async executeCommand(command, ...args) {',
      '    state.commands.push({ command, args });',
      '    return undefined;',
      '  }',
      '};',
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
  const helperModule = require(outfile);
  const vscodeStub = createRequire(outfile)('vscode');
  const { openExecutionTerminalLink, prepareExecutionTerminalDroppedPath, resolveExecutionFileLink } = helperModule;

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

  vscodeStub.__reset();
  vscodeStub.__setWorkspaceFolders([{ name: 'workspace', path: '/workspace' }]);
  vscodeStub.__setFiles([{ path: '/workspace/foo', type: 'file' }]);
  const exactOpenResult = await openExecutionTerminalLink(
    {
      linkKind: 'search',
      text: 'foo',
      searchText: 'foo',
      contextLine: '"foo", line 10',
      bufferStartLine: 12,
      source: 'word'
    },
    createContext('/bin/bash', '/workspace', 'posix')
  );
  assert.deepEqual(exactOpenResult, {
    opened: true,
    openerKind: 'showTextDocument',
    targetUri: '/workspace/foo'
  });
  const exactOpenCalls = vscodeStub.__getShowTextDocumentCalls();
  assert.equal(exactOpenCalls.length, 1);
  assert.equal(exactOpenCalls[0].document.uri.fsPath, '/workspace/foo');
  assert.equal(exactOpenCalls[0].options.selection.start.line, 9);
  assert.equal(exactOpenCalls[0].options.selection.start.character, 0);

  vscodeStub.__reset();
  vscodeStub.__setWorkspaceFolders([{ name: 'workspace', path: '/workspace' }]);
  const quickOpenResult = await openExecutionTerminalLink(
    {
      linkKind: 'search',
      text: 'foo',
      searchText: 'foo',
      contextLine: '"foo", line 10',
      bufferStartLine: 5,
      source: 'word'
    },
    createContext('/bin/bash', '/workspace', 'posix')
  );
  assert.deepEqual(quickOpenResult, {
    opened: true,
    openerKind: 'workbench.action.quickOpen',
    targetUri: 'foo:10'
  });
  assert.deepEqual(vscodeStub.__getExecutedCommands(), [
    {
      command: 'workbench.action.quickOpen',
      args: ['foo:10']
    }
  ]);

  vscodeStub.__reset();
  vscodeStub.__setWorkspaceFolders([{ name: 'workspace', path: '/workspace' }]);
  vscodeStub.__setFiles([{ path: '/workspace/README.md', type: 'file' }]);
  const partialOpenResult = await openExecutionTerminalLink(
    {
      linkKind: 'search',
      text: 'README',
      searchText: 'README',
      contextLine: 'README',
      bufferStartLine: 3,
      source: 'word'
    },
    createContext('/bin/bash', '/workspace', 'posix')
  );
  assert.deepEqual(partialOpenResult, {
    opened: true,
    openerKind: 'showTextDocument',
    targetUri: '/workspace/README.md'
  });
  const partialOpenCalls = vscodeStub.__getShowTextDocumentCalls();
  assert.equal(partialOpenCalls.length, 1);
  assert.equal(partialOpenCalls[0].document.uri.fsPath, '/workspace/README.md');
  assert.deepEqual(vscodeStub.__getExecutedCommands(), []);

  vscodeStub.__reset();
  vscodeStub.__setWorkspaceFolders([{ name: 'workspace', path: '/workspace' }]);
  vscodeStub.__setFiles([{ path: '/workspace/README.md', type: 'file' }]);
  const fallbackFileResult = await resolveExecutionFileLink(
    {
      linkKind: 'file',
      text: 'README',
      path: 'README',
      bufferStartLine: 8,
      source: 'fallback'
    },
    createContext('/bin/bash', '/workspace', 'posix')
  );
  assert.equal(fallbackFileResult, undefined);

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
