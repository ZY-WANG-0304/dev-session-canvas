import path from 'path';
import { existsSync } from 'fs';

import {
  ensureVSCodeExecutable,
  launchPreparedVSCodeScenario,
  prepareRuntime
} from './vscode-smoke-runner.mjs';

if (process.platform !== 'win32') {
  throw new Error('windows-real-codex smoke 仅支持在 Windows 上运行。');
}

const projectRoot = process.cwd();
const extensionTestsPath = path.join(projectRoot, 'tests', 'vscode-smoke', 'windows-real-codex-smoke.cjs');
const explicitCodexCommand =
  process.env.DEV_SESSION_CANVAS_WINDOWS_REAL_CODEX_EXPLICIT_COMMAND?.trim() ||
  path.join(process.env.APPDATA ?? '', 'npm', 'codex.cmd');

async function main() {
  const vscodeExecutablePath = await resolveVSCodeExecutablePath(projectRoot);
  const runtime = await prepareRuntime({
    debugRoot: path.join(projectRoot, '.debug', 'vscode-smoke', 'windows-real-codex'),
    runtimeDirName: 'dsc-vscode-smoke-runtime-windows-real-codex',
    userSettings: {
      'security.workspace.trust.enabled': false
    }
  });

  await launchPreparedVSCodeScenario({
    projectRoot,
    runtime,
    vscodeExecutablePath,
    workspacePath: projectRoot,
    extensionDevelopmentPath: projectRoot,
    extensionTestsPath,
    disableWorkspaceTrust: true,
    extensionTestsEnv: {
      DEV_SESSION_CANVAS_WINDOWS_REAL_CODEX_DEFAULT_COMMAND:
        process.env.DEV_SESSION_CANVAS_WINDOWS_REAL_CODEX_DEFAULT_COMMAND?.trim() || 'codex',
      DEV_SESSION_CANVAS_WINDOWS_REAL_CODEX_EXPLICIT_COMMAND: explicitCodexCommand
    }
  });

  console.log(`Windows real Codex smoke passed. Artifacts: ${runtime.artifactsDir}`);
}

async function resolveVSCodeExecutablePath(projectRoot) {
  if (process.env.DEV_SESSION_CANVAS_VSCODE_USE_TEST_DOWNLOAD === '1') {
    return ensureVSCodeExecutable(projectRoot);
  }

  const configuredPath = process.env.DEV_SESSION_CANVAS_VSCODE_EXECUTABLE?.trim();
  const candidates = [
    configuredPath,
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

  return ensureVSCodeExecutable(projectRoot);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
