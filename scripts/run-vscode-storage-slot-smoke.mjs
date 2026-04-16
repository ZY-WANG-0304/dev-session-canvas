import path from 'path';
import { fileURLToPath } from 'url';

import {
  runInsideXvfb,
  runVSCodeScenario,
  shouldReRunInsideXvfb
} from './vscode-smoke-runner.mjs';

const projectRoot = process.cwd();
const currentScriptPath = fileURLToPath(import.meta.url);
const extensionTestsPath = path.join(
  projectRoot,
  'tests',
  'vscode-smoke',
  'storage-slot-recovery-tests.cjs'
);

async function main() {
  if (process.platform !== 'linux') {
    throw new Error('当前 `test:smoke-storage-slot` 仅在 Linux 上收口。');
  }

  if (shouldReRunInsideXvfb()) {
    process.exit(runInsideXvfb(currentScriptPath, projectRoot));
  }

  await runVSCodeScenario({
    projectRoot,
    debugRoot: path.join(projectRoot, '.debug', 'vscode-smoke-storage-slot'),
    runtimeDirName: 'dsc-vscode-smoke-storage-slot',
    workspacePath: projectRoot,
    extensionDevelopmentPath: projectRoot,
    extensionTestsPath,
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
