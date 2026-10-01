import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import JSZip from 'jszip';
import { buildVSCodeChildEnv, stageSmokeTestSuite } from './vscode-smoke-runner.mjs';

const execFileAsync = promisify(execFile);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const assetRoot = 'dist/native/linux-execution-candidate/linux-x64-glibc';
export const installedCandidateFiles = [
  'dist/extension.js', 'dist/runtime-supervisor.js', 'dist/linux-execution-provider.js',
  'dist/webview.js', 'dist/webview.css', 'dist/execution-candidate-selection.json',
  `${assetRoot}/manifest.json`, `${assetRoot}/execution-owner.node`
];

export function assertInstalledCandidateSelection(values, platform = process.platform, arch = process.arch) {
  if (values['installed-vsix'] === undefined) return;
  assert(values['installed-vsix'].trim(), 'Specify the fixed candidate VSIX path.');
  assert.equal(platform, 'linux', 'Installed candidate acceptance currently selects Linux only.');
  assert.equal(arch, 'x64', 'Installed candidate acceptance selects the verified linux-x64-glibc asset.');
  assert(!values['capacity-calibration'] && !values['capacity-reconnect'] && values['capacity-sessions'] === undefined,
    'Installed candidate acceptance cannot be combined with a capacity workload.');
  assert.equal(values.mode, undefined, 'Installed candidate acceptance runs both original persistence modes.');
}

export async function prepareInstalledVsixInput(vsixPath, output) {
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
  let manifest, selection;
  for (const relative of installedCandidateFiles) {
    const contents = await read(relative);
    payloadHashes[relative] = hash(contents);
    if (relative === `${assetRoot}/manifest.json`) manifest = JSON.parse(contents.toString('utf8'));
    if (relative === 'dist/execution-candidate-selection.json') selection = JSON.parse(contents.toString('utf8'));
  }
  assert.equal(manifest.profile, 'linux-owner-v1-candidate');
  assert.equal(manifest.platform, 'linux');
  assert.equal(manifest.arch, 'x64');
  assert.equal(manifest.runtime.name, 'electron', 'Installed acceptance requires the matching Electron asset.');
  assert.equal(manifest.binary.file, 'execution-owner.node');
  assert.equal(manifest.binary.sha256, payloadHashes[`${assetRoot}/execution-owner.node`]);
  assert.equal(selection.schemaVersion, 1);
  assert.equal(selection.profile, manifest.profile);
  // Install the exact bytes inspected here, even if the caller's original package later changes.
  const frozenVsixPath = path.join(output, 'candidate.vsix');
  await fs.writeFile(frozenVsixPath, bytes, { flag: 'wx' });
  const input = { schemaVersion: 1, sourcePath, vsixPath: frozenVsixPath, vsixSha256: hash(bytes),
    packageSha256: hash(packageBytes), packageManifest, payloadHashes, manifest, selection,
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
