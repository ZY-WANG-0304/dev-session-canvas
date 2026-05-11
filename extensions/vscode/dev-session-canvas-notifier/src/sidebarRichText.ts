import hljs from 'highlight.js/lib/common';

const SIDEBAR_CODE_BLOCK_LANGUAGES = ['json', 'toml', 'bash', 'shell'] as const;
const SIDEBAR_CODE_FENCE_PATTERN = /```([A-Za-z0-9_+-]+)?\n([\s\S]*?)```/g;

interface SidebarRichContentOptions {
  textClassName?: string;
}

export function formatSidebarRichText(value: string): string {
  return value
    .split(/`([^`]+)`/g)
    .map((segment, index) => (index % 2 === 1 ? renderSidebarInlineCode(segment) : escapeHtml(segment)))
    .join('');
}

export function renderSidebarRichContent(value: string, options: SidebarRichContentOptions = {}): string {
  const blocks = parseSidebarRichBlocks(value);
  return blocks
    .map((block) => {
      if (block.kind === 'code') {
        return renderHighlightedSidebarCodeBlock(block.content, block.language);
      }

      return renderSidebarTextParagraphs(block.content, options.textClassName);
    })
    .join('');
}

export function renderSidebarInlineCode(value: string): string {
  return `<code class="inline-code">${escapeHtml(value)}</code>`;
}

export function renderHighlightedSidebarCodeBlock(source: string, explicitLanguage?: string): string {
  const language = normalizeExplicitLanguage(explicitLanguage) ?? detectSidebarCodeLanguage(source);
  const highlighted = highlightSidebarCode(source, language);
  const languageClass = normalizeHighlightedLanguageClass(highlighted.language);
  return `<pre class="snippet-block"><code class="hljs${languageClass ? ` ${languageClass}` : ''}">${highlighted.html}</code></pre>`;
}

export function detectSidebarCodeLanguage(source: string): string | undefined {
  const trimmed = source.trim();
  if (!trimmed) {
    return undefined;
  }

  try {
    JSON.parse(trimmed);
    return 'json';
  } catch {
    // Ignore JSON parse failures and continue with heuristic detection.
  }

  if (/^\s*\[[^\]\n]+\]\s*$/mu.test(source) || /^\s*[A-Za-z0-9_.-]+\s*=\s*.+$/mu.test(source)) {
    return 'toml';
  }

  return undefined;
}

function highlightSidebarCode(source: string, language: string | undefined): { html: string; language: string | undefined } {
  if (language && hljs.getLanguage(language)) {
    return {
      html: hljs.highlight(source, {
        language,
        ignoreIllegals: true
      }).value,
      language
    };
  }

  const autoDetected = hljs.highlightAuto(source, [...SIDEBAR_CODE_BLOCK_LANGUAGES]);
  if (autoDetected.value) {
    return {
      html: autoDetected.value,
      language: autoDetected.language
    };
  }

  return {
    html: escapeHtml(source),
    language
  };
}

function normalizeHighlightedLanguageClass(language: string | undefined): string | null {
  if (!language) {
    return null;
  }

  return /^[A-Za-z0-9_+-]+$/u.test(language) ? `language-${language}` : null;
}

function parseSidebarRichBlocks(value: string): Array<
  | { kind: 'text'; content: string }
  | { kind: 'code'; content: string; language?: string }
> {
  const blocks: Array<{ kind: 'text'; content: string } | { kind: 'code'; content: string; language?: string }> = [];
  let lastIndex = 0;

  for (const match of value.matchAll(SIDEBAR_CODE_FENCE_PATTERN)) {
    const matchIndex = match.index ?? 0;
    if (matchIndex > lastIndex) {
      blocks.push({
        kind: 'text',
        content: value.slice(lastIndex, matchIndex)
      });
    }

    blocks.push({
      kind: 'code',
      language: match[1],
      content: trimSingleTrailingNewline(match[2] ?? '')
    });
    lastIndex = matchIndex + match[0].length;
  }

  if (lastIndex < value.length) {
    blocks.push({
      kind: 'text',
      content: value.slice(lastIndex)
    });
  }

  if (blocks.length === 0) {
    return [{ kind: 'text', content: value }];
  }

  return blocks;
}

function renderSidebarTextParagraphs(value: string, textClassName: string | undefined): string {
  return value
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0)
    .map((paragraph) => {
      const classAttribute = textClassName ? ` class="${textClassName}"` : '';
      return `<p${classAttribute}>${formatSidebarRichText(paragraph).replace(/\n/g, '<br />')}</p>`;
    })
    .join('');
}

function normalizeExplicitLanguage(language: string | undefined): string | undefined {
  if (!language) {
    return undefined;
  }

  const normalized = language.trim().toLowerCase();
  return normalized.length > 0 ? normalized : undefined;
}

function trimSingleTrailingNewline(value: string): string {
  return value.replace(/\r?\n$/, '');
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
