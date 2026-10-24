import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { infrastructureBudgets, evidenceLimits } from './catalog.mjs';
import { digest, readJSON, writeJSON } from './receipts.mjs';
import { withinDeadline } from './deadline.mjs';

export { evidenceLimits };
const excludedDirectories = new Set(['node_modules', '.git', 'cache', 'npm-cache', 'remote-cache', 'remote-home',
  'remote-agent', 'remote-tmp', 'home', 'tmp', 'appdata', 'local-appdata', 'extensions', 'native-set',
  'source-bundle', 'browser-bundle', 'legacy-supervisor-source']);
const payloadDirectories = new Set(['smoke-host', 'smoke-host-extension', 'packaged-extension',
  'packaged-notifier', 'notifier-extension']);
const sshEvidence = new Set(['sshd.log', 'ssh_config', 'sshd_config', 'known_hosts', 'authorized_keys',
  'id_ed25519.pub', 'ssh_host_ed25519_key.pub']);
const portable = file => file.split(path.sep).join('/');
export function assertEvidencePath(file) {
  assert(typeof file === 'string' && file && !file.startsWith('/') && !file.includes('\\')
    && !file.split('/').some(part => !part || part === '.' || part === '..'), 'Unsafe evidence path');
}

async function readEvidenceFile(file, stat, limits, signal) {
  signal.throwIfAborted();
  const truncated = /\.(?:log|txt)$/u.test(file) && stat.size > limits.logBytes;
  assert(truncated || stat.size <= limits.memberBytes, `Non-log evidence exceeds the file limit: ${file}`);
  const handle = await fs.open(file, 'r');
  try {
    const sourceHash = createHash('sha256');
    const chunks = [], head = [], tail = [];
    let headBytes = 0, tailBytes = 0, position = 0;
    const tailLimit = limits.logBytes - limits.logHeadBytes;
    for (;;) {
      signal.throwIfAborted();
      const block = Buffer.alloc(Math.min(256 * 1024, Math.max(1, stat.size - position)));
      const { bytesRead } = await handle.read(block, 0, block.length, position);
      if (!bytesRead) break;
      const bytes = block.subarray(0, bytesRead);
      sourceHash.update(bytes); position += bytesRead;
      if (!truncated) chunks.push(bytes);
      else {
        if (headBytes < limits.logHeadBytes) {
          const prefix = bytes.subarray(0, Math.min(bytesRead, limits.logHeadBytes - headBytes));
          head.push(prefix); headBytes += prefix.length;
        }
        tail.push(bytes); tailBytes += bytesRead;
        while (tailBytes > tailLimit) {
          const excess = tailBytes - tailLimit;
          if (tail[0].length <= excess) tailBytes -= tail.shift().length;
          else { tail[0] = tail[0].subarray(excess); tailBytes -= excess; }
        }
      }
      assert(position <= stat.size, 'Evidence changed while collecting');
    }
    assert.equal(position, stat.size, 'Evidence changed while collecting');
    const after = await handle.stat();
    assert.equal(after.size, stat.size); assert.equal(after.mtimeMs, stat.mtimeMs, 'Evidence is still being written');
    const content = truncated ? Buffer.concat([...head,
      Buffer.from(`\n[gate evidence: bytes ${headBytes}..${stat.size - tailBytes} omitted; see evidence-manifest.json]\n`), ...tail])
      : Buffer.concat(chunks);
    return { content, sourceSha256: sourceHash.digest('hex'), retention: truncated ? 'log-sections' : 'complete',
      ranges: truncated ? [[0, headBytes], [stat.size - tailBytes, stat.size]] : [[0, stat.size]] };
  } finally { await handle.close(); }
}

// This collector does not delete source files or invent a passing task result.
// Its own failure remains an infrastructure failure of the actual producer job.
export async function collectEvidence({ roots, output, identity, deadline = Date.now() + infrastructureBudgets.evidence,
  limits = evidenceLimits }) {
  assert(Array.isArray(roots) && roots.length); assert(identity?.inputSHA);
  const destination = path.resolve(output);
  await fs.mkdir(destination, { recursive: true });
  assert.equal((await fs.readdir(destination)).length, 0, 'Evidence output must be fresh');
  const manifest = { schemaVersion: 1, status: 'running', identity, limits, files: [], excluded: [],
    failures: [], startedAt: new Date().toISOString(), deadline };
  let failure, totalBytes = 0;
  const names = new Set();
  try {
    await withinDeadline('Stage evidence collection', deadline, async signal => {
      const copy = async (source, relative) => {
        signal.throwIfAborted(); assertEvidencePath(relative);
        const stat = await fs.lstat(source);
        assert(stat.isFile(), `Evidence must be a regular file: ${relative}`);
        assert(!names.has(relative), `Duplicate evidence path: ${relative}`);
        assert(names.size < limits.files, 'Evidence file count exceeds the collection limit');
        const observed = await readEvidenceFile(source, stat, limits, signal);
        totalBytes += observed.content.length;
        assert(totalBytes <= limits.totalBytes, 'Evidence bytes exceed the collection limit');
        signal.throwIfAborted();
        const target = path.join(destination, relative);
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.writeFile(target, observed.content, { flag: 'wx' });
        names.add(relative);
        manifest.files.push({ path: relative, size: observed.content.length, sha256: digest(observed.content),
          originalSize: stat.size, sourceSha256: observed.sourceSha256, retention: observed.retention, ranges: observed.ranges });
      };
      const selected = async (source, relative, allowed, reason) => {
        manifest.excluded.push({ path: relative, reason, retained: allowed });
        for (const name of allowed) {
          const file = path.join(source, name);
          const stat = await fs.lstat(file).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
          if (stat) await copy(file, `${relative}/${name}`);
        }
      };
      const visit = async (source, prefix = '') => {
        signal.throwIfAborted();
        for (const entry of await fs.readdir(source, { withFileTypes: true })) {
          signal.throwIfAborted();
          const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
          const file = path.join(source, entry.name);
          if (entry.isDirectory()) {
            if (excludedDirectories.has(entry.name) || entry.name.startsWith('.candidate-clean-')) {
              manifest.excluded.push({ path: relative, reason: 'dependency, host cache, build transfer or private checkout' });
            } else if (payloadDirectories.has(entry.name)) {
              await selected(file, relative, ['package.json', 'extension.js', 'extension/package.json'],
                'payload is identified by the frozen source/build or package transfer and instrumentation receipt');
            } else if (entry.name === 'user-data') {
              await selected(file, relative, ['User/settings.json'], 'isolated host caches; product snapshots and logs are in artifacts');
            } else if (entry.name === 'sshd') {
              await selected(file, relative, [...sshEvidence], 'private keys are not evidence');
            } else await visit(file, relative);
          } else if (entry.isSymbolicLink()) {
            assert.fail(`Redirected evidence is forbidden: ${relative}`);
          } else if (/^(?:\.env(?:\..*)?|.*\.npmrc|id_ed25519|ssh_host_ed25519_key)$/u.test(entry.name)) {
            manifest.excluded.push({ path: relative, reason: 'private configuration or credential' });
          } else await copy(file, relative);
        }
      };
      for (const { directory, prefix = '', optional = false } of roots) {
        if (prefix) assertEvidencePath(prefix);
        const source = path.resolve(directory);
        assert(source !== destination && !destination.startsWith(`${source}${path.sep}`), 'Evidence output cannot be inside its source');
        const stat = await fs.lstat(source).catch(error => { if (error.code === 'ENOENT' && optional) return null; throw error; });
        if (stat) { assert(stat.isDirectory()); await visit(source, prefix); }
      }
      assert(manifest.files.length, 'No actual evidence was collected');
    });
    manifest.status = 'passed';
  } catch (error) {
    failure = error; manifest.status = 'failed';
    manifest.failures.push({ reason: error.message, unsettled: error.unsettled === true });
  }
  manifest.completedAt = new Date().toISOString(); manifest.totalBytes = totalBytes;
  manifest.files.sort((a, b) => a.path.localeCompare(b.path));
  await writeJSON(path.join(destination, 'evidence-manifest.json'), manifest);
  if (failure) throw failure;
  return manifest;
}

export async function verifyEvidenceManifest(directory, { identity } = {}) {
  const manifest = await readJSON(path.join(directory, 'evidence-manifest.json'));
  assert.equal(manifest.schemaVersion, 1); assert.equal(manifest.status, 'passed', 'Evidence collection failed');
  if (identity) assert.deepEqual(manifest.identity, identity, 'Evidence belongs to another producer/input');
  assert.deepEqual(manifest.limits, evidenceLimits, 'Evidence retention policy changed');
  assert(Array.isArray(manifest.files) && manifest.files.length > 0 && manifest.files.length <= evidenceLimits.files);
  const actual = [];
  const visit = async root => { for (const entry of await fs.readdir(root, { withFileTypes: true })) {
    const file = path.join(root, entry.name);
    if (entry.isDirectory()) await visit(file);
    else { assert(entry.isFile(), 'Redirected evidence is forbidden'); actual.push(portable(path.relative(directory, file))); }
  } };
  await visit(directory);
  assert.deepEqual(actual.filter(name => name !== 'evidence-manifest.json').sort(), manifest.files.map(item => item.path).sort(),
    'Actual evidence files differ from the collection manifest');
  let total = 0;
  for (const entry of manifest.files) {
    assertEvidencePath(entry.path);
    const bytes = await fs.readFile(path.join(directory, entry.path));
    assert.equal(bytes.length, entry.size); assert.equal(digest(bytes), entry.sha256, 'Retained evidence bytes changed');
    assert(Number.isSafeInteger(entry.originalSize) && entry.originalSize >= 0);
    assert.match(entry.sourceSha256, /^[a-f0-9]{64}$/u);
    if (entry.retention === 'complete') {
      assert.equal(entry.originalSize, entry.size); assert.equal(entry.sourceSha256, entry.sha256);
      assert.deepEqual(entry.ranges, [[0, entry.size]]);
    } else {
      assert.equal(entry.retention, 'log-sections'); assert.match(entry.path, /\.(?:log|txt)$/u);
      assert(entry.originalSize > evidenceLimits.logBytes && entry.size <= evidenceLimits.logBytes + 256);
      assert.deepEqual(entry.ranges, [[0, evidenceLimits.logHeadBytes],
        [entry.originalSize - (evidenceLimits.logBytes - evidenceLimits.logHeadBytes), entry.originalSize]]);
    }
    total += bytes.length;
  }
  const retained = new Map(manifest.files.map(entry => [entry.path, entry]));
  for (const entry of manifest.files.filter(entry => entry.path.endsWith('.task.json'))) {
    const receipt = await readJSON(path.join(directory, entry.path));
    assert(Array.isArray(receipt.evidence), 'Task evidence references are missing');
    for (const evidence of receipt.evidence) {
      assertEvidencePath(evidence.path);
      assert.equal(retained.get(evidence.path)?.sourceSha256, evidence.sha256,
        'Task evidence is missing or differs from the original collected bytes');
    }
  }
  assert.equal(manifest.totalBytes, total); assert(total <= evidenceLimits.totalBytes);
  assert.deepEqual(manifest.failures, []);
  assert(Number.isFinite(Date.parse(manifest.completedAt)) && Date.parse(manifest.completedAt) <= manifest.deadline,
    'Evidence collection exceeded its original deadline');
  return manifest;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const { values } = parseArgs({ options: { plan: { type: 'string' }, job: { type: 'string' },
    variant: { type: 'string' }, results: { type: 'string', default: 'gate-results' }, output: { type: 'string' } } });
  assert(values.plan && values.job && values.variant && values.output);
  const plan = await readJSON(values.plan);
  await collectEvidence({ roots: [
    { directory: path.join(values.results, values.job, values.variant), prefix: `${values.job}/${values.variant}`, optional: true },
    { directory: path.join(values.results, 'infrastructure'), prefix: 'infrastructure', optional: true },
    ...(values.job === 'package-clean' ? [{ directory: 'gate-transfer/release-candidate', prefix: 'candidate', optional: true }] : [])
  ], output: values.output, identity: { inputSHA: plan.inputSHA, job: values.job, variant: values.variant,
    runID: String(plan.run.id), attempt: plan.run.attempt } });
}
