const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { assertInstalledCandidateRuntime } = require('./installed-execution-candidate.cjs');

async function assertRemoteInstalledRuntime(runtime, expected) {
  assert.equal(expected.runtimeName, 'node');
  let compatibility;
  if (expected.manifest.schemaVersion === 2) {
    const validator = expected.runtimeValidation;
    assert(validator && path.isAbsolute(validator.file), 'Remote schema2 acceptance requires the frozen product validator.');
    assert.equal(createHash('sha256').update(await fs.readFile(validator.file)).digest('hex'), validator.sha256,
      'Remote runtime validator hash changed.');
    compatibility = require(validator.file)(runtime);
  }
  assertInstalledCandidateRuntime(runtime, expected.manifest, 'node', compatibility);
}

function assertInside(root, file) {
  const relative = path.relative(root, file);
  assert(relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative),
    'Remote execution must use the current private server directory.');
}

function assertRemoteHost(receipt, control) {
  assert.equal(receipt.remoteName, 'ssh-remote');
  assert.equal(receipt.platform, 'linux');
  assert.equal(receipt.arch, 'x64');
  assert.equal(receipt.versions.electron, undefined, 'The Remote Extension Host must be Server Node, not desktop Electron.');
  assert.equal(receipt.vscodeVersion, control.vscodeVersion);
  assert.equal(receipt.serverCommit, control.vscodeCommit);
  assertInside(control.serverRoot, receipt.executable);
  assert.equal(receipt.workspacePath, control.workspacePath);
  assert.equal(receipt.workspaces.length, 1);
  const workspace = receipt.workspaces[0];
  if (workspace.scheme === 'vscode-remote') assert.equal(workspace.authority, control.remoteAuthority);
  else {
    assert.equal(workspace.scheme, 'file', 'Unexpected Remote workspace URI representation.');
    assert.equal(workspace.authority, '', 'A decoded Remote file URI must not name another host.');
  }
  assert.match(receipt.versions.node, /^\d+\.\d+\.\d+$/);
  assert.match(receipt.versions.modules, /^\d+$/);
  assert.match(receipt.versions.napi, /^\d+$/);
  assert.match(receipt.glibc, /^\d+\.\d+(?:\.\d+)?$/);
  assert.match(receipt.executableSha256, /^[a-f0-9]{64}$/);
  if (control.rootOwner) {
    assert.match(receipt.environmentKey ?? '', /^[a-f0-9]{64}$/);
    assert.equal(receipt.environmentSample, 'before-product-test');
  }
}

function assertRemoteEnvironmentStable(probe, host) {
  assert.equal(probe.productPresent, false);
  assert.equal(probe.productActive, false);
  assert.match(probe.environmentKey ?? '', /^[a-f0-9]{64}$/);
  assert.equal(probe.environmentSample, 'before-product-test');
  assert.equal(host.environmentSample, probe.environmentSample);
  assert.notEqual(host.pid, probe.pid, 'Compare separate actual Remote Extension Hosts.');
  assert.equal(host.environmentKey, probe.environmentKey, 'Remote Host reopen must retain the actual execution environment key.');
}

function assertRemoteCompletion(completed, mode) {
  assert.equal(completed.pass, true);
  assert.equal(completed.mode, mode);
  const same = detail => detail?.nodeId === completed.id &&
    (detail.sessionId ?? detail.executionSessionId) === completed.executionId;
  const sources = completed.events.filter(event => event.kind === 'runtime/terminalSourceDisposition' && same(event.detail));
  assert(sources.length > 0, 'The original execution must expose actual source disposition.');
  for (const event of sources) assert.equal(event.detail.sourceDisposition?.kind, 'eof', 'Cancellation is not EOF.');
  const finalRevision = sources.at(-1).detail.finalRevision;
  assert(Number.isSafeInteger(finalRevision) && finalRevision >= 0);
  const settlementKind = mode === 'live-runtime' ? 'runtime/terminalReadSettled' : 'execution/localTerminalReaderSettled';
  const applied = completed.events.filter(event => event.kind === settlementKind && same(event.detail)
    && event.detail.outcome?.kind === 'applied');
  assert(applied.some(event => (mode === 'live-runtime' ? event.detail.outcome.finalRevision
    : event.detail.outcome.finalOutputSequence) === finalRevision),
  'The original reader must apply the actual source final revision.');
  return { sourceDisposition: 'eof', finalRevision, applied: true };
}

module.exports = { assertInside, assertRemoteHost, assertRemoteCompletion, assertRemoteInstalledRuntime,
  assertRemoteEnvironmentStable };
