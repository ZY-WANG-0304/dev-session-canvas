import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileDigest, readJSON, writeJSON } from './receipts.mjs';
import { runProcess } from './process.mjs';

// Toolchains are immutable downloads checked against the supplier checksum;
// this does not turn a foreign binary into a native execution environment.
export async function ensureNodeToolchain(version, directory, deadline) {
  assert.match(version, /^\d+\.\d+\.\d+$/u);
  const platform = process.platform === 'win32' ? 'win' : process.platform;
  const filename = `node-v${version}-${platform}-${process.arch}`;
  const extension = process.platform === 'win32' ? '.zip' : '.tar.gz';
  const archiveName = `${filename}${extension}`;
  const root = path.join(directory, filename);
  const executable = path.join(root, process.platform === 'win32' ? 'node.exe' : 'bin/node');
  const supplierFile = path.join(directory, `${filename}-supplier.json`);
  const archive = path.join(directory, archiveName);
  await fs.mkdir(directory, { recursive: true });
  const complete = await fs.stat(executable).catch(() => null) && await fs.stat(supplierFile).catch(() => null);
  if (!complete) {
    // An interrupted extraction is not a cached toolchain. Acquire and verify
    // a new official archive before replacing the private incomplete tree.
    const attempt = randomUUID();
    const baseURL = `https://nodejs.org/dist/v${version}`;
    const download = async (resource, destination) => {
      assert(deadline > Date.now(), 'Fixed Node acquisition deadline expired');
      const pending = `${destination}.${attempt}.pending`;
      const result = await runProcess('curl', ['--fail', '--location', '--proto', '=https',
        '--connect-timeout', '20', '--max-time', String(Math.max(1, Math.ceil((deadline - Date.now()) / 1000))),
        '--retry', '2', '--retry-max-time', String(Math.max(1, Math.ceil((deadline - Date.now()) / 1000))),
        '--output', pending, `${baseURL}/${resource}`],
      { deadline, quiet: true, logPath: `${destination}.${attempt}.download.log` });
      assert.equal(result.status, 'passed', `Fixed Node download failed: ${JSON.stringify(result)}`);
      await fs.rename(pending, destination);
    };
    const sumsFile = path.join(directory, `${filename}-SHASUMS256.txt`);
    await download('SHASUMS256.txt', sumsFile);
    const sums = await fs.readFile(sumsFile, 'utf8');
    const matches = sums.split(/\r?\n/u).map(line => /^([a-f0-9]{64})\s+\*?(.+)$/u.exec(line)).filter(item => item?.[2] === archiveName);
    assert.equal(matches.length, 1, 'Missing/ambiguous supplier Node checksum');
    await download(archiveName, archive);
    assert.equal(await fileDigest(archive), matches[0][1], 'Node archive does not match supplier checksum');
    const extractionRoot = path.join(directory, `${filename}.${attempt}.extracting`);
    await fs.mkdir(extractionRoot);
    const extraction = await runProcess('tar', ['--extract', '--file', archive, '--directory', extractionRoot],
      { deadline, quiet: true, logPath: path.join(directory, `${filename}.${attempt}.extract.log`) });
    assert.equal(extraction.status, 'passed');
    await fs.rm(root, { recursive: true, force: true });
    await fs.rename(path.join(extractionRoot, filename), root);
    await fs.rmdir(extractionRoot);
    await writeJSON(supplierFile, { version, archiveName, sha256: matches[0][1],
      executableHash: await fileDigest(executable), url: `${baseURL}/${archiveName}` });
  }
  const supplier = await readJSON(supplierFile);
  assert.equal(supplier.version, version); assert.equal(supplier.archiveName, archiveName);
  assert.equal(supplier.url, `https://nodejs.org/dist/v${version}/${archiveName}`);
  assert.equal(await fileDigest(archive), supplier.sha256, 'Cached supplier archive changed');
  assert.equal(await fileDigest(executable), supplier.executableHash, 'Cached Node executable changed');
  const actual = JSON.parse(execFileSync(executable, ['-p', 'JSON.stringify({version:process.versions.node,platform:process.platform,arch:process.arch})'],
    { encoding: 'utf8', timeout: Math.max(1, Math.min(5000, deadline - Date.now())) }));
  assert.deepEqual(actual, { version, platform: process.platform, arch: process.arch }, 'Fixed Node toolchain differs');
  return executable;
}
