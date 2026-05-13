import { useState } from 'react';
import type { MouseEvent } from 'react';

import type { MarketplaceTemplateSummary } from '@dev-session-canvas/marketplace-shared';

import { buildVSCodeInstallHref } from '../lib/vscodeInstall';

interface InstallInVSCodeLinkProps {
  template: MarketplaceTemplateSummary;
  className: string;
  children: string;
  ariaLabel: string;
  noticeClassName?: string;
}

export function InstallInVSCodeLink({
  template,
  className,
  children,
  ariaLabel,
  noticeClassName
}: InstallInVSCodeLinkProps): JSX.Element {
  const [notice, setNotice] = useState<string | undefined>();
  const fallbackHref = buildVSCodeInstallHref(template);

  function handleClick(event: MouseEvent<HTMLAnchorElement>): void {
    event.preventDefault();
    setNotice('正在唤起 VS Code；如果窗口没有自动前置，请手动切换到 VS Code 并在模板详情页完成安装。');
    window.location.href = fallbackHref;
  }

  return (
    <>
      <a className={className} href={fallbackHref} aria-label={ariaLabel} onClick={handleClick}>
        {children}
      </a>
      {notice ? <p className={noticeClassName ?? 'mt-2 text-xs leading-5 text-canvas-ink/55'}>{notice}</p> : null}
    </>
  );
}
