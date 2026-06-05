import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  canCompareNoteMarkdownResourceWithWorkspaceRoot,
  createDefaultNoteMarkdownFileName,
  createDroppedNoteMarkdownTitle,
  extractNoteMarkdownCurrentRemoteAuthorityFromWebviewResourceUri,
  formatNoteMarkdownRemoteAuthorityPrefix,
  isSupportedNoteMarkdownFilePath,
  normalizeNoteMarkdownAuthority,
  resolveNoteMarkdownFileExtension,
  resolveNoteMarkdownRefreshDraftRetention,
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
assert.equal(normalizeNoteMarkdownAuthority('ssh-remote%2Bdev_labs'), 'ssh-remote+dev_labs');
assert.equal(
  extractNoteMarkdownCurrentRemoteAuthorityFromWebviewResourceUri(
    'https://vscode-remote+ssh-002dremote-002bdev-005flabs.vscode-resource.vscode-cdn.net/home/user/repo/docs/plan.md'
  ),
  'ssh-remote+dev_labs'
);
assert.equal(
  extractNoteMarkdownCurrentRemoteAuthorityFromWebviewResourceUri(
    'https://vscode-remote%2Bssh-002dremote-002bdev-005flabs.vscode-resource.vscode-cdn.net/home/user/repo/docs/plan.md'
  ),
  'ssh-remote+dev_labs',
  'Webview resource probe authorities may percent-encode the separator before the Remote authority.'
);
assert.equal(
  extractNoteMarkdownCurrentRemoteAuthorityFromWebviewResourceUri(
    'https://vscode-remote+wsl-002bUbuntu.vscode-resource.vscode-cdn.net/home/user/repo/docs/plan.md'
  ),
  'wsl+Ubuntu'
);
assert.equal(
  shouldShowNoteMarkdownRemoteAuthorityPrefixForDisplay(
    { scheme: 'vscode-remote', authority: 'ssh-remote%2Bdev_labs' },
    [],
    'ssh-remote+dev_labs'
  ),
  false,
  'Percent-encoded dropped Remote authority should match the decoded current Remote authority.'
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
    { scheme: 'vscode-remote', authority: 'ssh-remote%2Bdev_labs' },
    { scheme: 'file' },
    'ssh-remote+dev_labs'
  ),
  true,
  'Percent-encoded dropped Remote authority should compare with file-scheme workspace roots after normalization.'
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

assert.deepEqual(
  resolveNoteMarkdownRefreshDraftRetention({
    currentStatus: 'ok',
    hasRecoverableDraft: true,
    didRevisionChange: false,
    didActiveEditConflict: false
  }),
  {
    keepRecoverableDraft: true,
    markDirtyConflict: false
  },
  'A refresh with an unchanged remote revision must keep a recoverable active draft without marking a conflict.'
);
assert.deepEqual(
  resolveNoteMarkdownRefreshDraftRetention({
    currentStatus: 'ok',
    hasRecoverableDraft: true,
    didRevisionChange: true,
    didActiveEditConflict: false
  }),
  {
    keepRecoverableDraft: true,
    markDirtyConflict: true
  },
  'A remote revision change while a recoverable draft exists should promote the draft to dirty-conflict.'
);
assert.deepEqual(
  resolveNoteMarkdownRefreshDraftRetention({
    clearRecoverableDraft: true,
    currentStatus: 'dirty-conflict',
    hasRecoverableDraft: true,
    didRevisionChange: true,
    didActiveEditConflict: true
  }),
  {
    keepRecoverableDraft: false,
    markDirtyConflict: false
  },
  'Explicit reload should be the escape hatch that clears the stored draft and conflict status.'
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
const currentRemoteAuthoritySource = sliceBetween(
  panelManagerSource,
  'private getCurrentWebviewRemoteAuthority',
  'private canonicalizeCurrentHostNoteMarkdownUri'
);
assert.match(
  currentRemoteAuthoritySource,
  /this\.scheduleNoteMarkdownCurrentHostRecanonicalize\(\)/u,
  'First successful current Remote authority inference should trigger host-side recanonicalization.'
);
assert.match(
  currentRemoteAuthoritySource,
  /noteMarkdown\/currentRemoteAuthorityInferred/u,
  'Remote authority inference should be captured in host diagnostics.'
);
const canonicalizeCurrentHostSource = sliceBetween(
  panelManagerSource,
  'function canonicalizeNoteMarkdownUriForCurrentHost',
  'function createCurrentHostFileUriFromVscodeRemoteUri'
);
assert.match(
  canonicalizeCurrentHostSource,
  /normalizeNoteMarkdownAuthority\(uri\.authority\)/u,
  'Current-host canonicalization should normalize percent-encoded dropped Remote authorities.'
);
assert.match(
  canonicalizeCurrentHostSource,
  /if \(!normalizedCurrentRemoteAuthority\) \{\s*return uri;\s*\}/u,
  'Current-host canonicalization should fail closed when the full Remote authority is unavailable.'
);
assert.doesNotMatch(
  panelManagerSource,
  /isVscodeRemoteUriOnCurrentHostByFileSystem|doesVscodeRemoteAuthorityMatchRemoteName|canUseNoteMarkdownWorkspacePathFallback/u,
  'Current-host canonicalization must not fall back to remote kind, path containment, or filesystem existence.'
);
assert.match(
  panelManagerSource,
  /note-markdown-diagnostics\.json/u,
  'Host diagnostics dump should include a dedicated Markdown diagnostics file.'
);
assert.match(
  panelManagerSource,
  /noteMarkdown\/dropResourceResolved/u,
  'Dropped Markdown resources should record parsed and canonical URI diagnostics.'
);
const dropHandlerSource = sliceBetween(
  panelManagerSource,
  'private async handleDroppedNoteMarkdownFiles',
  'private async confirmExistingDroppedNoteMarkdownFile'
);
assert.match(
  dropHandlerSource,
  /resolveDroppedNoteMarkdownAdmission/u,
  'Dropped Markdown files should pass through an explicit current-host admission rule.'
);
assert.match(
  dropHandlerSource,
  /admissionRejectionReason/u,
  'Rejected dropped Markdown files should include the admission rejection reason in diagnostics.'
);
assert.ok(
  dropHandlerSource.indexOf('resolveDroppedNoteMarkdownAdmission') <
    dropHandlerSource.indexOf('this.readNoteMarkdownFile(uri)'),
  'Dropped Markdown admission should run before any read/stat call.'
);
const dropAdmissionSource = sliceBetween(
  panelManagerSource,
  'function resolveDroppedNoteMarkdownAdmission',
  'function createCurrentHostFileUriFromVscodeRemoteUri'
);
assert.match(
  dropAdmissionSource,
  /kind: 'same-workspace'/u,
  'Dropped Markdown admission should classify same-workspace resources.'
);
assert.match(
  dropAdmissionSource,
  /kind: 'same-host-outside-workspace'/u,
  'Dropped Markdown admission should classify current-host resources outside the workspace.'
);
assert.match(
  dropAdmissionSource,
  /kind: 'foreign-host'/u,
  'Dropped Markdown admission should reject foreign-host Remote resources.'
);
assert.match(
  dropAdmissionSource,
  /kind: 'unknown-current-host'/u,
  'Dropped Markdown admission should fail closed until the full current Remote authority is known.'
);
assert.match(
  dropAdmissionSource,
  /vscode\.workspace\.getWorkspaceFolder/u,
  'Same-workspace drop admission should use VSCode workspace containment.'
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
const readNoteMarkdownFileSource = sliceBetween(
  panelManagerSource,
  'private async readNoteMarkdownFile',
  'private async writeNoteMarkdownFile'
);
assert.match(
  readNoteMarkdownFileSource,
  /latestStatResult\.contentRevision === contentRevision[\s\S]*Buffer\.from\(await vscode\.workspace\.fs\.readFile\(uri\)\)/u,
  'Reading associated Markdown files should re-stat after read and retry when size/revision changes during the read.'
);
const normalizeContentSource = sliceBetween(
  panelManagerSource,
  'function normalizeStoredNoteContentSource',
  'function normalizeStoredNoteMarkdownRecoverableDraft'
);
assert.match(
  normalizeContentSource,
  /value\.recoverableDraft \?\? readLegacyNoteMarkdownConflictDraft\(value\)/u,
  'Stored associated Markdown Notes should migrate the legacy conflictDraft field into recoverableDraft.'
);
const legacyConflictDraftReaderSource = sliceBetween(
  panelManagerSource,
  'function readLegacyNoteMarkdownConflictDraft',
  'function normalizeStoredNoteMarkdownRecoverableDraft'
);
assert.match(
  legacyConflictDraftReaderSource,
  /return value\.conflictDraft;/u,
  'The legacy conflictDraft field should stay isolated to the migration reader.'
);
const strippedRecoverableDraftSource = sliceBetween(
  panelManagerSource,
  'function stripNoteMarkdownRecoverableDraftContentFromCanvasState',
  'function shouldPreserveStoredExecutionViewportDuringReattach'
);
assert.match(
  strippedRecoverableDraftSource,
  /const recoverableDraft = contentSource\.recoverableDraft/u,
  'Persisted state should strip runtime-only recoverableDraft content.'
);
assert.match(
  strippedRecoverableDraftSource,
  /const legacyConflictDraft = contentSource\.conflictDraft/u,
  'Persisted state stripping should still recognize legacy conflictDraft content.'
);
assert.match(
  strippedRecoverableDraftSource,
  /\.\.\.contentSourceWithoutLegacy/u,
  'Persisted state stripping should drop the legacy conflictDraft field before writing snapshots.'
);
assert.doesNotMatch(
  strippedRecoverableDraftSource,
  /nextContentSource\.conflictDraft/u,
  'Persisted state stripping must not re-emit the legacy conflictDraft field.'
);
const panelManagerSourceWithoutLegacyMigration = panelManagerSource
  .replace(normalizeContentSource, '')
  .replace(strippedRecoverableDraftSource, '');
assert.doesNotMatch(
  panelManagerSourceWithoutLegacyMigration,
  /conflictDraft|ConflictDraft|CONFLICT_DRAFT/u,
  'The renamed model should keep legacy conflictDraft references isolated to migration and stripping code.'
);

console.log('note markdown file association tests passed');

function sliceBetween(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  assert.notEqual(startIndex, -1, `Missing source marker: ${start}`);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(endIndex, -1, `Missing source marker: ${end}`);
  return source.slice(startIndex, endIndex);
}
