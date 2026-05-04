import path from 'node:path';
import { cp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const defaultOutputDir = path.join(repoRoot, '.debug', 'vscode-extension-main-only');
const copiedEntries = ['dist', 'images', 'package.nls.json'];

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
  await cp(sourcePath, targetPath, { recursive: true });
}

export async function prepareDebugMainOnlyExtension({
  sourceRoot = repoRoot,
  outputDir = defaultOutputDir
} = {}) {
  const manifestPath = path.join(sourceRoot, 'package.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const debugManifest = { ...manifest };
  delete debugManifest.extensionDependencies;

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
