import path from 'path';
import { spawnSync } from 'child_process';
import { promises as fs } from 'fs';
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
const debugRoot = path.join(projectRoot, '.debug', 'vscode-vsix-smoke');
const unpackRoot = path.join(debugRoot, 'packaged-extension');
const marketplaceReadmeMarker = '<!-- dev-session-canvas-marketplace-readme -->';

async function main() {
  if (process.platform !== 'linux') {
    throw new Error('当前 `test:vsix-smoke` 仅在 Linux 上收口。');
  }

  if (shouldReRunInsideXvfb()) {
    process.exit(runInsideXvfb(currentScriptPath, projectRoot));
  }

  await fs.rm(unpackRoot, { recursive: true, force: true });
  await fs.mkdir(debugRoot, { recursive: true });

  runCommand('npm', ['run', 'package:vsix'], 'VSIX 打包失败。');

  const vsixPath = await resolveLatestVsixPath();
  runCommand('unzip', ['-q', '-o', vsixPath, '-d', unpackRoot], 'VSIX 解包失败。');

  const packagedExtensionPath = path.join(unpackRoot, 'extension');
  await validatePackagedExtension(packagedExtensionPath);
  const packagedExtensionTestsPath = await preparePackagedExtensionTests(packagedExtensionPath);

  await runVSCodeScenario({
    projectRoot,
    debugRoot: path.join(debugRoot, 'smoke-runtime'),
    runtimeDirName: 'dsc-vscode-vsix-smoke-runtime',
    workspacePath: projectRoot,
    extensionDevelopmentPath: packagedExtensionPath,
    extensionTestsPath: packagedExtensionTestsPath,
    disableWorkspaceTrust: true,
    extensionTestsEnv: {
      DEV_SESSION_CANVAS_SMOKE_SCENARIO: 'trusted',
      DEV_SESSION_CANVAS_TEST_CODEX_COMMAND: fakeAgentProviderPath,
      DEV_SESSION_CANVAS_TEST_CLAUDE_COMMAND: missingAgentProviderPath
    }
  });

  console.log('VSIX packaged-payload smoke passed.');
}

async function resolveLatestVsixPath() {
  const entries = await fs.readdir(projectRoot, { withFileTypes: true });
  const candidates = await Promise.all(
    entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.vsix'))
      .map(async (entry) => {
        const absolutePath = path.join(projectRoot, entry.name);
        const stat = await fs.stat(absolutePath);
        return {
          absolutePath,
          mtimeMs: stat.mtimeMs
        };
      })
  );

  const latest = candidates.sort((left, right) => right.mtimeMs - left.mtimeMs)[0];
  if (!latest) {
    throw new Error('未找到 VSIX 产物。请先确认 `npm run package:vsix` 成功。');
  }

  return latest.absolutePath;
}

async function validatePackagedExtension(packagedExtensionPath) {
  const requiredPaths = [
    'package.json',
    'readme.md',
    path.join('dist', 'extension.js'),
    path.join('dist', 'webview.js'),
    path.join('dist', 'webview.css'),
    path.join('images', 'icon.png'),
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
    path.join('node_modules', 'node-pty', 'binding.gyp'),
    path.join('node_modules', 'node-pty', 'scripts'),
    path.join('node_modules', 'node-pty', 'src'),
    path.join('node_modules', 'node-pty', 'third_party'),
    path.join('node_modules', 'node-pty', 'typings'),
    path.join('node_modules', 'node-pty', 'node_modules')
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

async function preparePackagedExtensionTests(packagedExtensionPath) {
  // Keep the smoke test entrypoint under the unpacked extension root so
  // `require("vscode")` resolves to the same extension-scoped API object.
  const testsRoot = path.join(packagedExtensionPath, '.smoke-tests');
  const packagedTestsPath = path.join(testsRoot, path.basename(extensionTestsPath));
  await fs.mkdir(testsRoot, { recursive: true });
  await fs.copyFile(extensionTestsPath, packagedTestsPath);
  return packagedTestsPath;
}

function runCommand(file, args, errorMessage) {
  const result = spawnSync(file, args, {
    cwd: projectRoot,
    stdio: 'inherit'
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(errorMessage);
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
