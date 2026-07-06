import path from 'path';
import { promises as fs } from 'fs';

import {
  copyPathRecursive,
  stageBundledExtension,
  stageSmokeTestSuite
} from './vscode-smoke-runner.mjs';

export const NOTIFIER_ZH_CN_LANGUAGE_PACK_FIXTURE = {
  languageId: 'zh-cn',
  extensionId: 'devsessioncanvas.vscode-language-pack-zh-hans-smoke',
  name: 'vscode-language-pack-zh-hans-smoke',
  publisher: 'devsessioncanvas',
  version: '0.0.1'
};

export async function prepareNotifierSmokeHostExtensions(options) {
  const smokeHostRoot = options.targetRoot;
  const mainSmokeHostRoot = path.join(smokeHostRoot, 'main-extension');
  const notifierSmokeHostRoot = path.join(smokeHostRoot, 'notifier-extension');
  await fs.rm(smokeHostRoot, { recursive: true, force: true });

  await stageExtension({
    sourceRoot: path.join(options.projectRoot, 'extensions', 'vscode', 'dev-session-canvas'),
    targetRoot: mainSmokeHostRoot,
    entries: [
      'package.json',
      'package.nls.json',
      'package.nls.zh-cn.json',
      'l10n',
      'dist',
      'images',
      'resources',
      'scripts'
    ]
  });
  await copyPathRecursive(path.join(options.projectRoot, 'node_modules'), path.join(mainSmokeHostRoot, 'node_modules'));
  await stageExtension({
    sourceRoot: path.join(options.projectRoot, 'extensions', 'vscode', 'dev-session-canvas-notifier'),
    targetRoot: notifierSmokeHostRoot,
    entries: ['package.json', 'package.nls.json', 'package.nls.zh-cn.json', 'l10n', 'dist', 'images']
  });

  await stripInstallRelationship(path.join(mainSmokeHostRoot, 'package.json'));
  await stageSmokeTestSuite({
    projectRoot: options.projectRoot,
    targetRoot: mainSmokeHostRoot
  });

  return {
    mainExtensionRoot: mainSmokeHostRoot,
    notifierExtensionRoot: notifierSmokeHostRoot
  };
}

export async function stageLanguagePackFixture(runtime, fixture) {
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

async function stageExtension({ sourceRoot, targetRoot, entries }) {
  await fs.rm(targetRoot, { recursive: true, force: true });
  await fs.mkdir(targetRoot, { recursive: true });

  for (const entry of entries) {
    const sourcePath = path.join(sourceRoot, entry);
    const targetPath = path.join(targetRoot, entry);
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await copyPathRecursive(sourcePath, targetPath);
  }
}

async function stripInstallRelationship(packageJsonPath) {
  const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf8'));
  delete packageJson.extensionDependencies;
  delete packageJson.extensionPack;
  await fs.writeFile(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`, 'utf8');
}
