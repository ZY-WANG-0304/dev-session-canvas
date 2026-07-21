import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

import esbuild from 'esbuild';

const tempDir = await mkdtemp(path.join(os.tmpdir(), 'dsc-agent-provider-lifecycle-'));
const extensionRoot = path.resolve('extensions/vscode/dev-session-canvas');

try {
  const inputOutfile = path.join(tempDir, 'agentInputIntent.cjs');
  const heuristicOutfile = path.join(tempDir, 'agentActivityHeuristics.cjs');
  const lifecycleOutfile = path.join(tempDir, 'agentProviderLifecycle.cjs');
  const serverOutfile = path.join(tempDir, 'agentProviderLifecycleServer.cjs');
  const runtimeIntegrationOutfile = path.join(tempDir, 'agentFileActivity.cjs');
  await Promise.all([
    bundle('extensions/vscode/dev-session-canvas/src/common/agentInputIntent.ts', inputOutfile),
    bundle('extensions/vscode/dev-session-canvas/src/common/agentActivityHeuristics.ts', heuristicOutfile),
    bundle('extensions/vscode/dev-session-canvas/src/common/agentProviderLifecycle.ts', lifecycleOutfile),
    bundle('extensions/vscode/dev-session-canvas/src/panel/agentProviderLifecycleServer.ts', serverOutfile),
    bundle('extensions/vscode/dev-session-canvas/src/panel/agentFileActivity.ts', runtimeIntegrationOutfile)
  ]);

  const require = createRequire(import.meta.url);
  const { classifyAgentInputData, createAgentInputIntentTracker } = require(inputOutfile);
  const {
    createAgentActivityHeuristicState,
    evaluateAgentWaitingInputTransition,
    recordAgentOutputHeuristics
  } = require(heuristicOutfile);
  const {
    applyAgentProviderLifecycleEvent,
    consumeAgentInstructionSubmission,
    createAgentProviderLifecycleState,
    recordAgentHeuristicWaitingInput,
    recordAgentSubmission
  } = require(lifecycleOutfile);
  const { createAgentProviderLifecycleSession } = require(serverOutfile);
  const { createAgentFileActivitySession } = require(runtimeIntegrationOutfile);

  assertInputIntent(classifyAgentInputData, createAgentInputIntentTracker);
  assertLifecycleIdentity(
    applyAgentProviderLifecycleEvent,
    consumeAgentInstructionSubmission,
    createAgentProviderLifecycleState,
    recordAgentHeuristicWaitingInput,
    recordAgentSubmission
  );
  assertHeuristicEnhancementPolicy(
    createAgentActivityHeuristicState,
    evaluateAgentWaitingInputTransition,
    recordAgentOutputHeuristics
  );
  await assertCallbackTransport(createAgentProviderLifecycleSession);
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
  const completed = {
    provider: 'codex',
    kind: 'turn-completed',
    providerSessionId: 'thread-a',
    providerTurnId: 'turn-1'
  };
  assert.equal(applyAgentProviderLifecycleEvent(codex, completed).lifecycle, 'waiting-input');
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
}

function assertHeuristicEnhancementPolicy(
  createAgentActivityHeuristicState,
  evaluateAgentWaitingInputTransition,
  recordAgentOutputHeuristics
) {
  const quietTurn = createAgentActivityHeuristicState();
  recordAgentOutputHeuristics(quietTurn, 'working\r\n', 'working\r\n', 'claude', 100);
  assert.equal(
    evaluateAgentWaitingInputTransition(quietTurn, 1800).reason,
    'fallback',
    'Hard fallback remains available to startup/resume/interrupt recovery callers.'
  );
  assert.deepEqual(
    evaluateAgentWaitingInputTransition(quietTurn, 1800, { allowHardFallback: false }),
    { shouldTransition: false, shouldKeepPolling: true },
    'Ordinary running turns must not finish from quiet time alone.'
  );

  recordAgentOutputHeuristics(quietTurn, '> ', 'working\r\n> ', 'claude', 2000);
  assert.equal(
    evaluateAgentWaitingInputTransition(quietTurn, 2300, { allowHardFallback: false }).reason,
    'prompt',
    'A positive PTY prompt remains a primary waiting-input signal.'
  );
}

async function assertCallbackTransport(createAgentProviderLifecycleSession) {
  const observed = [];
  const rejected = [];
  let delayNextAck = true;
  const session = await createAgentProviderLifecycleSession({
    provider: 'claude',
    runtimeSessionId: 'runtime-session-1',
    onEvent: async (event) => {
      if (delayNextAck) {
        delayNextAck = false;
        await new Promise((resolve) => setTimeout(resolve, 80));
      }
      observed.push(event);
    },
    onRejected: (reason) => rejected.push(reason)
  });
  const hookPath = path.join(extensionRoot, 'scripts', 'runtime', 'agent-lifecycle-hook.cjs');
  const hookEnv = { ...process.env, ...session.extraEnv };
  const ackStartedAt = Date.now();
  await runHook(hookPath, ['claude', 'UserPromptSubmit'], hookEnv, {
    session_id: 'claude-session-1',
    prompt_id: 'prompt-1'
  });
  assert.ok(Date.now() - ackStartedAt >= 60, 'The hook must wait until the owner handler ACKs the event.');
  await runHook(hookPath, ['claude', 'StopFailure'], hookEnv, {
    session_id: 'claude-session-1',
    prompt_id: 'prompt-1',
    error: { message: 'overloaded', status_code: 529 }
  });
  assert.deepEqual(observed.map(({ observedAtMs: _observedAtMs, ...event }) => event), [
    claudeEvent('turn-started', 'claude-session-1', 'prompt-1'),
    {
      ...claudeEvent('turn-failed', 'claude-session-1', 'prompt-1'),
      error: '{"message":"overloaded","status_code":529}'
    }
  ]);

  await runHook(
    hookPath,
    ['claude', 'Stop'],
    { ...hookEnv, DEV_SESSION_CANVAS_AGENT_LIFECYCLE_CALLBACK_NONCE: 'wrong-nonce' },
    { session_id: 'claude-session-1', prompt_id: 'prompt-1' }
  );
  assert.ok(rejected.includes('identity-mismatch'));
  assert.equal(observed.length, 2);
  await runHook(
    hookPath,
    ['claude', 'Stop'],
    { ...hookEnv, DEV_SESSION_CANVAS_AGENT_LIFECYCLE_PROCESS_EPOCH: 'stale-process' },
    { session_id: 'claude-session-1', prompt_id: 'prompt-1' }
  );
  await runHook(
    hookPath,
    ['claude', 'Stop'],
    { ...hookEnv, DEV_SESSION_CANVAS_AGENT_LIFECYCLE_RUNTIME_SESSION_ID: 'stale-runtime' },
    { session_id: 'claude-session-1', prompt_id: 'prompt-1' }
  );
  assert.equal(rejected.filter((reason) => reason === 'identity-mismatch').length, 3);
  assert.equal(observed.length, 2);
  await session.dispose();
}

async function assertLaunchIntegration(createAgentFileActivitySession) {
  const storageRootPath = path.join(tempDir, 'runtime-integrations');
  const extensionRootWithoutLifecycleHook = path.join(tempDir, 'extension-without-lifecycle-hook');
  await mkdir(extensionRootWithoutLifecycleHook, { recursive: true });
  const userSettingsA = path.join(tempDir, 'claude-a.json');
  const userSettingsB = path.join(tempDir, 'claude-b.json');
  await writeFile(userSettingsA, JSON.stringify({ marker: 'A' }), 'utf8');
  await writeFile(
    userSettingsB,
    JSON.stringify({ marker: 'B', hooks: { Stop: [{ hooks: [{ type: 'command', command: 'user-stop' }] }] } }),
    'utf8'
  );

  const claude = createAgentFileActivitySession({
    provider: 'claude',
    command: 'claude',
    extensionRootPath: extensionRoot,
    storageRootPath,
    fileActivityEnabled: true
  });
  const claudeEnv = {};
  const claudeArgs = claude.configureLaunch(
    ['--settings', userSettingsA, '--settings', userSettingsB],
    claudeEnv,
    tempDir
  );
  assert.equal(claude.isProviderLifecycleEnabled(), true);
  assert.equal(claudeArgs.filter((arg) => arg === '--settings').length, 1);
  const generatedSettingsPath = claudeArgs.at(-1);
  const generatedSettings = JSON.parse(await readFile(generatedSettingsPath, 'utf8'));
  assert.equal(generatedSettings.marker, 'B', 'Claude repeated settings must preserve the effective last settings.');
  assert.equal(generatedSettings.hooks.Stop[0].hooks[0].command, 'user-stop');
  assert.equal(generatedSettings.hooks.Stop.length, 2);
  assert.equal(generatedSettings.hooks.UserPromptSubmit.length, 1);
  assert.equal(generatedSettings.hooks.StopFailure.length, 1);
  assert.equal(generatedSettings.hooks.PostToolUse.length, 1);
  assert.ok(claudeEnv.DEV_SESSION_CANVAS_AGENT_FILE_EVENT_STREAM_PATH);
  await claude.dispose();

  for (const [flag, fallbackReason] of [
    ['--safe-mode', 'claude-hooks-disabled-by-safe-mode'],
    ['--bare', 'claude-hooks-disabled-by-bare']
  ]) {
    const hooksDisabledClaude = createAgentFileActivitySession({
      provider: 'claude',
      command: 'claude',
      extensionRootPath: extensionRoot,
      storageRootPath,
      fileActivityEnabled: true
    });
    const originalArgs = [flag, '--settings', userSettingsA];
    const hooksDisabledEnv = {};
    assert.deepEqual(
      hooksDisabledClaude.configureLaunch(originalArgs, hooksDisabledEnv, tempDir),
      originalArgs,
      `${flag} must preserve the Claude launch arguments instead of injecting hooks.`
    );
    assert.equal(hooksDisabledClaude.isProviderLifecycleEnabled(), false);
    assert.equal(hooksDisabledClaude.getProviderLifecycleFallbackReason(), fallbackReason);
    assert.equal(
      hooksDisabledEnv.DEV_SESSION_CANVAS_AGENT_FILE_EVENT_STREAM_PATH,
      undefined,
      `${flag} must not advertise a file activity hook that Claude will skip.`
    );
    await hooksDisabledClaude.dispose();
  }

  for (const [envKey, fallbackReason] of [
    ['CLAUDE_CODE_SAFE_MODE', 'claude-hooks-disabled-by-safe-mode-env'],
    ['CLAUDE_CODE_SIMPLE', 'claude-hooks-disabled-by-simple-mode-env']
  ]) {
    const hooksDisabledClaude = createAgentFileActivitySession({
      provider: 'claude',
      command: 'claude',
      extensionRootPath: extensionRoot,
      storageRootPath,
      fileActivityEnabled: true
    });
    const originalArgs = ['--permission-mode', 'plan'];
    const hooksDisabledEnv = { [envKey]: '1' };
    assert.deepEqual(
      hooksDisabledClaude.configureLaunch(originalArgs, hooksDisabledEnv, tempDir),
      originalArgs,
      `${envKey}=1 must preserve argv instead of injecting hooks.`
    );
    assert.equal(hooksDisabledClaude.isProviderLifecycleEnabled(), false);
    assert.equal(hooksDisabledClaude.getProviderLifecycleFallbackReason(), fallbackReason);
    assert.equal(hooksDisabledEnv.DEV_SESSION_CANVAS_AGENT_FILE_EVENT_STREAM_PATH, undefined);
    assert.equal(hooksDisabledEnv[envKey], '1', `${envKey} must remain inherited by Claude.`);
    await hooksDisabledClaude.dispose();
  }

  const inactiveHooksEnvClaude = createAgentFileActivitySession({
    provider: 'claude',
    command: 'claude',
    extensionRootPath: extensionRoot,
    storageRootPath,
    fileActivityEnabled: false
  });
  const inactiveHooksEnvArgs = inactiveHooksEnvClaude.configureLaunch(
    [],
    { CLAUDE_CODE_SAFE_MODE: '0', CLAUDE_CODE_SIMPLE: '' },
    tempDir
  );
  assert.equal(inactiveHooksEnvClaude.isProviderLifecycleEnabled(), true);
  assert.equal(inactiveHooksEnvArgs.at(-2), '--settings');
  await inactiveHooksEnvClaude.dispose();

  const invalidClaude = createAgentFileActivitySession({
    provider: 'claude',
    command: 'claude',
    extensionRootPath: extensionRoot,
    storageRootPath,
    fileActivityEnabled: false
  });
  assert.deepEqual(
    invalidClaude.configureLaunch(['--settings', 'missing.json'], {}, tempDir),
    ['--settings', 'missing.json']
  );
  assert.equal(invalidClaude.isProviderLifecycleEnabled(), false);
  await invalidClaude.dispose();

  const missingHookClaude = createAgentFileActivitySession({
    provider: 'claude',
    command: 'claude',
    extensionRootPath: extensionRootWithoutLifecycleHook,
    storageRootPath,
    fileActivityEnabled: false
  });
  assert.deepEqual(missingHookClaude.configureLaunch(['--permission-mode', 'plan'], {}, tempDir), [
    '--permission-mode',
    'plan'
  ]);
  assert.equal(missingHookClaude.isProviderLifecycleEnabled(), false);
  assert.equal(missingHookClaude.getProviderLifecycleFallbackReason(), 'agent-lifecycle-hook-missing');
  await missingHookClaude.dispose();

  const codexHome = path.join(tempDir, 'codex-home');
  await mkdir(codexHome, { recursive: true });
  const codex = createAgentFileActivitySession({
    provider: 'codex',
    command: 'codex',
    extensionRootPath: extensionRoot,
    storageRootPath,
    fileActivityEnabled: false
  });
  const codexArgs = codex.configureLaunch([], { CODEX_HOME: codexHome }, tempDir);
  assert.equal(codex.isProviderLifecycleEnabled(), true);
  assert.equal(codexArgs[0], '-c');
  assert.match(codexArgs[1], /^notify=\[/u);

  const missingHookCodex = createAgentFileActivitySession({
    provider: 'codex',
    command: 'codex',
    extensionRootPath: extensionRootWithoutLifecycleHook,
    storageRootPath,
    fileActivityEnabled: false
  });
  assert.deepEqual(
    missingHookCodex.configureLaunch(['--search'], { CODEX_HOME: path.join(tempDir, 'empty') }, tempDir),
    ['--search']
  );
  assert.equal(missingHookCodex.isProviderLifecycleEnabled(), false);
  assert.equal(missingHookCodex.getProviderLifecycleFallbackReason(), 'agent-lifecycle-hook-missing');

  await writeFile(path.join(codexHome, 'config.toml'), 'notify = ["custom-notifier"]\n', 'utf8');
  const conflictingCodex = createAgentFileActivitySession({
    provider: 'codex',
    command: 'codex',
    extensionRootPath: extensionRoot,
    storageRootPath,
    fileActivityEnabled: false
  });
  assert.deepEqual(conflictingCodex.configureLaunch(['--search'], { CODEX_HOME: codexHome }, tempDir), ['--search']);
  assert.equal(conflictingCodex.isProviderLifecycleEnabled(), false);
  assert.equal(conflictingCodex.getProviderLifecycleFallbackReason(), 'codex-user-notify-conflict');
  const cliConflict = createAgentFileActivitySession({
    provider: 'codex',
    command: 'codex',
    extensionRootPath: extensionRoot,
    storageRootPath,
    fileActivityEnabled: false
  });
  assert.deepEqual(
    cliConflict.configureLaunch(['-c', 'notify=["cli-notifier"]'], { CODEX_HOME: path.join(tempDir, 'empty') }, tempDir),
    ['-c', 'notify=["cli-notifier"]']
  );
  assert.equal(cliConflict.getProviderLifecycleFallbackReason(), 'codex-cli-notify-conflict');
}

function claudeEvent(kind, providerSessionId, providerTurnId) {
  return { provider: 'claude', kind, providerSessionId, providerTurnId };
}

function runHook(hookPath, args, env, payload) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [hookPath, ...args], { env, stdio: ['pipe', 'ignore', 'ignore'] });
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Lifecycle hook exited with ${code}.`));
      }
    });
    child.stdin.end(`${JSON.stringify(payload)}\n`);
  });
}
