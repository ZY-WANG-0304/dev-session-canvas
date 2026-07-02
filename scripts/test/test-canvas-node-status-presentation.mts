import assert from 'node:assert/strict';

import {
  CANVAS_STATUS_LABEL_IDS,
  canvasStatusLabelDefaultMessage,
  canvasNodeStatusLabelDescriptor,
  canvasNodeStatusToneClass,
  canvasStatusLabelDescriptor,
  humanizeCanvasNodeStatus
} from '../../extensions/vscode/dev-session-canvas/src/common/canvasNodeStatusPresentation.ts';
import { enWebviewMessages } from '../../extensions/vscode/dev-session-canvas/src/webview/i18n/webviewI18n.ts';

function markdownNote(contentStatus: string, nodeStatus = 'ready') {
  return {
    kind: 'note',
    status: nodeStatus,
    metadata: {
      note: {
        content: '',
        contentSource: {
          kind: 'markdown-file',
          resourceUri: 'file:///workspace/note.md',
          displayPath: 'note.md',
          status: contentStatus
        }
      }
    }
  };
}

assert.deepEqual(canvasNodeStatusLabelDescriptor(markdownNote('ok')), {
  kind: 'localized',
  id: 'status.noteAssociatedFile',
  defaultMessage: 'File linked'
});
assert.equal(humanizeCanvasNodeStatus(markdownNote('ok')), 'File linked');
assert.equal(canvasNodeStatusToneClass(markdownNote('ok')), 'tone-success');
assert.deepEqual(
  canvasNodeStatusLabelDescriptor({ kind: 'agent', status: 'suspended', metadata: {} }),
  canvasStatusLabelDescriptor('suspended')
);
assert.equal(
  humanizeCanvasNodeStatus({ kind: 'agent', status: 'suspended', metadata: {} }),
  'Suspended'
);
assert.equal(
  canvasNodeStatusToneClass({ kind: 'agent', status: 'suspended', metadata: {} }),
  'tone-disconnected'
);

for (const [contentStatus, id, label] of [
  ['missing', 'status.missing', 'File missing'],
  ['not-file', 'status.notFile', 'Not a file'],
  ['unsupported-extension', 'status.unsupportedExtension', 'Unsupported format'],
  ['unreadable', 'status.unreadable', 'Unreadable'],
  ['dirty-conflict', 'status.dirtyConflict', 'Edit conflict']
]) {
  const node = markdownNote(contentStatus);
  assert.deepEqual(canvasNodeStatusLabelDescriptor(node), {
    kind: 'localized',
    id,
    defaultMessage: label
  });
  assert.equal(humanizeCanvasNodeStatus(node), label);
  assert.equal(canvasNodeStatusToneClass(node), 'tone-error');
}

assert.equal(
  humanizeCanvasNodeStatus({
    kind: 'note',
    status: 'ready',
    metadata: {
      note: {
        content: '',
        contentSource: {
          kind: 'embedded'
        }
      }
    }
  }),
  'Plain Note'
);

assert.deepEqual(
  canvasStatusLabelDescriptor('future-status'),
  {
    kind: 'raw',
    value: 'future-status'
  },
  'Unknown protocol statuses should remain raw diagnostics instead of being localized.'
);

for (const id of CANVAS_STATUS_LABEL_IDS) {
  assert.equal(
    canvasStatusLabelDefaultMessage(id),
    enWebviewMessages[id],
    `Shared status label ${id} should use the same English default as the Webview dictionary.`
  );
}

console.log('canvas node status presentation tests passed');
