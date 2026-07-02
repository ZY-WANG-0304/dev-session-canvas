export type WebviewLocale = 'en' | 'zh-CN';

export const enWebviewMessages = {
  'surface.panel': 'workbench view',
  'surface.editor': 'editor area',
  'surface.other': 'another host surface',
  'canvas.fitView': 'Fit view',
  'canvas.minimap': 'Canvas minimap',
  'standby.heading': 'The main canvas is currently running in {surface}',
  'standby.description':
    'Dev Session Canvas uses a single-primary-surface model. To avoid attaching the same Agent or Terminal session to two host areas, this surface only keeps switch actions and does not render a second interactive canvas.',
  'standby.switch': 'Switch to {surface}',
  'standby.openDefault': 'Open in default location'
} as const;

export type WebviewI18nKey = keyof typeof enWebviewMessages;
export type WebviewI18nMessages = Record<WebviewI18nKey, string>;

const zhCnWebviewMessages = {
  'surface.panel': '工作台视图',
  'surface.editor': '编辑区',
  'surface.other': '另一个宿主承载面',
  'canvas.fitView': '适应视图',
  'canvas.minimap': '画布缩略图',
  'standby.heading': '当前主画布正在{surface}中运行',
  'standby.description':
    'Dev Session Canvas 当前采用单主 surface 模型。为了避免同一个 Agent 或 Terminal 会话被两个宿主区域重复附着，这里仅保留切换入口，不再渲染第二个可交互画布。',
  'standby.switch': '切换到{surface}',
  'standby.openDefault': '按默认位置打开'
} satisfies WebviewI18nMessages;

export interface WebviewI18nBootstrap {
  locale: WebviewLocale;
  messages: WebviewI18nMessages;
}

export function resolveWebviewI18n(language: string | undefined): WebviewI18nBootstrap {
  const locale = normalizeWebviewLocale(language);
  return {
    locale,
    messages: locale === 'zh-CN' ? zhCnWebviewMessages : enWebviewMessages
  };
}

export function normalizeWebviewLocale(language: string | undefined): WebviewLocale {
  const normalized = language?.trim().toLowerCase();
  return normalized === 'zh-cn' || normalized === 'zh' ? 'zh-CN' : 'en';
}

export function formatWebviewMessage(
  messages: WebviewI18nMessages,
  key: WebviewI18nKey,
  params: Record<string, string | number> = {}
): string {
  return messages[key].replace(/\{([A-Za-z0-9_]+)\}/gu, (placeholder, name: string) => {
    const value = params[name];
    return value === undefined ? placeholder : String(value);
  });
}
