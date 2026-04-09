import path from 'path';
import { fileURLToPath } from 'url';

import {
  launchPreparedVSCodeScenario,
  prepareRuntime,
  runInsideXvfb,
  runVSCodeScenario,
  shouldReRunInsideXvfb
} from './vscode-smoke-runner.mjs';

const projectRoot = process.cwd();
const currentScriptPath = fileURLToPath(import.meta.url);
const extensionTestsPath = path.join(projectRoot, 'tests', 'vscode-smoke', 'extension-tests.cjs');
const realReopenExtensionTestsPath = path.join(projectRoot, 'tests', 'vscode-smoke', 'real-reopen-tests.cjs');
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

  await runRealWindowReopenScenario();
  console.log('VS Code smoke test passed.');
}

async function runRealWindowReopenScenario() {
  const runtime = await prepareRuntime({
    debugRoot: path.join(projectRoot, '.debug', 'vscode-smoke', 'real-reopen'),
    runtimeDirName: 'dsc-vscode-smoke-runtime-real-reopen',
    userSettings: {
      'security.workspace.trust.enabled': false
    }
  });

  const sharedOptions = {
    projectRoot,
    runtime,
    workspacePath: projectRoot,
    extensionDevelopmentPath: projectRoot,
    extensionTestsPath: realReopenExtensionTestsPath,
    disableWorkspaceTrust: true
  };
  const sharedEnv = {
    DEV_SESSION_CANVAS_TEST_CODEX_COMMAND: fakeAgentProviderPath,
    DEV_SESSION_CANVAS_TEST_CLAUDE_COMMAND: missingAgentProviderPath
  };

  await launchPreparedVSCodeScenario({
    ...sharedOptions,
    extensionTestsEnv: {
      ...sharedEnv,
      DEV_SESSION_CANVAS_REAL_REOPEN_PHASE: 'setup'
    }
  });

  await launchPreparedVSCodeScenario({
    ...sharedOptions,
    extensionTestsEnv: {
      ...sharedEnv,
      DEV_SESSION_CANVAS_REAL_REOPEN_PHASE: 'verify'
    }
  });

  console.log('Real window reopen smoke passed.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
