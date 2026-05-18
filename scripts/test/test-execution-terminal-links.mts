import assert from 'node:assert/strict';

import {
  detectExecutionTerminalFallbackPathLink,
  detectExecutionTerminalPathLinks,
  shouldSuppressExecutionTerminalWordLink
} from '../../src/common/executionTerminalLinks.ts';

const designDocPath = 'docs/design-docs/execution-terminal-tui-hard-wrapped-links.md';
const cjkProsePathLine = `我已经把这个判断补进了设计文档：${designDocPath}。`;
assert.deepEqual(
  detectExecutionTerminalPathLinks(cjkProsePathLine, 'posix').map((link) => ({
    text: link.text,
    path: link.path,
    startIndex: link.startIndex,
    endIndexExclusive: link.endIndexExclusive
  })),
  [
    {
      text: designDocPath,
      path: designDocPath,
      startIndex: cjkProsePathLine.indexOf(designDocPath),
      endIndexExclusive: cjkProsePathLine.indexOf(designDocPath) + designDocPath.length
    }
  ]
);
assert.equal(detectExecutionTerminalFallbackPathLink(cjkProsePathLine)?.path, cjkProsePathLine);
assert.equal(shouldSuppressExecutionTerminalWordLink(cjkProsePathLine), true);
assert.equal(shouldSuppressExecutionTerminalWordLink('docs/foo.md'), false);
assert.equal(shouldSuppressExecutionTerminalWordLink('foo.md'), false);

const attachedPath =
  'demo/web_demo/WebRTC_Demo/omni_backend_code/code/voice_chat/omni_stream.py:159';
const attachedCjkProseLine = `这里要么在${attachedPath}`;
assert.deepEqual(detectExecutionTerminalPathLinks(attachedCjkProseLine, 'posix'), []);
assert.equal(detectExecutionTerminalFallbackPathLink(attachedCjkProseLine)?.path, attachedCjkProseLine);
assert.equal(shouldSuppressExecutionTerminalWordLink(attachedCjkProseLine), true);

const cjkPunctuationLine = '开放问题： 仓库里同时有两套目录： src/webview 和 src/panel。';
assert.deepEqual(
  detectExecutionTerminalPathLinks(cjkPunctuationLine, 'posix').map((link) => link.text),
  ['src/webview', 'src/panel']
);

assert.deepEqual(
  detectExecutionTerminalPathLinks('src/panel.', 'posix').map((link) => link.text),
  ['src/panel.']
);

assert.deepEqual(
  detectExecutionTerminalPathLinks('文档/设计.md', 'posix').map((link) => link.text),
  ['文档/设计.md']
);
assert.equal(detectExecutionTerminalFallbackPathLink('文档/设计.md')?.path, '文档/设计.md');
assert.equal(shouldSuppressExecutionTerminalWordLink('文档/设计.md'), false);
assert.equal(shouldSuppressExecutionTerminalWordLink('设计.md'), false);
assert.equal(shouldSuppressExecutionTerminalWordLink('相关改动：'), true);
assert.equal(shouldSuppressExecutionTerminalWordLink('普通中文词'), true);

console.log('executionTerminalLinks tests passed');
