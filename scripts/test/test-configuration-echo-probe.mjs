import assert from 'node:assert/strict';
import xterm from '@xterm/headless';
import { installEchoProbe } from '../diagnostics/configuration-reuse/browser-probe.mjs';
const terminal = new xterm.Terminal({ cols: 20, rows: 5, scrollback: 5000, allowProposedApi: true });
let keydown;
const priorWindow = globalThis.window, priorDocument = globalThis.document;
const textarea = {};
const adapter = { textarea, buffer: terminal.buffer,
  onWriteParsed: listener => terminal.onWriteParsed(listener), onRender: () => ({ dispose() {} }) };
globalThis.window = { __dscConfigurationProbeRegistry: new Map([['probe', { terminal: adapter }]]) };
globalThis.document = { addEventListener: (type, listener) => { assert.equal(type, 'keydown'); keydown = listener; } };
try {
  installEchoProbe('probe');
  const probe = window.__dscEchoProbe;
  probe.active = true;
  keydown({ key: 'a', target: textarea });
  keydown({ key: 'b', target: textarea });
  keydown({ key: 'z', target: {} }); // Unfocused key must not become a sample.
  assert.equal(probe.samples.length, 2);
  // The first reply is well outside 500 rows and outside the count of LF bytes
  // once wrapping is considered, but still retained in the terminal buffer.
  await new Promise(resolve => terminal.write('REPLY_000001_61\r\n' + ('x'.repeat(60)+'\r\n').repeat(400), resolve));
  for(let i=0;i<10 && probe.samples[0].applied===undefined;i++)await new Promise(resolve=>setTimeout(resolve,5));
  assert.equal(probe.samples[0].reply, 'REPLY_000001_61');
  assert.equal(typeof probe.samples[0].durationMs, 'number', 'large wrapped page must not hide a retained reply');
  assert.equal(probe.samples[1].applied, undefined, 'a missing reply stays unresolved');
  await new Promise(resolve => terminal.write('REPLY_000002_62\r\n', resolve));
  for(let i=0;i<10 && probe.samples[1].applied===undefined;i++)await new Promise(resolve=>setTimeout(resolve,5));
  assert.equal(typeof probe.samples[1].durationMs, 'number');
  console.log('PASS browser echo observer: real xterm wrapping/coalesced page, distinct replies, missing reply and input focus');
} finally {
  terminal.dispose();
  if (priorWindow === undefined) delete globalThis.window; else globalThis.window = priorWindow;
  if (priorDocument === undefined) delete globalThis.document; else globalThis.document = priorDocument;
}
