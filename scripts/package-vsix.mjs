import { spawnSync } from 'child_process';
import { existsSync } from 'fs';
import path from 'path';

const projectRoot = process.cwd();
const isWindows = process.platform === 'win32';
const binaryName = isWindows ? 'vsce.cmd' : 'vsce';
const binaryPath = path.resolve(projectRoot, 'node_modules', '.bin', binaryName);

if (!existsSync(binaryPath)) {
  console.error(
    '未找到本地 vsce 可执行文件。请先在仓库根目录运行 npm install，再重新执行 npm run package:vsix。'
  );
  process.exit(1);
}

const command = isWindows
  ? {
      // Windows 需要经 cmd.exe 调用 .cmd 脚本，不能像普通可执行文件一样直接 spawn。
      file: process.env.ComSpec || process.env.COMSPEC || 'cmd.exe',
      args: ['/d', '/s', '/c', `"${binaryPath}" package`]
    }
  : {
      file: binaryPath,
      args: ['package']
    };

const result = spawnSync(command.file, command.args, {
  cwd: projectRoot,
  stdio: 'inherit'
});

if (result.error) {
  throw result.error;
}

process.exit(result.status === null ? 1 : result.status);
