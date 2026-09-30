import esbuild from 'esbuild';
import { promises as fs } from 'fs';
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';
import { parseArgs } from 'node:util';
import { importCandidateAssets, readCandidateAssets } from './linux-execution-candidate-assets.mjs';

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
    'execution-profile': { type: 'string' }, 'execution-assets': { type: 'string' }
  } });
  const profile = values['execution-profile'];
  const source = values['execution-assets'];
  if (profile === undefined && source === undefined) return {};
  if (profile !== 'linux-owner-v1-candidate' || !source) {
    throw new Error('Specify --execution-profile=linux-owner-v1-candidate and --execution-assets together.');
  }
  if (values.watch) throw new Error('Execution candidate watch builds are not supported.');
  const sourceDirectory = await fs.realpath(source);
  const dist = await fs.realpath(distDirectory).catch(error => {
    if (error.code !== 'ENOENT') throw error;
    return path.resolve(distDirectory);
  });
  const relative = path.relative(dist, sourceDirectory);
  if (relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))) {
    throw new Error('Execution candidate assets must be outside the dist directory cleared by the build.');
  }
  readCandidateAssets(sourceDirectory);
  return Object.freeze({ profile, source: sourceDirectory });
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
    __DEV_SESSION_CANVAS_EXECUTION_PROFILE__: JSON.stringify(selection.profile) ?? 'undefined' };
  await fs.rm(mainExtensionDistRoot, { recursive: true, force: true });

  if (!isWatch) {
    await Promise.all([
      esbuild.build(extensionConfig),
      esbuild.build(supervisorConfig),
      esbuild.build(supervisorLauncherConfig),
      esbuild.build(linuxExecutionProviderConfig),
      esbuild.build(webviewConfig)
    ]);
    if (selection.profile) importCandidateAssets({ source: selection.source, dist: mainExtensionDistRoot });
    return;
  }

  const extensionContext = await esbuild.context(extensionConfig);
  const supervisorContext = await esbuild.context(supervisorConfig);
  const supervisorLauncherContext = await esbuild.context(supervisorLauncherConfig);
  const linuxExecutionProviderContext = await esbuild.context(linuxExecutionProviderConfig);
  const webviewContext = await esbuild.context(webviewConfig);

  await Promise.all([
    extensionContext.watch(),
    supervisorContext.watch(),
    supervisorLauncherContext.watch(),
    linuxExecutionProviderContext.watch(),
    webviewContext.watch()
  ]);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  runBuild().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
