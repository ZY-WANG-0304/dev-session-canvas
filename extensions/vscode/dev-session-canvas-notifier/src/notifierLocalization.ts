export type NotifierLocale = 'en' | 'zh-CN';
export type NotifierLocalizeArgs = Record<string, string | number | boolean>;
export type NotifierLocalize = (message: string, args?: NotifierLocalizeArgs) => string;

export const identityNotifierLocalize: NotifierLocalize = (message, args) =>
  formatNotifierLocalizedMessage(message, args);

export function resolveNotifierLocale(language: string | undefined): NotifierLocale {
  const normalizedLanguage = (language ?? '').trim().toLowerCase();
  if (normalizedLanguage === 'zh-cn' || normalizedLanguage === 'zh-hans') {
    return 'zh-CN';
  }

  return 'en';
}

export function notifierHtmlLang(locale: NotifierLocale): string {
  return locale === 'zh-CN' ? 'zh-CN' : 'en';
}

export function formatNotifierLocalizedMessage(
  message: string,
  args?: NotifierLocalizeArgs
): string {
  if (!args) {
    return message;
  }

  return message.replace(/\{([A-Za-z0-9_]+)\}/g, (match, key) => {
    if (!Object.prototype.hasOwnProperty.call(args, key)) {
      return match;
    }

    return String(args[key]);
  });
}
