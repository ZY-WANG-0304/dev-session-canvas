import path from 'node:path';
import { prepareAgentTuiSuite } from './agent-tui-configuration.mjs';
import { prepareRuntime, launchPreparedVSCodeScenario, resolveStagedSmokeTestPath } from './vscode-smoke-runner.mjs';

export async function runAgentTuiSuite({ projectRoot, debugRoot, scenario, extensionDevelopmentPath }) {
  const fixture = await prepareAgentTuiSuite({ projectRoot, scenario,
    directory: path.join(debugRoot, 'tui-fixture') });
  try {
    const runtime = await prepareRuntime({ projectRoot, debugRoot: path.join(debugRoot, 'host'),
      runtimeDirName: 'dsc-tui', userSettings: fixture.userSettings });
    const hostRoot = Array.isArray(extensionDevelopmentPath) ? extensionDevelopmentPath[0] : extensionDevelopmentPath;
    await launchPreparedVSCodeScenario({ projectRoot, runtime, workspacePath: fixture.workspacePath,
      extensionDevelopmentPath, extensionTestsPath: resolveStagedSmokeTestPath(hostRoot, 'agent-tui-tests.cjs'),
      disableExtensions: false, disableWorkspaceTrust: true,
      extensionTestsEnv: { ...fixture.environment, DEV_SESSION_CANVAS_SMOKE_TEST_MODE: '1',
        DEV_SESSION_CANVAS_SMOKE_SCENARIO: scenario } });
  } finally { await fixture.dispose(); }
}
