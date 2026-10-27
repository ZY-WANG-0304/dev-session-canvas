import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const browserSystemPackages = ['xvfb', 'libgtk-3-0', 'libnss3', 'libasound2'];

export function ensureBrowserSystemDependencies(run = execFileSync) {
  const installed = name => {
    try {
      return run('dpkg-query', ['-W', '-f=${Status}', name],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim() === 'install ok installed';
    } catch (error) {
      if (error.status === 1) return false; // dpkg-query: package is not registered.
      throw error;
    }
  };
  if (browserSystemPackages.every(installed)) return { installed: false, packages: browserSystemPackages };
  // The workflow's original step timeout covers checks, installation and verification.
  run('sudo', ['apt-get', 'update'], { stdio: 'inherit' });
  run('sudo', ['apt-get', 'install', '-y', ...browserSystemPackages], { stdio: 'inherit' });
  assert(browserSystemPackages.every(installed), 'Browser system dependencies remain unavailable after installation');
  return { installed: true, packages: browserSystemPackages };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  console.log(JSON.stringify(ensureBrowserSystemDependencies()));
}
