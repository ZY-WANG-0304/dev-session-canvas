import os from 'os';
import path from 'path';
import { spawn, spawnSync } from 'child_process';
import { existsSync, statSync } from 'fs';
import { promises as fs } from 'fs';
import { downloadAndUnzipVSCode } from '@vscode/test-electron';

const BLOCKED_VSCODE_ENV_PREFIXES = ['VSCODE_'];
const BLOCKED_VSCODE_ENV_KEYS = new Set(['ELECTRON_RUN_AS_NODE']);
const BLOCKED_VSCODE_ENV_SECRET_PATTERNS = [
  /TOKEN/iu,
  /SECRET/iu,
  /PASSWORD/iu,
  /PASSWD/iu,
  /CREDENTIAL/iu,
  /API_KEY/iu,
  /ACCESS_KEY/iu,
  /PRIVATE_KEY/iu,
  /AUTHORIZATION/iu
];
const STAGED_SMOKE_TESTS_ROOT = path.join('tests', 'vscode-smoke');

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
  const vscodeExecutablePath = options.vscodeExecutablePath ?? (await ensureVSCodeExecutable(options.projectRoot));
  const args = buildVSCodeArgs({
    workspacePath: options.workspacePath ?? options.projectRoot,
    folderUri: options.folderUri,
    remoteAuthority: options.remoteAuthority,
    extensionDevelopmentPath: options.extensionDevelopmentPath,
    extensionTestsPath: options.extensionTestsPath,
    userDataDir: runtime.userDataDir,
    extensionsDir: runtime.extensionsDir,
    disableWorkspaceTrust: options.disableWorkspaceTrust ?? true,
    disableExtensions: options.disableExtensions ?? true,
    profileName: options.profileName,
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

export async function spawnPreparedVSCodeScenario(options) {
  const runtime = options.runtime;
  const vscodeExecutablePath = options.vscodeExecutablePath ?? (await ensureVSCodeExecutable(options.projectRoot));
  const args = buildVSCodeArgs({
    workspacePath: options.workspacePath ?? options.projectRoot,
    folderUri: options.folderUri,
    remoteAuthority: options.remoteAuthority,
    extensionDevelopmentPath: options.extensionDevelopmentPath,
    extensionTestsPath: options.extensionTestsPath,
    userDataDir: runtime.userDataDir,
    extensionsDir: runtime.extensionsDir,
    disableWorkspaceTrust: options.disableWorkspaceTrust ?? true,
    disableExtensions: options.disableExtensions ?? true,
    profileName: options.profileName,
    extraLaunchArgs: options.extraLaunchArgs ?? []
  });

  const handle = spawnVSCodeTestProcess(vscodeExecutablePath, args, {
    ...runtime.environment,
    ...(options.extensionTestsEnv ?? {})
  });
  return {
    ...handle,
    completed: handle.completed.catch(async (error) => {
      await snapshotVSCodeLogs(runtime.userDataDir, runtime.artifactsDir);
      console.error(`Smoke test artifacts saved to ${runtime.artifactsDir}`);
      throw error;
    })
  };
}

export function resolveVSCodeSmokeDebugRoot(projectRoot) {
  const override = process.env.DEV_SESSION_CANVAS_SMOKE_DEBUG_ROOT?.trim();
  if (override) {
    return override;
  }

  return path.join(projectRoot, '.debug', 'vscode-smoke');
}

export async function prepareRuntime(options) {
  const debugRoot = options.debugRoot;
  const userDataDir = path.join(debugRoot, 'user-data');
  const extensionsDir = path.join(debugRoot, 'extensions');
  const homeDir = path.join(debugRoot, 'home');
  const configDir = path.join(debugRoot, 'config');
  const cacheDir = path.join(debugRoot, 'cache');
  const appDataDir = path.join(debugRoot, 'appdata');
  const localAppDataDir = path.join(debugRoot, 'local-appdata');
  const runtimeDir = path.join(os.tmpdir(), options.runtimeDirName ?? 'dsc-vscode-smoke-runtime');
  const stateDir = path.join(runtimeDir, 'state');
  const tmpDir = path.join(debugRoot, 'tmp');
  const artifactsDir = path.join(debugRoot, 'artifacts');

  await fs.rm(debugRoot, { recursive: true, force: true });
  await fs.mkdir(userDataDir, { recursive: true });
  await fs.mkdir(path.join(userDataDir, 'User'), { recursive: true });
  await fs.mkdir(extensionsDir, { recursive: true });
  await fs.mkdir(homeDir, { recursive: true });
  await fs.mkdir(configDir, { recursive: true });
  await fs.mkdir(cacheDir, { recursive: true });
  await fs.mkdir(appDataDir, { recursive: true });
  await fs.mkdir(localAppDataDir, { recursive: true });
  await fs.mkdir(path.join(cacheDir, 'mesa'), { recursive: true });
  await fs.rm(runtimeDir, { recursive: true, force: true });
  await fs.mkdir(runtimeDir, { recursive: true, mode: 0o700 });
  await fs.mkdir(stateDir, { recursive: true });
  await fs.mkdir(tmpDir, { recursive: true });
  await fs.mkdir(artifactsDir, { recursive: true });

  if (options.userSettings) {
    await writeUserSettings(userDataDir, options.userSettings);
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
      USERPROFILE: homeDir,
      APPDATA: appDataDir,
      LOCALAPPDATA: localAppDataDir,
      XDG_CONFIG_HOME: configDir,
      XDG_CACHE_HOME: cacheDir,
      XDG_STATE_HOME: stateDir,
      XDG_RUNTIME_DIR: runtimeDir,
      TMPDIR: tmpDir,
      TMP: tmpDir,
      TEMP: tmpDir,
      MESA_SHADER_CACHE_DIR: path.join(cacheDir, 'mesa'),
      DEV_SESSION_CANVAS_SMOKE_ARTIFACT_DIR: artifactsDir,
      ...(options.extensionTestsEnv ?? {})
    }
  };
}

export async function prepareMainSmokeHostExtension(options) {
  const smokeHostRoot = options.targetRoot;
  await fs.rm(smokeHostRoot, { recursive: true, force: true });
  await fs.mkdir(smokeHostRoot, { recursive: true });

  for (const entry of ['package.json', 'package.nls.json', 'dist', 'images', 'resources', 'node_modules', 'scripts']) {
    const sourcePath = path.join(options.projectRoot, entry);
    const targetPath = path.join(smokeHostRoot, entry);
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await copyPathRecursive(sourcePath, targetPath);
  }

  const packageJsonPath = path.join(smokeHostRoot, 'package.json');
  const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf8'));
  delete packageJson.extensionDependencies;
  delete packageJson.extensionPack;
  await fs.writeFile(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`, 'utf8');
  await stageSmokeTestSuite({
    projectRoot: options.projectRoot,
    targetRoot: smokeHostRoot
  });

  return smokeHostRoot;
}

export async function stageSmokeTestSuite(options) {
  const sourceRoot = path.join(options.projectRoot, STAGED_SMOKE_TESTS_ROOT);
  const targetRoot = path.join(options.targetRoot, STAGED_SMOKE_TESTS_ROOT);
  await fs.mkdir(path.dirname(targetRoot), { recursive: true });
  await fs.rm(targetRoot, { recursive: true, force: true });
  await copyPathRecursive(sourceRoot, targetRoot);
  return targetRoot;
}

export function resolveStagedSmokeTestPath(targetRoot, testFileName) {
  return path.join(targetRoot, STAGED_SMOKE_TESTS_ROOT, testFileName);
}

export async function stageBundledExtension(options) {
  const packageJsonPath = path.join(options.sourceRoot, 'package.json');
  const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf8'));
  const extensionDirName = `${packageJson.publisher}.${packageJson.name}-${packageJson.version}`;
  const targetRoot = path.join(options.extensionsDir, extensionDirName);
  await fs.rm(targetRoot, { recursive: true, force: true });
  await copyPathRecursive(options.sourceRoot, targetRoot);
  return targetRoot;
}

export async function copyPathRecursive(sourcePath, targetPath) {
  await fs.cp(sourcePath, targetPath, {
    recursive: true,
    dereference: true,
    force: true
  });
}

export async function writeUserSettings(userDataDir, userSettings) {
  await fs.mkdir(path.join(userDataDir, 'User'), { recursive: true });
  await fs.writeFile(
    path.join(userDataDir, 'User', 'settings.json'),
    `${JSON.stringify(userSettings, null, 2)}\n`,
    'utf8'
  );
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
  const preferredInstalledPath = findPreferredInstalledVSCodeExecutablePath();
  if (preferredInstalledPath) {
    return preferredInstalledPath;
  }

  const existingPath = await findExistingVSCodeExecutablePath(projectRoot);
  if (existingPath) {
    return existingPath;
  }

  const downloadResult = await downloadAndUnzipVSCode({
    version: 'stable',
    cachePath: resolveVSCodeTestCachePath(projectRoot)
  });
  return normalizeVSCodeExecutablePath(downloadResult);
}

export async function findExistingVSCodeExecutablePath(projectRoot) {
  const vscodeTestRoot = resolveVSCodeTestCachePath(projectRoot);
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

export function buildVSCodeArgs(options) {
  const args = [];
  if (options.remoteAuthority) {
    args.push('--remote', options.remoteAuthority);
  }

  if (options.folderUri) {
    args.push(`--folder-uri=${options.folderUri}`);
  } else if (options.workspacePath) {
    args.push(options.workspacePath);
  }

  if (options.disableExtensions !== false) {
    args.push('--disable-extensions');
  }

  args.push(
    '--log=trace',
    `--user-data-dir=${options.userDataDir}`,
    `--extensions-dir=${options.extensionsDir}`,
    '--no-sandbox',
    '--disable-gpu-sandbox',
    '--password-store=basic',
    '--disable-updates',
    '--skip-welcome',
    '--skip-release-notes'
  );

  if (options.profileName) {
    args.push(`--profile=${options.profileName}`);
  }

  args.push(...options.extraLaunchArgs);

  if (options.disableWorkspaceTrust) {
    args.push('--disable-workspace-trust');
  }

  args.push(`--extensionTestsPath=${options.extensionTestsPath}`);
  const extensionDevelopmentPaths = Array.isArray(options.extensionDevelopmentPath)
    ? options.extensionDevelopmentPath
    : [options.extensionDevelopmentPath];
  for (const extensionDevelopmentPath of extensionDevelopmentPaths) {
    args.push(`--extensionDevelopmentPath=${extensionDevelopmentPath}`);
  }
  return args;
}

function resolveVSCodeTestCachePath(projectRoot) {
  const override = process.env.DEV_SESSION_CANVAS_VSCODE_TEST_CACHE_PATH?.trim();
  if (override) {
    return override;
  }

  return path.join(projectRoot, '.vscode-test');
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

function normalizeVSCodeExecutablePath(downloadResult) {
  if (existsSync(downloadResult)) {
    try {
      if (!statSync(downloadResult).isDirectory()) {
        return downloadResult;
      }
    } catch {
      // Fall through to directory-style resolution.
    }
  }

  return resolveVSCodeExecutablePath(downloadResult);
}

function findPreferredInstalledVSCodeExecutablePath() {
  if (process.env.DEV_SESSION_CANVAS_VSCODE_USE_TEST_DOWNLOAD === '1') {
    return undefined;
  }

  const candidates = [
    process.env.DEV_SESSION_CANVAS_VSCODE_EXECUTABLE?.trim(),
    process.env.LOCALAPPDATA
      ? path.join(process.env.LOCALAPPDATA, 'Programs', 'Microsoft VS Code', 'Code.exe')
      : undefined,
    process.env['ProgramFiles']
      ? path.join(process.env['ProgramFiles'], 'Microsoft VS Code', 'Code.exe')
      : undefined,
    process.env['ProgramFiles(x86)']
      ? path.join(process.env['ProgramFiles(x86)'], 'Microsoft VS Code', 'Code.exe')
      : undefined
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return undefined;
}

async function launchVSCodeTestProcess(executablePath, args, extensionTestsEnv) {
  const handle = spawnVSCodeTestProcess(executablePath, args, extensionTestsEnv);
  await handle.completed;
}

function spawnVSCodeTestProcess(executablePath, args, extensionTestsEnv) {
  const fullEnv = buildVSCodeChildEnv(extensionTestsEnv);
  const shell = process.platform === 'win32';
  const launchPath = resolveVSCodeTestLaunchPath(executablePath);

  const child = spawn(shell ? `"${launchPath}"` : launchPath, args, {
    env: fullEnv,
    shell
  });

  child.stdout.on('data', (chunk) => process.stdout.write(chunk));
  child.stderr.on('data', (chunk) => process.stderr.write(chunk));

  const completed = new Promise((resolve, reject) => {
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

  return {
    child,
    completed,
    kill: (signal = 'SIGTERM') => {
      if (!child.killed) {
        child.kill(signal);
      }
    }
  };
}

export async function installVSCodeExtensions(options) {
  if (!options.extensionIds?.length) {
    return;
  }

  const cliPath = resolveVSCodeCliPath(options.vscodeExecutablePath);
  const args = [
    `--user-data-dir=${options.userDataDir}`,
    `--extensions-dir=${options.extensionsDir}`
  ];
  for (const extensionId of options.extensionIds) {
    args.push('--install-extension', extensionId);
  }
  args.push('--force');

  await new Promise((resolve, reject) => {
    const child = spawn(cliPath, args, {
      env: buildVSCodeChildEnv(options.environment ?? {})
    });

    child.stdout.on('data', (chunk) => process.stdout.write(chunk));
    child.stderr.on('data', (chunk) => process.stderr.write(chunk));
    child.on('error', reject);
    child.on('close', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(
        new Error(
          signal
            ? `VS Code CLI extension install terminated with signal ${signal}.`
            : `VS Code CLI extension install failed with code ${code}.`
        )
      );
    });
  });
}

export function buildVSCodeChildEnv(overrides = {}) {
  const env = {
    ...process.env,
    ...overrides
  };

  for (const key of Object.keys(env)) {
    if (
      BLOCKED_VSCODE_ENV_KEYS.has(key) ||
      BLOCKED_VSCODE_ENV_PREFIXES.some((prefix) => key.startsWith(prefix)) ||
      BLOCKED_VSCODE_ENV_SECRET_PATTERNS.some((pattern) => pattern.test(key))
    ) {
      delete env[key];
    }
  }

  return env;
}

function resolveVSCodeCliPath(vscodeExecutablePath) {
  const normalizedExecutablePath = vscodeExecutablePath.toLowerCase();
  if (
    normalizedExecutablePath.endsWith(`${path.sep}bin${path.sep}code.cmd`) ||
    normalizedExecutablePath.endsWith('/bin/code.cmd')
  ) {
    return vscodeExecutablePath;
  }
  if (process.platform === 'win32') {
    return path.join(path.dirname(vscodeExecutablePath), 'bin', 'code.cmd');
  }

  if (process.platform === 'darwin') {
    return path.join(
      path.dirname(path.dirname(vscodeExecutablePath)),
      'Resources',
      'app',
      'bin',
      'code'
    );
  }

  return path.join(path.dirname(vscodeExecutablePath), 'bin', 'code');
}

function resolveVSCodeTestLaunchPath(vscodeExecutablePath) {
  if (process.platform !== 'win32') {
    return vscodeExecutablePath;
  }

  const cliPath = resolveVSCodeCliPath(vscodeExecutablePath);
  return existsSync(cliPath) ? cliPath : vscodeExecutablePath;
}
