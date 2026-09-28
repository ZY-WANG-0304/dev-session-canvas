import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import esbuild from 'esbuild';
import ts from 'typescript';

const sourceFile = path.resolve('extensions/vscode/dev-session-canvas/src/panel/CanvasPanelManager.ts');
const baselineRef = process.argv.find(value => value.startsWith('--baseline-ref='))?.slice('--baseline-ref='.length);
const source = baselineRef
  ? execFileSync('git', ['show', `${baselineRef}:${path.relative(process.cwd(), sourceFile)}`],
    { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 })
  : await readFile(sourceFile, 'utf8');
const ast = ts.createSourceFile(sourceFile, source, ts.ScriptTarget.Latest, true);
const manager = ast.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'CanvasPanelManager');
const names = baselineRef ? ['postTerminalAvailable'] : [
  'postTerminalAvailable', 'receiveTerminalAvailable', 'clearTerminalAvailableNotifications',
  'flushTerminalAvailableNotifications', 'postCompletedTerminalAvailable', 'getSurfaceLifecycleIdentity',
  'invalidateSurfaceLifecycle', 'beginSurfaceRender', 'markSurfaceReady', 'postPagedExecutionSnapshot',
  'postMessage', 'postMessageWithDeliveryResult'
];
const methods = names.map(name => {
  const method = manager?.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(ast) === name);
  assert.ok(method, `actual Host method ${name} must exist`);
  return method.getText(ast);
});
const directory = await mkdtemp(path.join(os.tmpdir(), 'dsc-available-credit-'));
try {
  const outfile = path.join(directory, 'actual-host-available.cjs');
  await esbuild.build({ stdin: {
    contents: `
      ${baselineRef ? '' : "import { TerminalAvailableNotifications } from './panel/terminalAvailableNotifications';"}
      const vscode = { l10n: { t: value => value } };
      const formatSurfaceForDiagnostics = surface => surface;
      export class Harness {
        ${baselineRef ? '' : 'terminalAvailableNotifications = new TerminalAvailableNotifications();'}
        ${methods.join('\n')}
      }
    `,
    resolveDir: path.dirname(path.dirname(sourceFile)), loader: 'ts'
  }, outfile, bundle: true, platform: 'node', format: 'cjs', target: 'node18' });
  const { Harness } = createRequire(import.meta.url)(outfile);
  const stalled = fixture(Harness);
  const session = makeSession();
  for (let revision = 1; revision <= 1000; revision += 1) {
    session.outputSequence = revision;
    stalled.host.postTerminalAvailable('terminal', 'node-a', session, revision === 1 ? 'first-title' : undefined);
  }
  if (baselineRef) console.log(`Baseline ${baselineRef}: ${stalled.posts.length} messages for 1000 unacknowledged notifications`);
  assert.equal(stalled.posts.length, 1, 'a stalled receipt-capable surface must have only one in-flight notification.');
  assert.equal(stalled.host.terminalAvailableNotifications.size, 1);
  const first = stalled.posts[0];
  assert.equal(first.message.payload.revision, 1);
  assert.equal(typeof first.message.payload.receiptId, 'string');
  stalled.host.receiveTerminalAvailable('editor', receipt(first));
  assert.equal(stalled.posts.length, 2);
  assert.equal(stalled.posts[1].message.payload.revision, 1000);
  assert.equal(stalled.posts[1].message.payload.terminalTitle, 'first-title');
  assert.notEqual(stalled.posts[1].message.payload.receiptId, first.message.payload.receiptId);
  stalled.host.receiveTerminalAvailable('editor', receipt(stalled.posts[1]));
  assert.equal(stalled.host.terminalAvailableNotifications.size, 0);

  verifyTitlesAndReceipts(Harness);
  verifySurfaceAndExecutionIdentity(Harness);
  verifyBootstrapAndCompletion(Harness);
  verifyLegacyAndIndependentNodes(Harness);
  await verifyReattachPublishesCurrentHead(Harness);
  await verifyDeliveryOutcomes(Harness);
  verifyActualDeliveryReturn(Harness);
  console.log('terminal available credit: actual Host coalescing, identity, bootstrap, completion, legacy, reattach and delivery regressions passed');
} finally {
  await rm(directory, { recursive: true, force: true });
}

function fixture(Harness, receiptCapability = true, delivery) {
  const host = new Harness();
  const posts = [];
  const bootstrapQueue = [];
  host.activeSurface = 'editor';
  host.surfaceMode = { editor: 'active', panel: 'active' };
  host.surfaceReady = { editor: true, panel: true };
  host.surfaceLifecycle = Object.fromEntries(['editor', 'panel'].map(surface => [surface, {
    generation: 1, mode: 'active', ready: true, frameId: `${surface}-frame-1`, bootstrapAck: true,
    ...(receiptCapability ? { terminalAvailableReceiptV1: true } : {})
  }]));
  host.isInteractiveSurface = surface => host.surfaceMode[surface] === 'active';
  host.getSurfaceMessageWebview = () => ({ postMessage: () => Promise.resolve(true) });
  host.postMessageWithDeliveryResult = (message, surface = host.activeSurface) => {
    const entry = { surface, message };
    if (!host.surfaceLifecycle[surface].bootstrapAck) bootstrapQueue.push(entry);
    else posts.push(entry);
    return delivery?.(entry);
  };
  host.postMessage = (message, surface) => { void host.postMessageWithDeliveryResult(message, surface); };
  host.cancelLocalExecutionReaders = () => {};
  host.terminalReadRelay = { closeMatching() {} };
  host.rejectPendingWebviewProbeRequests = () => {};
  host.rejectPendingWebviewDomActionRequests = () => {};
  host.clearPendingBootstrapHostMessages = () => { bootstrapQueue.length = 0; };
  return { host, posts, bootstrapQueue };
}

function makeSession(sessionId = 'session-a', authorityId = 'authority-a') {
  return { sessionId, terminalAuthorityId: authorityId, outputSequence: 1 };
}

function receipt(post) {
  const { nodeId, kind, executionSessionId, authorityId, receiptId } = post.message.payload;
  return { nodeId, kind, executionSessionId, authorityId, receiptId };
}

function verifyTitlesAndReceipts(Harness) {
  const f = fixture(Harness);
  const session = makeSession();
  f.host.postTerminalAvailable('terminal', 'node-a', session, 'old-title');
  const original = receipt(f.posts[0]);
  session.outputSequence = 9;
  f.host.postTerminalAvailable('terminal', 'node-a', session, null);
  session.outputSequence = 3;
  f.host.postTerminalAvailable('terminal', 'node-a', session);
  for (const wrong of [
    { ...original, nodeId: 'wrong-node' }, { ...original, kind: 'agent' },
    { ...original, executionSessionId: 'wrong-session' }, { ...original, authorityId: 'wrong-authority' },
    { ...original, receiptId: 'wrong-receipt' }
  ]) f.host.receiveTerminalAvailable('editor', wrong);
  f.host.receiveTerminalAvailable('panel', original);
  assert.equal(f.posts.length, 1, 'wrong identity or surface must not release credit.');
  f.host.receiveTerminalAvailable('editor', original);
  assert.equal(f.posts.length, 2);
  assert.equal(f.posts[1].message.payload.revision, 9, 'coalescing must preserve the highest offered revision.');
  assert.equal(f.posts[1].message.payload.terminalTitle, null, 'undefined title must not undo an explicit title clear.');
  session.outputSequence = 10;
  f.host.postTerminalAvailable('terminal', 'node-a', session);
  f.host.receiveTerminalAvailable('editor', original);
  assert.equal(f.posts.length, 2, 'a duplicate receipt must not release the newer in-flight notification.');
  f.host.receiveTerminalAvailable('editor', receipt(f.posts[1]));
  assert.equal(f.posts.length, 3);
  assert.equal(f.posts[2].message.payload.terminalTitle, null);
  f.host.receiveTerminalAvailable('editor', receipt(f.posts[2]));
  assert.equal(f.host.terminalAvailableNotifications.size, 0);
}

function verifySurfaceAndExecutionIdentity(Harness) {
  const f = fixture(Harness);
  const session = makeSession();
  f.host.postTerminalAvailable('terminal', 'node-a', session);
  const oldExecution = receipt(f.posts.at(-1));
  session.outputSequence = 20;
  f.host.postTerminalAvailable('terminal', 'node-a', session);
  const replacement = makeSession('session-b', 'authority-b');
  f.host.postTerminalAvailable('terminal', 'node-a', replacement);
  assert.equal(f.posts.length, 2, 'new execution identity must replace the old notification responsibility.');
  replacement.outputSequence = 2;
  f.host.postTerminalAvailable('terminal', 'node-a', replacement);
  f.host.receiveTerminalAvailable('editor', oldExecution);
  assert.equal(f.posts.length, 2, 'old execution receipt must not release replacement credit.');

  const oldFrame = receipt(f.posts.at(-1));
  f.host.markSurfaceReady('editor', { surface: 'editor', mode: 'active', generation: 1, frameId: 'editor-frame-2' },
    { terminalAvailableReceiptV1: true });
  assert.equal(f.host.terminalAvailableNotifications.size, 0);
  f.host.surfaceLifecycle.editor.bootstrapAck = true;
  f.host.postTerminalAvailable('terminal', 'node-a', replacement);
  replacement.outputSequence = 3;
  f.host.postTerminalAvailable('terminal', 'node-a', replacement);
  const beforeOldFrameReceipt = f.posts.length;
  f.host.receiveTerminalAvailable('editor', oldFrame);
  assert.equal(f.posts.length, beforeOldFrameReceipt);
  assert.equal(f.posts.at(-1).message.lifecycle.frameId, 'editor-frame-2');

  const beforeRender = receipt(f.posts.at(-1));
  f.host.beginSurfaceRender('editor', 'active');
  assert.equal(f.host.terminalAvailableNotifications.size, 0);
  f.host.receiveTerminalAvailable('editor', beforeRender);
  assert.equal(f.posts.length, beforeOldFrameReceipt);
  f.host.surfaceLifecycle.editor.terminalAvailableReceiptV1 = true;
  f.host.surfaceLifecycle.editor.bootstrapAck = true;
  f.host.postTerminalAvailable('terminal', 'node-a', replacement);
  const beforeInvalidation = receipt(f.posts.at(-1));
  f.host.invalidateSurfaceLifecycle('editor', 'standby');
  assert.equal(f.host.terminalAvailableNotifications.size, 0);
  f.host.receiveTerminalAvailable('editor', beforeInvalidation);
  const beforeReset = f.posts.length;
  f.host.clearTerminalAvailableNotifications();
  f.host.flushTerminalAvailableNotifications('editor');
  assert.equal(f.posts.length, beforeReset, 'reset/invalidation must not resurrect a pending old notification.');
}

function verifyBootstrapAndCompletion(Harness) {
  const f = fixture(Harness);
  const session = makeSession();
  f.host.surfaceLifecycle.editor.bootstrapAck = false;
  for (let revision = 1; revision <= 1000; revision += 1) {
    session.outputSequence = revision;
    f.host.postTerminalAvailable('terminal', 'node-a', session, revision === 3 ? null : undefined);
  }
  assert.equal(f.posts.length, 0);
  assert.equal(f.bootstrapQueue.length, 0, 'held notifications must not fill the ordinary bootstrap message array.');
  assert.equal(f.host.terminalAvailableNotifications.size, 1);
  f.host.surfaceLifecycle.editor.bootstrapAck = true;
  f.host.flushTerminalAvailableNotifications('editor');
  assert.equal(f.posts.length, 1);
  assert.equal(f.posts[0].message.payload.revision, 1000);
  assert.equal(f.posts[0].message.payload.terminalTitle, null);
  const ordinaryReceipt = receipt(f.posts[0]);
  session.outputSequence = 1001;
  f.host.postTerminalAvailable('terminal', 'node-a', session);
  const final = { nodeId: 'node-a', kind: 'terminal', executionSessionId: session.sessionId,
    authorityId: session.terminalAuthorityId, revision: 1001, completed: true };
  f.host.postCompletedTerminalAvailable('editor', final);
  assert.equal(f.posts.length, 2, 'completion must bypass the unacknowledged ordinary notification.');
  assert.deepEqual(f.posts[1].message.payload, final);
  assert.equal(f.posts[1].message.payload.receiptId, undefined);
  assert.equal(f.host.terminalAvailableNotifications.size, 0);
  f.host.receiveTerminalAvailable('editor', ordinaryReceipt);
  f.host.flushTerminalAvailableNotifications('editor');
  assert.equal(f.posts.length, 2, 'late receipt must not send a live hint after completion.');
}

function verifyLegacyAndIndependentNodes(Harness) {
  const legacy = fixture(Harness, false);
  const session = makeSession();
  for (let revision = 1; revision <= 4; revision += 1) {
    session.outputSequence = revision;
    legacy.host.postTerminalAvailable('terminal', 'node-a', session);
  }
  assert.equal(legacy.posts.length, 4, 'an old page without receipt capability retains its original notification contract.');
  assert.ok(legacy.posts.every(post => post.message.payload.receiptId === undefined));
  assert.equal(legacy.host.terminalAvailableNotifications.size, 0);

  const f = fixture(Harness);
  const a = makeSession();
  const b = makeSession('session-b', 'authority-b');
  f.host.postTerminalAvailable('terminal', 'node-a', a);
  f.host.postTerminalAvailable('agent', 'node-b', b);
  a.outputSequence = 2;
  b.outputSequence = 3;
  f.host.postTerminalAvailable('terminal', 'node-a', a);
  f.host.postTerminalAvailable('agent', 'node-b', b);
  f.host.receiveTerminalAvailable('editor', receipt(f.posts[1]));
  assert.equal(f.posts.length, 3);
  assert.equal(f.posts.at(-1).message.payload.nodeId, 'node-b');
  assert.equal(f.posts.at(-1).message.payload.revision, 3);
  assert.equal(f.host.terminalAvailableNotifications.size, 2);
  f.host.activeSurface = 'panel';
  f.host.postTerminalAvailable('terminal', 'node-a', a);
  assert.equal(f.posts.length, 4, 'a second surface has independent notification credit.');
  const panelReceipt = receipt(f.posts.at(-1));
  f.host.clearTerminalAvailableNotifications('editor');
  assert.equal(f.host.terminalAvailableNotifications.size, 1);
  f.host.receiveTerminalAvailable('panel', panelReceipt);
  assert.equal(f.host.terminalAvailableNotifications.size, 0);
}

async function verifyReattachPublishesCurrentHead(Harness) {
  const f = fixture(Harness);
  const session = { ...makeSession(), terminalStreamHealthy: true, terminalTitle: 'current-title' };
  const descriptor = {
    readId: 'same-reader', sessionId: session.sessionId, authorityId: session.terminalAuthorityId,
    checkpoint: { revision: 0, cols: 80, rows: 24, serializedState: '' }, headRevision: 0
  };
  f.host.state = { nodes: [] };
  f.host.getExecutionSessions = () => new Map([['node-a', session]]);
  f.host.getRuntimeSupervisorClientForKind = async () => ({ supportsTerminalReadSettlement: () => false });
  f.host.terminalReadRelay.open = async () => descriptor;
  f.host.recordDiagnosticEvent = () => {};
  f.host.postTerminalAvailable('terminal', 'node-a', session);
  const oldReceipt = receipt(f.posts[0]);
  session.outputSequence = 2;
  f.host.postTerminalAvailable('terminal', 'node-a', session);
  assert.equal(f.posts.length, 1);

  // A reused reader can retain its original head while newer output is already pending.
  await f.host.postPagedExecutionSnapshot('terminal', 'node-a', session, { surface: 'editor' });
  assert.equal(f.posts.length, 2);
  assert.equal(f.posts[1].message.type, 'host/executionSnapshot');
  assert.equal(f.posts[1].message.payload.terminalRead.readId, 'same-reader');
  assert.equal(f.posts[1].message.payload.terminalRead.headRevision, 0);
  for (let attempt = 0; attempt < 3; attempt++) {
    await f.host.postPagedExecutionSnapshot('terminal', 'node-a', session, { surface: 'editor' });
  }
  assert.equal(f.posts.filter(post => post.message.type === 'host/executionTerminalAvailable').length, 1,
    'same-identity reattach must not bypass in-flight notification credit.');
  f.host.receiveTerminalAvailable('editor', oldReceipt);
  const current = f.posts.at(-1);
  assert.equal(current.message.type, 'host/executionTerminalAvailable');
  assert.equal(current.message.payload.revision, 2, 'reattach must advertise the current head, not the reused descriptor head.');
  assert.equal(current.message.payload.terminalTitle, 'current-title');
  assert.notEqual(current.message.payload.receiptId, oldReceipt.receiptId);

  session.outputSequence = 3;
  f.host.postTerminalAvailable('terminal', 'node-a', session);
  f.host.receiveTerminalAvailable('editor', oldReceipt);
  assert.equal(f.posts.at(-1), current, 'a duplicate receipt must not release the next notification.');
  f.host.receiveTerminalAvailable('editor', receipt(current));
  assert.equal(f.posts.at(-1).message.payload.revision, 3);
  f.host.receiveTerminalAvailable('editor', receipt(f.posts.at(-1)));
  assert.equal(f.host.terminalAvailableNotifications.size, 0);
}

async function verifyDeliveryOutcomes(Harness) {
  const delivered = fixture(Harness, true, () => Promise.resolve(true));
  const deliveredSession = makeSession();
  delivered.host.postTerminalAvailable('terminal', 'node-a', deliveredSession);
  await nextTurn();
  deliveredSession.outputSequence = 2;
  delivered.host.postTerminalAvailable('terminal', 'node-a', deliveredSession);
  delivered.host.flushTerminalAvailableNotifications('editor');
  assert.equal(delivered.posts.length, 1, 'successful delivery must still wait for a Webview receipt.');

  let resolveFailure;
  let attempts = 0;
  const failed = fixture(Harness, true, () => ++attempts === 1
    ? new Promise(resolve => { resolveFailure = resolve; }) : true);
  const failedSession = makeSession();
  failed.host.postTerminalAvailable('terminal', 'node-a', failedSession, 'old-title');
  const failedReceipt = receipt(failed.posts[0]);
  failedSession.outputSequence = 2;
  failed.host.postTerminalAvailable('terminal', 'node-a', failedSession, null);
  failedSession.outputSequence = 3;
  failed.host.postTerminalAvailable('terminal', 'node-a', failedSession);
  resolveFailure(false);
  await nextTurn();
  assert.equal(failed.posts.length, 1, 'failed delivery must not start an automatic retry loop.');
  failed.host.surfaceLifecycle.editor.bootstrapAck = false;
  failed.host.flushTerminalAvailableNotifications('editor');
  assert.equal(failed.posts.length, 1);
  assert.equal(failed.bootstrapQueue.length, 0, 'resume must not bypass bootstrap acknowledgement.');
  failed.host.surfaceLifecycle.editor.bootstrapAck = true;
  failed.host.flushTerminalAvailableNotifications('editor');
  assert.equal(failed.posts.length, 2);
  assert.equal(failed.posts[1].message.payload.revision, 3);
  assert.equal(failed.posts[1].message.payload.terminalTitle, null);
  assert.notEqual(failed.posts[1].message.payload.receiptId, failedReceipt.receiptId);
  failedSession.outputSequence = 4;
  failed.host.postTerminalAvailable('terminal', 'node-a', failedSession);
  failed.host.receiveTerminalAvailable('editor', failedReceipt);
  assert.equal(failed.posts.length, 2);
  failed.host.receiveTerminalAvailable('editor', receipt(failed.posts[1]));
  assert.equal(failed.posts.at(-1).message.payload.revision, 4);

  for (const failure of ['throw', 'reject']) {
    let calls = 0;
    const f = fixture(Harness, true, () => {
      if (++calls !== 1) return true;
      const error = new Error(`controlled postMessage ${failure}`);
      if (failure === 'throw') throw error;
      return Promise.reject(error);
    });
    const session = makeSession();
    assert.doesNotThrow(() => f.host.postTerminalAvailable('agent', 'node-a', session, null));
    await nextTurn();
    assert.equal(f.posts.length, 1);
    session.outputSequence = 2;
    f.host.postTerminalAvailable('agent', 'node-a', session);
    assert.equal(f.posts.length, 2, `${failure} must allow the next activity to retry.`);
    assert.equal(f.posts[1].message.payload.revision, 2);
    assert.equal(f.posts[1].message.payload.terminalTitle, null);
    await nextTurn();
  }

  let resolveOldDelivery;
  let replacements = 0;
  const replaced = fixture(Harness, true, () => ++replacements === 1
    ? new Promise(resolve => { resolveOldDelivery = resolve; }) : true);
  replaced.host.postTerminalAvailable('terminal', 'node-a', makeSession());
  const replacement = makeSession('session-b', 'authority-b');
  replaced.host.postTerminalAvailable('terminal', 'node-a', replacement);
  replacement.outputSequence = 2;
  replaced.host.postTerminalAvailable('terminal', 'node-a', replacement);
  resolveOldDelivery(false);
  await nextTurn();
  replaced.host.flushTerminalAvailableNotifications('editor');
  assert.equal(replaced.posts.length, 2, 'late delivery failure must not alter replacement notification credit.');
  replaced.host.receiveTerminalAvailable('editor', receipt(replaced.posts[1]));
  assert.equal(replaced.posts.length, 3);
  assert.equal(replaced.posts[2].message.payload.executionSessionId, 'session-b');
  assert.equal(replaced.posts[2].message.payload.revision, 2);
}

function nextTurn() {
  return new Promise(resolve => setImmediate(resolve));
}

function verifyActualDeliveryReturn(Harness) {
  const host = new Harness();
  const delivery = Promise.resolve(true);
  const posts = [];
  const message = { type: 'host/executionTerminalAvailable', payload: {
    nodeId: 'node-a', kind: 'terminal', executionSessionId: 'session-a', authorityId: 'authority-a', revision: 1
  } };
  const prepared = { ...message, lifecycle: { surface: 'editor', mode: 'active', generation: 1, frameId: 'frame-a' } };
  host.activeSurface = 'editor';
  host.isInteractiveSurface = () => true;
  host.getSurfaceMessageWebview = () => ({ postMessage: next => { posts.push(next); return delivery; } });
  host.withSurfaceLifecycle = () => prepared;
  host.shouldQueueUntilBootstrapAck = () => false;
  host.recordHostMessage = () => {};
  assert.equal(host.postMessageWithDeliveryResult(message), delivery,
    'the credit-specific path must return the original Webview Thenable.');
  assert.equal(host.postMessage(message), undefined,
    'ordinary Host postMessage must retain its void return contract.');
  assert.deepEqual(posts, [prepared, prepared]);
}
