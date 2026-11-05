import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import evidence from '../../tests/vscode-smoke/agent-tui-evidence.cjs';
import startup from '../../tests/vscode-smoke/agent-tui-startup.cjs';
import startupPrompts from '../../tests/vscode-smoke/agent-startup-prompts.cjs';
import { prepareAgentTuiSuite } from '../smoke/agent-tui-configuration.mjs';
const { parseEvents, observeTurn, answerWithFooter, draftInComposer } = evidence;
const receipt = 'receipt_' + 'a'.repeat(32);
const input = { provider: 'codex', prompt: 'Call the tool', workspace: '/private', submittedAt: 1,
  toolStart: { callId: 'call', startedAt: 4 }, toolEnd: { callId: 'call', completedAt: 5, receipt } };
const start = { hook_event_name: 'UserPromptSubmit', prompt: input.prompt, cwd: input.workspace,
  session_id: 'session', turn_id: 'turn', observedAt: 2 };
const pre = { hook_event_name: 'PreToolUse', cwd: input.workspace, session_id: 'session', turn_id: 'turn',
  observedAt: 3, tool_name: 'mcp__tui__wait_for_release', tool_use_id: 'tool-call', tool_input: {} };
const post = { ...pre, hook_event_name: 'PostToolUse', observedAt: 6,
  tool_response: { content: [{ type: 'text', text: receipt }] } };
const stop = { hook_event_name: 'Stop', cwd: input.workspace, session_id: 'session', turn_id: 'turn',
  observedAt: 7, stop_hook_active: false, last_assistant_message: `Here is your ${receipt}.` };
const complete = [start, pre, post, stop];
async function runHook(output, event) {
  const child = spawn(process.execPath, ['tests/vscode-smoke/agent-tui-hook.cjs', output]);
  let stdout = '';
  child.stdout.on('data', data => { stdout += data; });
  child.stderr.resume();
  const exited = once(child, 'exit');
  child.stdin.end(JSON.stringify(event));
  assert.equal((await exited)[0], 0);
  assert.deepEqual(JSON.parse(stdout), {});
}
test('current completed answer is independently identified; pending is distinct', () => {
  assert.equal(observeTurn([start], input).completed, false);
  assert.equal(observeTurn([start, pre], input).completed, false);
  assert.equal(observeTurn([start, pre, post], input).completed, false);
  assert.equal(observeTurn(complete, input).answer, stop.last_assistant_message);
  assert.equal(observeTurn([], input), undefined);
});
test('reject stale prompt, session, turn, failure, premature and duplicate completions', () => {
  for (const events of [[stop], [{ ...start, prompt: 'old' }, pre, post, stop],
    ...[{ session_id: 'old' }, { turn_id: 'other' }, { turn_id: undefined }, { stop_hook_active: true },
      { last_assistant_message: '' }, { last_assistant_message: '   ' }, { observedAt: 3 },
      { last_assistant_message: input.prompt }, { hook_event_name: 'StopFailure' }]
      .map(change => [start, pre, post, { ...stop, ...change }]),
    [{ ...start, turn_id: undefined }, pre, post, stop], [...complete, stop], [start, ...complete]]) {
    assert.throws(() => observeTurn(events, input));
  }
  assert.throws(() => observeTurn(complete, { ...input, toolEnd: undefined }));
  assert.throws(() => observeTurn(complete, { ...input, toolEnd: { ...input.toolEnd, callId: 'old' } }));
  assert.throws(() => observeTurn(complete, { ...input, submittedAt: 10 }));
  assert.throws(() => observeTurn([start], { ...input, provider: 'claude', expectedSessionId: 'other' }));
});
test('tool reception is independent of answer wording, language and receipt reproduction', () => {
  for (const answer of ['The test controller returned receipt ' + 'a'.repeat(32) + '.',
    'The tool has finished.', '工具执行完成。', receipt]) {
    assert.equal(observeTurn([start, pre, post, { ...stop, last_assistant_message: answer }], input).answer, answer);
  }
  const claudeEvents = complete.map(event => {
    const { turn_id, ...observed } = event;
    if (event === post) return { ...observed, tool_response: post.tool_response.content };
    return event === stop ? { ...observed, last_assistant_message: 'The tool has finished.' } : observed;
  });
  const claudeInput = { ...input, provider: 'claude', expectedSessionId: 'session' };
  assert.equal(observeTurn(claudeEvents, claudeInput).answer, 'The tool has finished.');
  assert.throws(() => observeTurn(complete, claudeInput), /exact fixture tool result/);
  assert.throws(() => observeTurn(claudeEvents, input), /turn id/);
});
test('completion requires exactly one matching CLI tool reception and causal order', () => {
  for (const events of [[start, stop], [start, pre, stop], [start, post, stop],
    [start, pre, pre, post, stop], [start, pre, post, post, stop], [start, post, pre, stop],
    [start, pre, stop, post], [pre, start, post, stop],
    [start, { ...pre, observedAt: 5 }, post, stop],
    ...[{ tool_use_id: 'other' }, { tool_use_id: '' }, { tool_name: 'mcp__other__wait_for_release' },
      { tool_input: { unexpected: true } }, { tool_response: undefined },
      { tool_response: { content: [{ type: 'text', text: 'receipt_' + 'b'.repeat(32) }] } },
      { tool_response: { isError: true, content: post.tool_response.content } },
      { tool_response: { content: [...post.tool_response.content, ...post.tool_response.content] } },
      { tool_response: { content: [{ type: 'image', text: receipt }] } },
      { tool_response: receipt }, { tool_response: { unrelated: receipt } },
      { tool_response: { content: [{ type: 'text', text: receipt.slice(8) }] } },
      { session_id: 'other' }, { cwd: '/other' }, { turn_id: 'other' }, { observedAt: 4 },
      { hook_event_name: 'PostToolUseFailure' }].map(change => [start, pre, { ...post, ...change }, stop])]) {
    assert.throws(() => observeTurn(events, input), JSON.stringify(events));
  }
  assert.throws(() => observeTurn(complete, { ...input, toolStart: { ...input.toolStart, startedAt: 2 } }));
  assert.throws(() => observeTurn(complete, { ...input, toolEnd: { ...input.toolEnd, completedAt: 7 } }));
});
test('actual varying answer must be fully present above composer, including folded words', () => {
  assert(answerWithFooter(['• Here is your rec', `eipt_${'a'.repeat(32)}.`, '', '› Ask anything'], stop.last_assistant_message));
  assert(!answerWithFooter(['› Ask anything', '• ' + stop.last_assistant_message], stop.last_assistant_message));
  assert(!answerWithFooter([receipt, '› Ask anything'], stop.last_assistant_message));
  assert(!answerWithFooter(['● Some different response', '›'], stop.last_assistant_message));
  assert(!answerWithFooter([stop.last_assistant_message, '›'], stop.last_assistant_message));
  assert(!answerWithFooter(['• Called tui', receipt, '›'], receipt));
  assert(!answerWithFooter(['❯ ' + stop.last_assistant_message, '›'], stop.last_assistant_message));
  assert(answerWithFooter(['● 工具执行完成。', '❯'], '工具执行完成。'));
  assert(answerWithFooter(['● ' + receipt, '❯'], receipt));
  assert(draftInComposer(['• Tool log DRAFT', '❯ DRAFT'], 'DRAFT'));
  assert(!draftInComposer(['• Tool log DRAFT', '❯'], 'DRAFT'));
});
test('compare full rendered inline content without erasing literal or missing characters', () => {
  const plain = `The tool returned ${receipt}.`;
  const markdown = 'The tool returned `' + receipt + '`.';
  assert(answerWithFooter(['● ' + plain, '❯'], markdown));
  assert(answerWithFooter(['● ' + plain, '❯'], '**The tool** returned `' + receipt + '`.'));
  assert(!answerWithFooter([receipt, '❯'], markdown));
  assert(!answerWithFooter(['● ' + plain.replace('returned ', ''), '❯'], markdown));
  assert(!answerWithFooter(['● ' + plain.replace('receipt_', 'receipt'), '❯'], markdown));
  assert(!answerWithFooter(['● ' + plain, '❯'], 'The tool returned \\`' + receipt + '\\`.'));
  assert(!answerWithFooter(['● ' + plain, '❯'], 'The tool returned ![hidden](receipt).'));
});
test('partial append cannot invent an event; corrupt complete JSON fails', () => {
  assert.deepEqual(parseEvents(JSON.stringify(start) + '\n{"incomplete"'), [start]);
  assert.throws(() => parseEvents('{broken}\n'));
});
test('Claude first-run No/Yes cursor cannot satisfy composer readiness or repeat acceptance', () => {
  const menu = 'Accessing workspace:\n❯ No, exit\n  Yes, I trust this folder\nEnter to confirm · Esc to cancel';
  const seen = new Set();
  assert.deepEqual(startup.startupAction(menu, seen, 0), { ready: false, id: 'trust-navigation', data: '\x1b[F' });
  const yes = menu.replace('❯ No, exit\n  Yes', '  No, exit\n❯ Yes');
  assert.deepEqual(startup.startupAction(yes, seen, 100), { ready: false });
  assert.deepEqual(startup.startupAction(menu, seen, 200), { ready: false, id: 'trust-navigation', data: '\x1b[F' });
  assert.deepEqual(startup.startupAction(yes, seen, 300), { ready: false });
  assert.deepEqual(startup.startupAction(yes, seen, 400), { ready: false, id: 'trust', data: '\r' });
  assert.deepEqual(startup.startupAction(menu, seen), { ready: false });
  assert.equal(startup.startupAction('Claude Code\n❯ Try a prompt\n? for shortcuts', seen).ready, true);
  assert.equal(startup.startupAction('model: loading\n› Ask Codex', seen).ready, false);
  const neverYes = new Set();
  for (let i = 0; i < 3; i++) startup.startupAction(menu, neverYes);
  assert.throws(() => startup.startupAction(menu, neverYes), /navigation limit/);
});

test('Codex theme help tip does not block interactive composer readiness', () => {
  const visibleLines = [
    '╭───────────────────────────────────────────────────╮',
    '│ >_ OpenAI Codex (v0.157.1)                        │',
    '│ model:     DeepSeek-Flash high   /model to change │',
    '│ directory: /tmp/dsc-tui-workspace/codex           │',
    '╰───────────────────────────────────────────────────╯',
    'Tip: Use /theme to choose a syntax highlighting theme.',
    '› Ask Codex to do anything',
    'DeepSeek-Flash · Context 100% left'
  ].join('\n');
  const themeMenu = 'Choose a theme for the terminal\n❯ Dark\n  Light';
  const accepted = new Set();
  assert.equal(startupPrompts.hasThemeSelectionPrompt(visibleLines), false);
  assert.equal(startupPrompts.hasThemeSelectionPrompt(themeMenu), true);
  assert.deepEqual(startup.startupAction(visibleLines, accepted), { ready: true });
  assert.equal(accepted.has('theme'), false);
  assert.deepEqual(startup.startupAction(themeMenu, new Set()), { ready: false, id: 'theme', data: '\r' });
});

test('real MCP fixture holds the call until its exact external release and rejects duplicate calls', { timeout: 10000 }, async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'dsc-tui-tool-test-'));
  const hookOutput = path.join(directory, 'events.jsonl');
  const submittedAt = Date.now();
  const child = spawn(process.execPath, ['tests/vscode-smoke/agent-tui-tool.cjs', directory],
    { stdio: ['pipe', 'pipe', 'pipe'] });
  const exited = once(child, 'exit');
  let output = ''; child.stdout.on('data', data => { output += data; }); child.stderr.resume();
  const send = value => child.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...value }) + '\n');
  try {
    await runHook(hookOutput, start);
    send({ id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05' } });
    send({ id: 2, method: 'tools/list' });
    await runHook(hookOutput, pre);
    send({ id: 3, method: 'tools/call', params: { name: 'wait_for_release', arguments: {} } });
    let started;
    for (let i = 0; i < 100 && !started; i++) {
      try { started = JSON.parse(await fs.readFile(path.join(directory, 'tool-start.json'), 'utf8')); }
      catch (e) { if (e.code !== 'ENOENT') throw e; }
      if (!started) await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert(started, 'Real tool never started');
    await new Promise(resolve => setTimeout(resolve, 100));
    assert(!parseEvents(output).some(message => message.id === 3), 'Held tool returned without release');
    const file = path.join(directory, 'release.json');
    await fs.writeFile(file + '.pending', JSON.stringify({ callId: started.callId }));
    await fs.rename(file + '.pending', file);
    let ended;
    for (let i = 0; i < 100 && !ended; i++) {
      ended = parseEvents(output).find(message => message.id === 3);
      if (!ended) await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert(ended, 'Released tool did not return');
    const result = JSON.parse(await fs.readFile(path.join(directory, 'tool-end.json'), 'utf8'));
    assert.equal(result.callId, started.callId);
    assert.equal(ended.result.content[0].text, result.receipt);
    assert.match(result.receipt, /^receipt_[a-f0-9]{32}$/);
    await runHook(hookOutput, { ...post, tool_response: ended.result });
    await runHook(hookOutput, { ...stop, last_assistant_message: '工具执行完成。' });
    const turn = observeTurn(parseEvents(await fs.readFile(hookOutput, 'utf8')),
      { ...input, submittedAt, toolStart: started, toolEnd: result });
    assert.equal(turn.answer, '工具执行完成。');
    assert.equal(turn.toolUseId, pre.tool_use_id);
    send({ id: 4, method: 'tools/call', params: { name: 'wait_for_release', arguments: {} } });
    assert.equal((await exited)[0], 1, 'Duplicate tool invocation must fail');
  } finally {
    if (child.exitCode === null && child.signalCode === null) { child.kill(); await exited; }
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('hook executable records only observed fields and returns no continuation', { timeout: 5000 }, async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'dsc-tui-hook-test-'));
  const output = path.join(directory, 'events.jsonl');
  const child = spawn(process.execPath, ['tests/vscode-smoke/agent-tui-hook.cjs', output]);
  let stdout = ''; child.stdout.on('data', data => { stdout += data; }); child.stderr.resume();
  const exited = once(child, 'exit');
  child.stdin.end(JSON.stringify({ ...stop, unneededSecret: 'not-an-artifact-field' }));
  try {
    assert.equal((await exited)[0], 0);
    assert.deepEqual(JSON.parse(stdout), {});
    const [observed] = parseEvents(await fs.readFile(output, 'utf8'));
    assert.equal(observed.last_assistant_message, stop.last_assistant_message);
    assert.equal(observed.session_id, stop.session_id);
    assert.equal(observed.turn_id, stop.turn_id);
    assert(!Object.hasOwn(observed, 'unneededSecret'));
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});

test('hook preserves fixture tool observations without persisting unrelated tool contents', { timeout: 5000 }, async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'dsc-tui-tool-hook-test-'));
  const output = path.join(directory, 'events.jsonl');
  try {
    for (const event of [pre, post, { ...post, tool_response: post.tool_response.content },
      { ...post, tool_name: 'other', tool_input: { secret: 'private' }, tool_response: 'private' }]) {
      await runHook(output, { ...event, unneededSecret: 'private' });
    }
    const observed = parseEvents(await fs.readFile(output, 'utf8'));
    for (const [index, event] of [pre, post, { ...post, tool_response: post.tool_response.content }].entries()) {
      assert.equal(observed[index].tool_name, event.tool_name);
      assert.equal(observed[index].tool_use_id, event.tool_use_id);
      assert.deepEqual(observed[index].tool_input, event.tool_input);
      assert.deepEqual(observed[index].tool_response, event.tool_response);
    }
    assert.equal(observed[3].tool_name, 'other');
    assert(!Object.hasOwn(observed[3], 'tool_input'));
    assert(!Object.hasOwn(observed[3], 'tool_response'));
    assert(observed.every(event => !Object.hasOwn(event, 'unneededSecret')));
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});


test('private Host contains provider cwd values, excludes credentials and retires all owned paths', { skip: process.platform !== 'linux' }, async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'dsc-tui-config-test-'));
  const cliRoot = path.join(directory, 'cli');
  const bin = path.join(cliRoot, 'node_modules/.bin');
  await fs.mkdir(bin, { recursive: true });
  await fs.writeFile(path.join(directory, 'CLAUDE.md'), 'Checkout instructions must not reach the private CLI.');
  try {
    for (const [provider, version] of [['codex', 'codex-cli 0.157.1'], ['claude', '2.1.280 (Claude Code)']]) {
      await fs.writeFile(path.join(bin, provider), `#!/bin/sh\nprintf '%s\\n' '${version}'\n`, { mode: 0o700 });
    }
    const suite = await prepareAgentTuiSuite({ scenario: 'agent-tui/input-during-work',
      directory, projectRoot: directory, cliRoot, apiKey: 'configuration-unit-test-only' });
    const config = JSON.parse(await fs.readFile(suite.environment.DEV_SESSION_CANVAS_AGENT_TUI_CONFIG, 'utf8'));
    try {
      assert(path.relative(directory, suite.workspacePath).startsWith(`..${path.sep}`));
      for (const provider of config.configurations) {
        assert.equal(path.dirname(provider.workspace), suite.workspacePath);
        assert.deepEqual(provider.launch, provider.provider === 'codex'
          ? [process.execPath, provider.cli, ...provider.args] : [provider.cli, ...provider.args]);
        assert.deepEqual(await fs.readdir(provider.workspace), []);
        const hooksFile = provider.provider === 'codex'
          ? path.join(provider.environment.CODEX_HOME, 'hooks.json')
          : provider.args[provider.args.indexOf('--settings') + 1];
        const { hooks } = JSON.parse(await fs.readFile(hooksFile, 'utf8'));
        assert(hooks.PreToolUse?.length && hooks.PostToolUse?.length);
        assert.equal(Boolean(hooks.PostToolUseFailure), provider.provider === 'claude');
        for (const event of ['PreToolUse', 'PostToolUse']) {
          assert.equal(hooks[event][0].hooks[0].async, undefined);
          assert.match(hooks[event][0].hooks[0].command, /agent-tui-hook\.cjs/);
        }
        assert(!provider.prompt.includes('containing the exact receipt'));
        for (const key of ['CODEX_HOME', 'CLAUDE_CONFIG_DIR']) {
          assert(path.relative(suite.workspacePath, provider.environment[key]).startsWith(`..${path.sep}`));
        }
      }
      assert.equal(suite.userSettings['devSessionCanvas.agent.codexCommand'], process.execPath);
      assert.equal(suite.environment.DEV_SESSION_CANVAS_TEST_CODEX_COMMAND, process.execPath);
      assert.deepEqual((await fs.readdir(suite.workspacePath)).sort(), ['claude', 'codex']);
    } finally { await suite.dispose(); }
    await assert.rejects(fs.stat(suite.workspacePath), { code: 'ENOENT' });
    for (const provider of config.configurations) {
      for (const key of ['CODEX_HOME', 'CLAUDE_CONFIG_DIR']) {
        await assert.rejects(fs.stat(provider.environment[key]), { code: 'ENOENT' });
      }
    }
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});
