import assert from 'node:assert/strict';

import {
  createNoteBodyIndentEdit,
  createNoteBodyOutdentEdit
} from '../../src/webview/noteBodyIndent.ts';

function run(): void {
  assert.deepStrictEqual(
    createNoteBodyIndentEdit('alpha', 2, 2),
    {
      value: 'al  pha',
      selectionStart: 4,
      selectionEnd: 4
    },
    '无选区时 Tab 应在光标处插入缩进。'
  );

  assert.deepStrictEqual(
    createNoteBodyIndentEdit('alpha', 1, 3),
    {
      value: '  alpha',
      selectionStart: 3,
      selectionEnd: 5
    },
    '单行选区按 Tab 应缩进所在行并保留原选中文本。'
  );

  assert.deepStrictEqual(
    createNoteBodyIndentEdit('alpha\nbeta', 1, 8),
    {
      value: '  alpha\n  beta',
      selectionStart: 3,
      selectionEnd: 12
    },
    '跨多行选区按 Tab 应继续批量缩进所有命中的行。'
  );

  assert.deepStrictEqual(
    createNoteBodyOutdentEdit('  alpha', 0, 7),
    {
      value: 'alpha',
      selectionStart: 0,
      selectionEnd: 5
    },
    '单行选区按 Shift+Tab 应移除已有缩进。'
  );

  assert.equal(
    createNoteBodyOutdentEdit('alpha', 0, 5),
    null,
    '没有缩进的行按 Shift+Tab 不应生成编辑。'
  );
}

run();
console.log('note body indent tests passed');
