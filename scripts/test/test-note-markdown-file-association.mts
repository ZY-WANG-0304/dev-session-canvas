import assert from 'node:assert/strict';

import {
  createDefaultNoteMarkdownFileName,
  formatNoteMarkdownRemoteAuthorityPrefix,
  isSupportedNoteMarkdownFilePath,
  resolveNoteMarkdownFileExtension,
  sanitizeNoteMarkdownFileName
} from '../../src/common/noteMarkdownFileAssociation.ts';

assert.equal(isSupportedNoteMarkdownFilePath('/workspace/docs/plan.md'), true);
assert.equal(isSupportedNoteMarkdownFilePath('/workspace/docs/plan.markdown'), true);
assert.equal(isSupportedNoteMarkdownFilePath('/workspace/docs/plan.MD'), true);
assert.equal(isSupportedNoteMarkdownFilePath('file:///workspace/docs/plan.md#L12'), true);
assert.equal(isSupportedNoteMarkdownFilePath('/workspace/docs/plan.txt'), false);
assert.equal(isSupportedNoteMarkdownFilePath('/workspace/docs/README'), false);

assert.equal(resolveNoteMarkdownFileExtension('file:///workspace/a/b/PLAN.markdown?x=1'), '.markdown');
assert.equal(resolveNoteMarkdownFileExtension('C:\\repo\\note.MD'), '.md');

assert.equal(sanitizeNoteMarkdownFileName('Design Notes'), 'Design Notes.md');
assert.equal(sanitizeNoteMarkdownFileName('design.md'), 'design.md');
assert.equal(sanitizeNoteMarkdownFileName('bad/name:*?'), 'bad-name---.md');
assert.equal(sanitizeNoteMarkdownFileName('   '), 'note.md');
assert.equal(sanitizeNoteMarkdownFileName('CON'), 'CON-note.md');
assert.equal(createDefaultNoteMarkdownFileName('产品方案'), '产品方案.md');

assert.equal(
  formatNoteMarkdownRemoteAuthorityPrefix('vscode-remote', 'ssh-remote+dev_labs'),
  'ssh:dev_labs'
);
assert.equal(
  formatNoteMarkdownRemoteAuthorityPrefix('vscode-remote', 'wsl+Ubuntu'),
  'wsl:Ubuntu'
);

console.log('note markdown file association tests passed');
