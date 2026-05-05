import path from 'path';
import { fileURLToPath } from 'url';

import {
  launchPreparedVSCodeScenario,
  prepareMainSmokeHostExtension,
  prepareRuntime,
  resolveStagedSmokeTestPath,
  runInsideXvfb,
  shouldReRunInsideXvfb
} from './vscode-smoke-runner.mjs';

const projectRoot = process.cwd();
const currentScriptPath = fileURLToPath(import.meta.url);

async function main() {
  if (process.platform !== 'linux') {
    throw new Error('当前 `test:smoke-storage-slot` 仅在 Linux 上收口。');
  }

  if (shouldReRunInsideXvfb()) {
    process.exit(runInsideXvfb(currentScriptPath, projectRoot));
  }

  const runtime = await prepareRuntime({
    debugRoot: path.join(projectRoot, '.debug', 'vscode-smoke-storage-slot'),
    runtimeDirName: 'dsc-vscode-smoke-storage-slot',
    extensionTestsEnv: {
      DEV_SESSION_CANVAS_SMOKE_SCENARIO: 'storage-slot-recovery'
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
    extensionTestsPath: resolveStagedSmokeTestPath(smokeHostRoot, 'storage-slot-recovery-tests.cjs'),
    disableExtensions: false,
    disableWorkspaceTrust: true,
    extensionTestsEnv: {
      DEV_SESSION_CANVAS_SMOKE_SCENARIO: 'storage-slot-recovery'
    }
  });

  console.log('Storage-slot recovery smoke passed.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
