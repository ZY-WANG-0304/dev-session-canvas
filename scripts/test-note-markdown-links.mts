import assert from 'node:assert/strict';
import path from 'node:path';

import {
  normalizeOpenableNoteMarkdownHref,
  resolveNoteMarkdownLinkTarget
} from '../src/common/noteMarkdownLinks.ts';

function run(): void {
  assert.equal(
    normalizeOpenableNoteMarkdownHref(' https://example.com/docs '),
    'https://example.com/docs',
    'http(s) 链接应被保留并允许打开。'
  );

  assert.equal(
    normalizeOpenableNoteMarkdownHref('mailto:team@example.com?subject=Roadmap Sync'),
    'mailto:team@example.com?subject=Roadmap%20Sync',
    'mailto 链接应被保留并做合法编码。'
  );

  assert.equal(
    normalizeOpenableNoteMarkdownHref('command:workbench.action.closeActiveEditor'),
    null,
    'command: scheme 不应被 Note 预览直接打开。'
  );

  assert.equal(
    normalizeOpenableNoteMarkdownHref('javascript:alert(1)'),
    null,
    'javascript: scheme 不应被 Note 预览直接打开。'
  );

  assert.equal(
    normalizeOpenableNoteMarkdownHref('./README.md'),
    null,
    '相对路径不应被误判为可安全打开的外部链接。'
  );

  const singleRoot = [{ name: 'workspace', path: path.join(path.sep, 'workspace') }];
  assert.deepStrictEqual(
    resolveNoteMarkdownLinkTarget({
      href: './docs/DESIGN.md#L12C3',
      workspaceRoots: singleRoot
    }),
    {
      kind: 'workspace-file',
      filePath: path.join(path.sep, 'workspace', 'docs', 'DESIGN.md'),
      selection: {
        line: 12,
        column: 3
      }
    },
    '单根 workspace 应支持纯相对路径与行列 fragment。'
  );

  const multiRoot = [
    { name: 'workspace-a', path: path.join(path.sep, 'workspace-a') },
    { name: 'workspace-b', path: path.join(path.sep, 'workspace-b') }
  ];
  assert.deepStrictEqual(
    resolveNoteMarkdownLinkTarget({
      href: 'workspace-b/src/index.ts#L8',
      workspaceRoots: multiRoot
    }),
    {
      kind: 'workspace-file',
      filePath: path.join(path.sep, 'workspace-b', 'src', 'index.ts'),
      selection: {
        line: 8
      }
    },
    '多根 workspace 应要求带 workspace folder 前缀。'
  );

  assert.equal(
    resolveNoteMarkdownLinkTarget({
      href: 'src/index.ts',
      workspaceRoots: multiRoot
    }),
    null,
    '多根 workspace 下不带 workspace folder 前缀的裸相对路径应 fail closed。'
  );

  assert.equal(
    resolveNoteMarkdownLinkTarget({
      href: '../outside.txt',
      workspaceRoots: singleRoot
    }),
    null,
    '逃逸出 workspace root 的相对路径不应被解析。'
  );

  assert.equal(
    resolveNoteMarkdownLinkTarget({
      href: '/etc/passwd',
      workspaceRoots: singleRoot
    }),
    null,
    '绝对路径不应被解析成 Note 文件链接。'
  );

  assert.deepStrictEqual(
    resolveNoteMarkdownLinkTarget({
      href: 'https://example.com/work-log',
      workspaceRoots: singleRoot
    }),
    {
      kind: 'external',
      href: 'https://example.com/work-log'
    },
    '统一解析入口应继续返回允许的外部链接。'
  );
}

run();
console.log('note markdown link tests passed');
