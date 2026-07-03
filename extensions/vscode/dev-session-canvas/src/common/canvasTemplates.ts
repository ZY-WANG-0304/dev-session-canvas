import type {
  AgentProviderKind,
  CanvasCreatableNodeKind,
  CanvasEdgeAnchor,
  CanvasEdgeArrowMode,
  CanvasEdgeColor,
  CanvasGroupSummary,
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
  groupIndex?: number;
  metadata?: {
    note?: CanvasTemplateNoteMetadata;
    agent?: CanvasTemplateAgentMetadata;
  };
}

export interface CanvasTemplateGroupSnapshot {
  title: string;
  position: CanvasNodePosition;
  size: CanvasNodeFootprint;
  parentGroupIndex?: number;
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
  groups?: CanvasTemplateGroupSnapshot[];
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
  warningDescriptors: CanvasTemplateMessageDescriptor[];
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

export type CanvasTemplateMessageId =
  | 'documentNotObject'
  | 'unsupportedVersion'
  | 'missingVersion'
  | 'missingTemplateBody'
  | 'emptyTemplate'
  | 'noCompatibleNodesForSave'
  | 'associatedNoteRelativePathInvalid'
  | 'nodesNotArray'
  | 'nodeKindInvalid'
  | 'nodeGroupIndexMissing'
  | 'noteContentModeUnsupported'
  | 'noteRelativePathInvalid'
  | 'nonAgentMetadataIgnored'
  | 'nonNoteMetadataIgnored'
  | 'groupsNotArray'
  | 'groupInvalidObject'
  | 'groupParentIndexMissing'
  | 'groupParentSelf'
  | 'groupParentCycle'
  | 'edgesNotArray'
  | 'edgeInvalidObject'
  | 'edgeNodeIndexMissing'
  | 'edgeAnchorMissing'
  | 'templateNameEmpty'
  | 'positionMissing'
  | 'sizeMissing'
  | 'templateJsonInvalid'
  | 'marketplacePackageTemplatePathUnsafe'
  | 'marketplacePackageTemplateMissing'
  | 'marketplacePackageEntryPathUnsafe'
  | 'userTemplatePathOutsideDirectory'
  | 'marketplacePackageSidecarInvalid'
  | 'marketplacePackageSidecarTemplatePathUnsafe'
  | 'templateHierarchyDotSegment'
  | 'templateHierarchyIllegalPathCharacter'
  | 'utf8Invalid';

export interface CanvasTemplateMessageDescriptor {
  id: CanvasTemplateMessageId;
  params?: Record<string, string>;
}

const CANVAS_TEMPLATE_MESSAGE_IDS = new Set<string>([
  'documentNotObject',
  'unsupportedVersion',
  'missingVersion',
  'missingTemplateBody',
  'emptyTemplate',
  'noCompatibleNodesForSave',
  'associatedNoteRelativePathInvalid',
  'nodesNotArray',
  'nodeKindInvalid',
  'nodeGroupIndexMissing',
  'noteContentModeUnsupported',
  'noteRelativePathInvalid',
  'nonAgentMetadataIgnored',
  'nonNoteMetadataIgnored',
  'groupsNotArray',
  'groupInvalidObject',
  'groupParentIndexMissing',
  'groupParentSelf',
  'groupParentCycle',
  'edgesNotArray',
  'edgeInvalidObject',
  'edgeNodeIndexMissing',
  'edgeAnchorMissing',
  'templateNameEmpty',
  'positionMissing',
  'sizeMissing',
  'templateJsonInvalid',
  'marketplacePackageTemplatePathUnsafe',
  'marketplacePackageTemplateMissing',
  'marketplacePackageEntryPathUnsafe',
  'userTemplatePathOutsideDirectory',
  'marketplacePackageSidecarInvalid',
  'marketplacePackageSidecarTemplatePathUnsafe',
  'templateHierarchyDotSegment',
  'templateHierarchyIllegalPathCharacter',
  'utf8Invalid'
]);

export class CanvasTemplateError extends Error {
  public readonly code = 'DEV_SESSION_CANVAS_TEMPLATE_ERROR';

  public constructor(public readonly descriptor: CanvasTemplateMessageDescriptor) {
    super(formatCanvasTemplateMessageDescriptor(descriptor));
    this.name = 'CanvasTemplateError';
  }
}

export function createCanvasTemplateError(descriptor: CanvasTemplateMessageDescriptor): CanvasTemplateError {
  return new CanvasTemplateError(descriptor);
}

export function getCanvasTemplateErrorDescriptor(error: unknown): CanvasTemplateMessageDescriptor | undefined {
  if (!isCanvasTemplateError(error)) {
    return undefined;
  }

  const descriptor = error.descriptor;
  return isCanvasTemplateMessageDescriptor(descriptor) ? descriptor : undefined;
}

export function formatCanvasTemplateMessageDescriptor(descriptor: CanvasTemplateMessageDescriptor): string {
  const params = descriptor.params ?? {};
  switch (descriptor.id) {
    case 'documentNotObject':
      return 'Template file is not a valid JSON object.';
    case 'unsupportedVersion':
      return `Template version ${params.version ?? '<unknown>'} is not compatible with the current extension.`;
    case 'missingVersion':
      return 'Template file is missing a supported version field.';
    case 'missingTemplateBody':
      return 'Template file is missing the template body.';
    case 'emptyTemplate':
      return 'Template must contain at least one node.';
    case 'noCompatibleNodesForSave':
      return 'The current Canvas has no Agent / Terminal / Note nodes that can be saved as a template.';
    case 'associatedNoteRelativePathInvalid':
      return `Associated Markdown Note "${params.title ?? '<unknown>'}" is missing a valid workspace-relative path.`;
    case 'nodesNotArray':
      return 'Template nodes field must be an array.';
    case 'nodeKindInvalid':
      return `Template node ${params.index ?? '<unknown>'} is missing a valid kind.`;
    case 'nodeGroupIndexMissing':
      return `Template node ${params.index ?? '<unknown>'} references a missing group index.`;
    case 'noteContentModeUnsupported':
      return `Template node "${params.title ?? '<unknown>'}" uses an unsupported Note content mode.`;
    case 'noteRelativePathInvalid':
      return `Template node "${params.title ?? '<unknown>'}" is missing a valid workspace-relative Markdown path.`;
    case 'nonAgentMetadataIgnored':
      return `Template node "${params.title ?? '<unknown>'}" is not an Agent, so agent metadata was ignored.`;
    case 'nonNoteMetadataIgnored':
      return `Template node "${params.title ?? '<unknown>'}" is not a Note, so note metadata was ignored.`;
    case 'groupsNotArray':
      return 'Template groups field must be an array.';
    case 'groupInvalidObject':
      return `Template group ${params.index ?? '<unknown>'} is not a valid object.`;
    case 'groupParentIndexMissing':
      return `Template group ${params.index ?? '<unknown>'} references a missing parent group index.`;
    case 'groupParentSelf':
      return `Template group ${params.index ?? '<unknown>'} cannot reference itself as its parent group.`;
    case 'groupParentCycle':
      return `Template group ${params.index ?? '<unknown>'} creates a cyclic parent-child relationship.`;
    case 'edgesNotArray':
      return 'Template edges field must be an array.';
    case 'edgeInvalidObject':
      return `Template edge ${params.index ?? '<unknown>'} is not a valid object.`;
    case 'edgeNodeIndexMissing':
      return `Template edge ${params.index ?? '<unknown>'} references a missing node index.`;
    case 'edgeAnchorMissing':
      return `Template edge ${params.index ?? '<unknown>'} is missing a valid anchor.`;
    case 'templateNameEmpty':
      return 'Template name cannot be empty.';
    case 'positionMissing':
      return `${formatCanvasTemplateMessageSubject(params)} is missing a valid position.`;
    case 'sizeMissing':
      return `${formatCanvasTemplateMessageSubject(params)} is missing a valid size.`;
    case 'templateJsonInvalid':
      return `Template file is not valid JSON: ${params.message ?? '<unknown>'}`;
    case 'marketplacePackageTemplatePathUnsafe':
      return `Full template package path is unsafe: ${params.path ?? '<unknown>'}`;
    case 'marketplacePackageTemplateMissing':
      return `Full template package is missing ${params.path ?? '<unknown>'}.`;
    case 'marketplacePackageEntryPathUnsafe':
      return `Full template package path is unsafe: ${params.path ?? '<unknown>'}`;
    case 'userTemplatePathOutsideDirectory':
      return `User template path is outside the template directory: ${params.path ?? '<unknown>'}`;
    case 'marketplacePackageSidecarInvalid':
      return 'Marketplace template package sidecar could not be recognized.';
    case 'marketplacePackageSidecarTemplatePathUnsafe':
      return `templatePath in the marketplace template package sidecar is unsafe: ${params.path ?? '<unknown>'}`;
    case 'templateHierarchyDotSegment':
      return 'Template hierarchy cannot contain . or .. segments.';
    case 'templateHierarchyIllegalPathCharacter':
      return `Template hierarchy "${params.segment ?? '<unknown>'}" contains invalid path characters.`;
    case 'utf8Invalid':
      return `${params.path ?? '<unknown>'} is not valid UTF-8 text.`;
    default:
      return 'Canvas template operation failed.';
  }
}

function isCanvasTemplateError(error: unknown): error is CanvasTemplateError {
  return error instanceof CanvasTemplateError ||
    (isRecord(error) && error.code === 'DEV_SESSION_CANVAS_TEMPLATE_ERROR');
}

function isCanvasTemplateMessageDescriptor(value: unknown): value is CanvasTemplateMessageDescriptor {
  if (!isRecord(value) || typeof value.id !== 'string' || !CANVAS_TEMPLATE_MESSAGE_IDS.has(value.id)) {
    return false;
  }

  return value.params === undefined || isStringRecord(value.params);
}

function formatCanvasTemplateMessageSubject(params: Record<string, string>): string {
  switch (params.subjectId) {
    case 'templateNode':
      return `Template node "${params.title ?? params.index ?? '<unknown>'}"`;
    case 'templateGroup':
      return `Template group ${params.index ?? '<unknown>'}`;
    default:
      return params.label ?? 'Template item';
  }
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
    throw createCanvasTemplateError({ id: 'documentNotObject' });
  }

  if (value.version !== CANVAS_TEMPLATE_DOCUMENT_VERSION) {
    throw createCanvasTemplateError(
      typeof value.version === 'number'
        ? {
            id: 'unsupportedVersion',
            params: { version: String(value.version) }
          }
        : { id: 'missingVersion' }
    );
  }

  const templateValue = isRecord(value.template) ? value.template : null;
  if (!templateValue) {
    throw createCanvasTemplateError({ id: 'missingTemplateBody' });
  }

  const warnings: string[] = [];
  const warningDescriptors: CanvasTemplateMessageDescriptor[] = [];
  const category = options.forceCategory ?? resolveTemplateCategory(templateValue.category, options.defaultCategory);
  const now = new Date().toISOString();
  const groups = parseTemplateGroups(templateValue.groups);
  const nodes = parseTemplateNodes(templateValue.nodes, warnings, warningDescriptors, groups.length);
  const edges = parseTemplateEdges(templateValue.edges, nodes.length);

  if (nodes.length === 0) {
    throw createCanvasTemplateError({ id: 'emptyTemplate' });
  }

  const template: CanvasTemplate = {
    id: typeof templateValue.id === 'string' && templateValue.id.trim().length > 0 ? templateValue.id.trim() : `template-${now}`,
    name: parseTemplateName(templateValue.name),
    category,
    nodes,
    edges,
    ...(groups.length > 0 ? { groups } : {}),
    createdAt: typeof templateValue.createdAt === 'string' ? templateValue.createdAt : now,
    updatedAt: typeof templateValue.updatedAt === 'string' ? templateValue.updatedAt : now
  };

  return {
    document: buildCanvasTemplateDocument(template),
    warnings,
    warningDescriptors
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
    throw createCanvasTemplateError({ id: 'noCompatibleNodesForSave' });
  }

  const ignoredNodeIds = params.state.nodes
    .filter((node) => !isCanvasTemplateNodeKind(node.kind))
    .map((node) => node.id);

  const minX = Math.min(...compatibleNodes.map((node) => node.position.x));
  const minY = Math.min(...compatibleNodes.map((node) => node.position.y));
  const nodeIndexById = new Map(compatibleNodes.map((node, index) => [node.id, index] as const));

  const compatibleNodeIds = new Set(compatibleNodes.map((node) => node.id));
  const capturedGroups = captureCanvasTemplateGroups(params.state, compatibleNodeIds, minX, minY);
  const groupIndexById = new Map(capturedGroups.map((group, index) => [group.id, index] as const));

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
      ...(node.groupId && groupIndexById.get(node.groupId) !== undefined
        ? { groupIndex: groupIndexById.get(node.groupId) }
        : {}),
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
      ...(capturedGroups.length > 0 ? { groups: capturedGroups.map((group) => group.snapshot) } : {}),
      createdAt: now,
      updatedAt: now
    },
    ignoredNodeIds,
    ignoredEdgeIds
  };
}

function captureCanvasTemplateGroups(
  state: CanvasPrototypeState,
  compatibleNodeIds: ReadonlySet<string>,
  minX: number,
  minY: number
): Array<{ id: string; snapshot: CanvasTemplateGroupSnapshot }> {
  const groups = state.groups ?? [];
  const groupIdsWithCompatibleNodes = new Set(
    state.nodes
      .filter((node) => node.groupId && compatibleNodeIds.has(node.id))
      .map((node) => node.groupId as string)
  );
  const retainedGroupIds = new Set<string>();
  for (const groupId of groupIdsWithCompatibleNodes) {
    let currentGroup = groups.find((group) => group.id === groupId);
    const visited = new Set<string>();
    while (currentGroup && !visited.has(currentGroup.id)) {
      retainedGroupIds.add(currentGroup.id);
      visited.add(currentGroup.id);
      currentGroup = currentGroup.parentGroupId
        ? groups.find((candidate) => candidate.id === currentGroup?.parentGroupId)
        : undefined;
    }
  }

  const retainedGroups = groups.filter((group) => retainedGroupIds.has(group.id));
  const groupIndexById = new Map(retainedGroups.map((group, index) => [group.id, index] as const));
  return retainedGroups.map((group) => ({
    id: group.id,
    snapshot: {
      title: group.title,
      position: {
        x: Math.round(group.position.x - minX),
        y: Math.round(group.position.y - minY)
      },
      size: {
        width: Math.max(120, Math.round(group.size.width)),
        height: Math.max(80, Math.round(group.size.height))
      },
      parentGroupIndex: group.parentGroupId ? groupIndexById.get(group.parentGroupId) : undefined
    }
  }));
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
    throw createCanvasTemplateError({
      id: 'associatedNoteRelativePathInvalid',
      params: { title: node.title }
    });
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

function parseTemplateNodes(
  value: unknown,
  warnings: string[],
  warningDescriptors: CanvasTemplateMessageDescriptor[],
  groupCount: number
): CanvasTemplateNodeSnapshot[] {
  if (!Array.isArray(value)) {
    throw createCanvasTemplateError({ id: 'nodesNotArray' });
  }

  return value.map((node, index) => parseTemplateNode(node, index, warnings, warningDescriptors, groupCount));
}

function parseTemplateNode(
  value: unknown,
  index: number,
  warnings: string[],
  warningDescriptors: CanvasTemplateMessageDescriptor[],
  groupCount: number
): CanvasTemplateNodeSnapshot {
  if (!isRecord(value) || !isCanvasTemplateNodeKind(value.kind)) {
    throw createCanvasTemplateError({
      id: 'nodeKindInvalid',
      params: { index: String(index + 1) }
    });
  }

  const title = typeof value.title === 'string' && value.title.trim().length > 0 ? value.title.trim() : `${humanizeTemplateNodeKind(value.kind)} ${index + 1}`;
  const subject = { subjectId: 'templateNode', title };
  const position = parseTemplatePosition(value.position, subject);
  const size = parseTemplateSize(value.size, subject);
  const metadataRecord = isRecord(value.metadata) ? value.metadata : undefined;
  const groupIndex = normalizeTemplateGroupIndex(value.groupIndex);
  if (groupIndex !== undefined && groupIndex >= groupCount) {
    throw createCanvasTemplateError({
      id: 'nodeGroupIndexMissing',
      params: { index: String(index + 1) }
    });
  }

  if (value.kind === 'note') {
    const noteRecord = metadataRecord && isRecord(metadataRecord.note) ? metadataRecord.note : undefined;
    const contentModeValue = noteRecord?.templateContentMode;
    const templateContentMode = contentModeValue === undefined
      ? 'embedded-snapshot'
      : isCanvasTemplateNoteContentMode(contentModeValue)
        ? contentModeValue
        : undefined;
    if (!templateContentMode) {
      throw createCanvasTemplateError({
        id: 'noteContentModeUnsupported',
        params: { title }
      });
    }

    const relativePath =
      templateContentMode === 'embedded-snapshot'
        ? undefined
        : normalizeCanvasTemplateWorkspaceRelativePath(typeof noteRecord?.relativePath === 'string' ? noteRecord.relativePath : '');
    if (templateContentMode !== 'embedded-snapshot' && !relativePath) {
      throw createCanvasTemplateError({
        id: 'noteRelativePathInvalid',
        params: { title }
      });
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
      ...(groupIndex !== undefined ? { groupIndex } : {}),
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
      ...(groupIndex !== undefined ? { groupIndex } : {}),
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
    pushCanvasTemplateWarning(warnings, warningDescriptors, {
      id: 'nonAgentMetadataIgnored',
      params: { title }
    });
  }

  if (metadataRecord && 'note' in metadataRecord) {
    pushCanvasTemplateWarning(warnings, warningDescriptors, {
      id: 'nonNoteMetadataIgnored',
      params: { title }
    });
  }

  return {
    kind: value.kind,
    title,
    position,
    size,
    ...(groupIndex !== undefined ? { groupIndex } : {})
  };
}

function normalizeTemplateGroupIndex(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    return undefined;
  }

  return value;
}

function parseTemplateGroups(value: unknown): CanvasTemplateGroupSnapshot[] {
  if (value === undefined) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw createCanvasTemplateError({ id: 'groupsNotArray' });
  }

  const groups = value.map((group, index) => parseTemplateGroup(group, index, value.length));
  assertTemplateGroupParentGraphIsAcyclic(groups);
  return groups;
}

function parseTemplateGroup(value: unknown, index: number, groupCount: number): CanvasTemplateGroupSnapshot {
  if (!isRecord(value)) {
    throw createCanvasTemplateError({
      id: 'groupInvalidObject',
      params: { index: String(index + 1) }
    });
  }

  const parentGroupIndex = normalizeTemplateGroupIndex(value.parentGroupIndex);
  if (parentGroupIndex !== undefined && parentGroupIndex >= groupCount) {
    throw createCanvasTemplateError({
      id: 'groupParentIndexMissing',
      params: { index: String(index + 1) }
    });
  }
  if (parentGroupIndex === index) {
    throw createCanvasTemplateError({
      id: 'groupParentSelf',
      params: { index: String(index + 1) }
    });
  }

  return {
    title: typeof value.title === 'string' && value.title.trim() ? value.title.trim() : `Group ${index + 1}`,
    position: parseTemplatePosition(value.position, { subjectId: 'templateGroup', index: String(index + 1) }),
    size: parseTemplateSize(value.size, { subjectId: 'templateGroup', index: String(index + 1) }),
    parentGroupIndex
  };
}

function assertTemplateGroupParentGraphIsAcyclic(groups: readonly CanvasTemplateGroupSnapshot[]): void {
  for (const [index] of groups.entries()) {
    const visited = new Set<number>();
    let nextParentIndex = groups[index]?.parentGroupIndex;

    while (nextParentIndex !== undefined) {
      if (visited.has(nextParentIndex)) {
        throw createCanvasTemplateError({
          id: 'groupParentCycle',
          params: { index: String(index + 1) }
        });
      }

      visited.add(nextParentIndex);
      nextParentIndex = groups[nextParentIndex]?.parentGroupIndex;
    }
  }
}

function parseTemplateEdges(value: unknown, nodeCount: number): CanvasTemplateEdgeSnapshot[] {
  if (value === undefined) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw createCanvasTemplateError({ id: 'edgesNotArray' });
  }

  return value.map((edge, index) => parseTemplateEdge(edge, index, nodeCount));
}

function parseTemplateEdge(value: unknown, index: number, nodeCount: number): CanvasTemplateEdgeSnapshot {
  if (!isRecord(value)) {
    throw createCanvasTemplateError({
      id: 'edgeInvalidObject',
      params: { index: String(index + 1) }
    });
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
    throw createCanvasTemplateError({
      id: 'edgeNodeIndexMissing',
      params: { index: String(index + 1) }
    });
  }

  if (!isCanvasEdgeAnchor(value.sourceAnchor) || !isCanvasEdgeAnchor(value.targetAnchor)) {
    throw createCanvasTemplateError({
      id: 'edgeAnchorMissing',
      params: { index: String(index + 1) }
    });
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
    throw createCanvasTemplateError({ id: 'templateNameEmpty' });
  }
  return value.trim();
}

function pushCanvasTemplateWarning(
  warnings: string[],
  warningDescriptors: CanvasTemplateMessageDescriptor[],
  descriptor: CanvasTemplateMessageDescriptor
): void {
  warningDescriptors.push(descriptor);
  warnings.push(formatCanvasTemplateMessageDescriptor(descriptor));
}

function parseTemplatePosition(value: unknown, subject: Record<string, string>): CanvasNodePosition {
  if (!isRecord(value) || typeof value.x !== 'number' || typeof value.y !== 'number') {
    throw createCanvasTemplateError({
      id: 'positionMissing',
      params: subject
    });
  }
  return {
    x: Math.round(value.x),
    y: Math.round(value.y)
  };
}

function parseTemplateSize(value: unknown, subject: Record<string, string>): CanvasNodeFootprint {
  if (!isRecord(value) || typeof value.width !== 'number' || typeof value.height !== 'number') {
    throw createCanvasTemplateError({
      id: 'sizeMissing',
      params: subject
    });
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

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((entry) => typeof entry === 'string');
}
