import os from 'os';
import path from 'path';
import { spawn, spawnSync } from 'child_process';
import { existsSync } from 'fs';
import { promises as fs } from 'fs';
import { downloadAndUnzipVSCode } from '@vscode/test-electron';

export function shouldReRunInsideXvfb() {
  return (
    process.platform === 'linux' &&
    !process.env.DISPLAY &&
    !process.env.WAYLAND_DISPLAY &&
    process.env.DEV_SESSION_CANVAS_XVFB !== '1'
  );
}

export function runInsideXvfb(currentScriptPath, projectRoot) {
  const result = spawnSync('xvfb-run', ['-a', process.execPath, currentScriptPath, ...process.argv.slice(2)], {
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

export async function runVSCodeScenario(options) {
  const runtime = await prepareRuntime(options);
  return launchPreparedVSCodeScenario({
    ...options,
    runtime
  });
}

export async function launchPreparedVSCodeScenario(options) {
  const runtime = options.runtime;
  const vscodeExecutablePath = await ensureVSCodeExecutable(options.projectRoot);
  const args = buildVSCodeArgs({
    workspacePath: options.workspacePath ?? options.projectRoot,
    extensionDevelopmentPath: options.extensionDevelopmentPath,
    extensionTestsPath: options.extensionTestsPath,
    userDataDir: runtime.userDataDir,
    extensionsDir: runtime.extensionsDir,
    disableWorkspaceTrust: options.disableWorkspaceTrust ?? true,
    extraLaunchArgs: options.extraLaunchArgs ?? []
  });

  try {
    await launchVSCodeTestProcess(vscodeExecutablePath, args, {
      ...runtime.environment,
      ...(options.extensionTestsEnv ?? {})
    });
  } catch (error) {
    await snapshotVSCodeLogs(runtime.userDataDir, runtime.artifactsDir);
    console.error(`Smoke test artifacts saved to ${runtime.artifactsDir}`);
    throw error;
  }

  return runtime;
}

export async function prepareRuntime(options) {
  const debugRoot = options.debugRoot;
  const userDataDir = path.join(debugRoot, 'user-data');
  const extensionsDir = path.join(debugRoot, 'extensions');
  const homeDir = path.join(debugRoot, 'home');
  const configDir = path.join(debugRoot, 'config');
  const cacheDir = path.join(debugRoot, 'cache');
  const runtimeDir = path.join(os.tmpdir(), options.runtimeDirName ?? 'dsc-vscode-smoke-runtime');
  const tmpDir = path.join(debugRoot, 'tmp');
  const artifactsDir = path.join(debugRoot, 'artifacts');

  await fs.rm(debugRoot, { recursive: true, force: true });
  await fs.mkdir(userDataDir, { recursive: true });
  await fs.mkdir(path.join(userDataDir, 'User'), { recursive: true });
  await fs.mkdir(extensionsDir, { recursive: true });
  await fs.mkdir(homeDir, { recursive: true });
  await fs.mkdir(configDir, { recursive: true });
  await fs.mkdir(cacheDir, { recursive: true });
  await fs.mkdir(path.join(cacheDir, 'mesa'), { recursive: true });
  await fs.rm(runtimeDir, { recursive: true, force: true });
  await fs.mkdir(runtimeDir, { recursive: true, mode: 0o700 });
  await fs.mkdir(tmpDir, { recursive: true });
  await fs.mkdir(artifactsDir, { recursive: true });

  if (options.userSettings) {
    await fs.writeFile(
      path.join(userDataDir, 'User', 'settings.json'),
      `${JSON.stringify(options.userSettings, null, 2)}\n`,
      'utf8'
    );
  }

  return {
    debugRoot,
    userDataDir,
    extensionsDir,
    homeDir,
    configDir,
    cacheDir,
    runtimeDir,
    tmpDir,
    artifactsDir,
    environment: {
      HOME: homeDir,
      XDG_CONFIG_HOME: configDir,
      XDG_CACHE_HOME: cacheDir,
      XDG_RUNTIME_DIR: runtimeDir,
      TMPDIR: tmpDir,
      MESA_SHADER_CACHE_DIR: path.join(cacheDir, 'mesa'),
      DEV_SESSION_CANVAS_SMOKE_ARTIFACT_DIR: artifactsDir,
      ...(options.extensionTestsEnv ?? {})
    }
  };
}

export async function snapshotVSCodeLogs(userDataDir, artifactsDir) {
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

export async function ensureVSCodeExecutable(projectRoot) {
  const existingPath = await findExistingVSCodeExecutablePath(projectRoot);
  if (existingPath) {
    return existingPath;
  }

  const installDir = await downloadAndUnzipVSCode({ version: 'stable' });
  return resolveVSCodeExecutablePath(installDir);
}

export async function findExistingVSCodeExecutablePath(projectRoot) {
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

function buildVSCodeArgs(options) {
  const args = [
    options.workspacePath,
    '--disable-extensions',
    '--log=trace',
    `--user-data-dir=${options.userDataDir}`,
    `--extensions-dir=${options.extensionsDir}`,
    '--no-sandbox',
    '--disable-gpu-sandbox',
    '--disable-updates',
    '--skip-welcome',
    '--skip-release-notes',
    ...options.extraLaunchArgs
  ];

  if (options.disableWorkspaceTrust) {
    args.push('--disable-workspace-trust');
  }

  args.push(`--extensionTestsPath=${options.extensionTestsPath}`);
  args.push(`--extensionDevelopmentPath=${options.extensionDevelopmentPath}`);
  return args;
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

async function launchVSCodeTestProcess(executablePath, args, extensionTestsEnv) {
  const fullEnv = {
    ...process.env,
    ...extensionTestsEnv
  };
  const shell = process.platform === 'win32';

  await new Promise((resolve, reject) => {
    const child = spawn(shell ? `"${executablePath}"` : executablePath, args, {
      env: fullEnv,
      shell
    });

    child.stdout.on('data', (chunk) => process.stdout.write(chunk));
    child.stderr.on('data', (chunk) => process.stderr.write(chunk));

    child.on('error', (error) => {
      reject(error);
    });

    let finished = false;
    const finalize = (code, signal) => {
      if (finished) {
        return;
      }

      finished = true;
      child.stdout.destroy();
      child.stderr.destroy();
      console.log(`Exit code:   ${code ?? signal}`);

      if (code !== 0) {
        reject(
          new Error(
            signal ? `Test run terminated with signal ${signal}.` : `Test run failed with code ${code}.`
          )
        );
        return;
      }

      resolve();
    };

    child.on('close', finalize);
    child.on('exit', finalize);
  });
}
