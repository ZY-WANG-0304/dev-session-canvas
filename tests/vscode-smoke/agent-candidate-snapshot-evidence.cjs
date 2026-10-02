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
const semanticStyleFlags = ['Bold', 'Dim', 'Italic', 'Underline', 'Overline', 'Blink', 'Inverse', 'Invisible', 'Strikethrough'];
const semanticModeNames = ['applicationCursorKeysMode', 'applicationKeypadMode', 'bracketedPasteMode', 'insertMode',
  'originMode', 'reverseWraparoundMode', 'sendFocusMode', 'wraparoundMode', 'mouseTrackingMode'];
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

function readSemanticState(terminal) {
  try {
    const style = cell => {
      const color = prefix => {
        const modes = ['Default', 'Palette', 'RGB'].map(name => cell[`is${prefix}${name}`]());
        if (!modes.every(value => typeof value === 'boolean') || modes.filter(Boolean).length !== 1) {
          throw new Error('Unknown terminal color mode.');
        }
        if (modes[0]) return ['default'];
        const value = cell[`get${prefix}Color`]();
        if (!integer(value)) throw new Error('Unknown terminal color.');
        // SGR 30/40 and SGR 38/48;5 use the same palette despite different internal modes.
        if (modes[1] && value <= 255) return ['palette', value];
        if (modes[2] && value <= 0xffffff) return ['rgb', value];
        throw new Error('Unknown terminal color mode.');
      };
      return { foreground: color('Fg'), background: color('Bg'),
        flags: semanticStyleFlags
          .map(name => {
            const value = cell[`is${name}`]();
            if (!Number.isSafeInteger(value)) throw new Error('Unknown terminal style.');
            return value !== 0;
          }) };
    };
    const bufferState = buffer => {
      if (!['normal', 'alternate'].includes(buffer.type) ||
          !['cursorX', 'cursorY', 'baseY', 'viewportY', 'length'].every(name => integer(buffer[name]))) {
        throw new Error('Unknown terminal buffer.');
      }
      return { type: buffer.type, cursorX: buffer.cursorX, cursorY: buffer.cursorY,
        baseY: buffer.baseY, viewportY: buffer.viewportY,
        lines: Array.from({ length: buffer.length }, (_, row) => {
          const line = buffer.getLine(row);
          if (!integer(line.length) || typeof line.isWrapped !== 'boolean') throw new Error('Unknown terminal line.');
          return { wrapped: line.isWrapped, cells: Array.from({ length: line.length }, (_, col) => {
            const cell = line.getCell(col);
            const chars = cell.getChars();
            const width = cell.getWidth();
            if (typeof chars !== 'string' || ![0, 1, 2].includes(width)) throw new Error('Unknown terminal cell.');
            return { chars, width, ...style(cell) };
          }) };
        }) };
    };
    const modes = {};
    for (const name of semanticModeNames.slice(0, -1)) {
      const value = terminal.modes[name];
      if (typeof value !== 'boolean') throw new Error('Unknown terminal mode.');
      modes[name] = value;
    }
    modes.mouseTrackingMode = terminal.modes.mouseTrackingMode;
    if (!['none', 'x10', 'vt200', 'drag', 'any'].includes(modes.mouseTrackingMode)) throw new Error('Unknown mouse mode.');
    if (!dimensions(terminal) || !['normal', 'alternate'].includes(terminal.buffer.active.type)) {
      throw new Error('Unknown terminal geometry.');
    }
    return { cols: terminal.cols, rows: terminal.rows, activeBuffer: terminal.buffer.active.type,
      normal: bufferState(terminal.buffer.normal),
      alternate: terminal.buffer.active.type === 'alternate' ? bufferState(terminal.buffer.alternate) : null,
      modes,
      // The pinned serializer uses this same attribute object to restore the current cursor style.
      cursorStyle: style(terminal._core._inputHandler._curAttrData) };
  } catch { return undefined; }
}

function compareSemanticState(left, right) {
  if (!left || !right) return null;
  const flags = compare => Object.fromEntries(semanticStyleFlags.map((name, index) => [name, compare(index)]));
  const buffer = (a, b) => {
    if (!a || !b) return null;
    const linesMatch = compare => a.lines.length === b.lines.length &&
      a.lines.every((line, index) => compare(line, b.lines[index]));
    const cellsMatch = compare => linesMatch((line, other) => line.cells.length === other.cells.length &&
      line.cells.every((cell, index) => compare(cell, other.cells[index])));
    return { ...Object.fromEntries(['type', 'cursorX', 'cursorY', 'baseY', 'viewportY'].map(name => [name, a[name] === b[name]])),
      lineCount: a.lines.length === b.lines.length,
      lineWidths: linesMatch((line, other) => line.cells.length === other.cells.length),
      wrapped: linesMatch((line, other) => line.wrapped === other.wrapped),
      chars: cellsMatch((cell, other) => cell.chars === other.chars),
      width: cellsMatch((cell, other) => cell.width === other.width),
      foreground: cellsMatch((cell, other) => same(cell.foreground, other.foreground)),
      background: cellsMatch((cell, other) => same(cell.background, other.background)),
      flags: flags(index => cellsMatch((cell, other) => cell.flags[index] === other.flags[index])) };
  };
  // Only fixed boolean categories leave this comparison; terminal contents stay private.
  return { cols: left.cols === right.cols, rows: left.rows === right.rows,
    activeBuffer: left.activeBuffer === right.activeBuffer,
    alternatePresent: (left.alternate !== null) === (right.alternate !== null),
    normal: buffer(left.normal, right.normal), alternate: buffer(left.alternate, right.alternate),
    modes: Object.fromEntries(semanticModeNames.map(name => [name, left.modes[name] === right.modes[name]])),
    cursorStyle: { foreground: same(left.cursorStyle.foreground, right.cursorStyle.foreground),
      background: same(left.cursorStyle.background, right.cursorStyle.background),
      flags: flags(index => left.cursorStyle.flags[index] === right.cursorStyle.flags[index]) } };
}

async function compareNonemptyPrefix(state, sequence, scrollback, evidence) {
  if (!evidence || evidence.mismatch) return;
  const record = { outputSequence: sequence, savedBytes: null, hydratedBytes: null,
    differentEmptyCells: null, differentNonemptyCells: null,
    replaySavedSemanticMatched: null, replaySavedSemanticMatches: null,
    replaySemanticStateSha256: null, hydratedSemanticStateSha256: null };
  const unknown = () => { evidence.unknown = true; evidence.firstUnknown ??= record; };
  let hydrated;
  try {
    const data = state.addon.serialize({ scrollback, excludeAltBuffer: false, excludeModes: false });
    if (data.length === 0) return;
    evidence.checkedNonempty += 1;
    record.savedBytes = Buffer.byteLength(data);
    const semantic = readSemanticState(state.terminal);
    if (semantic) record.replaySemanticStateSha256 = hash(JSON.stringify(semantic));
    hydrated = runtime(state.terminal.cols, state.terminal.rows, scrollback);
    await write(hydrated.terminal, data);
    hydrated.terminal.scrollToLine(state.terminal.buffer.active.viewportY);
    record.hydratedBytes = Buffer.byteLength(hydrated.addon.serialize({ scrollback,
      excludeAltBuffer: false, excludeModes: false }));
    const restored = readSemanticState(hydrated.terminal);
    if (restored) record.hydratedSemanticStateSha256 = hash(JSON.stringify(restored));
    if (!semantic || !restored) { unknown(); return; }
    record.replaySavedSemanticMatched = same(semantic, restored);
    record.replaySavedSemanticMatches = compareSemanticState(semantic, restored);
    if (!record.replaySavedSemanticMatched) {
      const counts = countSemanticCellDifferences(semantic, restored);
      record.differentEmptyCells = counts?.empty ?? null;
      record.differentNonemptyCells = counts?.nonempty ?? null;
      evidence.mismatch = true;
      evidence.firstMismatch = record;
    }
  } catch { unknown(); }
  finally {
    try { hydrated?.terminal.dispose(); } catch { unknown(); }
  }
}

function countSemanticCellDifferences(left, right) {
  const result = { empty: 0, nonempty: 0 };
  for (const name of ['normal', 'alternate']) {
    const a = left[name], b = right[name];
    if (!a && !b) continue;
    if (!a || !b || a.lines.length !== b.lines.length) return null;
    for (let row = 0; row < a.lines.length; row += 1) {
      const cells = a.lines[row].cells, other = b.lines[row].cells;
      if (cells.length !== other.length) return null;
      for (let col = 0; col < cells.length; col += 1) {
        if (!same(cells[col], other[col])) result[cells[col].chars === '' && other[col].chars === '' ? 'empty' : 'nonempty'] += 1;
      }
    }
  }
  return result;
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
async function replayMessages({ messages, nodeId, executionId, scrollback, finalSequence, diagnoseNonemptyPrefixes }) {
  const prefixSemanticEvidence = diagnoseNonemptyPrefixes === true
    ? { checkedNonempty: 0, mismatch: false, unknown: false, firstMismatch: null, firstUnknown: null } : null;
  const unknown = reason => ({ reason, complete: false, prefixSemanticEvidence });
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
    outputMessages: 0, resizeSnapshots: 0, finalSnapshot: undefined, prefixSemanticEvidence };
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
        await compareNonemptyPrefix(state, sequence, scrollback, prefixSemanticEvidence);
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
          await compareNonemptyPrefix(state, sequence, scrollback, prefixSemanticEvidence);
        } else return { ...result, reason: 'projection-recovery-or-unknown-snapshot' };
      } else if (!finalSeen || exitSeen || payload.localCompletion?.executionSessionId !== executionId ||
          payload.localCompletion.finalOutputSequence !== sequence) {
        return { ...result, reason: 'exit-boundary-missing' };
      } else exitSeen = true;
    }
    if (!finalSeen || !exitSeen) return { ...result, reason: 'exit-boundary-missing' };
    if (sequence !== finalSequence) return { ...result, reason: 'final-sequence-mismatch' };
    return { ...result, complete: true, reason: 'complete', state: readTerminal(state),
      semanticState: readSemanticState(state.terminal) };
  } finally { state.terminal.dispose(); }
}

async function collectSnapshotEvidence({ savedNode, nodeId, executionId, messages, events, helpProbe, finalProbe,
  assertBuffer, scrollback = 10000, diagnoseNonemptyPrefixes = false }) {
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
    replaySavedGeometryMatched: null, replaySavedLinesMatched: null, replaySavedVisibleMatched: null,
    replaySavedSerializedMatched: null, replaySerializedMatchesSavedData: null,
    replaySavedSemanticMatched: null, replaySavedSemanticMatches: null,
    replaySemanticStateSha256: null, hydratedSemanticStateSha256: null,
    prefixSemanticEvidence: null,
    replayBufferLineCount: null, savedBufferLineCount: null, replaySerializedBytes: null, hydratedSerializedBytes: null,
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
    const savedSemanticState = readSemanticState(hydrated.terminal);
    if (savedSemanticState) evidence.hydratedSemanticStateSha256 = hash(JSON.stringify(savedSemanticState));
    evidence.savedGeometry = terminalGeometry(savedState);
    evidence.savedBufferLineCount = savedState.lines.length;
    evidence.hydratedSerializedBytes = Buffer.byteLength(savedState.serialized);
    evidence.hydratedStateSha256 = hash(JSON.stringify(savedState));
    const pageComparison = await comparePage(savedState, page, assertBuffer);
    evidence.pageGeometryMatched = pageComparison.geometry;
    evidence.pageGeometryMatches = pageComparison.fields;
    evidence.pageVisibleMatched = pageComparison.visible;
    evidence.pageBufferMatched = pageComparison.buffer;
    evidence.savedMatchesPage = pageComparison.matches;
    const replay = await replayMessages({ messages, nodeId, executionId, scrollback,
      finalSequence: saved.outputSequence, diagnoseNonemptyPrefixes });
    evidence.prefixSemanticEvidence = replay.prefixSemanticEvidence;
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
      evidence.replaySavedGeometryMatched = same(terminalGeometry(replay.state), terminalGeometry(savedState));
      evidence.replaySavedLinesMatched = same(replay.state.lines, savedState.lines);
      evidence.replaySavedVisibleMatched = same(replay.state.visibleLines, savedState.visibleLines);
      evidence.replaySavedSerializedMatched = replay.state.serialized === savedState.serialized;
      evidence.replaySerializedMatchesSavedData = replay.state.serialized === saved.data;
      evidence.replayBufferLineCount = replay.state.lines.length;
      evidence.replaySerializedBytes = Buffer.byteLength(replay.state.serialized);
      if (replay.semanticState) evidence.replaySemanticStateSha256 = hash(JSON.stringify(replay.semanticState));
      if (replay.semanticState && savedSemanticState) {
        evidence.replaySavedSemanticMatched = same(replay.semanticState, savedSemanticState);
        evidence.replaySavedSemanticMatches = compareSemanticState(replay.semanticState, savedSemanticState);
      }
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

function acceptsEmptySnapshotStop({ mode, lifecycle: completion, savedNode, evidence: value }) {
  const metadata = savedNode?.metadata?.agent;
  const saved = metadata?.serializedTerminalState;
  if (mode !== 'snapshot-only' || completion !== 'stop' || savedNode?.status !== 'stopped' ||
      metadata?.liveSession !== false || metadata.persistenceMode !== mode || !serialized(saved) || saved.data !== '' ||
      !integer(saved.outputSequence) || saved.outputSequence === 0 || metadata.outputSequence !== saved.outputSequence ||
      !value || value.schemaVersion !== 1) return false;
  const required = ['savedNodeMatched', 'savedStatePresent', 'savedStateValid', 'readerApplied', 'readerLifecycleMatched',
    'sequenceMatched', 'helpProbePresent', 'finalProbePresent', 'pageBufferMatched', 'replayComplete',
    'replayMatchesSaved', 'publishedFinalMatchesSaved'];
  if (required.some(key => value[key] !== true) || value.replayReason !== 'complete' ||
      value.replayInitialSequence !== 0 ||
      value.savedDataBytes !== 0 || value.savedDataSha256 !== hash('') ||
      !/^[a-f0-9]{64}$/.test(value.hydratedStateSha256 ?? '') || value.hydratedStateSha256 !== value.replayStateSha256 ||
      !['savedOutputSequence', 'snapshotOutputSequence', 'readerFinalOutputSequence']
        .every(key => value[key] === saved.outputSequence) ||
      !integer(value.replayOutputMessages) || value.replayOutputMessages === 0 ||
      !integer(value.helpNonEmptyLines) || value.helpNonEmptyLines === 0 ||
      !integer(value.messageCount) || value.messageCount === 0 || value.messageCount >= 200 ||
      !['cursorX', 'cursorY', 'viewportY', 'bufferType'].every(key => value.pageGeometryMatches?.[key] === true)) return false;
  const direct = ['pageGeometryMatched', 'pageVisibleMatched', 'savedMatchesPage', 'replayMatchesPage']
    .every(key => value[key] === true) && ['cols', 'rows'].every(key => value.pageGeometryMatches?.[key] === true);
  const resized = ['cols', 'rows'].every(key => typeof value.pageGeometryMatches?.[key] === 'boolean') &&
    ['cols', 'rows'].some(key => value.pageGeometryMatches[key] === false) &&
    ['resizedSavedPageGeometryMatched', 'resizedSavedPageVisibleMatched', 'resizedSavedPageBufferMatched',
      'resizedSavedMatchesPage'].every(key => value[key] === true);
  return direct || resized;
}

function acceptsSnapshotStop({ mode, lifecycle: completion, savedNode, evidence: value }) {
  const metadata = savedNode?.metadata?.agent;
  const saved = metadata?.serializedTerminalState;
  if (mode !== 'snapshot-only' || completion !== 'stop' || savedNode?.status !== 'stopped' ||
      metadata?.liveSession !== false || metadata.persistenceMode !== mode || !serialized(saved) ||
      !integer(saved.outputSequence) || saved.outputSequence === 0 || metadata.outputSequence !== saved.outputSequence ||
      !value || value.schemaVersion !== 1) return false;
  // Keep the existing empty-stop contract unchanged, including its reset-specific assertions.
  if (saved.data === '') return acceptsEmptySnapshotStop({ mode, lifecycle: completion, savedNode, evidence: value });
  // Preserve raw encoding comparisons as evidence; restored semantics need not have a canonical SGR encoding.
  const required = ['savedNodeMatched', 'savedStatePresent', 'savedStateValid', 'readerApplied',
    'readerLifecycleMatched', 'sequenceMatched', 'helpProbePresent', 'finalProbePresent',
    'replayComplete', 'replaySerializedMatchesSavedData', 'replaySavedSemanticMatched', 'publishedFinalMatchesSaved'];
  if (required.some(key => value[key] !== true) || value.replayReason !== 'complete' ||
      value.replayInitialSequence !== 0 || value.savedDataBytes <= 0 ||
      value.savedDataBytes !== Buffer.byteLength(saved.data) || value.savedDataSha256 !== hash(saved.data) ||
      !/^[a-f0-9]{64}$/.test(value.hydratedSemanticStateSha256 ?? '') ||
      value.hydratedSemanticStateSha256 !== value.replaySemanticStateSha256 ||
      !['savedOutputSequence', 'snapshotOutputSequence', 'readerFinalOutputSequence']
        .every(key => value[key] === saved.outputSequence) ||
      !integer(value.replayOutputMessages) || value.replayOutputMessages === 0 ||
      !integer(value.helpNonEmptyLines) || value.helpNonEmptyLines === 0 ||
      !integer(value.messageCount) || value.messageCount === 0 || value.messageCount >= 200) return false;
  const direct = ['pageGeometryMatched', 'pageVisibleMatched', 'pageBufferMatched', 'savedMatchesPage', 'replayMatchesPage']
    .every(key => value[key] === true) && ['cols', 'rows'].every(key => value.pageGeometryMatches?.[key] === true);
  const resized = ['cols', 'rows'].every(key => typeof value.pageGeometryMatches?.[key] === 'boolean') &&
    ['cols', 'rows'].some(key => value.pageGeometryMatches[key] === false) &&
    ['resizedSavedPageGeometryMatched', 'resizedSavedPageVisibleMatched', 'resizedSavedPageBufferMatched',
      'resizedSavedMatchesPage'].every(key => value[key] === true);
  // A fresh Host checks persistence separately; it cannot excuse incorrect rendering on the original page.
  return direct || resized;
}

module.exports = { collectSnapshotEvidence, acceptsEmptySnapshotStop, acceptsSnapshotStop };
