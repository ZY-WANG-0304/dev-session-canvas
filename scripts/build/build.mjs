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

export const productionExecutionAdmission = Object.freeze({ executions: null, starting: 1, pending: 2 });

export async function resolveExecutionBuildSelection(args, distDirectory = mainExtensionDistRoot, {
  env = process.env, defaultAssetSet = path.join(projectRoot, 'generated', 'execution-assets')
} = {}) {
  const { values } = parseArgs({ args, options: {
    watch: { type: 'boolean' }, production: { type: 'boolean' },
    'execution-profile': { type: 'string' }, 'execution-assets': { type: 'string' },
    'execution-assets-set': { type: 'string' },
    'execution-admission': { type: 'string' }
  } });
  const explicitProfile = values['execution-profile'];
  if (explicitProfile === 'stock') {
    if (values['execution-assets-set'] !== undefined || values['execution-assets'] !== undefined
      || values['execution-admission'] !== undefined) {
      throw new Error('Explicit stock comparison builds cannot select execution assets or admission limits.');
    }
    return {};
  }
  const assetSet = values['execution-assets-set'] ?? (explicitProfile === undefined
    && values['execution-assets'] === undefined ? env.DEV_SESSION_CANVAS_EXECUTION_ASSETS_SET || defaultAssetSet : undefined);
  if (assetSet !== undefined && (values['execution-profile'] !== undefined || values['execution-assets'] !== undefined)) {
    throw new Error('--execution-assets-set is mutually exclusive with --execution-profile and --execution-assets.');
  }
  const profile = assetSet !== undefined ? 'platform' : values['execution-profile'];
  const source = assetSet ?? values['execution-assets'];
  const admission = values['execution-admission'];
  if ((!['linux-owner-v1-candidate', 'macos-owner-v1-candidate', 'windows-owner-v1-candidate'].includes(profile)
    && assetSet === undefined) || !source) {
    throw new Error('Specify a supported --execution-profile (linux-owner-v1-candidate, macos-owner-v1-candidate or windows-owner-v1-candidate) and --execution-assets together.');
  }
  if (values.watch && profile !== 'platform') throw new Error('Single-target execution candidate watch builds are not supported.');
  const admissionParts = admission === undefined ? [2, 1]
    : /^\d+:\d+$/.test(admission) ? admission.split(':').map(Number) : [];
  const [executions, starting] = admissionParts;
  if (admissionParts.length !== 2 || !Number.isSafeInteger(executions) || executions <= 0
    || !Number.isSafeInteger(starting) || starting <= 0 || starting > executions) {
    throw new Error('Execution admission must be positive safe integers N:Q with Q <= N.');
  }
  const admissionLimits = admission === undefined && profile === 'platform'
    ? productionExecutionAdmission : Object.freeze({ executions, starting });
  const sourceDirectory = await fs.realpath(source).catch(error => {
    if (error.code !== 'ENOENT' || profile !== 'platform') throw error;
    throw new Error(`Default platform execution assets are missing at ${source}. Supply --execution-assets-set or DEV_SESSION_CANVAS_EXECUTION_ASSETS_SET; stock comparison requires explicit --execution-profile=stock.`, { cause: error });
  });
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
    await stageExecutionSelection(selection);
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

  const contexts = [extensionContext, supervisorContext, supervisorLauncherContext,
    linuxExecutionProviderContext, macosExecutionProviderContext, windowsExecutionProviderContext,
    windowsExecutionOutputWorkerContext, webviewContext];
  try {
    await Promise.all(contexts.map(context => context.rebuild()));
    await stageExecutionSelection(selection);
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
  } catch (error) {
    await Promise.all(contexts.map(context => context.dispose()));
    throw error;
  }
}

async function stageExecutionSelection(selection) {
  if (!selection.profile) return;
  (selection.profile === 'platform' ? importExecutionCandidateAssetSet
    : selection.profile === 'windows-owner-v1-candidate' ? importWindowsCandidateAssets
    : selection.profile === 'macos-owner-v1-candidate' ? importMacosCandidateAssets : importLinuxCandidateAssets)(
    { source: selection.source, dist: mainExtensionDistRoot });
  await fs.writeFile(fromMainExtensionDist('execution-candidate-selection.json'), `${JSON.stringify({
    schemaVersion: 1, profile: selection.profile, admissionLimits: selection.admissionLimits
  }, null, 2)}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  runBuild().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
