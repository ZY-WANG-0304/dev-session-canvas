export const TERMINAL_CURRENT_STATE_FORMAT = 'xterm-current-state-v1';
export const TERMINAL_CURRENT_STATE_ENGINE = 'xterm@6.0.0';

type Scalar = string | number | boolean | null;
type Scalars = Record<string, Scalar>;
// This adapter is deliberately restricted to the pinned xterm common engine.
// No service, callback, timer, or renderer object crosses the wire.
type Internal = Record<string, any>;
type Rgb = [number, number, number];
type Attributes = { fg: number; bg: number; ext: number; urlId: number };
type Cell = Attributes & { content: number; combinedData: string };
type Charset = Record<string, string> | null;

export interface TerminalCurrentColors {
  overrides: Record<string, Rgb>;
}

interface CurrentLine {
  length: number;
  wrapped: boolean;
  cells: string;
  combined: Record<string, string>;
  extended: Record<string, { ext: number; urlId: number }>;
}

interface CurrentBuffer {
  fields: Record<string, number>;
  hasScrollback: boolean;
  maxLength: number;
  lines: CurrentLine[];
  tabs: number[];
  savedAttributes: Attributes;
  savedCharset: Charset;
  nullCell: Cell;
  whitespaceCell: Cell;
}

interface CurrentParams {
  params: number[];
  subParams: number[];
  subParamsIdx: number[];
  rejectDigits: boolean;
  rejectSubDigits: boolean;
  digitIsSub: boolean;
}

interface CurrentHandler {
  data: string;
  hitLimit: boolean;
  params?: CurrentParams;
}

interface CurrentParser {
  state: number;
  initialState: number;
  collect: number;
  precedingJoinState: number;
  params: CurrentParams;
  utf16: number;
  utf8: number[];
  osc: { state: number; id: number; handlers: CurrentHandler[] };
  dcs: { id: number; handlers: CurrentHandler[] };
}

interface CurrentLink {
  id: number;
  data: { uri: string; id?: string };
  markers: Array<{ buffer: 'normal' | 'alternate'; line: number }>;
}

export interface TerminalCurrentState {
  format: typeof TERMINAL_CURRENT_STATE_FORMAT;
  engine: typeof TERMINAL_CURRENT_STATE_ENGINE;
  cellEncoding: 'u32-xor-rle-v1';
  cols: number;
  rows: number;
  scrollback: number;
  normal: CurrentBuffer;
  alternate: CurrentBuffer;
  active: 'normal' | 'alternate';
  options: Record<string, Scalar | Scalars>;
  modes: Scalars;
  privateModes: Scalars;
  cursor: { hidden: boolean; initialized: boolean };
  mouse: { protocol: string; encoding: string; wheel: number; lastEvent: Scalars | null };
  isUserScrolling: boolean;
  charset: { current: Charset; tables: Charset[]; level: number };
  unicodeVersion: string;
  currentAttributes: Attributes;
  eraseAttributes: Attributes;
  title: string;
  icon: string;
  titleStack: string[];
  iconStack: string[];
  parser: CurrentParser;
  links: { nextId: number; entries: CurrentLink[] };
  colors: TerminalCurrentColors;
}

const BUFFER_FIELDS = [
  '_cols', '_rows', 'x', 'y', 'ybase', 'ydisp', 'scrollTop', 'scrollBottom', 'savedX', 'savedY'
] as const;
const OPTION_FIELDS = [
  'convertEol', 'cursorBlink', 'cursorStyle', 'reflowCursorLine', 'scrollOnEraseInDisplay',
  'scrollOnUserInput', 'tabStopWidth', 'windowsMode', 'windowsPty', 'termName', 'windowOptions'
] as const;

export function createTerminalCurrentColors(): TerminalCurrentColors {
  return { overrides: {} };
}

export function applyTerminalCurrentColorRequests(colors: TerminalCurrentColors, event: unknown): void {
  requireCondition(Array.isArray(event), 'color-event');
  for (const value of event) {
    const request = record(value, 'color-request');
    if (request.type === 0) continue;
    if (request.type === 2 && request.index === undefined) {
      for (const key of Object.keys(colors.overrides)) {
        if (Number(key) < 256) delete colors.overrides[key];
      }
      continue;
    }
    const index = integer(request.index, 'color-index', 0, 258);
    if (request.type === 1) colors.overrides[index] = readRgb(request.color);
    else if (request.type === 2) delete colors.overrides[index];
    else fail('color-request-type');
  }
}

export function captureTerminalCurrentState(terminal: unknown, colors?: TerminalCurrentColors): TerminalCurrentState {
  // Headless xterm emits color requests but retains no palette of its own.
  requireCondition(colors !== undefined, 'color-observation-required');
  const runtime = readRuntime(terminal);
  requireIdle(runtime);
  const { core, input, buffers, parser } = runtime;
  const normal = buffers.normal;
  const alternate = buffers.alt;
  const options: TerminalCurrentState['options'] = {};
  for (const key of OPTION_FIELDS) {
    const value = core.optionsService.rawOptions[key];
    options[key] = typeof value === 'object' && value !== null ? scalarRecord(value, `option-${key}`) : scalar(value, `option-${key}`);
  }
  const unicode = core.unicodeService;
  requireCondition(unicode.activeVersion === '6' && Object.keys(unicode._providers).length === 1, 'unicode-provider');
  const active = buffers.active === normal ? 'normal' : buffers.active === alternate ? 'alternate' : fail('active-buffer');
  const state: TerminalCurrentState = {
    format: TERMINAL_CURRENT_STATE_FORMAT,
    engine: TERMINAL_CURRENT_STATE_ENGINE,
    cellEncoding: 'u32-xor-rle-v1',
    cols: integer(core._bufferService.cols, 'cols', 1),
    rows: integer(core._bufferService.rows, 'rows', 1),
    scrollback: integer(core.optionsService.rawOptions.scrollback, 'scrollback'),
    normal: captureBuffer(normal),
    alternate: captureBuffer(alternate),
    active,
    options,
    modes: scalarRecord(core.coreService.modes, 'modes'),
    privateModes: scalarRecord(core.coreService.decPrivateModes, 'private-modes'),
    cursor: { hidden: boolean(core.coreService.isCursorHidden, 'cursor-hidden'), initialized: boolean(core.coreService.isCursorInitialized, 'cursor-initialized') },
    mouse: {
      protocol: string(core.coreMouseService._activeProtocol, 'mouse-protocol'),
      encoding: string(core.coreMouseService._activeEncoding, 'mouse-encoding'),
      wheel: number(core.coreMouseService._wheelPartialScroll, 'mouse-wheel'),
      lastEvent: core.coreMouseService._lastEvent === null ? null : scalarRecord(core.coreMouseService._lastEvent, 'mouse-last-event')
    },
    isUserScrolling: boolean(core._bufferService.isUserScrolling, 'user-scrolling'),
    charset: {
      current: readCharset(core._charsetService.charset),
      tables: array(core._charsetService._charsets, 'charset-tables').map(readCharset),
      level: integer(core._charsetService.glevel, 'charset-level')
    },
    unicodeVersion: unicode.activeVersion,
    currentAttributes: readAttributes(input._curAttrData),
    eraseAttributes: readAttributes(input._eraseAttrDataInternal),
    title: string(input._windowTitle, 'window-title'),
    icon: string(input._iconName, 'icon-name'),
    titleStack: stringArray(input._windowTitleStack, 'title-stack'),
    iconStack: stringArray(input._iconNameStack, 'icon-stack'),
    parser: {
      state: integer(parser.currentState, 'parser-state'),
      initialState: integer(parser.initialState, 'parser-initial-state'),
      collect: integer(parser._collect, 'parser-collect'),
      precedingJoinState: integer(parser.precedingJoinState, 'parser-join-state'),
      params: captureParams(parser._params),
      utf16: integer(input._stringDecoder._interim, 'utf16-carry'),
      utf8: [...input._utf8Decoder.interim],
      osc: {
        state: integer(parser._oscParser._state, 'osc-state'),
        id: integer(parser._oscParser._id, 'osc-id', -1),
        handlers: captureHandlers(parser._oscParser, false)
      },
      dcs: { id: integer(parser._dcsParser._ident, 'dcs-id'), handlers: captureHandlers(parser._dcsParser, true) }
    },
    links: captureLinks(core._oscLinkService, normal, alternate),
    colors: cloneColors(colors)
  };
  validateState(state, false);
  return state;
}

export function restoreTerminalCurrentState(terminal: unknown, state: TerminalCurrentState): void {
  const preparedCells = validateState(state);
  const runtime = readRuntime(terminal);
  requireIdle(runtime);
  requireCondition(runtime.core.unicodeService.activeVersion === state.unicodeVersion, 'unicode-version');
  requireCondition(runtime.core.coreMouseService._protocols[state.mouse.protocol] &&
    runtime.core.coreMouseService._encodings[state.mouse.encoding], 'mouse-profile');
  if (runtime.core._themeService) {
    requireCondition(typeof runtime.core._themeService.restoreColor === 'function' &&
      typeof runtime.core._themeService.modifyColors === 'function', 'theme-service');
  } else if (runtime.core._onWillOpen && Object.keys(state.colors.overrides).length) {
    fail('browser-not-open');
  }
  validateHandlerTargets(runtime.parser._oscParser, state.parser.osc.id, state.parser.osc.handlers);
  validateHandlerTargets(runtime.parser._dcsParser, state.parser.dcs.id, state.parser.dcs.handlers);
  const { core, input, buffers, parser } = runtime;
  const target = runtime.terminal;
  for (const buffer of [buffers.normal, buffers.alt]) {
    buffer._memoryCleanupQueue.clear();
    for (const marker of [...buffer.markers]) marker.dispose();
  }
  core._bufferService._cachedBlankLine = undefined;
  parser.reset();
  target.reset();
  for (const key of OPTION_FIELDS) target.options[key] = cloneData(state.options[key]);
  target.options.scrollback = state.scrollback;
  target.resize(state.cols, state.rows);

  const normal = buffers.normal;
  const alternate = buffers.alt;
  restoreBuffer(normal, state.normal, input._curAttrData, preparedCells[0]);
  restoreBuffer(alternate, state.alternate, input._curAttrData, preparedCells[1]);
  const active = state.active === 'normal' ? normal : alternate;
  // Public buffer activation clears/copies model data. Only notify after both
  // buffers and link markers are installed in their destination-owned objects.
  buffers._activeBuffer = active;
  input._activeBuffer = active;
  core._bufferService.isUserScrolling = state.isUserScrolling;
  core.coreService.modes = { ...state.modes };
  core.coreService.decPrivateModes = { ...state.privateModes };
  core.coreService.isCursorHidden = state.cursor.hidden;
  core.coreService.isCursorInitialized = state.cursor.initialized;
  core.coreMouseService.activeProtocol = state.mouse.protocol;
  core.coreMouseService.activeEncoding = state.mouse.encoding;
  core.coreMouseService._wheelPartialScroll = state.mouse.wheel;
  core.coreMouseService._lastEvent = state.mouse.lastEvent && { ...state.mouse.lastEvent };
  core._charsetService.charset = state.charset.current === null ? undefined : { ...state.charset.current };
  core._charsetService._charsets = state.charset.tables.map(value => value === null ? undefined : { ...value });
  core._charsetService.glevel = state.charset.level;
  setAttributes(input._curAttrData, state.currentAttributes);
  setAttributes(input._eraseAttrDataInternal, state.eraseAttributes);
  input._windowTitle = state.title;
  input._iconName = state.icon;
  input._windowTitleStack = [...state.titleStack];
  input._iconNameStack = [...state.iconStack];
  parser.currentState = state.parser.state;
  parser.initialState = state.parser.initialState;
  parser._collect = state.parser.collect;
  parser.precedingJoinState = state.parser.precedingJoinState;
  restoreParams(parser._params, state.parser.params);
  input._stringDecoder._interim = state.parser.utf16;
  input._utf8Decoder.interim.set(state.parser.utf8);
  parser._oscParser._state = state.parser.osc.state;
  parser._oscParser._id = state.parser.osc.id;
  restoreHandlers(parser._oscParser, state.parser.osc.id, state.parser.osc.handlers, parser._params);
  parser._dcsParser._ident = state.parser.dcs.id;
  restoreHandlers(parser._dcsParser, state.parser.dcs.id, state.parser.dcs.handlers, parser._params);
  restoreLinks(core._oscLinkService, state.links, normal, alternate);
  restoreColors(core, state.colors);
  buffers._onBufferActivate.fire({ activeBuffer: active, inactiveBuffer: active === normal ? alternate : normal });
  input._dirtyRowTracker.markAllDirty();
  core._onScroll.fire({ position: active.ydisp });
  input._onCursorMove.fire();
  target.refresh?.(0, state.rows - 1);
}

function readRuntime(terminal: unknown): { terminal: Internal; core: Internal; input: Internal; buffers: Internal; parser: Internal } {
  const target = record(terminal, 'terminal');
  const core = record(target._core, 'core');
  const input = record(core._inputHandler, 'input-handler');
  const buffers = record(core._bufferService?.buffers, 'buffers');
  const parser = record(input._parser, 'parser');
  requireCondition(typeof target.reset === 'function' && typeof target.resize === 'function' &&
    typeof buffers._onBufferActivate?.fire === 'function' && typeof input._curAttrData?.clone === 'function' &&
    typeof parser._params?.clone === 'function' && typeof core._oscLinkService?._removeMarkerFromLink === 'function', 'xterm-internals');
  return { terminal: target, core, input, buffers, parser };
}

function requireIdle(runtime: ReturnType<typeof readRuntime>): void {
  const writes = runtime.core._writeBuffer;
  requireCondition(writes?._pendingData === 0 && writes?._writeBuffer?.length === 0 &&
    writes?._callbacks?.length === 0 && writes?._isSyncWriting === false, 'pending-write');
  requireCondition(runtime.input._parseStack?.paused === false && runtime.parser._parseStack?.state === 0 &&
    runtime.parser._oscParser?._stack?.paused === false && runtime.parser._dcsParser?._stack?.paused === false, 'parser-paused');
}

function captureBuffer(buffer: Internal): CurrentBuffer {
  requireCondition(buffer._isClearing === false, 'buffer-clearing');
  const fields: CurrentBuffer['fields'] = {};
  for (const key of BUFFER_FIELDS) fields[key] = integer(buffer[key], `buffer-${key}`);
  const lines: CurrentLine[] = [];
  for (let index = 0; index < buffer.lines.length; index += 1) {
    const line = record(buffer.lines.get(index), 'buffer-line');
    const length = integer(line.length, 'line-length');
    requireCondition(line._data instanceof Uint32Array && line._data.length >= length * 3, 'cell-data');
    const combined: CurrentLine['combined'] = {};
    const extended: CurrentLine['extended'] = {};
    for (let column = 0; column < length; column += 1) {
      if (line._data[column * 3] & 0x200000) combined[column] = string(line._combined[column], 'combined-cell');
      if (line._data[column * 3 + 2] & 0x10000000) extended[column] = readExtended(line._extendedAttrs[column]);
    }
    lines.push({ length, wrapped: boolean(line.isWrapped, 'line-wrapped'), cells: encodeCells(line._data, length * 3), combined, extended });
  }
  return {
    fields, hasScrollback: boolean(buffer._hasScrollback, 'buffer-scrollback'), maxLength: integer(buffer.lines.maxLength, 'buffer-capacity'), lines,
    tabs: Object.entries(record(buffer.tabs, 'tabs')).filter(([, value]) => value === true).map(([key]) => integer(Number(key), 'tab')),
    savedAttributes: readAttributes(buffer.savedCurAttrData), savedCharset: readCharset(buffer.savedCharset),
    nullCell: readCell(buffer._nullCell), whitespaceCell: readCell(buffer._whitespaceCell)
  };
}

function restoreBuffer(buffer: Internal, state: CurrentBuffer, attributes: Internal, cells: Uint32Array[]): void {
  buffer._memoryCleanupQueue.clear();
  buffer._memoryCleanupPosition = 0;
  for (const marker of [...buffer.markers]) marker.dispose();
  buffer.lines.length = 0;
  buffer.lines.maxLength = state.maxLength;
  const Line = buffer.getBlankLine(attributes).constructor;
  for (let index = 0; index < state.lines.length; index += 1) {
    const source = state.lines[index];
    const line = new Line(0, undefined, source.wrapped);
    line.length = source.length;
    line._data = cells[index];
    line._combined = { ...source.combined };
    line._extendedAttrs = {};
    for (const [key, value] of Object.entries(source.extended)) {
      const extended = attributes.extended.clone();
      extended._ext = value.ext;
      extended._urlId = value.urlId;
      line._extendedAttrs[key] = extended;
    }
    buffer.lines.push(line);
  }
  for (const key of BUFFER_FIELDS) buffer[key] = state.fields[key];
  buffer._hasScrollback = state.hasScrollback;
  buffer.tabs = Object.fromEntries(state.tabs.map(value => [value, true]));
  setAttributes(buffer.savedCurAttrData, state.savedAttributes);
  buffer.savedCharset = state.savedCharset === null ? undefined : { ...state.savedCharset };
  setCell(buffer._nullCell, state.nullCell);
  setCell(buffer._whitespaceCell, state.whitespaceCell);
}

function captureParams(params: Internal): CurrentParams {
  requireCondition(params.params instanceof Int32Array && params._subParams instanceof Int32Array && params._subParamsIdx instanceof Uint16Array, 'parser-params');
  return {
    params: [...params.params.slice(0, params.length)], subParams: [...params._subParams.slice(0, params._subParamsLength)],
    subParamsIdx: [...params._subParamsIdx.slice(0, params.length)],
    rejectDigits: boolean(params._rejectDigits, 'params-reject-digits'), rejectSubDigits: boolean(params._rejectSubDigits, 'params-reject-subdigits'),
    digitIsSub: boolean(params._digitIsSub, 'params-digit-is-sub')
  };
}

function restoreParams(params: Internal, state: CurrentParams): void {
  requireCondition(state.params.length <= params.params.length && state.subParams.length <= params._subParams.length, 'params-capacity');
  params.params.fill(0);
  params.params.set(state.params);
  params.length = state.params.length;
  params._subParams.fill(0);
  params._subParams.set(state.subParams);
  params._subParamsLength = state.subParams.length;
  params._subParamsIdx.fill(0);
  params._subParamsIdx.set(state.subParamsIdx);
  params._rejectDigits = state.rejectDigits;
  params._rejectSubDigits = state.rejectSubDigits;
  params._digitIsSub = state.digitIsSub;
}

function captureHandlers(parser: Internal, dcs: boolean): CurrentHandler[] {
  return array(parser._active, 'active-handlers').map(value => {
    const handler = record(value, 'active-handler');
    const state: CurrentHandler = { data: string(handler._data, 'handler-data'), hitLimit: boolean(handler._hitLimit, 'handler-limit') };
    if (dcs) state.params = captureParams(handler._params);
    return state;
  });
}

function validateHandlerTargets(parser: Internal, id: number, handlers: CurrentHandler[]): void {
  const targets = parser._handlers[id] ?? [];
  requireCondition(targets.length >= handlers.length, 'parser-handler-profile');
  for (let index = 0; index < handlers.length; index += 1) {
    requireCondition(typeof targets[index]._data === 'string' && typeof targets[index]._hitLimit === 'boolean', 'parser-handler-profile');
  }
}

function restoreHandlers(parser: Internal, id: number, handlers: CurrentHandler[], params: Internal): void {
  parser._active = (parser._handlers[id] ?? []).slice(0, handlers.length);
  for (let index = 0; index < handlers.length; index += 1) {
    const target = parser._active[index];
    const state = handlers[index];
    target._data = state.data;
    target._hitLimit = state.hitLimit;
    if (state.params) {
      target._params = params.clone();
      restoreParams(target._params, state.params);
    }
  }
}

function captureLinks(service: Internal, normal: Internal, alternate: Internal): TerminalCurrentState['links'] {
  requireCondition(service._dataByLinkId instanceof Map && service._entriesWithId instanceof Map, 'link-service');
  const seen = new Set<object>();
  const entries: CurrentLink[] = [];
  for (const [id, entry] of service._dataByLinkId) {
    const data: CurrentLink['data'] = { uri: string(entry.data.uri, 'link-uri') };
    if (entry.data.id !== undefined) data.id = string(entry.data.id, 'link-id');
    const markers: CurrentLink['markers'] = array(entry.lines, 'link-lines').map(marker => {
      requireCondition(marker.isDisposed === false, 'disposed-link-marker');
      const buffer = normal.markers.includes(marker) ? 'normal' : alternate.markers.includes(marker) ? 'alternate' : fail('unowned-link-marker');
      seen.add(marker);
      return { buffer, line: integer(marker.line, 'link-line') };
    });
    entries.push({ id: integer(id, 'link-number', 1), data, markers });
  }
  requireCondition([...normal.markers, ...alternate.markers].every(marker => seen.has(marker)), 'non-link-marker');
  return { nextId: integer(service._nextId, 'next-link-id', 1), entries };
}

function restoreLinks(service: Internal, state: TerminalCurrentState['links'], normal: Internal, alternate: Internal): void {
  service._dataByLinkId.clear();
  service._entriesWithId.clear();
  service._nextId = state.nextId;
  for (const source of state.entries) {
    const entry: Internal = { id: source.id, data: { id: source.data.id, uri: source.data.uri }, lines: [] };
    if (source.data.id !== undefined) {
      entry.key = `${source.data.id};;${source.data.uri}`;
      service._entriesWithId.set(entry.key, entry);
    }
    service._dataByLinkId.set(entry.id, entry);
    for (const position of source.markers) {
      const marker = (position.buffer === 'normal' ? normal : alternate).addMarker(position.line);
      entry.lines.push(marker);
      marker.onDispose(() => service._removeMarkerFromLink(entry, marker));
    }
  }
}

function restoreColors(core: Internal, state: TerminalCurrentColors): void {
  const theme = core._themeService;
  if (!theme) return;
  requireCondition(typeof theme.restoreColor === 'function' && typeof theme.modifyColors === 'function', 'theme-service');
  theme.restoreColor();
  for (const index of [256, 257, 258]) theme.restoreColor(index);
  theme.modifyColors((colors: Internal) => {
    for (const [key, rgb] of Object.entries(state.overrides)) {
      const index = Number(key);
      const color = { css: `#${rgb.map(value => value.toString(16).padStart(2, '0')).join('')}`, rgba: ((rgb[0] << 24) | (rgb[1] << 16) | (rgb[2] << 8) | 255) >>> 0 };
      if (index < 256) colors.ansi[index] = color;
      else colors[index === 256 ? 'foreground' : index === 257 ? 'background' : 'cursor'] = color;
    }
  });
}

function readAttributes(value: unknown): Attributes {
  const attr = record(value, 'attributes');
  return { fg: integer(attr.fg, 'foreground', -0x80000000, 0xffffffff), bg: integer(attr.bg, 'background', -0x80000000, 0xffffffff), ...readExtended(attr.extended) };
}

function readExtended(value: unknown): { ext: number; urlId: number } {
  const attr = record(value, 'extended-attributes');
  return { ext: integer(attr._ext, 'extended-flags', -0x80000000, 0xffffffff), urlId: integer(attr._urlId, 'attribute-link') };
}

function setAttributes(target: Internal, source: Attributes): void {
  target.fg = source.fg;
  target.bg = source.bg;
  target.extended = target.extended.clone();
  target.extended._ext = source.ext;
  target.extended._urlId = source.urlId;
}

function readCell(value: unknown): Cell {
  const cell = record(value, 'cell-template');
  return { ...readAttributes(cell), content: integer(cell.content, 'cell-content', 0, 0xffffffff), combinedData: string(cell.combinedData, 'cell-combined') };
}

function setCell(target: Internal, source: Cell): void {
  setAttributes(target, source);
  target.content = source.content;
  target.combinedData = source.combinedData;
}

function readCharset(value: unknown): Charset {
  if (value === undefined || value === null) return null;
  const charset = record(value, 'charset');
  return Object.fromEntries(Object.entries(charset).map(([key, entry]) => [key, string(entry, 'charset-value')]));
}

function cloneColors(value: TerminalCurrentColors): TerminalCurrentColors {
  const colors = record(value, 'colors');
  const overrides: TerminalCurrentColors['overrides'] = {};
  for (const [key, rgb] of Object.entries(record(colors.overrides, 'color-overrides'))) {
    requireCondition(String(integer(Number(key), 'color-key', 0, 258)) === key, 'color-key');
    overrides[key] = readRgb(rgb);
  }
  return { overrides };
}

function readRgb(value: unknown): Rgb {
  const rgb = array(value, 'rgb');
  requireCondition(rgb.length === 3, 'rgb-length');
  return rgb.map(channel => integer(channel, 'rgb-channel', 0, 255)) as Rgb;
}

function encodeCells(cells: Uint32Array, length: number): string {
  const bytes: number[] = [];
  const put = (value: number): void => {
    while (value >= 128) { bytes.push((value & 127) | 128); value >>>= 7; }
    bytes.push(value);
  };
  // Attribute channels are usually constant. Content XORs are usually small;
  // per-channel runs also encode trailing blank cells without losing their bits.
  for (let channel = 0; channel < 3; channel += 1) {
    let previous = 0;
    for (let index = channel; index < length;) {
      let end = index + 3;
      while (end < length && cells[end] === cells[index]) end += 3;
      if (end - index >= 6) {
        put((((end - index) / 3) << 1) | 1);
        put((cells[index] ^ previous) >>> 0);
        previous = cells[index];
        index = end;
      } else {
        while (end < length && (end + 3 >= length || cells[end] !== cells[end + 3])) end += 3;
        put(((end - index) / 3) << 1);
        for (; index < end; index += 3) {
          put((cells[index] ^ previous) >>> 0);
          previous = cells[index];
        }
      }
    }
  }
  let binary = '';
  for (let index = 0; index < bytes.length; index += 8192) binary += String.fromCharCode(...bytes.slice(index, index + 8192));
  return btoa(binary);
}

function decodeCells(encoded: string, length: number): Uint32Array {
  let binary: string;
  try { binary = atob(encoded); } catch { return fail('cell-encoding'); }
  const cells = new Uint32Array(length);
  let offset = 0;
  const take = (): number => {
    let result = 0;
    for (let shift = 0; shift <= 28; shift += 7) {
      requireCondition(offset < binary.length, 'cell-encoding-truncated');
      const byte = binary.charCodeAt(offset++);
      requireCondition(shift !== 28 || byte <= 15, 'cell-encoding-integer');
      result |= (byte & 127) << shift;
      if (!(byte & 128)) return result >>> 0;
    }
    return fail('cell-encoding-integer');
  };
  for (let channel = 0; channel < 3; channel += 1) {
    let previous = 0;
    for (let index = channel; index < length;) {
      const header = take();
      const count = header >>> 1;
      requireCondition(count > 0 && count <= (length - index + channel) / 3, 'cell-encoding-run');
      if (header & 1) previous = (previous ^ take()) >>> 0;
      for (let position = 0; position < count; position += 1, index += 3) {
        if (!(header & 1)) previous = (previous ^ take()) >>> 0;
        cells[index] = previous;
      }
    }
  }
  requireCondition(offset === binary.length, 'cell-encoding-trailing');
  return cells;
}

function validateState(value: unknown, prepareCells = true): [Uint32Array[], Uint32Array[]] {
  const state = record(value, 'state');
  requireCondition(state.format === TERMINAL_CURRENT_STATE_FORMAT && state.engine === TERMINAL_CURRENT_STATE_ENGINE, 'state-version');
  requireCondition(state.cellEncoding === 'u32-xor-rle-v1', 'cell-encoding-version');
  const prepared: [Uint32Array[], Uint32Array[]] = [[], []];
  integer(state.cols, 'cols', 2, 65535);
  integer(state.rows, 'rows', 1, 65535);
  integer(state.scrollback, 'scrollback', 0, 0xffffffff - state.rows);
  requireCondition(state.active === 'normal' || state.active === 'alternate', 'active-buffer');
  for (const key of ['normal', 'alternate']) {
    const buffer = record(state[key], 'buffer');
    const fields = record(buffer.fields, 'buffer-fields');
    for (const field of BUFFER_FIELDS) integer(fields[field], `buffer-${field}`);
    requireCondition(fields._cols === state.cols && fields._rows === state.rows, 'buffer-geometry');
    boolean(buffer.hasScrollback, 'buffer-scrollback');
    integer(buffer.maxLength, 'buffer-capacity', 1, state.rows + state.scrollback);
    const lines = array(buffer.lines, 'buffer-lines');
    requireCondition(lines.length <= buffer.maxLength, 'buffer-line-count');
    for (const entry of lines) {
      const line = record(entry, 'line');
      const length = integer(line.length, 'line-length', 0, 65535);
      boolean(line.wrapped, 'line-wrapped');
      const encoded = string(line.cells, 'line-cells');
      const cells = prepareCells ? decodeCells(encoded, length * 3) : undefined;
      if (cells) prepared[key === 'normal' ? 0 : 1].push(cells);
      const combined = record(line.combined, 'line-combined');
      const extended = record(line.extended, 'line-extended');
      for (const [key, value] of Object.entries(combined)) { integer(Number(key), 'combined-column', 0, length - 1); string(value, 'combined-text'); }
      for (const [key, value] of Object.entries(extended)) { integer(Number(key), 'extended-column', 0, length - 1); validateExtended(value); }
      for (let column = 0; cells && column < length; column += 1) {
        if (cells[column * 3] & 0x200000) string(combined[column], 'required-combined');
        if (cells[column * 3 + 2] & 0x10000000) validateExtended(extended[column]);
      }
    }
    array(buffer.tabs, 'tabs').forEach(value => integer(value, 'tab'));
    validateAttributes(buffer.savedAttributes);
    readCharset(buffer.savedCharset);
    for (const key of ['nullCell', 'whitespaceCell']) {
      const cell = record(buffer[key], 'template');
      validateAttributes(cell);
      integer(cell.content, 'template-content', 0, 0xffffffff);
      string(cell.combinedData, 'template-combined');
    }
  }
  const options = record(state.options, 'options');
  for (const key of ['convertEol', 'cursorBlink', 'reflowCursorLine', 'scrollOnEraseInDisplay', 'scrollOnUserInput', 'windowsMode']) boolean(options[key], `option-${key}`);
  requireCondition(['block', 'bar', 'underline'].includes(options.cursorStyle), 'option-cursor-style');
  integer(options.tabStopWidth, 'option-tab-stop', 1);
  string(options.termName, 'option-term-name');
  const windowsPty = record(options.windowsPty, 'option-windows-pty');
  if (windowsPty.backend !== undefined) requireCondition(windowsPty.backend === 'conpty' || windowsPty.backend === 'winpty', 'option-windows-backend');
  if (windowsPty.buildNumber !== undefined) integer(windowsPty.buildNumber, 'option-windows-build');
  for (const value of Object.values(record(options.windowOptions, 'option-window-options'))) boolean(value, 'option-window-flag');
  scalarRecord(state.modes, 'modes');
  scalarRecord(state.privateModes, 'private-modes');
  const cursor = record(state.cursor, 'cursor');
  boolean(cursor.hidden, 'cursor-hidden'); boolean(cursor.initialized, 'cursor-initialized');
  const mouse = record(state.mouse, 'mouse');
  string(mouse.protocol, 'mouse-protocol'); string(mouse.encoding, 'mouse-encoding'); number(mouse.wheel, 'mouse-wheel');
  if (mouse.lastEvent !== null) scalarRecord(mouse.lastEvent, 'mouse-event');
  boolean(state.isUserScrolling, 'scrolling');
  const charset = record(state.charset, 'charset');
  readCharset(charset.current); array(charset.tables, 'charset-tables').forEach(readCharset); integer(charset.level, 'charset-level', 0, 3);
  requireCondition(state.unicodeVersion === '6', 'unicode-version');
  validateAttributes(state.currentAttributes); validateAttributes(state.eraseAttributes);
  string(state.title, 'title'); string(state.icon, 'icon');
  stringArray(state.titleStack, 'title-stack'); stringArray(state.iconStack, 'icon-stack');
  const parser = record(state.parser, 'parser');
  integer(parser.state, 'parser-state', 0, 13); integer(parser.initialState, 'parser-initial-state', 0, 13);
  integer(parser.collect, 'parser-collect'); integer(parser.precedingJoinState, 'parser-join-state');
  validateParams(parser.params);
  integer(parser.utf16, 'utf16', 0, 0xffff);
  const utf8 = array(parser.utf8, 'utf8'); requireCondition(utf8.length === 3, 'utf8-length'); utf8.forEach(value => integer(value, 'utf8-byte', 0, 255));
  for (const key of ['osc', 'dcs']) {
    const sub = record(parser[key], 'subparser');
    integer(sub.id, 'subparser-id', key === 'osc' ? -1 : 0);
    if (key === 'osc') integer(sub.state, 'osc-state', 0, 3);
    for (const value of array(sub.handlers, 'handlers')) {
      const handler = record(value, 'handler');
      requireCondition(string(handler.data, 'handler-data').length <= 10000000, 'handler-data-limit');
      boolean(handler.hitLimit, 'handler-limit');
      if (key === 'dcs') validateParams(handler.params);
      else requireCondition(handler.params === undefined, 'osc-params');
    }
  }
  const links = record(state.links, 'links');
  integer(links.nextId, 'next-link-id', 1);
  const ids = new Set<number>();
  for (const value of array(links.entries, 'link-entries')) {
    const link = record(value, 'link'); const id = integer(link.id, 'link-id', 1, links.nextId - 1);
    requireCondition(!ids.has(id), 'duplicate-link'); ids.add(id);
    string(link.data?.uri, 'link-uri'); if (link.data?.id !== undefined) string(link.data.id, 'link-external-id');
    for (const value of array(link.markers, 'link-markers')) {
      const marker = record(value, 'link-marker');
      requireCondition(marker.buffer === 'normal' || marker.buffer === 'alternate', 'link-buffer');
      integer(marker.line, 'link-line', 0, state[marker.buffer].lines.length - 1);
    }
  }
  cloneColors(state.colors);
  return prepared;
}

function validateParams(value: unknown): void {
  const params = record(value, 'params');
  const values = array(params.params, 'params-values');
  const subs = array(params.subParams, 'params-subs');
  const indexes = array(params.subParamsIdx, 'params-indexes');
  requireCondition(values.length <= 32 && subs.length <= 32 && indexes.length === values.length, 'params-length');
  values.forEach(value => integer(value, 'param-value', -1, 0x7fffffff));
  subs.forEach(value => integer(value, 'subparam-value', -1, 0x7fffffff));
  indexes.forEach(value => integer(value, 'subparam-index', 0, 0xffff));
  boolean(params.rejectDigits, 'params-reject-digits'); boolean(params.rejectSubDigits, 'params-reject-subdigits'); boolean(params.digitIsSub, 'params-digit-is-sub');
}

function validateExtended(value: unknown): void {
  const attr = record(value, 'extended');
  integer(attr.ext, 'extended-flags', -0x80000000, 0xffffffff); integer(attr.urlId, 'extended-link');
}

function validateAttributes(value: unknown): void {
  const attr = record(value, 'attributes');
  integer(attr.fg, 'fg', -0x80000000, 0xffffffff); integer(attr.bg, 'bg', -0x80000000, 0xffffffff); validateExtended(attr);
}

function cloneData<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }
function record(value: unknown, label: string): Internal { requireCondition(typeof value === 'object' && value !== null && !Array.isArray(value), label); return value as Internal; }
function array(value: unknown, label: string): any[] { requireCondition(Array.isArray(value), label); return value; }
function string(value: unknown, label: string): string { requireCondition(typeof value === 'string', label); return value; }
function stringArray(value: unknown, label: string): string[] { return array(value, label).map(entry => string(entry, label)); }
function boolean(value: unknown, label: string): boolean { requireCondition(typeof value === 'boolean', label); return value; }
function number(value: unknown, label: string): number { requireCondition(typeof value === 'number' && Number.isFinite(value), label); return value; }
function integer(value: unknown, label: string, min = 0, max = Number.MAX_SAFE_INTEGER): number { requireCondition(typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max, label); return value; }
function scalar(value: unknown, label: string): Scalar { requireCondition(value === null || typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value)), label); return value as Scalar; }
function scalarRecord(value: unknown, label: string): Scalars { return Object.fromEntries(Object.entries(record(value, label)).filter(([, entry]) => entry !== undefined).map(([key, entry]) => [key, scalar(entry, label)])); }
function requireCondition(condition: unknown, label: string): asserts condition { if (!condition) fail(label); }
function fail(label: string): never { throw new Error(`Unsupported terminal current state: ${label}`); }
