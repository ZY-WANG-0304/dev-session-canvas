import path from 'path';
import { promises as fs } from 'fs';
import { fileURLToPath } from 'url';

import {
  ensureVSCodeExecutable,
  launchPreparedVSCodeScenario,
  prepareMainSmokeHostExtension,
  prepareRuntime,
  resolveStagedSmokeTestPath,
  resolveVSCodeSmokeDebugRoot,
  runInsideXvfb,
  stageBundledExtension,
  shouldReRunInsideXvfb
} from './vscode-smoke-runner.mjs';

const projectRoot = process.cwd();
const currentScriptPath = fileURLToPath(import.meta.url);
const smokeDebugRoot = resolveVSCodeSmokeDebugRoot(projectRoot);
const smokeFixturesDir = path.join(projectRoot, 'tests', 'vscode-smoke', 'fixtures');
const fakeAgentProviderPath = path.join(smokeFixturesDir, 'fake-agent-provider');
const missingAgentProviderPath = path.join(smokeFixturesDir, 'missing-agent-provider');
const smokeFixturesPath = `${smokeFixturesDir}${path.delimiter}${process.env.PATH ?? ''}`;
const ZH_CN_LANGUAGE_PACK_FIXTURE = {
  languageId: 'zh-cn',
  extensionId: 'devsessioncanvas.vscode-language-pack-zh-hans-smoke',
  name: 'vscode-language-pack-zh-hans-smoke',
  publisher: 'devsessioncanvas',
  version: '0.0.1'
};
const scenarios = [
  { name: 'en', locale: 'en' },
  {
    name: 'zh-cn',
    locale: 'zh-cn',
    languagePackFixture: ZH_CN_LANGUAGE_PACK_FIXTURE
  }
];

async function main() {
  if (shouldReRunInsideXvfb()) {
    process.exit(runInsideXvfb(currentScriptPath, projectRoot));
  }

  const vscodeExecutablePath = await ensureVSCodeExecutable(projectRoot);

  for (const scenario of scenarios) {
    const runtime = await prepareRuntime({
      projectRoot,
      debugRoot: path.join(smokeDebugRoot, 'ui-copy-locale', scenario.name),
      runtimeDirName: `dsc-vscode-ui-copy-locale-${scenario.name}`,
      userSettings: {
        'security.workspace.trust.enabled': false
      },
      extensionTestsEnv: buildExtensionTestsEnv(scenario.locale)
    });
    const smokeHostRoot = await prepareMainSmokeHostExtension({
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
      extensionDevelopmentPath: smokeHostRoot,
      extensionTestsPath: resolveStagedSmokeTestPath(smokeHostRoot, 'ui-copy-locale-tests.cjs'),
      disableExtensions: false,
      disableWorkspaceTrust: true,
      extraLaunchArgs: [`--locale=${scenario.locale}`],
      extensionTestsEnv: buildExtensionTestsEnv(scenario.locale)
    });
    console.log(`UI copy locale smoke passed for ${scenario.locale}.`);
  }

  console.log('UI copy locale smoke passed.');
}

function buildExtensionTestsEnv(locale) {
  return {
    DEV_SESSION_CANVAS_EXPECTED_LOCALE: locale,
    DEV_SESSION_CANVAS_TEST_CODEX_COMMAND: fakeAgentProviderPath,
    DEV_SESSION_CANVAS_TEST_CLAUDE_COMMAND: missingAgentProviderPath,
    PATH: smokeFixturesPath
  };
}

async function stageLanguagePackFixture(runtime, fixture) {
  const sourceRoot = path.join(runtime.debugRoot, 'language-pack-fixture');
  const translationsRoot = path.join(sourceRoot, 'translations');
  await fs.rm(sourceRoot, { recursive: true, force: true });
  await fs.mkdir(translationsRoot, { recursive: true });
  await fs.writeFile(
    path.join(sourceRoot, 'package.json'),
    `${JSON.stringify(
      {
        name: fixture.name,
        displayName: 'Chinese Simplified Language Pack Smoke Fixture',
        description: 'Minimal zh-cn language pack fixture for Dev Session Canvas smoke tests.',
        version: fixture.version,
        publisher: fixture.publisher,
        engines: {
          vscode: '^1.80.0'
        },
        categories: ['Language Packs'],
        contributes: {
          localizations: [
            {
              languageId: fixture.languageId,
              languageName: 'Chinese Simplified',
              localizedLanguageName: 'Chinese Simplified',
              translations: [
                {
                  id: 'vscode',
                  path: './translations/main.i18n.json'
                }
              ]
            }
          ]
        }
      },
      null,
      2
    )}\n`,
    'utf8'
  );
  await fs.writeFile(
    path.join(translationsRoot, 'main.i18n.json'),
    `${JSON.stringify(
      {
        '': ['Dev Session Canvas smoke language pack fixture.'],
        version: '1.0.0',
        contents: {}
      },
      null,
      2
    )}\n`,
    'utf8'
  );

  const installedRoot = await stageBundledExtension({
    sourceRoot,
    extensionsDir: runtime.extensionsDir
  });
  await fs.writeFile(
    path.join(runtime.userDataDir, 'languagepacks.json'),
    `${JSON.stringify(
      {
        [fixture.languageId]: {
          hash: `${fixture.extensionId}-${fixture.version}`,
          extensions: [
            {
              extensionIdentifier: {
                id: fixture.extensionId
              },
              version: fixture.version
            }
          ],
          translations: {
            vscode: path.join(installedRoot, 'translations', 'main.i18n.json')
          },
          label: 'Chinese Simplified'
        }
      },
      null,
      2
    )}\n`,
    'utf8'
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
