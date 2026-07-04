import * as vscode from 'vscode';

import {
  buildCanvasTemplateNodeDetailLines,
  formatCanvasTemplateStats,
  type CanvasTemplate
} from '../common/canvasTemplates';
import { COMMAND_IDS } from '../common/extensionIdentity';
import { getVersionedWebviewResourceUri } from '../common/webviewResourceUri';
import { CanvasPanelManager } from '../panel/CanvasPanelManager';
import { localizeCanvasTemplateStoreIssue } from '../panel/canvasTemplateLocalization';
import type { CanvasTemplateCatalog } from '../panel/CanvasTemplateStore';
import type {
  TemplateMarketplaceClient,
  TemplateMarketplaceInstalledTemplateUpdateSummary
} from '../panel/TemplateMarketplaceClient';

const SIDEBAR_BUNDLED_CODICON_PATH_SEGMENTS = ['dist', 'sidebar-codicon.css'] as const;

interface CanvasSidebarTemplateMarketplaceOptions {
  client: TemplateMarketplaceClient;
  openTemplateDetail: (
    templateIdOrSlug: string,
    versionId?: string,
    sourceUrl?: URL,
    options?: { refreshList?: boolean }
  ) => void;
}

export interface CanvasSidebarMarketplaceTemplateSnapshot {
  marketTemplateId: string;
  marketTemplateSlug?: string;
  marketVersionId: string;
  installedVersionNumber: number;
  latestVersionId?: string;
  latestVersionNumber?: number;
  updateAvailable: boolean;
  updateCheckError?: string;
  sourceUrl: string;
}

export interface CanvasSidebarTemplateItemSnapshot {
  id: string;
  templateId: string;
  name: string;
  category: CanvasTemplate['category'];
  sourceKind: 'builtin' | 'user' | 'market';
  locationLabel: string;
  statsLabel: string;
  detailTooltip: string;
  isDefault: boolean;
  canDelete: boolean;
  canPublish: boolean;
  canManageMarketplace: boolean;
  canUpdateMarketplace: boolean;
  canReportMarketplace: boolean;
  marketplace?: CanvasSidebarMarketplaceTemplateSnapshot;
}

interface CanvasSidebarTemplateStateSnapshot {
  items: CanvasSidebarTemplateItemSnapshot[];
  issueMessages: string[];
  isLoading: boolean;
  loadErrorMessage?: string;
}

interface SidebarTemplateCopy {
  templateList: string;
  template: string;
  defaultTemplate: string;
  hasNewVersion: string;
  defaultPrefix: string;
  updateAvailablePrefix: string;
  applyTemplate: string;
  resetToTemplate: string;
  alreadyDefaultTemplate: string;
  setAsDefaultTemplate: string;
  exportTemplate: string;
  publishToMarketplace: string;
  openMarketplaceDetails: string;
  updateToMarketplaceLatest: string;
  updateToMarketplaceLatestVersion: string;
  reportMarketplaceTemplate: string;
  deleteTemplate: string;
  loading: string;
  noTemplates: string;
}

type SidebarTemplateInboundMessage =
  | {
      type: 'sidebarTemplates/ready';
    }
  | {
      type: 'sidebarTemplates/applyTemplate';
      payload: {
        templateId: string;
      };
    }
  | {
      type: 'sidebarTemplates/resetToTemplate';
      payload: {
        templateId: string;
      };
    }
  | {
      type: 'sidebarTemplates/setDefaultTemplate';
      payload: {
        templateId: string;
      };
    }
  | {
      type: 'sidebarTemplates/exportTemplate';
      payload: {
        templateId: string;
      };
    }
  | {
      type: 'sidebarTemplates/publishTemplate';
      payload: {
        templateId: string;
      };
    }
  | {
      type: 'sidebarTemplates/deleteTemplate';
      payload: {
        templateId: string;
      };
    }
  | {
      type: 'sidebarTemplates/openMarketplaceTemplate';
      payload: {
        templateId: string;
      };
    }
  | {
      type: 'sidebarTemplates/updateMarketplaceTemplate';
      payload: {
        templateId: string;
      };
    }
  | {
      type: 'sidebarTemplates/reportMarketplaceTemplate';
      payload: {
        templateId: string;
      };
    };

type SidebarTemplateOutboundMessage = {
  type: 'sidebarTemplates/state';
  payload: CanvasSidebarTemplateStateSnapshot;
};

export class CanvasSidebarTemplateView implements vscode.WebviewViewProvider, vscode.Disposable {
  private readonly templateSubscription: vscode.Disposable;
  private view: vscode.WebviewView | undefined;
  private state: CanvasSidebarTemplateStateSnapshot = {
    items: [],
    issueMessages: [],
    isLoading: true
  };

  public constructor(
    private readonly panelManager: CanvasPanelManager,
    private readonly extensionUri: vscode.Uri,
    private readonly marketplace?: CanvasSidebarTemplateMarketplaceOptions
  ) {
    this.templateSubscription = this.panelManager.onDidChangeTemplateCatalog(() => {
      void this.refresh();
    });
  }

  public dispose(): void {
    this.view = undefined;
    this.templateSubscription.dispose();
  }

  public resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'dist')]
    };

    webviewView.webview.onDidReceiveMessage((message) => {
      void this.handleMessage(message);
    });
    webviewView.webview.html = buildSidebarTemplateHtml(webviewView.webview, this.extensionUri, this.state);

    webviewView.onDidDispose(() => {
      if (this.view === webviewView) {
        this.view = undefined;
      }
    });
    webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible) {
        void this.refresh();
      }
    });

    void this.refresh();
  }

  public async refresh(): Promise<CanvasSidebarTemplateStateSnapshot> {
    try {
      const catalog = await this.panelManager.getCanvasTemplateCatalog();
      const defaultTemplateId = this.panelManager.getDefaultCanvasTemplateId();
      const marketplaceUpdateStatuses = await this.loadMarketplaceUpdateStatuses(catalog);
      this.state = {
        items: getCanvasSidebarTemplateItems(catalog, defaultTemplateId, marketplaceUpdateStatuses),
        issueMessages: catalog.issues.map(localizeCanvasTemplateStoreIssue),
        isLoading: false
      };
    } catch (error) {
      this.state = {
        items: [],
        issueMessages: [],
        isLoading: false,
        loadErrorMessage: error instanceof Error ? error.message : String(error)
      };
    }

    await this.postState();
    return this.state;
  }

  private async postState(): Promise<void> {
    if (!this.view) {
      return;
    }

    await this.view.webview.postMessage({
      type: 'sidebarTemplates/state',
      payload: this.state
    } satisfies SidebarTemplateOutboundMessage);
  }

  private async handleMessage(message: unknown): Promise<void> {
    const parsed = parseSidebarTemplateMessage(message);
    if (!parsed) {
      return;
    }

    switch (parsed.type) {
      case 'sidebarTemplates/ready':
        await this.refresh();
        return;
      case 'sidebarTemplates/applyTemplate':
        await vscode.commands.executeCommand(COMMAND_IDS.applyTemplate, parsed.payload.templateId);
        return;
      case 'sidebarTemplates/resetToTemplate':
        await vscode.commands.executeCommand(COMMAND_IDS.resetToTemplate, parsed.payload.templateId);
        return;
      case 'sidebarTemplates/setDefaultTemplate':
        await vscode.commands.executeCommand(COMMAND_IDS.setDefaultTemplate, parsed.payload.templateId);
        return;
      case 'sidebarTemplates/exportTemplate':
        await vscode.commands.executeCommand(COMMAND_IDS.exportTemplate, parsed.payload.templateId);
        return;
      case 'sidebarTemplates/publishTemplate':
        await vscode.commands.executeCommand(COMMAND_IDS.publishTemplateToMarketplace, parsed.payload.templateId);
        return;
      case 'sidebarTemplates/deleteTemplate':
        await vscode.commands.executeCommand(COMMAND_IDS.deleteTemplate, parsed.payload.templateId);
        return;
      case 'sidebarTemplates/openMarketplaceTemplate':
        this.openMarketplaceTemplate(parsed.payload.templateId);
        return;
      case 'sidebarTemplates/updateMarketplaceTemplate':
        await this.updateMarketplaceTemplate(parsed.payload.templateId);
        return;
      case 'sidebarTemplates/reportMarketplaceTemplate':
        await this.openMarketplaceReport(parsed.payload.templateId);
        return;
    }
  }

  private async loadMarketplaceUpdateStatuses(
    catalog: CanvasTemplateCatalog
  ): Promise<ReadonlyMap<string, TemplateMarketplaceInstalledTemplateUpdateSummary>> {
    if (!this.marketplace || !catalog.templates.some((storedTemplate) => storedTemplate.marketplace)) {
      return new Map();
    }

    try {
      const statuses = await this.marketplace.client.listInstalledTemplateUpdateStatuses();
      return new Map(statuses.map((status) => [status.localTemplateId, status]));
    } catch {
      return new Map();
    }
  }

  private findMarketplaceSnapshot(templateId: string): CanvasSidebarMarketplaceTemplateSnapshot | undefined {
    return this.state.items.find((item) => item.templateId === templateId)?.marketplace;
  }

  private openMarketplaceTemplate(templateId: string): void {
    const marketplace = this.findMarketplaceSnapshot(templateId);
    if (!marketplace || !this.marketplace) {
      void vscode.window.showErrorMessage(vscode.l10n.t('Could not find the details entry for this marketplace template.'));
      return;
    }

    try {
      this.marketplace.openTemplateDetail(
        marketplace.marketTemplateSlug ?? marketplace.marketTemplateId,
        marketplace.marketVersionId,
        new URL(marketplace.sourceUrl),
        { refreshList: true }
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      void vscode.window.showErrorMessage(vscode.l10n.t('Failed to open marketplace template details: {message}', { message }));
    }
  }

  private async updateMarketplaceTemplate(templateId: string): Promise<void> {
    const marketplace = this.findMarketplaceSnapshot(templateId);
    if (!marketplace || !this.marketplace) {
      await vscode.window.showErrorMessage(vscode.l10n.t('Could not find the marketplace template to update.'));
      return;
    }

    try {
      const result = await this.marketplace.client.updateInstalledTemplateToLatest(templateId);
      await this.refresh();
      await vscode.window.showInformationMessage(
        vscode.l10n.t('Updated marketplace template {name} to v{version}.', {
          name: result.savedTemplate.template.name,
          version: result.version.versionNumber
        })
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await vscode.window.showErrorMessage(vscode.l10n.t('Failed to update marketplace template: {message}', { message }));
    }
  }

  private async openMarketplaceReport(templateId: string): Promise<void> {
    const marketplace = this.findMarketplaceSnapshot(templateId);
    if (!marketplace) {
      await vscode.window.showErrorMessage(vscode.l10n.t('Could not find the report entry for this marketplace template.'));
      return;
    }

    try {
      await vscode.env.openExternal(vscode.Uri.parse(buildMarketplaceReportUrl(marketplace.sourceUrl)));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await vscode.window.showErrorMessage(vscode.l10n.t('Failed to open the report page: {message}', { message }));
    }
  }
}

export function getCanvasSidebarTemplateItems(
  catalog: CanvasTemplateCatalog,
  defaultTemplateId: string,
  marketplaceUpdateStatuses: ReadonlyMap<string, TemplateMarketplaceInstalledTemplateUpdateSummary> = new Map()
): CanvasSidebarTemplateItemSnapshot[] {
  return catalog.templates.map((storedTemplate) => {
    const marketplace = buildCanvasSidebarMarketplaceTemplateSnapshot(
      storedTemplate,
      marketplaceUpdateStatuses.get(storedTemplate.template.id)
    );
    return {
      id: `template/${storedTemplate.template.id}`,
      templateId: storedTemplate.template.id,
      name: storedTemplate.template.name,
      category: storedTemplate.template.category,
      sourceKind: resolveCanvasSidebarTemplateSourceKind(storedTemplate),
      locationLabel: resolveCanvasSidebarTemplateLocationLabel(storedTemplate),
      statsLabel: formatCanvasTemplateStats(storedTemplate.template),
      detailTooltip: buildCanvasTemplateTooltip(storedTemplate, marketplace),
      isDefault: storedTemplate.template.id === defaultTemplateId,
      canDelete: storedTemplate.template.category === 'user',
      canPublish: storedTemplate.template.category === 'user' && !storedTemplate.marketplace,
      canManageMarketplace: Boolean(marketplace),
      canUpdateMarketplace: marketplace?.updateAvailable === true,
      canReportMarketplace: Boolean(marketplace?.sourceUrl),
      marketplace
    };
  });
}

function buildCanvasSidebarMarketplaceTemplateSnapshot(
  storedTemplate: CanvasTemplateCatalog['templates'][number],
  updateStatus: TemplateMarketplaceInstalledTemplateUpdateSummary | undefined
): CanvasSidebarMarketplaceTemplateSnapshot | undefined {
  const marketplace = storedTemplate.marketplace;
  if (!marketplace) {
    return undefined;
  }

  return {
    marketTemplateId: marketplace.marketTemplateId,
    marketTemplateSlug: marketplace.marketTemplateSlug,
    marketVersionId: marketplace.marketVersionId,
    installedVersionNumber: marketplace.installedVersionNumber,
    latestVersionId: updateStatus?.latestVersionId,
    latestVersionNumber: updateStatus?.latestVersionNumber,
    updateAvailable: updateStatus?.updateAvailable === true,
    updateCheckError: updateStatus?.updateCheckError,
    sourceUrl: marketplace.sourceUrl
  };
}

function resolveCanvasSidebarTemplateLocationLabel(storedTemplate: CanvasTemplateCatalog['templates'][number]): string {
  if (storedTemplate.template.category === 'builtin') {
    return resolveCanvasSidebarTemplateSourceLabel(storedTemplate);
  }
  return `${resolveCanvasSidebarTemplateSourceLabel(storedTemplate)} · ${resolveCanvasSidebarTemplatePositionLabel(storedTemplate)}`;
}

function resolveCanvasSidebarTemplateSourceLabel(storedTemplate: CanvasTemplateCatalog['templates'][number]): string {
  if (storedTemplate.template.category === 'builtin') {
    return vscode.l10n.t('Built-in');
  }
  if (storedTemplate.marketplace) {
    return vscode.l10n.t('Marketplace');
  }
  return vscode.l10n.t('User-created');
}

function resolveCanvasSidebarTemplatePositionLabel(storedTemplate: CanvasTemplateCatalog['templates'][number]): string {
  if (storedTemplate.template.category === 'builtin') {
    return '';
  }
  return storedTemplate.storageLocation?.scope === 'workspace' ? vscode.l10n.t('Workspace') : vscode.l10n.t('Local');
}

function resolveCanvasSidebarTemplateSourceKind(storedTemplate: CanvasTemplateCatalog['templates'][number]): 'builtin' | 'user' | 'market' {
  if (storedTemplate.template.category === 'builtin') {
    return 'builtin';
  }
  return storedTemplate.marketplace ? 'market' : 'user';
}

function buildCanvasTemplateTooltip(
  storedTemplate: CanvasTemplateCatalog['templates'][number],
  marketplace: CanvasSidebarMarketplaceTemplateSnapshot | undefined
): string {
  const detailLines = buildCanvasTemplateNodeDetailLines(storedTemplate.template);
  const locationLine = buildCanvasTemplateLocationTooltipLine(storedTemplate);
  const marketLine = marketplace
    ? vscode.l10n.t('Marketplace source: {source} / v{version}', {
        source: marketplace.marketTemplateSlug ?? marketplace.marketTemplateId,
        version: marketplace.installedVersionNumber
      })
    : undefined;
  const marketUpdateLine = marketplace?.updateAvailable && marketplace.latestVersionNumber
    ? vscode.l10n.t('Marketplace update: v{version} is available', {
        version: marketplace.latestVersionNumber
      })
    : marketplace?.updateCheckError
      ? vscode.l10n.t('Marketplace update: cannot check right now ({message})', {
          message: marketplace.updateCheckError
        })
      : undefined;
  return [...detailLines, '', locationLine, marketLine, marketUpdateLine].filter(Boolean).join('\n');
}

function buildCanvasTemplateLocationTooltipLine(storedTemplate: CanvasTemplateCatalog['templates'][number]): string {
  if (storedTemplate.template.category === 'builtin') {
    const builtinLayer = storedTemplate.relativeDirectory || vscode.l10n.t('root directory');
    return vscode.l10n.t('Template source: Built-in; template layer: {layer}', { layer: builtinLayer });
  }

  const locationLabel = storedTemplate.storageLocation?.label ?? vscode.l10n.t('User templates');
  const relativeDirectory = storedTemplate.relativeDirectory || vscode.l10n.t('root directory');
  return vscode.l10n.t('Template source: {source}; saved location: {location} / {directory}', {
    source: resolveCanvasSidebarTemplateSourceLabel(storedTemplate),
    location: locationLabel,
    directory: relativeDirectory
  });
}

function parseSidebarTemplateMessage(message: unknown): SidebarTemplateInboundMessage | null {
  if (!isRecord(message) || typeof message.type !== 'string') {
    return null;
  }

  if (message.type === 'sidebarTemplates/ready') {
    return {
      type: 'sidebarTemplates/ready'
    };
  }

  if (
    message.type === 'sidebarTemplates/applyTemplate' ||
    message.type === 'sidebarTemplates/resetToTemplate' ||
    message.type === 'sidebarTemplates/setDefaultTemplate' ||
    message.type === 'sidebarTemplates/exportTemplate' ||
    message.type === 'sidebarTemplates/publishTemplate' ||
    message.type === 'sidebarTemplates/deleteTemplate' ||
    message.type === 'sidebarTemplates/openMarketplaceTemplate' ||
    message.type === 'sidebarTemplates/updateMarketplaceTemplate' ||
    message.type === 'sidebarTemplates/reportMarketplaceTemplate'
  ) {
    const payload = isRecord(message.payload) ? message.payload : null;
    if (!payload || typeof payload.templateId !== 'string' || payload.templateId.trim().length === 0) {
      return null;
    }

    return {
      type: message.type,
      payload: {
        templateId: payload.templateId
      }
    };
  }

  return null;
}

function buildSidebarTemplateCopy(): SidebarTemplateCopy {
  return {
    templateList: vscode.l10n.t('Template list'),
    template: vscode.l10n.t('template'),
    defaultTemplate: vscode.l10n.t('Default template'),
    hasNewVersion: vscode.l10n.t('Has new version'),
    defaultPrefix: vscode.l10n.t('(Default)'),
    updateAvailablePrefix: vscode.l10n.t('Update available'),
    applyTemplate: vscode.l10n.t('Append template to the current Canvas'),
    resetToTemplate: vscode.l10n.t('Reset the current Canvas to this template'),
    alreadyDefaultTemplate: vscode.l10n.t('Already the default template'),
    setAsDefaultTemplate: vscode.l10n.t('Set as default template'),
    exportTemplate: vscode.l10n.t('Export template'),
    publishToMarketplace: vscode.l10n.t('Publish to Template Marketplace'),
    openMarketplaceDetails: vscode.l10n.t('Open marketplace details / roll back version'),
    updateToMarketplaceLatest: vscode.l10n.t('Update to the latest marketplace version'),
    updateToMarketplaceLatestVersion: vscode.l10n.t('Update to the latest marketplace version v{version}', {
      version: '{version}'
    }),
    reportMarketplaceTemplate: vscode.l10n.t('Report marketplace template'),
    deleteTemplate: vscode.l10n.t('Delete template'),
    loading: vscode.l10n.t('Loading...'),
    noTemplates: vscode.l10n.t('No templates yet. Install one from the marketplace or save the Canvas as a template manually.')
  };
}

function buildMarketplaceReportUrl(sourceUrl: string): string {
  const url = new URL(sourceUrl);
  url.hash = 'report';
  return url.toString();
}

function buildSidebarTemplateHtml(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  initialState: CanvasSidebarTemplateStateSnapshot
): string {
  const nonce = createNonce();
  const copy = buildSidebarTemplateCopy();
  const codiconCssUri = getVersionedWebviewResourceUri(
    webview,
    extensionUri,
    ...SIDEBAR_BUNDLED_CODICON_PATH_SEGMENTS
  );
  const initialStateJson = serializeSidebarTemplateStateForInlineScript(initialState);

  return `<!DOCTYPE html>
<html lang="${resolveWebviewHtmlLang()}">
  <head>
    <meta charset="UTF-8" />
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; font-src ${webview.cspSource}; script-src 'nonce-${nonce}';"
    />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link rel="stylesheet" href="${codiconCssUri}" />
    <style>
      :root {
        color-scheme: light dark;
        --bg: var(--vscode-sideBar-background);
        --fg: var(--vscode-foreground, var(--vscode-sideBar-foreground));
        --muted: var(--vscode-descriptionForeground);
        --focus: var(--vscode-focusBorder);
        --list-hover: var(--vscode-list-hoverBackground, color-mix(in srgb, var(--fg) 6%, transparent));
        --list-hover-fg: var(--vscode-list-hoverForeground, var(--fg));
        --list-active: var(--vscode-list-activeSelectionBackground, color-mix(in srgb, var(--focus) 18%, transparent));
        --list-active-fg: var(--vscode-list-activeSelectionForeground, var(--fg));
        --list-inactive: var(--vscode-list-inactiveSelectionBackground, color-mix(in srgb, var(--focus) 10%, transparent));
        --list-inactive-fg: var(--vscode-list-inactiveSelectionForeground, var(--fg));
        --badge-bg: color-mix(in srgb, var(--focus) 18%, transparent);
        --badge-fg: var(--vscode-list-highlightForeground, var(--fg));
        --warning-bg: color-mix(in srgb, var(--vscode-errorForeground, #c74e39) 12%, transparent);
        --warning-fg: var(--vscode-errorForeground, #c74e39);
        --border: color-mix(in srgb, var(--vscode-panel-border, var(--focus)) 72%, transparent);
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        padding: 8px 0 0;
        background: var(--bg);
        color: var(--fg);
        font-family: var(--vscode-font-family);
        font-size: 12px;
      }

      button {
        font: inherit;
      }

      .shell {
        display: grid;
        gap: 8px;
      }

      .status-note,
      .empty-state {
        margin: 0 12px;
        padding: 8px 10px;
        line-height: 1.45;
        border: 1px solid var(--border);
        border-radius: 4px;
        display: none;
      }

      .status-note {
        color: var(--warning-fg);
        background: var(--warning-bg);
      }

      .empty-state {
        color: var(--muted);
        background: color-mix(in srgb, var(--focus) 10%, transparent);
      }

      .status-note.is-visible,
      .empty-state.is-visible {
        display: block;
      }

      .status-line + .status-line {
        margin-top: 4px;
      }

      .list {
        display: grid;
      }

      .template-row {
        --row-fg: var(--fg);
        --row-muted: var(--muted);
        display: grid;
        grid-template-columns: minmax(0, 1fr);
        gap: 4px;
        padding: 9px 12px;
        border: 0;
        border-left: 2px solid transparent;
        background: transparent;
        color: var(--row-fg);
        text-align: left;
        cursor: default;
      }

      .template-row:hover {
        background: var(--list-hover);
        --row-fg: var(--list-hover-fg);
        --row-muted: var(--list-hover-fg);
      }

      .template-row.is-selected {
        background: var(--list-inactive);
        --row-fg: var(--list-inactive-fg);
        --row-muted: var(--list-inactive-fg);
      }

      .template-row.is-selected:focus,
      .template-row:focus-visible {
        background: var(--list-active);
        --row-fg: var(--list-active-fg);
        --row-muted: var(--list-active-fg);
        border-left-color: var(--focus);
        outline: none;
      }

      .template-main {
        min-width: 0;
        display: grid;
        gap: 4px;
      }

      .template-title-line {
        display: flex;
        align-items: center;
        gap: 8px;
        min-width: 0;
      }

      .template-icon {
        flex: 0 0 auto;
        width: 14px;
        height: 14px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        color: var(--row-muted);
        font-size: 14px;
        line-height: 1;
      }

      .template-title {
        flex: 1 1 auto;
        min-width: 0;
        overflow: hidden;
        white-space: nowrap;
        text-overflow: ellipsis;
      }

      .template-meta {
        display: flex;
        align-items: center;
        gap: 6px;
        min-width: 0;
        padding-left: 22px;
        overflow: hidden;
        flex-wrap: nowrap;
      }

      .template-stats {
        min-width: 0;
        overflow: hidden;
        white-space: nowrap;
        text-overflow: ellipsis;
        color: var(--row-muted);
        font-size: 11px;
      }

      .badge {
        display: inline-flex;
        align-items: center;
        min-height: 16px;
        padding: 0 6px;
        border-radius: 999px;
        font-size: 10px;
        line-height: 1;
        white-space: nowrap;
        background: var(--badge-bg);
        color: var(--badge-fg);
      }

      .badge.is-update {
        background: var(--warning-bg);
        color: var(--warning-fg);
      }

      .template-actions {
        display: flex;
        align-items: center;
        gap: 2px;
        flex: 0 0 auto;
        margin-left: auto;
        opacity: 0.56;
        transition: opacity 120ms ease;
      }

      .template-row:hover .template-actions,
      .template-row:focus-within .template-actions,
      .template-row.is-selected .template-actions {
        opacity: 1;
      }

      .row-action {
        width: 22px;
        height: 22px;
        border: 0;
        border-radius: 4px;
        background: transparent;
        color: var(--row-muted);
        display: inline-flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
      }

      .row-action:hover,
      .row-action:focus-visible {
        background: color-mix(
          in srgb,
          var(--vscode-button-secondaryHoverBackground, var(--vscode-button-hoverBackground)) 50%,
          transparent
        );
        color: var(--row-fg);
        outline: none;
      }

      .row-action.is-danger:hover,
      .row-action.is-danger:focus-visible {
        color: var(--warning-fg);
      }

      .row-action[hidden] {
        display: none;
      }

      .row-action .codicon {
        font-size: 14px;
      }

    </style>
  </head>
  <body>
      <div class="shell">
        <div id="statusNote" class="status-note" role="status" aria-live="polite"></div>
        <div id="list" class="list" role="listbox" aria-label="${copy.templateList}"></div>
        <div id="emptyState" class="empty-state" role="status" aria-live="polite"></div>
      </div>
    <script nonce="${nonce}">
      const vscode = acquireVsCodeApi();
      const copy = ${serializeSidebarTemplateStateForInlineScript(copy)};
      const state = {
        data: ${initialStateJson},
        selectedId: undefined
      };

      const statusNote = document.getElementById('statusNote');
      const list = document.getElementById('list');
      const emptyState = document.getElementById('emptyState');

      function syncRenderedSelection() {
        const rows = list.querySelectorAll('[data-sidebar-template-item-id]');
        for (const row of rows) {
          const isSelected = row.getAttribute('data-sidebar-template-item-id') === state.selectedId;
          row.setAttribute('aria-selected', isSelected ? 'true' : 'false');
          row.classList.toggle('is-selected', isSelected);
        }
      }

      function setSelectedId(nextId) {
        if (state.selectedId === nextId) {
          syncRenderedSelection();
          return;
        }
        state.selectedId = nextId;
        syncRenderedSelection();
      }

      function postTemplateMessage(type, templateId) {
        vscode.postMessage({
          type,
          payload: {
            templateId
          }
        });
      }

      function renderStatusNote(messages) {
        const lines = Array.isArray(messages) ? messages.filter((message) => typeof message === 'string' && message.trim().length > 0) : [];
        if (lines.length === 0) {
          statusNote.textContent = '';
          statusNote.classList.remove('is-visible');
          return;
        }

        statusNote.replaceChildren();
        for (const message of lines) {
          const line = document.createElement('div');
          line.className = 'status-line';
          line.textContent = message;
          statusNote.append(line);
        }
        statusNote.classList.add('is-visible');
      }

      function renderRow(item) {
        const row = document.createElement('div');
        row.className = 'template-row';
        row.tabIndex = 0;
        row.title = item.detailTooltip;
        row.setAttribute('data-sidebar-template-item-id', item.id);
        row.setAttribute('role', 'option');
        row.setAttribute('aria-selected', item.id === state.selectedId ? 'true' : 'false');
        row.setAttribute(
          'aria-label',
          [
            item.name,
            item.locationLabel + ' ' + copy.template,
            item.isDefault ? copy.defaultTemplate : '',
            item.marketplace && item.marketplace.updateAvailable ? copy.hasNewVersion : '',
            item.statsLabel
          ].filter(Boolean).join(', ')
        );
        if (item.id === state.selectedId) {
          row.classList.add('is-selected');
        }

        row.addEventListener('click', () => {
          setSelectedId(item.id);
        });
        row.addEventListener('focus', () => {
          setSelectedId(item.id);
        });
        row.addEventListener('keydown', (event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            setSelectedId(item.id);
          }
        });

        const main = document.createElement('div');
        main.className = 'template-main';

        const titleLine = document.createElement('div');
        titleLine.className = 'template-title-line';

        const icon = document.createElement('span');
        const iconName =
          item.sourceKind === 'builtin' ? 'codicon-library' : item.sourceKind === 'market' ? 'codicon-cloud-download' : 'codicon-file-code';
        icon.className = 'template-icon codicon ' + iconName;
        icon.setAttribute('aria-hidden', 'true');

        const title = document.createElement('div');
        title.className = 'template-title';
        title.textContent = item.isDefault ? copy.defaultPrefix + ' ' + item.name : item.name;

        titleLine.replaceChildren(icon, title);

        main.append(titleLine);

        const meta = document.createElement('div');
        meta.className = 'template-meta';

        const stats = document.createElement('div');
        stats.className = 'template-stats';
        stats.textContent = item.statsLabel;

        const locationBadge = document.createElement('span');
        locationBadge.className = 'badge';
        locationBadge.textContent = item.locationLabel;

        meta.append(locationBadge);
        if (item.marketplace && item.marketplace.updateAvailable) {
          const updateBadge = document.createElement('span');
          updateBadge.className = 'badge is-update';
          updateBadge.textContent = copy.updateAvailablePrefix + ' v' + item.marketplace.latestVersionNumber;
          meta.append(updateBadge);
        }
        meta.append(stats);
        main.append(meta);

        const actions = document.createElement('div');
        actions.className = 'template-actions';

        const applyAction = document.createElement('button');
        applyAction.className = 'row-action';
        applyAction.type = 'button';
        applyAction.title = copy.applyTemplate;
        applyAction.setAttribute('aria-label', applyAction.title);
        applyAction.innerHTML = '<span class="codicon codicon-run" aria-hidden="true"></span>';
        applyAction.addEventListener('click', (event) => {
          event.stopPropagation();
          postTemplateMessage('sidebarTemplates/applyTemplate', item.templateId);
        });

        const resetAction = document.createElement('button');
        resetAction.className = 'row-action';
        resetAction.type = 'button';
        resetAction.title = copy.resetToTemplate;
        resetAction.setAttribute('aria-label', resetAction.title);
        resetAction.innerHTML = '<span class="codicon codicon-discard" aria-hidden="true"></span>';
        resetAction.addEventListener('click', (event) => {
          event.stopPropagation();
          postTemplateMessage('sidebarTemplates/resetToTemplate', item.templateId);
        });

        const defaultAction = document.createElement('button');
        defaultAction.className = 'row-action';
        defaultAction.type = 'button';
        defaultAction.title = item.isDefault ? copy.alreadyDefaultTemplate : copy.setAsDefaultTemplate;
        defaultAction.setAttribute('aria-label', defaultAction.title);
        defaultAction.innerHTML =
          '<span class="codicon ' +
          (item.isDefault ? 'codicon-star-full' : 'codicon-star-empty') +
          '" aria-hidden="true"></span>';
        defaultAction.addEventListener('click', (event) => {
          event.stopPropagation();
          if (item.isDefault) {
            return;
          }

          postTemplateMessage('sidebarTemplates/setDefaultTemplate', item.templateId);
        });

        const exportAction = document.createElement('button');
        exportAction.className = 'row-action';
        exportAction.type = 'button';
        exportAction.title = copy.exportTemplate;
        exportAction.setAttribute('aria-label', exportAction.title);
        exportAction.innerHTML = '<span class="codicon codicon-export" aria-hidden="true"></span>';
        exportAction.addEventListener('click', (event) => {
          event.stopPropagation();
          postTemplateMessage('sidebarTemplates/exportTemplate', item.templateId);
        });

        const publishAction = document.createElement('button');
        publishAction.className = 'row-action';
        publishAction.type = 'button';
        publishAction.title = copy.publishToMarketplace;
        publishAction.setAttribute('aria-label', publishAction.title);
        publishAction.hidden = !item.canPublish;
        publishAction.innerHTML = '<span class="codicon codicon-cloud-upload" aria-hidden="true"></span>';
        publishAction.addEventListener('click', (event) => {
          event.stopPropagation();
          postTemplateMessage('sidebarTemplates/publishTemplate', item.templateId);
        });

        const manageMarketplaceAction = document.createElement('button');
        manageMarketplaceAction.className = 'row-action';
        manageMarketplaceAction.type = 'button';
        manageMarketplaceAction.title = copy.openMarketplaceDetails;
        manageMarketplaceAction.setAttribute('aria-label', manageMarketplaceAction.title);
        manageMarketplaceAction.hidden = !item.canManageMarketplace;
        manageMarketplaceAction.innerHTML = '<span class="codicon codicon-versions" aria-hidden="true"></span>';
        manageMarketplaceAction.addEventListener('click', (event) => {
          event.stopPropagation();
          postTemplateMessage('sidebarTemplates/openMarketplaceTemplate', item.templateId);
        });

        const updateMarketplaceAction = document.createElement('button');
        updateMarketplaceAction.className = 'row-action';
        updateMarketplaceAction.type = 'button';
        updateMarketplaceAction.title = item.marketplace && item.marketplace.latestVersionNumber
          ? copy.updateToMarketplaceLatestVersion.replace('{version}', item.marketplace.latestVersionNumber)
          : copy.updateToMarketplaceLatest;
        updateMarketplaceAction.setAttribute('aria-label', updateMarketplaceAction.title);
        updateMarketplaceAction.hidden = !item.canUpdateMarketplace;
        updateMarketplaceAction.innerHTML = '<span class="codicon codicon-sync" aria-hidden="true"></span>';
        updateMarketplaceAction.addEventListener('click', (event) => {
          event.stopPropagation();
          postTemplateMessage('sidebarTemplates/updateMarketplaceTemplate', item.templateId);
        });

        const reportMarketplaceAction = document.createElement('button');
        reportMarketplaceAction.className = 'row-action';
        reportMarketplaceAction.type = 'button';
        reportMarketplaceAction.title = copy.reportMarketplaceTemplate;
        reportMarketplaceAction.setAttribute('aria-label', reportMarketplaceAction.title);
        reportMarketplaceAction.hidden = !item.canReportMarketplace;
        reportMarketplaceAction.innerHTML = '<span class="codicon codicon-warning" aria-hidden="true"></span>';
        reportMarketplaceAction.addEventListener('click', (event) => {
          event.stopPropagation();
          postTemplateMessage('sidebarTemplates/reportMarketplaceTemplate', item.templateId);
        });

        const deleteAction = document.createElement('button');
        deleteAction.className = 'row-action is-danger';
        deleteAction.type = 'button';
        deleteAction.title = copy.deleteTemplate;
        deleteAction.setAttribute('aria-label', deleteAction.title);
        deleteAction.hidden = !item.canDelete;
        deleteAction.innerHTML = '<span class="codicon codicon-trash" aria-hidden="true"></span>';
        deleteAction.addEventListener('click', (event) => {
          event.stopPropagation();
          postTemplateMessage('sidebarTemplates/deleteTemplate', item.templateId);
        });

        actions.append(
          defaultAction,
          applyAction,
          resetAction,
          updateMarketplaceAction,
          manageMarketplaceAction,
          reportMarketplaceAction,
          publishAction,
          exportAction,
          deleteAction
        );
        titleLine.append(actions);
        row.append(main);
        return row;
      }

      function render() {
        const currentState = state.data && typeof state.data === 'object' ? state.data : ${initialStateJson};
        const items = Array.isArray(currentState.items) ? currentState.items : [];
        if (!state.selectedId || !items.some((item) => item.id === state.selectedId)) {
          state.selectedId = items[0] ? items[0].id : undefined;
        }

        list.replaceChildren();
        for (const item of items) {
          list.append(renderRow(item));
        }

        renderStatusNote(currentState.issueMessages);

        if (currentState.isLoading) {
          emptyState.textContent = copy.loading;
          emptyState.classList.add('is-visible');
          return;
        }

        if (typeof currentState.loadErrorMessage === 'string' && currentState.loadErrorMessage.length > 0) {
          emptyState.textContent = currentState.loadErrorMessage;
          emptyState.classList.add('is-visible');
          return;
        }

        if (items.length === 0) {
          emptyState.textContent = copy.noTemplates;
          emptyState.classList.add('is-visible');
          return;
        }

        emptyState.textContent = '';
        emptyState.classList.remove('is-visible');
      }

      window.addEventListener('message', (event) => {
        const message = event.data;
        if (!message || typeof message.type !== 'string') {
          return;
        }

        if (message.type !== 'sidebarTemplates/state' || !message.payload) {
          return;
        }

        state.data = message.payload;
        render();
      });

      render();
      vscode.postMessage({ type: 'sidebarTemplates/ready' });
    </script>
  </body>
</html>`;
}

function serializeSidebarTemplateStateForInlineScript(state: unknown): string {
  return JSON.stringify(state)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\\u2028/g, '\\u2028')
    .replace(/\\u2029/g, '\\u2029');
}

function resolveWebviewHtmlLang(): string {
  return (vscode.env?.language || 'en').replace(/"/g, '');
}

function createNonce(): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let value = '';
  for (let index = 0; index < 32; index += 1) {
    value += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
