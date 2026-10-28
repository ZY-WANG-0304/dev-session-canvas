import { smokeCatalog, smokeGroups, packagedGroups } from '../smoke/smoke-catalog.mjs';
import { readFileSync } from 'node:fs';

export const policyVersion = 1;
export const environmentPolicy = Object.freeze({ node: '22.23.3', vscode: '1.142.0',
  browser: 'lockfile-playwright-chromium', visualOS: 'ubuntu-22.04',
  nativeNode: '25.6.0', minimumNativeNode: '16.17.1', minimumWindowsArmElectron: '22.3.14',
  remoteSSH: JSON.parse(readFileSync(new URL('../smoke/remote-ssh-extension-inputs.json', import.meta.url), 'utf8')) });
export const infrastructureBudgets = Object.freeze({ install: 600000, download: 300000,
  hostStartup: 180000, hostExit: 30000, cleanup: 60000, evidence: 30000 });
export const evidenceLimits = Object.freeze({ totalBytes: 256 * 1024 ** 2, memberBytes: 64 * 1024 ** 2,
  files: 10000, logBytes: 2 * 1024 ** 2, logHeadBytes: 64 * 1024 });
export const nativeTargets = Object.freeze([
  { variant: 'linux-x64-glibc', runner: 'ubuntu-24.04', platform: 'linux', arch: 'x64' },
  { variant: 'linux-arm64-glibc', runner: 'ubuntu-24.04-arm', platform: 'linux', arch: 'arm64' },
  { variant: 'darwin-x64', runner: 'macos-15-intel', platform: 'darwin', arch: 'x64' },
  { variant: 'darwin-arm64', runner: 'macos-15', platform: 'darwin', arch: 'arm64' },
  { variant: 'win32-x64', runner: 'windows-2025', platform: 'win32', arch: 'x64', compilerArch: 'x64' },
  { variant: 'win32-arm64', runner: 'windows-11-arm', platform: 'win32', arch: 'arm64', compilerArch: 'amd64_arm64' }
]);
export const installedTargets = Object.freeze(nativeTargets.filter(item => item.arch === 'x64')
  .map(item => ({ ...item, runner: item.platform === 'linux' ? 'ubuntu-22.04' : item.runner })));
export const regressionScripts = Object.freeze([
  'typecheck', 'test:common-dependencies', 'test:agent-tui',
  'typecheck:marketplace', 'test:marketplace-shared', 'test:marketplace-api', 'test:marketplace-web',
  'test:marketplace-production-config', 'test:marketplace-vscode-preview-preflight',
  'test:smoke-marketplace-publish', 'test:workspace-relative-paths', 'test:canvas-execution-context',
  'test:extension-storage-paths', 'test:runtime-supervisor-paths', 'test:terminal-session-journal',
  'test:execution-terminal-title', 'test:runtime-supervisor-protocol', 'test:protocol-webview-messages',
  'test:webview-lifecycle-diagnostics', 'test:smoke-lifecycle-isolation', 'test:agent-cli-resolver',
  'test:agent-cli-selection', 'test:agent-settings-files', 'test:shell-environment-resolver',
  'test:execution-session-bridge', 'test:execution-output-scheduler', 'test:execution-output-sequence',
  'test:extension-manifest', 'test:ui-copy-localization', 'test:package-vsix-command',
  'test:publish-marketplaces', 'test:publish-marketplace-workflow', 'test:marketplace-production-deploy-workflow',
  'test:sidebar-codicon-bundle', 'test:webview-build-xterm-entry', 'test:sidebar-list-colors',
  'test:theme-color-tokens', 'test:note-markdown-links', 'test:note-markdown-source-map',
  'test:note-markdown-file-association', 'test:note-body-indent', 'test:note-markdown-checklists',
  'test:note-markdown-front-matter', 'test:execution-terminal-links', 'test:execution-terminal-native-helpers',
  'test:terminal-shell-configuration', 'test:serialized-terminal-state-tracker',
  'test:execution-terminal-line-context-tracker', 'test:execution-attention-signals',
  'test:execution-terminal-clipboard', 'test:agent-launch-presets', 'test:git-worktrees',
  'test:canvas-node-placement', 'test:canvas-templates', 'test:canvas-node-groups',
  'test:canvas-layout-arrangement', 'test:shared-root-canvas', 'test:canvas-multi-root-composition',
  'test:sidebar-session-history', 'test:attention-protocol', 'test:notifier-source',
  'test:debug-launch-config', 'test:smoke-reset-fixture', 'test:smoke-execution-output',
  'test:smoke-runtime-retirement', 'test:smoke-terminal-history', 'test:smoke-terminal-resize',
  'test:smoke-remote-host', 'test:smoke-remote-host-isolation', 'test:smoke-wait-boundary',
  'typecheck:notifier', 'test:publish-tag-release', 'test:release-preflight',
  'test:release-preflight-workflow', 'test:vscode-smoke-runner-env', 'test:runtime-root-ownership',
  'test:runtime-root-preparation', 'test:runtime-supervisor-startup-profile',
  'test:runtime-supervisor-namespace', 'test:execution-owner-lifecycle', 'test:execution-native-assets', 'test:ci-gates'
]);

export const jobDependencies = Object.freeze({
  'input-contract': [], regression: [], 'frontend-build': [],
  'webview-function': ['frontend-build'], 'webview-visual': ['frontend-build'],
  'marketplace-browser': ['frontend-build'], 'native-assets': ['input-contract'],
  'source-build': ['input-contract', 'native-assets'], 'source-host': ['source-build'],
  'marketplace-host': ['source-build'], 'package-clean': ['input-contract', 'native-assets'],
  'packaged-host': ['package-clean'], 'installed-pair': ['package-clean']
});

export function taskCatalog({ functional = false, artifact = false, release = false } = {}) {
  const task = (job, id, variant = 'default', stages = ['prepare', 'assert'], extra = {}) => ({
    job, id, variant, stages, required: true, ...extra
  });
  const tasks = [task('input-contract', 'input-contract'),
    ...regressionScripts.map((script, index) => task('regression', script, `shard-${index % 3 + 1}`)),
    task('frontend-build', 'frontend-build', 'default', ['prepare', 'build', 'assert']),
    ...['test:activitybar-badges', 'test:avatar', 'test:sidebar-node-list', 'webview-functional']
      .map(id => task('webview-function', id)),
    task('webview-visual', 'webview-visual'), task('marketplace-browser', 'test:marketplace-browser-e2e')];
  if (functional || artifact || release) {
    for (const target of nativeTargets) {
      tasks.push(task('native-assets', 'native-load', target.variant, ['prepare', 'build', 'load', 'assert']));
      tasks.push(task('native-assets', 'native-operation', target.variant,
        ['prepare', 'action', 'assert', 'cleanup'], { required: release, calibration: !release }));
    }
    tasks.push(task('source-build', 'source-build', 'default', ['prepare', 'build', 'assert']));
    for (const suite of smokeCatalog.filter(item => !item.diagnosticOnly)) {
      tasks.push(task('source-host', `smoke/${suite.id}`, suite.variant,
        ['prepare', 'action', 'assert', 'cleanup', 'host-exit'], { suite: suite.id, hostGroup: suite.group }));
    }
    for (const id of ['notifier-companion', 'notifier-locale', 'ui-copy-locale']) {
      tasks.push(task('source-host', `smoke/${id}`, id,
        ['prepare', 'action', 'assert', 'cleanup', 'host-exit'], { suite: id, hostGroup: 'local-products' }));
    }
    for (const [id, variant] of [['marketplace-host', 'default'], ['marketplace-preview', 'local-preview']]) {
      tasks.push(task('marketplace-host', id, variant,
        ['prepare', 'action', 'assert', 'cleanup', 'host-exit']));
    }
  }
  if (artifact || release) {
    tasks.push(task('package-clean', 'package-clean', 'default', ['prepare', 'build', 'assert', 'cleanup']));
    tasks.push(task('package-clean', 'test:package-vsix-file-list'));
    for (const suite of smokeCatalog.filter(item => item.packaged)) {
      tasks.push(task('packaged-host', `smoke/${suite.id}`, suite.variant,
        ['prepare', 'action', 'assert', 'cleanup', 'host-exit'], { suite: suite.id, hostGroup: suite.packagedGroup }));
    }
    for (const target of installedTargets) tasks.push(task('installed-pair', 'installed-pair', target.variant,
      ['prepare', 'action', 'assert', 'cleanup', 'host-exit']));
  }
  return tasks;
}

export const hostVariants = Object.freeze({ 'source-host': smokeGroups, 'packaged-host': packagedGroups });
export const taskKey = task => `${task.job}/${task.variant}/${task.id}`;

export function diagnosticTasks(all, { payload = 'source', case: selectedCase, reason } = {}) {
  if (!['source', 'packaged'].includes(payload) || !selectedCase || !reason?.trim()) {
    throw new Error('Diagnostic requires a declared payload, one case and its reason');
  }
  const job = payload === 'packaged' ? 'packaged-host' : 'source-host';
  const selected = all.filter(task => task.job === job && task.suite === selectedCase);
  if (selected.length !== 1) throw new Error(`Unknown/ambiguous diagnostic case: ${payload}/${selectedCase}`);
  const ancestors = new Set();
  const visit = name => { for (const dependency of jobDependencies[name]) {
    if (!ancestors.has(dependency)) { ancestors.add(dependency); visit(dependency); }
  } };
  visit(job);
  return all.filter(task => ancestors.has(task.job) || task === selected[0]);
}
