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
import { pathToFileURL } from 'url';

const projectRoot = resolveProjectRoot();
const mainExtensionRoot = path.join(projectRoot, 'extensions', 'vscode', 'dev-session-canvas');
const mainExtensionRepoRelativePath = toPosixPath(path.relative(projectRoot, mainExtensionRoot));
const isWindows = process.platform === 'win32';
const isMainModule = process.argv[1]
  ? import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
  : false;

if (isMainModule) {
  process.exit(main());
}

function resolveProjectRoot() {
  const cwd = process.cwd();
  if (existsSync(path.join(cwd, 'extensions', 'vscode', 'dev-session-canvas', 'package.json'))) {
    return cwd;
  }

  const possibleRepoRoot = path.resolve(cwd, '..', '..', '..');
  if (
    existsSync(path.join(possibleRepoRoot, 'extensions', 'vscode', 'dev-session-canvas', 'package.json')) &&
    path.resolve(possibleRepoRoot, 'extensions', 'vscode', 'dev-session-canvas') === cwd
  ) {
    return possibleRepoRoot;
  }

  return cwd;
}

export function main() {
  const packageJsonPath = path.join(mainExtensionRoot, 'package.json');
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
  const baseUrls = resolveVsceBaseUrls(
    packageJson.homepage,
    docBranch,
    mainExtensionRepoRelativePath
  );
  const packageArgs = ['package'];

  validateReadmeRewriteTargets({
    packageRoot: mainExtensionRoot,
    repoRoot: projectRoot,
    packageRepoRelativePath: mainExtensionRepoRelativePath,
    gitValidationRoot,
    readmePath,
    docBranch,
    baseUrls
  });

  assertMainPackageInputsExist();

  const stageRoot = mkdtempSync(path.join(os.tmpdir(), 'dsc-main-vsix-'));
  const stagePackageRoot = path.join(stageRoot, 'package');
  mkdirSync(stagePackageRoot, { recursive: true });

  try {
    stageMainPackageFiles(stagePackageRoot, packageJson, readmePath);

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
      env: buildCliToolEnv(),
      stdio: 'inherit',
      windowsVerbatimArguments: command.windowsVerbatimArguments
    });

    if (result.error) {
      throw result.error;
    }

    if (result.status === 0) {
      const vsixFilename = `${packageJson.name}-${packageJson.version}.vsix`;
      copyFileSync(path.join(stagePackageRoot, vsixFilename), path.join(projectRoot, vsixFilename));
      console.log(`已生成 ${path.join(projectRoot, vsixFilename)}`);
    }

    return result.status === null ? 1 : result.status;
  } finally {
    rmSync(stageRoot, { recursive: true, force: true });
  }
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

  if (result.status !== 0) {
    return undefined;
  }

  const value = result.stdout.trim();
  return value === '' ? undefined : value;
}

function buildCliToolEnv() {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.VSCODE_IPC_HOOK_CLI;
  for (const key of Object.keys(env)) {
    if (key.startsWith('VSCODE_')) {
      delete env[key];
    }
  }
  return env;
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

    const rewriteBaseUrl = target.kind === 'media' ? (baseUrls?.imagesUrl || baseUrls?.contentUrl) : (baseUrls?.contentUrl || baseUrls?.imagesUrl);
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

  const explicitDocRef = Boolean(process.env.DEV_SESSION_CANVAS_VSCE_DOC_BRANCH?.trim());
  const canValidateGitRef =
    Boolean(tryResolveGitRevision(gitValidationRoot, docBranch)) &&
    (explicitDocRef || isGitWorktreeClean(gitValidationRoot));
  if (canValidateGitRef) {
    for (const target of resolvedTargets) {
      assertGitPathExistsAtRef(gitValidationRoot, docBranch, readmePath, target);
    }
  } else if (resolvedTargets.length > 0) {
    console.log(
      '当前 git 工作树不是 clean 状态，已仅校验 README 相对资源在文件系统中存在；发布打包必须显式传入 DEV_SESSION_CANVAS_VSCE_DOC_BRANCH=<final-ref>。'
    );
  }

  console.log(`VSCE README doc ref: ${docBranch}`);

  if (resolvedTargets.length > 0) {
    console.log(`已校验 ${readmePath} 中 ${resolvedTargets.length} 个会被重写的相对链接。`);
  } else {
    console.log(`${readmePath} 当前没有需要重写的相对链接。`);
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
    throw new Error(`${readmePath} 中的相对路径 ${target.target} 超出了主扩展子包目录，无法作为子包 Marketplace README 资源。`);
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

  if (result.status !== 0) {
    if (result.error) {
      throw result.error;
    }
    throw new Error(
      `${readmePath} 中的相对路径 ${target.target} 会被改写为 ${target.rewrittenUrl}，但该路径在 git ref ${gitRef} 上不存在。请改用最终发布 ref，或显式传入 DEV_SESSION_CANVAS_VSCE_DOC_BRANCH=<final-ref> 后重试。`
    );
  }
}

function isGitWorktreeClean(gitRoot) {
  const result = spawnSync('git', ['status', '--porcelain'], {
    cwd: gitRoot,
    encoding: 'utf8'
  });

  return result.status === 0 && result.stdout.trim() === '';
}

function toPosixPath(filePath) {
  return filePath.split(path.sep).join('/');
}

function assertMainPackageInputsExist() {
  const requiredPaths = [
    path.join(mainExtensionRoot, 'dist', 'extension.js'),
    path.join(mainExtensionRoot, 'dist', 'webview.js'),
    path.join(mainExtensionRoot, 'dist', 'webview.css'),
    path.join(mainExtensionRoot, 'README.marketplace.md'),
    path.join(mainExtensionRoot, 'CHANGELOG.md'),
    path.join(mainExtensionRoot, 'LICENSE'),
    path.join(mainExtensionRoot, 'package.nls.json'),
    path.join(mainExtensionRoot, 'images', 'icon.png'),
    path.join(mainExtensionRoot, 'scripts', 'runtime', 'claude-file-event-hook.cjs'),
    path.join(projectRoot, 'node_modules', 'node-pty', 'package.json')
  ];

  for (const requiredPath of requiredPaths) {
    if (!existsSync(requiredPath)) {
      const relativePath = path.relative(projectRoot, requiredPath);
      throw new Error(`主扩展打包缺少必需输入：${relativePath}`);
    }
  }
}

export function stageMainPackageFiles(stagePackageRoot, packageJson, readmePath) {
  const stagedPackageJson = JSON.parse(JSON.stringify(packageJson));
  delete stagedPackageJson.scripts;
  stagedPackageJson.dependencies = packageJson.dependencies?.['node-pty']
    ? {
        'node-pty': packageJson.dependencies['node-pty']
      }
    : {};

  writeFileSync(
    path.join(stagePackageRoot, 'package.json'),
    `${JSON.stringify(stagedPackageJson, null, 2)}\n`,
    'utf8'
  );

  copyFileSync(path.join(mainExtensionRoot, readmePath), path.join(stagePackageRoot, readmePath));
  copyFileSync(path.join(mainExtensionRoot, 'CHANGELOG.md'), path.join(stagePackageRoot, 'CHANGELOG.md'));
  copyFileSync(path.join(mainExtensionRoot, 'LICENSE'), path.join(stagePackageRoot, 'LICENSE'));
  copyFileSync(
    path.join(mainExtensionRoot, 'package.nls.json'),
    path.join(stagePackageRoot, 'package.nls.json')
  );
  copyFileSync(
    path.join(mainExtensionRoot, '.vscodeignore'),
    path.join(stagePackageRoot, '.vscodeignore')
  );
  cpSync(path.join(mainExtensionRoot, 'dist'), path.join(stagePackageRoot, 'dist'), { recursive: true });
  cpSync(path.join(mainExtensionRoot, 'images'), path.join(stagePackageRoot, 'images'), { recursive: true });
  cpSync(path.join(mainExtensionRoot, 'resources'), path.join(stagePackageRoot, 'resources'), { recursive: true });
  cpSync(
    path.join(mainExtensionRoot, 'scripts', 'runtime'),
    path.join(stagePackageRoot, 'scripts', 'runtime'),
    { recursive: true }
  );
  stageNodePtyRuntime(stagePackageRoot);
}

function stageNodePtyRuntime(stagePackageRoot) {
  const sourceRoot = path.join(projectRoot, 'node_modules', 'node-pty');
  const targetRoot = path.join(stagePackageRoot, 'node_modules', 'node-pty');
  const entries = [
    'package.json',
    'LICENSE',
    'lib',
    path.join('prebuilds', 'linux-x64', 'pty.node'),
    path.join('prebuilds', 'linux-arm64', 'pty.node'),
    path.join('prebuilds', 'darwin-x64', 'pty.node'),
    path.join('prebuilds', 'darwin-x64', 'spawn-helper'),
    path.join('prebuilds', 'darwin-arm64', 'pty.node'),
    path.join('prebuilds', 'darwin-arm64', 'spawn-helper'),
    path.join('prebuilds', 'win32-x64', 'conpty.node'),
    path.join('prebuilds', 'win32-x64', 'conpty_console_list.node'),
    path.join('prebuilds', 'win32-x64', 'conpty', 'conpty.dll'),
    path.join('prebuilds', 'win32-x64', 'conpty', 'OpenConsole.exe'),
    path.join('prebuilds', 'win32-arm64', 'conpty.node'),
    path.join('prebuilds', 'win32-arm64', 'conpty_console_list.node'),
    path.join('prebuilds', 'win32-arm64', 'conpty', 'conpty.dll'),
    path.join('prebuilds', 'win32-arm64', 'conpty', 'OpenConsole.exe'),
    // Present only so vsce's npm dependency scan sees node-pty as installed.
    // .vscodeignore keeps this build-time dependency out of the final VSIX.
    path.join('node_modules', 'node-addon-api')
  ];

  for (const entry of entries) {
    const sourcePath = path.join(sourceRoot, entry);
    if (!existsSync(sourcePath)) {
      continue;
    }
    const targetPath = path.join(targetRoot, entry);
    mkdirSync(path.dirname(targetPath), { recursive: true });
    cpSync(sourcePath, targetPath, { recursive: true });
  }
}

function resolveVsceBaseUrls(homepage, branch, packageRepoRelativePath = '') {
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

export function resolveVsceEntry(rootDir) {
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
