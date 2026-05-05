import path from 'path';
import { promises as fs } from 'fs';
import { fileURLToPath } from 'url';

import {
  copyPathRecursive,
  launchPreparedVSCodeScenario,
  prepareRuntime,
  resolveStagedSmokeTestPath,
  runInsideXvfb,
  stageSmokeTestSuite,
  shouldReRunInsideXvfb
} from './vscode-smoke-runner.mjs';

const SMOKE_TEST_MODE_ENV_KEY = 'DEV_SESSION_CANVAS_SMOKE_TEST_MODE';
const NOTIFIER_EXTENSION_ID = 'devsessioncanvas.dev-session-canvas-notifier';

const projectRoot = process.cwd();
const currentScriptPath = fileURLToPath(import.meta.url);
const debugRoot = path.join(projectRoot, '.debug', 'vscode-smoke', 'notifier-companion');
const notifierExtensionRoot = path.join(projectRoot, 'extensions', 'vscode', 'dev-session-canvas-notifier');
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

  const smokeHostRoot = await prepareSmokeHostExtension(debugRoot);

  await launchPreparedVSCodeScenario({
    projectRoot,
    runtime,
    workspacePath: projectRoot,
    extensionDevelopmentPath: smokeHostRoot,
    extensionTestsPath: resolveStagedSmokeTestPath(smokeHostRoot, 'notifier-companion-tests.cjs'),
    disableExtensions: false,
    disableWorkspaceTrust: true,
    extensionTestsEnv
  });

  console.log('VS Code notifier companion smoke test passed.');
}

async function prepareSmokeHostExtension(root) {
  const smokeHostRoot = path.join(root, 'smoke-host');
  const notifierRuntimeRoot = path.join(smokeHostRoot, 'notifier-extension');
  await fs.rm(smokeHostRoot, { recursive: true, force: true });

  await stageExtension({
    sourceRoot: projectRoot,
    targetRoot: smokeHostRoot,
    entries: ['package.json', 'package.nls.json', 'dist', 'images', 'node_modules', 'scripts']
  });
  await stageExtension({
    sourceRoot: notifierExtensionRoot,
    targetRoot: notifierRuntimeRoot,
    entries: ['package.json', 'dist', 'images']
  });

  const packageJsonPath = path.join(smokeHostRoot, 'package.json');
  const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf8'));
  delete packageJson.extensionDependencies;
  delete packageJson.extensionPack;
  packageJson.main = './extension.js';
  await fs.writeFile(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`, 'utf8');
  await stageSmokeTestSuite({
    projectRoot,
    targetRoot: smokeHostRoot
  });

  await fs.writeFile(path.join(smokeHostRoot, 'extension.js'), buildSmokeHostEntrySource(), 'utf8');
  return smokeHostRoot;
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

function buildSmokeHostEntrySource() {
  return `const path = require('path');
const vscode = require('vscode');

const mainExtension = require('./dist/extension.js');
const notifierExtension = require('./notifier-extension/dist/extension.js');
const notifierPackageJson = require('./notifier-extension/package.json');

const NOTIFIER_EXTENSION_ID = ${JSON.stringify(NOTIFIER_EXTENSION_ID)};

exports.activate = async function activate(context) {
  await Promise.resolve(mainExtension.activate?.(context));
  await Promise.resolve(notifierExtension.activate?.(createNotifierContext(context)));
};

exports.deactivate = async function deactivate() {
  await Promise.resolve(notifierExtension.deactivate?.());
  await Promise.resolve(mainExtension.deactivate?.());
};

function createNotifierContext(baseContext) {
  const extensionPath = path.join(baseContext.extensionPath, 'notifier-extension');
  const extensionUri = vscode.Uri.file(extensionPath);
  const packageJSON = notifierPackageJson;
  const extension = {
    id: NOTIFIER_EXTENSION_ID,
    packageJSON,
    extensionUri,
    extensionPath,
    isActive: true
  };
  const notifierContext = Object.create(baseContext);

  Object.defineProperties(notifierContext, {
    extension: {
      value: extension,
      enumerable: true
    },
    extensionUri: {
      value: extensionUri,
      enumerable: true
    },
    extensionPath: {
      value: extensionPath,
      enumerable: true
    },
    asAbsolutePath: {
      value(relativePath) {
        return path.join(extensionPath, relativePath);
      },
      enumerable: true
    }
  });

  return notifierContext;
}
`;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
