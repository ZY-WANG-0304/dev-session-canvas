const assert = require('node:assert/strict');
const markdown = require('markdown-it')({ html: false });

function parseEvents(text) {
  // Ignore only the final incomplete append, never a malformed complete record.
  return text.slice(0, text.lastIndexOf('\n') + 1).split('\n').filter(Boolean).map(JSON.parse);
}

function observeTurn(events, { provider, prompt, workspace, submittedAt, toolStart, toolEnd, expectedSessionId }) {
  const starts = events.filter(event => event.hook_event_name === 'UserPromptSubmit');
  assert(starts.length <= 1, 'Unexpected extra submitted turn or hook continuation');
  if (!starts.length) {
    assert(!events.some(event => event.hook_event_name === 'Stop'), 'Completion without current prompt');
    return undefined;
  }
  const start = starts[0];
  assert.equal(events[0], start, 'Provider event before current prompt');
  assert.equal(start.prompt, prompt, 'Provider observed another prompt');
  assert.equal(start.cwd, workspace, 'Provider observed another workspace');
  assert(start.session_id && start.observedAt >= submittedAt, 'Stale or missing session identity');
  if (expectedSessionId) assert.equal(start.session_id, expectedSessionId, 'Unexpected private CLI session');
  if (provider === 'codex') assert(typeof start.turn_id === 'string' && start.turn_id,
    'Codex submission requires its actual turn id');
  const scoped = events.slice(events.indexOf(start));
  for (const [index, event] of scoped.entries()) {
    assert.equal(event.session_id, start.session_id, 'Cross-session provider event');
    assert.equal(event.cwd, workspace, 'Cross-workspace provider event');
    assert(Number.isSafeInteger(event.observedAt) && event.observedAt >= (scoped[index - 1]?.observedAt ?? submittedAt),
      'Provider observer ordering changed');
    if (provider === 'codex') {
      assert.equal(event.turn_id, start.turn_id, 'Cross-turn provider event');
    }
    assert(!['StopFailure', 'SessionEnd', 'Interrupt', 'PostToolUseFailure'].includes(event.hook_event_name),
      'Provider failed or exited during turn');
  }
  const before = scoped.filter(event => event.hook_event_name === 'PreToolUse');
  const after = scoped.filter(event => event.hook_event_name === 'PostToolUse');
  assert(before.length <= 1 && after.length <= 1, 'Unexpected extra tool invocation or reception');
  for (const event of [...before, ...after]) {
    assert.equal(event.tool_name, 'mcp__tui__wait_for_release', 'Unexpected tool');
    assert(typeof event.tool_use_id === 'string' && event.tool_use_id.trim(), 'Missing CLI tool call identity');
    assert.deepEqual(event.tool_input, {}, 'Unexpected tool arguments');
  }
  if (after.length) {
    assert(before.length && scoped.indexOf(before[0]) < scoped.indexOf(after[0]), 'Tool reception before invocation');
    assert.equal(after[0].tool_use_id, before[0].tool_use_id, 'Cross-call tool reception');
  }
  const stops = scoped.filter(event => event.hook_event_name === 'Stop');
  assert(stops.length <= 1, 'Duplicate completion');
  if (!stops.length) return { sessionId: start.session_id, completed: false };
  const stop = stops[0];
  assert.equal(scoped.at(-1), stop, 'Provider event after completion');
  assert.equal(stop.stop_hook_active, false, 'Continuation is not the requested single turn');
  assert.equal(before.length, 1, 'Completion without CLI tool invocation');
  assert.equal(after.length, 1, 'Completion without CLI tool reception');
  assert(toolStart && toolEnd, 'Completion before tool result');
  assert(typeof toolStart.callId === 'string' && toolStart.callId, 'Missing fixture tool identity');
  assert.equal(toolStart.callId, toolEnd.callId, 'Wrong tool result identity');
  assert(toolStart.startedAt >= before[0].observedAt && toolEnd.completedAt >= toolStart.startedAt
    && after[0].observedAt >= toolEnd.completedAt && stop.observedAt >= after[0].observedAt,
    'Completion violates tool causal order');
  assert(/^receipt_[a-f0-9]{32}$/.test(toolEnd.receipt), 'Missing fresh tool receipt');
  const response = after[0].tool_response;
  const content = provider === 'claude' ? response : response?.content;
  assert(response && (response.isError === undefined || response.isError === false), 'CLI received a tool error');
  assert(Array.isArray(content) && content.length === 1 && content[0]?.type === 'text'
    && content[0].text === toolEnd.receipt, 'CLI did not receive the exact fixture tool result');
  assert(typeof stop.last_assistant_message === 'string' && stop.last_assistant_message.trim(), 'Empty actual answer');
  assert(compact(stop.last_assistant_message) !== compact(prompt), 'Actual answer is input echo');
  assert(!prompt.includes(toolEnd.receipt), 'Tool receipt must not occur in submitted prompt');
  if (provider === 'codex') assert(typeof stop.turn_id === 'string' && stop.turn_id,
    'Codex completion requires its actual turn id');
  if (provider === 'codex') assert.equal(stop.turn_id, start.turn_id, 'Cross-turn completion');
  return { sessionId: start.session_id, turnId: stop.turn_id ?? `prompt@${start.observedAt}`,
    toolUseId: before[0].tool_use_id, completed: true, answer: stop.last_assistant_message, completedAt: stop.observedAt };
}

function compact(value) { return value.replace(/[\s\u200b\u200c\u200d]/gu, ''); }
function renderedAnswer(answer) {
  const tokens = markdown.parseInline(answer, {})[0].children;
  let text = '';
  for (const token of tokens) {
    if (['text', 'code_inline'].includes(token.type)) text += token.content;
    else if (['softbreak', 'hardbreak'].includes(token.type)) text += '\n';
    else if (!['em_open', 'em_close', 'strong_open', 'strong_close'].includes(token.type)) return undefined;
  }
  return text;
}
function answerWithFooter(lines, answer) {
  assert(Array.isArray(lines) && lines.every(line => typeof line === 'string'));
  assert(answer?.trim(), 'Empty actual answer');
  const rendered = renderedAnswer(answer);
  if (!rendered?.trim()) return false;
  const wanted = compact(rendered);
  for (const [index, line] of lines.entries()) {
    const beginning = line.match(/^\s*[•●]\s+(.+)$/u);
    if (!beginning) continue;
    let combined = compact(beginning[1]);
    for (let end = index; end < lines.length; end++) {
      if (end > index) {
        if (/^\s*[›❯>•●](?:\s|$)/u.test(lines[end])) break;
        combined += compact(lines[end]);
      }
      if (combined === wanted && lines.slice(end + 1).some(row => /^\s*[›❯>]\s*/u.test(row))) return true;
      if (!wanted.startsWith(combined)) break;
    }
  }
  return false;
}
function draftInComposer(lines, draft) {
  return lines.some(line => new RegExp(`^\\s*[›❯>]\\s*${draft}\\s*$`, 'u').test(line));
}
module.exports = { parseEvents, observeTurn, answerWithFooter, draftInComposer };
