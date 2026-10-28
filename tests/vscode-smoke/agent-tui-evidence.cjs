const assert = require('node:assert/strict');

function parseEvents(text) {
  // Ignore only the final incomplete append, never a malformed complete record.
  return text.slice(0, text.lastIndexOf('\n') + 1).split('\n').filter(Boolean).map(JSON.parse);
}

function observeTurn(events, { provider, prompt, workspace, submittedAt, toolStart, toolEnd }) {
  const starts = events.filter(event => event.hook_event_name === 'UserPromptSubmit');
  assert(starts.length <= 1, 'Unexpected extra submitted turn or hook continuation');
  if (!starts.length) {
    assert(!events.some(event => event.hook_event_name === 'Stop'), 'Completion without current prompt');
    return undefined;
  }
  const start = starts[0];
  assert.equal(start.prompt, prompt, 'Provider observed another prompt');
  assert.equal(start.cwd, workspace, 'Provider observed another workspace');
  assert(start.session_id && start.observedAt >= submittedAt, 'Stale or missing session identity');
  const scoped = events.slice(events.indexOf(start));
  for (const event of scoped) {
    assert.equal(event.session_id, start.session_id, 'Cross-session provider event');
    assert.equal(event.cwd, workspace, 'Cross-workspace provider event');
    assert(event.observedAt >= start.observedAt, 'Provider observer ordering changed');
    assert(!['StopFailure', 'SessionEnd', 'Interrupt'].includes(event.hook_event_name), 'Provider failed or exited during turn');
  }
  const stops = scoped.filter(event => event.hook_event_name === 'Stop');
  assert(stops.length <= 1, 'Duplicate completion');
  if (!stops.length) return { sessionId: start.session_id, completed: false };
  const stop = stops[0];
  assert.equal(stop.stop_hook_active, false, 'Continuation is not the requested single turn');
  assert(toolStart && toolEnd, 'Completion before tool result');
  assert.equal(toolStart.callId, toolEnd.callId, 'Wrong tool result identity');
  assert(toolStart.startedAt >= start.observedAt && toolEnd.completedAt >= toolStart.startedAt
    && stop.observedAt >= toolEnd.completedAt, 'Completion violates tool causal order');
  assert(/^receipt_[a-f0-9]{32}$/.test(toolEnd.receipt), 'Missing fresh tool receipt');
  assert(typeof stop.last_assistant_message === 'string'
    && stop.last_assistant_message.includes(toolEnd.receipt), 'Actual answer must contain tool result, not input echo');
  assert(!prompt.includes(toolEnd.receipt), 'Tool receipt must not occur in submitted prompt');
  if (provider === 'codex') assert(typeof stop.turn_id === 'string' && stop.turn_id,
    'Codex completion requires its actual turn id');
  return { sessionId: start.session_id, turnId: stop.turn_id ?? `prompt@${start.observedAt}`,
    completed: true, answer: stop.last_assistant_message, completedAt: stop.observedAt };
}

function compact(value) { return value.replace(/[\s\u200b\u200c\u200d]/gu, ''); }
function answerWithFooter(lines, answer) {
  assert(Array.isArray(lines) && lines.every(line => typeof line === 'string'));
  assert(answer?.trim(), 'Empty actual answer');
  const wanted = compact(answer);
  let combined = '';
  let answerEnd = -1;
  for (let index = 0; index < lines.length; index++) {
    combined += compact(lines[index]);
    if (combined.includes(wanted)) { answerEnd = index; break; }
  }
  if (answerEnd < 0) return false;
  // The input prompt must be below the entire actual answer, not merely a
  // marker visible in a tool call, old scrollback or the submitted prompt.
  return lines.slice(answerEnd + 1).some(line => /^\s*[›❯>]\s*/u.test(line));
}
function draftInComposer(lines, draft) {
  return lines.some(line => new RegExp(`^\\s*[›❯>]\\s*${draft}\\s*$`, 'u').test(line));
}
module.exports = { parseEvents, observeTurn, answerWithFooter, draftInComposer };
