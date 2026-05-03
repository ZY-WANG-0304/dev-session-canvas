import path from 'path';
import { fileURLToPath } from 'url';

import {
  runInsideXvfb,
  runVSCodeScenario,
  shouldReRunInsideXvfb
} from './vscode-smoke-runner.mjs';

const projectRoot = process.cwd();
const currentScriptPath = fileURLToPath(import.meta.url);
const notifierExtensionRoot = path.join(projectRoot, 'extensions', 'vscode', 'dev-session-canvas-notifier');
const extensionTestsPath = path.join(projectRoot, 'tests', 'vscode-smoke', 'notifier-companion-tests.cjs');
const fakeAgentProviderPath = path.join(projectRoot, 'tests', 'vscode-smoke', 'fixtures', 'fake-agent-provider');
const missingAgentProviderPath = path.join(projectRoot, 'tests', 'vscode-smoke', 'fixtures', 'missing-agent-provider');
const smokeFixturesDir = path.join(projectRoot, 'tests', 'vscode-smoke', 'fixtures');
const smokeFixturesPath = `${smokeFixturesDir}${path.delimiter}${process.env.PATH ?? ''}`;

async function main() {
  if (shouldReRunInsideXvfb()) {
    process.exit(runInsideXvfb(currentScriptPath, projectRoot));
  }

  await runVSCodeScenario({
    projectRoot,
    debugRoot: path.join(projectRoot, '.debug', 'vscode-smoke', 'notifier-companion'),
    runtimeDirName: 'dsc-vscode-smoke-runtime-notifier-companion',
    workspacePath: projectRoot,
    extensionDevelopmentPath: [projectRoot, notifierExtensionRoot],
    extensionTestsPath,
    disableWorkspaceTrust: true,
    extensionTestsEnv: {
      DEV_SESSION_CANVAS_TEST_CODEX_COMMAND: fakeAgentProviderPath,
      DEV_SESSION_CANVAS_TEST_CLAUDE_COMMAND: missingAgentProviderPath,
      PATH: smokeFixturesPath
    }
  });

  console.log('VS Code notifier companion smoke test passed.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
