import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

import esbuild from 'esbuild';

const tempDir = await mkdtemp(path.join(os.tmpdir(), 'dsc-agent-settings-files-'));

try {
  const outfile = path.join(tempDir, 'agentSettingsFiles.cjs');
  await esbuild.build({
    entryPoints: [path.resolve('src/panel/agentSettingsFiles.ts')],
    bundle: true,
    format: 'cjs',
    outfile,
    platform: 'node',
    target: 'node18'
  });

  const require = createRequire(import.meta.url);
  const {
    RESTRICTED_AGENT_SETTINGS_DIRECTORY_MODE,
    RESTRICTED_AGENT_SETTINGS_FILE_MODE,
    createRestrictedLocalAgentSettingsFile,
    getAgentSettingsFileDescriptor,
    getLocalAgentSettingsFileStatus,
    resolveAgentSettingsFilePath
  } = require(outfile);

  const homeDir = path.join(tempDir, 'home');
  const codexHome = path.join(tempDir, 'custom-codex-home');
  const workspaceDir = path.join(tempDir, 'workspace');

  assert.equal(
    resolveAgentSettingsFilePath('codex-config', {
      env: { HOME: homeDir },
      cwd: workspaceDir,
      platform: process.platform
    }),
    path.join(homeDir, '.codex', 'config.toml')
  );
  assert.equal(
    resolveAgentSettingsFilePath('codex-auth', {
      env: { HOME: homeDir, CODEX_HOME: codexHome },
      cwd: workspaceDir,
      platform: process.platform
    }),
    path.join(codexHome, 'auth.json')
  );
  assert.equal(
    resolveAgentSettingsFilePath('claude-settings', {
      env: { HOME: homeDir, CODEX_HOME: codexHome },
      cwd: workspaceDir,
      platform: process.platform
    }),
    path.join(homeDir, '.claude', 'settings.json')
  );

  const codexConfig = getAgentSettingsFileDescriptor('codex-config').initialContent;
  const codexConfigLines = codexConfig.split(/\r?\n/);
  assert.ok(codexConfig.includes('base_url = ""'));
  assert.ok(codexConfig.includes('# env_key = "OPENAI_API_KEY"'));
  assert.ok(!codexConfigLines.includes('base_url = "https://api.openai.com/v1"'));
  assert.ok(!codexConfigLines.includes('env_key = "OPENAI_API_KEY"'));

  const codexAuth = JSON.parse(getAgentSettingsFileDescriptor('codex-auth').initialContent);
  assert.equal(codexAuth.auth_mode, 'apikey');
  assert.equal(codexAuth.OPENAI_API_KEY, '');

  const authPath = path.join(tempDir, 'secure-home', '.codex', 'auth.json');
  assert.equal(await getLocalAgentSettingsFileStatus(authPath), 'missing');
  await createRestrictedLocalAgentSettingsFile(authPath, 'secret\n');
  assert.equal(await readFile(authPath, 'utf8'), 'secret\n');
  assert.equal(await getLocalAgentSettingsFileStatus(authPath), 'file');
  await assert.rejects(() => createRestrictedLocalAgentSettingsFile(authPath, 'overwrite\n'), {
    code: 'EEXIST'
  });
  assert.equal(await readFile(authPath, 'utf8'), 'secret\n');

  if (process.platform !== 'win32') {
    assert.equal((await stat(path.dirname(authPath))).mode & 0o777, RESTRICTED_AGENT_SETTINGS_DIRECTORY_MODE);
    assert.equal((await stat(authPath)).mode & 0o777, RESTRICTED_AGENT_SETTINGS_FILE_MODE);
  }

  const directoryPath = path.join(tempDir, 'directory-status');
  await mkdir(directoryPath);
  assert.equal(await getLocalAgentSettingsFileStatus(directoryPath), 'directory');

  const existingPath = path.join(tempDir, 'existing.txt');
  await writeFile(existingPath, 'existing\n', 'utf8');
  assert.equal(await getLocalAgentSettingsFileStatus(existingPath), 'file');

  console.log('agent settings file tests passed');
} finally {
  await rm(tempDir, { recursive: true, force: true });
}
