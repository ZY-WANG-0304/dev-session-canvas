import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  createExecutionImagePasteFileName,
  EXECUTION_IMAGE_PASTE_CACHE_TTL_MS,
  EXECUTION_IMAGE_PASTE_TEMP_FILE_TTL_MS,
  formatExecutionImagePasteText,
  getExecutionImagePasteCacheFileCleanupDecision,
  hasValidExecutionImagePasteSignature,
  inferExecutionTerminalClipboardPlatform,
  prepareExecutionTerminalPasteText,
  resolveExecutionTerminalClipboardShortcut,
  sanitizeExecutionImagePastePathSegment
} from '../../src/common/executionTerminalClipboard.ts';
import { parseWebviewMessage } from '../../src/common/protocol.ts';
import { cleanupExecutionImagePasteCache } from '../../src/panel/executionImagePasteCacheMaintenance.ts';

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

function runImagePasteHelperChecks(): void {
  assert.equal(
    createExecutionImagePasteFileName({
      mimeType: 'image/png',
      now: new Date('2026-06-24T01:02:03.004Z'),
      randomSuffix: 'abc/unsafe value'
    }),
    'pasted-screenshot-20260624T010203004Z-abc-unsafe-value.png',
    '截图粘贴文件名应稳定包含时间、随机后缀和 MIME 扩展名。'
  );
  assert.equal(
    sanitizeExecutionImagePastePathSegment(' ../agent:one? ', 'fallback'),
    'agent-one',
    '截图粘贴存储段应去除路径与 shell 危险字符。'
  );
  assert.equal(
    formatExecutionImagePasteText("/tmp/path with 'quote'.png"),
    "'/tmp/path with '\\''quote'\\''.png' ",
    '粘贴给 Agent 的图片路径文本应使用 shell-safe 单引号并保留尾随空格。'
  );
  assert.equal(
    hasValidExecutionImagePasteSignature(
      Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      'image/png'
    ),
    true,
    'PNG magic number 应被接受。'
  );
  assert.equal(
    hasValidExecutionImagePasteSignature(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]), 'image/jpeg'),
    true,
    'JPEG magic number 应被接受。'
  );
  assert.equal(
    hasValidExecutionImagePasteSignature(
      Uint8Array.from([0x52, 0x49, 0x46, 0x46, 1, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]),
      'image/webp'
    ),
    true,
    'WebP RIFF/WEBP magic number 应被接受。'
  );
  assert.equal(
    hasValidExecutionImagePasteSignature(Uint8Array.from([0x47, 0x49, 0x46]), 'image/png'),
    false,
    'MIME 与 magic number 不一致时应拒绝。'
  );
  assert.deepEqual(
    getExecutionImagePasteCacheFileCleanupDecision({
      fileName: 'pasted-screenshot-20260601T000000000Z-old.png',
      mtimeMs: 1000,
      nowMs: 1000 + EXECUTION_IMAGE_PASTE_CACHE_TTL_MS + 1
    }),
    { shouldDelete: true, reason: 'expired-image' },
    '超过 7 天 TTL 的截图缓存应具备删除资格。'
  );
  assert.deepEqual(
    getExecutionImagePasteCacheFileCleanupDecision({
      fileName: 'pasted-screenshot-20260601T000000000Z-old.png',
      mtimeMs: 1000,
      nowMs: 1000 + EXECUTION_IMAGE_PASTE_CACHE_TTL_MS
    }),
    { shouldDelete: false },
    '刚好达到 7 天 TTL 的截图缓存不应被急切删除。'
  );
  assert.deepEqual(
    getExecutionImagePasteCacheFileCleanupDecision({
      fileName: 'pasted-screenshot-20260601T000000000Z-old.png.123.tmp',
      mtimeMs: 1000,
      nowMs: 1000 + EXECUTION_IMAGE_PASTE_TEMP_FILE_TTL_MS + 1
    }),
    { shouldDelete: true, reason: 'expired-temp' },
    '写入中断留下的临时截图文件应使用更短 TTL。'
  );
  assert.deepEqual(
    getExecutionImagePasteCacheFileCleanupDecision({
      fileName: 'unrelated.png',
      mtimeMs: 1000,
      nowMs: 1000 + EXECUTION_IMAGE_PASTE_CACHE_TTL_MS + 1
    }),
    { shouldDelete: false },
    '清理器不应删除非截图缓存命名的文件。'
  );
}

function runImagePasteCacheCleanupChecks(): void {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-session-canvas-image-paste-cache-'));
  try {
    const cacheRootPath = path.join(tempRoot, 'execution-image-pastes');
    const nodeDirectory = path.join(cacheRootPath, 'agent-1');
    fs.mkdirSync(nodeDirectory, { recursive: true });
    const oldImage = path.join(nodeDirectory, 'pasted-screenshot-20260601T000000000Z-old.png');
    const oldTemp = path.join(nodeDirectory, 'pasted-screenshot-20260601T000000000Z-old.jpg.123.tmp');
    const freshImage = path.join(nodeDirectory, 'pasted-screenshot-20260624T000000000Z-fresh.png');
    const unrelated = path.join(nodeDirectory, 'notes.png');
    fs.writeFileSync(oldImage, 'old-image');
    fs.writeFileSync(oldTemp, 'old-temp');
    fs.writeFileSync(freshImage, 'fresh-image');
    fs.writeFileSync(unrelated, 'unrelated');

    const nowMs = Date.UTC(2026, 5, 24, 0, 0, 0);
    const expiredImageDate = new Date(nowMs - EXECUTION_IMAGE_PASTE_CACHE_TTL_MS - 1000);
    const expiredTempDate = new Date(nowMs - EXECUTION_IMAGE_PASTE_TEMP_FILE_TTL_MS - 1000);
    fs.utimesSync(oldImage, expiredImageDate, expiredImageDate);
    fs.utimesSync(oldTemp, expiredTempDate, expiredTempDate);
    fs.utimesSync(freshImage, new Date(nowMs), new Date(nowMs));
    fs.utimesSync(unrelated, expiredImageDate, expiredImageDate);

    const result = cleanupExecutionImagePasteCache({
      cacheRootPath,
      shouldDeleteFile: getExecutionImagePasteCacheFileCleanupDecision,
      nowMs,
      maxFilesDeleted: 10,
      maxEntriesScanned: 50,
      maxDurationMs: 10_000
    });

    assert.equal(result.deletedFiles, 2, '清理器应删除过期图片和过期临时文件。');
    assert.equal(fs.existsSync(oldImage), false, '过期图片应被删除。');
    assert.equal(fs.existsSync(oldTemp), false, '过期临时文件应被删除。');
    assert.equal(fs.existsSync(freshImage), true, '未过期图片应保留。');
    assert.equal(fs.existsSync(unrelated), true, '非截图缓存命名文件应保留。');
    assert.equal(result.budgetExhausted, false, '预算充足时不应标记 backlog。');

    const budgetRoot = path.join(tempRoot, 'budget');
    const budgetNodeDirectory = path.join(budgetRoot, 'agent-1');
    fs.mkdirSync(budgetNodeDirectory, { recursive: true });
    for (let index = 0; index < 3; index += 1) {
      const filePath = path.join(budgetNodeDirectory, `pasted-screenshot-20260601T000000000Z-${index}.png`);
      fs.writeFileSync(filePath, 'old-image');
      fs.utimesSync(filePath, expiredImageDate, expiredImageDate);
    }
    const budgetResult = cleanupExecutionImagePasteCache({
      cacheRootPath: budgetRoot,
      shouldDeleteFile: getExecutionImagePasteCacheFileCleanupDecision,
      nowMs,
      maxFilesDeleted: 1,
      maxEntriesScanned: 50,
      maxDurationMs: 10_000
    });
    assert.equal(budgetResult.deletedFiles, 1, '单次清理应遵守删除文件数预算。');
    assert.equal(budgetResult.budgetExhausted, true, '达到预算时应提示需要后续维护窗口继续。');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
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

  assert.deepEqual(
    parseWebviewMessage({
      type: 'webview/pasteExecutionImage',
      payload: {
        requestId: 'image-paste-1',
        nodeId: 'agent-1',
        kind: 'agent',
        mimeType: 'image/png',
        dataBase64: 'iVBORw0KGgo=',
        sizeBytes: 8,
        name: 'screenshot.png'
      }
    }),
    {
      type: 'webview/pasteExecutionImage',
      payload: {
        requestId: 'image-paste-1',
        nodeId: 'agent-1',
        kind: 'agent',
        mimeType: 'image/png',
        dataBase64: 'iVBORw0KGgo=',
        sizeBytes: 8,
        name: 'screenshot.png'
      }
    },
    'pasteExecutionImage 协议应通过 validator。'
  );
  assert.equal(
    parseWebviewMessage({
      type: 'webview/pasteExecutionImage',
      payload: {
        requestId: 'image-paste-1',
        nodeId: 'agent-1',
        kind: 'agent',
        mimeType: 'image/svg+xml',
        dataBase64: 'PHN2Zz4=',
        sizeBytes: 6
      }
    }),
    null,
    'pasteExecutionImage 应拒绝不在白名单内的 MIME。'
  );

  assert.deepEqual(
    parseWebviewMessage({
      type: 'webview/executionClipboardDiagnostic',
      payload: {
        nodeId: 'agent-1',
        kind: 'agent',
        source: 'shortcut',
        detail: {
          action: 'copy',
          selectionLength: 12,
          mouseTrackingMode: 'none'
        }
      }
    }),
    {
      type: 'webview/executionClipboardDiagnostic',
      payload: {
        nodeId: 'agent-1',
        kind: 'agent',
        source: 'shortcut',
        detail: {
          action: 'copy',
          selectionLength: 12,
          mouseTrackingMode: 'none'
        }
      }
    },
    'executionClipboardDiagnostic 协议应通过 validator。'
  );

  assert.deepEqual(
    parseWebviewMessage({
      type: 'webview/executionClipboardDiagnostic',
      payload: {
        nodeId: 'terminal-1',
        kind: 'terminal',
        source: 'restoreSuppressed',
        detail: {
          reason: 'snapshot-restore',
          total: 2,
          counts: {
            selectionChange: 1,
            osc52: 1
          }
        }
      }
    }),
    {
      type: 'webview/executionClipboardDiagnostic',
      payload: {
        nodeId: 'terminal-1',
        kind: 'terminal',
        source: 'restoreSuppressed',
        detail: {
          reason: 'snapshot-restore',
          total: 2,
          counts: {
            selectionChange: 1,
            osc52: 1
          }
        }
      }
    },
    'snapshot restore clipboard diagnostic suppression summary 应通过 validator。'
  );
}

runShortcutMatrix();
runRemotePlatformInferenceChecks();
runPastePreparationChecks();
runImagePasteHelperChecks();
runImagePasteCacheCleanupChecks();
runProtocolChecks();
console.log('execution terminal clipboard tests passed');
