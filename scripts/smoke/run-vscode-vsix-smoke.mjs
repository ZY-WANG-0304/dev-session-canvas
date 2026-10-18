import path from 'path';
import { promises as fs } from 'fs';
import { fileURLToPath } from 'url';
import assert from 'node:assert/strict';
import { parseArgs } from 'node:util';
import JSZip from 'jszip';
import { fileDigest, objectDigest, readJSON, verifyPackageFiles, writeJSON } from '../gates/receipts.mjs';
import { validateFrozenPlan, assertFormalEnvironment } from '../gates/resolve-plan.mjs';
import { selectSmokeSuites } from './smoke-catalog.mjs';
import { treeHashes } from '../release/build-release-candidate.mjs';
import { verifyInstrumentation } from './package-instrumentation.mjs';

import {
  copyPathRecursive,
  resolveStagedSmokeTestPath,
  runInsideXvfb,
  runVSCodeScenario,
  stageSmokeTestSuite,
  shouldReRunInsideXvfb
} from './vscode-smoke-runner.mjs';

const projectRoot = process.cwd();
const currentScriptPath = fileURLToPath(import.meta.url);
const fakeAgentProviderPath = path.join(projectRoot, 'tests', 'vscode-smoke', 'fixtures', 'fake-agent-provider');
const missingAgentProviderPath = path.join(projectRoot, 'tests', 'vscode-smoke', 'fixtures', 'missing-agent-provider');
const debugRoot = process.env.DEV_SESSION_CANVAS_SMOKE_DEBUG_ROOT
  ? path.resolve(process.env.DEV_SESSION_CANVAS_SMOKE_DEBUG_ROOT) : path.join(projectRoot, '.debug', 'vscode-vsix-smoke');
const unpackRoot = path.join(debugRoot, 'packaged-extension');
const marketplaceReadmeMarker = '<!-- dev-session-canvas-marketplace-readme -->';
const SMOKE_TEST_MODE_ENV_KEY = 'DEV_SESSION_CANVAS_SMOKE_TEST_MODE';
const { values } = parseArgs({ options: { 'main-vsix': { type: 'string' }, 'notifier-vsix': { type: 'string' },
  'package-receipt': { type: 'string' }, plan: { type: 'string' }, scenario: { type: 'string' }, group: { type: 'string' } } });
assert(values['main-vsix'] && values['notifier-vsix'] && values['package-receipt'] && values.plan,
  'Packaged smoke consumes --main-vsix --notifier-vsix --package-receipt --plan; it never builds');
assertFormalEnvironment();
const plan = validateFrozenPlan(await readJSON(values.plan));
const packageReceipt = await readJSON(values['package-receipt']);
const candidateRoot = path.dirname(path.resolve(values['package-receipt']));
assert.equal(path.resolve(values['main-vsix']), path.join(candidateRoot, 'main.vsix'));
assert.equal(path.resolve(values['notifier-vsix']), path.join(candidateRoot, 'notifier.vsix'));
await verifyPackageFiles(packageReceipt, plan, candidateRoot);
const suites = selectSmokeSuites({ payload: 'packaged', scenario: values.scenario, group: values.group, diagnostic: plan.mode === 'diagnostic' });
const scenarios = suites.map(suite => suite.id);
assert(scenarios.length, 'Packaged suite selection must be nonempty');
for (const scenario of scenarios) assert(plan.tasks.some(task => task.job === 'packaged-host' && task.suite === scenario),
  'Packaged scenario is outside the frozen plan');

async function main() {
  if (process.platform !== 'linux') {
    throw new Error('当前 `test:vsix-smoke` 仅在 Linux 上收口。');
  }

  if (shouldReRunInsideXvfb()) {
    process.exit(runInsideXvfb(currentScriptPath, projectRoot));
  }

  await fs.rm(unpackRoot, { recursive: true, force: true });
  await fs.mkdir(debugRoot, { recursive: true });

  await unpackVsix(values['main-vsix'], unpackRoot);
  const notifierUnpackRoot = path.join(debugRoot, 'packaged-notifier');
  await fs.rm(notifierUnpackRoot, { recursive: true, force: true });
  await unpackVsix(values['notifier-vsix'], notifierUnpackRoot);

  const packagedExtensionPath = path.join(unpackRoot, 'extension');
  await validatePackagedExtension(packagedExtensionPath);
  const { smokeHostRoot, notifierRuntimeRoot } = await preparePackagedSmokeHostExtension({
    packagedExtensionPath,
    packagedNotifierPath: path.join(notifierUnpackRoot, 'extension'),
    root: debugRoot
  });
  const packagedExtensionTestsPath = resolveStagedSmokeTestPath(smokeHostRoot, 'extension-tests.cjs');

  for (const scenario of scenarios) {
    let workspacePath = projectRoot;
    if (scenario === 'owned-canvas-reconciliation') {
      workspacePath = path.join(debugRoot, 'owned-canvas.code-workspace');
      await fs.writeFile(workspacePath, JSON.stringify({ folders: [{ path: projectRoot }] }), 'utf8');
    }
    await runVSCodeScenario({
      projectRoot,
      debugRoot: path.join(debugRoot, scenario),
      runtimeDirName: `dsc-vsix-${scenario.replaceAll('/', '--')}`,
      workspacePath,
      extensionDevelopmentPath: [smokeHostRoot, notifierRuntimeRoot],
      extensionTestsPath: packagedExtensionTestsPath,
      disableWorkspaceTrust: true,
      extensionTestsEnv: {
        [SMOKE_TEST_MODE_ENV_KEY]: '1',
        DEV_SESSION_CANVAS_SMOKE_SCENARIO: scenario,
        DEV_SESSION_CANVAS_TEST_CODEX_COMMAND: fakeAgentProviderPath,
        DEV_SESSION_CANVAS_TEST_CLAUDE_COMMAND: missingAgentProviderPath
      }
    });
  }

  await verifyPackageFiles(packageReceipt, plan, candidateRoot);
  console.log(`VSIX packaged-payload smoke passed (${scenarios.join(', ')}).`);
}

async function preparePackagedSmokeHostExtension({ packagedExtensionPath, packagedNotifierPath, root }) {
  const smokeHostRoot = path.join(root, 'smoke-host');
  const notifierRuntimeRoot = path.join(smokeHostRoot, 'notifier-extension');
  await fs.rm(smokeHostRoot, { recursive: true, force: true });
  const beforeMain = await treeHashes(packagedExtensionPath);
  const beforeNotifier = await treeHashes(packagedNotifierPath);
  const beforeManifest=await readJSON(path.join(packagedExtensionPath,'package.json'));
  await copyPathRecursive(packagedExtensionPath, smokeHostRoot);
  await copyPathRecursive(packagedNotifierPath, notifierRuntimeRoot);
  await stageSmokeTestSuite({
    projectRoot,
    targetRoot: smokeHostRoot
  });

  const packageJsonPath = path.join(smokeHostRoot, 'package.json');
  const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf8'));
  delete packageJson.extensionDependencies;
  delete packageJson.extensionPack;
  packageJson.main = './extension.js';
  await fs.writeFile(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`, 'utf8');
  await fs.writeFile(path.join(smokeHostRoot, 'extension.js'), buildSmokeHostEntrySource(), 'utf8');
  const afterMain = await treeHashes(smokeHostRoot);
  const afterNotifier=await treeHashes(notifierRuntimeRoot);
  const modifications = verifyInstrumentation({beforeMain,beforeNotifier,afterMain,afterNotifier,
    beforeManifest,afterManifest:packageJson});
  await writeJSON(path.join(root, 'instrumentation-receipt.json'), { schemaVersion: 1,
    inputSHA: plan.inputSHA, packageReceiptDigest: objectDigest(packageReceipt),
    originalMain: await fileDigest(values['main-vsix']), originalNotifier: await fileDigest(values['notifier-vsix']),
    rules: ['main manifest dependency removal', 'main wrapper', 'staged test suite', 'nested notifier payload'],
    beforeMain, beforeNotifier, afterMain, modifications });

  return { smokeHostRoot, notifierRuntimeRoot };
}

function buildSmokeHostEntrySource() {
  return `const mainExtension = require('./dist/extension.js');

exports.activate = async function activate(context) {
  await Promise.resolve(mainExtension.activate?.(context));
};

exports.deactivate = async function deactivate() {
  await Promise.resolve(mainExtension.deactivate?.());
};
`;
}

async function unpackVsix(file, target) {
  const zip = await JSZip.loadAsync(await fs.readFile(file));
  for (const [name, entry] of Object.entries(zip.files)) {
    assert(!name.startsWith('/') && !name.includes('\\') && !name.split('/').includes('..'), 'Unsafe VSIX member');
    const destination = path.join(target, name);
    if (entry.dir) await fs.mkdir(destination, { recursive: true });
    else {
      await fs.mkdir(path.dirname(destination), { recursive: true });
      await fs.writeFile(destination, await entry.async('nodebuffer'), { mode: (entry.unixPermissions ?? 0o644) & 0o777 });
    }
  }
}

async function validatePackagedExtension(packagedExtensionPath) {
  const requiredPaths = [
    'package.json',
    'readme.md',
    path.join('dist', 'extension.js'),
    path.join('dist', 'webview.js'),
    path.join('dist', 'webview.css'),
    path.join('dist', 'sidebar-codicon.css'),
    path.join('images', 'icon.png'),
    path.join('scripts', 'runtime', 'claude-file-event-hook.cjs'),
    path.join('node_modules', 'node-pty', 'package.json')
  ];

  for (const relativePath of requiredPaths) {
    const absolutePath = path.join(packagedExtensionPath, relativePath);
    try {
      await fs.access(absolutePath);
    } catch {
      throw new Error(`打包产物缺少运行时文件：${relativePath}`);
    }
  }

  const forbiddenPaths = [
    '.github',
    path.join('images', 'lark-group-qr.png'),
    path.join('images', 'wechat-group-qr.png'),
    path.join('node_modules', 'node-pty', 'binding.gyp'),
    path.join('node_modules', 'node-pty', 'scripts'),
    path.join('node_modules', 'node-pty', 'src'),
    path.join('node_modules', 'node-pty', 'third_party'),
    path.join('node_modules', 'node-pty', 'typings'),
    path.join('node_modules', 'node-pty', 'node_modules'),
    path.join('node_modules', 'node-pty', 'prebuilds', 'win32-x64', 'conpty.pdb'),
    path.join('node_modules', 'node-pty', 'prebuilds', 'win32-x64', 'conpty_console_list.pdb'),
    path.join('node_modules', 'node-pty', 'prebuilds', 'win32-arm64', 'conpty.pdb'),
    path.join('node_modules', 'node-pty', 'prebuilds', 'win32-arm64', 'conpty_console_list.pdb')
  ];

  for (const relativePath of forbiddenPaths) {
    const absolutePath = path.join(packagedExtensionPath, relativePath);
    if (await pathExists(absolutePath)) {
      throw new Error(`打包产物仍包含应被排除的文件或目录：${relativePath}`);
    }
  }

  const packagedFiles = await listFilesRecursively(packagedExtensionPath);
  const unexpectedDebugFiles = packagedFiles.filter(
    (relativePath) => relativePath.endsWith('.pdb') || relativePath.endsWith('.map')
  );

  if (unexpectedDebugFiles.length > 0) {
    throw new Error(
      `打包产物仍包含调试冗余文件：${unexpectedDebugFiles.slice(0, 10).join(', ')}`
    );
  }

  const packagedReadmePath = path.join(packagedExtensionPath, 'readme.md');
  const packagedReadmeContents = await fs.readFile(packagedReadmePath, 'utf8');
  if (!packagedReadmeContents.includes(marketplaceReadmeMarker)) {
    throw new Error('打包产物中的 README 未命中 Marketplace README 标记，当前 VSIX 可能仍在携带仓库根 README。');
  }
}

async function pathExists(absolutePath) {
  try {
    await fs.access(absolutePath);
    return true;
  } catch {
    return false;
  }
}

async function listFilesRecursively(rootPath, prefix = '') {
  const entries = await fs.readdir(rootPath, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const absolutePath = path.join(rootPath, entry.name);
    const relativePath = path.join(prefix, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFilesRecursively(absolutePath, relativePath)));
      continue;
    }

    files.push(relativePath);
  }

  return files;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
