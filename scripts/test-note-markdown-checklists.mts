import assert from 'node:assert/strict';

import { toggleNoteMarkdownChecklistAtLine } from '../src/common/noteMarkdownChecklist.ts';

function run(): void {
  assert.equal(
    toggleNoteMarkdownChecklistAtLine('- [ ] 补测试', 1),
    '- [x] 补测试',
    '未完成 checklist 应可切换为已完成。'
  );

  assert.equal(
    toggleNoteMarkdownChecklistAtLine('- [x] 补测试', 1),
    '- [ ] 补测试',
    '已完成 checklist 应可切换为未完成。'
  );

  assert.equal(
    toggleNoteMarkdownChecklistAtLine('- [X] 补测试', 1),
    '- [ ] 补测试',
    '大写 X checklist 应可切回未完成。'
  );

  assert.equal(
    toggleNoteMarkdownChecklistAtLine('  1. [ ] 补设计', 1),
    '  1. [x] 补设计',
    '有序列表 checklist 应保持缩进与序号。'
  );

  assert.equal(
    toggleNoteMarkdownChecklistAtLine(['前言', '  - [ ] 补文档', '后记'].join('\n'), 2),
    ['前言', '  - [x] 补文档', '后记'].join('\n'),
    '应按指定源文行切换嵌套 checklist。'
  );

  assert.equal(
    toggleNoteMarkdownChecklistAtLine('> - [ ] 引用待办', 1),
    '> - [x] 引用待办',
    '引用块中的无序 checklist 应可切换。'
  );

  assert.equal(
    toggleNoteMarkdownChecklistAtLine('> > 1. [x] 多层引用待办', 1),
    '> > 1. [ ] 多层引用待办',
    '多层引用中的有序 checklist 应保持引用前缀与序号。'
  );

  assert.equal(
    toggleNoteMarkdownChecklistAtLine('- 普通列表', 1),
    null,
    '非 checklist 行不应被误改写。'
  );

  assert.equal(
    toggleNoteMarkdownChecklistAtLine('- [ ] 补测试', 0),
    null,
    '非法行号不应被接受。'
  );
}

run();
console.log('note markdown checklist tests passed');
