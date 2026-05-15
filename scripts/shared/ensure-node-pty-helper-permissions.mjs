import fs from 'fs';
import { createRequire } from 'module';
import path from 'path';

const require = createRequire(import.meta.url);

if (process.platform === 'win32') {
  process.exit(0);
}

const packageJsonPath = resolveNodePtyPackageJson();
if (!packageJsonPath) {
  process.exit(0);
}

const packageRoot = path.dirname(packageJsonPath);
const helperCandidates = [
  path.join(packageRoot, 'build', 'Release', 'spawn-helper'),
  path.join(packageRoot, 'build', 'Debug', 'spawn-helper'),
  path.join(packageRoot, 'prebuilds', `${process.platform}-${process.arch}`, 'spawn-helper')
];

let updatedCount = 0;
for (const helperPath of helperCandidates) {
  if (!fs.existsSync(helperPath)) {
    continue;
  }

  const currentMode = fs.statSync(helperPath).mode & 0o777;
  if ((currentMode & 0o111) !== 0) {
    continue;
  }

  fs.chmodSync(helperPath, currentMode | 0o755);
  updatedCount += 1;
}

if (updatedCount > 0) {
  console.log(`已修正 ${updatedCount} 个 node-pty spawn-helper 的可执行权限。`);
}

function resolveNodePtyPackageJson() {
  try {
    return require.resolve('node-pty/package.json');
  } catch {
    return null;
  }
}
