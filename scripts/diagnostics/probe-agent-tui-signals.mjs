// Fixed-CLI protocol exploration only. This is not product/VS Code acceptance.
import fs from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import pty from 'node-pty';
import headless from '@xterm/headless';
import { prepareAgentTui } from '../smoke/agent-tui-configuration.mjs';
const { values } = parseArgs({ options: { output: { type: 'string' }, 'cli-root': { type: 'string' },
  provider: { type: 'string', default: 'codex' } } });
const output = path.resolve(values.output);
await fs.mkdir(output, { recursive: true });
const key = process.env.DEEPSEEK_API_KEY;
const config = await prepareAgentTui({ provider: values.provider, directory: output,
  projectRoot: process.cwd(), cliRoot: values['cli-root'], apiKey: key });
delete process.env.DEEPSEEK_API_KEY;
const terminal = new headless.Terminal({ cols: 110, rows: 32, allowProposedApi: true, scrollback: 3000 });
let child;
let ended = false;
let stage = 'startup';
let raw = '';
const screens = [];
const text = () => Array.from({ length: terminal.buffer.active.length }, (_, i) =>
  terminal.buffer.active.getLine(i)?.translateToString(true) ?? '').join('\n');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function poll(label, read, predicate, timeout = 60000) {
  stage = label;
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const value = await read();
    if (predicate(value)) return value;
    if (ended) throw new Error(`CLI exited during ${label}`);
    await sleep(100);
  }
  throw new Error(`Timed out during ${label}`);
}
const optionalJSON = async file => {
  try { return JSON.parse(await fs.readFile(path.join(output, file), 'utf8')); }
  catch (e) { if (e.code === 'ENOENT') return undefined; throw e; }
};
try {
  child = pty.spawn(config.cli, config.args, { name: 'xterm-256color', cols: 110, rows: 32,
    cwd: config.workspace, env: { ...process.env, ...config.environment } });
  child.onExit(() => { ended = true; });
  child.onData(data => { raw += data; terminal.write(data); });
  // Respond to terminal queries as the actual xterm surface does.
  terminal.onData(data => child.write(data));
  const accepted = new Set();
  await poll('interactive-ready', async () => {
    const screen = text();
    for (const [id, pattern] of [['theme', /Choose.*(?:theme|text style)|Select.*theme/i],
      ['trust', /Yes, I trust|Do you trust|Trust this (?:folder|directory)/i],
      ['key', /Detected a custom API key/], ['login', /Select login method:/]]) {
      if (pattern.test(screen) && !accepted.has(id)) {
        screens.push({ stage: id, text: screen }); accepted.add(id); child.write('\r'); return '';
      }
    }
    return screen;
  }, value => /[›❯]/u.test(value) && /(?:help|shortcuts|Try|Ask|context|Claude Code)/i.test(value), 45000);
  screens.push({ stage: 'ready', text: text() });
  child.write(`\x1b[200~${config.prompt}\x1b[201~`);
  await sleep(250); child.write('\r');
  const start = await poll('tool-start', () => optionalJSON('tool-start.json'), Boolean, 90000);
  screens.push({ stage: 'working', text: text() });
  child.write('UNSUBMITTED_TUI_DRAFT');
  await sleep(3000);
  screens.push({ stage: 'working-input', text: text() });
  child.write('\x15');
  await fs.writeFile(path.join(output, 'release.json'), JSON.stringify({ callId: start.callId }));
  await poll('stop-hook', async () => {
    try { return (await fs.readFile(config.events, 'utf8')).trim().split('\n').map(JSON.parse); }
    catch (e) { if (e.code === 'ENOENT') return []; throw e; }
  }, events => events.some(event => event.hook_event_name === 'Stop'), 90000);
  await sleep(2000);
  screens.push({ stage: 'completed', text: text() });
  child.resize(92, 28);
  await sleep(2000);
  screens.push({ stage: 'redraw', text: text() });
  stage = 'passed';
} catch (error) {
  process.exitCode = 1;
  screens.push({ stage, error: error.message, text: text() });
} finally {
  if (child && !ended) {
    child.write('\x03'); await sleep(1000);
    if (!ended) child.kill();
    await sleep(1000);
  }
  const sanitize = value => JSON.stringify(value, null, 2).replaceAll(key, '[REDACTED]');
  await fs.writeFile(path.join(output, 'probe.json'), sanitize({ stage, ended, screens, raw,
    acceptance: false, scope: 'CLI signal exploration, not product acceptance' }));
  await config.dispose(); terminal.dispose();
}
