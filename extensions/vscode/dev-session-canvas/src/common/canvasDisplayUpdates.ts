import type { CanvasNodeSummary, CanvasPrototypeState, CanvasRuntimeContext } from './protocol';

export interface CanvasDisplaySnapshot {
  state: CanvasPrototypeState;
  runtime: CanvasRuntimeContext;
  revision?: number;
}
export interface CanvasLayoutAcknowledgement { nodes?: string[]; groups?: string[] }
const runtimeGroups = {
  terminal: ['executionMouseDiagnosticsEnabled', 'strongTerminalAttentionReminderMode', 'terminalScrollback',
    'editorMultiCursorModifier', 'terminalWordSeparators'],
  presentation: ['overviewMode', 'overviewZoomThreshold', 'multiRootPresentationMode', 'workspaceRootWatermarksEnabled',
    'filePresentationMode', 'fileNodeDisplayStyle', 'fileNodeDisplayMode', 'filePathDisplayMode'],
  workspace: ['surfaceLocation', 'workspaceFolders', 'fileIconFontFaces', 'noteMarkdownImageWorkspaceRoots'],
  launch: ['workspaceTrusted', 'defaultAgentProvider', 'agentLaunchDefaults']
} as const satisfies Record<string, readonly (keyof CanvasRuntimeContext)[]>;
type RuntimeGroup = keyof typeof runtimeGroups;
// Adding a runtime field requires assigning it to an explicit transport group.
const runtimeGroupCoverage: Exclude<keyof CanvasRuntimeContext, typeof runtimeGroups[RuntimeGroup][number]> extends never ? true : never = true;
void runtimeGroupCoverage;
type RuntimeGroups = { [K in RuntimeGroup]?: Pick<CanvasRuntimeContext, typeof runtimeGroups[K][number]> };
export interface CanvasDisplayDelta {
  baseRevision: number;
  revision: number;
  updatedAt: string;
  nodes?: { upsert: CanvasNodeSummary[]; remove: string[]; order?: string[] };
  state?: Partial<Omit<CanvasPrototypeState, 'nodes' | 'updatedAt'>>;
  runtime?: RuntimeGroups;
  layoutAck?: CanvasLayoutAcknowledgement;
}

const equal = (a: unknown, b: unknown): boolean => a === b || JSON.stringify(a) === JSON.stringify(b);

/** These counters are owned by the terminal stream; they are not canvas display inputs. */
export function projectCanvasDisplayState(state: CanvasPrototypeState): CanvasPrototypeState {
  return { ...state, nodes: state.nodes.map(node => {
    if (node.kind !== 'agent' && node.kind !== 'terminal') return node;
    const metadata = node.metadata?.[node.kind];
    if (!metadata) return node;
    return { ...node, metadata: { ...node.metadata, [node.kind]: { ...metadata,
      outputSequence: undefined, serializedTerminalState: undefined, terminalStream: undefined } } };
  }) };
}

interface DisplayFingerprint {
  revision: number;
  nodes: Map<string, string>;
  order: string[];
  state: Map<string, string | undefined>;
  runtime: Map<RuntimeGroup, string>;
}
function fingerprint(snapshot: CanvasDisplaySnapshot): DisplayFingerprint {
  return {
    revision: snapshot.revision!,
    nodes: new Map(snapshot.state.nodes.map(node => [node.id, JSON.stringify(node)])),
    order: snapshot.state.nodes.map(node => node.id),
    state: new Map(Object.entries(snapshot.state).filter(([key]) => key !== 'nodes' && key !== 'updatedAt')
      .map(([key, value]) => [key, JSON.stringify(value)])),
    runtime: new Map((Object.keys(runtimeGroups) as RuntimeGroup[]).map(group =>
      [group, JSON.stringify(Object.fromEntries(runtimeGroups[group].map(key => [key, snapshot.runtime[key]])))]))
  };
}
function diffCanvasDisplay(before: DisplayFingerprint, after: DisplayFingerprint, snapshot: CanvasDisplaySnapshot,
  layoutAck?: CanvasLayoutAcknowledgement): CanvasDisplayDelta | undefined {
  const upsert = snapshot.state.nodes.filter(n => after.nodes.get(n.id) !== before.nodes.get(n.id));
  const remove = before.order.filter(id => !after.nodes.has(id));
  const order = equal(before.order, after.order) ? undefined : after.order;
  const state: NonNullable<CanvasDisplayDelta['state']> = {};
  for (const [key, value] of after.state) {
    if (before.state.get(key) !== value) Object.assign(state, { [key]: snapshot.state[key as keyof CanvasPrototypeState] });
  }
  const runtime: RuntimeGroups = {};
  for (const group of Object.keys(runtimeGroups) as RuntimeGroup[]) {
    if (before.runtime.get(group) !== after.runtime.get(group)) {
      Object.assign(runtime, { [group]: Object.fromEntries(runtimeGroups[group].map(key => [key, snapshot.runtime[key]])) });
    }
  }
  if (!upsert.length && !remove.length && !order && !Object.keys(state).length &&
      !Object.keys(runtime).length && !layoutAck) return;
  return { baseRevision: before.revision, revision: after.revision, updatedAt: snapshot.state.updatedAt,
    ...(upsert.length || remove.length || order ? { nodes: { upsert, remove, ...(order ? { order } : {}) } } : {}),
    ...(Object.keys(state).length ? { state } : {}), ...(Object.keys(runtime).length ? { runtime } : {}),
    ...(layoutAck ? { layoutAck } : {}) };
}

/** Apply the whole operation before publishing React state; retain unchanged object identities. */
export function applyCanvasDisplayDelta(before: CanvasDisplaySnapshot, delta: CanvasDisplayDelta): CanvasDisplaySnapshot | undefined {
  if (before.revision !== delta.baseRevision || delta.revision !== delta.baseRevision + 1) return;
  let nodes = before.state.nodes;
  if (delta.nodes) {
    const byId = new Map(nodes.map(n => [n.id, n]));
    for (const id of delta.nodes.remove) byId.delete(id);
    for (const node of delta.nodes.upsert) byId.set(node.id, node);
    if (delta.nodes.order) {
      if (delta.nodes.order.length !== byId.size || new Set(delta.nodes.order).size !== byId.size ||
          delta.nodes.order.some(id => !byId.has(id))) return;
      nodes = delta.nodes.order.map(id => byId.get(id)!);
    } else nodes = Array.from(byId.values());
  }
  let runtime = before.runtime;
  if (delta.runtime) {
    runtime = { ...runtime };
    for (const group of Object.keys(runtimeGroups) as RuntimeGroup[]) {
      const update = delta.runtime[group];
      if (!update) continue;
      // JSON omits undefined; replace every key in a present group to clear optional fields.
      for (const key of runtimeGroups[group]) Object.assign(runtime, { [key]: (update as Partial<CanvasRuntimeContext>)[key] });
    }
  }
  const state = delta.nodes || delta.state ? { ...before.state, ...delta.state, nodes, updatedAt: delta.updatedAt } : before.state;
  return { state, runtime, revision: delta.revision };
}

/** One bounded baseline per surface; no timer and no journal state. */
export class CanvasDisplayPublisher {
  private baseline?: DisplayFingerprint;
  private identity?: string;
  private revision = 0;
  invalidate(identity?: string): void { if (!identity || identity === this.identity) this.baseline = undefined; }
  publish(payload: CanvasDisplaySnapshot, identity: string, full: boolean, layoutAck?: CanvasLayoutAcknowledgement):
    { type: 'host/stateUpdated'; payload: CanvasDisplaySnapshot } | { type: 'host/stateDelta'; payload: CanvasDisplayDelta } | undefined {
    const next = { ...payload, state: projectCanvasDisplayState(payload.state), revision: this.revision + 1 };
    const current = fingerprint(next);
    const delta = !full && this.identity === identity && this.baseline
      ? diffCanvasDisplay(this.baseline, current, next, layoutAck) : undefined;
    if (!full && this.identity === identity && this.baseline && !delta) return;
    this.revision = next.revision;
    // Serialized comparison keys cannot be changed by later in-place Host mutations.
    this.baseline = current;
    this.identity = identity;
    return delta ? { type: 'host/stateDelta', payload: delta } : { type: 'host/stateUpdated', payload: next };
  }
}
