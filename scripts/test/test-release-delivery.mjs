import assert from 'node:assert/strict';
import { test } from 'node:test';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import { releaseFixture } from './release-fixture.mjs';
import { digest, objectDigest, readJSON, writeJSON } from '../gates/receipts.mjs';
import { prepareRelease, finalizeRelease, verifyRecoveredRelease } from '../release/release-delivery.mjs';
import { collectGitHubProvenance } from '../gates/github-provenance.mjs';
import { githubClient } from '../release/release-github.mjs';
import { recoverReleaseState, appendReleaseState, saveReleaseState } from '../release/release-state.mjs';
import { HTTPFailure, requestBytes } from '../release/channel-client.mjs';

async function fixture(t, { githubRequests = false, loseCreateResponse = false } = {}) {
  const f = await releaseFixture();
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dsc-release-delivery-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const input = path.join(root, 'input');
  for (const [name, value] of Object.entries({ 'package-receipt.json': f.packageReceipt, 'gate-plan.json': f.plan,
    'gate-result.json': f.result, 'gate-provenance.json': f.provenance, 'acceptance-receipt.json': f.acceptance })) {
    await writeJSON(path.join(input, name), value);
  }
  for (const [name, bytes] of Object.entries(f.packageBytes)) await fs.writeFile(path.join(input, name), bytes);
  const remote = new Map(), calls = [], jobs = [], artifacts = [], archives = new Map();
  const release = { id: 42, tag_name: f.context.finalTag, draft: false };
  const client = { repository: f.context.repository,
    readTag: async () => f.context.releaseSHA,
    lookupRelease: async () => ({ observation: 'present', release }),
    uploadAsset: async (_release, name, bytes) => {
      calls.push(`upload:${name}`); const asset = { id: remote.size + 10, name, state: 'uploaded' };
      remote.set(name, { asset, bytes }); return asset;
    },
    downloadAsset: async asset => remote.get(asset.name).bytes,
    json: async route => {
      assert.equal(route, `actions/runs/${f.context.run.id}`);
      return { id: Number(f.context.run.id), run_attempt: f.context.run.attempt, head_sha: f.context.run.headSHA };
    },
    pages: async (route, field) => {
      if (route === `releases/${release.id}/assets`) return [...remote.values()].map(value => value.asset);
      if (field === 'jobs') return jobs;
      assert.equal(field, 'artifacts'); return artifacts;
    },
    bytes: async route => {
      if (/actions\/jobs\/\d+\/logs/u.test(route)) {
        const jobID = Number(route.split('/')[2]);
        return Buffer.from(artifacts.filter(artifact => artifact.jobID === jobID).map(artifact => `Artifact ID: ${artifact.id}`).join('\n'));
      }
      const artifactID = Number(route.split('/')[2]); assert(archives.has(artifactID)); return archives.get(artifactID);
    },
    replaceStateAsset: async (_id, name, bytes) => { calls.push('state'); remote.set(name, { asset: { id: 80, name }, bytes }); },
    updateNotes: async () => { calls.push('notes'); },
    deleteTriggerTag: async () => { calls.push('delete'); return { status: 'passed', trigger: 'deleted' }; }
  };
  const requests = [];
  let releaseState = null;
  if (githubRequests) {
    const actual = githubClient({ repository: f.context.repository, apiURL: 'http://127.0.0.1',
      request: async (url, options) => {
        const method = options.method ?? 'GET';
        const body = options.body ? JSON.parse(options.body.toString()) : null;
        requests.push({ method, path: url.pathname, body });
        if (method === 'POST' && url.pathname === '/repos/test/repo/releases') {
          releaseState = { id: release.id, ...body };
          if (loseCreateResponse) throw new Error('Creation response lost');
        } else if (method === 'GET' && url.pathname === `/repos/test/repo/releases/tags/${f.context.finalTag}`) {
          if (!releaseState) throw Object.assign(new Error('Not found'), { status: 404 });
        } else if (method === 'PATCH' && url.pathname === `/repos/test/repo/releases/${release.id}`) {
          assert(releaseState); Object.assign(releaseState, body);
        } else assert.fail(`Unexpected GitHub request: ${method} ${url.pathname}`);
        return Buffer.from(JSON.stringify(releaseState));
      } });
    for (const name of ['lookupRelease', 'createRelease', 'updateNotes']) client[name] = actual[name];
  }
  const prepared = path.join(root, 'prepared');
  await prepareRelease({ context: f.context, input, output: prepared, client });
  const addArtifact = async (stem, jobName, files) => {
    let job = jobs.find(job => job.name === `Publish / ${jobName}`);
    if (!job) { job = { id: jobs.length + 1, name: `Publish / ${jobName}`, status: 'completed', conclusion: 'success', steps: [] };
      jobs.push(job); }
    const jobID = job.id, id = artifacts.length + 100;
    const zip = new JSZip(); for (const [name, bytes] of Object.entries(files)) zip.file(name, bytes);
    const bytes = await zip.generateAsync({ type: 'nodebuffer' });
    const artifact = { id, name: `${stem}-${f.context.run.id}-${f.context.run.attempt}`, jobID, expired: false,
      workflow_run: { id: Number(f.context.run.id), head_sha: f.context.run.headSHA }, digest: `sha256:${digest(bytes)}` };
    archives.set(id, bytes); artifacts.push(artifact); return artifact;
  };
  const preparedFiles = {};
  for (const name of await fs.readdir(prepared)) preparedFiles[name] = await fs.readFile(path.join(prepared, name));
  await addArtifact('prepared-release', 'Release prepare-release', preparedFiles);
  for (const target of ['open-vsx', 'visual-studio']) await addArtifact(`marketplace-result-${target}`,
    `Release publish-${target}`, { 'channel-partial.json': JSON.stringify(f.partial(target)) });
  return { f, root, input, prepared, remote, calls, jobs, artifacts, archives, client, addArtifact, requests, releaseState: () => structuredClone(releaseState) };
}
const runFinalize = (f, directory = 'final') => finalizeRelease({ context: f.f.context, prepared: f.prepared,
  output: path.join(f.root, directory), client: f.client, renderNotes: manifest => `status=${manifest.status}\n` });

for (const loseCreateResponse of [false, true]) {
  test(`GitHub creation keeps ordinary Release classification with lost response=${loseCreateResponse}`, async t => {
    const f = await fixture(t, { githubRequests: true, loseCreateResponse });
    const creates = f.requests.filter(request => request.method === 'POST');
    assert.equal(creates.length, 1, 'Lost creation response must not duplicate the Release');
    assert.deepEqual(creates[0].body, {
      tag_name: f.f.context.finalTag, target_commitish: f.f.context.releaseSHA,
      name: `Dev Session Canvas v${f.f.context.version}`,
      body: `已验收的主扩展与 notifier 双包；渠道交付进行中。\n\nRelease ref: ${f.f.context.releaseSHA}`,
      draft: false, prerelease: false
    });
    assert.equal(f.releaseState().prerelease, false);
  });
}
for (const mode of ['release-tag', 'channel-retry']) {
  test(`GitHub ${mode} completion preserves ordinary Release classification`, async t => {
    const f = await fixture(t, { githubRequests: true });
    if (mode === 'channel-retry') f.f.context = { ...f.f.context, mode, existingReleaseID: 42 };
    f.requests.length = 0;
    const result = await runFinalize(f);
    assert.equal(result.completion.status, 'complete');
    assert.equal(result.cleanup.status, 'passed');
    assert.deepEqual(f.requests, [{ method: 'PATCH', path: '/repos/test/repo/releases/42', body: { body: 'status=complete\n' } }]);
    assert.equal(f.releaseState().prerelease, false);
    assert.equal(f.releaseState().draft, false);
  });
}

test('finalize binds real artifact ZIPs and updates notes before deleting the trigger', async t => {
  const f = await fixture(t); f.calls.length = 0;
  const result = await runFinalize(f);
  assert.equal(result.completion.status, 'complete'); assert.equal(result.cleanup.status, 'passed');
  assert.deepEqual(f.calls, ['state', 'notes', 'delete', 'state']);
  assert.deepEqual(f.remote.get('main.vsix').bytes, f.f.packageBytes['main.vsix']);
});
test('missing optional receipt retains failed state and verified sibling evidence', async t => {
  const f = await fixture(t); f.artifacts.pop(); f.calls.length = 0;
  const result = await runFinalize(f);
  assert.equal(result.completion.status, 'failed'); assert.equal(result.cleanup.status, 'not-run');
  assert.equal(result.manifest.marketplaces.openVsx.main.status, 'verified');
  assert.equal(result.manifest.marketplaces.visualStudio.main.content, 'unknown');
  assert.equal(result.manifest.tags.triggerTagStatus, 'kept'); assert(!f.calls.includes('delete'));
  const saved = JSON.parse(f.remote.get('release-manifest-1.2.3.json').bytes.toString());
  assert.equal(saved.status, 'failed'); assert(saved.releaseCompletion.errors.length > 0);
});
test('wrong producer cannot be used even when the partial itself says verified', async t => {
  const f = await fixture(t); f.jobs[1].name = 'Release unrelated-job'; f.calls.length = 0;
  const result = await runFinalize(f);
  assert.equal(result.completion.status, 'failed'); assert(!f.calls.includes('delete'));
  assert.equal(result.manifest.marketplaces.openVsx.main.content, 'unknown');
});
test('notes failure leaves the temporary tag and a durable complete-delivery fact', async t => {
  const f = await fixture(t); f.calls.length = 0;
  f.client.updateNotes = async () => { f.calls.push('notes'); throw new Error('notes update failed'); };
  await assert.rejects(() => runFinalize(f), /notes update failed/u);
  assert.deepEqual(f.calls, ['state', 'notes']);
  assert.equal((await readJSON(path.join(f.root, 'final', 'release-completion.json'))).status, 'complete');
  assert.equal(JSON.parse(f.remote.get('release-manifest-1.2.3.json').bytes.toString()).tags.triggerTagStatus, 'kept');
});
test('tag cleanup failure does not erase completed delivery', async t => {
  const f = await fixture(t);
  f.client.deleteTriggerTag = async () => { throw new Error('tag delete response unavailable'); };
  const result = await runFinalize(f);
  assert.equal(result.completion.status, 'complete'); assert.equal(result.cleanup.status, 'failed');
  assert.equal(result.manifest.tags.triggerTagStatus, 'cleanup-failed');
  assert.equal(result.manifest.marketplaces.openVsx.notifier.status, 'verified');
});
test('lost GitHub upload response queries original bytes without a second upload', async () => {
  let submits = 0;
  const content = Buffer.from('accepted original bytes'), asset = { id: 55, name: 'main.vsix' };
  let uploadHeaders;
  const client = githubClient({ repository: 'test/repo', apiURL: 'http://127.0.0.1', request: async (url, options) => {
    if (options.method === 'POST') { submits++; uploadHeaders = options.headers; throw new Error('response lost after upload'); }
    if (url.pathname.endsWith('/assets/55')) return content;
    return Buffer.from(JSON.stringify([asset]));
  } });
  const observed = await client.uploadAsset({ id: 42, upload_url: 'http://127.0.0.1/upload{?name}' }, 'main.vsix', content, Date.now() + 1000);
  assert.equal(observed.id, 55); assert.equal(submits, 1);
  assert.equal(uploadHeaders['Content-Type'], 'application/octet-stream');
  assert.equal(uploadHeaders['Content-Length'], String(content.byteLength));
});

test('GitHub asset upload sends the exact binary Content-Length on the wire', async t => {
  const content = Buffer.from([0x00, 0xff, 0x28, 0x80, 0x0a, 0x7f]);
  let received;
  const server = http.createServer((request, response) => {
    const chunks = [];
    request.on('data', chunk => chunks.push(chunk));
    request.once('end', () => {
      received = { method: request.method, headers: request.headers, body: Buffer.concat(chunks) };
      const result = Buffer.from(JSON.stringify({ id: 55, name: 'main.vsix' }));
      response.writeHead(201, { 'Content-Type': 'application/json', 'Content-Length': String(result.byteLength) });
      response.end(result);
    });
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject); server.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const baseURL = `http://127.0.0.1:${server.address().port}`;
  const client = githubClient({ repository: 'test/repo', apiURL: baseURL, request: requestBytes });
  const uploaded = await client.uploadAsset({ id: 42,
    upload_url: `${baseURL}/repos/test/repo/releases/42/assets{?name,label}` }, 'main.vsix', content, Date.now() + 5000);
  assert.equal(uploaded.id, 55);
  assert.equal(received.method, 'POST');
  assert.equal(received.headers['content-type'], 'application/octet-stream');
  assert.equal(received.headers['content-length'], String(content.byteLength));
  assert.equal(received.headers['transfer-encoding'], undefined);
  assert.deepEqual(received.body, content);
});

test('HTTP failures preserve bounded safe server diagnostics', async t => {
  const responseBody = JSON.stringify({ message: 'Validation Failed', documentation_url: 'https://docs.github.com/rest/releases/assets?requestToken=should-not-log',
    errors: [{ resource: 'ReleaseAsset', field: 'name', code: 'invalid', secret: 'must not be logged' }], token: 'must not be logged' });
  const server = http.createServer((request, response) => {
    request.resume(); response.writeHead(400, { 'Content-Type': 'application/json' }); response.end(responseBody);
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject); server.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => new Promise(resolve => server.close(resolve)));
  await assert.rejects(() => requestBytes(`http://127.0.0.1:${server.address().port}/upload`, {
    deadline: Date.now() + 5000
  }), error => {
    assert(error instanceof HTTPFailure); assert.equal(error.status, 400);
    assert.match(error.message, /Validation Failed/u); assert.match(error.message, /ReleaseAsset/u);
    assert.match(error.message, /"code":"invalid"/u); assert.match(error.message, /"field":"name"/u);
    assert.match(error.message, /https:\/\/docs\.github\.com\/rest\/releases\/assets/u);
    assert.doesNotMatch(error.message, /must not be logged|should-not-log/u);
    return true;
  });
});

async function stateFixture(t) {
  const f = await fixture(t);
  const name = 'release-manifest-1.2.3.json';
  const pending = await readJSON(path.join(f.prepared, name));
  const result = await runFinalize(f);
  for (const [directory, stem, job] of [[f.prepared, 'release-prepare-evidence', 'Release prepare-release'],
    [path.join(f.root, 'final'), 'marketplace-release', 'Release finalize-release']]) {
    const files = {};
    for (const file of await fs.readdir(directory)) if (file.startsWith('state-') || file === name) {
      const bytes = await fs.readFile(path.join(directory, file)); files[file] = bytes;
      if (file.startsWith('state-')) f.remote.set(file, { asset: { id: f.remote.size + 200, name: file, state: 'uploaded' }, bytes });
    }
    await f.addArtifact(stem, job, files);
  }
  f.remote.get(name).asset.state = 'uploaded';
  const context = { ...f.f.context, mode: 'channel-retry', existingReleaseID: 42,
    run: { id: '67890', attempt: 1, headSHA: 'd'.repeat(40) } };
  const client = { ...f.client, json: async route => {
    const runID = Number(route.split('/').at(-1));
    assert.equal(runID, Number(f.f.context.run.id));
    return { id: runID, run_attempt: f.f.context.run.attempt, head_sha: f.f.context.run.headSHA };
  } };
  return { ...f, name, pending, final: result.manifest, context, client };
}
const recoverState = async (f, directory = 'recovery') => recoverReleaseState({ context: f.context, identity: f.f.identity,
  assets: [...f.remote.values()].map(value => value.asset), client: f.client,
  output: path.join(f.root, directory), deadline: Date.now() + 20000 });

test('release recovery uses the unique producer-verified successor when canonical upload was interrupted', async t => {
  const f = await stateFixture(t); f.remote.delete(f.name);
  const recovered = await recoverState(f);
  assert.deepEqual(recovered.manifest, f.final); assert.equal(recovered.chain.length, 3);
  assert.equal(recovered.stateDigest, objectDigest(f.final));
  assert.deepEqual(recovered.manifest.context.run, f.f.context.run);
  f.remote.set(f.name, { asset: { id: 700, name: f.name, state: 'uploaded' },
    bytes: Buffer.from(`${JSON.stringify(f.pending, null, 2)}\n`) });
  assert.deepEqual((await recoverState(f, 'stale-canonical')).manifest, f.final);
});

for (const kind of ['wrong-bytes', 'missing-parent', 'fork', 'wrong-producer', 'expired-proof']) {
  test(`release state recovery refuses ${kind}`, async t => {
    const f = await stateFixture(t);
    if (kind === 'wrong-bytes') {
      const snapshot = [...f.remote.values()].find(value => value.asset.name.startsWith('state-'));
      snapshot.bytes = Buffer.from('{}');
    } else if (kind === 'missing-parent') {
      for (const [name, value] of f.remote) if (name.startsWith('state-')
        && JSON.parse(value.bytes.toString()).stateChain.sequence === 1) f.remote.delete(name);
    } else if (kind === 'fork') {
      const fork = appendReleaseState({ ...f.final, status: 'failed' }, { phase: 'finalize', parent: f.pending });
      const bytes = Buffer.from(`${JSON.stringify(fork, null, 2)}\n`);
      const name = `state-${digest(bytes)}-${f.name}`;
      f.remote.set(name, { asset: { id: 900, name, state: 'uploaded' }, bytes });
    } else if (kind === 'wrong-producer') f.jobs.find(job => job.name.endsWith('Release finalize-release')).name = 'Release unrelated';
    else f.artifacts.find(artifact => artifact.name.startsWith('marketplace-release-')).expired = true;
    await assert.rejects(() => recoverState(f));
  });
}

test('GitHub state replacement preserves the predecessor and successor before a canonical failure', async () => {
  const old = Buffer.from('old durable state'), next = Buffer.from('next durable state');
  const remote = new Map([['release-manifest-1.2.3.json', { id: 10, bytes: old }]]);
  let nextID = 11, deleted = false, submissions = 0;
  const client = githubClient({ repository: 'test/repo', apiURL: 'http://127.0.0.1', request: async (url, options) => {
    if (options.method === 'POST') {
      submissions++; const name = url.searchParams.get('name');
      if (name === 'release-manifest-1.2.3.json') throw new Error('canonical upload unavailable');
      const asset = { id: nextID++, bytes: options.body }; remote.set(name, asset);
      return Buffer.from(JSON.stringify({ id: asset.id, name }));
    }
    if (options.method === 'DELETE') { deleted = true; remote.delete('release-manifest-1.2.3.json'); return Buffer.alloc(0); }
    if (url.pathname.endsWith('/releases/42')) return Buffer.from(JSON.stringify({ id: 42, upload_url: 'http://127.0.0.1/upload{?name}' }));
    if (url.pathname.endsWith('/releases/42/assets')) return Buffer.from(JSON.stringify([...remote].map(([name, asset]) => ({ name, id: asset.id }))));
    return [...remote.values()].find(asset => url.pathname.endsWith(`/assets/${asset.id}`)).bytes;
  } });
  await assert.rejects(() => client.replaceStateAsset(42, 'release-manifest-1.2.3.json', next, Date.now() + 1000), /canonical upload unavailable/u);
  assert(deleted); assert.equal(submissions, 3);
  assert.deepEqual(remote.get(`state-${digest(old)}-release-manifest-1.2.3.json`).bytes, old);
  assert.deepEqual(remote.get(`state-${digest(next)}-release-manifest-1.2.3.json`).bytes, next);
});

test('prepare interrupted midway through immutable assets keeps accepted bytes and refuses incomplete fast recovery', async t => {
  const f = await fixture(t); f.remote.clear();
  const upload = f.client.uploadAsset;
  f.client.uploadAsset = async (release, name, bytes) => {
    if (name === 'notifier.vsix') throw new Error('second immutable asset unavailable');
    return upload(release, name, bytes);
  };
  await assert.rejects(() => prepareRelease({ context: f.f.context, input: f.input,
    output: path.join(f.root, 'interrupted-prepare'), client: f.client }), /second immutable asset unavailable/u);
  assert.deepEqual(f.remote.get('main.vsix').bytes, f.f.packageBytes['main.vsix']);
  assert.equal(f.remote.has('release-manifest-1.2.3.json'), false);
  const context = { ...f.f.context, mode: 'channel-retry', existingReleaseID: 42 };
  await assert.rejects(() => recoverReleaseState({ context, identity: f.f.identity,
    assets: [...f.remote.values()].map(value => value.asset), client: f.client,
    output: path.join(f.root, 'incomplete'), deadline: Date.now() + 1000 }), /no recoverable manifest/u);
});

async function recoveryFixture(t) {
  const f = await stateFixture(t);
  f.context = { ...f.context, selection: 'open-vsx', selectedTargets: ['open-vsx'] };
  const original = {};
  for (const name of ['gate-plan.json', 'gate-result.json', 'gate-provenance.json', 'acceptance-receipt.json'])
    original[name] = await fs.readFile(path.join(f.prepared, name));
  await f.addArtifact('gate-acceptance', 'Gate verify-result (default)', original);
  await f.addArtifact('gate-transfer-candidate', 'Gate package-clean (default)', {
    'package-receipt.json': await fs.readFile(path.join(f.prepared, 'package-receipt.json')),
    ...f.f.packageBytes
  });
  f.collector = (plan, options) => collectGitHubProvenance(plan, { ...options,
    api: async route => {
      if (/\/jobs\?/u.test(route)) return { jobs: f.jobs };
      if (/\/artifacts\?/u.test(route)) return { artifacts: f.artifacts };
      return f.client.json(route.replace(`repos/${f.context.repository}/`, ''));
    },
    log: id => f.client.bytes(`actions/jobs/${id}/logs`).then(bytes => bytes.toString()),
    download: id => f.client.bytes(`actions/artifacts/${id}/zip`) });
  return f;
}
const verifyRecovery = f => verifyRecoveredRelease({ context: f.context, client: f.client, collector: f.collector,
  output: path.join(f.root, 'complete-recovery'), deadline: Date.now() + 20000 });

test('original recovery binds accepted pair, verifier, state chain and unselected channel history with a different dispatch head', async t => {
  const f = await recoveryFixture(t);
  assert.notEqual(f.context.run.headSHA, f.context.releaseSHA);
  const result = await verifyRecovery(f);
  assert.equal(result.status, 'passed'); assert.equal(result.releaseSHA, f.f.context.releaseSHA);
  assert.equal(result.producer.runID, f.context.run.id); assert.equal(result.releaseState.chain.length, 3);
  assert.equal(result.downloaded.length, 9);
  const output = path.join(f.root, 'complete-recovery');
  assert.deepEqual(await fs.readFile(path.join(output, 'main.vsix')), f.f.packageBytes['main.vsix']);
  assert.deepEqual(await fs.readFile(path.join(output, 'notifier.vsix')), f.f.packageBytes['notifier.vsix']);
  const history = await readJSON(path.join(output, 'validated-channel-history.json'));
  assert.deepEqual(Object.keys(history), ['visual-studio']);
  assert.deepEqual(history['visual-studio'].context.run, f.f.context.run);
});

for (const failure of ['package-bytes', 'original-verifier', 'candidate-producer', 'history-producer', 'actual-run-head', 'missing-original']) {
  test(`complete original recovery rejects ${failure}`, async t => {
    const f = await recoveryFixture(t);
    if (failure === 'package-bytes') f.remote.get('main.vsix').bytes = Buffer.from('another build');
    else if (failure === 'original-verifier') f.jobs.find(job => job.name.endsWith('Gate verify-result (default)')).conclusion = 'failure';
    else if (failure === 'candidate-producer') f.jobs.find(job => job.name.endsWith('Gate package-clean (default)')).name = 'Publish / Gate unrelated (default)';
    else if (failure === 'history-producer') f.jobs.find(job => job.name.endsWith('Release publish-visual-studio')).name = 'Publish / Release unrelated';
    else if (failure === 'actual-run-head') {
      const original = f.client.json;
      f.client.json = async route => ({ ...await original(route), head_sha: f.context.run.headSHA });
    } else f.remote.delete('original-release-context.json');
    await assert.rejects(() => verifyRecovery(f));
    assert.equal(await fs.stat(path.join(f.root, 'complete-recovery', 'recovery-verification.json')).catch(() => null), null);
  });
}

test('a second release-tag prepare root is refused after accepted original assets already exist', async t => {
  const f = await fixture(t);
  await assert.rejects(() => prepareRelease({ context: f.f.context, input: f.input,
    output: path.join(f.root, 'second-prepare'), client: f.client }), /verified channel-retry/);
});
