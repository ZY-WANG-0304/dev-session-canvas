import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';

const projectRoot = process.cwd();

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

try {
  const notes = buildReleaseNotes(options);
  const outputPath = path.resolve(projectRoot, options.output);
  mkdirSync(path.dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, notes, 'utf8');
  console.log(`GitHub release notes: ${path.relative(projectRoot, outputPath)}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

function parseArgs(args) {
  const parsed = {
    changelog: 'CHANGELOG.md',
    help: false,
    manifest: undefined,
    output: 'release-artifacts/github-release-notes.md',
    version: undefined
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    switch (arg) {
      case '--changelog':
        parsed.changelog = readValue(args, ++index, arg);
        break;
      case '--manifest':
        parsed.manifest = readValue(args, ++index, arg);
        break;
      case '--output':
        parsed.output = readValue(args, ++index, arg);
        break;
      case '--version':
        parsed.version = readValue(args, ++index, arg);
        break;
      case '--help':
      case '-h':
        parsed.help = true;
        break;
      default:
        throw new Error(`未知参数：${arg}`);
    }
  }

  if (!parsed.version && !parsed.help) {
    throw new Error('必须传入 --version X.Y.Z。');
  }

  return parsed;
}

function buildReleaseNotes({ changelog, manifest: manifestPath, version }) {
  const changelogPath = path.resolve(projectRoot, changelog);
  const changelogText = readFileSync(changelogPath, 'utf8');
  const section = extractVersionSection(changelogText, version);
  const title = extractVersionTitle(section, version);
  const highlights = extractSubsection(section, '本版本聚焦') || fallbackHighlights(section);
  const install = extractSubsection(section, '安装与升级');
  const rollback = extractSubsection(section, '回退建议');
  const manifest = readManifest(manifestPath);

  const lines = [
    `# ${title}`,
    '',
    `本 Release 使用 \`publish/v${version}\` 固定发布输入，并把同一批 VSIX 镜像到 GitHub Release Assets。`,
    'Marketplace 正常可用时仍优先通过 Visual Studio Marketplace / Open VSX 安装；若某个市场访问、审核或同步延迟，可使用本 Release 的 VSIX assets 手动安装。',
    '',
    '## 版本亮点',
    '',
    normalizeBlock(highlights),
    '',
    '## 渠道状态',
    '',
    ...formatChannelStatus(manifest),
    '',
    '## 残余风险',
    '',
    ...formatResidualRisks(manifest),
  ];

  if (install) {
    lines.push('', '## 安装与升级', '', normalizeBlock(install));
  }
  if (rollback) {
    lines.push('', '## 回退建议', '', normalizeBlock(rollback));
  }

  lines.push('', '## 发布证据', '', ...formatEvidence(manifest, version), '');
  return `${lines.join('\n').replace(/\n{3,}/g, '\n\n')}\n`;
}

function extractVersionSection(changelogText, version) {
  const headingPattern = new RegExp(`^##\\s+${escapeRegExp(version)}(?:\\s+[-–].*)?$`, 'mu');
  const match = headingPattern.exec(changelogText);
  if (!match) {
    throw new Error(`CHANGELOG 未找到版本 ${version}。`);
  }
  const start = match.index;
  const rest = changelogText.slice(start + match[0].length);
  const next = /^##\s+/mu.exec(rest);
  return `${match[0]}${next ? rest.slice(0, next.index) : rest}`.trim();
}

function extractVersionTitle(section, version) {
  const firstLine = section.split(/\r?\n/u)[0]?.replace(/^##\s+/u, '').trim();
  return firstLine || version;
}

function extractSubsection(section, title) {
  const headingPattern = new RegExp(`^###\\s+${escapeRegExp(title)}\\s*$`, 'mu');
  const match = headingPattern.exec(section);
  if (!match) {
    return '';
  }
  const rest = section.slice(match.index + match[0].length);
  const next = /^###\s+/mu.exec(rest);
  return (next ? rest.slice(0, next.index) : rest).trim();
}

function fallbackHighlights(section) {
  const withoutHeading = section.replace(/^##[^\n]*(?:\n|$)/u, '').trim();
  const nextSubsection = /^###\s+/mu.exec(withoutHeading);
  return (nextSubsection ? withoutHeading.slice(0, nextSubsection.index) : withoutHeading).trim() || '- 见 CHANGELOG。';
}

function readManifest(manifestPath) {
  if (!manifestPath) {
    return undefined;
  }
  const absolutePath = path.resolve(projectRoot, manifestPath);
  if (!existsSync(absolutePath)) {
    return undefined;
  }
  return JSON.parse(readFileSync(absolutePath, 'utf8'));
}

function formatChannelStatus(manifest) {
  if (!manifest) {
    return ['- GitHub Release assets：待上传。', '- Marketplace：待发布 / 待验证。'];
  }

  const lines = [];
  const githubStatus = manifest.githubRelease?.status || 'pending';
  lines.push(`- GitHub Release assets：${githubStatus}`);

  const targets = [
    ['Visual Studio Marketplace', manifest.marketplaces?.visualStudio],
    ['Open VSX', manifest.marketplaces?.openVsx]
  ];
  for (const [label, target] of targets) {
    lines.push(`- ${label}：${formatTargetStatus(target)}`);
  }
  return lines;
}

function formatTargetStatus(target) {
  if (!target || Object.keys(target).length === 0) {
    return 'pending';
  }
  const parts = [];
  for (const [extension, entry] of Object.entries(target)) {
    parts.push(`${extension}=${entry?.status || 'unknown'}${entry?.version ? ` (${entry.version})` : ''}`);
  }
  return parts.join(', ');
}

function formatResidualRisks(manifest) {
  const risks = [
    '- 当前仍是公开 Preview；不承诺跨版本 workspace 状态完全兼容，关键工作区升级前仍建议备份或先在非关键环境验证。',
    '- Marketplace 渠道发布、审核、缓存和公开可见性彼此独立；某一市场失败不应阻塞另一市场，但对外宣称安装路径前仍需以实际 verified 状态为准。',
    '- 同版本重跑必须复用 GitHub Release 中已有的 VSIX / manifest，不应重新打包覆盖，以避免同一版本号对应不同 checksum。'
  ];

  const incompleteTargets = collectIncompleteTargets(manifest);
  if (incompleteTargets.length > 0) {
    risks.push(`- 尚未全部完成的渠道：${incompleteTargets.join('；')}。这些渠道完成前，GitHub Release Assets 只是手动安装兜底，不等于 marketplace 全量发布完成。`);
  }

  if (manifest?.tags?.triggerTagStatus && manifest.tags.triggerTagStatus !== 'deleted') {
    risks.push(`- 临时发布 tag 当前状态为 ${manifest.tags.triggerTagStatus}；如果仍为 kept，表示仍可能需要用同一 release input 重跑未完成渠道。`);
  }

  return risks;
}

function collectIncompleteTargets(manifest) {
  if (!manifest?.marketplaces) {
    return ['Visual Studio Marketplace=pending', 'Open VSX=pending'];
  }
  const targets = [
    ['Visual Studio Marketplace', manifest.marketplaces.visualStudio],
    ['Open VSX', manifest.marketplaces.openVsx]
  ];
  const incomplete = [];
  for (const [label, target] of targets) {
    if (!target || Object.keys(target).length === 0) {
      incomplete.push(`${label}=pending`);
      continue;
    }
    for (const [extension, entry] of Object.entries(target)) {
      if (!['verified', 'already-published'].includes(entry?.status)) {
        incomplete.push(`${label}/${extension}=${entry?.status || 'unknown'}`);
      }
    }
  }
  return incomplete;
}

function formatEvidence(manifest, version) {
  if (!manifest) {
    return [`- Release manifest：\`release-manifest-${version}.json\` 将在 workflow 完成后上传。`];
  }
  const lines = [
    `- Release ref：\`${manifest.releaseRef || 'unknown'}\``,
    `- Trigger tag：\`${manifest.triggerTag || `publish/v${version}`}\``,
    `- Final tag：\`${manifest.finalTag || `v${version}`}\``
  ];
  for (const artifact of manifest.artifacts || []) {
    lines.push(`- ${artifact.extension} VSIX：\`${artifact.path}\`，sha256 \`${artifact.sha256}\``);
  }
  return lines;
}

function normalizeBlock(value) {
  return value.trim().replace(/[ \t]+$/gmu, '');
}

function readValue(args, index, optionName) {
  const value = args[index];
  if (!value || value.startsWith('--')) {
    throw new Error(`${optionName} 需要一个参数。`);
  }
  return value;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function printHelp() {
  console.log(`Usage:
  node scripts/release/write-github-release-notes.mjs --version X.Y.Z [options]

Options:
  --version X.Y.Z        要生成 Release notes 的版本
  --changelog <path>     CHANGELOG 路径，默认 CHANGELOG.md
  --manifest <path>      release manifest 路径；存在时写入渠道状态和证据
  --output <path>        输出 Markdown 路径，默认 release-artifacts/github-release-notes.md
  --help, -h             显示帮助
`);
}
