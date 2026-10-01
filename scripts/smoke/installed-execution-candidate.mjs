import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import esbuild from 'esbuild';
import JSZip from 'jszip';
import { validateCandidateManifest } from '../build/linux-execution-candidate-assets.mjs';
import { buildVSCodeChildEnv, stageSmokeTestSuite } from './vscode-smoke-runner.mjs';

const execFileAsync = promisify(execFile);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const assetRoot = 'dist/native/linux-execution-candidate/linux-x64-glibc';
const projectRoot = fileURLToPath(new URL('../../', import.meta.url));
export const installedCandidateFiles = [
  'dist/extension.js', 'dist/runtime-supervisor.js', 'dist/linux-execution-provider.js',
  'dist/webview.js', 'dist/webview.css', 'dist/execution-candidate-selection.json',
  `${assetRoot}/manifest.json`, `${assetRoot}/execution-owner.node`
];

async function prepareRuntimeValidation(output) {
  const panel = './extensions/vscode/dev-session-canvas/src/panel';
  const sources = [];
  const built = await esbuild.build({ stdin: { contents:
    `export { resolveLinuxExecutionProviderAssets } from '${panel}/linuxExecutionOwnerFactory';\n`
    + `export { assertExecutionAssetRuntime, assertMinimumExecutionLibraryVersion } from '${panel}/executionAssetCompatibility';\n`,
    resolveDir: projectRoot, sourcefile: 'installed-runtime-validation-entry.js' },
    absWorkingDir: projectRoot, bundle: true, write: false, platform: 'node', format: 'cjs', target: 'node16',
    banner: { js: 'module.exports = function createRuntimeValidation(process) { const module = { exports: {} };' },
    footer: { js: 'return module.exports; };' },
    plugins: [{ name: 'installed-runtime-validation-sources', setup(build) {
      build.onLoad({ filter: /\.ts$/ }, async args => {
        const contents = await fs.readFile(args.path);
        sources.push({ file: path.relative(projectRoot, args.path).split(path.sep).join('/'), sha256: hash(contents) });
        return { contents: contents.toString('utf8'), loader: 'ts' };
      });
    } }] });
  sources.sort((left, right) => left.file.localeCompare(right.file));
  const file = path.resolve(output, 'installed-runtime-validation.cjs');
  const contents = built.outputFiles[0].contents;
  await fs.writeFile(file, contents, { flag: 'wx' });
  return { file, sha256: hash(contents), sources };
}

export function assertInstalledCandidateSelection(values, platform = process.platform, arch = process.arch) {
  if (values['installed-vsix'] === undefined) return;
  assert(values['installed-vsix'].trim(), 'Specify the fixed candidate VSIX path.');
  assert.equal(platform, 'linux', 'Installed candidate acceptance currently selects Linux only.');
  assert.equal(arch, 'x64', 'Installed candidate acceptance selects the verified linux-x64-glibc asset.');
  assert(!values['capacity-calibration'] && !values['capacity-reconnect'] && values['capacity-sessions'] === undefined,
    'Installed candidate acceptance cannot be combined with a capacity workload.');
  assert.equal(values.mode, undefined, 'Installed candidate acceptance runs both original persistence modes.');
}

export async function prepareInstalledVsixInput(vsixPath, output, { runtimeName = 'electron' } = {}) {
  assert(['electron', 'node'].includes(runtimeName), 'Installed acceptance requires an explicit supported runtime.');
  const sourcePath = await fs.realpath(path.resolve(vsixPath));
  const bytes = await fs.readFile(sourcePath);
  const zip = await JSZip.loadAsync(bytes);
  const read = async relative => {
    const entry = zip.file(`extension/${relative}`);
    assert(entry, `Fixed VSIX is missing ${relative}.`);
    return entry.async('nodebuffer');
  };
  const packageBytes = await read('package.json');
  const packageManifest = JSON.parse(packageBytes.toString('utf8'));
  assert.equal(`${packageManifest.publisher}.${packageManifest.name}`, 'devsessioncanvas.dev-session-canvas');
  assert.equal(typeof packageManifest.version, 'string');
  assert.equal(packageManifest.main, './dist/extension.js', 'Use the unmodified product entry point.');
  const payloadHashes = {};
  let manifest, selection, binary;
  for (const relative of installedCandidateFiles) {
    const contents = await read(relative);
    payloadHashes[relative] = hash(contents);
    if (relative === `${assetRoot}/manifest.json`) manifest = JSON.parse(contents.toString('utf8'));
    if (relative === `${assetRoot}/execution-owner.node`) binary = contents;
    if (relative === 'dist/execution-candidate-selection.json') selection = JSON.parse(contents.toString('utf8'));
  }
  assert.equal(manifest.profile, 'linux-owner-v1-candidate');
  assert.equal(manifest.platform, 'linux');
  assert.equal(manifest.arch, 'x64');
  assert([1, 2].includes(manifest.schemaVersion), 'Installed acceptance requires asset schema1 or schema2.');
  if (manifest.schemaVersion === 2) {
    validateCandidateManifest(manifest, binary);
  } else {
    assert.equal(manifest.runtime.name, runtimeName, `Installed acceptance requires the matching ${runtimeName} asset.`);
  }
  if (manifest.schemaVersion === 1 && runtimeName === 'node') {
    assert.match(manifest.runtime.node ?? '', /^\d+\.\d+\.\d+$/);
    assert.equal(manifest.runtime.version, manifest.runtime.node, 'Node asset version must match its Node version.');
    for (const key of ['modules', 'napi']) assert.match(manifest.runtime[key] ?? '', /^[1-9]\d*$/);
    assert.equal(manifest.libc?.name, 'glibc');
    assert.match(manifest.libc?.version ?? '', /^\d+\.\d+(?:\.\d+)?$/);
  }
  assert.equal(manifest.binary.file, 'execution-owner.node');
  assert.equal(manifest.binary.sha256, payloadHashes[`${assetRoot}/execution-owner.node`]);
  assert.equal(selection.schemaVersion, 1);
  assert(selection.profile === manifest.profile || (manifest.schemaVersion === 2 && selection.profile === 'platform'),
    'Installed selection must resolve to the verified Linux profile.');
  const runtimeValidation = manifest.schemaVersion === 2 ? await prepareRuntimeValidation(output) : undefined;
  // Install the exact bytes inspected here, even if the caller's original package later changes.
  const frozenVsixPath = path.join(output, 'candidate.vsix');
  await fs.writeFile(frozenVsixPath, bytes, { flag: 'wx' });
  const input = { schemaVersion: 1, runtimeName, sourcePath, vsixPath: frozenVsixPath, vsixSha256: hash(bytes),
    packageSha256: hash(packageBytes), packageManifest, payloadHashes, manifest, selection,
    ...(runtimeValidation ? { runtimeValidation } : {}),
    companionScope: 'Recommended extensionPack installation skipped; notifier is not validated.' };
  await fs.writeFile(path.join(output, 'installed-vsix-input.json'), `${JSON.stringify(input, null, 2)}\n`, { flag: 'wx' });
  return input;
}

export async function prepareInstalledCandidateDriver({ projectRoot, targetRoot, input, extensionsDir, artifactsDir }) {
  await fs.mkdir(targetRoot);
  await fs.writeFile(path.join(targetRoot, 'package.json'), `${JSON.stringify({
    name: 'execution-candidate-test-driver', publisher: 'devsessioncanvas-tests', version: '0.0.0',
    engines: { vscode: '^1.80.0' }, main: './driver.cjs', activationEvents: [], extensionKind: ['workspace']
  }, null, 2)}\n`, { flag: 'wx' });
  await fs.writeFile(path.join(targetRoot, 'driver.cjs'), 'exports.activate = function activate() {};\n', { flag: 'wx' });
  await stageSmokeTestSuite({ projectRoot, targetRoot });
  const expectationPath = path.join(artifactsDir, 'installed-vsix-expectation.json');
  const expectation = { ...input, extensionsDir: await fs.realpath(extensionsDir) };
  await fs.writeFile(expectationPath, `${JSON.stringify(expectation, null, 2)}\n`, { flag: 'wx' });
  return { expectation, expectationPath };
}

export function installedCandidateInstallCommand({ vscodeExecutablePath, runtime, input }) {
  assert.equal(process.platform, 'linux', 'The fixed VSIX installer currently selects Linux only.');
  return {
    file: path.join(path.dirname(vscodeExecutablePath), 'bin', 'code'),
    args: [`--user-data-dir=${runtime.userDataDir}`, `--extensions-dir=${runtime.extensionsDir}`,
      '--install-extension', input.vsixPath, '--force', '--do-not-include-pack-dependencies'],
    options: { env: buildVSCodeChildEnv(runtime.environment), shell: false, timeout: 120000, maxBuffer: 4 * 1024 ** 2 }
  };
}

export async function installCandidateVsix(options) {
  assert.equal(hash(await fs.readFile(options.input.vsixPath)), options.input.vsixSha256,
    'The fixed VSIX must still match the inspected bytes before installation.');
  const command = installedCandidateInstallCommand(options);
  const logPath = path.join(options.runtime.artifactsDir, 'installed-vsix-cli.json');
  try {
    const { stdout, stderr } = await execFileAsync(command.file, command.args, command.options);
    await fs.writeFile(logPath, `${JSON.stringify({ file: command.file, args: command.args,
      vsixSha256: options.input.vsixSha256, code: 0, stdout, stderr }, null, 2)}\n`, { flag: 'wx' });
  } catch (error) {
    await fs.writeFile(logPath, `${JSON.stringify({ file: command.file, args: command.args,
      vsixSha256: options.input.vsixSha256, code: error.code, signal: error.signal,
      error: String(error), stdout: error.stdout, stderr: error.stderr }, null, 2)}\n`, { flag: 'wx' });
    throw error;
  }
}
