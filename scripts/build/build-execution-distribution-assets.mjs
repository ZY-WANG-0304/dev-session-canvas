import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { readCandidateAssets as readLinux } from './linux-execution-candidate-assets.mjs';
import { readCandidateAssets as readMacos } from './macos-execution-candidate-assets.mjs';
import { readCandidateAssets as readWindows } from './windows-execution-candidate-assets.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const currentNode = '25.6.0';
const legacyNode = '16.17.1';
const legacyElectron = '22.3.14';
const linuxImages = Object.freeze({
  x64: 'node:16.17.1-buster@sha256:674750127bbf45f52660ada71ed1f1491d15e94c16583bff6df0df2489481049',
  arm64: 'node:16.17.1-buster@sha256:0c729a67256272265260411226179dd7ca26d933623758928f0914ffd452dbcf'
});
export const distributionTargets = Object.freeze([
  { name: 'linux-x64-glibc', platform: 'linux', arch: 'x64', runner: 'ubuntu-24.04' },
  { name: 'linux-arm64-glibc', platform: 'linux', arch: 'arm64', runner: 'ubuntu-24.04-arm' },
  { name: 'darwin-x64', platform: 'darwin', arch: 'x64', runner: 'macos-15-intel' },
  { name: 'darwin-arm64', platform: 'darwin', arch: 'arm64', runner: 'macos-15' },
  { name: 'win32-x64', platform: 'win32', arch: 'x64', runner: 'windows-2025', compilerArch: 'x64' },
  { name: 'win32-arm64', platform: 'win32', arch: 'arm64', runner: 'windows-11-arm', compilerArch: 'amd64_arm64' }
].map(Object.freeze));

export function checksumFor(text, filename) {
  const matches = text.split(/\r?\n/).map(line => /^([a-f0-9]{64})[ \t]+\*?(.+)$/i.exec(line))
    .filter(match => match?.[2] === filename);
  assert.equal(matches.length, 1, `Missing or ambiguous supplier checksum: ${filename}`);
  return matches[0][1].toLowerCase();
}

export function assertLinuxDistributionBaseline(requirements) {
  for (const [key, maximum] of Object.entries({ glibcMinimum: '2.28', glibcxxMinimum: '3.4.22', cxxabiMinimum: '1.3.9' })) {
    const actual = requirements.linux[key].split('.').map(Number);
    const limit = maximum.split('.').map(Number);
    let comparison = 0;
    for (let index = 0; index < Math.max(actual.length, limit.length); index++) {
      comparison = (actual[index] ?? 0) - (limit[index] ?? 0);
      if (comparison) break;
    }
    assert(comparison <= 0, `Linux distribution ${key} exceeds ${maximum}`);
  }
}

export function runtimeFiles(manifest) {
  return ['manifest.json', manifest.binary.file, ...(manifest.helper ? [manifest.helper.file] : []),
    ...(manifest.dependencies ?? []).map(asset => asset.file)];
}

function run(file, args, options = {}) {
  const result = spawnSync(file, args, { cwd: root, stdio: 'inherit', timeout: 300000, ...options });
  if (result.error) throw result.error;
  assert.equal(result.signal, null, `Build/load command interrupted: ${path.basename(file)}`);
  assert.equal(result.status, 0, `Build/load command failed: ${path.basename(file)}`);
}

export async function fetchSupplierBytes(url, { timeoutMs = 120000, log = console.log } = {}) {
  const started = performance.now(), deadline = started + timeoutMs;
  let failure;
  for (let attempt = 1; attempt <= 3 && performance.now() < deadline; attempt++) {
    const remaining = Math.floor(deadline - performance.now());
    if (remaining <= 0) break;
    const stalled = new AbortController();
    const signal = AbortSignal.any([AbortSignal.timeout(remaining), stalled.signal]);
    let idleTimer, receivedBytes = 0, lastProgressMs;
    const observeProgress = () => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => stalled.abort(new DOMException('Supplier transfer stalled', 'TimeoutError')),
        Math.min(Math.ceil(timeoutMs / 3), Math.max(1, Math.floor(deadline - performance.now()))));
    };
    observeProgress();
    let retryable = false, responseStatus;
    log(JSON.stringify({ supplierDownload: url, attempt, phase: 'start' }));
    try {
      const response = await fetch(url, { signal });
      responseStatus = response.status;
      if (!response.ok) {
        retryable = [408, 500, 502, 503, 504].includes(response.status);
        await response.body?.cancel();
        throw new Error(`Supplier HTTP ${response.status}: ${url}`);
      }
      observeProgress();
      const chunks = [];
      for await (const chunk of response.body) {
        chunks.push(chunk); receivedBytes += chunk.length;
        if (chunk.length) { lastProgressMs = Math.round(performance.now() - started); observeProgress(); }
      }
      const bytes = Buffer.concat(chunks, receivedBytes);
      assert(performance.now() < deadline, `Supplier download exceeded original deadline: ${url}`);
      log(JSON.stringify({ supplierDownload: url, attempt, phase: 'complete', bytes: bytes.length }));
      return bytes;
    } catch (error) {
      failure = error;
      retryable ||= signal.aborted || (error instanceof TypeError && error.message === 'fetch failed')
        || ['ECONNRESET', 'EPIPE', 'ETIMEDOUT', 'UND_ERR_SOCKET', 'UND_ERR_CONNECT_TIMEOUT']
          .includes(error.cause?.code ?? error.code);
      log(JSON.stringify({ supplierDownload: url, attempt, phase: 'failed',
        reason: error.name, status: responseStatus, code: error.cause?.code ?? error.code,
        receivedBytes, lastProgressMs, elapsedMs: Math.round(performance.now() - started) }));
      if (!retryable || attempt === 3 || performance.now() >= deadline) throw error;
      await new Promise(resolve => setTimeout(resolve, Math.min(100, Math.max(0, deadline - performance.now()))));
    } finally { clearTimeout(idleTimer); stalled.abort(); }
  }
  throw failure ?? new Error(`Supplier download deadline exhausted: ${url}`);
}

export async function checkedDownload(base, filename, destination, inputs, {
  cacheDirectory = process.env.DSC_SUPPLIER_DOWNLOAD_CACHE
} = {}) {
  const sums = await fetchSupplierBytes(`${base}/SHASUMS256.txt`);
  const expected = checksumFor(sums.toString('utf8'), filename);
  const cacheFile = cacheDirectory ? path.join(cacheDirectory, `${expected}.bin`) : undefined;
  let bytes;
  if (cacheFile && fs.existsSync(cacheFile)) {
    const cached = fs.readFileSync(cacheFile);
    const verified = createHash('sha256').update(cached).digest('hex') === expected;
    console.log(JSON.stringify({ supplierDownload: `${base}/${filename}`, phase: verified ? 'cache-verified' : 'cache-rejected' }));
    if (verified) bytes = cached;
  }
  const cacheMiss = !bytes;
  bytes ??= await fetchSupplierBytes(`${base}/${filename}`);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), expected, `Supplier input hash mismatch: ${filename}`);
  if (cacheFile && cacheMiss) {
    fs.mkdirSync(cacheDirectory, { recursive: true });
    const pending = `${cacheFile}.${randomUUID()}.pending`;
    try { fs.writeFileSync(pending, bytes, { flag: 'wx' }); fs.renameSync(pending, cacheFile); }
    finally { fs.rmSync(pending, { force: true }); }
  }
  fs.writeFileSync(destination, bytes, { flag: 'wx' });
  inputs.push({ url: `${base}/${filename}`, sha256: expected });
}

export async function buildDistributionAssets({ targetName, output, artifacts }) {
  const revision = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' });
  assert.equal(revision.status, 0, 'Native assets require an immutable checkout revision');
  const inputCommit = revision.stdout.trim();
  assert.match(inputCommit, /^[a-f0-9]{40}$/);
  if (process.env.DEV_SESSION_CANVAS_EXECUTION_INPUT_SHA) {
    assert.equal(inputCommit, process.env.DEV_SESSION_CANVAS_EXECUTION_INPUT_SHA, 'Native asset checkout differs from requested input');
  }
  const target = distributionTargets.find(entry => entry.name === targetName);
  assert(target, 'Choose one of the fixed six execution asset targets');
  assert.equal(process.platform, target.platform, 'The build host must match its target platform');
  assert.equal(process.arch, target.arch, 'The build and load Node must run the actual target architecture');
  assert.equal(process.versions.node, currentNode, 'Use the fixed current Node build controller');
  const directory = path.resolve(output);
  assert.equal(path.basename(directory), target.name);
  assert(!fs.existsSync(directory), 'Do not overwrite existing candidate assets');
  const artifactDirectory = path.resolve(artifacts);
  fs.mkdirSync(path.dirname(directory), { recursive: true });
  fs.mkdirSync(artifactDirectory, { recursive: true });
  const work = fs.mkdtempSync(path.join(path.dirname(directory), `${target.name}-inputs-`));
  const inputs = [];
  const loadScript = path.join(root, 'scripts/build/check-execution-native-load.cjs');
  const minimumReport = path.join(work, 'minimum-load.json');
  const currentReport = path.join(work, 'current-load.json');
  const nodeBase = `https://nodejs.org/dist/v${currentNode}`;
  const builder = `scripts/build/${target.platform === 'darwin' ? 'macos' : target.platform === 'win32' ? 'windows' : 'linux'}-execution-candidate-assets.mjs`;
  let minimumExecutable;
  let minimumElectron = 'none';
  let docker;
  if (target.platform === 'linux') {
    const image = linuxImages[target.arch];
    inputs.push({ image });
    docker = args => run('docker', ['run', '--rm', '--network', 'none', '--platform', `linux/${target.arch === 'x64' ? 'amd64' : 'arm64'}`,
      '--user', `${process.getuid()}:${process.getgid()}`, '--volume', `${root}:/workspace:ro`,
      '--volume', `${path.dirname(directory)}:/output`, '--workdir', '/workspace', image, ...args]);
    docker(['node', builder, 'build', '--output', `/output/${target.name}`,
      '--dependency-root', '/workspace/node_modules', '--headers', '/usr/local/include/node']);
  } else {
    const headerArchive = path.join(work, 'headers.tar.gz');
    await checkedDownload(nodeBase, `node-v${currentNode}-headers.tar.gz`, headerArchive, inputs);
    const headers = path.join(work, 'headers');
    fs.mkdirSync(headers);
    run('tar', ['--extract', '--gzip', '--file', headerArchive, '--strip-components=1', '--directory', headers]);
    const args = [builder, 'build', '--output', directory, '--dependency-root', path.join(root, 'node_modules'),
      '--headers', path.join(headers, 'include/node')];
    if (target.platform === 'win32') {
      const nodeLib = path.join(work, 'node.lib');
      await checkedDownload(nodeBase, `win-${target.arch}/node.lib`, nodeLib, inputs);
      args.push('--node-lib', nodeLib, '--delay-load-hook', path.join(path.dirname(process.execPath),
        'node_modules/npm/node_modules/node-gyp/src/win_delay_load_hook.cc'));
    }
    run(process.execPath, args);
    if (target.platform === 'win32' && target.arch === 'arm64') {
      const archive = path.join(work, 'electron.zip');
      await checkedDownload(`https://github.com/electron/electron/releases/download/v${legacyElectron}`,
        `electron-v${legacyElectron}-win32-arm64.zip`, archive, inputs);
      const electron = path.join(work, 'electron');
      fs.mkdirSync(electron);
      run('tar', ['--extract', '--file', archive, '--directory', electron]);
      minimumExecutable = path.join(electron, 'electron.exe');
      minimumElectron = legacyElectron;
    } else {
      const filename = `node-v${legacyNode}-${target.platform === 'win32' ? 'win' : target.platform}-${target.arch}`;
      const archive = path.join(work, `${filename}.${target.platform === 'win32' ? 'zip' : 'tar.gz'}`);
      await checkedDownload(`https://nodejs.org/dist/v${legacyNode}`, path.basename(archive), archive, inputs);
      run('tar', ['--extract', '--file', archive, '--directory', work]);
      minimumExecutable = path.join(work, filename, target.platform === 'win32' ? 'node.exe' : 'bin/node');
    }
  }
  const readAssets = target.platform === 'linux' ? readLinux : target.platform === 'darwin' ? readMacos : readWindows;
  const { manifest } = readAssets(directory);
  if (target.platform === 'linux') {
    assertLinuxDistributionBaseline(manifest.requirements);
    docker(['node', 'scripts/build/check-execution-native-load.cjs', `/output/${target.name}`, legacyNode, 'none',
      `/output/${path.basename(work)}/minimum-load.json`]);
  } else {
    const env = { ...process.env };
    if (minimumElectron !== 'none') env.ELECTRON_RUN_AS_NODE = '1';
    else delete env.ELECTRON_RUN_AS_NODE;
    run(minimumExecutable, [loadScript, directory, legacyNode, minimumElectron, minimumReport], { env });
  }
  run(process.execPath, [loadScript, directory, currentNode, 'none', currentReport]);
  const loads = [minimumReport, currentReport].map(file => JSON.parse(fs.readFileSync(file, 'utf8')));
  assert.equal(loads[0].manifestSha256, loads[1].manifestSha256);
  assert.equal(loads[0].binarySha256, loads[1].binarySha256);
  const archive = path.join(artifactDirectory, `${target.name}.tar.gz`);
  assert(!fs.existsSync(archive), 'Do not overwrite an earlier native archive');
  const files = runtimeFiles(manifest);
  run('tar', ['--create', '--gzip', '--file', archive, '--directory', path.dirname(directory),
    ...files.map(file => `${target.name}/${file}`)]);
  const summary = { schemaVersion: 1, inputCommit, target: target.name, inputs,
    build: { runtime: manifest.runtime, requirements: manifest.requirements, sources: manifest.sources,
      compiler: manifest.compiler ?? null }, files, loads,
    archiveSha256: createHash('sha256').update(fs.readFileSync(archive)).digest('hex'),
    nativeLoaded: true, executionApiCalled: false, productValidated: false };
  fs.writeFileSync(path.join(artifactDirectory, `${target.name}-summary.json`), `${JSON.stringify(summary, null, 2)}\n`, { flag: 'wx' });
  console.log(JSON.stringify({ target: target.name, archive, nativeLoaded: true, productValidated: false }));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const { values } = parseArgs({ options: { target: { type: 'string' }, output: { type: 'string' }, artifacts: { type: 'string' } } });
  assert(values.target && values.output && values.artifacts, 'Specify target, output and artifacts');
  buildDistributionAssets({ targetName: values.target, output: values.output, artifacts: values.artifacts }).catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}
