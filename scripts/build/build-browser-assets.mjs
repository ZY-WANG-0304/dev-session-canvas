import esbuild from 'esbuild';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { ensureXtermSerializePatch } from '../shared/ensure-xterm-serialize-patch.mjs';
import { fileDigest, writeJSON } from '../gates/receipts.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const mainRoot = path.join(root, 'extensions/vscode/dev-session-canvas');
const require = createRequire(import.meta.url);
export function browserBuildConfig({ output, production = false } = {}) {
  return {
    entryPoints: { webview: path.join(mainRoot, 'src/webview/main.tsx'),
      'sidebar-codicon': path.join(mainRoot, 'src/webview/sidebar-codicon.css') },
    absWorkingDir: root, bundle: true, minify: production, sourcemap: !production,
    define: { 'process.env.NODE_ENV': JSON.stringify(production ? 'production' : 'development') },
    format: 'iife', outdir: output, entryNames: '[name]', platform: 'browser', target: 'es2020',
    plugins: [{ name: 'xterm-browser-main-entry', setup(build) {
      build.onResolve({ filter: /^@xterm\/xterm$/ }, () => ({ path: require.resolve('@xterm/xterm/lib/xterm.js') }));
    } }], loader: { '.ttf': 'file', '.woff': 'file', '.woff2': 'file' }
  };
}
export async function buildBrowserAssets({ output, production = false, marketplace = true } = {}) {
  const destination = path.resolve(output);
  if (destination === path.join(mainRoot, 'dist') || path.relative(root, destination) === '') {
    throw new Error('Independent browser build must not clear the product dist or repository');
  }
  await fs.mkdir(destination, { recursive: true });
  if ((await fs.readdir(destination)).length) throw new Error('Browser output must be a new private directory');
  await ensureXtermSerializePatch();
  await esbuild.build(browserBuildConfig({ output: path.join(destination, 'main'), production }));
  if (marketplace) {
    const { build } = await import('vite');
    await build({ root: path.join(root, 'apps/template-marketplace'),
      configFile: path.join(root, 'apps/template-marketplace/vite.config.ts'),
      // Tailwind otherwise resolves its config relative to the caller's cwd
      // and silently emits no utilities in a root-level build.
      css: { postcss: { plugins: [require('tailwindcss')({
        ...require('../../apps/template-marketplace/tailwind.config.cjs'),
        content: [path.join(root, 'apps/template-marketplace/index.html'),
          path.join(root, 'apps/template-marketplace/src/web/**/*.{ts,tsx}')]
      }), require('autoprefixer')()] } },
      build: { outDir: path.join(destination, 'marketplace'), emptyOutDir: true } });
  }
  const files = [];
  const visit = async dir => {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) await visit(file);
      else files.push({ path: path.relative(destination, file).split(path.sep).join('/'), sha256: await fileDigest(file) });
    }
  };
  await visit(destination);
  const receipt = { schemaVersion: 1, production, files: files.sort((a, b) => a.path.localeCompare(b.path)) };
  await writeJSON(path.join(destination, 'browser-build.json'), receipt);
  return receipt;
}
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const { values } = parseArgs({ options: { output: { type: 'string' }, production: { type: 'boolean' } } });
  if (!values.output) throw new Error('Specify a private --output directory');
  await buildBrowserAssets({ output: values.output, production: values.production });
}
