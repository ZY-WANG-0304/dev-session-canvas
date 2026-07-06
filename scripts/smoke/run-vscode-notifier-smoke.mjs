import path from 'path';
import { fileURLToPath } from 'url';

import { prepareNotifierSmokeHostExtensions } from './notifier-smoke-utils.mjs';
import {
  launchPreparedVSCodeScenario,
  prepareRuntime,
  resolveStagedSmokeTestPath,
  runInsideXvfb,
  shouldReRunInsideXvfb
} from './vscode-smoke-runner.mjs';

const SMOKE_TEST_MODE_ENV_KEY = 'DEV_SESSION_CANVAS_SMOKE_TEST_MODE';

const projectRoot = process.cwd();
const currentScriptPath = fileURLToPath(import.meta.url);
const debugRoot = path.join(projectRoot, '.debug', 'vscode-smoke', 'notifier-companion');
const fakeAgentProviderPath = path.join(projectRoot, 'tests', 'vscode-smoke', 'fixtures', 'fake-agent-provider');
const missingAgentProviderPath = path.join(projectRoot, 'tests', 'vscode-smoke', 'fixtures', 'missing-agent-provider');
const smokeFixturesDir = path.join(projectRoot, 'tests', 'vscode-smoke', 'fixtures');
const smokeFixturesPath = `${smokeFixturesDir}${path.delimiter}${process.env.PATH ?? ''}`;

async function main() {
  if (shouldReRunInsideXvfb()) {
    process.exit(runInsideXvfb(currentScriptPath, projectRoot));
  }

  const extensionTestsEnv = {
    [SMOKE_TEST_MODE_ENV_KEY]: '1',
    DEV_SESSION_CANVAS_TEST_CODEX_COMMAND: fakeAgentProviderPath,
    DEV_SESSION_CANVAS_TEST_CLAUDE_COMMAND: missingAgentProviderPath,
    PATH: smokeFixturesPath
  };

  const runtime = await prepareRuntime({
    projectRoot,
    debugRoot,
    runtimeDirName: 'dsc-vscode-smoke-runtime-notifier-companion',
    extensionTestsEnv,
    userSettings: {
      'extensions.autoCheckUpdates': false,
      'extensions.autoUpdate': false
    }
  });

  const smokeHost = await prepareNotifierSmokeHostExtensions({
    projectRoot,
    targetRoot: path.join(debugRoot, 'smoke-host')
  });

  await launchPreparedVSCodeScenario({
    projectRoot,
    runtime,
    workspacePath: projectRoot,
    extensionDevelopmentPath: [smokeHost.mainExtensionRoot, smokeHost.notifierExtensionRoot],
    extensionTestsPath: resolveStagedSmokeTestPath(smokeHost.mainExtensionRoot, 'notifier-companion-tests.cjs'),
    disableExtensions: false,
    disableWorkspaceTrust: true,
    extensionTestsEnv
  });

  console.log('VS Code notifier companion smoke test passed.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
