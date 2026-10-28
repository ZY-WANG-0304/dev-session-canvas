import assert from 'node:assert/strict';
import { test } from 'node:test';
import evidence from '../../tests/vscode-smoke/agent-tui-evidence.cjs';
import startup from '../../tests/vscode-smoke/agent-tui-startup.cjs';
const { parseEvents, observeTurn, answerWithFooter, draftInComposer } = evidence;
const receipt = 'receipt_' + 'a'.repeat(32);
const input = { provider: 'codex', prompt: 'Call the tool', workspace: '/private', submittedAt: 1,
  toolStart: { callId: 'call', startedAt: 3 }, toolEnd: { callId: 'call', completedAt: 4, receipt } };
const start = { hook_event_name: 'UserPromptSubmit', prompt: input.prompt, cwd: input.workspace,
  session_id: 'session', observedAt: 2 };
const stop = { hook_event_name: 'Stop', cwd: input.workspace, session_id: 'session', turn_id: 'turn',
  observedAt: 5, stop_hook_active: false, last_assistant_message: `Here is your ${receipt}.` };
test('current completed answer is independently identified; pending is distinct', () => {
  assert.equal(observeTurn([start], input).completed, false);
  assert.equal(observeTurn([start, stop], input).answer, stop.last_assistant_message);
  assert.equal(observeTurn([], input), undefined);
});
test('reject stale prompt, session, turn, failure, premature and duplicate completions', () => {
  for (const events of [[stop], [{ ...start, prompt: 'old' }, stop], [start, { ...stop, session_id: 'old' }],
    [start, { ...stop, turn_id: undefined }], [start, { ...stop, stop_hook_active: true }],
    [start, { ...stop, observedAt: 3 }], [start, { ...stop, last_assistant_message: input.prompt }],
    [start, stop, stop], [start, start, stop], [start, { ...stop, hook_event_name: 'StopFailure' }]]) {
    assert.throws(() => observeTurn(events, input));
  }
  assert.throws(() => observeTurn([start, stop], { ...input, toolEnd: undefined }));
  assert.throws(() => observeTurn([start, stop], { ...input, toolEnd: { ...input.toolEnd, callId: 'old' } }));
  assert.throws(() => observeTurn([start, stop], { ...input, submittedAt: 10 }));
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
  const menu = 'Welcome to Claude Code\n❯ No, exit\n  Yes, I trust this folder\nEnter to confirm';
  const seen = new Set();
  assert.deepEqual(startup.startupAction(menu, seen), { ready: false, id: 'trust', data: '\x1b[B\r' });
  assert.deepEqual(startup.startupAction(menu, seen), { ready: false });
  assert.equal(startup.startupAction('Claude Code\n❯ Try a prompt\n? for shortcuts', seen).ready, true);
  assert.equal(startup.startupAction('model: loading\n› Ask Codex', seen).ready, false);
});
