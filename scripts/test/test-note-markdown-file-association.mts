import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  canCompareNoteMarkdownResourceWithWorkspaceRoot,
  createDefaultNoteMarkdownFileName,
  createDroppedNoteMarkdownTitle,
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

assert.equal(createDroppedNoteMarkdownTitle('/workspace/docs/design.md'), 'design.md');
assert.equal(
  createDroppedNoteMarkdownTitle('/workspace/docs/design.md', { stripExtension: true }),
  'design'
);
assert.equal(createDroppedNoteMarkdownTitle('file:///workspace/docs/plan.markdown#L12'), 'plan.markdown');
assert.equal(
  createDroppedNoteMarkdownTitle('file:///workspace/docs/plan.markdown#L12', { stripExtension: true }),
  'plan'
);

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
    [{ scheme: 'file' }]
  ),
  true,
  'A file-scheme workspace root cannot prove the vscode-remote resource is on the same device.'
);
assert.equal(
  shouldShowNoteMarkdownRemoteAuthorityPrefixForDisplay(
    { scheme: 'vscode-remote', authority: 'ssh-remote+dev_labs' },
    [{ scheme: 'vscode-remote', authority: 'ssh-remote+dev_labs' }]
  ),
  false,
  'Matching full remote authority should not show a remote prefix.'
);
assert.equal(
  shouldShowNoteMarkdownRemoteAuthorityPrefixForDisplay(
    { scheme: 'vscode-remote', authority: 'ssh-remote+dev_labs' },
    [{ scheme: 'vscode-remote', authority: 'ssh-remote+other_host' }]
  ),
  true,
  'Different Remote SSH targets should keep the remote prefix.'
);
assert.equal(
  canCompareNoteMarkdownResourceWithWorkspaceRoot(
    { scheme: 'vscode-remote', authority: 'ssh-remote+dev_labs' },
    { scheme: 'vscode-remote', authority: 'ssh-remote+dev_labs' }
  ),
  true,
  'Matching full remote authority should compare with workspace roots.'
);
assert.equal(
  canCompareNoteMarkdownResourceWithWorkspaceRoot(
    { scheme: 'vscode-remote', authority: 'ssh-remote+dev_labs' },
    { scheme: 'vscode-remote', authority: 'ssh-remote+other_host' }
  ),
  false,
  'Different Remote SSH targets should not compare with workspace roots.'
);
assert.equal(
  canCompareNoteMarkdownResourceWithWorkspaceRoot(
    { scheme: 'vscode-remote', authority: 'ssh-remote+dev_labs' },
    { scheme: 'file' }
  ),
  false,
  'Remote resources should not compare with file-scheme workspace roots without full authority.'
);

const packageJson = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
const packageNlsJson = JSON.parse(readFileSync(new URL('../../package.nls.json', import.meta.url), 'utf8'));
const dropTitleConfig =
  packageJson.contributes.configuration.properties['devSessionCanvas.noteMarkdown.stripExtensionFromDroppedFileTitle'];
assert.equal(dropTitleConfig?.type, 'boolean');
assert.equal(dropTitleConfig?.default, false);
assert.equal(dropTitleConfig?.scope, 'window');
assert.equal(
  packageNlsJson['configuration.noteMarkdown.stripExtensionFromDroppedFileTitle.description']?.length > 0,
  true
);

console.log('note markdown file association tests passed');
