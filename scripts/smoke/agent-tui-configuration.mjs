import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createDeepSeekConfiguration } from './agent-candidate-deepseek.mjs';

export const tuiProviders = Object.freeze({ codex: '0.157.1', claude: '2.1.280' });
export const tuiCases = Object.freeze(['input-during-work', 'answer-with-footer',
  'tool-network-silence', 'turn-completion-redraw']);
export const shellQuote = value => `'${String(value).replaceAll("'", "'\\''")}'`;

export async function prepareAgentTui({ provider, directory, projectRoot, cliRoot, apiKey, workspace: requestedWorkspace }) {
  assert.equal(process.platform, 'linux', 'Initial real TUI coverage is Linux only');
  assert(Object.hasOwn(tuiProviders, provider));
  const cli = cliRoot ? path.join(cliRoot, 'node_modules', '.bin', provider)
    : spawnSync('which', [provider], { encoding: 'utf8', timeout: 5000 }).stdout.trim();
  assert(path.isAbsolute(cli), 'Real CLI must resolve to an absolute path');
  const version = spawnSync(cli, ['--version'], { encoding: 'utf8', timeout: 10000 });
  assert.equal(version.status, 0, `Missing real ${provider} CLI`);
  assert.equal(version.stdout.trim(), provider === 'codex' ? `codex-cli ${tuiProviders.codex}`
    : `${tuiProviders.claude} (Claude Code)`, 'Real CLI version differs from the fixed input');
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const configuration = await createDeepSeekConfiguration({ apiKey });
  try {
    // Keep the CLI cwd outside the checkout: Claude walks ancestor CLAUDE.md
    // files even when its private settings and home are isolated.
    const workspace = requestedWorkspace ?? path.join(configuration.directory, 'workspace');
    assert(path.isAbsolute(workspace), 'Private CLI workspace must be absolute');
    const relative = path.relative(projectRoot, workspace);
    assert(relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative),
      'Private CLI workspace must be outside the source checkout');
    await fs.mkdir(workspace, { mode: 0o700 });
    const events = path.join(directory, 'events.jsonl');
    const observerCommand = [process.execPath, path.join(projectRoot, 'tests/vscode-smoke/agent-tui-hook.cjs'),
      events].map(shellQuote).join(' ');
    const hooks = Object.fromEntries(['UserPromptSubmit', 'Stop', 'StopFailure', 'SessionEnd']
      .filter(event => provider === 'claude' || event !== 'StopFailure')
      .map(event => [event, [{ hooks: [{ type: 'command', command: observerCommand, timeout: 5 }] }]]));
    const server = { command: process.execPath,
      args: [path.join(projectRoot, 'tests/vscode-smoke/agent-tui-tool.cjs'), directory] };
    let args;
    const sessionId = randomUUID();
    if (provider === 'codex') {
      await fs.writeFile(path.join(configuration.authReferences.CODEX_HOME, 'hooks.json'),
        JSON.stringify({ hooks }), { mode: 0o600 });
      await fs.appendFile(path.join(configuration.authReferences.CODEX_HOME, 'config.toml'), [
        '\n[features]', 'hooks = true', 'shell_tool = false', 'apps = false', 'multi_agent = false',
        '\n[mcp_servers.tui]', `command = ${JSON.stringify(server.command)}`,
        `args = ${JSON.stringify(server.args)}`, 'tool_timeout_sec = 65',
        'default_tools_approval_mode = "approve"',
        '\n[tui]', 'status_line = ["model-name", "context-remaining"]',
        `\n[projects.${JSON.stringify(workspace)}]`, 'trust_level = "trusted"', ''
      ].join('\n'));
      args = ['--no-daemon', '--no-alt-screen', '--dangerously-bypass-hook-trust',
        '--sandbox', 'read-only', '-a', 'never'];
    } else {
      const settings = JSON.parse(await fs.readFile(configuration.claudeSettingsPath, 'utf8'));
      Object.assign(settings, { hooks, permissions: { allow: ['mcp__tui__wait_for_release'] } });
      await fs.writeFile(configuration.claudeSettingsPath, JSON.stringify(settings), { mode: 0o600 });
      const mcpFile = path.join(directory, 'mcp.json');
      await fs.writeFile(mcpFile, JSON.stringify({ mcpServers: { tui: server } }));
      args = ['--settings', configuration.claudeSettingsPath, '--strict-mcp-config', '--mcp-config', mcpFile,
        '--tools', '', '--permission-mode', 'dontAsk', '--session-id', sessionId];
    }
    const prompt = `Test ${randomUUID()}. Call the tui wait_for_release tool exactly once and wait for its result. `
      + 'Then answer in one short plain English sentence containing the exact receipt returned by the tool. '
      + 'Do not use other tools or write files. Do not respond before the tool returns.';
    // Codex's npm entry is JavaScript; the interactive shell may reset PATH.
    // Claude's fixed npm entry is a native executable and must run directly.
    const launch = provider === 'codex' ? [process.execPath, cli, ...args] : [cli, ...args];
    return { provider, cli, args, launch, directory, workspace, events, prompt, sessionId,
      environment: { ...configuration.authReferences, TERM: 'xterm-256color',
        DISABLE_AUTOUPDATER: '1', CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1' },
      dispose: configuration.dispose };
  } catch (error) { await configuration.dispose(); throw error; }
}

export async function prepareAgentTuiSuite({ scenario, directory, projectRoot,
  cliRoot = process.env.DSC_TUI_CLI_ROOT, apiKey = process.env.DEEPSEEK_API_KEY }) {
  assert(tuiCases.includes(scenario.replace('agent-tui/', '')));
  const configurations = [];
  // The Host must own both CLI cwd values, without making credential homes
  // part of the workspace or inheriting source-checkout instructions.
  const workspacePath = await fs.mkdtemp(path.join(os.tmpdir(), 'dsc-tui-workspace-'));
  try {
    for (const provider of Object.keys(tuiProviders)) configurations.push(await prepareAgentTui({ provider,
      directory: path.join(directory, provider), projectRoot, cliRoot, apiKey,
      workspace: path.join(workspacePath, provider) }));
    const [codex, claude] = configurations;
    const configPath = path.join(directory, 'suite.json');
    await fs.writeFile(configPath, JSON.stringify({ scenario, configurations }), { mode: 0o600 });
    return { workspacePath,
      environment: { CODEX_HOME: codex.environment.CODEX_HOME, CLAUDE_CONFIG_DIR: claude.environment.CLAUDE_CONFIG_DIR,
        CODEX_UPDATE_ON_STARTUP: 'false', TERM: 'xterm-256color',
        DEV_SESSION_CANVAS_AGENT_TUI_CONFIG: configPath,
        DEV_SESSION_CANVAS_TEST_CODEX_COMMAND: codex.launch[0], DEV_SESSION_CANVAS_TEST_CLAUDE_COMMAND: claude.cli,
        DEV_SESSION_CANVAS_TEST_NODE_PATH: process.execPath, PATH: process.env.PATH },
      userSettings: { 'devSessionCanvas.runtimePersistence.enabled': false,
        'devSessionCanvas.agent.codexCommand': codex.launch[0], 'devSessionCanvas.agent.claudeCommand': claude.cli,
        'devSessionCanvas.agent.codexDefaultArgs': '', 'devSessionCanvas.agent.claudeDefaultArgs': '' },
      dispose: async () => {
        const results = await Promise.allSettled([...configurations.map(config => config.dispose()),
          fs.rm(workspacePath, { recursive: true, force: true })]);
        assert(results.every(result => result.status === 'fulfilled'), 'Private CLI configuration cleanup failed');
      } };
  } catch (error) {
    await Promise.allSettled([...configurations.map(config => config.dispose()),
      fs.rm(workspacePath, { recursive: true, force: true })]); throw error;
  }
}
