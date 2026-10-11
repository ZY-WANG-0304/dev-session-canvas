import assert from 'node:assert/strict';
import { build, transform } from 'esbuild';
import { readFile } from 'node:fs/promises';

const result = await build({ entryPoints: ['extensions/vscode/dev-session-canvas/src/webview/executionMouseDiagnostics.ts'],
  bundle: true, write: false, format: 'esm', platform: 'node' });
const { createExecutionMouseDiagnostics } = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
let enabled = false;
globalThis.Element = class { tagName = 'BUTTON'; className = 'node-title-action'; };
const samples = [];
const terminal = { cols: 66, rows: 21, modes: { mouseTrackingMode: 'any' }, element: { contains: () => false } };
const element = { getBoundingClientRect: () => ({ left: 0, top: 40, right: 660, bottom: 250 }) };
const event = { type: 'mousemove', timeStamp: 12, isTrusted: true, buttons: 0, button: 0,
  target: new Element(), clientX: 680, clientY: 20 };
const trace = createExecutionMouseDiagnostics(terminal, sample => samples.push(sample), () => enabled);
trace.observe(event, element, event, { col: 65, row: 0, x: 659, y: 0 }, 1);
trace.input('\x1b[<35;66;1M', 1);
assert.equal(samples.length, 0);
enabled = true;
trace.observe(event, element, event, { col: 65, row: 0, x: 659, y: 0 }, 1);
trace.input('\x1b[<35;66;1M', 2);
assert.equal(samples[0].insideScreen, false);
assert.equal(samples[0].targetInsideTerminal, false);
assert.equal(samples[1].eventId, samples[0].eventId);
assert.equal(samples[1].sequence, 2);
trace.input('secret keyboard text');
assert.equal(samples.length, 2);
await Promise.resolve();
trace.input('\x1b[<35;66;2M', 3);
assert.equal(samples[2].eventId, null);
assert.equal(samples[2].correlation, 'unmatched');
for (let i = 0; i < 1000; i++) trace.input('\x1b[<35;66;2M', i);
assert.equal(samples.length, 512);
trace.dispose();
trace.observe(event, element, event, undefined, 1);
assert.equal(samples.length, 512);
assert.ok(!JSON.stringify(samples).includes('secret keyboard text'));
console.log('Mouse diagnostics: development flag, outside-screen coordinates, correlation expiry, privacy and 512-record limit passed.');

// Exercise the actual webview runtime normalization, where an omitted field
// previously disabled diagnostics despite the Host sending true.
const mainSource = await readFile('extensions/vscode/dev-session-canvas/src/webview/main.tsx', 'utf8');
const normalizeSource = mainSource.slice(mainSource.indexOf('function normalizeRuntimeContext('),
  mainSource.indexOf('function normalizeAgentLaunchDefaults('));
const normalizedJs = await transform(normalizeSource, { loader: 'ts' });
const dependencyNames = ['normalizeAgentLaunchDefaults', 'normalizeCanvasStrongTerminalAttentionReminderMode',
  'normalizeExecutionTerminalWordSeparators', 'normalizeCanvasOverviewMode', 'normalizeCanvasOverviewZoomThreshold',
  'normalizeCanvasMultiRootPresentationMode', 'DEFAULT_TERMINAL_SCROLLBACK'];
const normalizeRuntime = new Function(...dependencyNames, `${normalizedJs.code}; return normalizeRuntimeContext;`)(
  ...dependencyNames.map(name => name === 'DEFAULT_TERMINAL_SCROLLBACK' ? 1000 : value => value));
assert.equal(normalizeRuntime({ executionMouseDiagnosticsEnabled: true }).executionMouseDiagnosticsEnabled, true);
for (const value of [undefined, false, 'true', 1]) {
  assert.equal(normalizeRuntime({ executionMouseDiagnosticsEnabled: value }).executionMouseDiagnosticsEnabled, false);
}
const pipelineSamples = [];
const runtime = normalizeRuntime({ executionMouseDiagnosticsEnabled: true });
const pipelineTrace = createExecutionMouseDiagnostics(terminal, sample => pipelineSamples.push(sample),
  () => runtime.executionMouseDiagnosticsEnabled === true);
pipelineTrace.observe(event, element, event, { col: 65, row: 0, x: 659, y: 0 }, 1);
pipelineTrace.input('\x1b[<35;66;1M', 10);
assert.equal(pipelineSamples.length, 2);
assert.equal(pipelineSamples[1].eventId, pipelineSamples[0].eventId);
pipelineTrace.dispose();
console.log('Host runtime flag survives actual webview normalization and enables mouse/onData capture.');
