import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';

const projectRoot = process.cwd();
const notifierRoot = path.join(projectRoot, 'extensions', 'vscode', 'dev-session-canvas-notifier');
const isWindows = process.platform === 'win32';

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

process.exit(main());

function main() {
  const mainPackageJson = readJson(path.join(projectRoot, 'package.json'));
  const notifierPackageJson = readJson(path.join(notifierRoot, 'package.json'));

  if (mainPackageJson.version !== notifierPackageJson.version) {
    console.error(
      `主扩展版本 ${mainPackageJson.version} 与 notifier 版本 ${notifierPackageJson.version} 不一致，停止发布。`
    );
    return 1;
  }

  if (!options.dryRun && !options.yes && !options.packageOnly) {
    console.error('发布到公开插件市场前必须显式传入 --yes；如只想预览命令，请使用 --dry-run。');
    return 1;
  }

  const extensions = [
    {
      id: 'main',
      label: 'Dev Session Canvas',
      packageJson: mainPackageJson,
      packageCommand: ['npm', ['run', 'package:vsix']],
      vsixPath: path.join(projectRoot, `${mainPackageJson.name}-${mainPackageJson.version}.vsix`)
    },
    {
      id: 'notifier',
      label: 'Dev Session Canvas Notifier',
      packageJson: notifierPackageJson,
      packageCommand: [
        'npm',
        ['run', '-w', 'extensions/vscode/dev-session-canvas-notifier', 'package:vsix']
      ],
      vsixPath: path.join(notifierRoot, `${notifierPackageJson.name}-${notifierPackageJson.version}.vsix`)
    }
  ].filter((extension) => options.extension === 'all' || options.extension === extension.id);

  if (extensions.length === 0) {
    console.error(`未知扩展选择：${options.extension}`);
    return 1;
  }

  const steps = [];

  if (!options.skipPackage) {
    for (const extension of extensions) {
      steps.push({
        label: `打包 ${extension.label}`,
        command: extension.packageCommand[0],
        args: extension.packageCommand[1],
        cwd: projectRoot
      });
    }
  }

  if (options.packageOnly) {
    return runStepsAndValidate(steps, extensions);
  }

  const publishOrder = [...extensions].sort((a, b) => extensionPublishRank(a) - extensionPublishRank(b));
  const vsceEntry = resolveVsceEntry(projectRoot);
  if (wantsTarget('visual-studio') && !vsceEntry) {
    console.error('未找到 @vscode/vsce。本地发布到 Visual Studio Marketplace 前请先运行 npm install。');
    return 1;
  }

  for (const extension of publishOrder) {
    if (wantsTarget('visual-studio')) {
      const vsceCommand = resolveVscePublishCommand(vsceEntry, extension.vsixPath);
      steps.push({
        label: `发布 ${extension.label} 到 Visual Studio Marketplace`,
        ...vsceCommand,
        cwd: projectRoot
      });
    }

    if (wantsTarget('open-vsx')) {
      steps.push({
        label: `发布 ${extension.label} 到 Open VSX`,
        ...resolveOpenVsxPublishCommand(extension.vsixPath),
        cwd: projectRoot
      });
    }
  }

  return runStepsAndValidate(steps, extensions);
}

function runStepsAndValidate(steps, extensions) {
  for (const extension of extensions) {
    if (options.skipPackage && !options.dryRun && !existsSync(extension.vsixPath)) {
      console.error(`未找到 VSIX：${path.relative(projectRoot, extension.vsixPath)}`);
      return 1;
    }
  }

  let failed = false;

  for (const step of steps) {
    const status = runStep(step);
    if (status !== 0) {
      failed = true;
      if (!options.continueOnError) {
        return status;
      }
    }
  }

  if (!options.skipPackage) {
    for (const extension of extensions) {
      if (!options.dryRun && !existsSync(extension.vsixPath)) {
        console.error(`打包后未找到 VSIX：${path.relative(projectRoot, extension.vsixPath)}`);
        return 1;
      }
    }
  }

  return failed ? 1 : 0;
}

function runStep(step) {
  console.log(`\n==> ${step.label}`);
  console.log(formatCommand(step.command, step.args));

  if (options.dryRun) {
    return 0;
  }

  const result = spawnSync(step.command, step.args, {
    cwd: step.cwd,
    env: step.env ? { ...buildCliToolEnv(), ...step.env } : buildCliToolEnv(),
    stdio: 'inherit',
    windowsVerbatimArguments: step.windowsVerbatimArguments
  });

  if (result.status !== 0) {
    if (result.error) {
      console.error(result.error.message);
      return 1;
    }
    return result.status === null ? 1 : result.status;
  }

  if (result.error && result.status === null) {
    console.error(result.error.message);
    return 1;
  }

  return 0;
}

function wantsTarget(target) {
  return options.target === 'all' || options.target === target;
}

function extensionPublishRank(extension) {
  return extension.id === 'notifier' ? 0 : 1;
}

function resolveVscePublishCommand(vsceEntry, vsixPath) {
  const args = ['publish', '--packagePath', vsixPath];
  return resolveCommand(vsceEntry, args);
}

function resolveOpenVsxPublishCommand(vsixPath) {
  if (options.openVsxClient === 'api') {
    const args = ['scripts/release/openvsx-api.py'];
    if (options.openVsxPreferIpv4) {
      args.push('--prefer-ipv4');
    }
    args.push('publish', vsixPath);
    return {
      command: 'python3',
      args
    };
  }

  return {
    command: 'npx',
    args: ['ovsx', 'publish', vsixPath],
    env: {
      OVSX_STORE: process.env.OVSX_STORE || 'file'
    }
  };
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

function resolveCommand(vsceEntry, args) {
  if (vsceEntry.kind === 'node-script') {
    return {
      command: process.execPath,
      args: [vsceEntry.path, ...args]
    };
  }

  if (isWindows) {
    return {
      command: process.env.ComSpec || process.env.COMSPEC || 'cmd.exe',
      args: [buildWindowsBatchShellArgs(vsceEntry.path, args)],
      windowsVerbatimArguments: true
    };
  }

  return {
    command: vsceEntry.path,
    args
  };
}

function buildWindowsBatchShellArgs(command, args) {
  const shellCommand = [escapeWindowsCmdCommand(command), ...args.map(escapeWindowsCmdArgument)].join(
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

function parseArgs(args) {
  const parsed = {
    continueOnError: false,
    dryRun: false,
    extension: 'all',
    help: false,
    openVsxClient: 'api',
    openVsxPreferIpv4: true,
    packageOnly: false,
    skipPackage: false,
    target: 'all',
    yes: false
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    switch (arg) {
      case '--continue-on-error':
        parsed.continueOnError = true;
        break;
      case '--dry-run':
        parsed.dryRun = true;
        break;
      case '--extension':
        parsed.extension = readValue(args, ++index, arg, ['all', 'main', 'notifier']);
        break;
      case '--help':
      case '-h':
        parsed.help = true;
        break;
      case '--open-vsx-client':
        parsed.openVsxClient = readValue(args, ++index, arg, ['api', 'ovsx']);
        break;
      case '--open-vsx-no-prefer-ipv4':
        parsed.openVsxPreferIpv4 = false;
        break;
      case '--package-only':
        parsed.packageOnly = true;
        break;
      case '--skip-package':
      case '--no-package':
        parsed.skipPackage = true;
        break;
      case '--target':
        parsed.target = readValue(args, ++index, arg, ['all', 'visual-studio', 'open-vsx']);
        break;
      case '--yes':
      case '-y':
        parsed.yes = true;
        break;
      default:
        throw new Error(`未知参数：${arg}`);
    }
  }

  if (parsed.packageOnly && parsed.skipPackage) {
    throw new Error('--package-only 不能与 --skip-package 同时使用。');
  }

  return parsed;
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

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
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

function printHelp() {
  console.log(`Usage:
  node scripts/release/publish-marketplaces.mjs --yes [options]

默认流程：
  1. 重新打包主扩展和 notifier VSIX
  2. 发布 notifier，再发布主扩展
  3. 每个扩展依次发布到 Visual Studio Marketplace 和 Open VSX

Options:
  --yes, -y                         确认执行真实发布；非 dry-run 必填
  --dry-run                         只打印命令，不执行
  --skip-package, --no-package      复用当前已有 VSIX，不重新打包
  --package-only                    只打包，不发布
  --target all|visual-studio|open-vsx
                                   选择发布目标，默认 all
  --extension all|main|notifier     选择发布扩展，默认 all
  --open-vsx-client api|ovsx        Open VSX 发布客户端，默认 api
  --open-vsx-no-prefer-ipv4         Python API helper 不强制 IPv4 优先
  --continue-on-error               单个发布步骤失败后继续执行后续步骤
  --help, -h                        显示帮助

Examples:
  npm run publish:marketplaces -- --dry-run
  npm run publish:marketplaces -- --yes
  npm run publish:marketplaces -- --yes --skip-package --target open-vsx
`);
}

const WINDOWS_CMD_META_CHARS_REGEXP = /([()\][%!^"`<>&|;, *?])/g;
