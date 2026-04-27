import { spawnSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';

const projectRoot = process.cwd();
const isWindows = process.platform === 'win32';
const isMainModule = process.argv[1]
  ? import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
  : false;

if (isMainModule) {
  process.exit(main());
}

export function main() {
  const packageJsonPath = path.join(projectRoot, 'package.json');
  const vsceEntry = resolveVsceEntry(projectRoot);
  const gitValidationRoot =
    process.env.DEV_SESSION_CANVAS_VSCE_VALIDATE_GIT_ROOT?.trim() || projectRoot;

  if (!vsceEntry) {
    console.error(
      '未找到由 @vscode/vsce 提供的本地 vsce 可执行文件。请先在仓库根目录运行 npm install，再重新执行 npm run package:vsix。'
    );
    return 1;
  }

  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
  const readmePath =
    process.env.DEV_SESSION_CANVAS_VSCE_README_PATH?.trim() || 'README.marketplace.md';
  const docBranch = resolveVsceDocRef(gitValidationRoot);
  const baseUrls = resolveVsceBaseUrls(packageJson.homepage, docBranch);
  const packageArgs = ['package'];

  validateReadmeRewriteTargets({
    projectRoot,
    gitValidationRoot,
    readmePath,
    docBranch,
    baseUrls
  });

  packageArgs.push('--readme-path', readmePath);

  if (baseUrls?.contentUrl) {
    packageArgs.push('--baseContentUrl', baseUrls.contentUrl);
  }

  if (baseUrls?.imagesUrl) {
    packageArgs.push('--baseImagesUrl', baseUrls.imagesUrl);
  }

  const command = resolveCommand(vsceEntry, packageArgs);

  const result = spawnSync(command.file, command.args, {
    cwd: projectRoot,
    stdio: 'inherit',
    windowsVerbatimArguments: command.windowsVerbatimArguments
  });

  if (result.error) {
    throw result.error;
  }

  return result.status === null ? 1 : result.status;
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
    '无法为 README 相对资源改写解析最终 git ref。请在带 .git 元数据的 checkout 中执行，或显式传入 DEV_SESSION_CANVAS_VSCE_DOC_BRANCH=<final-ref>。'
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

function validateReadmeRewriteTargets({ projectRoot, gitValidationRoot, readmePath, docBranch, baseUrls }) {
  const absoluteReadmePath = path.resolve(projectRoot, readmePath);
  const readmeContent = readFileSync(absoluteReadmePath, 'utf8');
  const rewriteTargets = collectReadmeRewriteTargets(readmeContent);
  const resolvedTargets = [];

  for (const target of rewriteTargets) {
    const resolvedTarget = resolveReadmeTarget(projectRoot, absoluteReadmePath, readmePath, target);
    if (!resolvedTarget) {
      continue;
    }

    const rewriteBaseUrl = target.kind === 'media' ? (baseUrls?.imagesUrl || baseUrls?.contentUrl) : (baseUrls?.contentUrl || baseUrls?.imagesUrl);
    if (!rewriteBaseUrl) {
      throw new Error(`无法为 ${readmePath} 中的相对链接生成可发布 URL：仓库 homepage 或 VSCE base URL 配置缺失。`);
    }

    const rewrittenUrl = buildRewrittenUrl(rewriteBaseUrl, resolvedTarget.repoRelativePath, resolvedTarget.suffix);
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

function resolveReadmeTarget(projectRoot, absoluteReadmePath, readmePath, target) {
  const { targetPath, suffix } = splitTargetSuffix(target.target);
  if (!isRelativeReadmeTarget(targetPath)) {
    return undefined;
  }

  const absoluteTargetPath = path.resolve(path.dirname(absoluteReadmePath), targetPath);
  const relativeTargetPath = path.relative(projectRoot, absoluteTargetPath);
  if (relativeTargetPath.startsWith('..') || path.isAbsolute(relativeTargetPath)) {
    throw new Error(`${readmePath} 中的相对路径 ${target.target} 超出了仓库根目录，无法作为 Marketplace README 资源。`);
  }

  if (!existsSync(absoluteTargetPath)) {
    throw new Error(`${readmePath} 中引用的相对路径 ${target.target} 不存在，无法生成可发布的 README 链接。`);
  }

  return {
    suffix,
    repoRelativePath: toPosixPath(relativeTargetPath)
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

function buildRewrittenUrl(baseUrl, repoRelativePath, suffix) {
  const normalizedBaseUrl = `${baseUrl.replace(/\/+$/, '')}/`;
  return new URL(`${repoRelativePath}${suffix}`, normalizedBaseUrl).toString();
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

function toPosixPath(filePath) {
  return filePath.split(path.sep).join('/');
}

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

function buildWindowsBatchShellArgs(file, args) {
  const shellCommand = [escapeWindowsCmdCommand(file), ...args.map(escapeWindowsCmdArgument)].join(
    ' '
  );
  return `/d /s /c "${shellCommand}"`;
}

function escapeWindowsCmdCommand(value) {
  return value.replace(WINDOWS_CMD_META_CHARS_REGEXP, '^$1');
}

function escapeWindowsCmdArgument(value) {
  let normalizedValue = `${value}`;

  normalizedValue = normalizedValue.replace(/(?=(\\+?)?)\1"/g, '$1$1\\"');
  normalizedValue = normalizedValue.replace(/(?=(\\+?)?)\1$/, '$1$1');
  normalizedValue = `"${normalizedValue}"`;

  return normalizedValue.replace(WINDOWS_CMD_META_CHARS_REGEXP, '^$1');
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

export function resolveCommand(vsceEntry, packageArgs, options = {}) {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;

  if (vsceEntry.kind === 'node-script') {
    return {
      file: process.execPath,
      args: [vsceEntry.path, ...packageArgs]
    };
  }

  if (platform === 'win32') {
    return {
      // `cmd.exe` reparses `/c` as shell syntax, so pass one fully escaped
      // command string and mark it as verbatim for Windows process creation.
      file: env.ComSpec || env.COMSPEC || 'cmd.exe',
      args: [buildWindowsBatchShellArgs(vsceEntry.path, packageArgs)],
      windowsVerbatimArguments: true
    };
  }

  return {
    file: vsceEntry.path,
    args: packageArgs
  };
}

const WINDOWS_CMD_META_CHARS_REGEXP = /([()\][%!^"`<>&|;, *?])/g;
