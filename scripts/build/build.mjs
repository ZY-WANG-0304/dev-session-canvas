import esbuild from 'esbuild';
import { promises as fs } from 'fs';
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';
import { parseArgs } from 'node:util';
import { importCandidateAssets as importLinuxCandidateAssets,
  readCandidateAssets as readLinuxCandidateAssets } from './linux-execution-candidate-assets.mjs';
import { importCandidateAssets as importMacosCandidateAssets,
  readCandidateAssets as readMacosCandidateAssets } from './macos-execution-candidate-assets.mjs';
import { importCandidateAssets as importWindowsCandidateAssets,
  readCandidateAssets as readWindowsCandidateAssets } from './windows-execution-candidate-assets.mjs';
import { importExecutionCandidateAssetSet, readExecutionCandidateAssetSet } from './execution-candidate-assets-set.mjs';

const require = createRequire(import.meta.url);
const xtermBrowserMainEntryPath = require.resolve('@xterm/xterm/lib/xterm.js');
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const mainExtensionRoot = path.join(projectRoot, 'extensions', 'vscode', 'dev-session-canvas');
const mainExtensionDistRoot = path.join(mainExtensionRoot, 'dist');

function fromMainExtensionRoot(relativePath) {
  return path.join(mainExtensionRoot, relativePath);
}

function fromMainExtensionDist(relativePath) {
  return path.join(mainExtensionDistRoot, relativePath);
}

const isWatch = process.argv.includes('--watch');
const isProduction = process.argv.includes('--production');

export async function resolveExecutionBuildSelection(args, distDirectory = mainExtensionDistRoot) {
  const { values } = parseArgs({ args, options: {
    watch: { type: 'boolean' }, production: { type: 'boolean' },
    'execution-profile': { type: 'string' }, 'execution-assets': { type: 'string' },
    'execution-assets-set': { type: 'string' },
    'execution-admission': { type: 'string' }
  } });
  const assetSet = values['execution-assets-set'];
  if (assetSet !== undefined && (values['execution-profile'] !== undefined || values['execution-assets'] !== undefined)) {
    throw new Error('--execution-assets-set is mutually exclusive with --execution-profile and --execution-assets.');
  }
  const profile = assetSet !== undefined ? 'platform' : values['execution-profile'];
  const source = assetSet ?? values['execution-assets'];
  const admission = values['execution-admission'];
  if (profile === undefined && source === undefined && admission === undefined) return {};
  if ((!['linux-owner-v1-candidate', 'macos-owner-v1-candidate', 'windows-owner-v1-candidate'].includes(profile)
    && assetSet === undefined) || !source) {
    throw new Error('Specify a supported --execution-profile (linux-owner-v1-candidate, macos-owner-v1-candidate or windows-owner-v1-candidate) and --execution-assets together.');
  }
  if (values.watch) throw new Error('Execution candidate watch builds are not supported.');
  const admissionParts = admission === undefined ? [2, 1]
    : /^\d+:\d+$/.test(admission) ? admission.split(':').map(Number) : [];
  const [executions, starting] = admissionParts;
  if (admissionParts.length !== 2 || !Number.isSafeInteger(executions) || executions <= 0
    || !Number.isSafeInteger(starting) || starting <= 0 || starting > executions) {
    throw new Error('Execution admission must be positive safe integers N:Q with Q <= N.');
  }
  const admissionLimits = Object.freeze({ executions, starting });
  const sourceDirectory = await fs.realpath(source);
  const dist = await fs.realpath(distDirectory).catch(error => {
    if (error.code !== 'ENOENT') throw error;
    return path.resolve(distDirectory);
  });
  const assertOutsideDist = directory => {
    const relative = path.relative(dist, directory);
    if (relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))) {
      throw new Error('Execution candidate assets must be outside the dist directory cleared by the build.');
    }
  };
  assertOutsideDist(sourceDirectory);
  if (assetSet !== undefined) {
    for (const asset of readExecutionCandidateAssetSet(source).assets) assertOutsideDist(asset.directory);
  } else (profile === 'windows-owner-v1-candidate' ? readWindowsCandidateAssets
    : profile === 'macos-owner-v1-candidate' ? readMacosCandidateAssets : readLinuxCandidateAssets)(sourceDirectory);
  return Object.freeze({ profile, source: sourceDirectory, admissionLimits });
}

const sharedConfig = {
  minify: isProduction,
  sourcemap: !isProduction,
  define: {
    'process.env.NODE_ENV': JSON.stringify(isProduction ? 'production' : 'development')
  }
};

const extensionConfig = {
  entryPoints: [fromMainExtensionRoot('src/extension.ts')],
  bundle: true,
  ...sharedConfig,
  external: ['vscode', 'node-pty'],
  format: 'cjs',
  outfile: fromMainExtensionDist('extension.js'),
  platform: 'node',
  target: 'node18'
};

const supervisorConfig = {
  entryPoints: [fromMainExtensionRoot('src/supervisor/runtimeSupervisorMain.ts')],
  bundle: true,
  ...sharedConfig,
  external: ['node-pty'],
  format: 'cjs',
  outfile: fromMainExtensionDist('runtime-supervisor.js'),
  platform: 'node',
  target: 'node18'
};

const supervisorLauncherConfig = {
  entryPoints: [fromMainExtensionRoot('src/supervisor/runtimeSupervisorLauncher.ts')],
  bundle: true,
  ...sharedConfig,
  format: 'cjs',
  outfile: fromMainExtensionDist('runtime-supervisor-launcher.js'),
  platform: 'node',
  target: 'node18'
};

const linuxExecutionProviderConfig = {
  entryPoints: [fromMainExtensionRoot('src/panel/linuxExecutionProviderMain.ts')],
  bundle: true,
  ...sharedConfig,
  format: 'cjs',
  outfile: fromMainExtensionDist('linux-execution-provider.js'),
  platform: 'node',
  target: 'node18'
};

const macosExecutionProviderConfig = {
  ...linuxExecutionProviderConfig,
  entryPoints: [fromMainExtensionRoot('src/panel/macosExecutionProviderMain.ts')],
  outfile: fromMainExtensionDist('macos-execution-provider.js')
};

const windowsExecutionProviderConfig = {
  ...linuxExecutionProviderConfig,
  entryPoints: [fromMainExtensionRoot('src/panel/windowsExecutionProviderMain.ts')],
  external: ['node-pty'],
  outfile: fromMainExtensionDist('windows-execution-provider.js')
};

const windowsExecutionOutputWorkerConfig = {
  ...linuxExecutionProviderConfig,
  entryPoints: [fromMainExtensionRoot('src/panel/windowsExecutionOutputWorker.ts')],
  outfile: fromMainExtensionDist('windows-execution-output-worker.js')
};

const webviewConfig = {
  entryPoints: {
    webview: fromMainExtensionRoot('src/webview/main.tsx'),
    'sidebar-codicon': fromMainExtensionRoot('src/webview/sidebar-codicon.css')
  },
  bundle: true,
  ...sharedConfig,
  format: 'iife',
  outdir: mainExtensionDistRoot,
  entryNames: '[name]',
  platform: 'browser',
  target: 'es2020',
  plugins: [
    {
      name: 'xterm-browser-main-entry',
      setup(build) {
        build.onResolve({ filter: /^@xterm\/xterm$/ }, () => ({
          path: xtermBrowserMainEntryPath
        }));
      }
    }
  ],
  loader: {
    '.ttf': 'file',
    '.woff': 'file',
    '.woff2': 'file'
  }
};

async function runBuild() {
  const selection = await resolveExecutionBuildSelection(process.argv.slice(2));
  extensionConfig.define = { ...extensionConfig.define,
    __DEV_SESSION_CANVAS_EXECUTION_PROFILE__: JSON.stringify(selection.profile) ?? 'undefined',
    __DEV_SESSION_CANVAS_EXECUTION_ADMISSION__: JSON.stringify(selection.admissionLimits) ?? 'undefined' };
  supervisorConfig.define = { ...supervisorConfig.define,
    __DEV_SESSION_CANVAS_EXECUTION_ADMISSION__: JSON.stringify(selection.admissionLimits) ?? 'undefined' };
  await fs.rm(mainExtensionDistRoot, { recursive: true, force: true });

  if (!isWatch) {
    await Promise.all([
      esbuild.build(extensionConfig),
      esbuild.build(supervisorConfig),
      esbuild.build(supervisorLauncherConfig),
      esbuild.build(linuxExecutionProviderConfig),
      esbuild.build(macosExecutionProviderConfig),
      esbuild.build(windowsExecutionProviderConfig),
      esbuild.build(windowsExecutionOutputWorkerConfig),
      esbuild.build(webviewConfig)
    ]);
    if (selection.profile) {
      (selection.profile === 'platform' ? importExecutionCandidateAssetSet
        : selection.profile === 'windows-owner-v1-candidate' ? importWindowsCandidateAssets
        : selection.profile === 'macos-owner-v1-candidate' ? importMacosCandidateAssets : importLinuxCandidateAssets)(
        { source: selection.source, dist: mainExtensionDistRoot });
      await fs.writeFile(fromMainExtensionDist('execution-candidate-selection.json'), `${JSON.stringify({
        schemaVersion: 1, profile: selection.profile, admissionLimits: selection.admissionLimits
      }, null, 2)}\n`);
    }
    return;
  }

  const extensionContext = await esbuild.context(extensionConfig);
  const supervisorContext = await esbuild.context(supervisorConfig);
  const supervisorLauncherContext = await esbuild.context(supervisorLauncherConfig);
  const linuxExecutionProviderContext = await esbuild.context(linuxExecutionProviderConfig);
  const macosExecutionProviderContext = await esbuild.context(macosExecutionProviderConfig);
  const windowsExecutionProviderContext = await esbuild.context(windowsExecutionProviderConfig);
  const windowsExecutionOutputWorkerContext = await esbuild.context(windowsExecutionOutputWorkerConfig);
  const webviewContext = await esbuild.context(webviewConfig);

  await Promise.all([
    extensionContext.watch(),
    supervisorContext.watch(),
    supervisorLauncherContext.watch(),
    linuxExecutionProviderContext.watch(),
    macosExecutionProviderContext.watch(),
    windowsExecutionProviderContext.watch(),
    windowsExecutionOutputWorkerContext.watch(),
    webviewContext.watch()
  ]);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  runBuild().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
