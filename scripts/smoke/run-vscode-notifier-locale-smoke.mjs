import path from 'path';
import { fileURLToPath } from 'url';

import {
  NOTIFIER_ZH_CN_LANGUAGE_PACK_FIXTURE,
  prepareNotifierSmokeHostExtensions,
  stageLanguagePackFixture
} from './notifier-smoke-utils.mjs';
import {
  ensureVSCodeExecutable,
  launchPreparedVSCodeScenario,
  prepareRuntime,
  resolveStagedSmokeTestPath,
  resolveVSCodeSmokeDebugRoot,
  runInsideXvfb,
  shouldReRunInsideXvfb
} from './vscode-smoke-runner.mjs';

const SMOKE_TEST_MODE_ENV_KEY = 'DEV_SESSION_CANVAS_SMOKE_TEST_MODE';

const projectRoot = process.cwd();
const currentScriptPath = fileURLToPath(import.meta.url);
const smokeDebugRoot = resolveVSCodeSmokeDebugRoot(projectRoot);
const smokeFixturesDir = path.join(projectRoot, 'tests', 'vscode-smoke', 'fixtures');
const fakeAgentProviderPath = path.join(smokeFixturesDir, 'fake-agent-provider');
const missingAgentProviderPath = path.join(smokeFixturesDir, 'missing-agent-provider');
const smokeFixturesPath = `${smokeFixturesDir}${path.delimiter}${process.env.PATH ?? ''}`;
const scenarios = [
  { name: 'en', locale: 'en' },
  {
    name: 'zh-cn',
    locale: 'zh-cn',
    languagePackFixture: NOTIFIER_ZH_CN_LANGUAGE_PACK_FIXTURE
  }
];

async function main() {
  if (shouldReRunInsideXvfb()) {
    process.exit(runInsideXvfb(currentScriptPath, projectRoot));
  }

  const vscodeExecutablePath = await ensureVSCodeExecutable(projectRoot);

  for (const scenario of scenarios) {
    const extensionTestsEnv = buildExtensionTestsEnv(scenario.locale);
    const runtime = await prepareRuntime({
      projectRoot,
      debugRoot: path.join(smokeDebugRoot, 'notifier-locale', scenario.name),
      runtimeDirName: `dsc-vscode-notifier-locale-${scenario.name}`,
      extensionTestsEnv,
      userSettings: {
        'extensions.autoCheckUpdates': false,
        'extensions.autoUpdate': false,
        'security.workspace.trust.enabled': false
      }
    });
    const smokeHost = await prepareNotifierSmokeHostExtensions({
      projectRoot,
      targetRoot: path.join(runtime.debugRoot, 'smoke-host')
    });

    if (scenario.languagePackFixture) {
      await stageLanguagePackFixture(runtime, scenario.languagePackFixture);
    }

    await launchPreparedVSCodeScenario({
      projectRoot,
      runtime,
      vscodeExecutablePath,
      workspacePath: projectRoot,
      extensionDevelopmentPath: [smokeHost.mainExtensionRoot, smokeHost.notifierExtensionRoot],
      extensionTestsPath: resolveStagedSmokeTestPath(smokeHost.mainExtensionRoot, 'notifier-locale-tests.cjs'),
      disableExtensions: false,
      disableWorkspaceTrust: true,
      extraLaunchArgs: [`--locale=${scenario.locale}`],
      extensionTestsEnv
    });
    console.log(`VS Code notifier locale smoke passed for ${scenario.locale}.`);
  }

  console.log('VS Code notifier locale smoke passed.');
}

function buildExtensionTestsEnv(locale) {
  return {
    [SMOKE_TEST_MODE_ENV_KEY]: '1',
    DEV_SESSION_CANVAS_EXPECTED_LOCALE: locale,
    DEV_SESSION_CANVAS_TEST_CODEX_COMMAND: fakeAgentProviderPath,
    DEV_SESSION_CANVAS_TEST_CLAUDE_COMMAND: missingAgentProviderPath,
    PATH: smokeFixturesPath
  };
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
