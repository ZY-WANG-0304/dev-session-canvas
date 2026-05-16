import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  canCompareNoteMarkdownResourceWithWorkspaceRoot,
  createDefaultNoteMarkdownFileName,
  createDroppedNoteMarkdownTitle,
  extractNoteMarkdownCurrentRemoteAuthorityFromWebviewResourceUri,
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
  extractNoteMarkdownCurrentRemoteAuthorityFromWebviewResourceUri(
    'https://vscode-remote+ssh-002dremote-002bdev-005flabs.vscode-resource.vscode-cdn.net/home/user/repo/docs/plan.md'
  ),
  'ssh-remote+dev_labs'
);
assert.equal(
  extractNoteMarkdownCurrentRemoteAuthorityFromWebviewResourceUri(
    'https://vscode-remote+wsl-002bUbuntu.vscode-resource.vscode-cdn.net/home/user/repo/docs/plan.md'
  ),
  'wsl+Ubuntu'
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
    [{ scheme: 'file' }],
    'ssh-remote+dev_labs'
  ),
  false,
  'A matching current remote authority should prove a file-scheme workspace root is on the same device.'
);
assert.equal(
  shouldShowNoteMarkdownRemoteAuthorityPrefixForDisplay(
    { scheme: 'vscode-remote', authority: 'ssh-remote+dev_labs' },
    [],
    'ssh-remote+dev_labs'
  ),
  false,
  'Current remote authority should suppress the remote prefix independently of workspace containment.'
);
assert.equal(
  shouldShowNoteMarkdownRemoteAuthorityPrefixForDisplay(
    { scheme: 'vscode-remote', authority: 'ssh-remote+other_host' },
    [{ scheme: 'file' }],
    'ssh-remote+dev_labs'
  ),
  true,
  'A different full remote authority should keep the remote prefix even when the remote kind matches.'
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
assert.equal(
  canCompareNoteMarkdownResourceWithWorkspaceRoot(
    { scheme: 'vscode-remote', authority: 'ssh-remote+dev_labs' },
    { scheme: 'file' },
    'ssh-remote+dev_labs'
  ),
  true,
  'Current remote resources should compare with file-scheme workspace roots after full authority inference.'
);
assert.equal(
  canCompareNoteMarkdownResourceWithWorkspaceRoot(
    { scheme: 'vscode-remote', authority: 'ssh-remote+other_host' },
    { scheme: 'file' },
    'ssh-remote+dev_labs'
  ),
  false,
  'Remote kind alone should not compare with file-scheme workspace roots.'
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

const panelManagerSource = readFileSync(
  new URL('../../src/panel/CanvasPanelManager.ts', import.meta.url),
  'utf8'
);
const getAssociatedResourceKeySource = sliceBetween(
  panelManagerSource,
  'private getAssociatedNoteMarkdownResourceKey',
  'private createAssociatedNoteMarkdownNode'
);
assert.match(
  getAssociatedResourceKeySource,
  /this\.parseCurrentHostNoteMarkdownUri\(source\.resourceUri\)/u,
  'Existing associated Markdown Note keys should canonicalize current-host vscode-remote URIs before dedupe checks.'
);
const documentRefreshSource = sliceBetween(
  panelManagerSource,
  'private async refreshAssociatedMarkdownNotesForDocument',
  'private async refreshAllAssociatedMarkdownNotes'
);
assert.match(
  documentRefreshSource,
  /this\.getAssociatedNoteMarkdownResourceKey\(node\) === documentResourceKey/u,
  'Document save refresh should compare the same canonical resource key used by dropped files.'
);
const watcherSyncSource = sliceBetween(
  panelManagerSource,
  'private syncNoteMarkdownFileWatchers',
  'private createNoteMarkdownFileWatcher'
);
assert.match(
  watcherSyncSource,
  /this\.parseCurrentHostNoteMarkdownUri\(source\.resourceUri\)/u,
  'Current-host vscode-remote associated notes should be eligible for file-scheme watchers.'
);
const refreshAssociatedSource = sliceBetween(
  panelManagerSource,
  'private async refreshAssociatedMarkdownNote',
  'private syncNoteMarkdownFileWatchers'
);
assert.match(
  refreshAssociatedSource,
  /resourceUri: uri\.toString\(\)/u,
  'Refreshing a current-host associated Markdown Note should persist the canonical resourceUri.'
);

console.log('note markdown file association tests passed');

function sliceBetween(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  assert.notEqual(startIndex, -1, `Missing source marker: ${start}`);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(endIndex, -1, `Missing source marker: ${end}`);
  return source.slice(startIndex, endIndex);
}
