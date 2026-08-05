import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

import esbuild from 'esbuild';

const tempDir = await mkdtemp(path.join(os.tmpdir(), 'dsc-agent-provider-lifecycle-'));

try {
  const inputOutfile = path.join(tempDir, 'agentInputIntent.cjs');
  const heuristicOutfile = path.join(tempDir, 'agentActivityHeuristics.cjs');
  const lifecycleOutfile = path.join(tempDir, 'agentProviderLifecycle.cjs');
  const runtimeIntegrationOutfile = path.join(tempDir, 'agentFileActivity.cjs');
  await Promise.all([
    bundle('extensions/vscode/dev-session-canvas/src/common/agentInputIntent.ts', inputOutfile),
    bundle('extensions/vscode/dev-session-canvas/src/common/agentActivityHeuristics.ts', heuristicOutfile),
    bundle('extensions/vscode/dev-session-canvas/src/common/agentProviderLifecycle.ts', lifecycleOutfile),
    bundle('extensions/vscode/dev-session-canvas/src/panel/agentFileActivity.ts', runtimeIntegrationOutfile)
  ]);

  const require = createRequire(import.meta.url);
  const { classifyAgentInputData, createAgentInputIntentTracker } = require(inputOutfile);
  const {
    AGENT_WAITING_INPUT_QUIET_FALLBACK_MS,
    createAgentActivityHeuristicState,
    evaluateAgentWaitingInputTransition,
    recordAgentBottomScreenActivity,
    recordAgentInputHeuristics,
    recordAgentOutputHeuristics
  } = require(heuristicOutfile);
  const {
    applyAgentProviderLifecycleEvent,
    consumeAgentInstructionSubmission,
    createAgentProviderLifecycleState,
    isAgentHeuristicWaitingInputRecoverable,
    recordAgentHeuristicRunning,
    recordAgentHeuristicWaitingInput,
    recordAgentAttentionWaitingInput,
    recordAgentSubmission
  } = require(lifecycleOutfile);
  const { createAgentFileActivitySession } = require(runtimeIntegrationOutfile);

  assertInputIntent(classifyAgentInputData, createAgentInputIntentTracker);
  assertLifecycleIdentity(
    applyAgentProviderLifecycleEvent,
    consumeAgentInstructionSubmission,
    createAgentProviderLifecycleState,
    isAgentHeuristicWaitingInputRecoverable,
    recordAgentAttentionWaitingInput,
    recordAgentHeuristicRunning,
    recordAgentHeuristicWaitingInput,
    recordAgentSubmission
  );
  assertHeuristicEnhancementPolicy(
    AGENT_WAITING_INPUT_QUIET_FALLBACK_MS,
    createAgentActivityHeuristicState,
    evaluateAgentWaitingInputTransition,
    recordAgentBottomScreenActivity,
    recordAgentInputHeuristics,
    recordAgentOutputHeuristics
  );
  await assertLaunchIntegration(createAgentFileActivitySession);

  console.log('agent provider lifecycle tests passed');
} finally {
  await rm(tempDir, { recursive: true, force: true });
}

function bundle(entryPoint, outfile) {
  return esbuild.build({
    entryPoints: [path.resolve(entryPoint)],
    bundle: true,
    format: 'cjs',
    outfile,
    platform: 'node',
    target: 'node18'
  });
}

function assertInputIntent(classifyAgentInputData, createAgentInputIntentTracker) {
  const plainEnter = { type: 'keydown', key: 'Enter', code: 'Enter' };
  assert.equal(classifyAgentInputData('\r', plainEnter), 'submit');
  assert.equal(
    classifyAgentInputData('\r', { type: 'keydown', key: 'Enter', code: 'NumpadEnter' }),
    'submit'
  );
  assert.equal(classifyAgentInputData('\r'), 'submit');
  assert.equal(classifyAgentInputData('\n'), 'submit');
  assert.equal(classifyAgentInputData('\r\n'), 'submit');
  assert.equal(classifyAgentInputData('\r', { ...plainEnter, shiftKey: true }), 'text');
  assert.equal(classifyAgentInputData('\n', { type: 'keydown', key: 'j', code: 'KeyJ', ctrlKey: true }), 'text');
  assert.equal(classifyAgentInputData('\r', { ...plainEnter, isComposing: true }), 'text');
  assert.equal(classifyAgentInputData('\r', { ...plainEnter, keyCode: 229 }), 'text');
  assert.equal(classifyAgentInputData('first\nsecond'), 'paste');
  assert.equal(classifyAgentInputData('\u001b[200~first\nsecond\u001b[201~'), 'paste');
  assert.equal(
    classifyAgentInputData('\u001b', { type: 'keydown', key: 'Escape', code: 'Escape' }),
    'interrupt'
  );
  assert.equal(classifyAgentInputData('\u001b'), 'text');

  const tracker = createAgentInputIntentTracker();
  tracker.recordKeyEvent(plainEnter);
  assert.equal(tracker.classifyData('\r'), 'submit');
  assert.equal(tracker.classifyData('x'), 'text', 'Key intent must be consumed by exactly one onData event.');
}

function assertLifecycleIdentity(
  applyAgentProviderLifecycleEvent,
  consumeAgentInstructionSubmission,
  createAgentProviderLifecycleState,
  isAgentHeuristicWaitingInputRecoverable,
  recordAgentAttentionWaitingInput,
  recordAgentHeuristicRunning,
  recordAgentHeuristicWaitingInput,
  recordAgentSubmission
) {
  const claudeSubmission = createAgentProviderLifecycleState('claude', true);
  assert.equal(consumeAgentInstructionSubmission(claudeSubmission, '\u001b[A', 'text'), false);
  assert.equal(consumeAgentInstructionSubmission(claudeSubmission, '\r', 'submit'), false);
  assert.equal(consumeAgentInstructionSubmission(claudeSubmission, 'real prompt', 'text'), false);
  assert.equal(consumeAgentInstructionSubmission(claudeSubmission, '\r', 'submit'), true);
  assert.equal(recordAgentSubmission(claudeSubmission).lifecycle, 'running');
  assert.equal(claudeSubmission.activitySource, 'submission-intent');
  assert.equal(
    applyAgentProviderLifecycleEvent(
      claudeSubmission,
      claudeEvent('turn-started', 'submission-session', 'submission-prompt')
    ).lifecycle,
    'running'
  );
  assert.equal(recordAgentHeuristicWaitingInput(claudeSubmission).lifecycle, 'waiting-input');
  assert.equal(claudeSubmission.activitySource, 'heuristic');
  assert.equal(
    applyAgentProviderLifecycleEvent(
      claudeSubmission,
      claudeEvent('turn-completed', 'submission-session', 'submission-prompt')
    ).lifecycle,
    'waiting-input'
  );
  assert.equal(claudeSubmission.activitySource, 'provider-lifecycle');
  assert.equal(claudeSubmission.lastTurnOutcome, 'completed');

  const claude = createAgentProviderLifecycleState('claude', true);
  assert.deepEqual(
    applyAgentProviderLifecycleEvent(claude, claudeEvent('turn-started', 'session-a', 'prompt-1')),
    { accepted: true, changed: true, reason: 'accepted', lifecycle: 'running' }
  );
  assert.equal(
    applyAgentProviderLifecycleEvent(claude, claudeEvent('turn-completed', 'session-a', 'prompt-old')).reason,
    'stale-turn'
  );
  assert.equal(
    applyAgentProviderLifecycleEvent(claude, {
      ...claudeEvent('turn-failed', 'session-a', 'prompt-1'),
      error: 'API unavailable'
    }).lifecycle,
    'waiting-input'
  );
  assert.equal(claude.lastTurnOutcome, 'failed');
  assert.equal(claude.lastTurnError, 'API unavailable');
  const duplicateStop = applyAgentProviderLifecycleEvent(
    claude,
    claudeEvent('turn-completed', 'session-a', 'prompt-1')
  );
  assert.equal(duplicateStop.reason, 'duplicate');
  assert.equal(claude.lastTurnOutcome, 'failed', 'Duplicate Stop must not erase StopFailure outcome.');
  applyAgentProviderLifecycleEvent(claude, claudeEvent('turn-started', 'session-a', 'prompt-2'));
  assert.equal(
    applyAgentProviderLifecycleEvent(claude, claudeEvent('turn-completed', 'session-a', 'prompt-1')).reason,
    'stale-turn'
  );
  assert.equal(
    applyAgentProviderLifecycleEvent(claude, claudeEvent('turn-completed', 'session-b', 'prompt-2')).reason,
    'provider-session-mismatch'
  );

  const delayedClaude = createAgentProviderLifecycleState('claude', true);
  recordAgentSubmission(delayedClaude, 2_000);
  assert.equal(
    applyAgentProviderLifecycleEvent(delayedClaude, {
      ...claudeEvent('turn-started', 'delayed-session', 'previous-prompt'),
      observedAtMs: 1_900
    }).reason,
    'stale-turn',
    'A delayed previous UserPromptSubmit must not claim the current derived turn.'
  );
  assert.equal(delayedClaude.activeProviderTurnId, undefined);
  assert.equal(
    applyAgentProviderLifecycleEvent(delayedClaude, {
      ...claudeEvent('turn-started', 'delayed-session', 'current-prompt'),
      observedAtMs: 2_100
    }).lifecycle,
    'running'
  );
  assert.equal(
    applyAgentProviderLifecycleEvent(
      delayedClaude,
      claudeEvent('turn-completed', 'delayed-session', 'previous-prompt')
    ).reason,
    'stale-turn',
    'A delayed previous Stop must not finish the current turn.'
  );

  const codex = createAgentProviderLifecycleState('codex', true);
  assert.equal(consumeAgentInstructionSubmission(codex, '\u001b[A', 'text'), false);
  assert.equal(consumeAgentInstructionSubmission(codex, '\u001bOP', 'text'), false);
  assert.equal(consumeAgentInstructionSubmission(codex, '\u001bx', 'text'), false);
  assert.equal(
    consumeAgentInstructionSubmission(codex, '\u001b]10;rgb:cccc/cccc/cccc\u001b\\', 'text'),
    false
  );
  assert.equal(
    consumeAgentInstructionSubmission(codex, '\r', 'submit'),
    false,
    'Navigation-only menus must not arm a Codex instruction submission.'
  );
  assert.equal(consumeAgentInstructionSubmission(codex, 'real prompt', 'text'), false);
  assert.equal(
    consumeAgentInstructionSubmission(codex, '\r', 'text'),
    false,
    'An editing newline must not consume the submission candidate.'
  );
  assert.equal(consumeAgentInstructionSubmission(codex, '\r', 'submit'), true);
  assert.equal(consumeAgentInstructionSubmission(codex, '\r', 'submit'), false);
  assert.equal(
    consumeAgentInstructionSubmission(codex, '\u001b[200~pasted prompt\u001b[201~', 'paste'),
    false
  );
  assert.equal(
    consumeAgentInstructionSubmission(codex, '\r', 'submit'),
    true,
    'Bracketed paste must arm a later explicit submission.'
  );
  assert.equal(consumeAgentInstructionSubmission(codex, '\u4f60\u597d', 'text'), false);
  assert.equal(
    consumeAgentInstructionSubmission(codex, '\r', 'submit'),
    true,
    'Committed IME text must arm a later explicit submission.'
  );
  assert.equal(consumeAgentInstructionSubmission(codex, 'draft', 'text'), false);
  assert.equal(consumeAgentInstructionSubmission(codex, '\u001b', 'interrupt'), false);
  assert.equal(
    consumeAgentInstructionSubmission(codex, '\r', 'submit'),
    false,
    'Interrupt must clear an unsubmitted Codex prompt candidate.'
  );
  assert.equal(
    consumeAgentInstructionSubmission(codex, 'legacy prompt\r'),
    true,
    'Legacy clients may send editable text and CR in one chunk.'
  );
  assert.equal(consumeAgentInstructionSubmission(codex, '   ', 'text'), false);
  assert.equal(consumeAgentInstructionSubmission(codex, '\r', 'submit'), false);
  assert.equal(recordAgentSubmission(codex).lifecycle, 'running');
  assert.equal(recordAgentHeuristicWaitingInput(codex).lifecycle, 'waiting-input');
  assert.equal(codex.activitySource, 'heuristic');
  assert.equal(codex.turnActive, true, 'Heuristic completion must retain delayed callback correlation.');
  assert.equal(isAgentHeuristicWaitingInputRecoverable(codex), true);
  assert.equal(recordAgentHeuristicRunning(codex).lifecycle, 'running');
  const completed = {
    provider: 'codex',
    kind: 'turn-completed',
    providerSessionId: 'thread-a',
    providerTurnId: 'turn-1'
  };
  assert.equal(applyAgentProviderLifecycleEvent(codex, completed).lifecycle, 'waiting-input');
  assert.equal(isAgentHeuristicWaitingInputRecoverable(codex), false);
  assert.equal(
    recordAgentHeuristicRunning(codex).accepted,
    false,
    'Terminal chrome must not reopen a provider-authoritative completion.'
  );
  assert.equal(applyAgentProviderLifecycleEvent(codex, completed).reason, 'duplicate');
  recordAgentSubmission(codex);
  assert.equal(
    applyAgentProviderLifecycleEvent(codex, {
      ...completed,
      providerTurnId: 'turn-delayed',
      observedAtMs: Date.now() - 60_000
    }).reason,
    'stale-turn',
    'A Codex completion emitted before the current submission must not end the current turn.'
  );
  assert.equal(
    applyAgentProviderLifecycleEvent(codex, { ...completed, providerSessionId: 'thread-b', providerTurnId: 'turn-2' }).reason,
    'provider-session-mismatch'
  );

  const nonInvasiveTurn = createAgentProviderLifecycleState('codex', false);
  recordAgentSubmission(nonInvasiveTurn, 100);
  assert.equal(recordAgentAttentionWaitingInput(nonInvasiveTurn).lifecycle, 'waiting-input');
  assert.equal(nonInvasiveTurn.activitySource, 'attention');
  assert.equal(isAgentHeuristicWaitingInputRecoverable(nonInvasiveTurn), true);
  assert.equal(recordAgentHeuristicRunning(nonInvasiveTurn, 'terminal-title').lifecycle, 'running');
  assert.equal(nonInvasiveTurn.activitySource, 'terminal-title');

  const interruptedTurn = createAgentProviderLifecycleState('claude', false);
  recordAgentSubmission(interruptedTurn, 100);
  interruptedTurn.interruptRequested = true;
  assert.equal(
    recordAgentAttentionWaitingInput(interruptedTurn).accepted,
    false,
    'Attention must not reopen or reclassify a confirmed interrupt.'
  );
}

function assertHeuristicEnhancementPolicy(
  quietFallbackMs,
  createAgentActivityHeuristicState,
  evaluateAgentWaitingInputTransition,
  recordAgentBottomScreenActivity,
  recordAgentInputHeuristics,
  recordAgentOutputHeuristics
) {
  assert.equal(quietFallbackMs, 5000, 'The quiet fallback must match the experiment-backed policy.');

  const silentFromSubmit = createAgentActivityHeuristicState();
  silentFromSubmit.lastActivityAtMs = 100;
  assert.deepEqual(evaluateAgentWaitingInputTransition(silentFromSubmit, 5099), {
    shouldTransition: false,
    shouldKeepPolling: true
  });
  assert.equal(
    evaluateAgentWaitingInputTransition(silentFromSubmit, 5100).reason,
    'fallback',
    'A completely silent turn must fall back from its submission time.'
  );

  const outputQuiet = createAgentActivityHeuristicState();
  outputQuiet.lastActivityAtMs = 100;
  recordAgentOutputHeuristics(outputQuiet, 'working\r\n', 'working\r\n', 'claude', 1000);
  assert.deepEqual(evaluateAgentWaitingInputTransition(outputQuiet, 5999), {
    shouldTransition: false,
    shouldKeepPolling: true
  });
  assert.equal(evaluateAgentWaitingInputTransition(outputQuiet, 6000).reason, 'fallback');

  const glyphIsOrdinaryOutput = createAgentActivityHeuristicState();
  glyphIsOrdinaryOutput.lastActivityAtMs = 100;
  recordAgentOutputHeuristics(glyphIsOrdinaryOutput, '> ', 'working\r\n> ', 'claude', 2000);
  assert.deepEqual(
    evaluateAgentWaitingInputTransition(glyphIsOrdinaryOutput, 2300),
    { shouldTransition: false, shouldKeepPolling: true },
    'A prompt glyph must not carry lifecycle meaning.'
  );

  const attentionIsOrdinaryOutput = createAgentActivityHeuristicState();
  attentionIsOrdinaryOutput.lastActivityAtMs = 100;
  recordAgentOutputHeuristics(
    attentionIsOrdinaryOutput,
    '\u001b]9;finished\u0007',
    '\u001b]9;finished\u0007',
    'codex',
    2000
  );
  assert.deepEqual(
    evaluateAgentWaitingInputTransition(attentionIsOrdinaryOutput, 2300),
    { shouldTransition: false, shouldKeepPolling: true },
    'Generic OSC/BEL attention must not finish a turn.'
  );

  const animatedBottom = createAgentActivityHeuristicState();
  animatedBottom.lastActivityAtMs = 0;
  assert.equal(recordAgentBottomScreenActivity(animatedBottom, 'frame-0', 4500).strongRunningEvidence, false);
  assert.equal(recordAgentBottomScreenActivity(animatedBottom, 'frame-1', 4800).strongRunningEvidence, false);
  assert.equal(recordAgentBottomScreenActivity(animatedBottom, 'frame-2', 4920).strongRunningEvidence, true);
  assert.equal(
    evaluateAgentWaitingInputTransition(animatedBottom, 5000).reason,
    'fallback',
    'Bottom activity is recovery evidence after weak waiting, not a second gate on the quiet fallback.'
  );

  const composerEcho = createAgentActivityHeuristicState();
  recordAgentBottomScreenActivity(composerEcho, 'idle', 900);
  recordAgentInputHeuristics(composerEcho, 1000);
  assert.equal(recordAgentBottomScreenActivity(composerEcho, 'typed-a', 1100).strongRunningEvidence, false);
  assert.equal(
    recordAgentBottomScreenActivity(composerEcho, 'typed-ab', 1200).strongRunningEvidence,
    false,
    'Screen redraws close to user input must not be strong autonomous-running evidence.'
  );
}

async function assertLaunchIntegration(createAgentFileActivitySession) {
  const storageRootPath = path.join(tempDir, 'runtime-integrations');
  for (const provider of ['codex', 'claude']) {
    const session = createAgentFileActivitySession({
      provider,
      command: provider,
      extensionRootPath: path.join(tempDir, 'unused-extension-root'),
      storageRootPath,
      fileActivityEnabled: false
    });
    const args = ['--settings', 'user-settings.json', '--safe-mode'];
    const env = { CLAUDE_CODE_SAFE_MODE: '1', CODEX_HOME: path.join(tempDir, 'codex-home') };
    assert.deepEqual(
      session.configureLaunch(args, env, tempDir),
      args,
      `${provider} argv must remain byte-for-byte unchanged when file activity is disabled.`
    );
    assert.deepEqual(
      env,
      { CLAUDE_CODE_SAFE_MODE: '1', CODEX_HOME: path.join(tempDir, 'codex-home') },
      `${provider} environment must remain unchanged.`
    );
    await session.dispose();
  }

  const fake = createAgentFileActivitySession({
    provider: 'codex',
    command: 'fake-codex-provider',
    extensionRootPath: path.join(tempDir, 'unused-extension-root'),
    storageRootPath,
    fileActivityEnabled: true
  });
  const fakeEnv = {};
  assert.deepEqual(fake.configureLaunch(['resume', 'session-1'], fakeEnv, tempDir), ['resume', 'session-1']);
  assert.equal(typeof fakeEnv.DEV_SESSION_CANVAS_FAKE_AGENT_FILE_EVENT_STREAM_PATH, 'string');
  await fake.dispose();

  const source = await readFile('extensions/vscode/dev-session-canvas/src/panel/agentFileActivity.ts', 'utf8');
  assert.doesNotMatch(source, /notify=/u, 'Agent launch integration must not inject Codex notify.');
  assert.doesNotMatch(source, /UserPromptSubmit|StopFailure/u, 'Agent launch integration must not inject lifecycle hooks.');
  assert.doesNotMatch(source, /claude-runtime-settings/u, 'Agent launch integration must not create lifecycle settings.');

  const userSettingsPath = path.join(tempDir, 'claude-file-activity-user-settings.json');
  await writeFile(userSettingsPath, JSON.stringify({ marker: 'user-settings' }), 'utf8');
  const claudeFileActivity = createAgentFileActivitySession({
    provider: 'claude',
    command: 'claude',
    extensionRootPath: path.resolve('extensions/vscode/dev-session-canvas'),
    storageRootPath,
    fileActivityEnabled: true
  });
  const claudeFileActivityEnv = {};
  const claudeFileActivityArgs = claudeFileActivity.configureLaunch(
    ['--settings', userSettingsPath],
    claudeFileActivityEnv,
    tempDir
  );
  const generatedSettings = JSON.parse(await readFile(claudeFileActivityArgs.at(-1), 'utf8'));
  assert.equal(generatedSettings.marker, 'user-settings');
  assert.equal(generatedSettings.hooks.PostToolUse.length, 1);
  assert.equal(generatedSettings.hooks.UserPromptSubmit, undefined);
  assert.equal(generatedSettings.hooks.Stop, undefined);
  assert.equal(generatedSettings.hooks.StopFailure, undefined);
  assert.equal(typeof claudeFileActivityEnv.DEV_SESSION_CANVAS_AGENT_FILE_EVENT_STREAM_PATH, 'string');
  await claudeFileActivity.dispose();

  const claudeSafeFileActivity = createAgentFileActivitySession({
    provider: 'claude',
    command: 'claude',
    extensionRootPath: path.resolve('extensions/vscode/dev-session-canvas'),
    storageRootPath,
    fileActivityEnabled: true
  });
  const claudeSafeFileActivityEnv = { CLAUDE_CODE_SAFE_MODE: '1' };
  assert.deepEqual(
    claudeSafeFileActivity.configureLaunch(['resume', 'session-1'], claudeSafeFileActivityEnv, tempDir),
    ['resume', 'session-1'],
    'File-activity settings must not be injected when Claude disables hooks through its environment.'
  );
  assert.deepEqual(claudeSafeFileActivityEnv, { CLAUDE_CODE_SAFE_MODE: '1' });
  await claudeSafeFileActivity.dispose();

  const [panelSource, supervisorSource] = await Promise.all([
    readFile('extensions/vscode/dev-session-canvas/src/panel/CanvasPanelManager.ts', 'utf8'),
    readFile('extensions/vscode/dev-session-canvas/src/supervisor/runtimeSupervisorMain.ts', 'utf8')
  ]);
  assert.doesNotMatch(panelSource, /createAgentProviderLifecycleSession/u);
  assert.doesNotMatch(supervisorSource, /createAgentProviderLifecycleSession/u);
  assert.match(
    panelSource,
    /recordAgentOutputHeuristics\(\s*state,\s*chunk,\s*session\.buffer,\s*providerForAbnormalTextNotifications,\s*undefined,\s*session\.agentProvider\s*\)/u,
    'Local title activity must retain the Agent provider even when abnormal-output text notifications are disabled.'
  );
}

function claudeEvent(kind, providerSessionId, providerTurnId) {
  return { provider: 'claude', kind, providerSessionId, providerTurnId };
}
