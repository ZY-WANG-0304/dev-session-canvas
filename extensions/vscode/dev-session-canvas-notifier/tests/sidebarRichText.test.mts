import assert from 'node:assert/strict';

import {
  detectSidebarCodeLanguage,
  formatSidebarRichText,
  renderHighlightedSidebarCodeBlock,
  renderSidebarMarkdown,
  renderSidebarRichContent
} from '../src/sidebarRichText.ts';

function run(): void {
  const inlineHtml = formatSidebarRichText('Bind `L` to `$` and `H` to `^` in operator pending mode.');
  assert.match(
    inlineHtml,
    /Bind <code class="inline-code">L<\/code> to <code class="inline-code">\$<\/code> and <code class="inline-code">H<\/code> to <code class="inline-code">\^<\/code> in operator pending mode\./,
    '反引号包裹的片段应渲染成 inline code。'
  );

  const escapedInlineHtml = formatSidebarRichText('Use `<script>` with `a&b`.');
  assert.ok(
    escapedInlineHtml.includes('&lt;script&gt;') && escapedInlineHtml.includes('a&amp;b'),
    'inline code 内容仍应做 HTML 转义。'
  );

  const jsonSnippet = ['{', '  "preferredNotifChannel": "iterm2"', '}'].join('\n');
  assert.equal(detectSidebarCodeLanguage(jsonSnippet), 'json', 'JSON 片段应被识别为 json。');

  const tomlSnippet = ['[tui]', 'notifications = true', 'notification_method = "osc9"'].join('\n');
  assert.equal(detectSidebarCodeLanguage(tomlSnippet), 'toml', 'TOML 片段应被识别为 toml。');

  const jsonHtml = renderHighlightedSidebarCodeBlock(jsonSnippet);
  assert.match(
    jsonHtml,
    /^<pre><code class="hljs language-json">/u,
    'JSON 代码块应保留标准 Markdown pre>code 结构，并带上 language-json class。'
  );
  assert.ok(jsonHtml.includes('hljs-attr') && jsonHtml.includes('hljs-string'), 'JSON 代码块应包含 syntax highlight token。');

  const tomlHtml = renderHighlightedSidebarCodeBlock(tomlSnippet);
  assert.match(
    tomlHtml,
    /^<pre><code class="hljs language-toml">/u,
    'TOML 代码块应保留标准 Markdown pre>code 结构，并带上 language-toml class。'
  );
  assert.ok(
    tomlHtml.includes('hljs-section') && tomlHtml.includes('hljs-literal'),
    'TOML 代码块应包含 syntax highlight token。'
  );

  const markdownHtml = renderSidebarMarkdown(
    ['### terminal-notifier', '', '- 推荐安装 `terminal-notifier`', '  - 支持点击通知后回到 VS Code', '', '```json', jsonSnippet, '```'].join(
      '\n'
    ),
    { rootClassName: 'sidebar-markdown' }
  );
  assert.match(markdownHtml, /^<div class="sidebar-markdown"><h3>terminal-notifier<\/h3>/u, 'Markdown 标题应渲染成 heading。');
  assert.ok(markdownHtml.includes('<ul>') && markdownHtml.includes('<code class="inline-code">terminal-notifier</code>'), 'Markdown 列表应支持嵌套列表和 inline code。');
  assert.ok(markdownHtml.includes('<pre><code class="hljs language-json">'), 'Markdown fenced code block 应复用标准代码块结构与高亮渲染。');

  const unsafeLinkHtml = renderSidebarMarkdown('[danger](command:workbench.action.closeWindow)', { rootClassName: 'sidebar-markdown' });
  assert.doesNotMatch(unsafeLinkHtml, /href="command:/u, 'unsafe markdown 链接不应渲染成可点击 href。');

  const mixedHtml = renderSidebarRichContent('第一段\n\n- 第二段现在也应走 markdown 列表', { textClassName: 'list-text' });
  assert.match(mixedHtml, /^<div class="sidebar-markdown list-text">/u, 'rich content helper 应复用 markdown preview 容器。');
  assert.ok(mixedHtml.includes('<ul>') && mixedHtml.includes('<li>第二段现在也应走 markdown 列表</li>'), 'rich content helper 应支持 Markdown 列表。');
}

run();
console.log('notifier sidebar rich text tests passed');
