import { spawnSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const contractSections = ['发布范围', '用户 release notes', '文档清单', '已知限制', '验证范围'];
const requiredDocumentationPaths = [
  'extensions/vscode/dev-session-canvas/README.marketplace.md',
  'extensions/vscode/dev-session-canvas-notifier/README.marketplace.md',
  'docs/public-preview-release-playbook.md',
  'docs/notifier-preview-release-playbook.md',
  'docs/support.md',
  'docs/design-docs/public-marketplace-release-readiness.md'
];
const releaseNoteInternalPatterns = [
  { label: '发布准备', pattern: /发布准备/i },
  { label: '内部 gate', pattern: /(?:完整|分层)\s*gate/i },
  { label: '候选或最终工件', pattern: /(?:候选|最终)工件/i },
  { label: 'working tree', pattern: /working[- ]tree/i },
  { label: '待执行门禁状态', pattern: /仍需重新执行.*(?:gate|门禁|验证)/i }
];
const postReleaseEvidencePatterns = [
  { label: '最终或候选 release ref', pattern: /(?:最终|候选)\s*(?:release\s*)?ref/i },
  { label: 'GitHub Actions run', pattern: /GitHub Actions run/i },
  { label: 'VSIX SHA', pattern: /\b(?:sha256|sha-256)\b/i },
  { label: '发布后复核', pattern: /发布后复核/i },
  { label: '门禁已通过', pattern: /(?:gate\s*已通过|门禁已通过)/i },
  { label: '最终渠道状态', pattern: /(?:渠道状态|渠道已(?:发布|验证)|Open VSX.*verified)/i }
];
const releaseNoteForbiddenPatterns = [...releaseNoteInternalPatterns, ...postReleaseEvidencePatterns];

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  validateReleasePreflight({ projectRoot: process.cwd(), version: options.version });
  console.log(`发布输入 preflight 通过：v${options.version}`);

  if (options.verify) {
    runFullVerification();
    console.log(`发布完整验证通过：v${options.version}`);
  }
}

function parseArgs(args) {
  const options = {
    help: false,
    verify: false,
    version: undefined
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }
    if (arg === '--verify') {
      options.verify = true;
      continue;
    }
    if (arg === '--version') {
      options.version = args[++index];
      continue;
    }
    throw new Error(`未知参数：${arg}`);
  }

  if (!options.help && !/^\d+\.\d+\.\d+$/.test(options.version || '')) {
    throw new Error('必须传入三段式版本号，例如 --version 0.26.0。');
  }
  return options;
}

function printHelp() {
  console.log(`用法:
  node scripts/release/release-preflight.mjs --version X.Y.Z [--verify]

说明:
  - 默认检查版本、CHANGELOG 和 docs/release-contracts/vX.Y.Z.md 的静态发布输入。
  - --verify 会在静态检查通过后运行 npm test 与 clean-checkout VSIX 验证。
  - 发布准备 PR 和最终 publish/vX.Y.Z tag ref 都必须运行 --verify。`);
}

export function validateReleasePreflight({ projectRoot, version }) {
  if (!/^\d+\.\d+\.\d+$/.test(version || '')) {
    throw new Error(`发布版本必须是三段式 SemVer，当前为：${version}`);
  }

  const rootPackage = readJson(path.join(projectRoot, 'package.json'), '根 package.json');
  const mainPackage = readJson(
    path.join(projectRoot, 'extensions', 'vscode', 'dev-session-canvas', 'package.json'),
    '主扩展 package.json'
  );
  const notifierPackage = readJson(
    path.join(projectRoot, 'extensions', 'vscode', 'dev-session-canvas-notifier', 'package.json'),
    'notifier package.json'
  );
  const lockfile = readJson(path.join(projectRoot, 'package-lock.json'), 'package-lock.json');
  const lockfileRootVersion = lockfile.packages?.['']?.version ?? lockfile.version;

  assertVersion('根 package.json', rootPackage.version, version);
  assertVersion('主扩展 package.json', mainPackage.version, version);
  assertVersion('notifier package.json', notifierPackage.version, version);
  assertVersion('package-lock.json', lockfileRootVersion, version);

  assertUserReleaseNotes(
    path.join(projectRoot, 'extensions', 'vscode', 'dev-session-canvas', 'CHANGELOG.md'),
    version,
    '主扩展 CHANGELOG'
  );
  assertUserReleaseNotes(
    path.join(projectRoot, 'extensions', 'vscode', 'dev-session-canvas-notifier', 'CHANGELOG.md'),
    version,
    'notifier CHANGELOG'
  );
  assertReleaseContract(projectRoot, version);
}

function assertVersion(label, actualVersion, expectedVersion) {
  if (actualVersion !== expectedVersion) {
    throw new Error(`${label} 版本 ${actualVersion || '<缺失>'} 与发布版本 ${expectedVersion} 不一致。`);
  }
}

function assertUserReleaseNotes(filePath, version, label) {
  const contents = readText(filePath, label);
  const section = readVersionSection(contents, version);
  if (!section) {
    throw new Error(`${label} 缺少 ## ${version} 目标版本段。`);
  }
  if (!section.body.trim()) {
    throw new Error(`${label} 的 ${version} 版本段不能为空。`);
  }

  assertNoForbiddenContent(section.body, `${label} 的 ${version} 版本段`, releaseNoteForbiddenPatterns);
}

function assertReleaseContract(projectRoot, version) {
  const contractPath = path.join(projectRoot, 'docs', 'release-contracts', `v${version}.md`);
  if (!existsSync(contractPath)) {
    throw new Error(`缺少发布契约：docs/release-contracts/v${version}.md。请将该版本契约随发布准备 PR 一同提交。`);
  }

  const contents = readText(contractPath, `发布契约 v${version}`);
  const expectedTitle = `# v${version} 发布契约`;
  if (!contents.startsWith(expectedTitle)) {
    throw new Error(`发布契约必须以“${expectedTitle}”开头。`);
  }
  const sections = new Map();
  for (const sectionTitle of contractSections) {
    const section = readNamedSection(contents, sectionTitle);
    if (!section || !section.body.trim()) {
      throw new Error(`发布契约缺少非空的“${sectionTitle}”章节。`);
    }
    sections.set(sectionTitle, section);
  }
  assertDocumentInventory(projectRoot, sections.get('文档清单').body);
  assertNoForbiddenContent(contents, `发布契约 v${version}`, postReleaseEvidencePatterns);
}

function assertDocumentInventory(projectRoot, documentList) {
  for (const documentPath of requiredDocumentationPaths) {
    if (!documentList.includes(`\`${documentPath}\``)) {
      throw new Error(`发布契约的“文档清单”必须列出 \`${documentPath}\`。`);
    }
    if (!existsSync(path.join(projectRoot, documentPath))) {
      throw new Error(`发布契约列出的必需文档不存在：${documentPath}`);
    }
  }
}

function readVersionSection(contents, version) {
  const headingPattern = new RegExp(`^##\\s+${escapeRegExp(version)}(?:\\s|$).*$`, 'm');
  const match = headingPattern.exec(contents);
  if (!match || match.index === undefined) {
    return undefined;
  }

  const bodyStart = match.index + match[0].length;
  const nextHeading = /^##\s+/m;
  nextHeading.lastIndex = bodyStart;
  const remaining = contents.slice(bodyStart);
  const nextMatch = nextHeading.exec(remaining);
  return {
    body: remaining.slice(0, nextMatch?.index)
  };
}

function readNamedSection(contents, title) {
  const headingPattern = new RegExp(`^##\\s+${escapeRegExp(title)}\\s*$`, 'm');
  const match = headingPattern.exec(contents);
  if (!match || match.index === undefined) {
    return undefined;
  }

  const bodyStart = match.index + match[0].length;
  const remaining = contents.slice(bodyStart);
  const nextMatch = /^##\s+/m.exec(remaining);
  return {
    body: remaining.slice(0, nextMatch?.index)
  };
}

function assertNoForbiddenContent(contents, location, patterns) {
  for (const { label, pattern } of patterns) {
    if (pattern.test(contents)) {
      throw new Error(`${location} 包含内部发布状态“${label}”。请将用户 release notes 保持为发布前定稿，并把发布后事实写入 release manifest。`);
    }
  }
}

function readJson(filePath, label) {
  try {
    return JSON.parse(readText(filePath, label));
  } catch (error) {
    throw new Error(`${label} 不是有效 JSON：${error.message}`);
  }
}

function readText(filePath, label) {
  if (!existsSync(filePath)) {
    throw new Error(`${label} 不存在：${filePath}`);
  }
  return readFileSync(filePath, 'utf8');
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function runFullVerification() {
  runNpm(['run', 'test:release-preflight']);
  runNpm(['run', 'test:release-preflight-workflow']);
  runNpm(['run', 'test']);
  runNpm(['run', 'validate:clean-checkout:vsix', '--', '--ref', 'HEAD']);
}

function runNpm(args) {
  const result = spawnSync('npm', args, {
    cwd: process.cwd(),
    stdio: 'inherit'
  });
  if (result.status !== 0) {
    if (result.error) {
      throw result.error;
    }
    throw new Error(`完整发布验证失败：npm ${args.join(' ')}`);
  }
}

const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMainModule) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
