import path from 'path';
import { promises as fs } from 'fs';
import { fileURLToPath } from 'url';

import {
  ensureVSCodeExecutable,
  installVSCodeExtensions,
  launchPreparedVSCodeScenario,
  prepareRuntime,
  runInsideXvfb,
  runVSCodeScenario,
  shouldReRunInsideXvfb,
  writeUserSettings
} from './vscode-smoke-runner.mjs';
import { createRemoteSSHFixture } from './vscode-remote-ssh-fixture.mjs';

const projectRoot = process.cwd();
const currentScriptPath = fileURLToPath(import.meta.url);
const extensionTestsPath = path.join(projectRoot, 'tests', 'vscode-smoke', 'extension-tests.cjs');
const realReopenExtensionTestsPath = path.join(projectRoot, 'tests', 'vscode-smoke', 'real-reopen-tests.cjs');
const fakeAgentProviderPath = path.join(projectRoot, 'tests', 'vscode-smoke', 'fixtures', 'fake-agent-provider');
const missingAgentProviderPath = path.join(projectRoot, 'tests', 'vscode-smoke', 'fixtures', 'missing-agent-provider');
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

    await runVSCodeScenario({
      projectRoot,
      debugRoot: path.join(projectRoot, '.debug', 'vscode-smoke', scenario.name),
      runtimeDirName: `dsc-vscode-smoke-runtime-${scenario.name}`,
      workspacePath: projectRoot,
      extensionDevelopmentPath: projectRoot,
      extensionTestsPath,
      disableWorkspaceTrust: scenario.disableWorkspaceTrust,
      userSettings: scenario.userSettings,
      extensionTestsEnv: {
        DEV_SESSION_CANVAS_SMOKE_SCENARIO: scenario.name,
        DEV_SESSION_CANVAS_TEST_CODEX_COMMAND: fakeAgentProviderPath,
        DEV_SESSION_CANVAS_TEST_CLAUDE_COMMAND: missingAgentProviderPath
      }
    });
    console.log(`${scenario.description} passed.`);
  }

  if (shouldRunScenario('real-reopen')) {
    await runRealWindowReopenScenario();
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
  const runtime = await prepareRuntime({
    debugRoot: path.join(projectRoot, '.debug', 'vscode-smoke', options.scenarioName),
    runtimeDirName: options.runtimeDirName,
    userSettings: {
      'security.workspace.trust.enabled': false
    }
  });

  const sharedOptions = {
    projectRoot,
    runtime,
    workspacePath: projectRoot,
    extensionDevelopmentPath: projectRoot,
    extensionTestsPath: realReopenExtensionTestsPath,
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
    stateFile: stateFilePath
  });
  await launchPreparedVSCodeScenario({
    ...sharedOptions,
    extensionTestsEnv: {
      ...sharedEnv,
    }
  });

  await writeRealReopenControlFiles([controlFilePath, workspaceFallbackControlFilePath], {
    phase: 'verify',
    artifactDir: runtime.artifactsDir,
    stateFile: stateFilePath
  });
  await launchPreparedVSCodeScenario({
    ...sharedOptions,
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

  const debugRoot = path.join(projectRoot, '.debug', 'vscode-smoke', 'remote-ssh-real-reopen');
  const runtime = await prepareRuntime({
    debugRoot,
    runtimeDirName: 'dsc-vscode-smoke-runtime-remote-ssh-real-reopen'
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
    const remoteRealReopenTestsUri = toRemoteURI(fixture.remoteAuthority, realReopenExtensionTestsPath);

    const sharedOptions = {
      projectRoot,
      runtime,
      vscodeExecutablePath,
      folderUri: remoteProjectUri,
      remoteAuthority: fixture.remoteAuthority,
      extensionDevelopmentPath: [remoteProjectUri, ...remoteExtensionDevelopmentPaths],
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

async function writeRealReopenControlFiles(controlFilePaths, payload) {
  for (const controlFilePath of controlFilePaths) {
    await writeRealReopenControlFile(controlFilePath, payload);
  }
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
