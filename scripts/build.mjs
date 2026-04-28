import esbuild from 'esbuild';
import { promises as fs } from 'fs';

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
  entryPoints: ['src/extension.ts'],
  bundle: true,
  ...sharedConfig,
  external: ['vscode', 'node-pty'],
  format: 'cjs',
  outfile: 'dist/extension.js',
  platform: 'node',
  target: 'node18'
};

const supervisorConfig = {
  entryPoints: ['src/supervisor/runtimeSupervisorMain.ts'],
  bundle: true,
  ...sharedConfig,
  external: ['node-pty'],
  format: 'cjs',
  outfile: 'dist/runtime-supervisor.js',
  platform: 'node',
  target: 'node18'
};

const supervisorLauncherConfig = {
  entryPoints: ['src/supervisor/runtimeSupervisorLauncher.ts'],
  bundle: true,
  ...sharedConfig,
  format: 'cjs',
  outfile: 'dist/runtime-supervisor-launcher.js',
  platform: 'node',
  target: 'node18'
};

const webviewConfig = {
  entryPoints: {
    webview: 'src/webview/main.tsx',
    'sidebar-codicon': 'src/webview/sidebar-codicon.css'
  },
  bundle: true,
  ...sharedConfig,
  format: 'iife',
  outdir: 'dist',
  entryNames: '[name]',
  platform: 'browser',
  target: 'es2020',
  loader: {
    '.ttf': 'file'
  }
};

async function runBuild() {
  await fs.rm('dist', { recursive: true, force: true });

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
