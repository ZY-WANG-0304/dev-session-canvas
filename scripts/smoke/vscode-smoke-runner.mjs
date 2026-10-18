import os from 'os';
import assert from 'node:assert/strict';
import path from 'path';
import { execFile, spawn, spawnSync } from 'child_process';
import { existsSync, readFileSync, statSync } from 'fs';
import { promises as fs } from 'fs';
import { downloadAndUnzipVSCode } from '@vscode/test-electron';
import esbuild from 'esbuild';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { runProcess,retireProcessGroup } from '../gates/process.mjs';
import { environmentPolicy, infrastructureBudgets } from '../gates/catalog.mjs';

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
const MAIN_EXTENSION_RELATIVE_ROOT = path.join('extensions', 'vscode', 'dev-session-canvas');
const LINUX_HEADLESS_STABILITY_ARGS = ['--disable-gpu', '--disable-dev-shm-usage'];

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
    extensionHostEnv: options.extensionHostEnv,
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
    extensionHostEnv: options.extensionHostEnv,
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
  const requestedRuntimeName = options.runtimeDirName ?? 'dsc-vscode-smoke-runtime';
  const runtimeNonce = process.env.DEV_SESSION_CANVAS_GATE_RUN_NONCE;
  const longSocket = path.join(os.tmpdir(), requestedRuntimeName, 'state', 'dsc', 'rh', '0'.repeat(24), 's.sock');
  // Case IDs can be long. Keep the real systemd and VS Code IPC observations
  // within the OS socket limit, and isolate concurrent formal run/attempts.
  // Shared-window setup passes the same name and nonce to both participants.
  const runtimeName = runtimeNonce || Buffer.byteLength(longSocket) > 107
    ? `dsc-${createHash('sha256').update(`${requestedRuntimeName}\0${runtimeNonce ?? ''}`).digest('hex').slice(0, 16)}`
    : requestedRuntimeName;
  const runtimeDir = path.join(os.tmpdir(), runtimeName);
  // With no XDG_RUNTIME_DIR, VSCode puts its Unix IPC socket under user-data.
  // Keep that path short for the real missing-bus fixture without changing its bus environment.
  const userDataDir = path.join(options.userDataInRuntimeDir ? runtimeDir : debugRoot, 'user-data');
  const extensionsDir = path.join(debugRoot, 'extensions');
  const homeDir = path.join(debugRoot, 'home');
  const configDir = path.join(debugRoot, 'config');
  const cacheDir = path.join(debugRoot, 'cache');
  const appDataDir = path.join(debugRoot, 'appdata');
  const localAppDataDir = path.join(debugRoot, 'local-appdata');
  const stateDir = path.join(runtimeDir, 'state');
  const tmpDir = path.join(debugRoot, 'tmp');
  const artifactsDir = path.join(debugRoot, 'artifacts');

  await fs.rm(debugRoot, { recursive: true, force: true });
  await fs.rm(runtimeDir, { recursive: true, force: true });
  await fs.mkdir(runtimeDir, { recursive: true, mode: 0o700 });
  await fs.mkdir(userDataDir, { recursive: true });
  await fs.mkdir(path.join(userDataDir, 'User'), { recursive: true });
  await fs.mkdir(extensionsDir, { recursive: true });
  await fs.mkdir(homeDir, { recursive: true });
  await fs.mkdir(configDir, { recursive: true });
  await fs.mkdir(cacheDir, { recursive: true });
  await fs.mkdir(appDataDir, { recursive: true });
  await fs.mkdir(localAppDataDir, { recursive: true });
  await fs.mkdir(path.join(cacheDir, 'mesa'), { recursive: true });
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
      ...(process.env.DEV_SESSION_CANVAS_GATE_HOST_RECEIPTS?{
        DEV_SESSION_CANVAS_GATE_STORAGE_ROOT:options.gateStorageRoot??debugRoot,
        DEV_SESSION_CANVAS_GATE_STORAGE_ROOTS:JSON.stringify([options.gateStorageRoot??debugRoot,runtimeDir])}:{}),
      ...(options.extensionTestsEnv ?? {})
    }
  };
}

export async function prepareMainSmokeHostExtension(options) {
  const smokeHostRoot = options.targetRoot;
  const sourceRoot = options.sourceRoot ?? path.join(options.projectRoot, MAIN_EXTENSION_RELATIVE_ROOT);
  await fs.rm(smokeHostRoot, { recursive: true, force: true });
  await fs.mkdir(smokeHostRoot, { recursive: true });

  for (const entry of ['package.json', 'package.nls.json', 'package.nls.zh-cn.json', 'l10n', 'dist', 'images', 'resources', 'node_modules', 'scripts']) {
    const sourcePath =
      entry === 'node_modules'
        ? path.join(options.projectRoot, entry)
        : path.join(sourceRoot, entry);
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

export async function buildHistoricalRuntimeSupervisorFixture(options) {
  const sourceRoot = options.sourceRoot;
  const extensionRoot = path.join('extensions', 'vscode', 'dev-session-canvas');
  const sourcePrefix = path.join(extensionRoot, 'src');
  await fs.rm(sourceRoot, { recursive: true, force: true });
  await fs.mkdir(sourceRoot, { recursive: true });

  const listedFiles = await execFileText(
    'git',
    ['ls-tree', '-r', '--name-only', options.ref, '--', sourcePrefix],
    { cwd: options.projectRoot }
  );
  const sourceFiles = listedFiles
    .split(/\r?\n/u)
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (sourceFiles.length === 0) {
    throw new Error(`Historical Supervisor source is unavailable at ${options.ref}.`);
  }

  for (const repositoryPath of sourceFiles) {
    const relativePath = path.relative(extensionRoot, repositoryPath);
    if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
      throw new Error(`Historical Supervisor source escaped the extension root: ${repositoryPath}`);
    }
    const targetPath = path.join(sourceRoot, relativePath);
    const contents = await execFileText(
      'git',
      ['show', `${options.ref}:${repositoryPath}`],
      { cwd: options.projectRoot }
    );
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.writeFile(targetPath, contents, 'utf8');
  }

  await fs.mkdir(path.dirname(options.outfile), { recursive: true });
  await esbuild.build({
    entryPoints: [path.join(sourceRoot, 'src', 'supervisor', 'runtimeSupervisorMain.ts')],
    // This historical fixture lives in the evidence directory, outside the
    // repository's dependency ancestry. Bundle its real declared imports from
    // the locked checkout instead of making them unresolved externals.
    nodePaths: [path.join(options.projectRoot, 'node_modules')],
    bundle: true,
    external: ['node-pty'],
    format: 'cjs',
    outfile: options.outfile,
    platform: 'node',
    target: 'node18',
    sourcemap: false,
    banner: {
      js: `// Historical runtime supervisor fixture built from ${options.ref}.`
    }
  });

  return options.outfile;
}

export async function stageSmokeTestSuite(options) {
  const sourceRoot = path.join(options.projectRoot, STAGED_SMOKE_TESTS_ROOT);
  const targetRoot = path.join(options.targetRoot, STAGED_SMOKE_TESTS_ROOT);
  await fs.mkdir(path.dirname(targetRoot), { recursive: true });
  await fs.rm(targetRoot, { recursive: true, force: true });
  await copyPathRecursive(sourceRoot, targetRoot);
  await esbuild.build({
    entryPoints: [path.join(sourceRoot, 'terminal-history.cjs')],
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'cjs',
    outfile: path.join(targetRoot, 'terminal-history.cjs')
  });
  await esbuild.build({
    entryPoints: [path.join(options.projectRoot, 'scripts/smoke/smoke-catalog.mjs')],
    bundle: true, platform: 'node', target: 'node22', format: 'esm',
    outfile: path.join(targetRoot, 'smoke-catalog.mjs')
  });
  if (process.env.DEV_SESSION_CANVAS_GATE_HOST_RECEIPTS) {
    const tests = (await fs.readdir(targetRoot)).filter(name => name.endsWith('-tests.cjs'));
    for (const testFile of tests) {
      await fs.writeFile(path.join(targetRoot, `gate-${testFile}`),
        `exports.run = () => require('./gate-host-entry.cjs').runWrapped(${JSON.stringify(testFile)});\n`);
    }
  }
  return targetRoot;
}

export function resolveStagedSmokeTestPath(targetRoot, testFileName) {
  return path.join(targetRoot, STAGED_SMOKE_TESTS_ROOT,
    process.env.DEV_SESSION_CANVAS_GATE_HOST_RECEIPTS ? `gate-${testFileName}` : testFileName);
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

function execFileText(file, args, options) {
  return new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      {
        ...options,
        encoding: 'utf8',
        maxBuffer: 32 * 1024 * 1024
      },
      (error, stdout, stderr) => {
        if (error) {
          const detail = stderr.trim();
          reject(new Error(detail ? `${error.message}: ${detail}` : error.message));
          return;
        }
        resolve(stdout);
      }
    );
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
  if (process.env.DEV_SESSION_CANVAS_GATE_PLAN || process.env.DEV_SESSION_CANVAS_VSCODE_VERSION) {
    const version = process.env.DEV_SESSION_CANVAS_VSCODE_VERSION || environmentPolicy.vscode;
    if (version !== environmentPolicy.vscode && process.env.DEV_SESSION_CANVAS_GATE_PLAN) {
      throw new Error('Formal gate refuses a non-plan VS Code version');
    }
    const cache=resolveVSCodeTestCachePath(projectRoot);await fs.mkdir(cache,{recursive:true});
    const output=path.join(cache,`download-${process.pid}-${Date.now()}.txt`);
    let downloaded;
    try {
      const observed=await runProcess(process.execPath,[fileURLToPath(new URL('./download-vscode.mjs',import.meta.url)),
        '--version',version,'--cache',cache,'--output',output],{deadline:Math.min(Date.now()+infrastructureBudgets.download,
          Number(process.env.DEV_SESSION_CANVAS_GATE_DEADLINE)||Infinity),
        logPath:output.replace('.txt','.log')});
      if(observed.status!=='passed')throw new Error(`Fixed VS Code download failed: ${JSON.stringify(observed)}`);
      downloaded=(await fs.readFile(output,'utf8')).trim();
    }finally{await fs.rm(output,{force:true});}
    const executable = normalizeVSCodeExecutablePath(downloaded);
    const appRoot = await resolveVSCodeAppRoot(executable);
    const product = JSON.parse(await fs.readFile(path.join(appRoot, 'package.json'), 'utf8'));
    if (product.version !== version) throw new Error(`Downloaded host version differs: ${product.version}`);
    return executable;
  }
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

export async function resolveVSCodeAppRoot(executable,platform=process.platform) {
  if(platform==='darwin')return path.resolve(path.dirname(executable),'../Resources/app');
  const root=path.dirname(executable);
  const direct=path.join(root,'resources','app');
  if(existsSync(path.join(direct,'package.json')))return direct;
  if(platform==='win32') {
    const entries=await fs.readdir(root,{withFileTypes:true});
    const matches=entries.filter(entry=>entry.isDirectory()&&existsSync(path.join(root,entry.name,'resources','app','package.json')));
    if(matches.length===1)return path.join(root,matches[0].name,'resources','app');
  }
  throw new Error('Fixed VS Code application manifest is missing or ambiguous');
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

export function buildVSCodeArgs(options, platform = process.platform) {
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
    '--log=debug',
    `--user-data-dir=${options.userDataDir}`,
    `--extensions-dir=${options.extensionsDir}`,
    '--no-sandbox',
    '--disable-gpu-sandbox',
    ...resolveVSCodeSmokeStabilityArgs(platform),
    '--password-store=basic',
    // A detached upstream crash reporter is outside the product execution
    // contract and can inherit logs after Code exits. Keep this fixture
    // subsystem disabled at launch; original Host/resource checks stay strict.
    '--disable-crash-reporter',
    ...(platform === 'darwin' ? ['--use-inmemory-secretstorage'] : []),
    '--disable-updates',
    '--skip-welcome',
    '--skip-release-notes'
  );

  if (options.profileName) {
    args.push(`--profile=${options.profileName}`);
  }

  if (options.extensionHostEnv) {
    assert(options.remoteAuthority, 'Explicit remote Host environment requires its declared authority');
    // VS Code forwards this launch environment to the selected remote Host.
    // sshd SetEnv alone only proves the transport shell, not that Host.
    args.push(`--extensionEnvironment=${JSON.stringify(options.extensionHostEnv)}`);
  }

  args.push(...(options.extraLaunchArgs??[]));

  if (options.disableWorkspaceTrust) {
    args.push('--disable-workspace-trust');
  }

  if (options.extensionTestsPath) {
    args.push(`--extensionTestsPath=${options.extensionTestsPath}`);
  }
  const extensionDevelopmentPaths = Array.isArray(options.extensionDevelopmentPath)
    ? options.extensionDevelopmentPath
    : [options.extensionDevelopmentPath];
  for (const extensionDevelopmentPath of extensionDevelopmentPaths) {
    args.push(`--extensionDevelopmentPath=${extensionDevelopmentPath}`);
  }
  return args;
}

function resolveVSCodeSmokeStabilityArgs(platform) {
  if (platform !== 'linux') {
    return [];
  }

  return LINUX_HEADLESS_STABILITY_ARGS;
}

function resolveVSCodeTestCachePath(projectRoot) {
  const override = process.env.DEV_SESSION_CANVAS_VSCODE_TEST_CACHE_PATH?.trim();
  if (override) {
    return override;
  }

  return path.join(projectRoot, '.vscode-test');
}

function resolveVSCodeExecutablePath(installDir, platform = process.platform) {
  if (platform === 'win32') {
    return path.join(installDir, 'Code.exe');
  }

  if (platform === 'darwin') {
    return resolveDarwinVSCodeExecutable(path.join(installDir, 'Visual Studio Code.app', 'Contents'));
  }

  return path.join(installDir, 'code');
}

function resolveDarwinVSCodeExecutable(contents) {
  const plist = readFileSync(path.join(contents, 'Info.plist'), 'utf8');
  const match = plist.match(/<key>CFBundleExecutable<\/key>\s*<string>([^<]+)<\/string>/u);
  assert(match && /^[A-Za-z0-9 _-]+$/u.test(match[1]), 'VS Code app must declare a valid executable in Info.plist');
  const executable = path.join(contents, 'MacOS', match[1]);
  assert(statSync(executable).isFile(), 'Declared VS Code executable must be a regular file');
  return executable;
}

export function normalizeVSCodeExecutablePath(downloadResult, platform = process.platform) {
  if (existsSync(downloadResult)) {
    try {
      if (!statSync(downloadResult).isDirectory()) {
        return downloadResult;
      }
    } catch {
      // Fall through to directory-style resolution.
    }
  }

  if (platform === 'darwin' && path.basename(path.dirname(downloadResult)) === 'MacOS'
    && path.basename(path.resolve(path.dirname(downloadResult), '..')) === 'Contents') {
    return resolveDarwinVSCodeExecutable(path.resolve(path.dirname(downloadResult), '..'));
  }
  return resolveVSCodeExecutablePath(downloadResult, platform);
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

export function spawnVSCodeTestProcess(executablePath, args, extensionTestsEnv) {
  const fullEnv = buildVSCodeChildEnv(extensionTestsEnv);

  // The Windows CLI detaches Code.exe; observe the actual test process instead.
  const child = spawn(executablePath, args, {
    env: fullEnv,
    shell: false,detached:process.platform!=='win32'
  });

  child.stdout.on('data', (chunk) => process.stdout.write(chunk));
  child.stderr.on('data', (chunk) => process.stderr.write(chunk));

  const absoluteDeadline = Number(process.env.DEV_SESSION_CANVAS_GATE_EXIT_DEADLINE
    ?? process.env.DEV_SESSION_CANVAS_GATE_CLEANUP_DEADLINE ?? process.env.DEV_SESSION_CANVAS_GATE_DEADLINE);
  let ceilingTimer;
  let timedOut=false,drainTimer,drainTimedOut=false,termination;
  const retire=()=>{termination??=retireProcessGroup(child.pid);return termination;};
  if (Number.isFinite(absoluteDeadline) && absoluteDeadline > 0) {
    ceilingTimer = setTimeout(() => {
      timedOut=true;retire();
    }, Math.max(1, absoluteDeadline - Date.now()));
  }
  const completed = new Promise((resolve, reject) => {
    child.on('error', (error) => {
      reject(error);
    });

    let finished = false;
    const finalize = async (code, signal) => {
      if (finished) {
        return;
      }

      finished = true;
      clearTimeout(ceilingTimer);
      clearTimeout(drainTimer);
      const cleanup=termination?await termination:null;
      console.log(`Exit code:   ${code ?? signal}`);

      if (code !== 0||signal||timedOut||drainTimedOut||cleanup?.status==='failed') {
        reject(
          new Error(
            `Test run failed: code=${code} signal=${signal} deadline=${timedOut} drain=${drainTimedOut} cleanup=${cleanup?.status??'owning-task-observed'}`
          )
        );
        return;
      }

      resolve();
    };

    child.on('close', finalize);
    child.on('exit',(code,signal)=>{
      // Keep draining tail output. An inherited pipe can outlive Electron, so
      // a bounded drain reports failure instead of destroying it immediately.
      drainTimer=setTimeout(()=>{drainTimedOut=true;child.stdout.destroy();child.stderr.destroy();retire();
        finalize(code,signal);},infrastructureBudgets.hostExit);
    });
  });

  return {
    child,
    completed,
    kill: (signal = 'SIGTERM') => {
      if(process.platform!=='win32'&&child.pid) {
        try{process.kill(-child.pid,signal);}catch(error){if(error.code!=='ESRCH')throw error;}
      }else if(!child.killed)child.kill(signal);
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
  if (options.excludePackDependencies) args.push('--do-not-include-pack-dependencies');

  if (process.env.DEV_SESSION_CANVAS_GATE_DEADLINE) {
    const deadline = Math.min(Number(process.env.DEV_SESSION_CANVAS_GATE_DEADLINE), Date.now() + infrastructureBudgets.install);
    const observed = await runProcess(cliPath, args, { deadline,
      env: buildVSCodeChildEnv(options.environment ?? {}) });
    assert.equal(observed.status, 'passed', `Required VS Code fixture extension install failed: ${JSON.stringify(observed)}`);
    return;
  }

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
