const { createHash } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { isDeepStrictEqual } = require('node:util');
const { Terminal } = require('@xterm/headless');
const { SerializeAddon } = require('@xterm/addon-serialize');

const hash = value => createHash('sha256').update(value).digest('hex');
const integer = value => Number.isSafeInteger(value) && value >= 0;
const dimensions = value => integer(value?.cols) && value.cols > 1 && integer(value?.rows) && value.rows > 0;
const serialized = value => value?.format === 'xterm-serialize-v1' && typeof value.data === 'string' &&
  integer(value.outputSequence) && (value.viewportY === undefined || integer(value.viewportY));
const nodeProbe = (probe, nodeId) => probe?.nodes?.find(node => node.nodeId === nodeId);
const lifecycle = value => ['panel', 'editor'].includes(value?.surface) && ['active', 'standby'].includes(value?.mode) &&
  integer(value?.generation) && typeof value?.frameId === 'string' && value.frameId.length > 0
  ? [value.surface, value.mode, value.generation, value.frameId] : undefined;
const same = isDeepStrictEqual;
const write = (terminal, data) => new Promise(resolve => terminal.write(data, resolve));
const terminalGeometry = state => Object.fromEntries(['cols', 'rows', 'cursorX', 'cursorY', 'viewportY', 'bufferType']
  .map(key => [key, state[key]]));
const pageGeometry = probe => probe && ({ cols: probe.terminalCols, rows: probe.terminalRows,
  cursorX: probe.terminalCursorX, cursorY: probe.terminalCursorY, viewportY: probe.terminalViewportY,
  bufferType: probe.terminalBufferType });

function runtime(cols, rows, scrollback) {
  const terminal = new Terminal({ cols, rows, scrollback, allowProposedApi: true });
  const addon = new SerializeAddon();
  terminal.loadAddon(addon);
  return { terminal, addon };
}

function readTerminal({ terminal, addon }) {
  const buffer = terminal.buffer.active;
  const lines = Array.from({ length: buffer.length }, (_, index) => buffer.getLine(index)?.translateToString(true) ?? '');
  return { cols: terminal.cols, rows: terminal.rows, cursorX: buffer.cursorX, cursorY: buffer.cursorY,
    viewportY: buffer.viewportY, bufferType: buffer.type, lines,
    visibleLines: Array.from({ length: terminal.rows }, (_, index) => lines[buffer.viewportY + index] ?? ''),
    serialized: addon.serialize({ scrollback: terminal.options.scrollback, excludeAltBuffer: false, excludeModes: false }) };
}

async function comparePage(state, probe, assertBuffer) {
  const observed = probe && ['terminalCols', 'terminalRows', 'terminalCursorX', 'terminalCursorY', 'terminalViewportY']
    .every(key => integer(probe[key])) && Array.isArray(probe.terminalVisibleLines);
  if (!observed) return { geometry: null, fields: null, visible: null, buffer: null, matches: null };
  const observedGeometry = pageGeometry(probe);
  const fields = Object.fromEntries(Object.entries(terminalGeometry(state)).map(([key, value]) => [key, value === observedGeometry[key]]));
  const geometry = state.cols === probe.terminalCols && state.rows === probe.terminalRows &&
    state.cursorX === probe.terminalCursorX && state.cursorY === probe.terminalCursorY &&
    state.viewportY === probe.terminalViewportY && state.bufferType === probe.terminalBufferType;
  const visible = same(state.visibleLines, probe.terminalVisibleLines);
  let buffer = null;
  try { buffer = await assertBuffer(state.lines.filter(line => line.length > 0)) === true; }
  catch { buffer = null; }
  return { geometry, fields, visible, buffer, matches: !geometry || !visible || buffer === false ? false : buffer };
}

// This diagnostic never feeds later snapshots back into the replay terminal.
async function replayMessages({ messages, nodeId, executionId, scrollback, finalSequence }) {
  const unknown = reason => ({ reason, complete: false });
  if (!Array.isArray(messages)) return unknown('messages-missing');
  if (messages.length >= 200) return unknown('message-window-full');
  const allRelevant = messages.filter(message => message.payload?.nodeId === nodeId &&
    ['host/executionSnapshot', 'host/executionOutput', 'host/executionExit'].includes(message.type));
  const firstIndex = allRelevant.findIndex(message => message.payload.executionSessionId === executionId);
  if (firstIndex < 0) return unknown('initial-checkpoint-missing');
  const relevant = allRelevant.slice(firstIndex);
  if (relevant.some(message => message.payload.executionSessionId !== executionId)) return unknown('execution-changed');
  const first = relevant[0];
  const initial = first?.payload;
  const identity = lifecycle(first.lifecycle);
  const prefix = allRelevant.slice(0, firstIndex);
  if (prefix.some(message => message.type !== 'host/executionSnapshot' ||
      message.payload.executionSessionId !== undefined || message.payload.liveSession !== false ||
      message.payload.output !== '' || message.payload.outputSequence !== undefined ||
      message.payload.serializedTerminalState !== undefined || message.payload.terminalRead !== undefined ||
      message.payload.terminalStream !== undefined || !identity || !same(lifecycle(message.lifecycle), identity))) {
    return unknown('execution-changed');
  }
  const initialState = initial.serializedTerminalState;
  const initialZero = initial.outputSequence === 0 && initial.output === '' &&
    initial.terminalRead === undefined && initial.terminalStream === undefined &&
    initialState?.format === 'xterm-serialize-v1' && initialState.data === '' &&
    initialState.outputSequence === undefined && (initialState.viewportY === undefined || initialState.viewportY === 0);
  if (first?.type !== 'host/executionSnapshot' || initial.liveSession !== true || !dimensions(initial) ||
      (!initialZero && (!serialized(initialState) || initial.outputSequence !== initialState.outputSequence))) {
    return unknown('initial-checkpoint-missing');
  }
  if (!identity || relevant.some(message => !same(lifecycle(message.lifecycle), identity))) return unknown('reader-changed');
  const state = runtime(initial.cols, initial.rows, scrollback);
  const result = { complete: false, reason: 'unknown', initialSequence: initial.outputSequence,
    inactivePrefixSnapshots: prefix.length, equivalentInitialSnapshots: 0, initialZeroSequenceInferred: initialZero,
    outputMessages: 0, resizeSnapshots: 0, finalSnapshot: undefined };
  let sequence = initial.outputSequence;
  let initialPhase = true;
  let finalSeen = false;
  let exitSeen = false;
  try {
    await write(state.terminal, initial.serializedTerminalState.data);
    if (initial.serializedTerminalState.viewportY !== undefined) state.terminal.scrollToLine(initial.serializedTerminalState.viewportY);
    for (const message of relevant.slice(1)) {
      const payload = message.payload;
      if (initialPhase && message.type === 'host/executionSnapshot' && same(payload, initial)) {
        result.equivalentInitialSnapshots += 1;
        continue;
      }
      initialPhase = false;
      if (message.type === 'host/executionOutput') {
        if (finalSeen || !integer(payload.outputStartSequence) || !integer(payload.outputSequence) ||
            payload.outputStartSequence !== sequence + 1 || payload.outputSequence < payload.outputStartSequence ||
            typeof payload.chunk !== 'string') return { ...result, reason: 'output-range-missing' };
        await write(state.terminal, payload.chunk);
        sequence = payload.outputSequence;
        result.outputMessages += 1;
      } else if (message.type === 'host/executionSnapshot') {
        if (!dimensions(payload) || !serialized(payload.serializedTerminalState) ||
            payload.outputSequence !== payload.serializedTerminalState.outputSequence) {
          return { ...result, reason: 'snapshot-invalid' };
        }
        if (!finalSeen && payload.liveSession === false && payload.outputSequence === sequence &&
            payload.cols === state.terminal.cols && payload.rows === state.terminal.rows) {
          finalSeen = true;
          result.finalSnapshot = payload;
        } else if (!finalSeen && payload.liveSession === true && payload.outputSequence === sequence + 1 &&
            (payload.cols !== state.terminal.cols || payload.rows !== state.terminal.rows)) {
          state.terminal.resize(payload.cols, payload.rows);
          sequence = payload.outputSequence;
          result.resizeSnapshots += 1;
          if (readTerminal(state).serialized !== payload.serializedTerminalState.data) {
            return { ...result, reason: 'resize-checkpoint-mismatch' };
          }
        } else return { ...result, reason: 'projection-recovery-or-unknown-snapshot' };
      } else if (!finalSeen || exitSeen || payload.localCompletion?.executionSessionId !== executionId ||
          payload.localCompletion.finalOutputSequence !== sequence) {
        return { ...result, reason: 'exit-boundary-missing' };
      } else exitSeen = true;
    }
    if (!finalSeen || !exitSeen) return { ...result, reason: 'exit-boundary-missing' };
    if (sequence !== finalSequence) return { ...result, reason: 'final-sequence-mismatch' };
    return { ...result, complete: true, reason: 'complete', state: readTerminal(state) };
  } finally { state.terminal.dispose(); }
}

async function collectSnapshotEvidence({ savedNode, nodeId, executionId, messages, events, helpProbe, finalProbe,
  assertBuffer, scrollback = 10000 }) {
  const metadata = savedNode?.metadata?.agent;
  const saved = metadata?.serializedTerminalState;
  const help = nodeProbe(helpProbe, nodeId);
  const page = nodeProbe(finalProbe, nodeId);
  const settlements = (events ?? []).filter(event => event.kind === 'execution/localTerminalReaderSettled' &&
    event.detail?.nodeId === nodeId && event.detail.executionSessionId === executionId);
  const outcome = settlements.length === 1 ? settlements[0].detail.outcome : undefined;
  const readerLifecycle = settlements.length === 1 ? lifecycle(settlements[0].detail.lifecycle) : undefined;
  const initialLifecycle = lifecycle(messages?.find(message => message.type === 'host/executionSnapshot' &&
    message.payload?.nodeId === nodeId && message.payload.executionSessionId === executionId)?.lifecycle);
  const evidence = { schemaVersion: 1, helperSha256: hash(readFileSync(__filename)),
    savedNodeMatched: savedNode?.id === nodeId, savedStatePresent: saved !== undefined,
    savedStateValid: serialized(saved), savedDataBytes: typeof saved?.data === 'string' ? Buffer.byteLength(saved.data) : null,
    savedDataSha256: typeof saved?.data === 'string' ? hash(saved.data) : null,
    savedOutputSequence: integer(metadata?.outputSequence) ? metadata.outputSequence : null,
    snapshotOutputSequence: integer(saved?.outputSequence) ? saved.outputSequence : null,
    readerApplied: outcome?.kind === 'applied',
    readerLifecycleMatched: readerLifecycle && initialLifecycle ? same(readerLifecycle, initialLifecycle) : null,
    readerFinalOutputSequence: integer(outcome?.finalOutputSequence) ? outcome.finalOutputSequence : null,
    sequenceMatched: outcome?.kind === 'applied' && integer(saved?.outputSequence) &&
      saved.outputSequence === metadata?.outputSequence && saved.outputSequence === outcome.finalOutputSequence,
    helpProbePresent: !!help,
    helpNonEmptyLines: Array.isArray(help?.terminalVisibleLines) ? help.terminalVisibleLines.filter(line => line.length > 0).length : null,
    finalProbePresent: !!page, savedCols: integer(metadata?.lastCols) ? metadata.lastCols : null,
    savedRows: integer(metadata?.lastRows) ? metadata.lastRows : null,
    messageCount: Array.isArray(messages) ? messages.length : null,
    pageGeometryMatched: null, pageVisibleMatched: null, pageBufferMatched: null, savedMatchesPage: null,
    savedGeometry: null, pageGeometry: pageGeometry(page) ?? null, publishedGeometry: null, pageGeometryMatches: null,
    resizedSavedPageGeometryMatched: null, resizedSavedPageVisibleMatched: null,
    resizedSavedPageBufferMatched: null, resizedSavedMatchesPage: null,
    hydratedStateSha256: null, replayStateSha256: null, replayComplete: false, replayReason: 'unknown',
    replayInitialSequence: null, replayOutputMessages: null, replayResizeSnapshots: null,
    replayInactivePrefixSnapshots: null, replayEquivalentInitialSnapshots: null, replayInitialZeroSequenceInferred: null,
    replayMatchesSaved: null, replayMatchesPage: null, publishedFinalMatchesSaved: null,
    pageProjectionIndependence: 'not-proven' };
  let hydrated, resized;
  try {
    if (!evidence.savedNodeMatched || !serialized(saved) || !dimensions({ cols: metadata?.lastCols, rows: metadata?.lastRows })) {
      evidence.replayReason = 'saved-state-invalid';
      return evidence;
    }
    hydrated = runtime(metadata.lastCols, metadata.lastRows, scrollback);
    await write(hydrated.terminal, saved.data);
    if (saved.viewportY !== undefined) hydrated.terminal.scrollToLine(saved.viewportY);
    const savedState = readTerminal(hydrated);
    evidence.savedGeometry = terminalGeometry(savedState);
    evidence.hydratedStateSha256 = hash(JSON.stringify(savedState));
    const pageComparison = await comparePage(savedState, page, assertBuffer);
    evidence.pageGeometryMatched = pageComparison.geometry;
    evidence.pageGeometryMatches = pageComparison.fields;
    evidence.pageVisibleMatched = pageComparison.visible;
    evidence.pageBufferMatched = pageComparison.buffer;
    evidence.savedMatchesPage = pageComparison.matches;
    const replay = await replayMessages({ messages, nodeId, executionId, scrollback, finalSequence: saved.outputSequence });
    evidence.replayComplete = replay.complete;
    evidence.replayReason = replay.reason;
    evidence.replayInitialSequence = replay.initialSequence ?? null;
    evidence.replayOutputMessages = replay.outputMessages ?? null;
    evidence.replayResizeSnapshots = replay.resizeSnapshots ?? null;
    evidence.replayInactivePrefixSnapshots = replay.inactivePrefixSnapshots ?? null;
    evidence.replayEquivalentInitialSnapshots = replay.equivalentInitialSnapshots ?? null;
    evidence.replayInitialZeroSequenceInferred = replay.initialZeroSequenceInferred ?? null;
    if (replay.finalSnapshot) {
      evidence.publishedGeometry = { cols: replay.finalSnapshot.cols, rows: replay.finalSnapshot.rows };
      evidence.publishedFinalMatchesSaved = same(replay.finalSnapshot.serializedTerminalState, saved) &&
        replay.finalSnapshot.cols === metadata.lastCols && replay.finalSnapshot.rows === metadata.lastRows;
    }
    if (replay.complete) {
      evidence.replayStateSha256 = hash(JSON.stringify(replay.state));
      evidence.replayMatchesSaved = same(replay.state, savedState);
      evidence.replayMatchesPage = (await comparePage(replay.state, page, assertBuffer)).matches;
    }
    if (dimensions({ cols: page?.terminalCols, rows: page?.terminalRows })) {
      // This extra reflow neither changes direct comparisons nor imports page content/cursor/viewport.
      try {
        resized = runtime(metadata.lastCols, metadata.lastRows, scrollback);
        await write(resized.terminal, saved.data);
        if (saved.viewportY !== undefined) resized.terminal.scrollToLine(saved.viewportY);
        resized.terminal.resize(page.terminalCols, page.terminalRows);
        const comparison = await comparePage(readTerminal(resized), page, assertBuffer);
        evidence.resizedSavedPageGeometryMatched = comparison.geometry;
        evidence.resizedSavedPageVisibleMatched = comparison.visible;
        evidence.resizedSavedPageBufferMatched = comparison.buffer;
        evidence.resizedSavedMatchesPage = comparison.matches;
      } catch { /* Optional reflow evidence stays unknown without changing direct results. */ }
    }
  } catch { evidence.replayComplete = false; evidence.replayReason = 'evidence-computation-failed'; }
  finally { hydrated?.terminal.dispose(); resized?.terminal.dispose(); }
  return evidence;
}

module.exports = { collectSnapshotEvidence };
