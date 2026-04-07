import path from 'path';
import { fileURLToPath } from 'url';

import {
  runInsideXvfb,
  runVSCodeScenario,
  shouldReRunInsideXvfb
} from './vscode-smoke-runner.mjs';

const projectRoot = process.cwd();
const currentScriptPath = fileURLToPath(import.meta.url);
const extensionTestsPath = path.join(projectRoot, 'tests', 'vscode-smoke', 'extension-tests.cjs');
const fakeAgentProviderPath = path.join(projectRoot, 'tests', 'vscode-smoke', 'fixtures', 'fake-agent-provider');
const missingAgentProviderPath = path.join(projectRoot, 'tests', 'vscode-smoke', 'fixtures', 'missing-agent-provider');

const scenarios = [
  {
    name: 'trusted',
    description: 'Trusted workspace smoke',
    disableWorkspaceTrust: true
  },
  {
    name: 'restricted',
    description: 'Restricted workspace smoke',
    disableWorkspaceTrust: false,
    userSettings: {
      'security.workspace.trust.enabled': true,
      'security.workspace.trust.startupPrompt': 'never',
      'security.workspace.trust.banner': 'never',
      'security.workspace.trust.untrustedFiles': 'open'
    }
  }
];

async function main() {
  if (shouldReRunInsideXvfb()) {
    process.exit(runInsideXvfb(currentScriptPath, projectRoot));
  }

  for (const scenario of scenarios) {
    await runVSCodeScenario({
      projectRoot,
      debugRoot: path.join(projectRoot, '.debug', 'vscode-smoke', scenario.name),
      runtimeDirName: `dsc-vscode-smoke-runtime-${scenario.name}`,
      workspacePath: projectRoot,
      extensionDevelopmentPath: projectRoot,
      extensionTestsPath,
      disableWorkspaceTrust: scenario.disableWorkspaceTrust,
      userSettings: scenario.userSettings,
      extensionTestsEnv: {
        DEV_SESSION_CANVAS_SMOKE_SCENARIO: scenario.name,
        DEV_SESSION_CANVAS_TEST_CODEX_COMMAND: fakeAgentProviderPath,
        DEV_SESSION_CANVAS_TEST_CLAUDE_COMMAND: missingAgentProviderPath
      }
    });
    console.log(`${scenario.description} passed.`);
  }

  console.log('VS Code smoke test passed.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
