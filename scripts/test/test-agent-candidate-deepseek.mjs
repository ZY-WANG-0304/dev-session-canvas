import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createDeepSeekConfiguration } from '../smoke/agent-candidate-deepseek.mjs';

const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'dsc-deepseek-config-test-'));
const fakeApiKey = 'fake-deepseek-key-"quoted"\\backslash\t\b\f\x01\x7f';
const configurations = [];

try {
  const first = await createDeepSeekConfiguration({ apiKey: fakeApiKey, temporaryRoot });
  configurations.push(first);
  const second = await createDeepSeekConfiguration({ apiKey: 'fake-second-key', temporaryRoot });
  configurations.push(second);

  assert.notEqual(first.directory, second.directory);
  assert.equal(path.dirname(first.directory), temporaryRoot);
  assert.deepEqual(first.authReferences, {
    CODEX_HOME: path.join(first.directory, 'codex'),
    CLAUDE_CONFIG_DIR: path.join(first.directory, 'claude')
  });
  assert.equal(first.claudeSettingsPath, path.join(first.authReferences.CLAUDE_CONFIG_DIR, 'settings.json'));
  assert.deepEqual(await fs.readdir(first.authReferences.CODEX_HOME), ['config.toml']);
  assert.deepEqual(await fs.readdir(first.authReferences.CLAUDE_CONFIG_DIR), ['settings.json']);

  const codexConfigPath = path.join(first.authReferences.CODEX_HOME, 'config.toml');
  const codexConfig = await fs.readFile(codexConfigPath, 'utf8');
  const codexLines = codexConfig.trim().split('\n');
  assert.deepEqual(codexLines.slice(0, -1), [
    'model = "deepseek-flash"',
    'model_provider = "deepseek"',
    '',
    '[model_providers.deepseek]',
    'name = "DeepSeek"',
    'base_url = "https://api.deepseek.com/"',
    'wire_api = "responses"'
  ]);
  const bearerTokenLine = codexLines.at(-1);
  assert.ok(bearerTokenLine.startsWith('experimental_bearer_token = '));
  const bearerTokenString = bearerTokenLine.slice('experimental_bearer_token = '.length);
  assert.equal(JSON.parse(bearerTokenString), fakeApiKey);
  assert.doesNotMatch(bearerTokenString, /[\x00-\x1f\x7f]/u);
  assert.doesNotMatch(codexConfig, /env_key|OPENAI_API_KEY|requires_openai_auth|mcp_servers/u);

  const claudeSettings = JSON.parse(await fs.readFile(first.claudeSettingsPath, 'utf8'));
  assert.deepEqual(claudeSettings, {
    env: {
      ANTHROPIC_BASE_URL: 'https://api.deepseek.com/anthropic',
      ANTHROPIC_AUTH_TOKEN: fakeApiKey,
      ANTHROPIC_MODEL: 'deepseek-flash',
      ANTHROPIC_DEFAULT_OPUS_MODEL: 'deepseek-flash',
      ANTHROPIC_DEFAULT_SONNET_MODEL: 'deepseek-flash',
      ANTHROPIC_DEFAULT_HAIKU_MODEL: 'deepseek-flash',
      CLAUDE_CODE_SUBAGENT_MODEL: 'deepseek-flash',
      DISABLE_AUTOUPDATER: '1',
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1'
    }
  });
  assert.deepEqual(first.descriptor, {
    backend: 'deepseek',
    model: 'deepseek-flash',
    endpoints: {
      codex: 'https://api.deepseek.com/',
      claude: 'https://api.deepseek.com/anthropic'
    },
    credentialSource: 'DEEPSEEK_API_KEY'
  });
  assert.ok(!JSON.stringify(first).includes('fake-deepseek-key'));

  if (process.platform !== 'win32') {
    for (const directory of [first.directory, ...Object.values(first.authReferences)]) {
      assert.equal((await fs.stat(directory)).mode & 0o777, 0o700);
    }
    for (const file of [codexConfigPath, first.claudeSettingsPath]) {
      assert.equal((await fs.stat(file)).mode & 0o777, 0o600);
    }
  }

  const helperUrl = new URL('../smoke/agent-candidate-deepseek.mjs', import.meta.url).href;
  const runnerUrl = new URL('../smoke/vscode-smoke-runner.mjs', import.meta.url).href;
  const isolatedCheck = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import { createDeepSeekConfiguration } from ${JSON.stringify(helperUrl)};
    import { buildVSCodeChildEnv } from ${JSON.stringify(runnerUrl)};
    const originalEnvironment = { ...process.env };
    const configuration = await createDeepSeekConfiguration({ apiKey: 'fake-isolated-key' });
    try {
      assert.deepEqual({ ...process.env }, originalEnvironment);
      const env = buildVSCodeChildEnv(configuration.authReferences);
      assert.equal(env.DEEPSEEK_API_KEY, undefined);
      assert.equal(env.ANTHROPIC_AUTH_TOKEN, undefined);
      assert.equal(env.OPENAI_API_KEY, undefined);
      assert.equal(env.CODEX_HOME, configuration.authReferences.CODEX_HOME);
      assert.equal(env.CLAUDE_CONFIG_DIR, configuration.authReferences.CLAUDE_CONFIG_DIR);
    } finally {
      await configuration.dispose();
    }
  `], {
    encoding: 'utf8',
    timeout: 10000,
    env: {
      PATH: path.dirname(process.execPath),
      HOME: temporaryRoot,
      USERPROFILE: temporaryRoot,
      TMPDIR: temporaryRoot,
      TMP: temporaryRoot,
      TEMP: temporaryRoot,
      CODEX_HOME: path.join(temporaryRoot, 'unread-original-codex'),
      CLAUDE_CONFIG_DIR: path.join(temporaryRoot, 'unread-original-claude'),
      DEEPSEEK_API_KEY: 'fake-filtered-deepseek-key',
      ANTHROPIC_AUTH_TOKEN: 'fake-filtered-anthropic-token',
      OPENAI_API_KEY: 'fake-filtered-openai-key'
    }
  });
  assert.equal(isolatedCheck.status, 0, isolatedCheck.stderr);

  const directoriesBeforeInvalidInputs = await fs.readdir(temporaryRoot);
  for (const apiKey of [undefined, null, 1, '', ' \t ', 'fake-key\r', 'fake-key\n', 'fake-key\0']) {
    await assert.rejects(createDeepSeekConfiguration({ apiKey, temporaryRoot }), {
      message: 'A nonempty DeepSeek API key without CR, LF, or NUL is required.'
    });
  }
  assert.deepEqual(await fs.readdir(temporaryRoot), directoriesBeforeInvalidInputs);

  const originalWriteFile = fs.writeFile;
  try {
    fs.writeFile = async (...args) => {
      if (args[0].endsWith('settings.json')) throw new Error(`Simulated failure containing ${fakeApiKey}`);
      return originalWriteFile(...args);
    };
    await assert.rejects(createDeepSeekConfiguration({ apiKey: fakeApiKey, temporaryRoot }), {
      message: 'Failed to prepare isolated DeepSeek configuration.'
    });
  } finally {
    fs.writeFile = originalWriteFile;
  }
  assert.deepEqual(await fs.readdir(temporaryRoot), directoriesBeforeInvalidInputs);

  await first.dispose();
  await first.dispose();
  await assert.rejects(fs.stat(first.directory), { code: 'ENOENT' });
  assert.ok((await fs.stat(second.claudeSettingsPath)).isFile());
  assert.ok((await fs.stat(temporaryRoot)).isDirectory());
  console.log('DeepSeek agent candidate configuration tests passed');
} finally {
  for (const configuration of configurations) await configuration.dispose();
  await fs.rm(temporaryRoot, { recursive: true, force: true });
}
