import type {
  AgentProviderKind,
  CanvasCreatableNodeKind,
  CanvasEdgeAnchor,
  CanvasEdgeArrowMode,
  CanvasEdgeColor,
  CanvasNodeFootprint,
  CanvasNodePosition,
  CanvasPrototypeState
} from './protocol';

export const CANVAS_TEMPLATE_DOCUMENT_VERSION = 1 as const;
export const CANVAS_TEMPLATE_CATEGORIES = ['builtin', 'user'] as const;
export const CANVAS_TEMPLATE_AGENT_PROVIDERS = ['default', 'codex', 'claude'] as const;
export const CANVAS_TEMPLATE_NODE_KINDS = ['agent', 'terminal', 'note'] as const;
export const CANVAS_TEMPLATE_NOTE_CONTENT_MODES = [
  'embedded-snapshot',
  'workspace-file-path-only',
  'workspace-file-with-content'
] as const;
export const CANVAS_TEMPLATE_ASSOCIATED_NOTE_SAVE_MODES = [
  'embedded-snapshot',
  'workspace-file-path-only',
  'workspace-file-with-content'
] as const;
export const DEFAULT_BUILTIN_CANVAS_TEMPLATE_ID = 'builtin-getting-started';

export type CanvasTemplateCategory = (typeof CANVAS_TEMPLATE_CATEGORIES)[number];
export type CanvasTemplateAgentProviderKind = (typeof CANVAS_TEMPLATE_AGENT_PROVIDERS)[number];
export type CanvasTemplateNodeKind = (typeof CANVAS_TEMPLATE_NODE_KINDS)[number];
export type CanvasTemplateNoteContentMode = (typeof CANVAS_TEMPLATE_NOTE_CONTENT_MODES)[number];
export type CanvasTemplateAssociatedNoteSaveMode = (typeof CANVAS_TEMPLATE_ASSOCIATED_NOTE_SAVE_MODES)[number];
export type CanvasTemplateSaveAgentProviderMode = 'default' | 'preserve';
export type CanvasTemplateSaveAgentProviderSelection =
  | CanvasTemplateSaveAgentProviderMode
  | Readonly<Record<string, CanvasTemplateAgentProviderKind>>;

export interface CanvasTemplateAgentMetadata {
  provider: CanvasTemplateAgentProviderKind;
  argv?: string[];
}

export interface CanvasTemplateNoteMetadata {
  content: string;
  templateContentMode?: CanvasTemplateNoteContentMode;
  relativePath?: string;
}

export interface CanvasTemplateAssociatedNoteSaveSelection {
  mode: CanvasTemplateAssociatedNoteSaveMode;
  content?: string;
  relativePath?: string;
}

export interface CanvasTemplateNodeSnapshot {
  kind: CanvasTemplateNodeKind;
  title: string;
  position: CanvasNodePosition;
  size: CanvasNodeFootprint;
  metadata?: {
    note?: CanvasTemplateNoteMetadata;
    agent?: CanvasTemplateAgentMetadata;
  };
}

export interface CanvasTemplateEdgeSnapshot {
  sourceNodeIndex: number;
  targetNodeIndex: number;
  sourceAnchor: CanvasEdgeAnchor;
  targetAnchor: CanvasEdgeAnchor;
  arrowMode: CanvasEdgeArrowMode;
  color?: CanvasEdgeColor;
  label?: string;
}

export interface CanvasTemplate {
  id: string;
  name: string;
  category: CanvasTemplateCategory;
  nodes: CanvasTemplateNodeSnapshot[];
  edges: CanvasTemplateEdgeSnapshot[];
  createdAt: string;
  updatedAt: string;
}

export interface CanvasTemplateDocument {
  version: typeof CANVAS_TEMPLATE_DOCUMENT_VERSION;
  template: CanvasTemplate;
}

export interface ParsedCanvasTemplateDocument {
  document: CanvasTemplateDocument;
  warnings: string[];
}

export interface CanvasTemplateSortMetadata {
  builtinOrder?: number;
}

export interface CanvasTemplateNodeStats {
  agentCount: number;
  terminalCount: number;
  noteCount: number;
}

export interface CanvasTemplateCaptureResult {
  template: CanvasTemplate;
  ignoredNodeIds: string[];
  ignoredEdgeIds: string[];
}

export function isCanvasTemplateCategory(value: unknown): value is CanvasTemplateCategory {
  return value === 'builtin' || value === 'user';
}

export function isCanvasTemplateAgentProviderKind(value: unknown): value is CanvasTemplateAgentProviderKind {
  return value === 'default' || value === 'codex' || value === 'claude';
}

export function isCanvasTemplateNodeKind(value: unknown): value is CanvasTemplateNodeKind {
  return value === 'agent' || value === 'terminal' || value === 'note';
}

export function isCanvasTemplateNoteContentMode(value: unknown): value is CanvasTemplateNoteContentMode {
  return (
    value === 'embedded-snapshot' ||
    value === 'workspace-file-path-only' ||
    value === 'workspace-file-with-content'
  );
}

export function isCanvasTemplateAssociatedNoteSaveMode(value: unknown): value is CanvasTemplateAssociatedNoteSaveMode {
  return (
    value === 'embedded-snapshot' ||
    value === 'workspace-file-path-only' ||
    value === 'workspace-file-with-content'
  );
}

export function buildCanvasTemplateDocument(template: CanvasTemplate): CanvasTemplateDocument {
  return {
    version: CANVAS_TEMPLATE_DOCUMENT_VERSION,
    template
  };
}

export function encodeCanvasTemplateDocument(template: CanvasTemplate): string {
  return `${JSON.stringify(buildCanvasTemplateDocument(template), null, 2)}\n`;
}

export function parseCanvasTemplateDocument(
  value: unknown,
  options: {
    defaultCategory?: CanvasTemplateCategory;
    forceCategory?: CanvasTemplateCategory;
  } = {}
): ParsedCanvasTemplateDocument {
  if (!isRecord(value)) {
    throw new Error('模板文件不是有效的 JSON 对象。');
  }

  if (value.version !== CANVAS_TEMPLATE_DOCUMENT_VERSION) {
    throw new Error(
      typeof value.version === 'number'
        ? `模板版本 ${value.version} 与当前扩展不兼容。`
        : '模板文件缺少受支持的 version 字段。'
    );
  }

  const templateValue = isRecord(value.template) ? value.template : null;
  if (!templateValue) {
    throw new Error('模板文件缺少 template 主体。');
  }

  const warnings: string[] = [];
  const category = options.forceCategory ?? resolveTemplateCategory(templateValue.category, options.defaultCategory);
  const now = new Date().toISOString();
  const nodes = parseTemplateNodes(templateValue.nodes, warnings);
  const edges = parseTemplateEdges(templateValue.edges, nodes.length);

  if (nodes.length === 0) {
    throw new Error('模板至少需要包含一个节点。');
  }

  const template: CanvasTemplate = {
    id: typeof templateValue.id === 'string' && templateValue.id.trim().length > 0 ? templateValue.id.trim() : `template-${now}`,
    name: parseTemplateName(templateValue.name),
    category,
    nodes,
    edges,
    createdAt: typeof templateValue.createdAt === 'string' ? templateValue.createdAt : now,
    updatedAt: typeof templateValue.updatedAt === 'string' ? templateValue.updatedAt : now
  };

  return {
    document: buildCanvasTemplateDocument(template),
    warnings
  };
}

export function summarizeCanvasTemplateNodes(template: Pick<CanvasTemplate, 'nodes'>): CanvasTemplateNodeStats {
  return template.nodes.reduce<CanvasTemplateNodeStats>(
    (stats, node) => {
      if (node.kind === 'agent') {
        stats.agentCount += 1;
      } else if (node.kind === 'terminal') {
        stats.terminalCount += 1;
      } else {
        stats.noteCount += 1;
      }
      return stats;
    },
    {
      agentCount: 0,
      terminalCount: 0,
      noteCount: 0
    }
  );
}

export function formatCanvasTemplateStats(template: Pick<CanvasTemplate, 'nodes'>): string {
  const stats = summarizeCanvasTemplateNodes(template);
  const parts: string[] = [];
  if (stats.agentCount > 0) {
    parts.push(`${stats.agentCount} Agent`);
  }
  if (stats.terminalCount > 0) {
    parts.push(`${stats.terminalCount} Terminal`);
  }
  if (stats.noteCount > 0) {
    parts.push(`${stats.noteCount} Note`);
  }
  return parts.join(', ') || '0 Node';
}

export function buildCanvasTemplateNodeDetailLines(template: Pick<CanvasTemplate, 'nodes'>): string[] {
  return template.nodes.map((node) => `${humanizeTemplateNodeKind(node.kind)}: \"${node.title}\"`);
}

export function humanizeTemplateNodeKind(kind: CanvasTemplateNodeKind | CanvasCreatableNodeKind): string {
  switch (kind) {
    case 'agent':
      return 'Agent';
    case 'terminal':
      return 'Terminal';
    case 'note':
      return 'Note';
  }
}

export function sortCanvasTemplates<T extends { template: Pick<CanvasTemplate, 'category' | 'createdAt' | 'name'> } & CanvasTemplateSortMetadata>(
  templates: readonly T[]
): T[] {
  return templates.slice().sort((left, right) => {
    if (left.template.category !== right.template.category) {
      return left.template.category === 'builtin' ? -1 : 1;
    }

    if (left.template.category === 'builtin' && right.template.category === 'builtin') {
      return (left.builtinOrder ?? Number.MAX_SAFE_INTEGER) - (right.builtinOrder ?? Number.MAX_SAFE_INTEGER);
    }

    const leftCreatedAt = Date.parse(left.template.createdAt);
    const rightCreatedAt = Date.parse(right.template.createdAt);
    if (Number.isFinite(leftCreatedAt) && Number.isFinite(rightCreatedAt) && leftCreatedAt !== rightCreatedAt) {
      return rightCreatedAt - leftCreatedAt;
    }

    return left.template.name.localeCompare(right.template.name, 'zh-Hans-CN');
  });
}

export function sanitizeCanvasTemplateFileStem(name: string, fallbackId: string): string {
  const normalizedName = name.trim().replace(/\s+/g, '-');
  const safeName = normalizedName.replace(/[<>:"/\\|?*\x00-\x1F]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  const suffix = fallbackId.replace(/[^a-zA-Z0-9-]/g, '').slice(0, 12) || 'template';
  return safeName ? `${safeName}-${suffix}` : `template-${suffix}`;
}

export function cloneCanvasTemplate(template: CanvasTemplate): CanvasTemplate {
  return JSON.parse(JSON.stringify(template)) as CanvasTemplate;
}

export function normalizeCanvasTemplateWorkspaceRelativePath(value: string): string | undefined {
  const normalized = value.trim().replace(/\\/g, '/').replace(/^\.\/+/u, '');
  if (
    normalized.length === 0 ||
    normalized.startsWith('/') ||
    /^[A-Za-z]:/u.test(normalized) ||
    /^[A-Za-z][A-Za-z0-9+.-]*:/u.test(normalized) ||
    normalized.includes('\0')
  ) {
    return undefined;
  }

  const parts = normalized.split('/');
  if (parts.some((part) => part.length === 0 || part === '.' || part === '..')) {
    return undefined;
  }

  return parts.join('/');
}

export function captureCanvasTemplateFromState(params: {
  state: CanvasPrototypeState;
  name: string;
  templateId: string;
  category: CanvasTemplateCategory;
  agentProviderSelection: CanvasTemplateSaveAgentProviderSelection;
  associatedNoteSaveSelection?: Readonly<Record<string, CanvasTemplateAssociatedNoteSaveSelection>>;
  now?: string;
}): CanvasTemplateCaptureResult {
  const associatedNoteSaveSelection = params.associatedNoteSaveSelection ?? {};
  const compatibleNodes = params.state.nodes.filter(
    (node): node is CanvasPrototypeState['nodes'][number] & { kind: CanvasTemplateNodeKind } =>
      isCanvasTemplateCompatibleNode(node)
  );
  if (compatibleNodes.length === 0) {
    throw new Error('当前画布没有可保存到模板的 Agent / Terminal / Note 节点。');
  }

  const ignoredNodeIds = params.state.nodes
    .filter((node) => !isCanvasTemplateNodeKind(node.kind))
    .map((node) => node.id);

  const minX = Math.min(...compatibleNodes.map((node) => node.position.x));
  const minY = Math.min(...compatibleNodes.map((node) => node.position.y));
  const nodeIndexById = new Map(compatibleNodes.map((node, index) => [node.id, index] as const));

  const templateNodes = compatibleNodes.map<CanvasTemplateNodeSnapshot>((node) => {
    const templateArgvValue = node.metadata?.agent?.templateArgv;
    const templateArgv = Array.isArray(templateArgvValue)
      ? templateArgvValue.filter(
          (entry): entry is string => typeof entry === 'string' && entry.trim().length > 0
        )
      : undefined;

    return {
      kind: node.kind,
      title: node.title,
      position: {
        x: Math.round(node.position.x - minX),
        y: Math.round(node.position.y - minY)
      },
      size: {
        width: Math.max(120, Math.round(node.size.width)),
        height: Math.max(80, Math.round(node.size.height))
      },
      metadata:
        node.kind === 'note'
          ? {
              note: buildCanvasTemplateNoteMetadata(node, associatedNoteSaveSelection[node.id])
            }
          : node.kind === 'agent'
            ? {
                agent: {
                  argv: templateArgv,
                  provider: resolveTemplateSaveAgentProvider(node.id, node.metadata?.agent?.provider, params.agentProviderSelection)
                }
              }
            : undefined
    };
  });

  const ignoredEdgeIds: string[] = [];
  const templateEdges: CanvasTemplateEdgeSnapshot[] = [];
  for (const edge of params.state.edges) {
    if (edge.owner !== 'user') {
      ignoredEdgeIds.push(edge.id);
      continue;
    }

    const sourceNodeIndex = nodeIndexById.get(edge.sourceNodeId);
    const targetNodeIndex = nodeIndexById.get(edge.targetNodeId);
    if (sourceNodeIndex === undefined || targetNodeIndex === undefined) {
      ignoredEdgeIds.push(edge.id);
      continue;
    }

    templateEdges.push({
      sourceNodeIndex,
      targetNodeIndex,
      sourceAnchor: edge.sourceAnchor,
      targetAnchor: edge.targetAnchor,
      arrowMode: edge.arrowMode,
      color: edge.color,
      label: edge.label
    });
  }

  const now = params.now ?? new Date().toISOString();
  return {
    template: {
      id: params.templateId,
      name: parseTemplateName(params.name),
      category: params.category,
      nodes: templateNodes,
      edges: templateEdges,
      createdAt: now,
      updatedAt: now
    },
    ignoredNodeIds,
    ignoredEdgeIds
  };
}

function buildCanvasTemplateNoteMetadata(
  node: CanvasPrototypeState['nodes'][number],
  selection: CanvasTemplateAssociatedNoteSaveSelection | undefined
): CanvasTemplateNoteMetadata {
  const fallbackContent = node.metadata?.note?.content ?? '';
  if (!selection || selection.mode === 'embedded-snapshot') {
    return {
      content: selection?.content ?? fallbackContent
    };
  }

  const relativePath = normalizeCanvasTemplateWorkspaceRelativePath(selection.relativePath ?? '');
  if (!relativePath) {
    throw new Error(`关联 Markdown Note「${node.title}」缺少合法 workspace 相对路径。`);
  }

  if (selection.mode === 'workspace-file-path-only') {
    return {
      content: '',
      templateContentMode: selection.mode,
      relativePath
    };
  }

  return {
    content: selection.content ?? fallbackContent,
    templateContentMode: selection.mode,
    relativePath
  };
}

function resolveTemplateSaveAgentProvider(
  nodeId: string,
  currentProvider: AgentProviderKind | undefined,
  selection: CanvasTemplateSaveAgentProviderSelection
): CanvasTemplateAgentProviderKind {
  if (typeof selection === 'string') {
    if (selection === 'default') {
      return 'default';
    }

    return currentProvider === 'claude' ? 'claude' : 'codex';
  }

  const selectedProvider = selection[nodeId];
  return isCanvasTemplateAgentProviderKind(selectedProvider) ? selectedProvider : 'default';
}

export function resolveCanvasTemplateAgentProvider(
  provider: CanvasTemplateAgentProviderKind,
  defaultProvider: AgentProviderKind
): AgentProviderKind {
  if (provider === 'default') {
    return defaultProvider;
  }

  return provider === 'claude' ? 'claude' : 'codex';
}

function isCanvasTemplateCompatibleNode(
  node: CanvasPrototypeState['nodes'][number]
): node is CanvasPrototypeState['nodes'][number] & { kind: CanvasTemplateNodeKind } {
  return isCanvasTemplateNodeKind(node.kind);
}

function parseTemplateNodes(value: unknown, warnings: string[]): CanvasTemplateNodeSnapshot[] {
  if (!Array.isArray(value)) {
    throw new Error('模板 nodes 字段不是数组。');
  }

  return value.map((node, index) => parseTemplateNode(node, index, warnings));
}

function parseTemplateNode(value: unknown, index: number, warnings: string[]): CanvasTemplateNodeSnapshot {
  if (!isRecord(value) || !isCanvasTemplateNodeKind(value.kind)) {
    throw new Error(`模板第 ${index + 1} 个节点缺少合法 kind。`);
  }

  const title = typeof value.title === 'string' && value.title.trim().length > 0 ? value.title.trim() : `${humanizeTemplateNodeKind(value.kind)} ${index + 1}`;
  const position = parseTemplatePosition(value.position, `模板节点 ${title}`);
  const size = parseTemplateSize(value.size, `模板节点 ${title}`);
  const metadataRecord = isRecord(value.metadata) ? value.metadata : undefined;

  if (value.kind === 'note') {
    const noteRecord = metadataRecord && isRecord(metadataRecord.note) ? metadataRecord.note : undefined;
    const contentModeValue = noteRecord?.templateContentMode;
    const templateContentMode = contentModeValue === undefined
      ? 'embedded-snapshot'
      : isCanvasTemplateNoteContentMode(contentModeValue)
        ? contentModeValue
        : undefined;
    if (!templateContentMode) {
      throw new Error(`模板节点 ${title} 的 Note 内容模式不受支持。`);
    }

    const relativePath =
      templateContentMode === 'embedded-snapshot'
        ? undefined
        : normalizeCanvasTemplateWorkspaceRelativePath(typeof noteRecord?.relativePath === 'string' ? noteRecord.relativePath : '');
    if (templateContentMode !== 'embedded-snapshot' && !relativePath) {
      throw new Error(`模板节点 ${title} 缺少合法 workspace 相对 Markdown 路径。`);
    }

    const content = typeof noteRecord?.content === 'string' ? noteRecord.content : '';
    const noteMetadata: CanvasTemplateNoteMetadata = {
      content: templateContentMode === 'workspace-file-path-only' ? '' : content
    };
    if (templateContentMode !== 'embedded-snapshot') {
      noteMetadata.templateContentMode = templateContentMode;
      noteMetadata.relativePath = relativePath;
    }
    return {
      kind: value.kind,
      title,
      position,
      size,
      metadata: {
        note: noteMetadata
      }
    };
  }

  if (value.kind === 'agent') {
    const providerValue = metadataRecord && isRecord(metadataRecord.agent) ? metadataRecord.agent.provider : undefined;
    const argvValue = metadataRecord && isRecord(metadataRecord.agent) ? metadataRecord.agent.argv : undefined;
    return {
      kind: value.kind,
      title,
      position,
      size,
      metadata: {
        agent: {
          provider: isCanvasTemplateAgentProviderKind(providerValue) ? providerValue : 'default',
          argv: Array.isArray(argvValue)
            ? argvValue.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
            : undefined
        }
      }
    };
  }

  if (metadataRecord && 'agent' in metadataRecord) {
    warnings.push(`模板节点 ${title} 不是 Agent，已忽略 agent metadata。`);
  }

  if (metadataRecord && 'note' in metadataRecord) {
    warnings.push(`模板节点 ${title} 不是 Note，已忽略 note metadata。`);
  }

  return {
    kind: value.kind,
    title,
    position,
    size
  };
}

function parseTemplateEdges(value: unknown, nodeCount: number): CanvasTemplateEdgeSnapshot[] {
  if (value === undefined) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw new Error('模板 edges 字段不是数组。');
  }

  return value.map((edge, index) => parseTemplateEdge(edge, index, nodeCount));
}

function parseTemplateEdge(value: unknown, index: number, nodeCount: number): CanvasTemplateEdgeSnapshot {
  if (!isRecord(value)) {
    throw new Error(`模板第 ${index + 1} 条边不是有效对象。`);
  }

  const sourceNodeIndex = typeof value.sourceNodeIndex === 'number' ? Math.trunc(value.sourceNodeIndex) : NaN;
  const targetNodeIndex = typeof value.targetNodeIndex === 'number' ? Math.trunc(value.targetNodeIndex) : NaN;
  if (
    !Number.isInteger(sourceNodeIndex) ||
    !Number.isInteger(targetNodeIndex) ||
    sourceNodeIndex < 0 ||
    targetNodeIndex < 0 ||
    sourceNodeIndex >= nodeCount ||
    targetNodeIndex >= nodeCount
  ) {
    throw new Error(`模板第 ${index + 1} 条边引用了不存在的节点索引。`);
  }

  if (!isCanvasEdgeAnchor(value.sourceAnchor) || !isCanvasEdgeAnchor(value.targetAnchor)) {
    throw new Error(`模板第 ${index + 1} 条边缺少合法 anchor。`);
  }

  return {
    sourceNodeIndex,
    targetNodeIndex,
    sourceAnchor: value.sourceAnchor,
    targetAnchor: value.targetAnchor,
    arrowMode: normalizeCanvasEdgeArrowMode(value.arrowMode),
    color: typeof value.color === 'string' ? (value.color as CanvasEdgeColor) : undefined,
    label: typeof value.label === 'string' ? value.label : undefined
  };
}

function parseTemplateName(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error('模板名称不能为空。');
  }
  return value.trim();
}

function parseTemplatePosition(value: unknown, label: string): CanvasNodePosition {
  if (!isRecord(value) || typeof value.x !== 'number' || typeof value.y !== 'number') {
    throw new Error(`${label} 缺少合法 position。`);
  }
  return {
    x: Math.round(value.x),
    y: Math.round(value.y)
  };
}

function parseTemplateSize(value: unknown, label: string): CanvasNodeFootprint {
  if (!isRecord(value) || typeof value.width !== 'number' || typeof value.height !== 'number') {
    throw new Error(`${label} 缺少合法 size。`);
  }
  return {
    width: Math.max(120, Math.round(value.width)),
    height: Math.max(80, Math.round(value.height))
  };
}

function resolveTemplateCategory(value: unknown, fallback: CanvasTemplateCategory | undefined): CanvasTemplateCategory {
  if (isCanvasTemplateCategory(value)) {
    return value;
  }

  return fallback ?? 'user';
}

function normalizeCanvasEdgeArrowMode(value: unknown): CanvasEdgeArrowMode {
  return value === 'both' || value === 'forward' ? value : 'none';
}

function isCanvasEdgeAnchor(value: unknown): value is CanvasEdgeAnchor {
  return value === 'top' || value === 'right' || value === 'bottom' || value === 'left';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
