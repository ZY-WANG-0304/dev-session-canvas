import esbuild from 'esbuild';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const isProduction = process.argv.includes('--production');

await fs.rm(path.join(packageRoot, 'dist'), { recursive: true, force: true });

await esbuild.build({
  entryPoints: [path.join(packageRoot, 'src', 'extension.ts')],
  bundle: true,
  external: ['vscode'],
  format: 'cjs',
  platform: 'node',
  target: 'node18',
  outfile: path.join(packageRoot, 'dist', 'extension.js'),
  sourcemap: !isProduction,
  minify: isProduction,
  define: {
    'process.env.NODE_ENV': JSON.stringify(isProduction ? 'production' : 'development')
  }
});
