import assert from 'node:assert/strict';

import {
  canCompareNoteMarkdownResourceWithWorkspaceRoot,
  createDefaultNoteMarkdownFileName,
  formatNoteMarkdownRemoteAuthorityPrefix,
  isSupportedNoteMarkdownFilePath,
  resolveNoteMarkdownFileExtension,
  sanitizeNoteMarkdownFileName,
  shouldShowNoteMarkdownRemoteAuthorityPrefixForDisplay
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
assert.equal(
  shouldShowNoteMarkdownRemoteAuthorityPrefixForDisplay(
    { scheme: 'vscode-remote', authority: 'ssh-remote+dev_labs' },
    [{ scheme: 'file' }],
    'ssh-remote'
  ),
  false,
  'Current Remote SSH host should not show the ssh device prefix.'
);
assert.equal(
  shouldShowNoteMarkdownRemoteAuthorityPrefixForDisplay(
    { scheme: 'vscode-remote', authority: 'ssh-remote+dev_labs' },
    [{ scheme: 'file' }],
    undefined
  ),
  true,
  'A local extension host should keep the remote prefix for vscode-remote resources.'
);
assert.equal(
  shouldShowNoteMarkdownRemoteAuthorityPrefixForDisplay(
    { scheme: 'vscode-remote', authority: 'ssh-remote+dev_labs' },
    [{ scheme: 'file' }],
    'wsl'
  ),
  true,
  'A different remote kind should keep the remote prefix.'
);
assert.equal(
  shouldShowNoteMarkdownRemoteAuthorityPrefixForDisplay(
    { scheme: 'vscode-remote', authority: 'ssh-remote+dev_labs' },
    [{ scheme: 'vscode-remote', authority: 'ssh-remote+dev_labs' }]
  ),
  false,
  'Matching workspace authority should not show a remote prefix.'
);
assert.equal(
  canCompareNoteMarkdownResourceWithWorkspaceRoot(
    { scheme: 'vscode-remote', authority: 'ssh-remote+dev_labs' },
    { scheme: 'file' },
    'ssh-remote'
  ),
  true,
  'Remote resources from the current host should compare with file-scheme workspace roots.'
);

console.log('note markdown file association tests passed');
