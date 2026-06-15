import assert from 'node:assert/strict';

import {
  detectExecutionTerminalFallbackPathLink,
  detectExecutionTerminalPathLinks,
  detectExecutionTerminalStyledPathLink,
  isPlausibleExecutionTerminalStyledFilePath,
  shouldAllowExecutionTerminalDetectedPathLink,
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
assert.equal(detectExecutionTerminalFallbackPathLink(cjkProsePathLine), undefined);
assert.equal(shouldSuppressExecutionTerminalWordLink(cjkProsePathLine), true);
assert.equal(shouldSuppressExecutionTerminalWordLink('docs/foo.md'), false);
assert.equal(shouldSuppressExecutionTerminalWordLink('foo.md'), false);

const attachedPath =
  'demo/web_demo/WebRTC_Demo/omni_backend_code/code/voice_chat/omni_stream.py:159';
const attachedCjkProseLine = `这里要么在${attachedPath}`;
assert.deepEqual(detectExecutionTerminalPathLinks(attachedCjkProseLine, 'posix'), []);
assert.equal(detectExecutionTerminalFallbackPathLink(attachedCjkProseLine), undefined);
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
assert.equal(detectExecutionTerminalFallbackPathLink('• Working   6'), undefined);
assert.equal(detectExecutionTerminalFallbackPathLink('• Ran gh --version'), undefined);
assert.equal(detectExecutionTerminalFallbackPathLink('… +24 lines (ctrl + t to view transcript)'), undefined);
assert.equal(detectExecutionTerminalFallbackPathLink('│ … +2 lines'), undefined);
assert.equal(detectExecutionTerminalFallbackPathLink('Implement {feature}'), undefined);
assert.equal(detectExecutionTerminalFallbackPathLink('test-canvas-execution-context.mjs')?.path, 'test-canvas-execution-context.mjs');
assert.equal(detectExecutionTerminalStyledPathLink('›', 'posix'), undefined);
assert.equal(detectExecutionTerminalStyledPathLink('· 1', 'posix'), undefined);
assert.equal(detectExecutionTerminalStyledPathLink('tab to queue message', 'posix'), undefined);
assert.equal(detectExecutionTerminalStyledPathLink('Improve documentation in @filename', 'posix'), undefined);
assert.equal(detectExecutionTerminalStyledPathLink('2m 45', 'posix'), undefined);
assert.equal(detectExecutionTerminalStyledPathLink('2026-06-10 04:05', 'posix'), undefined);
assert.equal(detectExecutionTerminalStyledPathLink('time.sleep(max(0, 30', 'posix'), undefined);
assert.equal(detectExecutionTerminalStyledPathLink('20/60', 'posix'), undefined);
assert.equal(detectExecutionTerminalStyledPathLink('@openai/codex', 'posix'), undefined);
assert.equal(detectExecutionTerminalStyledPathLink('/model', 'posix'), undefined);
assert.equal(detectExecutionTerminalStyledPathLink('旧源码里某个未发布/未同步版本', 'posix'), undefined);
assert.equal(detectExecutionTerminalStyledPathLink('openai.com/policies', 'posix'), undefined);
assert.equal(
  detectExecutionTerminalStyledPathLink(
    'en/articles/5722486-how-your-data-is-used-to-improve-model-',
    'posix'
  ),
  undefined
);
assert.equal(detectExecutionTerminalStyledPathLink('Plus/Pro', 'posix'), undefined);
assert.equal(detectExecutionTerminalStyledPathLink('build/plan', 'posix'), undefined);
assert.equal(detectExecutionTerminalFallbackPathLink('custom/tool'), undefined);
assert.equal(
  detectExecutionTerminalFallbackPathLink('custom/tool', {
    mode: 'interactive',
    pathStyle: 'posix'
  })?.path,
  'custom/tool'
);
assert.equal(
  detectExecutionTerminalFallbackPathLink('openai.com/policies', {
    mode: 'interactive',
    pathStyle: 'posix'
  }),
  undefined
);
assert.equal(detectExecutionTerminalStyledPathLink('directory/project/', 'posix'), undefined);
assert.equal(detectExecutionTerminalStyledPathLink('package/@earendil-works/pi-coding-agent', 'posix'), undefined);
assert.equal(
  detectExecutionTerminalStyledPathLink('Dashboard/配置页/状态按钮很多不会按预期工作', 'posix'),
  undefined
);
assert.deepEqual(
  detectExecutionTerminalStyledPathLink('         event.ts,', 'posix'),
  {
    text: 'event.ts',
    path: 'event.ts',
    startIndex: 9,
    endIndexExclusive: 17,
    line: undefined,
    column: undefined,
    lineEnd: undefined,
    columnEnd: undefined
  }
);
assert.equal(detectExecutionTerminalStyledPathLink('sql.ts', 'posix')?.path, 'sql.ts');
assert.equal(detectExecutionTerminalStyledPathLink('docs/readme.md', 'posix')?.path, 'docs/readme.md');
assert.equal(detectExecutionTerminalStyledPathLink('src/foo.ts:10', 'posix')?.line, 10);
assert.equal(detectExecutionTerminalStyledPathLink('File "foo.ts", line 3', 'posix')?.path, 'foo.ts');
assert.equal(isPlausibleExecutionTerminalStyledFilePath('foo.ts', 'posix'), true);
assert.equal(isPlausibleExecutionTerminalStyledFilePath('docs/readme.md', 'posix'), true);
assert.equal(isPlausibleExecutionTerminalStyledFilePath('20/60', 'posix'), false);
for (const text of [
  '2m 45',
  '· 1',
  'message 86',
  'time.sleep(max(0, 30',
  '20/60',
  '97e713e 2026',
  '2026-06-10 04:05',
  '04:05:03',
  '旧源码里某个未发布/未同步版本',
  '有可能只是看到了页面/连接/回显',
  '今天有工作人员帮我看过/演示过',
  'openai.com/policies',
  'en/articles/5722486-how-your-data-is-used-to-improve-model-',
  '敏感代码只走企业/受控通道',
  'Plus/Pro',
  'build/plan',
  'directory/project/',
  'Dashboard/配置页/状态按钮很多不会按预期工作',
  'package/@earendil-works/pi-coding-agent'
]) {
  for (const link of detectExecutionTerminalPathLinks(text, 'posix')) {
    assert.equal(shouldAllowExecutionTerminalDetectedPathLink(link, 'posix'), false, text);
  }
}
assert.equal(
  shouldAllowExecutionTerminalDetectedPathLink(detectExecutionTerminalPathLinks('src/foo.ts:10', 'posix')[0], 'posix'),
  true
);
assert.equal(
  shouldAllowExecutionTerminalDetectedPathLink(detectExecutionTerminalPathLinks('foo:10', 'posix')[0], 'posix'),
  true
);
assert.equal(
  shouldAllowExecutionTerminalDetectedPathLink(detectExecutionTerminalPathLinks('"foo", line 10', 'posix')[0], 'posix'),
  true
);
assert.equal(
  shouldAllowExecutionTerminalDetectedPathLink(
    detectExecutionTerminalPathLinks('packages/opencode/src/cli/cmd/tui.ts', 'posix')[0],
    'posix'
  ),
  true
);
assert.equal(
  shouldAllowExecutionTerminalDetectedPathLink(
    detectExecutionTerminalPathLinks('src/panel', 'posix')[0],
    'posix'
  ),
  true
);
assert.equal(
  shouldAllowExecutionTerminalDetectedPathLink(
    detectExecutionTerminalPathLinks('file:///workspace/docs/readme.md', 'posix')[0],
    'posix'
  ),
  true
);
assert.equal(
  shouldAllowExecutionTerminalDetectedPathLink(
    detectExecutionTerminalPathLinks('.lark-slides/plan/', 'posix')[0],
    'posix'
  ),
  false
);
assert.equal(shouldSuppressExecutionTerminalWordLink('文档/设计.md'), false);
assert.equal(shouldSuppressExecutionTerminalWordLink('设计.md'), false);
assert.deepEqual(
  detectExecutionTerminalPathLinks('项目v2/docs/foo.md', 'posix').map((link) => link.text),
  ['项目v2/docs/foo.md']
);
assert.deepEqual(
  detectExecutionTerminalPathLinks('第1章/src/index.ts', 'posix').map((link) => link.text),
  ['第1章/src/index.ts']
);
assert.deepEqual(
  detectExecutionTerminalPathLinks('project文档/docs/foo.md', 'posix').map((link) => link.text),
  ['project文档/docs/foo.md']
);
assert.deepEqual(
  detectExecutionTerminalPathLinks('设计文档：“docs/foo.md”。', 'posix').map((link) => link.text),
  ['docs/foo.md']
);
assert.deepEqual(detectExecutionTerminalPathLinks('文档/需求：方案.md', 'posix'), []);
assert.equal(shouldSuppressExecutionTerminalWordLink('相关改动：'), true);
assert.equal(shouldSuppressExecutionTerminalWordLink('普通中文词'), true);

assert.deepEqual(
  detectExecutionTerminalPathLinks('--- a/src/foo.ts', 'posix').map((link) => ({
    text: link.text,
    path: link.path
  })),
  [{ text: 'src/foo.ts', path: 'src/foo.ts' }]
);
assert.deepEqual(
  detectExecutionTerminalPathLinks('+++ b/src/foo.ts', 'posix').map((link) => ({
    text: link.text,
    path: link.path
  })),
  [{ text: 'src/foo.ts', path: 'src/foo.ts' }]
);
assert.deepEqual(
  detectExecutionTerminalPathLinks('diff --git a/src/foo.ts b/src/foo.ts', 'posix').map((link) => ({
    text: link.text,
    path: link.path
  })),
  [
    { text: 'src/foo.ts', path: 'src/foo.ts' },
    { text: 'src/foo.ts', path: 'src/foo.ts' }
  ]
);

console.log('executionTerminalLinks tests passed');
