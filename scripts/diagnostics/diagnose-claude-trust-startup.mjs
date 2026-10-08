import assert from 'node:assert/strict';
import { mkdir, writeFile, mkdtemp, realpath, rm } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { performance } from 'node:perf_hooks';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { parseArgs } from 'node:util';
const require = createRequire(import.meta.url);
const pty = require('node-pty');
const { Terminal } = require('@xterm/headless');
// 仅诊断启动选择，不提交信任确认或模型请求；退出 0 不代表安装态验收通过。
const { values } = parseArgs({ options: {
  cli: { type: 'string' }, mode: { type: 'string', default: 'plain' }, output: { type: 'string' }
} });
assert.equal(process.platform, 'linux', 'This diagnostic is scoped to Linux.');
assert(values.cli && path.isAbsolute(values.cli), '--cli must be an absolute Claude executable path.');
assert(values.output, '--output must name a new evidence directory.');
const mode = values.mode;
assert(['plain', 'replies', 'plain-trace', 'plain-held'].includes(mode), 'Unknown diagnostic mode.');
const cli = await realpath(values.cli);
const output = path.resolve(values.output);
await mkdir(path.dirname(output), { recursive: true });
await mkdir(output); // 不覆盖旧运行证据。

const root = await mkdtemp(path.join(os.tmpdir(), 'dsc-claude-trust-'));
let terminal, child, exited;
try {
  const home = path.join(root, 'home'), workspace = path.join(root, 'workspace'), config = path.join(root, 'config');
  await Promise.all([home, workspace, config].map(directory => mkdir(directory)));
  const settings = path.join(config, 'settings.json');
  await writeFile(settings, JSON.stringify({ env: {
    ANTHROPIC_BASE_URL: 'http://127.0.0.1:1', ANTHROPIC_AUTH_TOKEN: 'diagnostic-not-a-real-key',
    ANTHROPIC_MODEL: 'deepseek-flash', ANTHROPIC_DEFAULT_OPUS_MODEL: 'deepseek-flash',
    ANTHROPIC_DEFAULT_SONNET_MODEL: 'deepseek-flash', ANTHROPIC_DEFAULT_HAIKU_MODEL: 'deepseek-flash',
    DISABLE_AUTOUPDATER: '1', CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1'
  } }));
  terminal = new Terminal({ cols: 120, rows: 39, scrollback: 1000, allowProposedApi: true });
  const events = [];
  const start = performance.now();
  const record = (type, data) => events.push({ at: Math.round((performance.now() - start) * 1000) / 1000, type, data });
  const isolatedEnv = {
    PATH: process.env.PATH, HOME: home, CLAUDE_CONFIG_DIR: config, TERM: 'xterm-256color',
    LANG: 'en_US.UTF-8', COLORTERM: 'truecolor'
  };
  const version = execFileSync(cli, ['--version'], { env: isolatedEnv, cwd: workspace, encoding: 'utf8', timeout: 5000 }).trim();
  assert.equal(version, '2.1.280 (Claude Code)', 'Use the diagnosed CLI version; do not mix version evidence.');
  const cliArgs = ['--settings', settings, '--safe-mode', '--strict-mcp-config', '--mcp-config',
    '{"mcpServers":{}}', '--tools', '', '--permission-mode', 'plan'];
  const traced = mode === 'plain-trace';
  child = pty.spawn(traced ? '/usr/bin/strace' : cli, traced
    ? ['-f', '-ttt', '-s', '128', '-e', 'trace=read,readv', '-o', path.join(output, 'syscalls.log'), cli, ...cliArgs]
    : cliArgs, {
    name: 'xterm-256color', cwd: workspace, cols: 120, rows: 39, env: isolatedEnv
  });
  const send = (data, source) => { record('input-' + source, data); child.write(data); };
  terminal.onData(data => { record('terminal-reply', data); if (mode === 'replies') send(data, 'reply'); });
  let chain = Promise.resolve(), raw = '', lastSelection, movedAt, firstTrustAt;
  const screen = () => {
    const b = terminal.buffer.active;
    return Array.from({ length: terminal.rows }, (_, i) => b.getLine(b.viewportY + i)?.translateToString(true) ?? '').join('\n');
  };
  child.onData(data => {
    raw += data;
    record('output', data);
    chain = chain.then(() => new Promise(resolve => terminal.write(data, resolve))).then(() => {
      const text = screen();
      const selection = /❯\s+No, exit/m.test(text) ? 'no' : /❯\s+Yes, I trust this folder/m.test(text) ? 'yes' : undefined;
      if (selection !== lastSelection) { record('selection', selection ?? 'none'); lastSelection = selection; }
    });
  });
  child.onExit(event => { exited = event; record('exit', event); });
  const prompts = new Set();
  while (performance.now() - start < 15000 && !exited) {
    await chain;
    const text = screen();
    if (movedAt) {
      if (performance.now() - movedAt > 750) break;
    } else if (/Accessing workspace:/.test(text) && lastSelection === 'no') {
      firstTrustAt ??= performance.now();
      if (mode !== 'plain-held' || performance.now() - firstTrustAt >= 1000) {
        movedAt = performance.now();
        send('\x1b[B', 'single-down');
      }
    } else {
      for (const [name, re] of [['theme', /Choose the text style/], ['security', /Security notes:[\s\S]*Press Enter to continue/],
        ['api-key', /Do you want to use this API key/]]) {
        if (re.test(text) && !prompts.has(name)) { prompts.add(name); send('\r', name); break; }
      }
    }
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  await chain;
  const summary = { mode, cli, version, root, node: process.version, platform: process.platform, pid: child.pid, moved: Boolean(movedAt), finalSelection: lastSelection,
    inputs: events.filter(x => x.type.startsWith('input')), selections: events.filter(x => x.type === 'selection'),
    exit: exited ?? null, elapsedMs: Math.round(performance.now() - start) };
  await Promise.all([writeFile(path.join(output, 'summary.json'), JSON.stringify(summary, null, 2)),
    writeFile(path.join(output, 'events.json'), JSON.stringify(events, null, 2)),
    writeFile(path.join(output, 'raw.txt'), raw), writeFile(path.join(output, 'screen.txt'), screen())]);
  console.log(JSON.stringify(summary, null, 2));
  assert(movedAt, 'Trust page was not reached in the bounded diagnostic.');
} finally {
  if (child && !exited) {
    try { process.kill(-child.pid, 'SIGTERM'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
    const deadline = performance.now() + 2000;
    while (!exited && performance.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
    assert(exited, 'Diagnostic child exit was not observed after SIGTERM.');
  }
  terminal?.dispose();
  await rm(root, { recursive: true, force: true });
}
