import assert from 'node:assert/strict';

import {
  inferExecutionTerminalClipboardPlatform,
  prepareExecutionTerminalPasteText,
  resolveExecutionTerminalClipboardShortcut
} from '../../src/common/executionTerminalClipboard.ts';
import { parseWebviewMessage } from '../../src/common/protocol.ts';

function event(key: string, modifiers: Partial<{ ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean }> = {}) {
  return {
    key,
    ctrlKey: modifiers.ctrlKey === true,
    metaKey: modifiers.metaKey === true,
    shiftKey: modifiers.shiftKey === true,
    altKey: modifiers.altKey === true
  };
}

function runShortcutMatrix(): void {
  assert.equal(
    resolveExecutionTerminalClipboardShortcut('mac', event('c', { metaKey: true }), true),
    'copy',
    'macOS Cmd+C 应复制终端选区。'
  );
  assert.equal(
    resolveExecutionTerminalClipboardShortcut('mac', event('c', { metaKey: true }), false),
    'passThrough',
    'macOS Cmd+C 无终端选区时不应被 xterm handler 吞掉。'
  );
  assert.equal(
    resolveExecutionTerminalClipboardShortcut('mac', event('c', { ctrlKey: true }), true),
    'passThrough',
    'macOS Ctrl+C 即使有选区也应继续交给 shell 打断。'
  );
  assert.equal(
    resolveExecutionTerminalClipboardShortcut('mac', event('v', { metaKey: true }), false),
    'paste',
    'macOS Cmd+V 应粘贴。'
  );

  assert.equal(
    resolveExecutionTerminalClipboardShortcut('windows', event('c', { ctrlKey: true }), true),
    'copyAndClearSelection',
    'Windows Ctrl+C 有选区时应复制并清空选区。'
  );
  assert.equal(
    resolveExecutionTerminalClipboardShortcut('windows', event('c', { ctrlKey: true }), false),
    'passThrough',
    'Windows Ctrl+C 无选区时应发送 interrupt。'
  );
  assert.equal(
    resolveExecutionTerminalClipboardShortcut('windows', event('v', { ctrlKey: true }), false),
    'paste',
    'Windows Ctrl+V 应粘贴。'
  );
  assert.equal(
    resolveExecutionTerminalClipboardShortcut('windows', event('v', { ctrlKey: true, shiftKey: true }), false),
    'paste',
    'Windows Ctrl+Shift+V 也应粘贴。'
  );

  assert.equal(
    resolveExecutionTerminalClipboardShortcut('linux', event('c', { ctrlKey: true }), true),
    'passThrough',
    'Linux Ctrl+C 即使有选区也应发送 interrupt。'
  );
  assert.equal(
    resolveExecutionTerminalClipboardShortcut('linux', event('c', { ctrlKey: true, shiftKey: true }), true),
    'copy',
    'Linux Ctrl+Shift+C 应复制选区。'
  );
  assert.equal(
    resolveExecutionTerminalClipboardShortcut('linux', event('v', { ctrlKey: true }), false),
    'passThrough',
    'Linux Ctrl+V 不应被当作粘贴快捷键。'
  );
  assert.equal(
    resolveExecutionTerminalClipboardShortcut('linux', event('v', { ctrlKey: true, shiftKey: true }), false),
    'paste',
    'Linux Ctrl+Shift+V 应粘贴。'
  );
}

function runRemotePlatformInferenceChecks(): void {
  assert.equal(
    inferExecutionTerminalClipboardPlatform({ platform: 'MacIntel', userAgent: 'Mozilla/5.0' }),
    'mac',
    'Remote SSH 到 Linux 时，本地 macOS Webview 仍应推断为 mac。'
  );
  assert.equal(
    inferExecutionTerminalClipboardPlatform({ platform: 'Win32', userAgent: 'Mozilla/5.0' }),
    'windows',
    'Remote SSH 到 Linux 时，本地 Windows Webview 仍应推断为 windows。'
  );
  assert.equal(
    inferExecutionTerminalClipboardPlatform({ platform: 'Linux x86_64', userAgent: 'Mozilla/5.0 X11' }),
    'linux',
    '本地 Linux Webview 应推断为 linux。'
  );
}

function runPastePreparationChecks(): void {
  assert.deepEqual(
    prepareExecutionTerminalPasteText('echo ok', false),
    { kind: 'paste', text: 'echo ok' },
    '单行剪贴板应直接粘贴。'
  );
  assert.deepEqual(
    prepareExecutionTerminalPasteText('echo ok\n', false),
    { kind: 'paste', text: 'echo ok' },
    '单条命令尾随换行应先剥离，避免立即执行。'
  );
  assert.deepEqual(
    prepareExecutionTerminalPasteText('echo ok\r', false),
    { kind: 'paste', text: 'echo ok' },
    'CR-only 单条命令尾随回车也应先剥离，避免立即执行。'
  );
  assert.deepEqual(
    prepareExecutionTerminalPasteText('echo one\necho two', false),
    { kind: 'confirm', text: 'echo one\necho two', lineCount: 2 },
    '普通多行剪贴板应要求确认。'
  );
  assert.deepEqual(
    prepareExecutionTerminalPasteText('echo one\recho two', false),
    { kind: 'confirm', text: 'echo one\recho two', lineCount: 2 },
    'CR-only 分隔的多行剪贴板也应要求确认。'
  );
  assert.deepEqual(
    prepareExecutionTerminalPasteText('echo one\necho two', true),
    { kind: 'paste', text: 'echo one\necho two' },
    'bracketed paste mode 下多行内容可直接交给 shell 处理。'
  );
  assert.deepEqual(
    prepareExecutionTerminalPasteText('', false),
    { kind: 'cancel' },
    '空剪贴板不应生成粘贴。'
  );
}

function runProtocolChecks(): void {
  assert.deepEqual(
    parseWebviewMessage({
      type: 'webview/copyExecutionSelection',
      payload: {
        nodeId: 'agent-1',
        kind: 'agent',
        text: 'selected text',
        clearSelectionAfterCopy: true
      }
    }),
    {
      type: 'webview/copyExecutionSelection',
      payload: {
        nodeId: 'agent-1',
        kind: 'agent',
        text: 'selected text',
        clearSelectionAfterCopy: true
      }
    },
    'copyExecutionSelection 协议应通过 validator。'
  );

  assert.deepEqual(
    parseWebviewMessage({
      type: 'webview/copyTextToClipboard',
      payload: {
        text: 'docs/design.md',
        source: 'note-markdown-subtitle',
        nodeId: 'note-1'
      }
    }),
    {
      type: 'webview/copyTextToClipboard',
      payload: {
        text: 'docs/design.md',
        source: 'note-markdown-subtitle',
        nodeId: 'note-1'
      }
    },
    '通用剪贴板文本协议应通过 validator。'
  );

  assert.deepEqual(
    parseWebviewMessage({
      type: 'webview/copyTextToClipboard',
      payload: {
        text: '---\ntitle: Note\n---\n',
        source: 'note-markdown-metadata',
        nodeId: 'note-1'
      }
    }),
    {
      type: 'webview/copyTextToClipboard',
      payload: {
        text: '---\ntitle: Note\n---\n',
        source: 'note-markdown-metadata',
        nodeId: 'note-1'
      }
    },
    'Markdown metadata 剪贴板来源应通过 validator。'
  );

  assert.deepEqual(
    parseWebviewMessage({
      type: 'webview/requestExecutionPaste',
      payload: {
        requestId: 'paste-1',
        nodeId: 'terminal-1',
        kind: 'terminal',
        bracketedPasteMode: false
      }
    }),
    {
      type: 'webview/requestExecutionPaste',
      payload: {
        requestId: 'paste-1',
        nodeId: 'terminal-1',
        kind: 'terminal',
        bracketedPasteMode: false
      }
    },
    'requestExecutionPaste 协议应通过 validator。'
  );
}

runShortcutMatrix();
runRemotePlatformInferenceChecks();
runPastePreparationChecks();
runProtocolChecks();
console.log('execution terminal clipboard tests passed');
