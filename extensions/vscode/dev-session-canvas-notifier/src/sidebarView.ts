import * as vscode from 'vscode';

import type { AttentionNotificationDebugRecord } from '../../../../packages/attention-protocol/src/index';
import {
  probeNotifierEnvironmentSnapshot,
  type NotifierAgentConfigurationGuide,
  type NotifierEnvironmentSnapshot,
  type NotifierExtensionModeLabel,
  type NotifierInstallRequirement,
  type NotifierPlatformGuide
} from './sidebarEnvironment';
import {
  renderSidebarRichContent,
  renderHighlightedSidebarCodeBlock,
  renderSidebarInlineCode
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

function renderSectionHtml(
  webview: vscode.Webview,
  section: NotifierSidebarSection,
  snapshot: NotifierEnvironmentSnapshot,
  ctx: SectionRenderContext
): string {
  const nonce = createNonce();
  let bodyHtml = '';

  switch (section) {
    case 'status':
      bodyHtml = renderStatusSection(snapshot, ctx);
      break;
    case 'notes':
      bodyHtml = renderNotesSection(snapshot);
      break;
    case 'macOS':
      bodyHtml = renderPlatformSection(snapshot, 'macOS');
      break;
    case 'linux':
      bodyHtml = renderPlatformSection(snapshot, 'Linux');
      break;
    case 'windows':
      bodyHtml = renderPlatformSection(snapshot, 'Windows');
      break;
    case 'codex':
      bodyHtml = renderAgentSection(snapshot, 'Codex');
      break;
    case 'claudeCode':
      bodyHtml = renderAgentSection(snapshot, 'Claude Code');
      break;
  }

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
  ${bodyHtml}
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

function renderStatusSection(
  snapshot: NotifierEnvironmentSnapshot,
  ctx: SectionRenderContext
): string {
  const hasRecentTest = ctx.latestManualAttempt?.requestedAt !== undefined;
  const notificationPosted = ctx.latestRecord?.result.status === 'posted';
  const callbackActivated = ctx.latestManualAttempt?.activatedAt !== undefined;
  const supportsCallback = activationModeSupportsCallback(resolveSidebarActivationMode(snapshot, ctx.latestRecord));

  let statusIcon: string;
  let statusTitle: string;
  let statusDetail: string;
  let cardClass = 'status-card';

  if (!hasRecentTest) {
    cardClass += ' warning';
    statusIcon = svgWarning;
    statusTitle = '尚未测试';
    statusDetail = '点击下方按钮发送一次测试通知，验证当前环境是否正常工作。';
  } else if (!notificationPosted) {
    cardClass += ' warning';
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

  const infoHtml = `
    <div class="info-list">
      <div class="info-item">
        <span class="info-label">平台</span>
        <span class="info-value">${escapeHtml(snapshot.platformLabel)}</span>
      </div>
      <div class="info-item">
        <span class="info-label">通知方式</span>
        <span class="info-value">${escapeHtml(snapshot.currentRouteLabel)}</span>
      </div>
      <div class="info-item">
        <span class="info-label">点击回跳</span>
        <span class="info-value">${escapeHtml(snapshot.activationLabel)}</span>
      </div>
      <div class="info-item">
        <span class="info-label">声音提醒</span>
        <span class="info-value">${escapeHtml(snapshot.soundLabel)}</span>
      </div>
    </div>
  `;

  return `
    <div class="content">
      ${infoHtml}
      <div class="divider"></div>
      <button class="action-button" data-command="send-test-notification">发送测试通知</button>
      <button class="action-button secondary" data-command="open-diagnostic-output">查看诊断日志</button>
      <div class="${cardClass}">
        <div class="status-card-header">
          ${statusIcon}
          <span class="status-title">${escapeHtml(statusTitle)}</span>
        </div>
        <div class="status-detail">${escapeHtml(statusDetail)}</div>
      </div>
    </div>
  `;
}

function renderNotesSection(snapshot: NotifierEnvironmentSnapshot): string {
  if (snapshot.notes.length === 0) {
    return '<div class="content"><p class="help-text">暂无注意事项。</p></div>';
  }

  const itemsHtml = snapshot.notes
    .map((note) => `<li>${renderSidebarRichContent(note, { textClassName: 'list-text' })}</li>`)
    .join('');
  return `
    <div class="content">
      <ul class="notes-list">${itemsHtml}</ul>
    </div>
  `;
}

function renderPlatformSection(snapshot: NotifierEnvironmentSnapshot, platformLabel: string): string {
  const guide = snapshot.platformGuides.find((g) => g.platformLabel === platformLabel);
  if (!guide) {
    return '<div class="content"><p class="help-text">无平台信息。</p></div>';
  }

  const isCurrent = guide.statusLabel === '当前平台';

  if (isCurrent) {
    const requirementsHtml = snapshot.installRequirements.map((req) => renderRequirementItem(req)).join('');
    return `
      <div class="content">
        <p class="badge-line"><span class="setup-badge current">当前平台</span></p>
        ${requirementsHtml}
      </div>
    `;
  }

  return `
    <div class="content">
      ${renderSidebarRichContent(guide.detail, { textClassName: 'help-text' })}
      ${renderHintList(guide.hints)}
    </div>
  `;
}

function renderRequirementItem(req: NotifierInstallRequirement): string {
  return `
    <div class="setup-item">
      <div class="setup-header">
        <span class="setup-name">${escapeHtml(req.name)}</span>
        <span class="setup-badge">${escapeHtml(req.statusLabel)}</span>
      </div>
      ${renderSidebarRichContent(req.detail, { textClassName: 'setup-detail' })}
      ${renderHintList(req.hints)}
    </div>
  `;
}

function renderAgentSection(snapshot: NotifierEnvironmentSnapshot, agentLabel: string): string {
  const guide = snapshot.agentConfigurationGuides.find((g) => g.agentLabel === agentLabel);
  if (!guide) {
    return '<div class="content"><p class="help-text">无配置信息。</p></div>';
  }

  return `
    <div class="content">
      ${renderSidebarRichContent(guide.detail, { textClassName: 'help-text' })}
      <p class="setup-detail">配置路径：${renderSidebarInlineCode(guide.configPath)}</p>
      ${renderHighlightedSidebarCodeBlock(guide.recommendedSnippet)}
      ${renderHintList(guide.hints)}
    </div>
  `;
}

function renderHintList(hints: string[] | undefined): string {
  if (!hints || hints.length === 0) {
    return '';
  }
  const itemsHtml = hints
    .map((hint) => `<li>${renderSidebarRichContent(hint, { textClassName: 'list-text' })}</li>`)
    .join('');
  return `<ul class="hint-list">${itemsHtml}</ul>`;
}

const svgWarning = '<svg class="status-icon warning" width="16" height="16" viewBox="0 0 16 16" preserveAspectRatio="xMidYMid meet" fill="currentColor"><path d="M7.56 1h.88l6.54 12.26-.44.74H1.44L1 13.26 7.56 1zM8 2.28L2.28 13H13.7L8 2.28zM8.625 12v-1h-1.25v1h1.25zm0-2V6h-1.25v4h1.25z"/></svg>';
const svgSuccess = '<svg class="status-icon success" width="16" height="16" viewBox="0 0 16 16" preserveAspectRatio="xMidYMid meet" fill="currentColor"><path d="M8 1a7 7 0 1 1 0 14A7 7 0 0 1 8 1zm3.354 4.646l-.708-.706L6.5 9.086 5.354 7.94l-.708.706 1.5 1.5.354.354.354-.354 4.5-4.5z"/></svg>';

function sectionStyles(): string {
  return `
    body {
      padding: 0;
      margin: 0;
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-foreground);
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
      background: var(--vscode-sideBarSectionHeader-border);
      margin: 12px 0;
    }

    p {
      margin: 0 0 8px 0;
      line-height: 1.4;
    }

    .badge-line {
      margin: 0 0 10px 0;
    }

    .status-card {
      padding: 10px 12px;
      background: var(--vscode-sideBarSectionHeader-background);
      border-left: 3px solid var(--vscode-testing-iconPassed);
      margin-bottom: 12px;
    }

    .status-card.warning {
      border-left-color: var(--vscode-notificationsWarningIcon-foreground);
    }

    .status-card-header {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 4px;
    }

    .status-icon {
      width: 16px;
      height: 16px;
      min-width: 16px;
      flex-shrink: 0;
    }

    .status-icon.success { color: var(--vscode-testing-iconPassed); }
    .status-icon.warning { color: var(--vscode-notificationsWarningIcon-foreground); }

    .status-title {
      font-weight: 600;
      font-size: 13px;
    }

    .status-detail {
      color: var(--vscode-descriptionForeground);
      font-size: 12px;
      line-height: 1.4;
      margin-left: 24px;
    }

    .info-list {
      display: grid;
      gap: 6px;
    }

    .info-item {
      display: grid;
      grid-template-columns: 80px 1fr;
      gap: 8px;
      font-size: 13px;
    }

    .info-label {
      color: var(--vscode-descriptionForeground);
    }

    .info-value {
      font-weight: 500;
    }

    .help-text {
      color: var(--vscode-descriptionForeground);
      font-size: 12px;
      line-height: 1.4;
      margin-bottom: 8px;
    }

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
      background: var(--vscode-button-hoverBackground);
    }

    .action-button.secondary {
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
    }

    .action-button.secondary:hover {
      background: var(--vscode-button-secondaryHoverBackground);
    }

    .setup-item {
      padding: 10px 0;
    }

    .setup-item + .setup-item {
      border-top: 1px solid var(--vscode-sideBarSectionHeader-border);
    }

    .setup-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 4px;
    }

    .setup-name {
      font-weight: 600;
      font-size: 13px;
    }

    .setup-badge {
      padding: 2px 6px;
      background: var(--vscode-badge-background);
      color: var(--vscode-badge-foreground);
      font-size: 11px;
      border-radius: 2px;
    }

    .setup-badge.current {
      background: var(--vscode-testing-iconPassed);
      color: var(--vscode-button-foreground);
    }

    .setup-detail {
      color: var(--vscode-descriptionForeground);
      font-size: 12px;
      line-height: 1.4;
    }

    .setup-detail + .setup-detail {
      margin-top: 6px;
    }

    .hint-list,
    .notes-list {
      margin: 8px 0 0 0;
      padding-left: 18px;
      color: var(--vscode-descriptionForeground);
      font-size: 12px;
      line-height: 1.5;
    }

    .hint-list li,
    .notes-list li {
      margin: 0 0 4px 0;
    }

    .hint-list li > :last-child,
    .notes-list li > :last-child {
      margin-bottom: 0;
    }

    .list-text {
      margin: 0 0 8px 0;
      color: inherit;
      font-size: inherit;
      line-height: inherit;
    }

    .snippet-block {
      margin: 8px 0 0 0;
      padding: 10px 12px;
      background: var(--sidebar-code-background);
      border: 1px solid var(--sidebar-code-border);
      border-radius: 4px;
      font-family: var(--vscode-editor-font-family);
      font-size: 12px;
      line-height: 1.5;
      white-space: pre;
      overflow-x: auto;
      overflow-y: hidden;
    }

    .snippet-block code {
      padding: 0;
      background: transparent;
      border: 0;
      font-size: inherit;
    }

    .snippet-block .hljs {
      display: block;
      color: var(--sidebar-code-foreground);
    }

    .snippet-block .hljs-comment,
    .snippet-block .hljs-quote {
      color: var(--sidebar-code-muted);
    }

    .snippet-block .hljs-keyword,
    .snippet-block .hljs-selector-tag,
    .snippet-block .hljs-meta,
    .snippet-block .hljs-built_in {
      color: var(--sidebar-code-keyword);
    }

    .snippet-block .hljs-string,
    .snippet-block .hljs-regexp,
    .snippet-block .hljs-addition {
      color: var(--sidebar-code-string);
    }

    .snippet-block .hljs-number,
    .snippet-block .hljs-literal,
    .snippet-block .hljs-symbol,
    .snippet-block .hljs-bullet {
      color: var(--sidebar-code-number);
    }

    .snippet-block .hljs-title,
    .snippet-block .hljs-section,
    .snippet-block .hljs-type,
    .snippet-block .hljs-attr,
    .snippet-block .hljs-attribute {
      color: var(--sidebar-code-attr);
    }

    .snippet-block .hljs-variable,
    .snippet-block .hljs-template-variable,
    .snippet-block .hljs-property,
    .snippet-block .hljs-link {
      color: var(--sidebar-code-variable);
    }

    .snippet-block .hljs-punctuation,
    .snippet-block .hljs-operator {
      color: var(--sidebar-code-punctuation);
    }

    .snippet-block .hljs-subst {
      color: var(--sidebar-code-foreground);
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

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function createNonce(): string {
  return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
}
