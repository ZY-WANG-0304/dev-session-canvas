import esbuild from 'esbuild';

const isWatch = process.argv.includes('--watch');

const extensionConfig = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  external: ['vscode'],
  format: 'cjs',
  outfile: 'dist/extension.js',
  platform: 'node',
  sourcemap: true,
  target: 'node18'
};

const webviewConfig = {
  entryPoints: ['src/webview/main.ts'],
  bundle: true,
  format: 'iife',
  outfile: 'dist/webview.js',
  platform: 'browser',
  sourcemap: true,
  target: 'es2020'
};

async function runBuild() {
  if (!isWatch) {
    await Promise.all([esbuild.build(extensionConfig), esbuild.build(webviewConfig)]);
    return;
  }

  const extensionContext = await esbuild.context(extensionConfig);
  const webviewContext = await esbuild.context(webviewConfig);

  await Promise.all([extensionContext.watch(), webviewContext.watch()]);
}

runBuild().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
