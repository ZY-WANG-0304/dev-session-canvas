import { useState } from 'react';
import type { MouseEvent } from 'react';

import type { MarketplaceTemplateSummary } from '@dev-session-canvas/marketplace-shared';

import { buildVSCodeInstallHref, buildVSCodeInstallHrefWithBrowserPayload } from '../lib/vscodeInstall';

interface InstallInVSCodeLinkProps {
  template: MarketplaceTemplateSummary;
  downloadHref: string;
  className: string;
  children: string;
  ariaLabel: string;
  noticeClassName?: string;
}

export function InstallInVSCodeLink({
  template,
  downloadHref,
  className,
  children,
  ariaLabel,
  noticeClassName
}: InstallInVSCodeLinkProps): JSX.Element {
  const [notice, setNotice] = useState<string | undefined>();
  const fallbackHref = buildVSCodeInstallHref(template);

  async function handleClick(event: MouseEvent<HTMLAnchorElement>): Promise<void> {
    event.preventDefault();
    setNotice('正在唤起 VSCode；如果窗口没有自动前置，请切到 VSCode 并点击 Open。');
    let href = fallbackHref;
    try {
      href = await buildVSCodeInstallHrefWithBrowserPayload(template, downloadHref);
    } catch {
      setNotice('正在使用 VSCode 直接下载安装；如果失败，可先用 JSON 入口下载。');
    }
    window.location.href = href;
  }

  return (
    <>
      <a className={className} href={fallbackHref} aria-label={ariaLabel} onClick={(event) => void handleClick(event)}>
        {children}
      </a>
      {notice ? <p className={noticeClassName ?? 'mt-2 text-xs leading-5 text-canvas-ink/55'}>{notice}</p> : null}
    </>
  );
}
