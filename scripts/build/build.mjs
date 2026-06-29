import esbuild from 'esbuild';
import { promises as fs } from 'fs';
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

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
  await fs.rm(mainExtensionDistRoot, { recursive: true, force: true });

  if (!isWatch) {
    await Promise.all([
      esbuild.build(extensionConfig),
      esbuild.build(supervisorConfig),
      esbuild.build(supervisorLauncherConfig),
      esbuild.build(webviewConfig)
    ]);
    return;
  }

  const extensionContext = await esbuild.context(extensionConfig);
  const supervisorContext = await esbuild.context(supervisorConfig);
  const supervisorLauncherContext = await esbuild.context(supervisorLauncherConfig);
  const webviewContext = await esbuild.context(webviewConfig);

  await Promise.all([
    extensionContext.watch(),
    supervisorContext.watch(),
    supervisorLauncherContext.watch(),
    webviewContext.watch()
  ]);
}

runBuild().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
