import { spawnSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import path from 'path';

const projectRoot = process.cwd();
const isWindows = process.platform === 'win32';
const binaryName = isWindows ? 'vsce.cmd' : 'vsce';
const binaryPath = path.resolve(projectRoot, 'node_modules', '.bin', binaryName);
const packageJsonPath = path.join(projectRoot, 'package.json');

if (!existsSync(binaryPath)) {
  console.error(
    '未找到本地 vsce 可执行文件。请先在仓库根目录运行 npm install，再重新执行 npm run package:vsix。'
  );
  process.exit(1);
}

const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
const docBranch = process.env.DEV_SESSION_CANVAS_VSCE_DOC_BRANCH?.trim() || 'main';
const baseUrls = resolveVsceBaseUrls(packageJson.homepage, docBranch);
const packageArgs = ['package'];

if (baseUrls?.contentUrl) {
  packageArgs.push('--baseContentUrl', baseUrls.contentUrl);
}

if (baseUrls?.imagesUrl) {
  packageArgs.push('--baseImagesUrl', baseUrls.imagesUrl);
}

const command = isWindows
  ? {
      // Windows 需要经 cmd.exe 调用 .cmd 脚本，不能像普通可执行文件一样直接 spawn。
      file: process.env.ComSpec || process.env.COMSPEC || 'cmd.exe',
      args: ['/d', '/s', '/c', `"${binaryPath}" ${packageArgs.map(quoteForWindowsCmd).join(' ')}`]
    }
  : {
      file: binaryPath,
      args: packageArgs
    };

const result = spawnSync(command.file, command.args, {
  cwd: projectRoot,
  stdio: 'inherit'
});

if (result.error) {
  throw result.error;
}

process.exit(result.status === null ? 1 : result.status);

function resolveVsceBaseUrls(homepage, branch) {
  const contentOverride = process.env.DEV_SESSION_CANVAS_VSCE_BASE_CONTENT_URL?.trim();
  const imagesOverride = process.env.DEV_SESSION_CANVAS_VSCE_BASE_IMAGES_URL?.trim();

  if (contentOverride || imagesOverride) {
    return {
      contentUrl: contentOverride || undefined,
      imagesUrl: imagesOverride || contentOverride || undefined
    };
  }

  if (typeof homepage !== 'string' || homepage.trim() === '') {
    return undefined;
  }

  const normalizedHomepage = homepage.trim().replace(/\/+$/, '');
  if (normalizedHomepage.includes('github.com/')) {
    return {
      contentUrl: `${normalizedHomepage}/blob/${branch}`,
      imagesUrl: `${normalizedHomepage}/raw/${branch}`
    };
  }

  return {
    contentUrl: `${normalizedHomepage}/-/blob/${branch}`,
    imagesUrl: `${normalizedHomepage}/-/raw/${branch}`
  };
}

function quoteForWindowsCmd(value) {
  return /[\s"]/u.test(value) ? `"${value.replace(/"/g, '\\"')}"` : value;
}
