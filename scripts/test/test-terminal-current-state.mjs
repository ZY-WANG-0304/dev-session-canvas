import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import esbuild from 'esbuild';

const require = createRequire(import.meta.url);
const { Terminal } = require('@xterm/headless');
assert.equal(require('@xterm/headless/package.json').version, '6.0.0');
assert.equal(require('@xterm/xterm/package.json').version, '6.0.0');
const temporary = await mkdtemp(path.join(os.tmpdir(), 'dsc-terminal-current-state-'));
let passed = 0;

try {
  const output = path.join(temporary, 'codec.cjs');
  await esbuild.build({ entryPoints: ['extensions/vscode/dev-session-canvas/src/common/terminalCurrentState.ts'],
    bundle: true, platform: 'node', target: 'node22', format: 'cjs', outfile: output });
  const { captureTerminalCurrentState: capture, restoreTerminalCurrentState: restore,
    createTerminalCurrentColors, applyTerminalCurrentColorRequests } = require(output);

  function create(options = {}) {
    const term = new Terminal({ cols: 18, rows: 5, scrollback: 12, allowProposedApi: true, ...options });
    const colors = createTerminalCurrentColors();
    term._core._inputHandler.onColor(event => applyTerminalCurrentColorRequests(colors, event));
    const replies = [];
    term.onData(value => replies.push(value));
    return { term, colors, replies, dispose() { term.dispose(); } };
  }
  const snapshot = value => JSON.parse(JSON.stringify(capture(value.term, value.colors)));
  const write = (value, data) => new Promise(resolve => value.term.write(data, resolve));
  function observe(value) {
    const term = value.term;
    const buffers = {};
    for (const kind of ['normal', 'alternate']) {
      const buffer = term.buffer[kind];
      const lines = [];
      for (let index = 0; index < buffer.length; index += 1) {
        const line = buffer.getLine(index);
        const cells = [];
        for (let column = 0; column < line.length; column += 1) {
          const cell = line.getCell(column);
          cells.push({ text: cell.getChars(), code: cell.getCode(), width: cell.getWidth(),
            fg: [cell.getFgColorMode(), cell.getFgColor()], bg: [cell.getBgColorMode(), cell.getBgColor()],
            flags: ['isBold', 'isItalic', 'isDim', 'isInverse', 'isUnderline', 'isBlink', 'isInvisible', 'isStrikethrough', 'isOverline']
              .map(name => cell[name]()),
            underline: [cell.getUnderlineColor?.(), cell.getUnderlineStyle?.()],
            link: term._core._oscLinkService.getLinkData(cell.extended?.urlId ?? 0) });
        }
        lines.push({ text: line.translateToString(false), wrapped: line.isWrapped, cells });
      }
      buffers[kind] = { cursorX: buffer.cursorX, cursorY: buffer.cursorY, baseY: buffer.baseY,
        viewportY: buffer.viewportY, lines };
    }
    return { buffers, active: term.buffer.active.type, cols: term.cols, rows: term.rows,
      modes: structuredClone(term.modes), cursor: [term._core.coreService.isCursorHidden, term._core.coreService.isCursorInitialized] };
  }
  function hydrate(target, state) {
    restore(target.term, JSON.parse(JSON.stringify(state)));
    target.colors.overrides = structuredClone(state.colors.overrides);
  }
  async function apply(runtime, operation) {
    if (typeof operation === 'object' && !ArrayBuffer.isView(operation)) {
      runtime.term.resize(operation.cols, operation.rows);
    } else {
      await write(runtime, operation);
    }
  }
  async function equivalent(prefix, suffixes, options = {}) {
    const source = create(options);
    const target = create({ cols: 9, rows: 3, scrollback: 2 });
    try {
      for (const operation of Array.isArray(prefix) ? prefix : [prefix]) await apply(source, operation);
      const before = observe(source);
      const links = JSON.parse(JSON.stringify([...source.term._core._oscLinkService._dataByLinkId]
        .map(([id, entry]) => ({ id, data: entry.data }))));
      const markers = [...source.term._core._oscLinkService._dataByLinkId.values()].flatMap(entry => entry.lines);
      const state = snapshot(source);
      assert.deepEqual(observe(source), before, 'capture must preserve visible source state');
      assert.deepEqual(state.links.entries.map(({ id, data }) => ({ id, data })), links,
        'capture must retain link data referenced by cells, attributes or future OSC8');
      assert.deepEqual([...source.term._core._oscLinkService._dataByLinkId.values()].flatMap(entry => entry.lines), markers,
        'capture must not change the source link lifetimes or affect existing readers');
      assert.ok(markers.every(marker => !marker.isDisposed));
      await write(target, '\x1b[44mold\r\n'.repeat(12) + '\x1b]8;;https://example.test/obsolete\x07old\x1b[?1049hprevious\x1b]2;unfinished');
      hydrate(target, state);
      assert.deepEqual(snapshot(target), state, 'import must preserve the current state');
      assert.deepEqual(observe(target), observe(source), 'independent public buffer/cell observation must agree');
      assert.deepEqual(target.replies, [], 'import must not replay historical terminal responses');
      source.replies.length = 0;
      for (const suffix of suffixes) {
        await apply(source, suffix);
        await apply(target, suffix);
        assert.deepEqual(snapshot(target), snapshot(source), 'the same future suffix must preserve equivalence');
        assert.deepEqual(observe(target), observe(source), 'future public buffer/cell observations must agree');
        assert.deepEqual(target.replies, source.replies, 'future terminal replies must be equivalent');
      }
    } finally { source.dispose(); target.dispose(); }
  }
  async function check(name, run) {
    await run(); passed += 1; console.log(`ok ${passed} - ${name}`);
  }

  await check('normal state, retained scrollback, saved cursor, attributes and tabs', () => equivalent(
    'first\r\nsecond\r\nthird\r\nfourth\r\nfifth\r\nsixth\x1b[1;2;3;4:3;38:2::3:7:11m\x1b7\tstyled',
    ['\x1b8X\x1b[0m\r\nend', { cols: 12, rows: 7 }, 'tail\x1b[6n']));

  await check('both buffers, active alternate screen, modes and scroll region', () => equivalent(
    'normal-before\r\nnormal-after\x1b[?1049hALT\x1b[2;4r\x1b[?25l\x1b[?1000h\x1b[?1006h\x1b[?2004h\x1b[4h\x1b[5 q',
    ['\r\nalt-tail', '\x1b[?1049l\x1b[?25h\x1b[4lrestored-normal', { cols: 10, rows: 4 }]));

  await check('wide, combining, join state, wrapping and reflow', () => equivalent(
    'A\u4e2d\u6587e\u0301\u0302\ud83d\ude80abcdefghijklmno\r\n0123456789012345678',
    ['\u0301\r\n\u4e2d\u6587', { cols: 7, rows: 6 }, 'after-shrink', { cols: 24, rows: 4 }]));

  await check('character sets and title/icon stacks', () => equivalent(
    '\x1b]0;old\x07\x1b[22;0t\x1b]0;new\x07\x1b(0lqqk\x1b)B\x0eabc',
    ['\x1b[23;0t\x0flqqk\x1b(Bsuffix']));

  await check('partial CSI parameter/subparameter carry at every boundary', async () => {
    const sequence = '\x1b[38:2::30:50:70;4:3m';
    for (let index = 1; index < sequence.length; index += 1) {
      await equivalent(`prefix${sequence.slice(0, index)}`, [`${sequence.slice(index)}colored\x1b[0m`, '\r\ntail']);
    }
  });

  await check('partial OSC and DCS handler payload, parameters and terminator', async () => {
    for (const sequence of ['\x1b]2;new title\x1b\\', '\x1b]8;id=abc;https://example.test/link\x1b\\', '\x1bP$q q\x1b\\']) {
      for (let index = 1; index < sequence.length; index += 1) {
        await equivalent(`prefix${sequence.slice(0, index)}`, [`${sequence.slice(index)}suffix\x1b]8;;\x1b\\`, '\r\nafter']);
      }
    }
  });

  await check('UTF16 surrogate and UTF8 byte carry', async () => {
    await equivalent('before\ud83d', ['\ude80after']);
    for (const prefix of [Uint8Array.of(0x41, 0xf0), Uint8Array.of(0x41, 0xf0, 0x9f), Uint8Array.of(0x41, 0xf0, 0x9f, 0x9a)]) {
      const remaining = Uint8Array.of(0xf0, 0x9f, 0x9a, 0x80).slice(prefix.length - 1);
      await equivalent(prefix, [remaining, 'after']);
    }
  });

  await check('dynamic palette/default colors store only current overrides', async () => {
    await equivalent('\x1b]4;1;rgb:12/34/56;8;#654321\x07\x1b]10;#abcdef\x07\x1b]11;#123456\x07\x1b]12;#102030\x07',
      ['\x1bc', '\x1b]104;1\x07\x1b]110\x07', '\x1b]104\x07\x1b]111\x07\x1b]112\x07']);
    const colors = createTerminalCurrentColors();
    for (let index = 0; index < 10000; index += 1) applyTerminalCurrentColorRequests(colors, [{ type: 1, index: 1, color: [1, 2, 3] }]);
    assert.deepEqual(colors, { overrides: { 1: [1, 2, 3] } });
  });

  await check('OSC8 markers retain links across import, trim, buffer switch and new link reuse', () => equivalent(
    '\x1b]8;id=one;https://example.test/one\x1b\\line-one\r\nline-two\x1b]8;;\x1b\\\x1b[?1049h\x1b]8;;https://example.test/alt\x07alt',
    ['\x1b]8;;\x07\x1b[?1049l\x1b]8;id=one;https://example.test/one\x07more\x1b]8;;\x07', '\r\nnext'.repeat(35)]));

  await check('OSC8 followed by RIS preserves capture, import and future named-link reuse', async () => {
    for (const params of ['', 'id=reset']) {
      const link = `\x1b]8;${params};https://example.test/reset\x07`;
      await equivalent(`${link}old\x1b]8;;\x07\x1bc`,
        ['plain', `${link}new\x1b]8;;\x07`, '\r\ntrim'.repeat(40), `${link}again\x1b]8;;\x07`]);
    }
  });

  for (const buffer of ['normal', 'alternate']) {
    await check(`OSC8 height shrink in ${buffer} preserves cells, current/saved attributes and future links`, async () => {
      const link = '\x1b]8;id=bottom;https://example.test/bottom\x07';
      for (const kept of ['\x1b]8;;https://example.test/kept\x07', link]) {
        await equivalent([
          `${buffer === 'alternate' ? '\x1b[?1049h' : ''}${kept}kept\x1b]8;;\x07`
            + `\x1b[24;1H${link}bottom\x1b7\x1b[1;10H`,
          { cols: 80, rows: 10 }
        ], ['current', '\x1b8saved\x1b]8;;\x07', { cols: 80, rows: 24 },
          `\x1b[1;1H${link}reused\x1b]8;;\x07`, '\r\ntrim'.repeat(60), `${link}again\x1b]8;;\x07`,
          '\x1b[?1049l'], { cols: 80, rows: 24 });
      }
    });
  }

  await check('height shrink with zero scrollback retains the uninitialized alternate capacity', () => equivalent(
    ['before', { cols: 80, rows: 10 }], ['\x1b[?1049halt', { cols: 80, rows: 24 }, '\x1b[?1049l'],
    { cols: 80, rows: 24, scrollback: 0 }));

  await check('trimmed OSC8 links do not become retained historical maps', async () => {
    const runtime = create({ scrollback: 2 });
    try {
      for (const count of [1, 30, 300]) {
        await write(runtime, '\x1b]8;;https://example.test/temporary\x07link\x1b]8;;\x07\r\n'.repeat(count));
        await write(runtime, 'plain\r\n'.repeat(12));
        const state = snapshot(runtime);
        assert.equal(state.links.entries.length, 0);
        assert.equal(runtime.term._core._oscLinkService._dataByLinkId.size, 0);
        assert.equal(runtime.term._core._oscLinkService._entriesWithId.size, 0);
        assert.equal(runtime.term._core._bufferService.buffers.normal.markers.length, 0);
        assert.ok(state.links.nextId > 1, 'a single numeric allocation counter is not historical link retention');
      }
    } finally { runtime.dispose(); }
  });

  await check('current state restoration cost is independent of overwritten history', async () => {
    const states = [];
    for (const repeats of [1, 200, 1200]) {
      const runtime = create();
      try {
        await write(runtime, '\x1b[2J\x1b[Hredraw\x1b]4;2;#010203\x07'.repeat(repeats));
        await write(runtime, '\x1b[2J\x1b[Hfinal');
        states.push(snapshot(runtime));
      } finally { runtime.dispose(); }
    }
    assert.deepEqual(states[1], states[0]); assert.deepEqual(states[2], states[0]);
    const payloads = states.map(state => JSON.stringify(state).length);
    assert.equal(new Set(payloads).size, 1);
    console.log(`same-state history 1/200/1200: ${payloads.join('/')} JSON characters`);
  });

  await check('ordinary retained lines use compact exact cells and no ANSI parser replay', async () => {
    const source = create({ cols: 80, rows: 24, scrollback: 1000 });
    const target = create();
    try {
      await write(source, Array.from({ length: 1100 }, (_, index) =>
        `${String(index).padStart(6, '0')}:abcdefghijklmnopqrstuvwxyz0123456\r\n`).join(''));
      const captureStart = performance.now();
      const state = snapshot(source);
      const captureMs = performance.now() - captureStart;
      const raw = structuredClone(state);
      for (const kind of ['normal', 'alternate']) {
        const buffer = source.term._core._bufferService.buffers[kind === 'normal' ? 'normal' : 'alt'];
        raw[kind].lines.forEach((line, index) => {
          const cells = buffer.lines.get(index)._data;
          line.cells = Buffer.from(cells.buffer, cells.byteOffset, line.length * 12).toString('base64');
        });
      }
      const rawBytes = Buffer.byteLength(JSON.stringify(raw));
      const encodedBytes = Buffer.byteLength(JSON.stringify(state));
      assert.ok(encodedBytes < rawBytes / 3, 'the same exact state must avoid full raw-u32 wire inflation');
      let parserWrites = 0;
      const originalWrite = target.term.write.bind(target.term);
      target.term.write = (...args) => { parserWrites += 1; return originalWrite(...args); };
      const importStart = performance.now();
      hydrate(target, state);
      const importMs = performance.now() - importStart;
      assert.equal(parserWrites, 0, 'import must not regenerate/reparse historical ANSI');
      assert.deepEqual(observe(target), observe(source));
      const cells = state.normal.lines.reduce((total, line) => total + line.length, 0);
      console.log(`80 columns / 1000 scrollback / 40-character lines: raw=${rawBytes} encoded=${encodedBytes} bytes; retained=${cells} cells; ANSI writes=${parserWrites}; capture=${captureMs.toFixed(1)}ms import=${importMs.toFixed(1)}ms (observations, not budgets)`);
    } finally { source.dispose(); target.dispose(); }
  });

  await check('pending writes and asynchronously paused parsers cannot be snapshotted', async () => {
    const runtime = create();
    try {
      runtime.term.write('pending');
      assert.throws(() => snapshot(runtime), /pending-write/);
      await write(runtime, '');
      let resume;
      runtime.term.parser.registerOscHandler(777, () => new Promise(resolve => { resume = resolve; }));
      const completion = write(runtime, '\x1b]777;waiting\x07');
      while (!resume) await new Promise(resolve => setTimeout(resolve, 1));
      assert.throws(() => snapshot(runtime), /pending-write|parser-paused/);
      resume(true); await completion;
      assert.equal(snapshot(runtime).format, 'xterm-current-state-v1');
    } finally { runtime.dispose(); }
  });

  await check('malformed or incompatible state fails before replacing the destination', async () => {
    const runtime = create();
    try {
      await write(runtime, 'must-stay');
      const original = snapshot(runtime);
      assert.throws(() => capture(runtime.term), /color-observation-required/);
      for (const modify of [state => { state.engine = 'xterm@other'; }, state => { state.normal.lines[0].cells = '!'; }, state => { state.parser.params.params = new Array(33).fill(0); }, state => { state.mouse.protocol = 'unknown'; },
        state => { state.alternate.maxLength = 65536; }, state => { state.normal.maxLength = state.rows + state.scrollback + 1; }, state => {
        state.links = { nextId: 2, entries: [{ id: 1, data: { uri: 'https://example.test/invalid' },
          markers: [{ buffer: 'normal', line: state.normal.lines.length }] }] };
      }]) {
        const invalid = structuredClone(original); modify(invalid);
        assert.throws(() => hydrate(runtime, invalid), /Unsupported terminal current state/);
        assert.deepEqual(snapshot(runtime), original);
      }
      for (const marker of [{ buffer: 'normal', line: 0, afterEnd: true },
        { buffer: 'normal', line: original.normal.lines.length, afterEnd: false },
        { buffer: 'detached', line: 0, afterEnd: true }, { buffer: 'unknown', line: 0 }]) {
        const invalid = structuredClone(original);
        invalid.links = { nextId: 2, entries: [{ id: 1, data: { uri: 'https://example.test/invalid' }, markers: [marker] }] };
        assert.throws(() => hydrate(runtime, invalid), /Unsupported terminal current state/);
        assert.deepEqual(snapshot(runtime), original);
      }
    } finally { runtime.dispose(); }
  });

  await check('unfinished OSC52 reaches the target handler once, without replaying completed history', async () => {
    const source = create(); const target = create(); const clipboard = [];
    try {
      source.term.parser.registerOscHandler(52, () => false);
      target.term.parser.registerOscHandler(52, value => { clipboard.push(value); return true; });
      await write(source, '\x1b]52;c;previous\x07');
      hydrate(target, snapshot(source));
      assert.deepEqual(clipboard, []);
      await write(source, '\x1b]52;c;SGV');
      const state = snapshot(source);
      assert.deepEqual(state.parser.osc.handlers, [{ data: 'c;SGV', hitLimit: false }]);
      hydrate(target, state);
      assert.deepEqual(clipboard, [], 'Import itself is not a clipboard operation.');
      await write(target, 'sbG8=\x07');
      assert.deepEqual(clipboard, ['c;SGVsbG8=']);
      await write(target, '\x07');
      assert.deepEqual(clipboard, ['c;SGVsbG8='], 'A completed sequence cannot be dispatched twice.');
      await write(target, '\x1b]52;c;new\x07');
      assert.deepEqual(clipboard, ['c;SGVsbG8=', 'c;new']);
    } finally { source.dispose(); target.dispose(); }
  });

  console.log(`Terminal current-state codec: ${passed}/${passed} passed (real xterm 6 headless, future suffix and same-state histories).`);
} finally { await rm(temporary, { recursive: true, force: true }); }
