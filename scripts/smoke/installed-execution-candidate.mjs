import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import esbuild from 'esbuild';
import JSZip from 'jszip';
import { validateCandidateManifest as validateLinuxManifest } from '../build/linux-execution-candidate-assets.mjs';
import { validateCandidateManifest as validateMacosManifest } from '../build/macos-execution-candidate-assets.mjs';
import { validateCandidateManifest as validateWindowsManifest } from '../build/windows-execution-candidate-assets.mjs';
import installedReceipts from '../../tests/vscode-smoke/installed-execution-candidate.cjs';
import { buildVSCodeChildEnv, stageSmokeTestSuite } from './vscode-smoke-runner.mjs';

const execFileAsync = promisify(execFile);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const projectRoot = fileURLToPath(new URL('../../', import.meta.url));
const { installedCandidateLayout } = installedReceipts;
export const installedCandidateFiles = (platform = process.platform, arch = process.arch) =>
  installedCandidateLayout(platform, arch).files;

async function prepareRuntimeValidation(output) {
  const panel = './extensions/vscode/dev-session-canvas/src/panel';
  const sources = [];
  const built = await esbuild.build({ stdin: { contents:
    `export { resolveLinuxExecutionProviderAssets } from '${panel}/linuxExecutionOwnerFactory';\n`
    + `export { resolveMacosExecutionProviderAssets } from '${panel}/macosExecutionOwnerFactory';\n`
    + `export { resolveWindowsExecutionProviderAssets } from '${panel}/windowsExecutionOwnerFactory';\n`
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
  installedCandidateLayout(platform, arch);
  assert(!values['capacity-calibration'] && !values['capacity-reconnect'] && !values['capacity-attach-compact']
    && values['capacity-sessions'] === undefined,
    'Installed candidate acceptance cannot be combined with a capacity workload.');
  assert(values.mode === undefined || values.mode === 'live-runtime',
    'Installed candidate acceptance runs both persistence modes or the affected live-runtime mode.');
}

export async function prepareInstalledVsixInput(vsixPath, output,
  { runtimeName = 'electron', platform = process.platform, arch = process.arch } = {}) {
  assert(['electron', 'node'].includes(runtimeName), 'Installed acceptance requires an explicit supported runtime.');
  const layout = installedCandidateLayout(platform, arch);
  const { assetRoot } = layout;
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
  const payload = new Map();
  let manifest, selection;
  for (const relative of layout.files) {
    const contents = await read(relative);
    payload.set(relative, contents);
    payloadHashes[relative] = hash(contents);
    if (relative === `${assetRoot}/manifest.json`) manifest = JSON.parse(contents.toString('utf8'));
    if (relative === 'dist/execution-candidate-selection.json') selection = JSON.parse(contents.toString('utf8'));
  }
  assert.equal(manifest.profile, layout.profile);
  assert.equal(manifest.platform, platform);
  assert.equal(manifest.arch, arch);
  assert([1, 2].includes(manifest.schemaVersion), 'Installed acceptance requires asset schema1 or schema2.');
  if (manifest.schemaVersion === 2) {
    const binary = payload.get(layout.binary);
    if (platform === 'linux') validateLinuxManifest(manifest, binary);
    else if (platform === 'darwin') validateMacosManifest(manifest, binary, payload.get(layout.helper));
    else validateWindowsManifest(manifest, binary, layout.dependencies.map(file => payload.get(file)));
  } else {
    assert(platform === 'linux' && arch === 'x64', 'Historical schema1 acceptance is limited to Linux x64.');
    assert.equal(manifest.runtime.name, runtimeName, `Installed acceptance requires the matching ${runtimeName} asset.`);
  }
  if (manifest.schemaVersion === 1 && runtimeName === 'node') {
    assert.match(manifest.runtime.node ?? '', /^\d+\.\d+\.\d+$/);
    assert.equal(manifest.runtime.version, manifest.runtime.node, 'Node asset version must match its Node version.');
    for (const key of ['modules', 'napi']) assert.match(manifest.runtime[key] ?? '', /^[1-9]\d*$/);
    assert.equal(manifest.libc?.name, 'glibc');
    assert.match(manifest.libc?.version ?? '', /^\d+\.\d+(?:\.\d+)?$/);
  }
  assert.equal(manifest.binary.file, path.posix.basename(layout.binary));
  assert.equal(manifest.binary.sha256, payloadHashes[layout.binary]);
  assert.equal(selection.schemaVersion, 1);
  assert(selection.profile === manifest.profile || (manifest.schemaVersion === 2 && selection.profile === 'platform'),
    'Installed selection must resolve to the verified platform profile.');
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

export function installedCandidateInstallCommand({ vscodeExecutablePath, runtime, input, windowsLauncher }, platform = process.platform) {
  assert(['linux', 'darwin', 'win32'].includes(platform), 'The fixed VSIX installer requires a supported platform.');
  const paths = platform === 'win32' ? path.win32 : path.posix;
  const executableDirectory = paths.dirname(vscodeExecutablePath);
  const env = buildVSCodeChildEnv(runtime.environment);
  const args = [`--user-data-dir=${runtime.userDataDir}`, `--extensions-dir=${runtime.extensionsDir}`,
    '--install-extension', input.vsixPath, '--force', '--do-not-include-pack-dependencies'];
  let file;
  if (platform === 'win32') {
    assert.equal(paths.basename(vscodeExecutablePath).toLowerCase(), 'code.exe');
    assert.equal(typeof windowsLauncher, 'string', 'Read the fixed VS Code bin/code.cmd launcher before installing.');
    const lines = windowsLauncher.split(/\r?\n/).map(line => line.trim());
    assert(lines.some(line => /^@?set (?:ELECTRON_RUN_AS_NODE=1|"ELECTRON_RUN_AS_NODE=1")$/i.test(line)),
      'The Windows launcher must select Electron Node mode.');
    const entries = lines.map(line => /^"%~dp0\.\.\\Code\.exe" "%~dp0\.\.\\((?:[a-f0-9]{10}\\)?resources\\app\\out\\cli\.js)" %\*$/i.exec(line))
      .filter(Boolean);
    assert.equal(entries.length, 1, 'The Windows launcher must name one fixed flat or versioned CLI entry.');
    // Wait for the real CLI process, not a cmd.exe launcher that can return before installation.
    file = vscodeExecutablePath;
    args.unshift(paths.join(executableDirectory, entries[0][1]));
    env.ELECTRON_RUN_AS_NODE = '1';
  } else {
    file = platform === 'darwin'
      ? paths.join(paths.dirname(executableDirectory), 'Resources', 'app', 'bin', 'code')
      : paths.join(executableDirectory, 'bin', 'code');
  }
  return {
    file, args,
    options: { env, shell: false, timeout: 120000, maxBuffer: 4 * 1024 ** 2 }
  };
}

export async function installCandidateVsix(options) {
  assert.equal(hash(await fs.readFile(options.input.vsixPath)), options.input.vsixSha256,
    'The fixed VSIX must still match the inspected bytes before installation.');
  const windowsLauncher = process.platform === 'win32'
    ? await fs.readFile(path.join(path.dirname(options.vscodeExecutablePath), 'bin', 'code.cmd'), 'utf8') : undefined;
  const command = installedCandidateInstallCommand({ ...options, windowsLauncher });
  if (process.platform === 'win32') {
    assert((await fs.lstat(command.args[0])).isFile(), 'The Windows launcher CLI entry must be a regular file.');
  }
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
