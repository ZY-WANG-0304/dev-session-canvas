import crypto from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import https from 'https';

import JSZip from 'jszip';

const projectRoot = process.cwd();
const mainExtensionRoot = path.join(projectRoot, 'extensions', 'vscode', 'dev-session-canvas');
const notifierRoot = path.join(projectRoot, 'extensions', 'vscode', 'dev-session-canvas-notifier');
const publisher = 'devsessioncanvas';
const targetValues = ['all', 'visual-studio', 'open-vsx'];
const extensionValues = ['all', 'main', 'notifier'];

let options;
try {
  options = parseArgs(process.argv.slice(2));
} catch (error) {
  console.error(error.message);
  console.error('使用 --help 查看可用参数。');
  process.exit(1);
}

if (options.help) {
  printHelp();
  process.exit(0);
}

main().then(
  (status) => process.exit(status),
  (error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
);

async function main() {
  const context = buildReleaseContext(options);
  const mainPackageJson = readJson(path.join(mainExtensionRoot, 'package.json'));
  const notifierPackageJson = readJson(path.join(notifierRoot, 'package.json'));
  const extensions = buildExtensions(mainPackageJson, notifierPackageJson).filter(
    (extension) => options.extension === 'all' || options.extension === extension.id
  );
  const targets = buildTargets(options.target);

  validateReleaseInputs({ context, mainPackageJson, notifierPackageJson, extensions });

  const previousManifest = options.skipPackage ? readExistingManifest(options.manifestDir, context.version) : undefined;
  if (previousManifest) {
    validatePreviousManifest(previousManifest, context);
  }

  const manifest = createBaseManifest({ context, extensions, targets, options });
  if (previousManifest) {
    mergePreviousManifestState(manifest, previousManifest);
  }
  console.log(`Release trigger tag: ${context.triggerTag}`);
  console.log(`Release version: ${context.version}`);
  console.log(`Release ref: ${context.releaseRef}`);

  if (!options.skipPackage) {
    const status = runPackageStep({ context, extensions });
    if (status !== 0) {
      manifest.status = 'package-failed';
      writeManifest(manifest, options.manifestDir, context.version);
      return status;
    }
  } else {
    console.log('复用现有 VSIX，跳过重新打包。');
  }

  const artifacts = await resolveArtifacts({ context, extensions, manifest, previousManifest });
  manifest.artifacts = artifacts;
  manifest.status = options.packageOnly ? 'packaged' : 'packaged-awaiting-publish';
  writeManifest(manifest, options.manifestDir, context.version);

  if (options.packageOnly) {
    console.log('按 --package-only 停止在打包 / manifest 阶段。');
    return 0;
  }

  const publishStatus = await publishMissingMarketplaceTargets({ context, extensions, targets, manifest });
  const verificationOk = await verifyMarketplaceTargets({ context, extensions, targets, manifest });
  if (!verificationOk) {
    manifest.status = publishStatus !== 0 ? 'publish-failed' : 'verification-failed';
    writeManifest(manifest, options.manifestDir, context.version);
    return publishStatus || 1;
  }
  if (publishStatus !== 0) {
    console.log('Marketplace 发布命令曾返回失败，但当前选择的目标已经验证通过，继续收口。');
  }

  if (!options.createFinalTag) {
    console.log('已按参数跳过正式 release tag 创建。');
    if (!manifest.tags.finalTagStatus || manifest.tags.finalTagStatus === 'pending') {
      manifest.tags.finalTagStatus = 'skipped';
    }
  } else {
    const tagStatus = createAndPushFinalTag(context, manifest);
    if (tagStatus !== 0) {
      manifest.status = 'tag-failed';
      writeManifest(manifest, options.manifestDir, context.version);
      return tagStatus;
    }
  }

  if (options.deleteTriggerTag) {
    const deleteStatus = deleteTriggerTag(context, manifest);
    if (deleteStatus !== 0) {
      manifest.status = 'trigger-tag-delete-failed';
      writeManifest(manifest, options.manifestDir, context.version);
      return deleteStatus;
    }
  }

  manifest.status = 'complete';
  manifest.completedAt = new Date().toISOString();
  writeManifest(manifest, options.manifestDir, context.version);
  return 0;
}

function parseArgs(args) {
  const parsed = {
    createFinalTag: true,
    deleteTriggerTag: false,
    dryRun: false,
    extension: 'all',
    help: false,
    manifestDir: 'release-artifacts',
    marketplaceVerifyAttempts: 12,
    marketplaceVerifyIntervalMs: 30000,
    openVsxTimeoutSeconds: 600,
    packageOnly: false,
    skipOriginMainCheck: false,
    skipPackage: false,
    target: 'all',
    triggerTag: process.env.GITHUB_REF_NAME?.startsWith('publish/v') ? process.env.GITHUB_REF_NAME : undefined
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    switch (arg) {
      case '--trigger-tag':
        parsed.triggerTag = readValue(args, ++index, arg);
        break;
      case '--dry-run':
        parsed.dryRun = true;
        break;
      case '--package-only':
        parsed.packageOnly = true;
        break;
      case '--skip-package':
      case '--no-package':
        parsed.skipPackage = true;
        break;
      case '--target':
        parsed.target = readValue(args, ++index, arg, targetValues);
        break;
      case '--extension':
        parsed.extension = readValue(args, ++index, arg, extensionValues);
        break;
      case '--manifest-dir':
        parsed.manifestDir = readValue(args, ++index, arg);
        break;
      case '--open-vsx-timeout':
        parsed.openVsxTimeoutSeconds = readPositiveNumber(readValue(args, ++index, arg), arg);
        break;
      case '--marketplace-verify-attempts':
        parsed.marketplaceVerifyAttempts = readPositiveInteger(readValue(args, ++index, arg), arg);
        break;
      case '--marketplace-verify-interval-ms':
        parsed.marketplaceVerifyIntervalMs = readNonNegativeInteger(readValue(args, ++index, arg), arg);
        break;
      case '--delete-trigger-tag':
        parsed.deleteTriggerTag = true;
        break;
      case '--no-create-final-tag':
        parsed.createFinalTag = false;
        break;
      case '--skip-origin-main-check':
        parsed.skipOriginMainCheck = true;
        break;
      case '--help':
      case '-h':
        parsed.help = true;
        break;
      default:
        throw new Error(`未知参数：${arg}`);
    }
  }

  if (!parsed.triggerTag && !parsed.help) {
    throw new Error('必须传入 --trigger-tag publish/vX.Y.Z，或在 publish/v* tag 触发的 GitHub Actions 中运行。');
  }
  if (parsed.packageOnly && parsed.createFinalTag === true) {
    parsed.createFinalTag = false;
  }
  if (parsed.packageOnly && parsed.deleteTriggerTag) {
    throw new Error('--package-only 不能与 --delete-trigger-tag 同时使用。');
  }
  if (parsed.createFinalTag && (parsed.extension !== 'all' || parsed.target !== 'all')) {
    throw new Error('创建正式 vX.Y.Z tag 前必须验证所有扩展和所有市场；局部补发请传 --no-create-final-tag，补发完成后再用 --skip-package --extension all --target all 收口正式 tag。');
  }
  if (parsed.skipPackage && parsed.dryRun) {
    // Dry-run skip-package can still validate an existing manifest and VSIX if present.
  }

  return parsed;
}

function buildReleaseContext(parsedOptions) {
  const triggerTag = parsedOptions.triggerTag;
  const match = /^publish\/v(\d+\.\d+\.\d+)$/.exec(triggerTag);
  if (!match) {
    throw new Error(`发布触发 tag 必须形如 publish/vX.Y.Z，当前为：${triggerTag}`);
  }

  const version = match[1];
  const finalTag = `v${version}`;
  const releaseRef = resolveGitRevision(`${triggerTag}^{}`);
  if (!releaseRef) {
    throw new Error(`无法解析发布触发 tag：${triggerTag}`);
  }

  return {
    finalTag,
    releaseRef,
    triggerTag,
    version
  };
}

function validateReleaseInputs({ context, mainPackageJson, notifierPackageJson }) {
  if (mainPackageJson.version !== context.version) {
    throw new Error(`主扩展 package.json 版本 ${mainPackageJson.version} 与 ${context.triggerTag} 不一致。`);
  }
  if (notifierPackageJson.version !== context.version) {
    throw new Error(`notifier package.json 版本 ${notifierPackageJson.version} 与 ${context.triggerTag} 不一致。`);
  }
  if (mainPackageJson.version !== notifierPackageJson.version) {
    throw new Error(`主扩展版本 ${mainPackageJson.version} 与 notifier 版本 ${notifierPackageJson.version} 不一致。`);
  }
  assertChangelogHasVersion(
    path.join(mainExtensionRoot, 'CHANGELOG.md'),
    context.version,
    '主扩展 CHANGELOG'
  );
  assertChangelogHasVersion(
    path.join(notifierRoot, 'CHANGELOG.md'),
    context.version,
    'notifier CHANGELOG'
  );

  const head = resolveGitRevision('HEAD');
  if (head !== context.releaseRef) {
    throw new Error(`当前 HEAD ${head} 不等于发布 tag ${context.triggerTag} 指向的 ${context.releaseRef}。请 checkout 该 tag/ref 后重试。`);
  }
  assertWorktreeClean();
  if (!options.skipOriginMainCheck) {
    assertReleaseRefIsOnOriginMain(context.releaseRef);
  }
}

function buildExtensions(mainPackageJson, notifierPackageJson) {
  return [
    {
      id: 'notifier',
      label: 'Dev Session Canvas Notifier',
      fullId: `${publisher}.${notifierPackageJson.name}`,
      packageJson: notifierPackageJson,
      vsixPath: path.join(notifierRoot, `${notifierPackageJson.name}-${notifierPackageJson.version}.vsix`),
      expectedReadmeRef: 'optional'
    },
    {
      id: 'main',
      label: 'Dev Session Canvas',
      fullId: `${publisher}.${mainPackageJson.name}`,
      packageJson: mainPackageJson,
      vsixPath: path.join(projectRoot, `${mainPackageJson.name}-${mainPackageJson.version}.vsix`),
      expectedReadmeRef: 'required'
    }
  ];
}

function buildTargets(target) {
  if (target === 'all') {
    return ['visual-studio', 'open-vsx'];
  }
  return [target];
}

function runPackageStep({ context, extensions }) {
  const args = ['run', 'publish:marketplaces', '--', '--package-only', '--extension', options.extension];
  console.log('\n==> 打包发布 VSIX');
  console.log(formatCommand('npm', args));

  if (options.dryRun) {
    return 0;
  }

  return runCommand('npm', args, {
    env: buildReleaseEnv(context)
  });
}

async function resolveArtifacts({ context, extensions, manifest, previousManifest }) {
  if (options.dryRun && !options.skipPackage) {
    const plannedArtifacts = extensions.map((extension) => ({
      extension: extension.id,
      fullId: extension.fullId,
      name: extension.packageJson.name,
      path: toPosixPath(path.relative(projectRoot, extension.vsixPath)),
      status: 'planned',
      version: context.version,
      packagingDocRef: context.releaseRef,
      readmeDocRef: context.releaseRef
    }));
    for (const artifact of plannedArtifacts) {
      console.log(`planned artifact: ${artifact.path} (${artifact.version}, ref ${artifact.readmeDocRef})`);
    }
    return plannedArtifacts;
  }

  const artifacts = [];
  for (const extension of extensions) {
    const artifact = await inspectVsix(extension, context);
    if (options.skipPackage) {
      validateArtifactAgainstPreviousManifest(artifact, previousManifest, context);
    }
    artifacts.push(artifact);
  }

  return options.skipPackage ? previousManifest.artifacts : artifacts;
}

async function inspectVsix(extension, context) {
  if (!existsSync(extension.vsixPath)) {
    throw new Error(`未找到 VSIX：${path.relative(projectRoot, extension.vsixPath)}`);
  }

  const buffer = readFileSync(extension.vsixPath);
  const zip = await JSZip.loadAsync(buffer);
  const manifestFile = zip.file('extension/package.json');
  if (!manifestFile) {
    throw new Error(`${extension.vsixPath} 缺少 extension/package.json。`);
  }
  const packageJson = JSON.parse(await manifestFile.async('string'));
  if (packageJson.name !== extension.packageJson.name) {
    throw new Error(`${extension.vsixPath} 内 name=${packageJson.name}，期望 ${extension.packageJson.name}。`);
  }
  if (packageJson.publisher !== publisher) {
    throw new Error(`${extension.vsixPath} 内 publisher=${packageJson.publisher}，期望 ${publisher}。`);
  }
  if (packageJson.version !== context.version) {
    throw new Error(`${extension.vsixPath} 内 version=${packageJson.version}，期望 ${context.version}。`);
  }

  const readmeFile = zip.file('extension/readme.md');
  const readme = readmeFile ? await readmeFile.async('string') : '';
  const readmeContainsReleaseRef = readme.includes(context.releaseRef);
  if (extension.expectedReadmeRef === 'required' && !readmeContainsReleaseRef) {
    throw new Error(`${extension.vsixPath} 内 README 未包含 release ref ${context.releaseRef}。`);
  }

  return {
    extension: extension.id,
    fullId: extension.fullId,
    name: packageJson.name,
    path: toPosixPath(path.relative(projectRoot, extension.vsixPath)),
    publisher: packageJson.publisher,
    packagingDocRef: context.releaseRef,
    readmeContainsReleaseRef,
    readmeDocRef: readmeContainsReleaseRef ? context.releaseRef : null,
    sha256: crypto.createHash('sha256').update(buffer).digest('hex'),
    sizeBytes: buffer.length,
    version: packageJson.version
  };
}

async function publishMissingMarketplaceTargets({ context, extensions, targets, manifest }) {
  let firstFailureStatus = 0;
  for (const extension of extensions) {
    for (const target of targets) {
      const key = marketplaceKey(target);
      manifest.marketplaces[key] ??= {};
      const existingStatus = manifest.marketplaces[key][extension.id]?.status;
      if (existingStatus === 'verified') {
        console.log(`${target} ${extension.fullId} ${context.version} 已在 release manifest 中验证完成，跳过发布。`);
        continue;
      }

      const exists = await marketplaceVersionExists(target, extension, context.version);
      if (exists) {
        console.log(`${target} ${extension.fullId} ${context.version} 已存在，跳过发布。`);
        manifest.marketplaces[key][extension.id] = {
          status: 'already-published',
          version: context.version
        };
        continue;
      }

      const args = [
        'run',
        'publish:marketplaces',
        '--',
        '--yes',
        '--skip-package',
        '--extension',
        extension.id,
        '--target',
        target,
        '--open-vsx-timeout',
        String(options.openVsxTimeoutSeconds)
      ];
      console.log(`\n==> 发布 ${extension.label} 到 ${target}`);
      console.log(formatCommand('npm', args));
      manifest.marketplaces[key][extension.id] = {
        status: options.dryRun ? 'planned' : 'publishing',
        version: context.version
      };

      if (options.dryRun) {
        continue;
      }

      const status = runCommand('npm', args, {
        env: buildReleaseEnv(context)
      });
      if (status !== 0) {
        manifest.marketplaces[key][extension.id].status = 'publish-failed';
        if (firstFailureStatus === 0) {
          firstFailureStatus = status;
        }
        console.error(`${target} ${extension.fullId} ${context.version} 发布失败，继续尝试其他 marketplace 目标。`);
        continue;
      }
      manifest.marketplaces[key][extension.id].status = 'published-awaiting-verification';
    }
  }
  return firstFailureStatus;
}

async function verifyMarketplaceTargets({ context, extensions, targets, manifest }) {
  if (options.dryRun) {
    console.log('dry-run: 跳过 marketplace 发布后验证。');
    return true;
  }

  for (let attempt = 1; attempt <= options.marketplaceVerifyAttempts; attempt += 1) {
    let allOk = true;
    for (const extension of extensions) {
      for (const target of targets) {
        const ok = await marketplaceVersionExists(target, extension, context.version, { requireFiles: true });
        const key = marketplaceKey(target);
        manifest.marketplaces[key] ??= {};
        const previousEntry = manifest.marketplaces[key][extension.id] || {};
        const previousStatus = previousEntry.status;
        if (previousStatus === 'verified') {
          continue;
        }
        manifest.marketplaces[key][extension.id] = {
          ...previousEntry,
          status: ok ? 'verified' : previousStatus === 'publish-failed' ? 'publish-failed' : 'pending-verification',
          verifiedAt: ok ? new Date().toISOString() : undefined,
          version: context.version
        };
        if (!ok) {
          allOk = false;
        }
      }
    }

    if (allOk) {
      console.log('Marketplace 版本与 metadata 验证完成。');
      return true;
    }

    if (attempt < options.marketplaceVerifyAttempts) {
      console.log(
        `Marketplace 验证尚未全部完成，${options.marketplaceVerifyIntervalMs}ms 后重试 (${attempt}/${options.marketplaceVerifyAttempts})。`
      );
      await sleep(options.marketplaceVerifyIntervalMs);
    }
  }

  return false;
}

async function marketplaceVersionExists(target, extension, version, verifyOptions = {}) {
  const fixtureMode =
    process.env.DEV_SESSION_CANVAS_RELEASE_TEST_MODE === '1'
      ? process.env.DEV_SESSION_CANVAS_RELEASE_MARKETPLACE_QUERY_MODE
      : undefined;
  if (fixtureMode === 'missing') {
    return false;
  }
  if (fixtureMode === 'present') {
    return true;
  }
  if (options.dryRun) {
    return false;
  }
  if (target === 'open-vsx') {
    return openVsxVersionExists(extension, version, verifyOptions);
  }
  return visualStudioVersionExists(extension, version);
}

async function openVsxVersionExists(extension, version, verifyOptions) {
  const url = `https://open-vsx.org/api/${publisher}/${extension.packageJson.name}/${version}`;
  try {
    const data = await requestJson(url, { timeoutMs: 60000 });
    if (data?.version !== version) {
      return false;
    }
    if (!verifyOptions.requireFiles) {
      return true;
    }
    const files = data.files || {};
    return ['download', 'icon', 'license', 'sha256', 'vsixmanifest'].every((key) => files[key]);
  } catch (error) {
    if (error?.statusCode === 404) {
      return false;
    }
    console.error(`Open VSX 查询失败：${error.message}`);
    return false;
  }
}

async function visualStudioVersionExists(extension, version) {
  const url = 'https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery?api-version=7.2-preview.1';
  const payload = {
    filters: [
      {
        criteria: [{ filterType: 7, value: extension.fullId }]
      }
    ],
    flags: 0x1 | 0x2 | 0x40
  };
  try {
    const data = await requestJson(url, {
      body: JSON.stringify(payload),
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json'
      },
      method: 'POST',
      timeoutMs: 60000
    });
    const versions = data?.results?.[0]?.extensions?.[0]?.versions || [];
    return versions.some((entry) => entry.version === version);
  } catch (error) {
    console.error(`Visual Studio Marketplace 查询失败：${error.message}`);
    return false;
  }
}

function createAndPushFinalTag(context, manifest) {
  if (options.dryRun) {
    console.log(`dry-run: 将创建并推送正式 tag ${context.finalTag} -> ${context.releaseRef}`);
    manifest.tags.finalTagStatus = 'planned';
    return 0;
  }

  const localTagRef = resolveGitRevision(`${context.finalTag}^{}`, { optional: true });
  if (localTagRef && localTagRef !== context.releaseRef) {
    console.error(`本地正式 tag ${context.finalTag} 指向 ${localTagRef}，不等于 ${context.releaseRef}。`);
    return 1;
  }

  const remoteTagRef = resolveRemoteTag(context.finalTag);
  if (remoteTagRef && remoteTagRef !== context.releaseRef) {
    console.error(`远端正式 tag ${context.finalTag} 指向 ${remoteTagRef}，不等于 ${context.releaseRef}。`);
    return 1;
  }

  if (!localTagRef) {
    console.log(`创建正式 tag ${context.finalTag} -> ${context.releaseRef}`);
    if (!options.dryRun) {
      const status = runCommand('git', ['tag', context.finalTag, context.releaseRef]);
      if (status !== 0) {
        return status;
      }
    }
  }

  if (!remoteTagRef) {
    console.log(`推送正式 tag ${context.finalTag}`);
    if (!options.dryRun) {
      const status = runCommand('git', ['push', 'origin', context.finalTag]);
      if (status !== 0) {
        return status;
      }
    }
  } else {
    console.log(`远端正式 tag ${context.finalTag} 已存在且指向同一 release ref。`);
  }

  manifest.tags.finalTagStatus = 'pushed';
  return 0;
}

function deleteTriggerTag(context, manifest) {
  if (options.dryRun) {
    console.log(`dry-run: 将删除临时 tag ${context.triggerTag}`);
    manifest.tags.triggerTagStatus = 'planned-delete';
    return 0;
  }

  const finalTagRef = resolveGitRevision(`${context.finalTag}^{}`, { optional: true });
  if (finalTagRef !== context.releaseRef) {
    console.error(`正式 tag ${context.finalTag} 尚未指向 ${context.releaseRef}，拒绝删除 ${context.triggerTag}。`);
    return 1;
  }

  const triggerRef = resolveGitRevision(`${context.triggerTag}^{}`, { optional: true });
  if (triggerRef && triggerRef !== context.releaseRef) {
    console.error(`临时 tag ${context.triggerTag} 指向 ${triggerRef}，不等于 ${context.releaseRef}。`);
    return 1;
  }

  const remoteTriggerRef = resolveRemoteTag(context.triggerTag);
  if (remoteTriggerRef && remoteTriggerRef !== context.releaseRef) {
    console.error(`远端临时 tag ${context.triggerTag} 指向 ${remoteTriggerRef}，不等于 ${context.releaseRef}。`);
    return 1;
  }

  console.log(`删除远端临时 tag ${context.triggerTag}`);
  if (!options.dryRun) {
    const remoteStatus = runCommand('git', ['push', 'origin', `:refs/tags/${context.triggerTag}`]);
    if (remoteStatus !== 0) {
      return remoteStatus;
    }
  }

  if (triggerRef) {
    console.log(`删除本地临时 tag ${context.triggerTag}`);
    if (!options.dryRun) {
      const localStatus = runCommand('git', ['tag', '-d', context.triggerTag]);
      if (localStatus !== 0) {
        return localStatus;
      }
    }
  }

  manifest.tags.triggerTagStatus = 'deleted';
  return 0;
}

function createBaseManifest({ context, extensions, targets }) {
  return {
    artifacts: [],
    completedAt: undefined,
    finalTag: context.finalTag,
    generatedAt: new Date().toISOString(),
    marketplaces: {},
    options: {
      deleteTriggerTag: options.deleteTriggerTag,
      dryRun: options.dryRun,
      extension: options.extension,
      packageOnly: options.packageOnly,
      skipPackage: options.skipPackage,
      target: options.target
    },
    releaseRef: context.releaseRef,
    schemaVersion: 1,
    selectedExtensions: extensions.map((extension) => extension.id),
    selectedTargets: targets,
    status: 'initialized',
    tags: {
      finalTag: context.finalTag,
      finalTagStatus: 'pending',
      triggerTag: context.triggerTag,
      triggerTagStatus: options.deleteTriggerTag ? 'pending-delete' : 'kept'
    },
    triggerTag: context.triggerTag,
    version: context.version
  };
}

function writeManifest(manifest, manifestDir, version) {
  const absoluteDir = path.resolve(projectRoot, manifestDir);
  mkdirSync(absoluteDir, { recursive: true });
  const manifestPath = path.join(absoluteDir, `release-manifest-${version}.json`);
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  console.log(`Release manifest: ${path.relative(projectRoot, manifestPath)}`);
}

function readExistingManifest(manifestDir, version) {
  const manifestPath = path.resolve(projectRoot, manifestDir, `release-manifest-${version}.json`);
  if (!existsSync(manifestPath)) {
    throw new Error(`--skip-package 需要已有 release manifest：${path.relative(projectRoot, manifestPath)}`);
  }
  return JSON.parse(readFileSync(manifestPath, 'utf8'));
}

function validatePreviousManifest(manifest, context) {
  if (manifest.version !== context.version) {
    throw new Error(`已有 release manifest 版本 ${manifest.version} 与 ${context.version} 不一致。`);
  }
  if (manifest.releaseRef !== context.releaseRef) {
    throw new Error(`已有 release manifest releaseRef ${manifest.releaseRef} 与 ${context.releaseRef} 不一致。`);
  }
}

function mergePreviousManifestState(manifest, previousManifest) {
  if (previousManifest.marketplaces) {
    manifest.marketplaces = JSON.parse(JSON.stringify(previousManifest.marketplaces));
  }
  if (previousManifest.githubRelease) {
    manifest.githubRelease = JSON.parse(JSON.stringify(previousManifest.githubRelease));
  }
  if (previousManifest.tags) {
    manifest.tags = {
      ...manifest.tags,
      ...JSON.parse(JSON.stringify(previousManifest.tags))
    };
  }
  if (previousManifest.openVsxManualRecovery) {
    manifest.openVsxManualRecovery = JSON.parse(JSON.stringify(previousManifest.openVsxManualRecovery));
  }
}

function validateArtifactAgainstPreviousManifest(artifact, previousManifest, context) {
  const previousArtifact = previousManifest.artifacts?.find((entry) => entry.extension === artifact.extension);
  if (!previousArtifact) {
    throw new Error(`已有 release manifest 缺少 ${artifact.extension} artifact 记录。`);
  }
  if (previousArtifact.sha256 !== artifact.sha256) {
    throw new Error(`${artifact.extension} VSIX sha256 与已有 release manifest 不一致。`);
  }
  if (previousArtifact.version !== context.version) {
    throw new Error(`${artifact.extension} VSIX 版本与已有 release manifest 不一致。`);
  }
}

function assertChangelogHasVersion(changelogPath, version, label) {
  const content = readFileSync(changelogPath, 'utf8');
  const pattern = new RegExp(`^##\\s+${escapeRegExp(version)}(?:\\s|$)`, 'm');
  if (!pattern.test(content)) {
    throw new Error(`${label} 未找到版本标题 ${version}。`);
  }
}

function assertWorktreeClean() {
  const status = spawnSync('git', ['status', '--porcelain'], {
    cwd: projectRoot,
    encoding: 'utf8'
  });
  if (status.status !== 0) {
    throw new Error('无法检查 git working tree 状态。');
  }
  if (status.stdout.trim() !== '') {
    throw new Error('发布前 working tree 必须干净。');
  }
}

function assertReleaseRefIsOnOriginMain(releaseRef) {
  const fetchStatus = runCommand('git', ['fetch', 'origin', 'main:refs/remotes/origin/main', '--tags'], { quiet: true });
  if (fetchStatus !== 0) {
    throw new Error('无法 fetch origin/main，不能确认 release ref 是否位于主线历史。');
  }
  const result = spawnSync('git', ['merge-base', '--is-ancestor', releaseRef, 'origin/main'], {
    cwd: projectRoot
  });
  if (result.status !== 0) {
    throw new Error(`release ref ${releaseRef} 不是 origin/main 的祖先，拒绝发布。`);
  }
}

function resolveGitRevision(revision, resolveOptions = {}) {
  const result = spawnSync('git', ['rev-parse', revision], {
    cwd: projectRoot,
    encoding: 'utf8'
  });
  if (result.status !== 0) {
    if (resolveOptions.optional) {
      return undefined;
    }
    return undefined;
  }
  return result.stdout.trim();
}

function resolveRemoteTag(tagName) {
  const result = spawnSync('git', ['ls-remote', '--tags', 'origin', `refs/tags/${tagName}`], {
    cwd: projectRoot,
    encoding: 'utf8'
  });
  if (result.status !== 0) {
    return undefined;
  }
  const line = result.stdout.trim().split(/\r?\n/u).filter(Boolean)[0];
  return line ? line.split(/\s+/u)[0] : undefined;
}

function runCommand(file, args, commandOptions = {}) {
  if (!commandOptions.quiet) {
    console.log(formatCommand(file, args));
  }
  const result = spawnSync(file, args, {
    cwd: projectRoot,
    env: commandOptions.env || process.env,
    stdio: commandOptions.quiet ? 'pipe' : 'inherit'
  });
  if (result.error) {
    if (!commandOptions.quiet) {
      console.error(result.error.message);
    }
    return 1;
  }
  return result.status === null ? 1 : result.status;
}

function buildReleaseEnv(context) {
  return {
    ...process.env,
    DEV_SESSION_CANVAS_EXPECTED_RELEASE_REF: context.releaseRef,
    DEV_SESSION_CANVAS_VSCE_DOC_BRANCH: context.releaseRef
  };
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function readValue(args, index, optionName, allowedValues) {
  const value = args[index];
  if (!value || value.startsWith('--')) {
    throw new Error(`${optionName} 需要一个参数。`);
  }
  if (allowedValues && !allowedValues.includes(value)) {
    throw new Error(`${optionName} 只接受：${allowedValues.join(', ')}。`);
  }
  return value;
}

function readPositiveNumber(value, optionName) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${optionName} 必须是正数。`);
  }
  return parsed;
}

function readPositiveInteger(value, optionName) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${optionName} 必须是正整数。`);
  }
  return parsed;
}

function readNonNegativeInteger(value, optionName) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${optionName} 必须是非负整数。`);
  }
  return parsed;
}

function formatCommand(command, args) {
  return [command, ...args].map(shellQuote).join(' ');
}

function shellQuote(value) {
  const text = `${value}`;
  if (/^[A-Za-z0-9_./:=@+-]+$/.test(text)) {
    return text;
  }
  return `'${text.replace(/'/g, `'\\''`)}'`;
}

function marketplaceKey(target) {
  return target === 'visual-studio' ? 'visualStudio' : 'openVsx';
}

function toPosixPath(filePath) {
  return filePath.split(path.sep).join('/');
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function requestJson(url, requestOptions = {}) {
  const method = requestOptions.method || 'GET';
  const body = requestOptions.body ? Buffer.from(requestOptions.body) : undefined;
  const headers = {
    'User-Agent': 'dev-session-canvas-release-helper',
    ...(requestOptions.headers || {})
  };
  return new Promise((resolve, reject) => {
    const request = https.request(url, { headers, method, timeout: requestOptions.timeoutMs || 60000 }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        if (response.statusCode < 200 || response.statusCode >= 300) {
          const error = new Error(text || `HTTP ${response.statusCode}`);
          error.statusCode = response.statusCode;
          reject(error);
          return;
        }
        try {
          resolve(JSON.parse(text));
        } catch (error) {
          reject(new Error(`无法解析 JSON 响应：${error.message}`));
        }
      });
    });
    request.on('timeout', () => request.destroy(new Error('request timeout')));
    request.on('error', reject);
    if (body) {
      request.write(body);
    }
    request.end();
  });
}

function printHelp() {
  console.log(`Usage:
  node scripts/release/publish-tag-release.mjs --trigger-tag publish/vX.Y.Z [options]

说明:
  从临时发布 tag publish/vX.Y.Z 解析 release ref 和版本，打包同一组 VSIX，生成 release manifest，
  发布并验证后创建正式 vX.Y.Z tag。release manifest 只写入本地 release-artifacts/，不提交到仓库。

Options:
  --trigger-tag publish/vX.Y.Z       发布触发 tag；GitHub Actions publish/v* tag 触发时可省略
  --dry-run                          只打印计划，不执行打包、发布、tag 变更或 marketplace 验证
  --package-only                     只打包并生成 manifest，不发布、不创建正式 tag
  --skip-package, --no-package       复用已有 VSIX；要求已有 release manifest 与 VSIX sha256 匹配
  --target all|visual-studio|open-vsx
                                    选择发布目标，默认 all
  --extension all|main|notifier      选择发布扩展，默认 all
  --manifest-dir <dir>               release manifest 输出目录，默认 release-artifacts
  --open-vsx-timeout <seconds>       Open VSX publish timeout，默认 600
  --marketplace-verify-attempts <n>  发布后验证重试次数，默认 12
  --marketplace-verify-interval-ms <n>
                                    发布后验证间隔，默认 30000
  --no-create-final-tag              发布验证后不创建正式 vX.Y.Z tag
  --delete-trigger-tag               正式 tag 创建后删除远端和本地 publish/vX.Y.Z
  --skip-origin-main-check           跳过 release ref 是 origin/main 祖先的校验；仅用于本地脚本测试
  --help, -h                         显示帮助
`);
}
