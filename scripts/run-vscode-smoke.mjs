import os from 'os';
import { spawnSync } from 'child_process';
import path from 'path';
import { existsSync } from 'fs';
import { promises as fs } from 'fs';
import { fileURLToPath } from 'url';
import { runTests } from '@vscode/test-electron';

const projectRoot = process.cwd();
const debugRoot = path.join(projectRoot, '.debug', 'vscode-smoke');
const userDataDir = path.join(debugRoot, 'user-data');
const extensionsDir = path.join(debugRoot, 'extensions');
const homeDir = path.join(debugRoot, 'home');
const configDir = path.join(debugRoot, 'config');
const cacheDir = path.join(debugRoot, 'cache');
const runtimeDir = path.join(os.tmpdir(), 'dsc-vscode-smoke-runtime');
const tmpDir = path.join(debugRoot, 'tmp');
const artifactsDir = path.join(debugRoot, 'artifacts');
const fakeAgentProviderPath = path.join(projectRoot, 'tests', 'vscode-smoke', 'fixtures', 'fake-agent-provider');
const missingAgentProviderPath = path.join(projectRoot, 'tests', 'vscode-smoke', 'fixtures', 'missing-agent-provider');
const currentScriptPath = fileURLToPath(import.meta.url);

async function main() {
  if (shouldReRunInsideXvfb()) {
    process.exit(runInsideXvfb());
  }

  await fs.rm(debugRoot, { recursive: true, force: true });
  await fs.mkdir(userDataDir, { recursive: true });
  await fs.mkdir(extensionsDir, { recursive: true });
  await fs.mkdir(homeDir, { recursive: true });
  await fs.mkdir(configDir, { recursive: true });
  await fs.mkdir(cacheDir, { recursive: true });
  await fs.mkdir(path.join(cacheDir, 'mesa'), { recursive: true });
  await fs.rm(runtimeDir, { recursive: true, force: true });
  await fs.mkdir(runtimeDir, { recursive: true, mode: 0o700 });
  await fs.mkdir(tmpDir, { recursive: true });
  await fs.mkdir(artifactsDir, { recursive: true });

  const vscodeExecutablePath = await findExistingVSCodeExecutablePath();
  try {
    await runTests({
      version: vscodeExecutablePath ? undefined : 'stable',
      vscodeExecutablePath,
      extensionDevelopmentPath: projectRoot,
      extensionTestsPath: path.join(projectRoot, 'tests', 'vscode-smoke', 'extension-tests.cjs'),
      launchArgs: [
        projectRoot,
        '--disable-extensions',
        '--log=trace',
        `--user-data-dir=${userDataDir}`,
        `--extensions-dir=${extensionsDir}`
      ],
      extensionTestsEnv: {
        HOME: homeDir,
        XDG_CONFIG_HOME: configDir,
        XDG_CACHE_HOME: cacheDir,
        XDG_RUNTIME_DIR: runtimeDir,
        TMPDIR: tmpDir,
        MESA_SHADER_CACHE_DIR: path.join(cacheDir, 'mesa'),
        DEV_SESSION_CANVAS_SMOKE_ARTIFACT_DIR: artifactsDir,
        DEV_SESSION_CANVAS_TEST_CODEX_COMMAND: fakeAgentProviderPath,
        DEV_SESSION_CANVAS_TEST_CLAUDE_COMMAND: missingAgentProviderPath
      }
    });
  } catch (error) {
    await snapshotVSCodeLogs(userDataDir, artifactsDir);
    console.error(`Smoke test artifacts saved to ${artifactsDir}`);
    throw error;
  }

  console.log('VS Code smoke test passed.');
}

async function snapshotVSCodeLogs(userDataDir, artifactsDir) {
  const logsRoot = path.join(userDataDir, 'logs');
  const entries = await fs.readdir(logsRoot, { withFileTypes: true }).catch(() => []);
  const latestDir = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .pop();

  if (!latestDir) {
    return;
  }

  const sourceDir = path.join(logsRoot, latestDir);
  const targetDir = path.join(artifactsDir, 'vscode-logs');
  await fs.rm(targetDir, { recursive: true, force: true });
  await fs.cp(sourceDir, targetDir, { recursive: true });
}

function shouldReRunInsideXvfb() {
  return (
    process.platform === 'linux' &&
    !process.env.DISPLAY &&
    !process.env.WAYLAND_DISPLAY &&
    process.env.DEV_SESSION_CANVAS_XVFB !== '1'
  );
}

function runInsideXvfb() {
  const result = spawnSync('xvfb-run', ['-a', process.execPath, currentScriptPath], {
    cwd: projectRoot,
    stdio: 'inherit',
    env: {
      ...process.env,
      DEV_SESSION_CANVAS_XVFB: '1'
    }
  });

  if (result.error) {
    throw result.error;
  }

  return result.status ?? 1;
}

async function findExistingVSCodeExecutablePath() {
  const vscodeTestRoot = path.join(projectRoot, '.vscode-test');
  const entries = await fs.readdir(vscodeTestRoot, { withFileTypes: true }).catch(() => []);
  const candidateDirs = entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('vscode-'))
    .map((entry) => path.join(vscodeTestRoot, entry.name))
    .sort()
    .reverse();

  for (const candidateDir of candidateDirs) {
    const executablePath = resolveVSCodeExecutablePath(candidateDir);
    if (existsSync(executablePath)) {
      return executablePath;
    }
  }

  return undefined;
}

function resolveVSCodeExecutablePath(installDir) {
  if (process.platform === 'win32') {
    return path.join(installDir, 'Code.exe');
  }

  if (process.platform === 'darwin') {
    return path.join(installDir, 'Visual Studio Code.app', 'Contents', 'MacOS', 'Electron');
  }

  return path.join(installDir, 'code');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
