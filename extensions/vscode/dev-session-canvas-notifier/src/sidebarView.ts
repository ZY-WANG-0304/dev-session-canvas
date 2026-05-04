import * as vscode from 'vscode';

import type {
  AttentionNotificationActivationMode,
  AttentionNotificationDebugRecord
} from '../../../../packages/attention-protocol/src/index';
import {
  probeNotifierEnvironmentSnapshot,
  type NotifierEnvironmentSnapshot,
  type NotifierExtensionModeLabel
} from './sidebarEnvironment';

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

export class NotifierSidebarViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  public static readonly viewType = 'devSessionCanvasNotifier.sidebar';

  private readonly disposables: vscode.Disposable[] = [];
  private view: vscode.WebviewView | undefined;

  public constructor(private readonly callbacks: NotifierSidebarCallbacks) {}

  public resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true
    };

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
          void this.refresh();
        }
      })
    );

    void this.refresh();
  }

  public async refresh(): Promise<void> {
    if (!this.view) {
      return;
    }

    const snapshot = await probeNotifierEnvironmentSnapshot(
      process.platform,
      this.callbacks.getModeLabel(),
      this.callbacks.getPlaySoundEnabled()
    );
    this.view.webview.html = renderSidebarHtml(
      this.view.webview,
      snapshot,
      this.callbacks.getLatestRecord(),
      this.callbacks.getLatestManualAttempt()
    );
  }

  public dispose(): void {
    this.disposables.splice(0).forEach((disposable) => disposable.dispose());
  }
}

function renderSidebarHtml(
  webview: vscode.Webview,
  snapshot: NotifierEnvironmentSnapshot,
  latestRecord: AttentionNotificationDebugRecord | undefined,
  latestManualAttempt: NotifierSidebarLatestAttempt | undefined
): string {
  const nonce = createNonce();
  const statusHtml = renderNotificationStatus(snapshot, latestRecord, latestManualAttempt);
  const environmentHtml = renderEnvironmentInfo(snapshot);
  const setupHtml = renderSetupGuidance(snapshot);

  return `<!DOCTYPE html>
  <html lang="zh-CN">
    <head>
      <meta charset="UTF-8" />
      <meta
        http-equiv="Content-Security-Policy"
        content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';"
      />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>通知设置</title>
      <style>
        body {
          padding: 0;
          margin: 0;
          font-family: var(--vscode-font-family);
          font-size: var(--vscode-font-size);
          color: var(--vscode-foreground);
        }

        .section {
          padding: 12px 20px;
        }

        .section + .section {
          border-top: 1px solid var(--vscode-sideBarSectionHeader-border);
        }

        h2 {
          margin: 0 0 12px 0;
          font-size: 11px;
          font-weight: 600;
          text-transform: uppercase;
          color: var(--vscode-sideBarTitle-foreground);
        }

        p {
          margin: 0 0 8px 0;
          line-height: 1.4;
        }

        .status-card {
          padding: 12px;
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
          margin-bottom: 6px;
        }

        .status-icon {
          width: 16px;
          height: 16px;
          min-width: 16px;
          min-height: 16px;
          flex-shrink: 0;
        }

        .status-icon.success {
          color: var(--vscode-testing-iconPassed);
        }

        .status-icon.warning {
          color: var(--vscode-notificationsWarningIcon-foreground);
        }

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
          gap: 8px;
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
          margin-bottom: 12px;
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
          padding: 8px 0;
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

        .setup-detail {
          color: var(--vscode-descriptionForeground);
          font-size: 12px;
          line-height: 1.4;
        }

        .code {
          font-family: var(--vscode-editor-font-family);
          background: var(--vscode-textCodeBlock-background);
          padding: 2px 4px;
          border-radius: 3px;
          font-size: 12px;
        }
      </style>
    </head>
    <body>
      <div class="section">
        <h2>系统环境</h2>
        ${environmentHtml}
      </div>

      <div class="section">
        <h2>快速操作</h2>
        <p class="help-text">点击下方按钮测试通知功能，或查看详细的诊断日志排查问题。</p>
        <button class="action-button" data-command="send-test-notification">发送测试通知</button>
        <button class="action-button secondary" data-command="open-diagnostic-output">查看诊断日志</button>
      </div>

      <div class="section">
        <h2>通知状态</h2>
        ${statusHtml}
      </div>

      ${setupHtml}

      <script nonce="${nonce}">
        const vscode = acquireVsCodeApi();
        document.querySelectorAll('[data-command]').forEach(button => {
          button.addEventListener('click', () => {
            vscode.postMessage({ command: button.dataset.command });
          });
        });
      </script>
    </body>
  </html>`;
}

function renderNotificationStatus(
  snapshot: NotifierEnvironmentSnapshot,
  latestRecord: AttentionNotificationDebugRecord | undefined,
  latestManualAttempt: NotifierSidebarLatestAttempt | undefined
): string {
  const hasRecentTest = latestManualAttempt?.requestedAt !== undefined;
  const notificationPosted = latestRecord?.result.status === 'posted';
  const callbackActivated = latestManualAttempt?.activatedAt !== undefined;
  const supportsCallback = snapshot.activationLabel === 'protocol' || snapshot.activationLabel === 'direct-action';

  let statusIcon = '';
  let statusTitle = '';
  let statusDetail = '';
  let cardClass = 'status-card';

  if (!hasRecentTest) {
    cardClass += ' warning';
    statusIcon = '<svg class="status-icon warning" width="16" height="16" viewBox="0 0 16 16" preserveAspectRatio="xMidYMid meet" fill="currentColor"><path d="M7.56 1h.88l6.54 12.26-.44.74H1.44L1 13.26 7.56 1zM8 2.28L2.28 13H13.7L8 2.28zM8.625 12v-1h-1.25v1h1.25zm0-2V6h-1.25v4h1.25z"/></svg>';
    statusTitle = '尚未测试';
    statusDetail = '建议先发送一次测试通知，验证当前环境的通知功能是否正常。';
  } else if (!notificationPosted) {
    cardClass += ' warning';
    statusIcon = '<svg class="status-icon warning" width="16" height="16" viewBox="0 0 16 16" preserveAspectRatio="xMidYMid meet" fill="currentColor"><path d="M7.56 1h.88l6.54 12.26-.44.74H1.44L1 13.26 7.56 1zM8 2.28L2.28 13H13.7L8 2.28zM8.625 12v-1h-1.25v1h1.25zm0-2V6h-1.25v4h1.25z"/></svg>';
    statusTitle = '通知发送失败';
    statusDetail = latestRecord?.result.detail || '通知未能成功发送，请查看诊断日志了解详情。';
  } else if (supportsCallback && !callbackActivated) {
    statusIcon = '<svg class="status-icon success" width="16" height="16" viewBox="0 0 16 16" preserveAspectRatio="xMidYMid meet" fill="currentColor"><path d="M8 1a7 7 0 1 1 0 14A7 7 0 0 1 8 1zm3.354 4.646l-.708-.706L6.5 9.086 5.354 7.94l-.708.706 1.5 1.5.354.354.354-.354 4.5-4.5z"/></svg>';
    statusTitle = '通知已发送';
    statusDetail = '桌面通知已成功弹出，点击通知可验证回跳功能。';
  } else {
    statusIcon = '<svg class="status-icon success" width="16" height="16" viewBox="0 0 16 16" preserveAspectRatio="xMidYMid meet" fill="currentColor"><path d="M8 1a7 7 0 1 1 0 14A7 7 0 0 1 8 1zm3.354 4.646l-.708-.706L6.5 9.086 5.354 7.94l-.708.706 1.5 1.5.354.354.354-.354 4.5-4.5z"/></svg>';
    statusTitle = '通知功能正常';
    if (supportsCallback && callbackActivated) {
      statusDetail = '通知已成功发送并接收回跳，功能完整可用。';
    } else {
      statusDetail = '通知已成功发送，当前环境不支持点击回跳。';
    }
  }

  return `
    <div class="${cardClass}">
      <div class="status-card-header">
        ${statusIcon}
        <span class="status-title">${escapeHtml(statusTitle)}</span>
      </div>
      <div class="status-detail">${escapeHtml(statusDetail)}</div>
    </div>
  `;
}

function renderEnvironmentInfo(snapshot: NotifierEnvironmentSnapshot): string {
  const canClickToReturn = snapshot.activationLabel === 'protocol' || snapshot.activationLabel === 'direct-action';
  const clickSupportText = canClickToReturn ? '支持' : '不支持';

  let routeDescription = '';
  if (snapshot.modeLabel === 'test') {
    routeDescription = '测试模式，通知不会触达真实系统';
  } else {
    routeDescription = snapshot.currentRouteDetail;
  }

  return `
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
        <span class="info-value">${escapeHtml(clickSupportText)}</span>
      </div>
      <div class="info-item">
        <span class="info-label">声音提醒</span>
        <span class="info-value">${escapeHtml(snapshot.soundLabel)}</span>
      </div>
    </div>
    <p class="help-text" style="margin-top: 12px;">${escapeHtml(routeDescription)}</p>
    <p class="help-text">${escapeHtml(snapshot.soundDetail)}</p>
  `;
}

function renderSetupGuidance(snapshot: NotifierEnvironmentSnapshot): string {
  const needsSetup = snapshot.installRequirements.some(
    (req) => req.statusLabel === '未检测到' || req.statusLabel === '未支持'
  );

  if (!needsSetup) {
    return '';
  }

  const itemsHtml = snapshot.installRequirements
    .filter((req) => req.statusLabel === '未检测到' || req.statusLabel === '未支持')
    .map(
      (req) => `
      <div class="setup-item">
        <div class="setup-header">
          <span class="setup-name">${escapeHtml(req.name)}</span>
          <span class="setup-badge">${escapeHtml(req.statusLabel)}</span>
        </div>
        <p class="setup-detail">${escapeHtml(req.detail)}</p>
        ${req.installHint ? `<p class="setup-detail">${formatInstallHint(req.installHint)}</p>` : ''}
      </div>
    `
    )
    .join('');

  return `
    <div class="section">
      <h2>需要安装</h2>
      ${itemsHtml}
    </div>
  `;
}

function formatInstallHint(hint: string): string {
  const commandMatch = hint.match(/(brew install|apt install|sudo apt install)\s+([^\s.]+)/);
  if (commandMatch) {
    const [, cmd, pkg] = commandMatch;
    return `安装命令：<span class="code">${escapeHtml(`${cmd} ${pkg}`)}</span>`;
  }
  return escapeHtml(hint);
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
