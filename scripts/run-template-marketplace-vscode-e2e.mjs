import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
const debugRoot = path.join(projectRoot, '.debug', 'template-marketplace-vscode-e2e');
const hostTmpRoot = path.join(projectRoot, '.debug', 'template-marketplace-vscode-e2e-host-tmp');
const smokeFixturesDir = path.join(projectRoot, 'tests', 'vscode-smoke', 'fixtures');
const fakeAgentProviderPath = path.join(smokeFixturesDir, 'fake-agent-provider');
const missingAgentProviderPath = path.join(smokeFixturesDir, 'missing-agent-provider');
const smokeFixturesPath = `${smokeFixturesDir}${path.delimiter}${process.env.PATH ?? ''}`;

process.env.TMPDIR = hostTmpRoot;
process.env.TMP = process.env.TMPDIR;
process.env.TEMP = process.env.TMPDIR;
fs.mkdirSync(process.env.TMPDIR, { recursive: true });

async function main() {
  if (shouldReRunInsideXvfb()) {
    process.exit(runInsideXvfb(currentScriptPath, projectRoot));
  }

  const port = await findAvailablePort();
  const marketplaceSourceUrl = `http://127.0.0.1:${port}/templates`;
  const extensionTestsEnv = {
    DEV_SESSION_CANVAS_SMOKE_SCENARIO: 'template-marketplace',
    DEV_SESSION_CANVAS_SMOKE_TEST_MODE: '1',
    DEV_SESSION_CANVAS_TEMPLATE_MARKETPLACE_E2E_PORT: String(port),
    DEV_SESSION_CANVAS_TEMPLATE_MARKETPLACE_SOURCE_URL: marketplaceSourceUrl,
    DEV_SESSION_CANVAS_TEST_CODEX_COMMAND: fakeAgentProviderPath,
    DEV_SESSION_CANVAS_TEST_CLAUDE_COMMAND: missingAgentProviderPath,
    PATH: smokeFixturesPath
  };

  const runtime = await prepareRuntime({
    projectRoot,
    debugRoot,
    runtimeDirName: 'dsc-template-marketplace-vscode-e2e-runtime',
    extensionTestsEnv,
    userSettings: {
      'security.workspace.trust.enabled': false,
      'workbench.browser.openLocalhostLinks': false
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
    extensionTestsPath: resolveStagedSmokeTestPath(smokeHostRoot, 'template-marketplace-tests.cjs'),
    disableExtensions: false,
    disableWorkspaceTrust: true,
    extensionTestsEnv
  });

  console.log('Template marketplace VS Code UI E2E passed.');
}

function findAvailablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => {
        if (!address || typeof address === 'string') {
          reject(new Error('Unable to allocate a local marketplace fixture port.'));
          return;
        }
        resolve(address.port);
      });
    });
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
