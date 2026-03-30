import { spawnSync } from 'child_process';
import { existsSync } from 'fs';
import path from 'path';

const binaryName = process.platform === 'win32' ? 'vsce.cmd' : 'vsce';
const binaryPath = path.resolve(process.cwd(), 'node_modules', '.bin', binaryName);

if (!existsSync(binaryPath)) {
  console.error(
    '未找到本地 vsce 可执行文件。请先在仓库根目录运行 npm install，再重新执行 npm run package:vsix。'
  );
  process.exit(1);
}

const result = spawnSync(binaryPath, ['package'], {
  cwd: process.cwd(),
  stdio: 'inherit'
});

if (result.error) {
  throw result.error;
}

process.exit(result.status === null ? 1 : result.status);
