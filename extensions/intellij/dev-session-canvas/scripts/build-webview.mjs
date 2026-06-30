import esbuild from 'esbuild';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outdir = path.join(projectRoot, 'build', 'generated', 'webview');

await fs.rm(outdir, { recursive: true, force: true });
await fs.mkdir(outdir, { recursive: true });

await esbuild.build({
  entryPoints: [path.join(projectRoot, 'src', 'main', 'webview', 'main.tsx')],
  outfile: path.join(outdir, 'webview.js'),
  bundle: true,
  format: 'iife',
  globalName: 'DevSessionCanvasIntellijWebview',
  platform: 'browser',
  target: 'es2020',
  sourcemap: false,
  define: {
    'process.env.NODE_ENV': JSON.stringify('development')
  },
  loader: {
    '.ttf': 'file',
    '.woff': 'file',
    '.woff2': 'file'
  }
});
