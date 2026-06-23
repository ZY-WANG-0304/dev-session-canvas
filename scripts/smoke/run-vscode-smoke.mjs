import path from 'path';
import { promises as fs } from 'fs';
import { fileURLToPath } from 'url';

import {
  ensureVSCodeExecutable,
  installVSCodeExtensions,
  launchPreparedVSCodeScenario,
  prepareMainSmokeHostExtension,
  prepareRuntime,
  resolveStagedSmokeTestPath,
  resolveVSCodeSmokeDebugRoot,
  runInsideXvfb,
  shouldReRunInsideXvfb,
  spawnPreparedVSCodeScenario,
  writeUserSettings
} from './vscode-smoke-runner.mjs';
import { createRemoteSSHFixture } from './vscode-remote-ssh-fixture.mjs';

const projectRoot = process.cwd();
const currentScriptPath = fileURLToPath(import.meta.url);
const smokeDebugRoot = resolveVSCodeSmokeDebugRoot(projectRoot);
const smokeFixturesDir = path.join(projectRoot, 'tests', 'vscode-smoke', 'fixtures');
const fakeAgentProviderPath = path.join(projectRoot, 'tests', 'vscode-smoke', 'fixtures', 'fake-agent-provider');
const missingAgentProviderPath = path.join(projectRoot, 'tests', 'vscode-smoke', 'fixtures', 'missing-agent-provider');
const smokeFixturesPath = `${smokeFixturesDir}${path.delimiter}${process.env.PATH ?? ''}`;
const fakeSystemdShimPath = path.join(
  projectRoot,
  'tests',
  'vscode-smoke',
  'fixtures',
  'fake-systemd',
  'systemctl.cjs'
);
const scenarioFilter = parseScenarioFilter(process.env.DEV_SESSION_CANVAS_SMOKE_SCENARIO_FILTER);

const scenarios = [
  {
    name: 'trusted',
    description: 'Trusted workspace smoke',
    disableWorkspaceTrust: true
  },
  {
    name: 'restricted',
    description: 'Restricted workspace smoke',
    disableWorkspaceTrust: false,
    userSettings: {
      'security.workspace.trust.enabled': true,
      'security.workspace.trust.startupPrompt': 'never',
      'security.workspace.trust.banner': 'never',
      'security.workspace.trust.untrustedFiles': 'open'
    }
  }
];

async function main() {
  if (shouldReRunInsideXvfb()) {
    process.exit(runInsideXvfb(currentScriptPath, projectRoot));
  }

  for (const scenario of scenarios) {
    if (!shouldRunScenario(scenario.name)) {
      continue;
    }

    const runtime = await prepareRuntime({
      projectRoot,
      debugRoot: path.join(smokeDebugRoot, scenario.name),
      runtimeDirName: `dsc-vscode-smoke-runtime-${scenario.name}`,
      userSettings: scenario.userSettings,
      extensionTestsEnv: {
        DEV_SESSION_CANVAS_SMOKE_SCENARIO: scenario.name,
        DEV_SESSION_CANVAS_TEST_CODEX_COMMAND: fakeAgentProviderPath,
        DEV_SESSION_CANVAS_TEST_CLAUDE_COMMAND: missingAgentProviderPath,
        PATH: smokeFixturesPath
      }
    });
    const smokeHostRoot = await prepareMainSmokeHostExtension({
      projectRoot,
      targetRoot: path.join(runtime.debugRoot, 'smoke-host')
    });

    await launchPreparedVSCodeScenario({
      projectRoot,
      runtime,
      workspacePath: projectRoot,
      extensionDevelopmentPath: smokeHostRoot,
      extensionTestsPath: resolveStagedSmokeTestPath(smokeHostRoot, 'extension-tests.cjs'),
      disableExtensions: false,
      disableWorkspaceTrust: scenario.disableWorkspaceTrust,
      extensionTestsEnv: {
        DEV_SESSION_CANVAS_SMOKE_SCENARIO: scenario.name,
        DEV_SESSION_CANVAS_TEST_CODEX_COMMAND: fakeAgentProviderPath,
        DEV_SESSION_CANVAS_TEST_CLAUDE_COMMAND: missingAgentProviderPath,
        PATH: smokeFixturesPath
      }
    });
    console.log(`${scenario.description} passed.`);
  }

  if (shouldRunScenario('real-reopen')) {
    await runRealWindowReopenScenario();
  }
  if (shouldRunScenario('multi-root-real-reopen')) {
    await runMultiRootRealWindowReopenScenario();
  }
  if (shouldRunScenario('single-to-multi-root-real-reopen')) {
    await runSingleToMultiRootRealWindowReopenScenario();
  }
  if (shouldRunScenario('two-window-shared-runtime')) {
    await runTwoWindowSharedRuntimeScenario();
  }
  if (shouldRunScenario('systemd-user-real-reopen')) {
    await runSystemdUserRealWindowReopenScenario();
  }
  if (shouldRunScenario('systemd-fallback-real-reopen')) {
    await runSystemdFallbackRealWindowReopenScenario();
  }
  if (shouldRunScenario('remote-ssh-real-reopen')) {
    await runRemoteSSHRealReopenScenario();
  }
  console.log('VS Code smoke test passed.');
}

async function runRealWindowReopenScenario() {
  await runLocalRealWindowReopenScenario({
    scenarioName: 'real-reopen',
    description: 'Real window reopen smoke',
    runtimeDirName: 'dsc-vscode-smoke-runtime-real-reopen',
    expectedRuntimeBackend: 'legacy-detached',
    expectedRuntimeGuarantee: 'best-effort'
  });
}

async function runMultiRootRealWindowReopenScenario() {
  const scenarioName = 'multi-root-real-reopen';
  const runtime = await prepareLocalRealReopenRuntime({
    scenarioName,
    runtimeDirName: 'dsc-vscode-smoke-runtime-multi-root-real-reopen'
  });
  const siblingRoot = path.join(runtime.runtimeDir, 'multi-root-sibling');
  await fs.mkdir(siblingRoot, { recursive: true });
  await fs.writeFile(
    path.join(siblingRoot, 'README.md'),
    '# Dev Session Canvas multi-root smoke sibling\n',
    'utf8'
  );
  const workspacePath = path.join(runtime.debugRoot, 'multi-root-real-reopen.code-workspace');
  await writeCodeWorkspaceFile(workspacePath, [
    { name: path.basename(projectRoot), path: projectRoot },
    { name: 'multi-root-sibling', path: siblingRoot }
  ]);

  await runPreparedLocalRealWindowReopenScenario({
    scenarioName,
    description: 'Multi-root real window reopen smoke',
    runtime,
    setupWorkspacePath: workspacePath,
    verifyWorkspacePath: workspacePath,
    expectedRuntimeBackend: 'legacy-detached',
    expectedRuntimeGuarantee: 'best-effort',
    setupControl: {
      expectedWorkspaceMode: 'multi-root',
      expectedWorkspaceRoot: projectRoot,
      expectedWorkspaceFolderCount: 2
    },
    verifyControl: {
      expectedWorkspaceMode: 'multi-root',
      expectedWorkspaceRoot: projectRoot,
      expectedWorkspaceFolderCount: 2
    }
  });
}

async function runSingleToMultiRootRealWindowReopenScenario() {
  const scenarioName = 'single-to-multi-root-real-reopen';
  const runtime = await prepareLocalRealReopenRuntime({
    scenarioName,
    runtimeDirName: 'dsc-vscode-smoke-runtime-single-to-multi-root-real-reopen'
  });
  const siblingRoot = path.join(runtime.runtimeDir, 'multi-root-sibling');
  await fs.mkdir(siblingRoot, { recursive: true });
  await fs.writeFile(
    path.join(siblingRoot, 'README.md'),
    '# Dev Session Canvas single-to-multi-root smoke sibling\n',
    'utf8'
  );
  const workspacePath = path.join(runtime.debugRoot, 'single-to-multi-root-real-reopen.code-workspace');
  await writeCodeWorkspaceFile(workspacePath, [
    { name: path.basename(projectRoot), path: projectRoot },
    { name: 'multi-root-sibling', path: siblingRoot }
  ]);

  await runPreparedLocalRealWindowReopenScenario({
    scenarioName,
    description: 'Single-root to multi-root real window reopen smoke',
    runtime,
    setupWorkspacePath: projectRoot,
    verifyWorkspacePath: workspacePath,
    expectedRuntimeBackend: 'legacy-detached',
    expectedRuntimeGuarantee: 'best-effort',
    setupControl: {
      expectedWorkspaceMode: 'single-root',
      expectedWorkspaceRoot: projectRoot,
      expectedWorkspaceFolderCount: 1
    },
    verifyControl: {
      expectedWorkspaceMode: 'multi-root',
      expectedWorkspaceRoot: projectRoot,
      expectedWorkspaceFolderCount: 2
    }
  });
}

async function runTwoWindowSharedRuntimeScenario() {
  const scenarioName = 'two-window-shared-runtime';
  const scenarioDebugRoot = path.join(projectRoot, '.debug', 'vscode-smoke', scenarioName);
  const sharedDir = path.join(scenarioDebugRoot, 'shared');
  const runtimeDirName = 'dsc-vscode-smoke-runtime-two-window-shared-runtime';
  await fs.rm(scenarioDebugRoot, { recursive: true, force: true });
  const ownerRuntime = await prepareRuntime({
    debugRoot: path.join(scenarioDebugRoot, 'owner'),
    runtimeDirName,
    userSettings: {
      'security.workspace.trust.enabled': false
    }
  });
  const attacherRuntime = await prepareRuntime({
    debugRoot: path.join(scenarioDebugRoot, 'attacher'),
    runtimeDirName,
    userSettings: {
      'security.workspace.trust.enabled': false
    }
  });
  const smokeHostRoot = await prepareMainSmokeHostExtension({
    projectRoot,
    targetRoot: path.join(scenarioDebugRoot, 'smoke-host')
  });
  const ownerControlFilePath = path.join(sharedDir, 'owner-control.json');
  const attacherControlFilePath = path.join(sharedDir, 'attacher-control.json');
  const ownerReadyPath = path.join(sharedDir, 'owner-ready.json');
  await writeRealReopenControlFile(ownerControlFilePath, {
    role: 'owner',
    artifactDir: ownerRuntime.artifactsDir,
    sharedDir
  });
  await writeRealReopenControlFile(attacherControlFilePath, {
    role: 'attacher',
    artifactDir: attacherRuntime.artifactsDir,
    sharedDir
  });

  const sharedOptions = {
    projectRoot,
    workspacePath: projectRoot,
    extensionDevelopmentPath: smokeHostRoot,
    extensionTestsPath: resolveStagedSmokeTestPath(smokeHostRoot, 'two-window-shared-runtime-tests.cjs'),
    disableExtensions: false,
    disableWorkspaceTrust: true,
    extraLaunchArgs: ['--new-window']
  };
  const sharedEnv = {
    DEV_SESSION_CANVAS_TEST_CODEX_COMMAND: fakeAgentProviderPath,
    DEV_SESSION_CANVAS_TEST_CLAUDE_COMMAND: missingAgentProviderPath,
    DEV_SESSION_CANVAS_EXPECTED_RUNTIME_BACKEND: 'legacy-detached',
    DEV_SESSION_CANVAS_EXPECTED_RUNTIME_GUARANTEE: 'best-effort',
    PATH: smokeFixturesPath
  };

  let ownerHandle;
  let attacherHandle;
  try {
    ownerHandle = await spawnPreparedVSCodeScenario({
      ...sharedOptions,
      runtime: ownerRuntime,
      extensionTestsEnv: {
        ...sharedEnv,
        DEV_SESSION_CANVAS_TWO_WINDOW_ROLE: 'owner',
        DEV_SESSION_CANVAS_TWO_WINDOW_CONTROL_FILE: ownerControlFilePath
      }
    });

    await Promise.race([
      waitForJsonFile(ownerReadyPath, 90000),
      ownerHandle.completed.then(() => {
        throw new Error('Owner VS Code window exited before publishing owner-ready.json.');
      })
    ]);

    attacherHandle = await spawnPreparedVSCodeScenario({
      ...sharedOptions,
      runtime: attacherRuntime,
      extensionTestsEnv: {
        ...sharedEnv,
        DEV_SESSION_CANVAS_TWO_WINDOW_ROLE: 'attacher',
        DEV_SESSION_CANVAS_TWO_WINDOW_CONTROL_FILE: attacherControlFilePath
      }
    });

    await Promise.all([ownerHandle.completed, attacherHandle.completed]);
  } catch (error) {
    ownerHandle?.kill();
    attacherHandle?.kill();
    await Promise.allSettled([
      ownerHandle?.completed,
      attacherHandle?.completed
    ].filter(Boolean));
    throw error;
  }

  console.log('Two-window shared runtime smoke passed.');
}

async function runSystemdUserRealWindowReopenScenario() {
  await runLocalRealWindowReopenScenario({
    scenarioName: 'systemd-user-real-reopen',
    description: 'Fake systemd-user real window reopen smoke',
    runtimeDirName: 'dsc-vscode-smoke-runtime-systemd-user-real-reopen',
    expectedRuntimeBackend: 'systemd-user',
    expectedRuntimeGuarantee: 'strong',
    extraEnv: {
      DEV_SESSION_CANVAS_RUNTIME_HOST_BACKEND_OVERRIDE: 'systemd-user',
      DEV_SESSION_CANVAS_TEST_SYSTEMCTL_SHIM: fakeSystemdShimPath,
      DEV_SESSION_CANVAS_FAKE_SYSTEMD_MODE: 'success'
    }
  });
}

async function runSystemdFallbackRealWindowReopenScenario() {
  await runLocalRealWindowReopenScenario({
    scenarioName: 'systemd-fallback-real-reopen',
    description: 'Fake systemd fallback real window reopen smoke',
    runtimeDirName: 'dsc-vscode-smoke-runtime-systemd-fallback-real-reopen',
    expectedRuntimeBackend: 'legacy-detached',
    expectedRuntimeGuarantee: 'best-effort',
    extraEnv: {
      DEV_SESSION_CANVAS_RUNTIME_HOST_BACKEND_OVERRIDE: 'systemd-user',
      DEV_SESSION_CANVAS_TEST_SYSTEMCTL_SHIM: fakeSystemdShimPath,
      DEV_SESSION_CANVAS_FAKE_SYSTEMD_MODE: 'fail-start'
    }
  });
}

async function runLocalRealWindowReopenScenario(options) {
  const runtime = await prepareLocalRealReopenRuntime(options);
  await runPreparedLocalRealWindowReopenScenario({
    ...options,
    runtime,
    setupWorkspacePath: projectRoot,
    verifyWorkspacePath: projectRoot
  });
}

async function prepareLocalRealReopenRuntime(options) {
  const runtime = await prepareRuntime({
    debugRoot: path.join(smokeDebugRoot, options.scenarioName),
    runtimeDirName: options.runtimeDirName,
    userSettings: {
      'security.workspace.trust.enabled': false
    }
  });
  return runtime;
}

async function runPreparedLocalRealWindowReopenScenario(options) {
  const runtime = options.runtime;
  const smokeHostRoot = await prepareMainSmokeHostExtension({
    projectRoot,
    targetRoot: path.join(runtime.debugRoot, 'smoke-host')
  });

  const sharedOptions = {
    projectRoot,
    runtime,
    extensionDevelopmentPath: smokeHostRoot,
    extensionTestsPath: resolveStagedSmokeTestPath(smokeHostRoot, 'real-reopen-tests.cjs'),
    disableExtensions: false,
    disableWorkspaceTrust: true
  };
  const controlFilePath = path.join(runtime.artifactsDir, `${options.scenarioName}-control.json`);
  const workspaceFallbackControlFilePath = path.join(
    projectRoot,
    '.debug',
    'vscode-smoke',
    `${options.scenarioName}-control.json`
  );
  const stateFilePath = path.join(runtime.artifactsDir, `${options.scenarioName}-state.json`);
  const sharedEnv = {
    DEV_SESSION_CANVAS_TEST_CODEX_COMMAND: fakeAgentProviderPath,
    DEV_SESSION_CANVAS_TEST_CLAUDE_COMMAND: missingAgentProviderPath,
    PATH: smokeFixturesPath,
    DEV_SESSION_CANVAS_REAL_REOPEN_CONTROL_FILE: controlFilePath,
    DEV_SESSION_CANVAS_EXPECTED_RUNTIME_BACKEND: options.expectedRuntimeBackend,
    DEV_SESSION_CANVAS_EXPECTED_RUNTIME_GUARANTEE: options.expectedRuntimeGuarantee,
    ...(options.extraEnv?.DEV_SESSION_CANVAS_TEST_SYSTEMCTL_SHIM
      ? {
          DEV_SESSION_CANVAS_TEST_NODE_PATH: process.execPath,
          DEV_SESSION_CANVAS_FAKE_SYSTEMD_STATE_DIR: path.join(runtime.artifactsDir, 'fake-systemd-state')
        }
      : {}),
    ...(options.extraEnv ?? {})
  };

  await writeRealReopenControlFiles([controlFilePath, workspaceFallbackControlFilePath], {
    phase: 'setup',
    artifactDir: runtime.artifactsDir,
    stateFile: stateFilePath,
    ...(options.setupControl ?? {})
  });
  await launchPreparedVSCodeScenario({
    ...sharedOptions,
    workspacePath: options.setupWorkspacePath,
    extensionTestsEnv: {
      ...sharedEnv,
    }
  });

  await writeRealReopenControlFiles([controlFilePath, workspaceFallbackControlFilePath], {
    phase: 'verify',
    artifactDir: runtime.artifactsDir,
    stateFile: stateFilePath,
    ...(options.verifyControl ?? {})
  });
  await launchPreparedVSCodeScenario({
    ...sharedOptions,
    workspacePath: options.verifyWorkspacePath,
    extensionTestsEnv: {
      ...sharedEnv
    }
  });

  console.log(`${options.description} passed.`);
}

async function runRemoteSSHRealReopenScenario() {
  if (process.platform !== 'linux') {
    console.log('Remote SSH real window reopen smoke skipped: current platform is not Linux.');
    return;
  }

  const debugRoot = path.join(smokeDebugRoot, 'remote-ssh-real-reopen');
  const runtime = await prepareRuntime({
    debugRoot,
    runtimeDirName: 'dsc-vscode-smoke-runtime-remote-ssh-real-reopen'
  });
  const smokeHostRoot = await prepareMainSmokeHostExtension({
    projectRoot,
    targetRoot: path.join(runtime.debugRoot, 'smoke-host')
  });
  const controlFilePath = path.join(runtime.artifactsDir, 'remote-ssh-real-reopen-control.json');
  const workspaceFallbackControlFilePath = path.join(projectRoot, '.debug', 'vscode-smoke', 'real-reopen-control.json');
  const stateFilePath = path.join(runtime.artifactsDir, 'remote-ssh-real-reopen-state.json');
  const fixture = await createRemoteSSHFixture({
    debugRoot,
    realReopenControlFile: controlFilePath,
    remoteRuntimeDirName: 'dsc-vscode-remote-ssh-runtime-real-reopen'
  });

  try {
    const vscodeExecutablePath = await ensureVSCodeExecutable(projectRoot);
    await installVSCodeExtensions({
      vscodeExecutablePath,
      userDataDir: runtime.userDataDir,
      extensionsDir: runtime.extensionsDir,
      extensionIds: ['ms-vscode-remote.remote-ssh'],
      environment: runtime.environment
    });
    const remoteExtensionDevelopmentPaths = await findInstalledExtensionPaths(runtime.extensionsDir, [
      'ms-vscode-remote.remote-ssh',
      'ms-vscode-remote.remote-ssh-edit',
      'ms-vscode.remote-explorer'
    ]);

    await writeUserSettings(runtime.userDataDir, {
      'security.workspace.trust.enabled': false,
      'devSessionCanvas.agent.codexCommand': fakeAgentProviderPath,
      'devSessionCanvas.agent.claudeCommand': missingAgentProviderPath,
      'remote.SSH.configFile': fixture.sshConfigPath,
      'remote.SSH.useLocalServer': false,
      'remote.SSH.showLoginTerminal': false,
      'remote.SSH.localServerDownload': 'always',
      'remote.SSH.remotePlatform': {
        [fixture.hostAlias]: 'linux'
      },
      'remote.SSH.serverInstallPath': {
        [fixture.hostAlias]: fixture.remoteAgentDir
      }
    });
    const remoteProjectUri = toRemoteURI(fixture.remoteAuthority, projectRoot);
    const remoteSmokeHostUri = toRemoteURI(fixture.remoteAuthority, smokeHostRoot);
    const remoteRealReopenTestsUri = toRemoteURI(
      fixture.remoteAuthority,
      resolveStagedSmokeTestPath(smokeHostRoot, 'real-reopen-tests.cjs')
    );

    const sharedOptions = {
      projectRoot,
      runtime,
      vscodeExecutablePath,
      folderUri: remoteProjectUri,
      remoteAuthority: fixture.remoteAuthority,
      extensionDevelopmentPath: [remoteSmokeHostUri, ...remoteExtensionDevelopmentPaths],
      extensionTestsPath: remoteRealReopenTestsUri,
      disableWorkspaceTrust: true,
      disableExtensions: false,
      profileName: 'Dev Session Canvas Smoke Remote SSH',
      extensionTestsEnv: {
        DEV_SESSION_CANVAS_REAL_REOPEN_CONTROL_FILE: controlFilePath
      }
    };

    await writeRealReopenControlFiles([controlFilePath, workspaceFallbackControlFilePath], {
      phase: 'setup',
      artifactDir: runtime.artifactsDir,
      stateFile: stateFilePath
    });
    await launchPreparedVSCodeScenario(sharedOptions);

    await writeRealReopenControlFiles([controlFilePath, workspaceFallbackControlFilePath], {
      phase: 'verify',
      artifactDir: runtime.artifactsDir,
      stateFile: stateFilePath
    });
    await launchPreparedVSCodeScenario(sharedOptions);
  } finally {
    await fixture.dispose();
  }

  console.log('Remote SSH real window reopen smoke passed.');
}

async function writeRealReopenControlFile(controlFilePath, payload) {
  await fs.mkdir(path.dirname(controlFilePath), { recursive: true });
  await fs.writeFile(controlFilePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

async function writeCodeWorkspaceFile(workspacePath, folders) {
  await fs.mkdir(path.dirname(workspacePath), { recursive: true });
  await fs.writeFile(
    workspacePath,
    `${JSON.stringify({
      folders: folders.map((folder) => ({
        name: folder.name,
        path: folder.path
      }))
    }, null, 2)}\n`,
    'utf8'
  );
}

async function writeRealReopenControlFiles(controlFilePaths, payload) {
  for (const controlFilePath of controlFilePaths) {
    await writeRealReopenControlFile(controlFilePath, payload);
  }
}

async function waitForJsonFile(filePath, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      return JSON.parse(await fs.readFile(filePath, 'utf8'));
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  throw new Error(`Timed out waiting for ${filePath}: ${lastError?.message ?? 'not found'}`);
}

async function findInstalledExtensionPaths(extensionsDir, extensionIds) {
  const entries = await fs.readdir(extensionsDir, { withFileTypes: true });
  return extensionIds.map((extensionId) => {
    const entry = entries.find(
      (candidate) => candidate.isDirectory() && candidate.name.startsWith(`${extensionId}-`)
    );
    if (!entry) {
      throw new Error(`未找到已安装扩展目录：${extensionId}`);
    }

    return path.join(extensionsDir, entry.name);
  });
}

function toRemoteURI(remoteAuthority, absolutePath) {
  const remotePath = absolutePath.split(path.sep).join(path.posix.sep);
  return `vscode-remote://${remoteAuthority}${encodeURI(remotePath)}`;
}

function parseScenarioFilter(rawValue) {
  if (!rawValue) {
    return undefined;
  }

  const entries = rawValue
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  return entries.length > 0 ? new Set(entries) : undefined;
}

function shouldRunScenario(name) {
  return !scenarioFilter || scenarioFilter.has(name);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
