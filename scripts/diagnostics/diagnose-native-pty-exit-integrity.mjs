import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const DEFAULT_RUNS = 3;
const DEFAULT_TIMEOUT_MS = 30_000;
const CASES = [
  { name: 'natural-zero', kind: 'complete', exitCode: 0 },
  { name: 'natural-nonzero', kind: 'complete', exitCode: 7 },
  { name: 'large-output', kind: 'complete', exitCode: 7 },
  { name: 'split-utf8-tail', kind: 'complete', exitCode: 7 },
  { name: 'cancel-after-head', kind: 'cancel' }
];

const values = parseArgs(process.argv.slice(2));
if (values['self-test']) {
  await runSelfTest();
} else {
  try {
    await runDiagnostic(values);
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    const watchdog = setTimeout(() => {
      console.error('Diagnostic resources did not close within the final 2-second guard');
      process.exit(1);
    }, 2000);
    watchdog.unref();
  }
}

function parseArgs(args) {
  const parsed = { runs: DEFAULT_RUNS, timeoutMs: DEFAULT_TIMEOUT_MS };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--self-test') parsed['self-test'] = true;
    else if (arg === '--runs') parsed.runs = Number(args[++index]);
    else if (arg === '--timeout-ms') parsed.timeoutMs = Number(args[++index]);
    else if (arg === '--output') parsed.output = args[++index];
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!parsed['self-test']) {
    if (!parsed.output) throw new Error('--output is required');
    assertInteger(parsed.runs, '--runs', 1);
    assertInteger(parsed.timeoutMs, '--timeout-ms', 1000);
    if (existsSync(parsed.output)) throw new Error(`Refusing to overwrite evidence: ${parsed.output}`);
  }
  return parsed;
}

function assertInteger(value, name, minimum) {
  if (!Number.isInteger(value) || value < minimum) {
    throw new Error(`${name} must be an integer >= ${minimum}`);
  }
}

async function runSelfTest() {
  assert.equal(normalizeTerminalText('a\r\nb\rc'), 'a\nb\nc');
  assert.deepEqual(inspectText(''), { bytes: 0, sha256: sha256(''), length: 0 });
  assert.equal(makeExpected('natural-nonzero'), 'DSC_NATIVE_HEAD\nDSC_NATIVE_EXIT_7\n');
  assert.match(makeExpected('large-output'), /DSC_NATIVE_LINE_00001/);
  assert.match(makeExpected('split-utf8-tail'), /DSC_NATIVE_SPLIT_\u2603_TAIL/);
  assert.throws(() => parseArgs(['--runs', '0', '--output', 'x']), /--runs/);
  const { Terminal } = require('@xterm/headless');
  const expected = await renderTerminalText(Terminal, 'HEAD\r\nTAIL\r\n');
  assert.deepEqual(await renderTerminalText(Terminal, '\x1b[?25lHEAD\r\nTAIL\r\n\x1b[?25h'), expected);
  assert.notDeepEqual(await renderTerminalText(Terminal, 'HEAD\r\nTAIL'), expected);
  assert.equal((await renderTerminalText(Terminal, 'DSC_NATIVE_SPLIT_\u2603_TAIL\r\n')).text,
    makeExpected('split-utf8-tail').trimEnd());
  console.log('native PTY diagnostic self-test: ok');
}

async function runDiagnostic(options) {
  const pty = loadNodePty();
  const { Terminal } = require('@xterm/headless');
  const outputDir = path.resolve(options.output);
  mkdirSync(outputDir, { recursive: true });
  const environment = collectEnvironment(pty);
  writeFileSync(path.join(outputDir, 'environment.json'), `${JSON.stringify(environment, null, 2)}\n`);

  const summaries = [];
  for (const testCase of CASES) {
    mkdirSync(path.join(outputDir, testCase.name));
    for (let run = 1; run <= options.runs; run += 1) {
      const runDir = path.join(outputDir, testCase.name, `run-${run}`);
      mkdirSync(runDir, { recursive: false });
      const summary = await runCase(pty, Terminal, testCase, runDir, options.timeoutMs);
      summaries.push(summary);
      console.log(JSON.stringify({
        case: summary.case, run: summary.run, passed: summary.passed,
        result: summary.result, exit: summary.exit, postExitDataBytes: summary.postExitDataBytes
      }));
    }
  }
  writeFileSync(path.join(outputDir, 'summary.json'), `${JSON.stringify(summaries, null, 2)}\n`);
  const failures = summaries.filter(summary => !summary.passed);
  if (failures.length > 0) {
    throw new Error(`${failures.length} native PTY diagnostic case(s) failed`);
  }
  console.log(`Native PTY evidence: ${outputDir}`);
}

function loadNodePty() {
  try {
    return require('node-pty');
  } catch (error) {
    throw new Error(`node-pty is required for the native probe: ${error.message}`);
  }
}

function collectEnvironment(pty) {
  const packageInfo = JSON.parse(readFileSync(require.resolve('node-pty/package.json'), 'utf8'));
  return {
    capturedAt: new Date().toISOString(),
    platform: process.platform,
    arch: process.arch,
    osRelease: os.release(),
    osType: os.type(),
    node: process.version,
    electron: process.versions.electron ?? null,
    libuv: process.versions.uv,
    executable: process.execPath,
    versions: process.versions,
    nodePty: packageInfo.version,
    backend: process.platform === 'win32' ? 'native-conpty-builtin' : 'native-unix-pty',
    evidenceScope: 'node-pty public API under the current executable; not Host/Webview or packaged acceptance',
    diagnosticSha256: sha256(readFileSync(fileURLToPath(import.meta.url))),
    ptyExports: Object.keys(pty).sort(),
    runner: process.env.GITHUB_ACTIONS === 'true' ? 'github-actions' : 'local',
    github: {
      sha: process.env.GITHUB_SHA ?? null,
      runId: process.env.GITHUB_RUN_ID ?? null,
      runAttempt: process.env.GITHUB_RUN_ATTEMPT ?? null,
      imageOS: process.env.ImageOS ?? null,
      imageVersion: process.env.ImageVersion ?? null
    }
  };
}

async function runCase(pty, Terminal, testCase, runDir, timeoutMs) {
  const expected = testCase.kind === 'complete' ? normalizeTerminalText(makeExpected(testCase.name)) : null;
  const receiptPath = path.join(runDir, 'writer-receipt.json');
  const script = makeChildScript(testCase.name, receiptPath);
  const startedAt = Date.now();
  let terminal;
  let output = '';
  let exit;
  let timeout;
  let cancelTimer;
  let hardTimeout;
  let outputBytesAtExit;
  let postExitDataBytes = 0;
  const events = [];
  const mark = (event, details = {}) => events.push({ atMs: Date.now() - startedAt, event, ...details });
  const killFixture = () => {
    try { terminal.kill(); } catch (error) { mark('kill-error', { message: error.message }); }
  };
  try {
    terminal = pty.spawn(process.execPath, ['-e', script], {
      name: 'xterm-256color',
      cols: 120,
      rows: 40,
      cwd: runDir,
      env: { ...process.env, NODE_NO_WARNINGS: '1' },
      ...(process.platform === 'win32' ? { useConpty: true, useConptyDll: false } : {})
    });
    mark('spawn', { pid: terminal.pid });
    terminal.on('error', error => mark('terminal-error', { message: error.message }));
    terminal._socket?.on('end', () => mark('socket-end'));
    terminal._socket?.on('close', () => mark('socket-close'));
    const exitPromise = new Promise(resolve => terminal.onExit(event => {
      exit = { exitCode: event.exitCode, signal: event.signal };
      outputBytesAtExit = Buffer.byteLength(output);
      mark('onExit', exit);
      resolve(exit);
    }));
    terminal.onData(data => {
      output += data;
      if (exit) postExitDataBytes += Buffer.byteLength(data);
      mark('onData', { bytes: Buffer.byteLength(data) });
      if (testCase.kind === 'cancel' && output.includes('DSC_NATIVE_CANCEL_HEAD')) {
        if (!cancelTimer) {
          cancelTimer = setTimeout(() => {
            mark('cancel-request');
            killFixture();
          }, 10);
        }
      }
    });
    timeout = setTimeout(() => {
      mark('timeout');
      killFixture();
    }, timeoutMs);
    const hardDeadline = new Promise(resolve => {
      hardTimeout = setTimeout(() => {
        mark('hard-timeout');
        if (terminal.pid > 0) {
          try { process.kill(terminal.pid, 'SIGKILL'); } catch { /* the fixture may already have exited */ }
        }
        resolve();
      }, timeoutMs + 2000);
    });
    await Promise.race([exitPromise, hardDeadline]);
    // Capture data callbacks queued immediately around onExit without turning this into a product drain budget.
    await new Promise(resolve => setTimeout(resolve, 25));
  } catch (error) {
    mark('error', { message: error.message });
  } finally {
    clearTimeout(timeout);
    clearTimeout(cancelTimer);
    clearTimeout(hardTimeout);
    if (terminal && !exit) {
      try { terminal.kill(); } catch { /* best effort cleanup for a failed fixture */ }
    }
  }

  const normalized = normalizeTerminalText(output);
  const rendered = await renderTerminalText(Terminal, output);
  const renderedExpected = expected ? await renderTerminalText(Terminal, expected.replaceAll('\n', '\r\n')) : null;
  const receipt = existsSync(receiptPath) ? JSON.parse(readFileSync(receiptPath, 'utf8')) : null;
  const timedOut = events.some(event => event.event === 'timeout' || event.event === 'hard-timeout');
  const complete = testCase.kind === 'complete' && !timedOut && exit?.exitCode === testCase.exitCode &&
    receipt?.written === true && JSON.stringify(rendered) === JSON.stringify(renderedExpected) &&
    (process.platform === 'win32' || normalized === expected);
  const canceled = testCase.kind === 'cancel' && !timedOut &&
    events.some(event => event.event === 'cancel-request') && Boolean(exit);
  const summary = {
    case: testCase.name,
    run: Number(path.basename(runDir).slice(4)),
    platform: process.platform,
    passed: complete || canceled,
    result: complete ? 'content-matched' : canceled ? 'cancelled' : 'failed',
    exit,
    outputBytesAtExit,
    postExitDataBytes,
    observationScope: 'Known-content baseline; post-exit observation is not a source-drain contract',
    rawOutput: inspectText(output),
    normalizedOutput: inspectText(normalized),
    rendered: { ...inspectText(rendered.text), cursorX: rendered.cursorX, cursorLine: rendered.cursorLine },
    receipt,
    renderedExpected: renderedExpected ? {
      ...inspectText(renderedExpected.text), cursorX: renderedExpected.cursorX, cursorLine: renderedExpected.cursorLine
    } : undefined,
    events,
    elapsedMs: Date.now() - startedAt
  };
  writeFileSync(path.join(runDir, 'output.txt'), output);
  writeFileSync(path.join(runDir, 'rendered.txt'), rendered.text);
  writeFileSync(path.join(runDir, 'child-script.js'), `${script}\n`);
  writeFileSync(path.join(runDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
  return summary;
}

function makeExpected(name) {
  if (name === 'natural-zero') return 'DSC_NATIVE_HEAD\nDSC_NATIVE_EXIT_0\n';
  if (name === 'natural-nonzero') return 'DSC_NATIVE_HEAD\nDSC_NATIVE_EXIT_7\n';
  if (name === 'large-output') {
    return Array.from({ length: 12000 }, (_, index) => `DSC_NATIVE_LINE_${String(index + 1).padStart(5, '0')}\n`).join('');
  }
  if (name === 'split-utf8-tail') return 'DSC_NATIVE_SPLIT_\u2603_TAIL\n';
  if (name === 'cancel-after-head') return 'DSC_NATIVE_CANCEL_HEAD\n';
  throw new Error(`Unknown case: ${name}`);
}

function makeChildScript(name, receiptPath) {
  const exitCode = name === 'natural-zero' ? 0 : 7;
  const finish = `const done = (error) => { require('node:fs').writeFileSync(${JSON.stringify(receiptPath)}, JSON.stringify({written: !error, exitCode: ${exitCode}, error: error?.message})); process.exit(error ? 77 : ${exitCode}); }; `;
  if (name === 'natural-zero') {
    return finish + "process.stdout.write('DSC_NATIVE_HEAD\\nDSC_NATIVE_EXIT_0\\n', done);";
  }
  if (name === 'natural-nonzero') {
    return finish + "process.stdout.write('DSC_NATIVE_HEAD\\nDSC_NATIVE_EXIT_7\\n', done);";
  }
  if (name === 'large-output') {
    return finish + "const text = Array.from({length: 12000}, (_, i) => `DSC_NATIVE_LINE_${String(i + 1).padStart(5, '0')}\\n`).join(''); process.stdout.write(text, done);";
  }
  if (name === 'split-utf8-tail') {
    return finish + "const chunks = [Buffer.from('DSC_NATIVE_SPLIT_'), Buffer.from([0xe2, 0x98]), Buffer.from([0x83]), Buffer.from('_TAIL\\n')]; let i = 0; const next = (error) => error || i === chunks.length ? done(error) : process.stdout.write(chunks[i++], next); next();";
  }
  if (name === 'cancel-after-head') {
    return "process.stdout.write('DSC_NATIVE_CANCEL_HEAD\\n', () => setTimeout(() => {}, 60000));";
  }
  throw new Error(`Unknown case: ${name}`);
}

async function renderTerminalText(Terminal, text) {
  const terminal = new Terminal({ cols: 120, rows: 40, scrollback: 15000, allowProposedApi: true });
  try {
    await new Promise(resolve => terminal.write(text, resolve));
    const lines = [];
    for (let index = 0; index < terminal.buffer.active.length; index += 1) {
      lines.push(terminal.buffer.active.getLine(index).translateToString(true));
    }
    return {
      text: lines.join('\n').trimEnd(),
      cursorX: terminal.buffer.active.cursorX,
      cursorLine: terminal.buffer.active.baseY + terminal.buffer.active.cursorY
    };
  } finally {
    terminal.dispose();
  }
}

function normalizeTerminalText(text) {
  return text.replaceAll('\r\n', '\n').replaceAll('\r', '\n');
}

function inspectText(text) {
  return { bytes: Buffer.byteLength(text), sha256: sha256(text), length: text.length };
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}
