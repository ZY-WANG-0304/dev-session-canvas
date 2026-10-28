import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import evidence from '../../tests/vscode-smoke/agent-tui-evidence.cjs';
import startup from '../../tests/vscode-smoke/agent-tui-startup.cjs';
const { parseEvents, observeTurn, answerWithFooter, draftInComposer } = evidence;
const receipt = 'receipt_' + 'a'.repeat(32);
const input = { provider: 'codex', prompt: 'Call the tool', workspace: '/private', submittedAt: 1,
  toolStart: { callId: 'call', startedAt: 3 }, toolEnd: { callId: 'call', completedAt: 4, receipt } };
const start = { hook_event_name: 'UserPromptSubmit', prompt: input.prompt, cwd: input.workspace,
  session_id: 'session', turn_id: 'turn', observedAt: 2 };
const stop = { hook_event_name: 'Stop', cwd: input.workspace, session_id: 'session', turn_id: 'turn',
  observedAt: 5, stop_hook_active: false, last_assistant_message: `Here is your ${receipt}.` };
test('current completed answer is independently identified; pending is distinct', () => {
  assert.equal(observeTurn([start], input).completed, false);
  assert.equal(observeTurn([start, stop], input).answer, stop.last_assistant_message);
  assert.equal(observeTurn([], input), undefined);
});
test('reject stale prompt, session, turn, failure, premature and duplicate completions', () => {
  for (const events of [[stop], [{ ...start, prompt: 'old' }, stop], [start, { ...stop, session_id: 'old' }],
    [{ ...start, turn_id: undefined }, stop], [start, { ...stop, turn_id: 'other' }],
    [start, { ...stop, turn_id: undefined }], [start, { ...stop, stop_hook_active: true }],
    [start, { ...stop, observedAt: 3 }], [start, { ...stop, last_assistant_message: input.prompt }],
    [start, stop, stop], [start, start, stop], [start, { ...stop, hook_event_name: 'StopFailure' }]]) {
    assert.throws(() => observeTurn(events, input));
  }
  assert.throws(() => observeTurn([start, stop], { ...input, toolEnd: undefined }));
  assert.throws(() => observeTurn([start, stop], { ...input, toolEnd: { ...input.toolEnd, callId: 'old' } }));
  assert.throws(() => observeTurn([start, stop], { ...input, submittedAt: 10 }));
  assert.equal(observeTurn([start, stop], { ...input, provider: 'claude', expectedSessionId: 'session' }).completed, true);
  assert.throws(() => observeTurn([start], { ...input, provider: 'claude', expectedSessionId: 'other' }));
});
test('actual varying answer must be fully present above composer, including folded words', () => {
  assert(answerWithFooter(['• Here is your rec', `eipt_${'a'.repeat(32)}.`, '', '› Ask anything'], stop.last_assistant_message));
  assert(!answerWithFooter(['› Ask anything', stop.last_assistant_message], stop.last_assistant_message));
  assert(!answerWithFooter([receipt, '› Ask anything'], stop.last_assistant_message));
  assert(!answerWithFooter(['Some different response', '›'], stop.last_assistant_message));
  assert(draftInComposer(['• Tool log DRAFT', '❯ DRAFT'], 'DRAFT'));
  assert(!draftInComposer(['• Tool log DRAFT', '❯'], 'DRAFT'));
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

test('real MCP fixture holds the call until its exact external release and rejects duplicate calls', { timeout: 10000 }, async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'dsc-tui-tool-test-'));
  const child = spawn(process.execPath, ['tests/vscode-smoke/agent-tui-tool.cjs', directory],
    { stdio: ['pipe', 'pipe', 'pipe'] });
  const exited = once(child, 'exit');
  let output = ''; child.stdout.on('data', data => { output += data; }); child.stderr.resume();
  const send = value => child.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...value }) + '\n');
  try {
    send({ id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05' } });
    send({ id: 2, method: 'tools/list' });
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
