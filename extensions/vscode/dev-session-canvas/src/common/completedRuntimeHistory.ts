import type { ExecutionNodeKind } from './protocol';

/** Only stream-backed legacy completions have an unambiguous Supervisor origin. */
export function normalizeCompletedRuntimeHistory(
  kind: ExecutionNodeKind,
  metadata: Record<string, unknown>,
  nodeStatus?: string
): Record<string, unknown> {
  const lifecycle = metadata.lifecycle ?? nodeStatus;
  const ended = kind === 'agent'
    ? lifecycle === 'stopped' || lifecycle === 'error' || lifecycle === 'resume-failed'
    : lifecycle === 'closed' || lifecycle === 'error';
  const stream = metadata.terminalStream;
  const legacyCompleted = metadata.persistenceMode === 'snapshot-only' && ended &&
    typeof stream === 'object' && stream !== null && 'version' in stream && stream.version === 1;
  if (metadata.liveSession === true || metadata.liveRun === true || metadata.attachmentState === 'reattaching' ||
      (metadata.terminalHistoryDiscarded !== true && !legacyCompleted)) {
    return metadata;
  }
  return {
    ...metadata,
    terminalHistoryDiscarded: true,
    persistenceMode: 'snapshot-only',
    attachmentState: 'history-restored',
    liveSession: false,
    runtimeSessionId: undefined,
    runtimeStoragePath: undefined,
    runtimeOwner: undefined,
    runtimeBackend: undefined,
    runtimeGuarantee: undefined,
    terminalProjectionMode: undefined,
    pendingLaunch: undefined,
    autoStartPending: undefined,
    recentOutput: undefined,
    lastResponse: undefined,
    terminalTitle: undefined,
    outputSequence: undefined,
    serializedTerminalState: undefined,
    terminalStream: undefined
  };
}
