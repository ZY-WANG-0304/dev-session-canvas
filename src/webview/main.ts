import type {
  CanvasNodeKind,
  CanvasPrototypeState,
  HostToWebviewMessage,
  WebviewToHostMessage
} from '../common/protocol';

declare function acquireVsCodeApi<T>(): {
  getState(): T | undefined;
  setState(state: T): void;
  postMessage(message: unknown): void;
};

interface LocalUiState {
  selectedNodeId?: string;
}

const vscode = acquireVsCodeApi<LocalUiState>();
const rootElement = document.querySelector<HTMLDivElement>('#app');

if (!rootElement) {
  throw new Error('Webview root element not found.');
}

const root: HTMLDivElement = rootElement;

let currentState: CanvasPrototypeState | null = null;
let localUiState: LocalUiState = vscode.getState() ?? {};

window.addEventListener('message', (event: MessageEvent<HostToWebviewMessage>) => {
  const message = event.data;

  switch (message.type) {
    case 'host/bootstrap':
    case 'host/stateUpdated':
      currentState = message.payload.state;
      render();
      break;
    case 'host/error':
      renderBanner(message.payload.message);
      break;
  }
});

postMessage({ type: 'webview/ready' });
render();

function render(): void {
  const state = currentState;
  const selectedNodeId = localUiState.selectedNodeId;

  root.innerHTML = '';

  const page = document.createElement('main');
  page.style.padding = '28px';
  page.style.display = 'grid';
  page.style.gap = '20px';

  const hero = document.createElement('section');
  hero.style.border = '1px solid var(--vscode-panel-border)';
  hero.style.borderRadius = '18px';
  hero.style.padding = '20px';
  hero.style.background =
    'linear-gradient(135deg, color-mix(in srgb, var(--vscode-editor-background) 90%, #0ea5e9 10%), color-mix(in srgb, var(--vscode-editor-background) 94%, #172554 6%))';
  hero.innerHTML = `
    <div style="display:flex;justify-content:space-between;gap:16px;align-items:flex-start;flex-wrap:wrap;">
      <div style="display:grid;gap:8px;">
        <div style="font-size:12px;color:var(--vscode-descriptionForeground);text-transform:uppercase;letter-spacing:0.08em;">OpenCove Prototype</div>
        <h1 style="margin:0;font-size:28px;line-height:1.2;">WebviewPanel + typed message bridge + serializer</h1>
        <p style="margin:0;max-width:720px;color:var(--vscode-descriptionForeground);">
          这不是最终画布，而是第一版运行时原型：宿主维护最小状态，Webview 负责投影，并通过消息桥触发更新。
        </p>
      </div>
      <div style="display:grid;gap:6px;min-width:240px;">
        <div style="font-size:12px;color:var(--vscode-descriptionForeground);">宿主状态更新时间</div>
        <strong>${state ? new Date(state.updatedAt).toLocaleString() : '等待宿主初始化'}</strong>
      </div>
    </div>
  `;
  page.append(hero);

  const controls = document.createElement('section');
  controls.style.display = 'grid';
  controls.style.gap = '12px';
  controls.style.gridTemplateColumns = 'repeat(auto-fit, minmax(220px, 1fr))';
  controls.append(
    createControlCard('创建示例对象', '用最小动作验证宿主消息处理与状态回传。', [
      createKindButton('新增 Agent', 'agent'),
      createKindButton('新增 Terminal', 'terminal'),
      createKindButton('新增 Task', 'task'),
      createKindButton('新增 Note', 'note')
    ]),
    createControlCard('恢复链路', '本地 UI 只记录选中节点，宿主则维护对象图。', [
      createActionButton('重置宿主状态', () => {
        postMessage({ type: 'webview/resetDemoState' });
      })
    ])
  );
  page.append(controls);

  const nodesSection = document.createElement('section');
  nodesSection.style.display = 'grid';
  nodesSection.style.gap = '12px';

  const heading = document.createElement('div');
  heading.style.display = 'flex';
  heading.style.justifyContent = 'space-between';
  heading.style.alignItems = 'center';
  heading.style.gap = '12px';
  heading.innerHTML = `
    <h2 style="margin:0;font-size:18px;">原型节点</h2>
    <span style="color:var(--vscode-descriptionForeground);font-size:12px;">${state?.nodes.length ?? 0} 个对象</span>
  `;
  nodesSection.append(heading);

  if (!state || state.nodes.length === 0) {
    const empty = document.createElement('div');
    empty.style.padding = '18px';
    empty.style.border = '1px dashed var(--vscode-panel-border)';
    empty.style.borderRadius = '14px';
    empty.textContent = '宿主状态为空，等待初始化。';
    nodesSection.append(empty);
  } else {
    const grid = document.createElement('div');
    grid.style.display = 'grid';
    grid.style.gridTemplateColumns = 'repeat(auto-fit, minmax(220px, 1fr))';
    grid.style.gap = '12px';

    for (const node of state.nodes) {
      const card = document.createElement('button');
      card.type = 'button';
      card.style.textAlign = 'left';
      card.style.borderRadius = '16px';
      card.style.border = selectedNodeId === node.id ? '1px solid var(--vscode-focusBorder)' : '1px solid var(--vscode-panel-border)';
      card.style.background =
        selectedNodeId === node.id
          ? 'color-mix(in srgb, var(--vscode-focusBorder) 14%, var(--vscode-editor-background) 86%)'
          : 'color-mix(in srgb, var(--vscode-editor-background) 95%, #4f8cff 5%)';
      card.style.padding = '16px';
      card.style.display = 'grid';
      card.style.gap = '10px';
      card.style.cursor = 'pointer';
      card.innerHTML = `
        <div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start;">
          <strong>${node.title}</strong>
          <span style="font-size:11px;text-transform:uppercase;color:var(--vscode-descriptionForeground);">${node.kind}</span>
        </div>
        <div style="font-size:12px;color:var(--vscode-descriptionForeground);">状态：${node.status}</div>
        <div style="font-size:13px;line-height:1.5;color:var(--vscode-editor-foreground);">${node.summary}</div>
      `;
      card.addEventListener('click', () => {
        localUiState = { selectedNodeId: node.id };
        vscode.setState(localUiState);
        render();
      });
      grid.append(card);
    }

    nodesSection.append(grid);
  }

  const footer = document.createElement('section');
  footer.style.padding = '14px 16px';
  footer.style.border = '1px solid var(--vscode-panel-border)';
  footer.style.borderRadius = '14px';
  footer.style.color = 'var(--vscode-descriptionForeground)';
  footer.style.fontSize = '12px';
  footer.textContent =
    '当前原型重点验证命令打开、状态投影、消息往返和面板恢复，不代表最终画布交互或对象视觉设计。';

  page.append(nodesSection, footer);
  root.append(page);
}

function createControlCard(title: string, description: string, actions: HTMLButtonElement[]): HTMLElement {
  const card = document.createElement('div');
  card.style.border = '1px solid var(--vscode-panel-border)';
  card.style.borderRadius = '16px';
  card.style.padding = '16px';
  card.style.display = 'grid';
  card.style.gap = '12px';
  card.innerHTML = `
    <div style="display:grid;gap:6px;">
      <strong>${title}</strong>
      <div style="font-size:13px;color:var(--vscode-descriptionForeground);line-height:1.5;">${description}</div>
    </div>
  `;

  const actionsContainer = document.createElement('div');
  actionsContainer.style.display = 'flex';
  actionsContainer.style.flexWrap = 'wrap';
  actionsContainer.style.gap = '8px';
  actions.forEach((action) => actionsContainer.append(action));

  card.append(actionsContainer);
  return card;
}

function createKindButton(label: string, kind: CanvasNodeKind): HTMLButtonElement {
  return createActionButton(label, () => {
    postMessage({
      type: 'webview/createDemoNode',
      payload: { kind }
    });
  });
}

function createActionButton(label: string, onClick: () => void): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = label;
  button.style.border = '1px solid var(--vscode-button-border, transparent)';
  button.style.borderRadius = '999px';
  button.style.padding = '8px 12px';
  button.style.background = 'var(--vscode-button-background)';
  button.style.color = 'var(--vscode-button-foreground)';
  button.style.cursor = 'pointer';
  button.addEventListener('click', onClick);
  return button;
}

function renderBanner(message: string): void {
  const banner = document.createElement('div');
  banner.textContent = message;
  banner.style.position = 'fixed';
  banner.style.right = '16px';
  banner.style.bottom = '16px';
  banner.style.padding = '10px 14px';
  banner.style.borderRadius = '999px';
  banner.style.background = 'var(--vscode-inputValidation-errorBackground)';
  banner.style.color = 'var(--vscode-inputValidation-errorForeground)';
  banner.style.border = '1px solid var(--vscode-inputValidation-errorBorder)';
  document.body.append(banner);
  setTimeout(() => banner.remove(), 2400);
}

function postMessage(message: WebviewToHostMessage): void {
  vscode.postMessage(message);
}
