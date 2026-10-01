import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const MODEL = 'deepseek-flash';
const CODEX_ENDPOINT = 'https://api.deepseek.com/';
const CLAUDE_ENDPOINT = 'https://api.deepseek.com/anthropic';

export async function createDeepSeekConfiguration({ apiKey, temporaryRoot = os.tmpdir() } = {}) {
  if (typeof apiKey !== 'string' || apiKey.trim().length === 0 || /[\r\n\0]/u.test(apiKey)) {
    throw new Error('A nonempty DeepSeek API key without CR, LF, or NUL is required.');
  }

  let directory;
  try {
    directory = await fs.mkdtemp(path.join(temporaryRoot, 'dsc-agent-deepseek-'));
    await fs.chmod(directory, 0o700);
    const codexHome = path.join(directory, 'codex');
    const claudeConfigDir = path.join(directory, 'claude');
    await fs.mkdir(codexHome, { mode: 0o700 });
    await fs.mkdir(claudeConfigDir, { mode: 0o700 });

    // JSON basic strings also encode TOML controls, except for DEL.
    const bearerToken = JSON.stringify(apiKey).replace(/\x7f/gu, '\\u007f');
    await fs.writeFile(path.join(codexHome, 'config.toml'), [
      `model = "${MODEL}"`,
      'model_provider = "deepseek"',
      '',
      '[model_providers.deepseek]',
      'name = "DeepSeek"',
      `base_url = "${CODEX_ENDPOINT}"`,
      'wire_api = "responses"',
      `experimental_bearer_token = ${bearerToken}`,
      ''
    ].join('\n'), { encoding: 'utf8', mode: 0o600, flag: 'wx' });

    const claudeSettingsPath = path.join(claudeConfigDir, 'settings.json');
    await fs.writeFile(claudeSettingsPath, `${JSON.stringify({
      env: {
        ANTHROPIC_BASE_URL: CLAUDE_ENDPOINT,
        ANTHROPIC_AUTH_TOKEN: apiKey,
        ANTHROPIC_MODEL: MODEL,
        ANTHROPIC_DEFAULT_OPUS_MODEL: MODEL,
        ANTHROPIC_DEFAULT_SONNET_MODEL: MODEL,
        ANTHROPIC_DEFAULT_HAIKU_MODEL: MODEL,
        CLAUDE_CODE_SUBAGENT_MODEL: MODEL,
        DISABLE_AUTOUPDATER: '1',
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1'
      }
    }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });

    return {
      directory,
      authReferences: { CODEX_HOME: codexHome, CLAUDE_CONFIG_DIR: claudeConfigDir },
      claudeSettingsPath,
      descriptor: {
        backend: 'deepseek',
        model: MODEL,
        endpoints: { codex: CODEX_ENDPOINT, claude: CLAUDE_ENDPOINT },
        credentialSource: 'DEEPSEEK_API_KEY'
      },
      dispose: () => fs.rm(directory, { recursive: true, force: true })
    };
  } catch {
    if (directory) {
      try {
        await fs.rm(directory, { recursive: true, force: true });
      } catch {
        throw new Error('Failed to prepare isolated DeepSeek configuration and remove its temporary directory.');
      }
    }
    throw new Error('Failed to prepare isolated DeepSeek configuration.');
  }
}
