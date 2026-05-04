import { spawnSync } from 'child_process';
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

import { resolveCommand } from '../../../../scripts/package-vsix.mjs';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(packageRoot, '../../..');
const packageRepoRelativePath = toPosixPath(path.relative(repoRoot, packageRoot));
const isWindows = process.platform === 'win32';
const isMainModule = process.argv[1]
  ? import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
  : false;

if (isMainModule) {
  process.exit(main());
}

export function main() {
  const packageJsonPath = path.join(packageRoot, 'package.json');
  const vsceEntry = resolveVsceEntry(repoRoot);
  const gitValidationRoot =
    process.env.DEV_SESSION_CANVAS_VSCE_VALIDATE_GIT_ROOT?.trim() || repoRoot;

  if (!vsceEntry) {
    console.error(
      '未找到由 @vscode/vsce 提供的本地 vsce 可执行文件。请先在仓库根目录运行 npm install，再重新执行 notifier 的 package:vsix。'
    );
    return 1;
  }

  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
  const readmePath =
    process.env.DEV_SESSION_CANVAS_VSCE_README_PATH?.trim() || 'README.marketplace.md';
  const docBranch = resolveVsceDocRef(gitValidationRoot);
  const baseUrls = resolveVsceBaseUrls(packageJson.homepage, docBranch, packageRepoRelativePath);
  const packageArgs = ['package'];

  validateReadmeRewriteTargets({
    packageRoot,
    repoRoot,
    packageRepoRelativePath,
    gitValidationRoot,
    readmePath,
    docBranch,
    baseUrls
  });

  assertPackageInputsExist();

  const stageRoot = mkdtempSync(path.join(os.tmpdir(), 'dsc-notifier-vsix-'));
  const stagePackageRoot = path.join(stageRoot, 'package');
  mkdirSync(stagePackageRoot, { recursive: true });

  try {
    stagePackageFiles(stagePackageRoot, packageJson, readmePath);

    packageArgs.push('--readme-path', readmePath);

    if (baseUrls?.contentUrl) {
      packageArgs.push('--baseContentUrl', baseUrls.contentUrl);
    }

    if (baseUrls?.imagesUrl) {
      packageArgs.push('--baseImagesUrl', baseUrls.imagesUrl);
    }

    const command = resolveCommand(vsceEntry, packageArgs);
    const result = spawnSync(command.file, command.args, {
      cwd: stagePackageRoot,
      stdio: 'inherit',
      windowsVerbatimArguments: command.windowsVerbatimArguments
    });

    if (result.error) {
      throw result.error;
    }

    if (result.status === 0) {
      const vsixFilename = `${packageJson.name}-${packageJson.version}.vsix`;
      copyFileSync(path.join(stagePackageRoot, vsixFilename), path.join(packageRoot, vsixFilename));
      console.log(`已生成 ${path.join(packageRoot, vsixFilename)}`);
    }

    return result.status === null ? 1 : result.status;
  } finally {
    rmSync(stageRoot, { recursive: true, force: true });
  }
}

function assertPackageInputsExist() {
  const requiredPaths = [
    path.join(packageRoot, 'dist', 'extension.js'),
    path.join(packageRoot, 'README.marketplace.md'),
    path.join(packageRoot, 'CHANGELOG.md'),
    path.join(packageRoot, 'LICENSE'),
    path.join(packageRoot, 'images', 'icon.png'),
    path.join(packageRoot, 'images', 'activitybar.svg')
  ];

  for (const requiredPath of requiredPaths) {
    if (!existsSync(requiredPath)) {
      throw new Error(`notifier 打包缺少必需输入：${path.relative(packageRoot, requiredPath)}`);
    }
  }
}

function stagePackageFiles(stagePackageRoot, packageJson, readmePath) {
  const stagedPackageJson = JSON.parse(JSON.stringify(packageJson));
  delete stagedPackageJson.scripts;

  writeFileSync(
    path.join(stagePackageRoot, 'package.json'),
    `${JSON.stringify(stagedPackageJson, null, 2)}\n`,
    'utf8'
  );

  copyFileSync(path.join(packageRoot, readmePath), path.join(stagePackageRoot, readmePath));
  copyFileSync(path.join(packageRoot, 'CHANGELOG.md'), path.join(stagePackageRoot, 'CHANGELOG.md'));
  copyFileSync(path.join(packageRoot, 'LICENSE'), path.join(stagePackageRoot, 'LICENSE'));
  cpSync(path.join(packageRoot, 'dist'), path.join(stagePackageRoot, 'dist'), { recursive: true });
  cpSync(path.join(packageRoot, 'images'), path.join(stagePackageRoot, 'images'), { recursive: true });
}

function resolveVsceDocRef(gitRoot) {
  const explicitRef = process.env.DEV_SESSION_CANVAS_VSCE_DOC_BRANCH?.trim();
  if (explicitRef) {
    return explicitRef;
  }

  const resolvedHead = tryResolveGitRevision(gitRoot, 'HEAD');
  if (resolvedHead) {
    return resolvedHead;
  }

  throw new Error(
    '无法为 notifier Marketplace README 相对资源改写解析最终 git ref。请在带 .git 元数据的 checkout 中执行，或显式传入 DEV_SESSION_CANVAS_VSCE_DOC_BRANCH=<final-ref>。'
  );
}

function tryResolveGitRevision(rootDir, revision) {
  const result = spawnSync('git', ['rev-parse', revision], {
    cwd: rootDir,
    encoding: 'utf8'
  });

  if (result.error || result.status !== 0) {
    return undefined;
  }

  const value = result.stdout.trim();
  return value === '' ? undefined : value;
}

function validateReadmeRewriteTargets({
  packageRoot,
  repoRoot,
  packageRepoRelativePath,
  gitValidationRoot,
  readmePath,
  docBranch,
  baseUrls
}) {
  const absoluteReadmePath = path.resolve(packageRoot, readmePath);
  const readmeContent = readFileSync(absoluteReadmePath, 'utf8');
  const rewriteTargets = collectReadmeRewriteTargets(readmeContent);
  const resolvedTargets = [];

  for (const target of rewriteTargets) {
    const resolvedTarget = resolveReadmeTarget(
      packageRoot,
      repoRoot,
      packageRepoRelativePath,
      absoluteReadmePath,
      readmePath,
      target
    );
    if (!resolvedTarget) {
      continue;
    }

    const rewriteBaseUrl =
      target.kind === 'media'
        ? (baseUrls?.imagesUrl || baseUrls?.contentUrl)
        : (baseUrls?.contentUrl || baseUrls?.imagesUrl);
    if (!rewriteBaseUrl) {
      throw new Error(`无法为 ${readmePath} 中的相对链接生成可发布 URL：仓库 homepage 或 VSCE base URL 配置缺失。`);
    }

    const rewrittenUrl = buildRewrittenUrl(
      rewriteBaseUrl,
      resolvedTarget.packageRelativePath,
      resolvedTarget.suffix
    );
    resolvedTargets.push({
      ...target,
      ...resolvedTarget,
      rewrittenUrl
    });
  }

  const canValidateGitRef = Boolean(tryResolveGitRevision(gitValidationRoot, docBranch));
  if (canValidateGitRef) {
    for (const target of resolvedTargets) {
      assertGitPathExistsAtRef(gitValidationRoot, docBranch, readmePath, target);
    }
  }

  if (resolvedTargets.length > 0) {
    console.log(`VSCE README doc ref: ${docBranch}`);
    console.log(`已校验 ${readmePath} 中 ${resolvedTargets.length} 个会被重写的相对链接。`);
  }
}

function collectReadmeRewriteTargets(readmeContent) {
  const rewriteTargets = new Map();
  const markdownImagePattern = /!\[[^\]]*]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  const markdownLinkPattern = /(?<!!)\[[^\]]*]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  const htmlAssetPattern = /<(img|video|source|audio|a)\b[^>]*?\b(src|href|poster)=["']([^"']+)["'][^>]*>/gi;

  let match;
  while ((match = markdownImagePattern.exec(readmeContent)) !== null) {
    addRewriteTarget(rewriteTargets, 'media', match[1]);
  }

  while ((match = markdownLinkPattern.exec(readmeContent)) !== null) {
    addRewriteTarget(rewriteTargets, 'content', match[1]);
  }

  while ((match = htmlAssetPattern.exec(readmeContent)) !== null) {
    const tagName = match[1].toLowerCase();
    const attributeName = match[2].toLowerCase();
    const kind = tagName === 'a' && attributeName === 'href' ? 'content' : 'media';
    addRewriteTarget(rewriteTargets, kind, match[3]);
  }

  return [...rewriteTargets.values()];
}

function addRewriteTarget(rewriteTargets, kind, target) {
  const cacheKey = `${kind}:${target}`;
  if (!rewriteTargets.has(cacheKey)) {
    rewriteTargets.set(cacheKey, { kind, target });
  }
}

function resolveReadmeTarget(
  packageRoot,
  repoRoot,
  packageRepoRelativePath,
  absoluteReadmePath,
  readmePath,
  target
) {
  const { targetPath, suffix } = splitTargetSuffix(target.target);
  if (!isRelativeReadmeTarget(targetPath)) {
    return undefined;
  }

  const absoluteTargetPath = path.resolve(path.dirname(absoluteReadmePath), targetPath);
  const packageRelativeTargetPath = path.relative(packageRoot, absoluteTargetPath);
  if (packageRelativeTargetPath.startsWith('..') || path.isAbsolute(packageRelativeTargetPath)) {
    throw new Error(`${readmePath} 中的相对路径 ${target.target} 超出了 notifier 子包目录，无法作为子包 Marketplace README 资源。`);
  }

  const repoRelativeTargetPath = path.relative(repoRoot, absoluteTargetPath);
  if (repoRelativeTargetPath.startsWith('..') || path.isAbsolute(repoRelativeTargetPath)) {
    throw new Error(`${readmePath} 中的相对路径 ${target.target} 超出了仓库根目录，无法作为 Marketplace README 资源。`);
  }

  if (!existsSync(absoluteTargetPath)) {
    throw new Error(`${readmePath} 中引用的相对路径 ${target.target} 不存在，无法生成可发布的 README 链接。`);
  }

  return {
    suffix,
    packageRelativePath: toPosixPath(packageRelativeTargetPath),
    repoRelativePath: toPosixPath(path.join(packageRepoRelativePath, packageRelativeTargetPath))
  };
}

function splitTargetSuffix(target) {
  const suffixMatch = /([?#].*)$/.exec(target);
  if (!suffixMatch) {
    return {
      suffix: '',
      targetPath: target
    };
  }

  return {
    suffix: suffixMatch[1],
    targetPath: target.slice(0, -suffixMatch[1].length)
  };
}

function isRelativeReadmeTarget(targetPath) {
  if (targetPath === '' || targetPath.startsWith('#') || targetPath.startsWith('/') || targetPath.startsWith('//')) {
    return false;
  }

  return !/^[a-z][a-z0-9+.-]*:/i.test(targetPath);
}

function buildRewrittenUrl(baseUrl, packageRelativePath, suffix) {
  const normalizedBaseUrl = `${baseUrl.replace(/\/+$/, '')}/`;
  return new URL(`${packageRelativePath}${suffix}`, normalizedBaseUrl).toString();
}

function assertGitPathExistsAtRef(gitRoot, gitRef, readmePath, target) {
  const result = spawnSync('git', ['cat-file', '-e', `${gitRef}:${target.repoRelativePath}`], {
    cwd: gitRoot
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(
      `${readmePath} 中的相对路径 ${target.target} 会被改写为 ${target.rewrittenUrl}，但该路径在 git ref ${gitRef} 上不存在。请改用最终发布 ref，或显式传入 DEV_SESSION_CANVAS_VSCE_DOC_BRANCH=<final-ref> 后重试。`
    );
  }
}

function resolveVsceBaseUrls(homepage, branch, packageRepoRelativePath) {
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
      contentUrl: `${normalizedHomepage}/blob/${branch}/${packageRepoRelativePath}`,
      imagesUrl: `${normalizedHomepage}/raw/${branch}/${packageRepoRelativePath}`
    };
  }

  return {
    contentUrl: `${normalizedHomepage}/-/blob/${branch}/${packageRepoRelativePath}`,
    imagesUrl: `${normalizedHomepage}/-/raw/${branch}/${packageRepoRelativePath}`
  };
}

function toPosixPath(filePath) {
  return filePath.split(path.sep).join('/');
}

function resolveVsceEntry(rootDir) {
  const binName = isWindows ? 'vsce.cmd' : 'vsce';
  const localBinPath = path.resolve(rootDir, 'node_modules', '.bin', binName);
  if (existsSync(localBinPath)) {
    return {
      kind: 'direct',
      path: localBinPath
    };
  }

  const packageScriptPath = path.resolve(rootDir, 'node_modules', '@vscode', 'vsce', 'vsce');
  if (existsSync(packageScriptPath)) {
    return {
      kind: 'node-script',
      path: packageScriptPath
    };
  }

  return undefined;
}
