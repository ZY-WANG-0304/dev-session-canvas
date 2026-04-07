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

  await runVSCodeScenario({
    projectRoot,
    debugRoot: path.join(debugRoot, 'smoke-runtime'),
    runtimeDirName: 'dsc-vscode-vsix-smoke-runtime',
    workspacePath: projectRoot,
    extensionDevelopmentPath: packagedExtensionPath,
    extensionTestsPath,
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

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
