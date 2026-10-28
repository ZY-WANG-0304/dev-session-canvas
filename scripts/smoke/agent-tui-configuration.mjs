import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createDeepSeekConfiguration } from './agent-candidate-deepseek.mjs';

export const tuiProviders = Object.freeze({ codex: '0.157.1', claude: '2.1.280' });
export const tuiCases = Object.freeze(['input-during-work', 'answer-with-footer',
  'tool-network-silence', 'turn-completion-redraw']);
export const shellQuote = value => `'${String(value).replaceAll("'", "'\\''")}'`;

export async function prepareAgentTui({ provider, directory, projectRoot, cliRoot, apiKey }) {
  assert.equal(process.platform, 'linux', 'Initial real TUI coverage is Linux only');
  assert(Object.hasOwn(tuiProviders, provider));
  const cli = cliRoot ? path.join(cliRoot, 'node_modules', '.bin', provider) : provider;
  const version = spawnSync(cli, ['--version'], { encoding: 'utf8', timeout: 10000 });
  assert.equal(version.status, 0, `Missing real ${provider} CLI`);
  assert.equal(version.stdout.trim(), provider === 'codex' ? `codex-cli ${tuiProviders.codex}`
    : `${tuiProviders.claude} (Claude Code)`, 'Real CLI version differs from the fixed input');
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const workspace = path.join(directory, 'workspace');
  await fs.mkdir(workspace, { mode: 0o700 });
  const configuration = await createDeepSeekConfiguration({ apiKey });
  try {
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
    return { provider, cli, args, directory, workspace, events, prompt, sessionId,
      environment: { ...configuration.authReferences, TERM: 'xterm-256color',
        DISABLE_AUTOUPDATER: '1', CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1' },
      dispose: configuration.dispose };
  } catch (error) { await configuration.dispose(); throw error; }
}
