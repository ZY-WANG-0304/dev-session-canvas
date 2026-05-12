import assert from 'node:assert/strict';

import {
  detectSidebarCodeLanguage,
  formatSidebarRichText,
  renderSidebarRichContent,
  renderHighlightedSidebarCodeBlock
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
    /^<pre class="snippet-block"><code class="hljs language-json">/u,
    'JSON 代码块应带上 language-json class。'
  );
  assert.ok(jsonHtml.includes('hljs-attr') && jsonHtml.includes('hljs-string'), 'JSON 代码块应包含 syntax highlight token。');

  const tomlHtml = renderHighlightedSidebarCodeBlock(tomlSnippet);
  assert.match(
    tomlHtml,
    /^<pre class="snippet-block"><code class="hljs language-toml">/u,
    'TOML 代码块应带上 language-toml class。'
  );
  assert.ok(
    tomlHtml.includes('hljs-section') && tomlHtml.includes('hljs-literal'),
    'TOML 代码块应包含 syntax highlight token。'
  );

  const mixedHtml = renderSidebarRichContent(
    ['Bind `L` to `$` and `H` to `^` in operator pending mode:', '', '```json', jsonSnippet, '```'].join('\n'),
    { textClassName: 'list-text' }
  );
  assert.ok(
    mixedHtml.includes('<p class="list-text">Bind <code class="inline-code">L</code> to <code class="inline-code">$</code>'),
    '富文本段落应继续支持 inline code。'
  );
  assert.ok(
    mixedHtml.includes('<pre class="snippet-block"><code class="hljs language-json">'),
    'fenced code block 应渲染为带语法高亮的代码块。'
  );
}

run();
console.log('notifier sidebar rich text tests passed');
