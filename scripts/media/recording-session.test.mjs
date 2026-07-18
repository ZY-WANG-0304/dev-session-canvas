import assert from 'assert/strict';
import path from 'path';
import test from 'node:test';

import {
  CLAUDE_RECORDING_COMMAND,
  CODEX_RECORDING_COMMAND,
  CODEX_RELEASE_RECORDING_COMMAND,
  FOUR_ROOT_DEFINITIONS,
  buildRealProviderEnvironment,
  buildRecordingChildEnv,
  parseFfmpegProgress,
  waitForFfmpegFirstFrame,
  validateRecordingActions
} from './recording-session.mjs';

test('formal four-root scenario declares four real Codex and Claude Code agents', () => {
  assert.deepEqual(
    FOUR_ROOT_DEFINITIONS.map(({ name, kind, provider, shellPath }) => ({
      name,
      kind,
      provider: provider ?? null,
      shellPath: shellPath ?? null
    })),
    [
      { name: 'payments-api', kind: 'agent', provider: 'codex', shellPath: 'codex' },
      { name: 'storefront', kind: 'agent', provider: 'claude', shellPath: 'claude' },
      { name: 'design-system', kind: 'agent', provider: 'claude', shellPath: 'claude' },
      { name: 'release-tools', kind: 'agent', provider: 'codex', shellPath: 'codex' }
    ]
  );
  assert.match(CODEX_RECORDING_COMMAND, /^codex /u);
  assert.match(CODEX_RECORDING_COMMAND, /check_for_update_on_startup=false/u);
  assert.match(CODEX_RECORDING_COMMAND, /tui\.theme="catppuccin-mocha"/u);
  assert.match(CODEX_RECORDING_COMMAND, /tui\.notifications=\["agent-turn-complete"\]/u);
  assert.match(CODEX_RECORDING_COMMAND, /tui\.notification_method="osc9"/u);
  assert.match(CODEX_RECORDING_COMMAND, /tui\.notification_condition="always"/u);
  assert.match(CODEX_RELEASE_RECORDING_COMMAND, /^codex /u);
  assert.match(CODEX_RELEASE_RECORDING_COMMAND, /check_for_update_on_startup=false/u);
  assert.match(CODEX_RELEASE_RECORDING_COMMAND, /tui\.theme="catppuccin-mocha"/u);
  assert.doesNotMatch(CODEX_RELEASE_RECORDING_COMMAND, /tui\.notifications/u);
  assert.equal(CLAUDE_RECORDING_COMMAND, 'claude --safe-mode');
  assert.ok(FOUR_ROOT_DEFINITIONS.every((definition) =>
    definition.kind !== 'agent' || !definition.customLaunchCommand.includes('fake')
  ));
});

test('formal recording child inherits real config locations without fake PATH or raw secrets', () => {
  const runtimeEnvironment = {
    HOME: '/isolated/home',
    PATH: '/system/bin',
    TERM: 'dumb',
    COLORTERM: '',
    NO_COLOR: '1'
  };
  const realProviderEnvironment = buildRealProviderEnvironment(runtimeEnvironment, {
    homeDir: '/real/home',
    processEnvironment: {
      PATH: '/system/bin',
      ANTHROPIC_API_KEY: 'must-not-reach-vscode'
    }
  });
  const childEnvironment = buildRecordingChildEnv({
    runtimeEnvironment,
    realProviderEnvironment,
    display: ':99',
    scenarioContext: { scenario: 'four-root-attention' },
    providerBinPath: '/debug/provider-bin'
  });

  assert.equal(childEnvironment.HOME, '/isolated/home');
  assert.equal(childEnvironment.CODEX_HOME, path.join('/real/home', '.codex'));
  assert.equal(childEnvironment.CLAUDE_CONFIG_DIR, path.join('/real/home', '.claude'));
  assert.equal(childEnvironment.PATH, '/system/bin');
  assert.equal(childEnvironment.TERM, 'xterm-256color');
  assert.equal(childEnvironment.COLORTERM, 'truecolor');
  assert.equal(childEnvironment.NO_COLOR, undefined);
  assert.equal(childEnvironment.VSCODE_CLI, '1');
  assert.equal(childEnvironment.ANTHROPIC_API_KEY, undefined);
  assert.ok(!childEnvironment.PATH.includes('provider-bin'));
});

test('legacy recording path keeps its fixture wrapper isolated from the formal scenario', () => {
  const childEnvironment = buildRecordingChildEnv({
    runtimeEnvironment: { HOME: '/isolated/home', PATH: '/system/bin' },
    display: ':99',
    scenarioContext: undefined,
    providerBinPath: '/debug/provider-bin'
  });

  assert.equal(
    childEnvironment.PATH,
    `/debug/provider-bin${path.delimiter}/system/bin`
  );
  assert.equal(childEnvironment.CODEX_HOME, undefined);
  assert.equal(childEnvironment.CLAUDE_CONFIG_DIR, undefined);
});

test('record sequence accepts only bounded native input actions', () => {
  const actions = [
    { type: 'wait', ms: 500 },
    { type: 'click', x: 640, y: 320, double: true },
    { type: 'paste', text: 'Review this decision.' },
    { type: 'key', combo: 'Return' },
    { type: 'move', x: 1500, y: 160 }
  ];
  assert.equal(validateRecordingActions(actions), actions);
  assert.throws(() => validateRecordingActions([{ type: 'wait', ms: 10001 }]), /0-10000/u);
  assert.throws(() => validateRecordingActions([{ type: 'dispatch', message: {} }]), /不受支持/u);
});

test('parses complete and partially written ffmpeg progress blocks', () => {
  assert.deepEqual(parseFfmpegProgress(''), { frame: 0, progress: null });
  assert.deepEqual(
    parseFfmpegProgress('frame=0\nprogress=continue\nframe=   1\nout_time=00:00:00.033333\nprogr'),
    { frame: 1, progress: 'continue' }
  );
  assert.deepEqual(
    parseFfmpegProgress('frame=1\nprogress=continue\nframe=12\nprogress=end\n'),
    { frame: 12, progress: 'end' }
  );
});

test('waits for an encoded first frame and fails clearly on timeout or early exit', async () => {
  let clock = 0;
  const progressValues = ['', 'frame=0\nprogress=continue\n', 'frame=1\nprogress=continue\n'];
  const ready = await waitForFfmpegFirstFrame({
    readProgress: async () => progressValues.shift() ?? '',
    isProcessRunning: () => true,
    timeoutMs: 100,
    pollIntervalMs: 10,
    now: () => clock,
    sleep: async (milliseconds) => { clock += milliseconds; }
  });
  assert.equal(ready.frame, 1);

  clock = 0;
  await assert.rejects(
    waitForFfmpegFirstFrame({
      readProgress: async () => 'frame=0\n',
      isProcessRunning: () => true,
      timeoutMs: 20,
      pollIntervalMs: 10,
      now: () => clock,
      sleep: async (milliseconds) => { clock += milliseconds; }
    }),
    /within 20ms/u
  );

  await assert.rejects(
    waitForFfmpegFirstFrame({
      readProgress: async () => '',
      isProcessRunning: () => false,
      timeoutMs: 20,
      now: () => 0,
      sleep: async () => {}
    }),
    /exited before recording/u
  );
});
