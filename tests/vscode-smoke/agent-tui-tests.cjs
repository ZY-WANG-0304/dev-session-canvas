const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const vscode = require('vscode');
const { activateVisibleExtension, waitForCommand } = require('./test-helpers.cjs');
const { verifyOriginalLocalRetirement } = require('./gate-runtime-state.cjs');
const { parseEvents, observeTurn, answerWithFooter, draftInComposer } = require('./agent-tui-evidence.cjs');
const { startupAction } = require('./agent-tui-startup.cjs');

// Each provider has one absolute ceiling; individual waits never renew it.
const PROVIDER_BUDGET_MS = 240000;
const OBSERVE_MS = 3000;
const command = (name, ...args) => vscode.commands.executeCommand(`devSessionCanvas.__test.${name}`, ...args);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const quote = value => `'${String(value).replaceAll("'", "'\\''")}'`;
module.exports = { run, PROVIDER_BUDGET_MS };

async function run({ gateRecordStep } = {}) {
  const suite = JSON.parse(await fs.readFile(process.env.DEV_SESSION_CANVAS_AGENT_TUI_CONFIG, 'utf8'));
  assert.equal(suite.scenario, process.env.DEV_SESSION_CANVAS_SMOKE_SCENARIO);
  assert.deepEqual(suite.configurations.map(config => config.provider), ['codex', 'claude']);
  await activateVisibleExtension(vscode, 'devsessioncanvas.dev-session-canvas');
  await waitForCommand(vscode, 'devSessionCanvas.__test.getDebugState');
  await vscode.commands.executeCommand('devSessionCanvas.openCanvasInEditor');
  await command('waitForCanvasReady', 'editor', 20000);
  for (const config of suite.configurations) {
    const step = (phase, operation) => gateRecordStep
      ? gateRecordStep({ caseID: suite.scenario, id: `${config.provider}-${phase}`, phase }, operation) : operation();
    await runProvider(config, suite.scenario, step);
  }
}

async function runProvider(config, scenario, step) {
  const deadline = Math.min(Date.now() + PROVIDER_BUDGET_MS,
    Number(process.env.DEV_SESSION_CANVAS_GATE_DEADLINE) || Infinity);
  const report = { provider: config.provider, scenario, samples: [], status: 'not-run' };
  let nodeId, original, submittedAt, toolStart, toolEnd, turn, businessError;
  const state = () => command('getDebugState');
  const node = value => value.state.nodes.find(item => item.id === nodeId);
  const probe = async () => (await command('captureWebviewProbe', 'editor', 5000)).nodes.find(item => item.nodeId === nodeId);
  const dom = data => command('performWebviewDomAction', { kind: 'sendExecutionInput', nodeId, data }, 'editor', 5000);
  const dispatch = (type, payload) => command('dispatchWebviewMessage', { type, payload }, 'editor');
  async function poll(label, read, predicate, timeoutMs) {
    const end = Math.min(deadline, Date.now() + timeoutMs);
    while (Date.now() < end) {
      const value = await read();
      assert(Date.now() <= end, `Late observation: ${label}`);
      if (predicate(value)) return value;
      await sleep(Math.min(100, Math.max(0, end - Date.now())));
    }
    throw new Error(`Timed out: ${label}`);
  }
  async function readJSON(file) {
    try { return JSON.parse(await fs.readFile(path.join(config.directory, file), 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return undefined; throw error; }
  }
  async function releaseTool() {
    const file = path.join(config.directory, 'release.json');
    await fs.writeFile(`${file}.pending`, JSON.stringify({ callId: toolStart.callId }), { flag: 'wx' });
    await fs.rename(`${file}.pending`, file);
  }
  async function events() {
    try { return parseEvents(await fs.readFile(config.events, 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  }
  async function observedTurn() {
    return observeTurn(await events(), { provider: config.provider, prompt: config.prompt,
      workspace: config.workspace, submittedAt, toolStart, toolEnd,
      expectedSessionId: config.provider === 'claude' ? config.sessionId : undefined });
  }
  function checkIdentity(snapshot) {
    assert(node(snapshot)?.metadata.agent.liveSession, 'Original CLI must remain live');
    assert(snapshot.localExecutions.some(record => record.nodeId === nodeId
      && record.identity.executionId === original.identity.executionId
      && record.identity.generation === original.identity.generation), 'Original execution was replaced');
  }
  async function sample(expectedStatus) {
    const snapshot = await state(); checkIdentity(snapshot);
    const page = await probe();
    const observation = { at: Date.now(), status: node(snapshot).status,
      lines: page?.terminalVisibleLines, cols: page?.terminalCols, rows: page?.terminalRows };
    report.samples.push(observation);
    assert.equal(observation.status, expectedStatus, `Product state differs from independent ${expectedStatus} evidence`);
    return page;
  }
  async function observeWindow(expectedStatus) {
    const end = Date.now() + OBSERVE_MS;
    assert(end <= deadline, 'Observation window exceeds original deadline');
    do {
      const observed = await observedTurn();
      assert(observed && observed.completed === (expectedStatus === 'waiting-input'), 'Independent turn condition changed');
      await sample(expectedStatus);
      await sleep(100);
    } while (Date.now() < end);
  }
  try {
    await step('prepare', async () => {
      const before = (await state()).state.nodes.map(item => item.id);
      await command('createNode', 'agent', config.provider, { agentLaunchPreset: 'custom',
        agentCustomLaunchCommand: [config.cli, ...config.args].map(quote).join(' '), cwdOverride: config.workspace });
      const created = await poll('current Agent created', state,
        value => value.state.nodes.filter(item => !before.includes(item.id)).length === 1, 15000);
      nodeId = created.state.nodes.find(item => !before.includes(item.id)).id;
      await dispatch('webview/resizeNode', { nodeId, position: node(created).position, size: { width: 1000, height: 720 } });
      const started = await poll('original local execution started', state,
        value => node(value)?.metadata.agent.liveSession && value.localExecutions.some(item => item.nodeId === nodeId), 20000);
      original = started.localExecutions.find(item => item.nodeId === nodeId);
      assert.equal(node(started).metadata.agent.persistenceMode, 'snapshot-only');
      const seen = new Set();
      await poll('interactive CLI ready', async () => {
        const page = await probe(); const text = page?.terminalVisibleLines?.join('\n') ?? '';
        const action = startupAction(text, seen);
        if (action.data) await dom(action.data);
        return action.ready;
      }, Boolean, 45000);
      submittedAt = Date.now();
      await dom(`\x1b[200~${config.prompt}\x1b[201~`);
      // Fixed CLI paste coalescing must settle before the separate Enter key.
      await sleep(250); await dom('\r');
      toolStart = await poll('real tool waiting', () => readJSON('tool-start.json'), Boolean, 90000);
      const current = await observedTurn(); assert(current && !current.completed, 'Tool must belong to pending turn');
      report.identity = { nodeId, execution: original.identity, sessionId: current.sessionId, toolStart };
      return report.identity;
    });
    await step('action', async () => {
      if (scenario === 'agent-tui/input-during-work') {
        const draft = `DRAFT_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
        await dom(draft);
        await poll('unsubmitted input in real composer', probe,
          page => draftInComposer(page?.terminalVisibleLines ?? [], draft), 5000);
        await observeWindow('running'); await dom('\x15');
      } else if (scenario === 'agent-tui/tool-network-silence') {
        assert.equal(await readJSON('tool-end.json'), undefined, 'Tool already returned before silence window');
        await observeWindow('running');
        assert.equal(await readJSON('tool-end.json'), undefined, 'Tool completed during silence window');
      }
      await releaseTool();
      toolEnd = await poll('real tool result', () => readJSON('tool-end.json'), Boolean, 5000);
      turn = await poll('independent provider completion', observedTurn, value => value?.completed, 90000);
      report.turn = turn; report.toolEnd = toolEnd;
      // Completion and the product's bounded state convergence are distinct.
      await poll('product completed state', state, value => node(value)?.status === 'waiting-input', 5000);
      await poll('actual answer above real footer', probe,
        page => answerWithFooter(page?.terminalVisibleLines ?? [], turn.answer), 8000);
      return { ...turn, toolEnd };
    });
    await step('assert', async () => {
      if (scenario === 'agent-tui/turn-completion-redraw') {
        const before = await probe();
        const diagnostics = await command('getDiagnosticEvents');
        const notifications = list => list.filter(event => event.detail?.nodeId === nodeId
          && ['execution/attentionNotificationPosted', 'execution/attentionNotificationCompanionPosted'].includes(event.kind)).length;
        const count = notifications(diagnostics);
        await dispatch('webview/resizeNode', { nodeId, position: node(await state()).position, size: { width: 880, height: 640 } });
        await poll('real xterm resized', probe, page => page?.terminalCols > 0 && page.terminalCols !== before.terminalCols, 10000);
        await observeWindow('waiting-input');
        assert.equal(notifications(await command('getDiagnosticEvents')), count, 'Redraw repeated completion notification');
      }
      const page = await sample('waiting-input');
      assert(answerWithFooter(page.terminalVisibleLines, turn.answer), 'Full answer or footer disappeared');
      assert.deepEqual(await observedTurn(), turn, 'Completion identity changed');
      report.status = 'passed'; return { answerAndFooter: true, status: 'waiting-input' };
    });
  } catch (error) {
    report.status = 'failed'; report.error = error.message; businessError = error;
    report.failurePage = await probe().catch(() => null);
    report.failureNode = await state().then(node).catch(() => null);
  } finally {
    report.events = await events();
    await fs.writeFile(path.join(config.directory, 'result.json'), JSON.stringify(report, null, 2));
    // Release only this fixture's blocked tool before product Stop. This cannot
    // change the saved business result. The outer Host wrapper verifies cleanup.
    try {
      if (toolStart && !await readJSON('release.json')) await releaseTool();
      if (nodeId && original) {
        await dispatch('webview/stopExecutionSession', { nodeId, kind: 'agent' });
        const retired = await poll('original local retirement', state, value => !node(value)?.metadata.agent.liveSession
          && !value.localExecutions.some(item => item.identity.executionId === original.identity.executionId), 30000);
        report.retirement = verifyOriginalLocalRetirement([original], retired, await command('getDiagnosticEvents'));
      }
    } catch (error) {
      report.cleanupError = error.message; businessError ??= error;
    } finally {
      await fs.writeFile(path.join(config.directory, 'result.json'), JSON.stringify(report, null, 2));
    }
  }
  if (businessError) throw businessError;
}
