import path from 'node:path';
import { cp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const mainExtensionRoot = path.join(repoRoot, 'extensions', 'vscode', 'dev-session-canvas');
const defaultOutputDir = path.join(repoRoot, '.debug', 'vscode-extension-main-only');
const copiedEntries = [
  'dist',
  'images',
  'resources',
  'package.nls.json',
  path.join('scripts', 'runtime', 'claude-file-event-hook.cjs')
];

async function pathExists(targetPath) {
  try {
    await stat(targetPath);
    return true;
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

async function copyIfPresent(sourcePath, targetPath) {
  if (!(await pathExists(sourcePath))) {
    return;
  }
  await mkdir(path.dirname(targetPath), { recursive: true });
  await cp(sourcePath, targetPath, { recursive: true });
}

export async function prepareDebugMainOnlyExtension({
  sourceRoot = mainExtensionRoot,
  outputDir = defaultOutputDir
} = {}) {
  const manifestPath = path.join(sourceRoot, 'package.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const debugManifest = { ...manifest };
  delete debugManifest.extensionDependencies;
  delete debugManifest.extensionPack;

  await rm(outputDir, { recursive: true, force: true });
  await mkdir(outputDir, { recursive: true });

  for (const entry of copiedEntries) {
    await copyIfPresent(path.join(sourceRoot, entry), path.join(outputDir, entry));
  }

  await writeFile(path.join(outputDir, 'package.json'), `${JSON.stringify(debugManifest, null, 2)}\n`, 'utf8');
  return outputDir;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const outputDir = await prepareDebugMainOnlyExtension();
  console.log(`Prepared main-only debug extension at ${outputDir}`);
}
