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
      '  openExternalCalls: [],',
      '  allowedLinkSchemes: []',
      '};',
      'function createUri(fsPath, rawValue) {',
      "  const normalizedPath = fsPath.replace(/\\\\/g, '/');",
      '  const schemeMatch = typeof rawValue === "string" ? /^([a-z][a-z0-9+.-]*):/i.exec(rawValue) : null;',
      '  return {',
      '    fsPath,',
      '    path: normalizedPath.startsWith("/") ? normalizedPath : `/${normalizedPath}`,',
      '    scheme: schemeMatch ? schemeMatch[1] : "file",',
      '    toString() { return rawValue ?? fsPath; }',
      '  };',
      '}',
      'function normalizePathForComparison(value) {',
      "  return value.replace(/\\\\/g, '/').replace(/\\/+/g, '/');",
      '}',
      'function inferPathModule(fsPath, workspaceFolderPath) {',
      "  return fsPath.includes('\\\\') || workspaceFolderPath.includes('\\\\') ? path.win32 : path.posix;",
      '}',
      'function normalizeRelativePath(fsPath, workspaceFolderPath) {',
      '  return inferPathModule(fsPath, workspaceFolderPath).relative(workspaceFolderPath, fsPath).replace(/\\\\/g, "/");',
      '}',
      'function isWithinWorkspace(fsPath, workspaceFolderPath) {',
      '  const normalizedPath = normalizePathForComparison(fsPath);',
      "  const normalizedWorkspacePath = normalizePathForComparison(workspaceFolderPath).replace(/\\/+$/, '');",
      '  return normalizedPath === normalizedWorkspacePath || normalizedPath.startsWith(`${normalizedWorkspacePath}/`);',
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
      '  state.openExternalCalls = [];',
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
      'exports.__getOpenExternalCalls = function getOpenExternalCalls() {',
      '  return state.openExternalCalls.slice();',
      '};',
      'exports.Range = Range;',
      'exports.RelativePattern = RelativePattern;',
      'exports.FileType = FileType;',
      'exports.ConfigurationTarget = ConfigurationTarget;',
      'exports.ViewColumn = { Active: -1, Beside: -2, One: 1 };',
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
      '      if (!isWithinWorkspace(entry.uri.fsPath, workspaceFolderPath)) {',
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
      '    return state.workspaceFolders.find((folder) => isWithinWorkspace(uri.fsPath, folder.uri.fsPath));',
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
      'exports.env = {',
      '  async openExternal(uri) {',
      '    state.openExternalCalls.push(uri);',
      '    return true;',
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

  vscodeStub.__reset();
  vscodeStub.__setWorkspaceFolders([{ name: 'workspace', path: '/workspace' }]);
  vscodeStub.__setFiles([{ path: '/workspace/scratch/link-target.ts', type: 'file' }]);
  const lineScopedResolved = await resolveExecutionFileLink(
    {
      linkKind: 'file',
      text: '2:8',
      path: 'link-target.ts',
      line: 2,
      column: 8,
      bufferStartLine: 21,
      source: 'detected'
    },
    createContext('/bin/bash', '/workspace', 'posix', {
      resolveCwdForBufferLine: async (bufferStartLine) =>
        bufferStartLine === 21 ? '/workspace/scratch' : '/workspace'
    })
  );
  assert.equal(lineScopedResolved?.uri.fsPath, '/workspace/scratch/link-target.ts');
  assert.equal(lineScopedResolved?.selection?.start.line, 1);
  assert.equal(lineScopedResolved?.selection?.start.character, 7);

  vscodeStub.__reset();
  vscodeStub.__setWorkspaceFolders([{ name: 'workspace', path: '/workspace' }]);
  vscodeStub.__setFiles([{ path: '/workspace/current-target.ts', type: 'file' }]);
  const staleResolvedIdIgnoredOpenResult = await openExecutionTerminalLink(
    {
      linkKind: 'file',
      text: 'current-target.ts',
      path: 'current-target.ts',
      bufferStartLine: 10,
      resolvedId: 'stale-resolved-id',
      targetKind: 'file',
      source: 'detected'
    },
    createContext('/bin/bash', '/workspace', 'posix')
  );
  assert.deepEqual(staleResolvedIdIgnoredOpenResult, {
    opened: true,
    openerKind: 'showTextDocument',
    targetUri: '/workspace/current-target.ts'
  });
  const staleResolvedIdIgnoredOpenCalls = vscodeStub.__getShowTextDocumentCalls();
  assert.equal(staleResolvedIdIgnoredOpenCalls.length, 1);
  assert.equal(staleResolvedIdIgnoredOpenCalls[0].document.uri.fsPath, '/workspace/current-target.ts');

  vscodeStub.__reset();
  vscodeStub.__setWorkspaceFolders([{ name: 'workspace', path: '/workspace' }]);
  vscodeStub.__setFiles([
    { path: '/workspace/current-target.ts', type: 'file' },
    { path: '/workspace/cached-target.ts', type: 'file' }
  ]);
  const validResolvedIdIgnoredOpenResult = await openExecutionTerminalLink(
    {
      linkKind: 'file',
      text: 'current-target.ts',
      path: 'current-target.ts',
      bufferStartLine: 10,
      resolvedId: 'valid-resolved-id',
      targetKind: 'file',
      source: 'detected'
    },
    createContext('/bin/bash', '/workspace', 'posix')
  );
  assert.deepEqual(validResolvedIdIgnoredOpenResult, {
    opened: true,
    openerKind: 'showTextDocument',
    targetUri: '/workspace/current-target.ts'
  });
  const validResolvedIdIgnoredOpenCalls = vscodeStub.__getShowTextDocumentCalls();
  assert.equal(validResolvedIdIgnoredOpenCalls.length, 1);
  assert.equal(validResolvedIdIgnoredOpenCalls[0].document.uri.fsPath, '/workspace/current-target.ts');

  vscodeStub.__reset();
  await vscodeStub.workspace
    .getConfiguration('terminal.integrated')
    .update('allowedLinkSchemes', ['https']);
  const defaultUrlOpenResult = await openExecutionTerminalLink(
    {
      linkKind: 'url',
      text: 'https://example.com/docs',
      url: 'https://example.com/docs',
      source: 'implicit'
    },
    createContext('/bin/bash', '/workspace', 'posix')
  );
  assert.deepEqual(defaultUrlOpenResult, {
    opened: true,
    openerKind: 'simpleBrowser.api.open',
    targetUri: 'https://example.com/docs'
  });
  const defaultUrlOpenCommands = vscodeStub.__getExecutedCommands();
  assert.equal(defaultUrlOpenCommands.length, 1);
  assert.equal(defaultUrlOpenCommands[0].command, 'simpleBrowser.api.open');
  assert.equal(defaultUrlOpenCommands[0].args[0].toString(), 'https://example.com/docs');
  assert.deepEqual(defaultUrlOpenCommands[0].args[1], {
    preserveFocus: false,
    viewColumn: -1
  });
  assert.equal(vscodeStub.__getOpenExternalCalls().length, 0);

  vscodeStub.__reset();
  await vscodeStub.workspace
    .getConfiguration('terminal.integrated')
    .update('allowedLinkSchemes', ['mailto']);
  const mailtoUrlOpenResult = await openExecutionTerminalLink(
    {
      linkKind: 'url',
      text: 'mailto:team@example.com',
      url: 'mailto:team@example.com',
      source: 'implicit'
    },
    createContext('/bin/bash', '/workspace', 'posix')
  );
  assert.deepEqual(mailtoUrlOpenResult, {
    opened: true,
    openerKind: 'vscode.open',
    targetUri: 'mailto:team@example.com'
  });
  const mailtoUrlOpenCommands = vscodeStub.__getExecutedCommands();
  assert.equal(mailtoUrlOpenCommands.length, 1);
  assert.equal(mailtoUrlOpenCommands[0].command, 'vscode.open');
  assert.equal(mailtoUrlOpenCommands[0].args[0].toString(), 'mailto:team@example.com');
  assert.equal(vscodeStub.__getOpenExternalCalls().length, 0);

  vscodeStub.__reset();
  await vscodeStub.workspace
    .getConfiguration('terminal.integrated')
    .update('allowedLinkSchemes', ['https']);
  const externalUrlOpenResult = await openExecutionTerminalLink(
    {
      linkKind: 'url',
      text: 'https://example.com/docs',
      url: 'https://example.com/docs',
      source: 'implicit'
    },
    createContext('/bin/bash', '/workspace', 'posix', {
      linkOpenMode: 'externalBrowser'
    })
  );
  assert.deepEqual(externalUrlOpenResult, {
    opened: true,
    openerKind: 'vscode.env.openExternal',
    targetUri: 'https://example.com/docs'
  });
  assert.deepEqual(vscodeStub.__getExecutedCommands(), []);
  assert.equal(vscodeStub.__getOpenExternalCalls().length, 1);
  assert.equal(vscodeStub.__getOpenExternalCalls()[0].toString(), 'https://example.com/docs');

  console.log('executionTerminalNativeHelpers tests passed');
} finally {
  await rm(tempDir, { recursive: true, force: true });
}

function createContext(shellPath, cwd, pathStyle, extra = {}) {
  return {
    shellPath,
    cwd,
    pathStyle,
    ...extra
  };
}
