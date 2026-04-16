import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { promises as fs } from 'fs';

const projectRoot = process.cwd();
const args = process.argv.slice(2);

async function main() {
  const options = parseArgs(args);
  if (options.help) {
    printHelp();
    return;
  }

  const vsceDocRef = resolveGitRevision(projectRoot, options.sourceMode === 'git-ref' ? options.gitRef : 'HEAD');
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'dev-session-canvas-clean-checkout-'));
  const checkoutDir = path.join(tempRoot, 'repo');
  const npmCacheDir = path.join(tempRoot, 'npm-cache');
  const tempHomeDir = path.join(tempRoot, 'home');
  const xdgCacheDir = path.join(tempRoot, '.cache');
  const npmUserConfigPath = path.join(tempRoot, '.npmrc');

  console.log(`准备隔离 clean checkout 验证目录: ${checkoutDir}`);
  console.log(
    options.sourceMode === 'working-tree'
      ? '源内容: 当前 working tree 快照（已排除 .git、node_modules、.debug 等本地噪音）'
      : `源内容: git ref ${options.gitRef}`
  );
  console.log(`README 改写使用的 git ref: ${vsceDocRef}`);

  try {
    if (options.sourceMode === 'working-tree') {
      await snapshotWorkingTree(checkoutDir);
    } else {
      await exportGitRef(checkoutDir, tempRoot, options.gitRef);
    }

    await fs.mkdir(npmCacheDir, { recursive: true });
    await fs.mkdir(tempHomeDir, { recursive: true });
    await fs.mkdir(xdgCacheDir, { recursive: true });
    await fs.writeFile(npmUserConfigPath, '', 'utf8');
    const isolatedEnv = {
      ...process.env,
      HOME: tempHomeDir,
      XDG_CACHE_HOME: xdgCacheDir,
      NPM_CONFIG_CACHE: npmCacheDir,
      npm_config_cache: npmCacheDir,
      NPM_CONFIG_USERCONFIG: npmUserConfigPath,
      npm_config_userconfig: npmUserConfigPath,
      DEV_SESSION_CANVAS_VSCE_DOC_BRANCH: vsceDocRef,
      DEV_SESSION_CANVAS_VSCE_VALIDATE_GIT_ROOT: projectRoot
    };

    runCommand(
      'npm',
      ['ci'],
      {
        cwd: checkoutDir,
        env: isolatedEnv
      },
      'clean checkout `npm ci` 失败。'
    );

    runCommand('npm', ['run', 'package:vsix'], { cwd: checkoutDir, env: isolatedEnv }, 'clean checkout `npm run package:vsix` 失败。');

    const latestVsixPath = await resolveLatestVsixPath(checkoutDir);
    const stats = await fs.stat(latestVsixPath);
    console.log(`clean checkout VSIX: ${latestVsixPath}`);
    console.log(`clean checkout VSIX 大小: ${formatBytes(stats.size)}`);

    if (!options.skipVsixSmoke) {
      runCommand(
        'npm',
        ['run', 'test:vsix-smoke'],
        {
          cwd: checkoutDir,
          env: isolatedEnv
        },
        'clean checkout `npm run test:vsix-smoke` 失败。'
      );
    } else {
      console.log('已跳过 clean checkout VSIX smoke。');
    }

    console.log(`clean checkout 验证完成。临时目录: ${tempRoot}`);
    if (!options.keepTemp) {
      await fs.rm(tempRoot, { recursive: true, force: true });
      console.log('临时目录已清理。');
    } else {
      console.log('按参数保留临时目录，便于后续人工检查。');
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    console.error(`失败时的临时目录保留在: ${tempRoot}`);
    process.exitCode = 1;
  }
}

function parseArgs(argv) {
  const options = {
    gitRef: 'HEAD',
    help: false,
    keepTemp: false,
    skipVsixSmoke: false,
    sourceMode: 'git-ref'
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }

    if (arg === '--keep-temp') {
      options.keepTemp = true;
      continue;
    }

    if (arg === '--skip-vsix-smoke') {
      options.skipVsixSmoke = true;
      continue;
    }

    if (arg === '--source') {
      const nextValue = argv[index + 1];
      if (nextValue !== 'git-ref' && nextValue !== 'working-tree') {
        throw new Error('`--source` 只支持 `git-ref` 或 `working-tree`。');
      }
      options.sourceMode = nextValue;
      index += 1;
      continue;
    }

    if (arg === '--ref') {
      const nextValue = argv[index + 1];
      if (!nextValue) {
        throw new Error('`--ref` 后必须提供 git ref。');
      }
      options.gitRef = nextValue;
      index += 1;
      continue;
    }

    throw new Error(`未知参数: ${arg}`);
  }

  return options;
}

function printHelp() {
  console.log(`用法:
  node scripts/run-clean-checkout-vsix-validation.mjs [--ref <git-ref>] [--source git-ref|working-tree] [--skip-vsix-smoke] [--keep-temp]

说明:
  - 默认从当前仓库的 git ref HEAD 导出 clean checkout。
  - 如需基于当前 working tree 的隔离快照准备验证，可传 --source working-tree。
  - 默认会把 README 改写 ref 固定到最终 git ref，并执行 npm ci、npm run package:vsix 和 npm run test:vsix-smoke。
  - 传 --skip-vsix-smoke 可只做到 clean checkout 打包。
  - 传 --keep-temp 会保留 /tmp 下的临时目录，便于人工检查。`);
}

function resolveGitRevision(rootDir, revision) {
  const result = spawnSync('git', ['rev-parse', revision], {
    cwd: rootDir,
    encoding: 'utf8'
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`无法解析 git ref ${revision}。`);
  }

  return result.stdout.trim();
}

async function exportGitRef(checkoutDir, tempRoot, gitRef) {
  await fs.mkdir(checkoutDir, { recursive: true });
  const archivePath = path.join(tempRoot, 'source.tar');
  runCommand(
    'git',
    ['archive', '--format=tar', '--output', archivePath, gitRef],
    { cwd: projectRoot },
    `无法导出 git ref ${gitRef}。`
  );
  runCommand('tar', ['-xf', archivePath, '-C', checkoutDir], { cwd: projectRoot }, '解包 git archive 失败。');
}

async function snapshotWorkingTree(checkoutDir) {
  await fs.cp(projectRoot, checkoutDir, {
    recursive: true,
    filter: (sourcePath) => shouldCopyPath(sourcePath)
  });
}

function shouldCopyPath(sourcePath) {
  const relativePath = path.relative(projectRoot, sourcePath);
  if (relativePath === '') {
    return true;
  }

  const pathParts = relativePath.split(path.sep);
  const topLevel = pathParts[0];
  if (new Set(['.git', '.debug', '.playwright-browsers', '.vscode-test', 'node_modules']).has(topLevel)) {
    return false;
  }

  if (topLevel === 'dist') {
    return false;
  }

  const baseName = path.basename(sourcePath);
  if (baseName.endsWith('.vsix') || baseName.endsWith('.tgz')) {
    return false;
  }

  if (baseName === 'image.png' || baseName.startsWith('image copy') || baseName.startsWith('img_v3_')) {
    return false;
  }

  if (baseName === 'core' || baseName.startsWith('core.')) {
    return false;
  }

  return true;
}

async function resolveLatestVsixPath(rootDir) {
  const entries = await fs.readdir(rootDir, { withFileTypes: true });
  const candidates = await Promise.all(
    entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.vsix'))
      .map(async (entry) => {
        const absolutePath = path.join(rootDir, entry.name);
        const stats = await fs.stat(absolutePath);
        return {
          absolutePath,
          mtimeMs: stats.mtimeMs
        };
      })
  );

  const latest = candidates.sort((left, right) => right.mtimeMs - left.mtimeMs)[0];
  if (!latest) {
    throw new Error('clean checkout 验证结束后未找到 VSIX 产物。');
  }

  return latest.absolutePath;
}

function runCommand(file, commandArgs, options, failureMessage) {
  const result = spawnSync(file, commandArgs, {
    stdio: 'inherit',
    ...options
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(failureMessage);
  }
}

function formatBytes(sizeInBytes) {
  if (sizeInBytes < 1024) {
    return `${sizeInBytes} B`;
  }

  const units = ['KB', 'MB', 'GB'];
  let value = sizeInBytes / 1024;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value.toFixed(2)} ${units[unitIndex]}`;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
