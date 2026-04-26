import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

import esbuild from 'esbuild';

const tempDir = await mkdtemp(path.join(os.tmpdir(), 'dsc-agent-launch-presets-'));

try {
  const outfile = path.join(tempDir, 'agentLaunchPresets.cjs');

  await esbuild.build({
    entryPoints: [path.resolve('src/common/agentLaunchPresets.ts')],
    bundle: true,
    format: 'cjs',
    outfile,
    platform: 'node',
    target: 'node18'
  });

  const require = createRequire(import.meta.url);
  const {
    buildAgentPresetCommandLine,
    buildFreshAgentCommandLine,
    classifyAgentLaunchPreset,
    extractClaudeCommandSessionFlag,
    hasAnyCommandLineFlag,
    validateAgentCommandLine
  } = require(outfile);

  const claudeDefaults = {
    command: '/tmp/providers/claude-custom',
    defaultArgs: ''
  };

  const aliasValidation = validateAgentCommandLine(
    'claude --resume=session-123',
    'claude',
    claudeDefaults
  );
  assert.equal(aliasValidation.valid, true);
  assert.equal(aliasValidation.parsed.command, 'claude');
  assert.deepEqual(aliasValidation.parsed.args, ['--resume=session-123']);

  const configuredCommandValidation = validateAgentCommandLine(
    '/tmp/providers/claude-custom --session-id=session-456',
    'claude',
    claudeDefaults
  );
  assert.equal(configuredCommandValidation.valid, true);
  assert.equal(configuredCommandValidation.parsed.command, '/tmp/providers/claude-custom');
  assert.deepEqual(configuredCommandValidation.parsed.args, ['--session-id=session-456']);

  const basenameOnlyPathValidation = validateAgentCommandLine(
    '/tmp/evil/claude --resume=session-456',
    'claude',
    {
      command: '/usr/local/bin/claude',
      defaultArgs: ''
    }
  );
  assert.equal(basenameOnlyPathValidation.valid, false);
  assert.equal(basenameOnlyPathValidation.error, '命令必须以当前 Claude Code 命令或 claude 开头。');

  const invalidProviderValidation = validateAgentCommandLine(
    'node -e "process.stdout.write(\'provider-bypass\')"',
    'claude',
    claudeDefaults
  );
  assert.equal(invalidProviderValidation.valid, false);
  assert.equal(invalidProviderValidation.error, '命令必须以当前 Claude Code 命令或 claude 开头。');

  const windowsCodexValidation = validateAgentCommandLine(
    'C:\\tools\\codex.exe --yolo',
    'codex',
    {
      command: 'C:\\tools\\codex.exe',
      defaultArgs: ''
    }
  );
  assert.equal(windowsCodexValidation.valid, true);
  assert.equal(windowsCodexValidation.parsed.command, 'C:\\tools\\codex.exe');
  assert.deepEqual(windowsCodexValidation.parsed.args, ['--yolo']);

  const quotedWindowsCodexValidation = validateAgentCommandLine(
    '"C:\\Program Files\\Codex\\codex.exe" --yolo',
    'codex',
    {
      command: 'C:\\Program Files\\Codex\\codex.exe',
      defaultArgs: ''
    }
  );
  assert.equal(quotedWindowsCodexValidation.valid, true);
  assert.equal(quotedWindowsCodexValidation.parsed.command, 'C:\\Program Files\\Codex\\codex.exe');
  assert.deepEqual(quotedWindowsCodexValidation.parsed.args, ['--yolo']);

  const windowsPresetCommandLine = buildAgentPresetCommandLine(
    'codex',
    {
      command: 'C:\\Program Files\\Codex\\codex.exe',
      defaultArgs: '--yolo'
    },
    'default'
  );
  assert.equal(windowsPresetCommandLine, '"C:\\Program Files\\Codex\\codex.exe" --yolo');

  assert.throws(
    () =>
      buildAgentPresetCommandLine(
        'codex',
        {
          command: 'codex',
          defaultArgs: '--model "o3'
        },
        'default'
      ),
    /Codex 默认启动参数无法解析：双引号未闭合。/
  );

  const customFreshCommandLine = buildFreshAgentCommandLine(
    'codex',
    'custom',
    'codex --yolo',
    {
      command: 'codex',
      defaultArgs: '--model "o3'
    }
  );
  assert.equal(customFreshCommandLine, 'codex --yolo');

  assert.deepEqual(
    classifyAgentLaunchPreset(
      'codex',
      'codex --yolo',
      {
        command: 'codex',
        defaultArgs: '--model "o3'
      }
    ),
    {
      launchPreset: 'custom',
      customLaunchCommand: 'codex --yolo'
    }
  );

  const explicitClaudeSessionFlags = ['--session-id', '--resume', '--continue'];
  assert.equal(hasAnyCommandLineFlag(['--session-id=session-789'], explicitClaudeSessionFlags), true);
  assert.equal(hasAnyCommandLineFlag(['--resume=session-789'], explicitClaudeSessionFlags), true);
  assert.equal(hasAnyCommandLineFlag(['--continue=session-789'], explicitClaudeSessionFlags), true);
  assert.equal(hasAnyCommandLineFlag(['--session-identifier=session-789'], explicitClaudeSessionFlags), false);
  assert.equal(hasAnyCommandLineFlag(['--resumable'], explicitClaudeSessionFlags), false);

  assert.deepEqual(extractClaudeCommandSessionFlag(['--resume=session-123']), {
    flag: '--resume',
    sessionId: 'session-123'
  });
  assert.deepEqual(extractClaudeCommandSessionFlag(['--continue', 'session-456']), {
    flag: '--continue',
    sessionId: 'session-456'
  });
  assert.deepEqual(extractClaudeCommandSessionFlag(['--resume']), {
    flag: '--resume',
    sessionId: undefined
  });
  assert.equal(extractClaudeCommandSessionFlag(['--yolo']), null);

  console.log('agentLaunchPresets tests passed');
} finally {
  await rm(tempDir, { recursive: true, force: true });
}
