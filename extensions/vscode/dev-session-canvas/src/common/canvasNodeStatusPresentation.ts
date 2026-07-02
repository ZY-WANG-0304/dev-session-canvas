import type { CanvasNodeSummary } from './protocol';

type CanvasStatusPresentationNode = Pick<CanvasNodeSummary, 'kind' | 'status' | 'metadata'>;

export type CanvasStatusLabelId =
  | 'status.linked'
  | 'status.idle'
  | 'status.starting'
  | 'status.waitingInput'
  | 'status.resuming'
  | 'status.resumeReady'
  | 'status.reattaching'
  | 'status.resumeFailed'
  | 'status.stopping'
  | 'status.stopped'
  | 'status.suspended'
  | 'status.running'
  | 'status.draft'
  | 'status.ready'
  | 'status.live'
  | 'status.closed'
  | 'status.error'
  | 'status.interrupted'
  | 'status.historyRestored'
  | 'status.missing'
  | 'status.notFile'
  | 'status.unsupportedExtension'
  | 'status.unreadable'
  | 'status.dirtyConflict'
  | 'status.noteAssociatedFile'
  | 'status.notePlain';

export const CANVAS_STATUS_LABEL_IDS: readonly CanvasStatusLabelId[] = [
  'status.linked',
  'status.idle',
  'status.starting',
  'status.waitingInput',
  'status.resuming',
  'status.resumeReady',
  'status.reattaching',
  'status.resumeFailed',
  'status.stopping',
  'status.stopped',
  'status.suspended',
  'status.running',
  'status.draft',
  'status.ready',
  'status.live',
  'status.closed',
  'status.error',
  'status.interrupted',
  'status.historyRestored',
  'status.missing',
  'status.notFile',
  'status.unsupportedExtension',
  'status.unreadable',
  'status.dirtyConflict',
  'status.noteAssociatedFile',
  'status.notePlain'
];

export type CanvasStatusLabelDescriptor =
  | {
      kind: 'localized';
      id: CanvasStatusLabelId;
      defaultMessage: string;
    }
  | {
      kind: 'raw';
      value: string;
    };

const CANVAS_STATUS_LABEL_DEFAULT_MESSAGES: Record<CanvasStatusLabelId, string> = {
  'status.linked': 'Linked',
  'status.idle': 'Not started',
  'status.starting': 'Starting',
  'status.waitingInput': 'Waiting for input',
  'status.resuming': 'Resuming',
  'status.resumeReady': 'Resumable',
  'status.reattaching': 'Reconnecting',
  'status.resumeFailed': 'Resume failed',
  'status.stopping': 'Stopping',
  'status.stopped': 'Stopped',
  'status.suspended': 'Suspended',
  'status.running': 'Running',
  'status.draft': 'Draft',
  'status.ready': 'Ready',
  'status.live': 'Live',
  'status.closed': 'Session closed',
  'status.error': 'Failed',
  'status.interrupted': 'Interrupted',
  'status.historyRestored': 'History restored',
  'status.missing': 'File missing',
  'status.notFile': 'Not a file',
  'status.unsupportedExtension': 'Unsupported format',
  'status.unreadable': 'Unreadable',
  'status.dirtyConflict': 'Edit conflict',
  'status.noteAssociatedFile': 'File linked',
  'status.notePlain': 'Plain Note'
};

export function canvasNodeStatusToneClass(node: CanvasStatusPresentationNode): string {
  const contentSource = node.kind === 'note' ? node.metadata?.note?.contentSource : undefined;
  if (contentSource?.kind === 'markdown-file') {
    return contentSource.status === 'ok' ? 'tone-success' : canvasStatusToneClass(contentSource.status);
  }

  return canvasStatusToneClass(node.status);
}

export function canvasStatusToneClass(status: string): string {
  switch (status) {
    case 'linked':
      return 'tone-success';
    case 'launching':
    case 'starting':
      return 'tone-starting';
    case 'resuming':
    case 'reattaching':
      return 'tone-resuming';
    case 'running':
      return 'tone-running';
    case 'live':
    case 'waiting-input':
    case 'resume-ready':
      return 'tone-waiting';
    case 'stopping':
    case 'stopped':
    case 'cancelled':
      return 'tone-stopped';
    case 'suspended':
    case 'interrupted':
    case 'closed':
      return 'tone-disconnected';
    case 'history-restored':
      return 'tone-history';
    case 'resume-failed':
    case 'error':
    case 'missing':
    case 'not-file':
    case 'unsupported-extension':
    case 'unreadable':
    case 'dirty-conflict':
      return 'tone-error';
    default:
      return 'tone-idle';
  }
}

export function canvasNodeStatusLabelDescriptor(node: CanvasStatusPresentationNode): CanvasStatusLabelDescriptor {
  if (node.kind === 'note') {
    return canvasNoteStatusLabelDescriptor(node);
  }

  return canvasStatusLabelDescriptor(node.status);
}

function canvasNoteStatusLabelDescriptor(node: CanvasStatusPresentationNode): CanvasStatusLabelDescriptor {
  const contentSource = node.metadata?.note?.contentSource;
  if (contentSource?.kind === 'markdown-file') {
    return contentSource.status === 'ok'
      ? localizedCanvasStatusLabel('status.noteAssociatedFile')
      : canvasStatusLabelDescriptor(contentSource.status);
  }

  if (node.status === 'ready') {
    return localizedCanvasStatusLabel('status.notePlain');
  }

  return canvasStatusLabelDescriptor(node.status);
}

export function canvasStatusLabelDescriptor(status: string): CanvasStatusLabelDescriptor {
  switch (status) {
    case 'linked':
      return localizedCanvasStatusLabel('status.linked');
    case 'idle':
      return localizedCanvasStatusLabel('status.idle');
    case 'launching':
    case 'starting':
      return localizedCanvasStatusLabel('status.starting');
    case 'waiting-input':
      return localizedCanvasStatusLabel('status.waitingInput');
    case 'resuming':
      return localizedCanvasStatusLabel('status.resuming');
    case 'resume-ready':
      return localizedCanvasStatusLabel('status.resumeReady');
    case 'reattaching':
      return localizedCanvasStatusLabel('status.reattaching');
    case 'resume-failed':
      return localizedCanvasStatusLabel('status.resumeFailed');
    case 'stopping':
      return localizedCanvasStatusLabel('status.stopping');
    case 'stopped':
      return localizedCanvasStatusLabel('status.stopped');
    case 'suspended':
      return localizedCanvasStatusLabel('status.suspended');
    case 'running':
      return localizedCanvasStatusLabel('status.running');
    case 'draft':
      return localizedCanvasStatusLabel('status.draft');
    case 'ready':
      return localizedCanvasStatusLabel('status.ready');
    case 'live':
      return localizedCanvasStatusLabel('status.live');
    case 'closed':
      return localizedCanvasStatusLabel('status.closed');
    case 'error':
      return localizedCanvasStatusLabel('status.error');
    case 'cancelled':
      return localizedCanvasStatusLabel('status.stopped');
    case 'interrupted':
      return localizedCanvasStatusLabel('status.interrupted');
    case 'history-restored':
      return localizedCanvasStatusLabel('status.historyRestored');
    case 'missing':
      return localizedCanvasStatusLabel('status.missing');
    case 'not-file':
      return localizedCanvasStatusLabel('status.notFile');
    case 'unsupported-extension':
      return localizedCanvasStatusLabel('status.unsupportedExtension');
    case 'unreadable':
      return localizedCanvasStatusLabel('status.unreadable');
    case 'dirty-conflict':
      return localizedCanvasStatusLabel('status.dirtyConflict');
    default:
      return {
        kind: 'raw',
        value: status
      };
  }
}

export function canvasStatusLabelDefaultMessage(id: CanvasStatusLabelId): string {
  return CANVAS_STATUS_LABEL_DEFAULT_MESSAGES[id];
}

export function humanizeCanvasNodeStatus(node: CanvasStatusPresentationNode): string {
  return humanizeCanvasStatusLabelDescriptor(canvasNodeStatusLabelDescriptor(node));
}

export function humanizeCanvasStatus(status: string): string {
  return humanizeCanvasStatusLabelDescriptor(canvasStatusLabelDescriptor(status));
}

function localizedCanvasStatusLabel(id: CanvasStatusLabelId): CanvasStatusLabelDescriptor {
  return {
    kind: 'localized',
    id,
    defaultMessage: canvasStatusLabelDefaultMessage(id)
  };
}

function humanizeCanvasStatusLabelDescriptor(label: CanvasStatusLabelDescriptor): string {
  return label.kind === 'localized' ? label.defaultMessage : label.value;
}
