import hljs from 'highlight.js/lib/common';
import MarkdownIt from 'markdown-it';

const SIDEBAR_CODE_BLOCK_LANGUAGES = ['json', 'toml', 'bash', 'shell'] as const;
const SAFE_SIDEBAR_MARKDOWN_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);

interface SidebarRichContentOptions {
  textClassName?: string;
}

interface SidebarMarkdownRenderOptions {
  rootClassName?: string;
}

const sidebarMarkdownRenderer = createSidebarMarkdownRenderer();

export function formatSidebarRichText(value: string): string {
  return value
    .split(/`([^`]+)`/g)
    .map((segment, index) => (index % 2 === 1 ? renderSidebarInlineCode(segment) : escapeHtml(segment)))
    .join('');
}

export function renderSidebarMarkdown(value: string, options: SidebarMarkdownRenderOptions = {}): string {
  const className = options.rootClassName?.trim();
  const classAttribute = className ? ` class="${escapeHtmlAttribute(className)}"` : '';
  return `<div${classAttribute}>${sidebarMarkdownRenderer.render(value)}</div>`;
}

export function renderSidebarRichContent(value: string, options: SidebarRichContentOptions = {}): string {
  const rootClassName = ['sidebar-markdown', options.textClassName].filter(Boolean).join(' ');
  return renderSidebarMarkdown(value, { rootClassName });
}

export function renderSidebarInlineCode(value: string): string {
  return `<code class="inline-code">${escapeHtml(value)}</code>`;
}

export function renderHighlightedSidebarCodeBlock(source: string, explicitLanguage?: string): string {
  const language = normalizeExplicitLanguage(explicitLanguage) ?? detectSidebarCodeLanguage(source);
  const highlighted = highlightSidebarCode(source, language);
  const languageClass = normalizeHighlightedLanguageClass(highlighted.language);
  return `<pre><code class="hljs${languageClass ? ` ${languageClass}` : ''}">${highlighted.html}</code></pre>`;
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

function createSidebarMarkdownRenderer(): MarkdownIt {
  const renderer = new MarkdownIt({
    html: false,
    breaks: true,
    linkify: false,
    highlight(code, info) {
      return renderHighlightedSidebarCodeBlock(code, info.trim().split(/\s+/, 1)[0]);
    }
  });

  const defaultValidateLink = renderer.validateLink.bind(renderer);
  renderer.validateLink = (href) => defaultValidateLink(href) && isSafeSidebarMarkdownHref(href);
  renderer.renderer.rules.code_inline = (tokens, idx) => renderSidebarInlineCode(tokens[idx].content);
  return renderer;
}

function isSafeSidebarMarkdownHref(href: string): boolean {
  try {
    const parsed = new URL(href);
    return SAFE_SIDEBAR_MARKDOWN_PROTOCOLS.has(parsed.protocol);
  } catch {
    return false;
  }
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

function normalizeExplicitLanguage(language: string | undefined): string | undefined {
  if (!language) {
    return undefined;
  }

  const normalized = language.trim().toLowerCase();
  return normalized.length > 0 ? normalized : undefined;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeHtmlAttribute(value: string): string {
  return escapeHtml(value);
}
