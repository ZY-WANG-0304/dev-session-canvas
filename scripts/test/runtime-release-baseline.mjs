import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, readdir, symlink } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import esbuild from 'esbuild';

export const runtimeReleaseBaselineCommit = 'da207a9f36fbefb7a318c90d67f6d75b6b77b094';
export const runtimeReleaseBundles = ['runtime-supervisor.js', 'runtime-supervisor-launcher.js', 'linux-execution-provider.js'];
const extensionRelative = 'extensions/vscode/dev-session-canvas';
const execute = promisify(execFile);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

export async function runtimeBundleHashes(extension) {
  return Object.fromEntries(await Promise.all(runtimeReleaseBundles.map(async file => [file, digest(await readFile(path.join(extension, 'dist', file)))])));
}

async function treeDigest(directory) {
  const files = [];
  async function visit(relative) {
    for (const entry of (await readdir(path.join(directory, relative), { withFileTypes: true })).sort((left, right) => left.name.localeCompare(right.name))) {
      const name = path.join(relative, entry.name);
      if (entry.isDirectory()) await visit(name);
      else { assert(entry.isFile(), 'Native baseline input must contain only regular files.'); files.push([name, digest(await readFile(path.join(directory, name)))]); }
    }
  }
  await visit('');
  assert(files.length > 0, 'Missing native baseline inputs.');
  return digest(JSON.stringify(files));
}

export async function buildRuntimeReleaseBaseline({ directory, currentExtension, deadline, signal,
  repository = process.cwd(), commit = runtimeReleaseBaselineCommit }) {
  assert.equal(commit, runtimeReleaseBaselineCommit, 'Upgrade baseline must be the pinned pre-fix commit.');
  const source = path.join(directory, 'baseline-source');
  await mkdir(source);
  const command = async (file, args) => {
    assert(deadline > Date.now(), 'Baseline build exceeded work deadline.');
    return execute(file, args, { cwd: repository, timeout: Math.min(30000, deadline - Date.now()), signal, maxBuffer: 1024 * 1024 });
  };
  const resolved = await command('git', ['rev-parse', '--verify', `${commit}^{commit}`]);
  assert.equal(resolved.stdout.trim(), commit, 'Pinned pre-fix source is unavailable.');
  const archive = path.join(directory, 'baseline-source.tar');
  await command('git', ['archive', '--format=tar', '--output', archive, commit, '--',
    `${extensionRelative}/src`, `${extensionRelative}/package.json`, `${extensionRelative}/tsconfig.json`, 'packages', 'tsconfig.json']);
  const sourceArchiveSha256 = digest(await readFile(archive));
  await command('tar', ['-xf', archive, '-C', source]);
  await symlink(path.resolve('node_modules'), path.join(source, 'node_modules'), 'dir');
  const extension = path.join(source, extensionRelative);
  const entries = ['src/supervisor/runtimeSupervisorMain.ts', 'src/supervisor/runtimeSupervisorLauncher.ts', 'src/panel/linuxExecutionProviderMain.ts'];
  for (const [index, entry] of entries.entries()) {
    signal?.throwIfAborted();
    assert(deadline > Date.now(), 'Baseline build exceeded work deadline.');
    const result = await esbuild.build({ absWorkingDir: source, entryPoints: [path.join(extension, entry)], bundle: true,
      platform: 'node', format: 'cjs', target: 'node18', external: ['node-pty'], metafile: true,
      outfile: path.join(extension, 'dist', runtimeReleaseBundles[index]),
      define: { 'process.env.NODE_ENV': JSON.stringify('production'),
        __DEV_SESSION_CANVAS_EXECUTION_ADMISSION__: JSON.stringify({ executions: null, starting: 1, pending: 2 }) } });
    for (const input of Object.keys(result.metafile.inputs)) {
      const absolute = path.resolve(source, input);
      const local = path.relative(source, absolute);
      const dependency = path.relative(path.resolve('node_modules'), absolute);
      assert(local !== '..' && !local.startsWith(`..${path.sep}`) && !path.isAbsolute(local)
        || dependency !== '..' && !dependency.startsWith(`..${path.sep}`) && !path.isAbsolute(dependency),
      `Baseline build borrowed current product source: ${input}`);
    }
  }
  const native = `native/linux-execution-candidate/linux-${process.arch}-glibc`;
  await cp(path.join(currentExtension, 'dist', native), path.join(extension, 'dist', native), { recursive: true });
  const nativeSha256 = await treeDigest(path.join(extension, 'dist', native));
  assert.equal(nativeSha256, await treeDigest(path.join(currentExtension, 'dist', native)));
  const bundles = await runtimeBundleHashes(extension);
  const currentBundles = await runtimeBundleHashes(currentExtension);
  assert.notEqual(bundles['runtime-supervisor.js'], currentBundles['runtime-supervisor.js'], 'Baseline must not be the current Supervisor binary.');
  signal?.throwIfAborted();
  assert(deadline > Date.now(), 'Baseline build exceeded work deadline.');
  return { extension, evidence: { kind: 'pinned-pre-fix-source', commit, sourceArchiveSha256,
    toolchain: { node: process.versions.node, esbuild: esbuild.version, lockfileSha256: digest(await readFile('package-lock.json')) },
    native: { origin: 'same-run-current-assets', sha256: nativeSha256 }, bundles, currentBundles } };
}
