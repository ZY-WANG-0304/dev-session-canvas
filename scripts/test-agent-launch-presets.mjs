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

  const invalidProviderValidation = validateAgentCommandLine(
    'node -e "process.stdout.write(\'provider-bypass\')"',
    'claude',
    claudeDefaults
  );
  assert.equal(invalidProviderValidation.valid, false);
  assert.equal(invalidProviderValidation.error, '命令必须以当前 Claude Code 命令或 claude 开头。');

  const explicitClaudeSessionFlags = ['--session-id', '--resume', '--continue'];
  assert.equal(hasAnyCommandLineFlag(['--session-id=session-789'], explicitClaudeSessionFlags), true);
  assert.equal(hasAnyCommandLineFlag(['--resume=session-789'], explicitClaudeSessionFlags), true);
  assert.equal(hasAnyCommandLineFlag(['--continue=session-789'], explicitClaudeSessionFlags), true);
  assert.equal(hasAnyCommandLineFlag(['--session-identifier=session-789'], explicitClaudeSessionFlags), false);
  assert.equal(hasAnyCommandLineFlag(['--resumable'], explicitClaudeSessionFlags), false);

  console.log('agentLaunchPresets tests passed');
} finally {
  await rm(tempDir, { recursive: true, force: true });
}
