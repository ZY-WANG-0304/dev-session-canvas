import assert from 'node:assert/strict';

import {
  canvasNodeStatusToneClass,
  humanizeCanvasNodeStatus
} from '../../src/common/canvasNodeStatusPresentation.ts';

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

assert.equal(humanizeCanvasNodeStatus(markdownNote('ok')), '已关联文件');
assert.equal(canvasNodeStatusToneClass(markdownNote('ok')), 'tone-success');

for (const [contentStatus, label] of [
  ['missing', '文件缺失'],
  ['not-file', '不是文件'],
  ['unsupported-extension', '格式不支持'],
  ['unreadable', '无法读取'],
  ['dirty-conflict', '编辑冲突']
]) {
  const node = markdownNote(contentStatus);
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
  '普通笔记'
);

console.log('canvas node status presentation tests passed');
