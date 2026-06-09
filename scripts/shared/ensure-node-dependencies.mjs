import { access, constants } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const dependencyProbePath = path.join(repoRoot, 'node_modules', 'esbuild', 'package.json');

try {
  await access(dependencyProbePath, constants.R_OK);
  process.exit(0);
} catch {
  // Continue to npm ci when the worktree was just created and node_modules is absent.
}

console.log('node_modules is missing. Running npm ci before the debug build...');
const result = spawnSync('npm', ['ci'], {
  cwd: repoRoot,
  stdio: 'inherit',
  shell: process.platform === 'win32'
});

if (result.error) {
  console.error(result.error);
  process.exit(1);
}

process.exit(result.status ?? 1);
