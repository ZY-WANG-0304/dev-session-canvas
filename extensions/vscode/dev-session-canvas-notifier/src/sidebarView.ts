import * as vscode from 'vscode';

import type { AttentionNotificationDebugRecord } from '../../../../packages/attention-protocol/src/index';
import {
  probeNotifierEnvironmentSnapshot,
  type NotifierAgentConfigurationGuide,
  type NotifierEnvironmentSnapshot,
  type NotifierExtensionModeLabel,
  type NotifierInstallRequirement,
  type NotifierPlatformGuide,
  type NotifierPlatformGuideSection
} from './sidebarEnvironment';
import {
  detectSidebarCodeLanguage,
  renderSidebarMarkdown
} from './sidebarRichText';
import { activationModeSupportsCallback, resolveSidebarActivationMode } from './sidebarStatus';

export interface NotifierSidebarLatestAttempt {
  requestedAt: string;
  activatedAt?: string;
}

interface NotifierSidebarCallbacks {
  getModeLabel: () => NotifierExtensionModeLabel;
  getPlaySoundEnabled: () => boolean;
  getLatestRecord: () => AttentionNotificationDebugRecord | undefined;
  getLatestManualAttempt: () => NotifierSidebarLatestAttempt | undefined;
  sendTestNotification: () => Promise<void>;
  openDiagnosticOutput: () => void;
}

export type NotifierSidebarSection = 'status' | 'notes' | 'macOS' | 'linux' | 'windows' | 'codex' | 'claudeCode';

export const NOTIFIER_SIDEBAR_VIEW_IDS: Record<NotifierSidebarSection, string> = {
  status: 'devSessionCanvasNotifier.status',
  notes: 'devSessionCanvasNotifier.notes',
  macOS: 'devSessionCanvasNotifier.macOS',
  linux: 'devSessionCanvasNotifier.linux',
  windows: 'devSessionCanvasNotifier.windows',
  codex: 'devSessionCanvasNotifier.codex',
  claudeCode: 'devSessionCanvasNotifier.claudeCode'
};

export class NotifierSidebarViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  private readonly sectionViews = new Map<NotifierSidebarSection, vscode.WebviewView>();

  public constructor(private readonly callbacks: NotifierSidebarCallbacks) {}

  public resolveWebviewView(webviewView: vscode.WebviewView): void {
    const section = this.resolveSection(webviewView.viewType);
    if (!section) {
      return;
    }

    this.sectionViews.set(section, webviewView);
    webviewView.webview.options = { enableScripts: true };

    this.disposables.push(
      webviewView.webview.onDidReceiveMessage(async (message) => {
        if (message?.command === 'send-test-notification') {
          await this.callbacks.sendTestNotification();
          await this.refresh();
          return;
        }
        if (message?.command === 'open-diagnostic-output') {
          this.callbacks.openDiagnosticOutput();
        }
      }),
      webviewView.onDidChangeVisibility(() => {
        if (webviewView.visible) {
          void this.refreshSection(section);
        }
      })
    );

    void this.refreshSection(section);
  }

  public async refresh(): Promise<void> {
    if (this.sectionViews.size === 0) {
      return;
    }

    const snapshot = await this.probeSnapshot();
    for (const section of this.sectionViews.keys()) {
      this.renderSection(section, snapshot);
    }
  }

  public dispose(): void {
    this.disposables.splice(0).forEach((d) => d.dispose());
  }

  private async refreshSection(section: NotifierSidebarSection): Promise<void> {
    if (!this.sectionViews.has(section)) {
      return;
    }

    const snapshot = await this.probeSnapshot();
    this.renderSection(section, snapshot);
  }

  private renderSection(section: NotifierSidebarSection, snapshot: NotifierEnvironmentSnapshot): void {
    const view = this.sectionViews.get(section);
    if (!view) {
      return;
    }
    view.webview.html = renderSectionHtml(view.webview, section, snapshot, {
      latestRecord: this.callbacks.getLatestRecord(),
      latestManualAttempt: this.callbacks.getLatestManualAttempt()
    });
  }

  private async probeSnapshot(): Promise<NotifierEnvironmentSnapshot> {
    return probeNotifierEnvironmentSnapshot(
      process.platform,
      this.callbacks.getModeLabel(),
      this.callbacks.getPlaySoundEnabled()
    );
  }

  private resolveSection(viewType: string): NotifierSidebarSection | undefined {
    for (const [section, id] of Object.entries(NOTIFIER_SIDEBAR_VIEW_IDS)) {
      if (id === viewType) {
        return section as NotifierSidebarSection;
      }
    }
    return undefined;
  }
}

interface SectionRenderContext {
  latestRecord: AttentionNotificationDebugRecord | undefined;
  latestManualAttempt: NotifierSidebarLatestAttempt | undefined;
}

interface SidebarSectionAction {
  command: 'send-test-notification' | 'open-diagnostic-output';
  label: string;
  tone?: 'primary' | 'secondary';
}

interface SidebarSectionCallout {
  iconSvg: string;
  markdown: string;
  markdownClassName?: string;
  tone?: 'default' | 'warning';
}

interface SidebarSectionContent {
  markdown: string;
  markdownClassName?: string;
  actionsMarkdown?: string;
  actions?: SidebarSectionAction[];
  calloutHeadingMarkdown?: string;
  callout?: SidebarSectionCallout;
}

function renderSectionHtml(
  webview: vscode.Webview,
  section: NotifierSidebarSection,
  snapshot: NotifierEnvironmentSnapshot,
  ctx: SectionRenderContext
): string {
  const nonce = createNonce();
  const content = resolveSectionContent(section, snapshot, ctx);

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <style>${sectionStyles()}</style>
</head>
<body>
  ${renderSectionContentBody(content)}
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    document.querySelectorAll('[data-command]').forEach(btn => {
      btn.addEventListener('click', () => {
        vscode.postMessage({ command: btn.dataset.command });
      });
    });
  </script>
</body>
</html>`;
}

function resolveSectionContent(
  section: NotifierSidebarSection,
  snapshot: NotifierEnvironmentSnapshot,
  ctx: SectionRenderContext
): SidebarSectionContent {
  switch (section) {
    case 'status':
      return buildStatusSectionContent(snapshot, ctx);
    case 'notes':
      return buildNotesSectionContent(snapshot);
    case 'macOS':
      return buildPlatformSectionContent(snapshot, 'macOS');
    case 'linux':
      return buildPlatformSectionContent(snapshot, 'Linux');
    case 'windows':
      return buildPlatformSectionContent(snapshot, 'Windows');
    case 'codex':
      return buildAgentSectionContent(snapshot, 'Codex');
    case 'claudeCode':
      return buildAgentSectionContent(snapshot, 'Claude Code');
  }
}

function renderSectionContentBody(content: SidebarSectionContent): string {
  const markdownHtml = renderMarkdownPreview(content.markdown, content.markdownClassName);
  const actionsMarkdownHtml = content.actionsMarkdown ? renderMarkdownPreview(content.actionsMarkdown) : '';
  const actionsHtml = content.actions?.map((action) => renderSectionActionButton(action)).join('') ?? '';
  const calloutHeadingHtml = content.calloutHeadingMarkdown ? renderMarkdownPreview(content.calloutHeadingMarkdown) : '';
  const calloutHtml = content.callout ? renderSectionCallout(content.callout) : '';
  const dividerHtml = actionsHtml.length > 0 ? '<div class="divider"></div>' : '';

  return `
    <div class="content">
      ${markdownHtml}
      ${dividerHtml}
      ${actionsMarkdownHtml}
      ${actionsHtml}
      ${calloutHeadingHtml}
      ${calloutHtml}
    </div>
  `;
}

function renderSectionActionButton(action: SidebarSectionAction): string {
  const secondaryClassName = action.tone === 'secondary' ? ' secondary' : '';
  return `<button class="action-button${secondaryClassName}" data-command="${action.command}">${action.label}</button>`;
}

function renderSectionCallout(callout: SidebarSectionCallout): string {
  const toneClassName = callout.tone === 'warning' ? ' warning' : '';
  return `
    <div class="status-card${toneClassName}">
      <div class="status-card-body">
        ${callout.iconSvg}
        ${renderMarkdownPreview(callout.markdown, callout.markdownClassName)}
      </div>
    </div>
  `;
}

function buildStatusSectionContent(
  snapshot: NotifierEnvironmentSnapshot,
  ctx: SectionRenderContext
): SidebarSectionContent {
  const hasRecentTest = ctx.latestManualAttempt?.requestedAt !== undefined;
  const notificationPosted = ctx.latestRecord?.result.status === 'posted';
  const callbackActivated = ctx.latestManualAttempt?.activatedAt !== undefined;
  const supportsCallback = activationModeSupportsCallback(resolveSidebarActivationMode(snapshot, ctx.latestRecord));

  let statusIcon: string;
  let statusTitle: string;
  let statusDetail: string;
  let calloutTone: SidebarSectionCallout['tone'] = 'default';

  if (!hasRecentTest) {
    calloutTone = 'warning';
    statusIcon = svgWarning;
    statusTitle = '尚未测试';
    statusDetail = '点击下方按钮发送一次测试通知，验证当前环境是否正常工作。';
  } else if (!notificationPosted) {
    calloutTone = 'warning';
    statusIcon = svgWarning;
    statusTitle = '通知发送失败';
    statusDetail = ctx.latestRecord?.result.detail || '通知未能成功发送，请查看诊断日志了解详情。';
  } else if (supportsCallback && !callbackActivated) {
    statusIcon = svgSuccess;
    statusTitle = '通知已发送';
    statusDetail = '桌面通知已弹出。点击通知可验证回跳功能是否正常。';
  } else {
    statusIcon = svgSuccess;
    statusTitle = '通知功能正常';
    statusDetail = supportsCallback && callbackActivated
      ? '通知发送与点击回跳均已验证通过。'
      : '通知已成功发送。当前环境不支持点击回跳。';
  }

  return {
    markdown: buildStatusSummaryMarkdown(snapshot),
    markdownClassName: 'is-prominent',
    actionsMarkdown: buildStatusActionsMarkdown(),
    actions: [
      {
        command: 'send-test-notification',
        label: '发送测试通知'
      },
      {
        command: 'open-diagnostic-output',
        label: '查看诊断日志',
        tone: 'secondary'
      }
    ],
    calloutHeadingMarkdown: buildStatusResultHeadingMarkdown(),
    callout: {
      iconSvg: statusIcon,
      markdown: buildStatusCardMarkdown(statusTitle, statusDetail),
      markdownClassName: 'is-card',
      tone: calloutTone
    }
  };
}

function buildNotesSectionContent(snapshot: NotifierEnvironmentSnapshot): SidebarSectionContent {
  return {
    markdown: snapshot.notes.length > 0 ? buildNotesMarkdown(snapshot.notes) : '暂无注意事项。',
    markdownClassName: 'is-flush-list'
  };
}

function buildPlatformSectionContent(
  snapshot: NotifierEnvironmentSnapshot,
  platformLabel: string
): SidebarSectionContent {
  const guide = snapshot.platformGuides.find((g) => g.platformLabel === platformLabel);
  if (!guide) {
    return {
      markdown: '无平台信息。'
    };
  }

  return {
    markdown: buildPlatformGuideMarkdown(snapshot, guide, guide.statusLabel === '当前平台')
  };
}

function buildAgentSectionContent(
  snapshot: NotifierEnvironmentSnapshot,
  agentLabel: string
): SidebarSectionContent {
  const guide = snapshot.agentConfigurationGuides.find((g) => g.agentLabel === agentLabel);
  if (!guide) {
    return {
      markdown: '无配置信息。'
    };
  }

  return {
    markdown: buildAgentGuideMarkdown(guide)
  };
}

function renderMarkdownPreview(markdown: string, className?: string): string {
  return renderSidebarMarkdown(markdown, {
    rootClassName: ['sidebar-markdown', className].filter(Boolean).join(' ')
  });
}

function buildBulletListMarkdown(items: string[]): string {
  return items.map((item) => `- ${item}`).join('\n');
}

function buildNotesMarkdown(notes: string[]): string {
  return buildBulletListMarkdown(notes);
}

function buildStatusSummaryMarkdown(snapshot: NotifierEnvironmentSnapshot): string {
  return [
    '### 当前环境',
    '',
    `- **平台：** ${snapshot.platformLabel}`,
    `- **通知方式：** ${snapshot.currentRouteLabel}`,
    `- **点击回跳：** ${snapshot.activationLabel}`,
    `- **声音提醒：** ${snapshot.soundLabel}`
  ].join('\n');
}

function buildStatusCardMarkdown(statusTitle: string, statusDetail: string): string {
  return [`**${statusTitle}**`, '', statusDetail].join('\n');
}

function buildStatusActionsMarkdown(): string {
  return '### 调试通知';
}

function buildStatusResultHeadingMarkdown(): string {
  return '### 调试结果';
}

function buildPlatformGuideMarkdown(
  snapshot: NotifierEnvironmentSnapshot,
  guide: NotifierPlatformGuide,
  isCurrent: boolean
): string {
  if (isCurrent) {
    const sections = ['**当前平台**'];
    for (const requirement of snapshot.installRequirements) {
      sections.push(buildInstallRequirementMarkdown(requirement));
    }
    return sections.join('\n\n');
  }

  const sections = [guide.detail];
  if (guide.sections) {
    for (const section of guide.sections) {
      sections.push(buildPlatformGuideSectionMarkdown(section));
    }
  }
  if (guide.hints.length > 0) {
    sections.push(buildBulletListMarkdown(guide.hints));
  }
  return sections.join('\n\n');
}

function buildInstallRequirementMarkdown(req: NotifierInstallRequirement): string {
  const sections = [`### ${req.name}`, '', `**状态：** ${req.statusLabel}`, '', req.detail];
  if (req.hints?.length) {
    sections.push('', buildBulletListMarkdown(req.hints));
  }
  return sections.join('\n');
}

function buildPlatformGuideSectionMarkdown(section: NotifierPlatformGuideSection): string {
  const parts = [`### ${section.title}`, '', section.detail];
  if (section.hints?.length) {
    parts.push('', buildBulletListMarkdown(section.hints));
  }
  return parts.join('\n');
}

function buildAgentGuideMarkdown(guide: NotifierAgentConfigurationGuide): string {
  const language = detectSidebarCodeLanguage(guide.recommendedSnippet);
  const parts = [guide.detail, '', `配置路径：\`${guide.configPath}\``, ''];
  if (language) {
    parts.push(`\`\`\`${language}`);
  } else {
    parts.push('```');
  }
  parts.push(guide.recommendedSnippet, '```');
  if (guide.hints.length > 0) {
    parts.push('', buildBulletListMarkdown(guide.hints));
  }
  return parts.join('\n');
}

const svgWarning = '<svg class="status-icon warning" width="16" height="16" viewBox="0 0 16 16" preserveAspectRatio="xMidYMid meet" fill="currentColor"><path d="M7.56 1h.88l6.54 12.26-.44.74H1.44L1 13.26 7.56 1zM8 2.28L2.28 13H13.7L8 2.28zM8.625 12v-1h-1.25v1h1.25zm0-2V6h-1.25v4h1.25z"/></svg>';
const svgSuccess = '<svg class="status-icon success" width="16" height="16" viewBox="0 0 16 16" preserveAspectRatio="xMidYMid meet" fill="currentColor"><path d="M8 1a7 7 0 1 1 0 14A7 7 0 0 1 8 1zm3.354 4.646l-.708-.706L6.5 9.086 5.354 7.94l-.708.706 1.5 1.5.354.354.354-.354 4.5-4.5z"/></svg>';

function sectionStyles(): string {
  return `
    body {
      --notifier-sidebar-border: var(
        --vscode-sideBarSectionHeader-border,
        var(--vscode-widget-border, var(--vscode-panel-border, transparent))
      );
      padding: 0;
      margin: 0;
      background: var(--vscode-sideBar-background, var(--vscode-editor-background));
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-foreground, var(--vscode-sideBar-foreground, var(--vscode-editor-foreground)));
      --sidebar-code-foreground: var(--vscode-editor-foreground, var(--vscode-foreground));
      --sidebar-code-muted: var(--vscode-descriptionForeground, rgba(128, 128, 128, 0.9));
      --sidebar-code-keyword: #b57edc;
      --sidebar-code-string: #7fdc8a;
      --sidebar-code-number: #64d2ff;
      --sidebar-code-attr: #79c0ff;
      --sidebar-code-variable: #ffd580;
      --sidebar-code-punctuation: rgba(255, 255, 255, 0.88);
      --sidebar-code-background: var(
        --vscode-editorWidget-background,
        var(--vscode-textCodeBlock-background, rgba(255, 255, 255, 0.04))
      );
      --sidebar-code-border: var(--vscode-widget-border, rgba(255, 255, 255, 0.08));
    }

    body.vscode-light {
      --sidebar-code-keyword: #9b26b6;
      --sidebar-code-string: #1a7f37;
      --sidebar-code-number: #0b84c6;
      --sidebar-code-attr: #005fb8;
      --sidebar-code-variable: #8b5a00;
      --sidebar-code-punctuation: rgba(36, 41, 46, 0.72);
      --sidebar-code-background: var(
        --vscode-editorWidget-background,
        var(--vscode-textCodeBlock-background, rgba(15, 23, 42, 0.04))
      );
      --sidebar-code-border: var(--vscode-widget-border, rgba(15, 23, 42, 0.12));
    }

    body.vscode-high-contrast,
    body.vscode-high-contrast-light {
      --sidebar-code-keyword: #d59dff;
      --sidebar-code-string: #8ae234;
      --sidebar-code-number: #66d9ef;
      --sidebar-code-attr: #8cc6ff;
      --sidebar-code-variable: #ffd75e;
      --sidebar-code-punctuation: var(--sidebar-code-foreground);
    }

    .content {
      padding: 12px 14px;
    }

    .divider {
      height: 1px;
      background: var(--notifier-sidebar-border);
      margin: 12px 0;
    }

    p {
      margin: 0 0 8px 0;
      line-height: 1.4;
    }

    .status-card {
      padding: 10px 12px;
      background: var(--vscode-sideBarSectionHeader-background);
      border-left: 3px solid var(--vscode-testing-iconPassed);
      margin-top: 12px;
    }

    .status-card.warning {
      border-left-color: var(--vscode-notificationsWarningIcon-foreground);
    }

    .status-card-body {
      display: flex;
      align-items: flex-start;
      gap: 8px;
    }

    .status-icon {
      width: 16px;
      height: 16px;
      min-width: 16px;
      flex-shrink: 0;
    }

    .status-icon.success { color: var(--vscode-testing-iconPassed); }
    .status-icon.warning { color: var(--vscode-notificationsWarningIcon-foreground); }

    .action-button {
      width: 100%;
      padding: 6px 12px;
      margin-bottom: 8px;
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none;
      cursor: pointer;
      font-family: var(--vscode-font-family);
      font-size: 13px;
      text-align: center;
    }

    .action-button:hover {
      background: var(--vscode-button-hoverBackground, var(--vscode-button-background));
    }

    .action-button.secondary {
      background: var(--vscode-button-secondaryBackground, var(--vscode-button-background));
      color: var(--vscode-button-secondaryForeground, var(--vscode-button-foreground));
    }

    .action-button.secondary:hover {
      background: var(
        --vscode-button-secondaryHoverBackground,
        var(--vscode-button-hoverBackground, var(--vscode-button-secondaryBackground, var(--vscode-button-background)))
      );
    }

    .sidebar-markdown {
      color: var(--vscode-descriptionForeground);
      font-size: 12px;
      line-height: 1.5;
    }

    .sidebar-markdown.is-prominent {
      color: var(--vscode-foreground, var(--vscode-sideBar-foreground, var(--vscode-editor-foreground)));
      font-size: 13px;
    }

    .sidebar-markdown.is-card {
      color: inherit;
    }

    .sidebar-markdown.is-flush-list > ul,
    .sidebar-markdown.is-flush-list > ol {
      padding-left: 0;
    }

    .status-card-body .sidebar-markdown {
      flex: 1;
      min-width: 0;
    }

    .sidebar-markdown > :first-child {
      margin-top: 0;
    }

    .sidebar-markdown > :last-child {
      margin-bottom: 0;
    }

    .sidebar-markdown p,
    .sidebar-markdown ul,
    .sidebar-markdown ol,
    .sidebar-markdown pre,
    .sidebar-markdown blockquote,
    .sidebar-markdown h1,
    .sidebar-markdown h2,
    .sidebar-markdown h3,
    .sidebar-markdown h4,
    .sidebar-markdown h5,
    .sidebar-markdown h6 {
      margin: 0 0 8px 0;
    }

    .sidebar-markdown strong {
      color: var(--vscode-foreground, var(--vscode-sideBar-foreground, var(--vscode-editor-foreground)));
    }

    .sidebar-markdown h1,
    .sidebar-markdown h2,
    .sidebar-markdown h3,
    .sidebar-markdown h4,
    .sidebar-markdown h5,
    .sidebar-markdown h6 {
      color: var(--vscode-foreground, var(--vscode-sideBar-foreground, var(--vscode-editor-foreground)));
      font-family: var(--vscode-editor-font-family);
      font-size: 13px;
      font-weight: 700;
      line-height: 1.35;
    }

    .sidebar-markdown > ul,
    .sidebar-markdown > ol {
      padding-left: 12px;
    }

    .sidebar-markdown ul ul,
    .sidebar-markdown ul ol,
    .sidebar-markdown ol ul,
    .sidebar-markdown ol ol {
      padding-left: 16px;
      margin-top: 4px;
    }

    .sidebar-markdown li + li {
      margin-top: 4px;
    }

    .sidebar-markdown li > p {
      margin-bottom: 0;
    }

    .sidebar-markdown blockquote {
      padding-left: 10px;
      border-left: 2px solid var(--notifier-sidebar-border);
    }

    .sidebar-markdown a {
      color: var(--vscode-textLink-foreground, var(--vscode-focusBorder));
      text-decoration: none;
    }

    .sidebar-markdown a:hover {
      text-decoration: underline;
    }

    .sidebar-markdown a[href=""] {
      color: inherit;
      text-decoration: none;
      pointer-events: none;
    }

    .sidebar-markdown pre {
      margin: 8px 0 0 0;
      padding: 10px 12px;
      border-radius: 8px;
      background: var(
        --vscode-textCodeBlock-background,
        color-mix(in srgb, var(--vscode-editor-background) 88%, var(--vscode-panel-border) 12%)
      );
      font-family: var(--vscode-editor-font-family);
      font-size: 12px;
      line-height: 1.5;
      overflow: auto;
    }

    .sidebar-markdown pre code {
      padding: 0;
      background: transparent;
      border: 0;
      font-size: inherit;
    }

    .sidebar-markdown .hljs {
      display: block;
      color: var(--vscode-editor-foreground);
    }

    .sidebar-markdown .hljs-comment,
    .sidebar-markdown .hljs-quote {
      color: var(--sidebar-code-muted);
    }

    .sidebar-markdown .hljs-keyword,
    .sidebar-markdown .hljs-selector-tag,
    .sidebar-markdown .hljs-meta,
    .sidebar-markdown .hljs-built_in {
      color: var(--sidebar-code-keyword);
    }

    .sidebar-markdown .hljs-string,
    .sidebar-markdown .hljs-regexp,
    .sidebar-markdown .hljs-addition {
      color: var(--sidebar-code-string);
    }

    .sidebar-markdown .hljs-number,
    .sidebar-markdown .hljs-literal,
    .sidebar-markdown .hljs-symbol,
    .sidebar-markdown .hljs-bullet {
      color: var(--sidebar-code-number);
    }

    .sidebar-markdown .hljs-title,
    .sidebar-markdown .hljs-section,
    .sidebar-markdown .hljs-type,
    .sidebar-markdown .hljs-attr,
    .sidebar-markdown .hljs-attribute {
      color: var(--sidebar-code-attr);
    }

    .sidebar-markdown .hljs-variable,
    .sidebar-markdown .hljs-template-variable,
    .sidebar-markdown .hljs-property,
    .sidebar-markdown .hljs-link {
      color: var(--sidebar-code-variable);
    }

    .sidebar-markdown .hljs-punctuation,
    .sidebar-markdown .hljs-operator {
      color: var(--sidebar-code-punctuation);
    }

    .sidebar-markdown .hljs-subst {
      color: var(--vscode-editor-foreground);
    }

    .inline-code {
      display: inline-block;
      font-family: var(--vscode-editor-font-family);
      color: var(--vscode-textPreformat-foreground, var(--vscode-editor-foreground));
      background: var(--vscode-textCodeBlock-background, rgba(127, 127, 127, 0.1));
      border: 1px solid var(--vscode-widget-border, rgba(127, 127, 127, 0.25));
      padding: 1px 6px;
      border-radius: 4px;
      font-size: 12px;
      line-height: 1.4;
      white-space: nowrap;
      vertical-align: baseline;
    }
  `;
}

function createNonce(): string {
  return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
}
