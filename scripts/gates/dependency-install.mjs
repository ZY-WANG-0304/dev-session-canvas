import assert from 'node:assert/strict';
import path from 'node:path';

export const pluginWorkspaces = Object.freeze([
  'extensions/vscode/dev-session-canvas',
  'extensions/vscode/dev-session-canvas-notifier',
  'packages/attention-protocol',
  'packages/marketplace-shared'
]);

export function dependencyInstallArgs(profile) {
  assert(['plugin', 'marketplace'].includes(profile), 'Declare plugin or marketplace dependency profile');
  const workspaces = profile === 'marketplace'
    ? [...pluginWorkspaces, 'apps/template-marketplace'] : pluginWorkspaces;
  return ['ci', '--no-audit', '--no-fund', '--include-workspace-root',
    ...workspaces.map(workspace => `--workspace=${workspace}`)];
}

const marketplaceScripts = new Set(['typecheck:marketplace', 'test:marketplace-api', 'test:marketplace-web']);

// Select from the actual task set, so reshuffling shards cannot change their
// dependency requirements. Shared-only tests and Node HTTP fixtures need no Worker.
export function dependencyProfileForTasks(tasks) {
  assert(Array.isArray(tasks) && tasks.length, 'Dependency selection needs actual tasks');
  return tasks.some(task => task.job === 'regression' && marketplaceScripts.has(task.id)) ? 'marketplace' : 'plugin';
}

export function npmLogEnvironment(env, directory) {
  return { ...env, NPM_CONFIG_LOGS_DIR: path.resolve(directory), npm_config_logs_dir: path.resolve(directory) };
}
