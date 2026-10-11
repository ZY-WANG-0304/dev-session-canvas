import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import esbuild from 'esbuild';
import { stageSmokeTestSuite } from '../smoke/vscode-smoke-runner.mjs';

const require = createRequire(import.meta.url);
const { Terminal } = require('@xterm/headless');
const temporary = await mkdtemp(path.join(os.tmpdir(), 'dsc-smoke-history-'));
let passed = 0;
try {
  // Loading from outside the checkout also verifies the staged dependency closure.
  const suite = await stageSmokeTestSuite({ projectRoot: process.cwd(), targetRoot: temporary });
  const { collectTerminalHistory: collect, restoreTerminalHistory: restore } = require(path.join(suite, 'terminal-history.cjs'));
  const codec = path.join(temporary, 'codec.cjs');
  await esbuild.build({ entryPoints: ['extensions/vscode/dev-session-canvas/src/common/terminalCurrentState.ts'],
    bundle: true, platform: 'node', format: 'cjs', outfile: codec });
  const { captureTerminalCurrentState: capture, createTerminalCurrentColors } = require(codec);
  const terminal = new Terminal({ cols: 64, rows: 20, scrollback: 240, allowProposedApi: true });
  const markers = Array.from({ length: 220 }, (_, index) => `DSC_LRSP-${String(index + 1).padStart(3, '0')}`);
  let state;
  try {
    await new Promise(resolve => terminal.write(markers.join('\r\n') + '\r\n', resolve));
    state = capture(terminal, createTerminalCurrentColors());
  } finally { terminal.dispose(); }
  const serialized = JSON.stringify(state);
  const expected = { kind: 'terminal', nodeId: 'node', executionSessionId: 'session',
    lifecycle: { surface: 'editor', mode: 'active', generation: 2, frameId: 'frame' } };
  const identity = { sessionId: 'session', authorityId: 'authority', readId: 'reader' };
  const checkpoint = { version: 1, sessionId: 'session', authorityId: 'authority', revision: 9,
    cols: 64, rows: 20, scrollback: 240, createdAtMs: 1,
    serializedState: { format: 'xterm-serialize-v1', data: '', outputSequence: 9 } };
  const snapshot = { type: 'host/executionSnapshot', lifecycle: expected.lifecycle,
    payload: { kind: 'terminal', nodeId: 'node', executionSessionId: 'session', outputSequence: 9,
      terminalRead: { ...identity, checkpoint, headRevision: 9,
        currentState: { format: 'xterm-current-state-v1', length: serialized.length } } } };
  const pages = [];
  function message(page) {
    return { type: 'host/executionTerminalPage', lifecycle: expected.lifecycle,
      payload: { kind: 'terminal', nodeId: 'node', executionSessionId: 'session',
        authorityId: 'authority', readId: 'reader', requestId: `request-${pages.length}`, page } };
  }
  for (let offset = 0; offset < serialized.length; offset += 8192) {
    pages.push(message({ ...identity, afterRevision: 9, revision: 9, headRevision: 9, events: [],
      stateChunk: { offset, data: serialized.slice(offset, offset + 8192) } }));
  }
  pages.push(message({ ...identity, afterRevision: 9, revision: 9, headRevision: 9, events: [] }));
  async function check(name, run) { await run(); passed++; console.log(`PASS ${name}`); }
  const collectPages = messages => collect(snapshot, messages, expected);
  await check('reused reader restores all 220 unique ordered lines from earlier pages', async () => {
    const result = collectPages(pages);
    assert.equal(result.revision, 9);
    const restored = await restore(result);
    assert.deepEqual(restored.lines.filter(line => /^DSC_LRSP-[0-9]{3}$/.test(line)), markers);
    assert.equal(restored.scrollback, 240);
  });
  await check('missing bootstrap or confirmation never succeeds', () => {
    assert.equal(collectPages([]), undefined);
    assert.equal(collectPages(pages.slice(0, 1)), undefined);
    assert.equal(collectPages(pages.slice(0, -1)), undefined);
    assert.throws(() => collectPages(pages.slice(1)), /Non-contiguous/);
  });
  await check('other nodes, sessions, readers, authorities and lifecycle cannot supply history', () => {
    for (const key of ['kind', 'nodeId', 'executionSessionId', 'authorityId', 'readId']) {
      const wrong = structuredClone(pages);
      wrong.forEach(item => { item.payload[key] = 'other'; });
      assert.equal(collectPages(wrong), undefined, key);
      assert.ok(collectPages([...wrong, ...pages]));
    }
    for (const key of ['surface', 'mode', 'generation', 'frameId']) {
      const wrong = structuredClone(pages);
      wrong.forEach(item => { item.lifecycle[key] = 'other'; });
      assert.equal(collectPages(wrong), undefined, key);
    }
  });
  await check('malformed inner identity, offsets, length and revisions fail', () => {
    const mutations = [
      items => { items[0].payload.page.sessionId = 'other'; },
      items => { items[0].payload.page.stateChunk.offset = 1; },
      items => { items[0].payload.page.stateChunk.data = ''; },
      items => { items[1].payload.page.stateChunk.offset = 0; },
      items => { items[0].payload.page.revision = 10; },
      items => { items.at(-1).payload.page.afterRevision = 8; },
      items => { items[0].payload.error = 'closed'; }
    ];
    for (const mutate of mutations) {
      const wrong = structuredClone(pages); mutate(wrong);
      assert.throws(() => collectPages(wrong));
    }
    const wrong = structuredClone(snapshot);
    wrong.payload.terminalRead.currentState.length--;
    assert.throws(() => collect(wrong, pages, expected), /exceeds/);
    wrong.payload.outputSequence++;
    assert.throws(() => collect(wrong, pages, expected));
  });
  await check('identical captured response deduplicates; conflicting response fails', () => {
    assert.deepEqual(collectPages([pages[0], ...pages]), collectPages(pages));
    const wrong = structuredClone(pages[0]); wrong.payload.page.stateChunk.data = 'wrong';
    assert.throws(() => collectPages([pages[0], wrong, ...pages.slice(1)]), /Conflicting duplicate/);
  });
  await check('suffix output, resize and scrollback apply in continuous revision order', async () => {
    const suffix = message({ ...identity, afterRevision: 9, revision: 12, headRevision: 12,
      events: [ { type: 'output', data: 'suffix-line', revision: 10, createdAtMs: 2 },
        { type: 'resize', cols: 70, rows: 22, revision: 11, createdAtMs: 3 },
        { type: 'scrollback', scrollback: 250, revision: 12, createdAtMs: 4 } ] });
    const result = collectPages([...pages, suffix]);
    assert.equal(result.revision, 12);
    const restored = await restore(result);
    assert.ok(restored.lines.includes('suffix-line'));
    assert.equal(restored.cols, 70); assert.equal(restored.rows, 22); assert.equal(restored.scrollback, 250);
    const wrong = structuredClone(suffix); wrong.payload.page.events[0].revision++;
    assert.throws(() => collectPages([...pages, wrong]), /Invalid/);
    const duplicate = structuredClone(suffix); duplicate.payload.requestId = 'duplicate-event';
    assert.throws(() => collectPages([...pages, suffix, duplicate]), /Non-contiguous/);
    const behind = structuredClone(snapshot); behind.payload.terminalRead.headRevision = 12;
    assert.equal(collect(behind, pages, expected), undefined);
    assert.ok(collect(behind, [...pages, suffix], expected));
  });
  console.log(`Smoke terminal history: ${passed} checks passed.`);
} finally { await rm(temporary, { recursive: true, force: true }); }
