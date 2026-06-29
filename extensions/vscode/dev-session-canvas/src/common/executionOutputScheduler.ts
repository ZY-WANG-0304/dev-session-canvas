import type { ExecutionNodeKind } from './protocol';

export type ExecutionOutputSchedulerSelectionReason =
  | 'flush'
  | 'input-priority'
  | 'input-window-defer-expired'
  | 'input-window-deferred';

export interface ExecutionOutputSchedulerEntryLike {
  key: string;
  kind: ExecutionNodeKind;
  nodeId: string;
  queuedAtMs: number;
}

export interface ExecutionOutputInputPriorityLike {
  kind: ExecutionNodeKind;
  nodeId: string;
  receivedAtMs: number;
}

export interface ExecutionOutputSchedulerSelectionOptions {
  maxPostsPerFlush: number;
  inputPriorityWindowMs: number;
  nonPriorityMaxDeferMs: number;
}

export function selectExecutionOutputSchedulerEntries<T extends ExecutionOutputSchedulerEntryLike>(
  entries: readonly T[],
  now: number,
  inputPriority: ExecutionOutputInputPriorityLike | undefined,
  options: ExecutionOutputSchedulerSelectionOptions
): { entries: T[]; reason: ExecutionOutputSchedulerSelectionReason } {
  const sortedEntries = entries.slice().sort((left, right) => left.queuedAtMs - right.queuedAtMs);
  const maxPostsPerFlush = Math.max(0, Math.floor(options.maxPostsPerFlush));
  if (maxPostsPerFlush <= 0 || sortedEntries.length === 0) {
    return {
      entries: [],
      reason: 'flush'
    };
  }

  if (!inputPriority || now - inputPriority.receivedAtMs > options.inputPriorityWindowMs) {
    return {
      entries: sortedEntries.slice(0, maxPostsPerFlush),
      reason: 'flush'
    };
  }

  const priorityEntries = sortedEntries.filter((entry) =>
    entry.kind === inputPriority.kind && entry.nodeId === inputPriority.nodeId
  );
  const deferredEntries = sortedEntries.filter((entry) =>
    entry.kind !== inputPriority.kind || entry.nodeId !== inputPriority.nodeId
  );
  const expiredDeferredEntries = deferredEntries.filter(
    (entry) => now - entry.queuedAtMs >= options.nonPriorityMaxDeferMs
  );
  const priorityLimit = expiredDeferredEntries.length > 0 ? Math.max(0, maxPostsPerFlush - 1) : maxPostsPerFlush;
  const selectedEntries = priorityEntries.slice(0, priorityLimit);
  const availableSlots = maxPostsPerFlush - selectedEntries.length;
  if (availableSlots > 0) {
    selectedEntries.push(...expiredDeferredEntries.slice(0, Math.min(1, availableSlots)));
  }

  if (selectedEntries.length > 0) {
    return {
      entries: selectedEntries,
      reason: priorityEntries.length > 0 ? 'input-priority' : 'input-window-defer-expired'
    };
  }

  return {
    entries: [],
    reason: 'input-window-deferred'
  };
}
