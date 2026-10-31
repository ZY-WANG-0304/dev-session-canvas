import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs/promises';
import { digest, writeJSON } from '../gates/receipts.mjs';
import { inspectArtifactArchive } from '../gates/github-provenance.mjs';
import { requestBytes } from './channel-client.mjs';
import { releaseJobName } from './release-completion.mjs';

export function githubClient({ repository = process.env.GITHUB_REPOSITORY, token = process.env.GH_TOKEN,
  apiURL = 'https://api.github.com', request = requestBytes } = {}) {
  assert(repository && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(repository));
  const headers = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28',
    ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  const routeURL = route => new URL(route.startsWith('/') ? route : `/repos/${repository}/${route}`, apiURL);
  const bytes = (route, options = {}) => request(routeURL(route), { ...options,
    headers: { ...headers, ...(options.headers ?? {}) } });
  const json = async (route, options = {}) => JSON.parse((await bytes(route, { maxBytes: 32 * 1024 ** 2, ...options })).toString('utf8'));
  const mutate = (route, method, body, deadline) => json(route, { method, deadline,
    headers: { 'Content-Type': 'application/json' }, body: Buffer.from(JSON.stringify(body)) });
  const pages = async (route, field, deadline) => {
    const all = [];
    for (let page = 1; ; page++) {
      const result = await json(`${route}${route.includes('?') ? '&' : '?'}per_page=100&page=${page}`, { deadline });
      const items = field ? result[field] : result; assert(Array.isArray(items)); all.push(...items);
      if (items.length < 100) return all;
    }
  };
  const readMatchingAsset = async (release, name, content, deadline) => {
    const matches = (await pages(`releases/${release.id}/assets`, null, deadline)).filter(asset => asset.name === name);
    assert(matches.length <= 1, 'Ambiguous GitHub asset');
    if (!matches.length) return null;
    const remote = await bytes(`releases/assets/${matches[0].id}`, { deadline,
      headers: { Accept: 'application/octet-stream' }, maxBytes: 512 * 1024 ** 2 });
    assert.equal(digest(remote), digest(content), `GitHub asset ${name} differs; refuse clobber`);
    return matches[0];
  };
  const uploadAsset = async (release, name, content, deadline) => {
    const url = new URL(release.upload_url.replace(/\{.*$/u, ''));
    assert(url.protocol === new URL(apiURL).protocol);
    assert(url.origin === new URL(apiURL).origin || url.hostname === 'uploads.github.com', 'Untrusted upload URL');
    url.searchParams.set('name', name);
    try {
      return JSON.parse((await request(url, { deadline, method: 'POST', body: content,
          headers: { ...headers, 'Content-Type': 'application/octet-stream',
            'Content-Length': String(content.byteLength) }, maxBytes: 4 * 1024 ** 2 })).toString('utf8'));
    } catch (error) {
      // A lost response never authorizes a second upload. Query by the fixed
      // name and validate the actual bytes, or retain the original failure.
      const observed = await readMatchingAsset(release, name, content, deadline);
      if (observed) return observed;
      throw error;
    }
  };
  return {
    repository, json, bytes, pages,
    async lookupRelease(tag, deadline) {
      try { return { observation: 'present', release: await json(`releases/tags/${encodeURIComponent(tag)}`, { deadline }) }; }
      catch (error) { if (error.status === 404) return { observation: 'absent', release: null }; throw error; }
    },
    async readTag(tag, deadline) {
      let ref;
      try { ref = await json(`git/ref/tags/${tag.split('/').map(encodeURIComponent).join('/')}`, { deadline }); }
      catch (error) { if (error.status === 404) return null; throw error; }
      const seen = new Set();
      while (ref.object.type === 'tag') {
        assert(!seen.has(ref.object.sha), 'Cyclic annotated tag'); seen.add(ref.object.sha);
        ref = await json(`git/tags/${ref.object.sha}`, { deadline });
      }
      assert.equal(ref.object.type, 'commit'); return ref.object.sha;
    },
    async createTag(tag, sha, deadline) {
      try { return await mutate('git/refs', 'POST', { ref: `refs/tags/${tag}`, sha }, deadline); }
      catch (error) { if (await this.readTag(tag, deadline) === sha) return; throw error; }
    },
    async createRelease(tag, sha, name, body, deadline) {
      try { return await mutate('releases', 'POST', { tag_name: tag, target_commitish: sha, name, body, draft: false, prerelease: false }, deadline); }
      catch (error) { const lookup = await this.lookupRelease(tag, deadline);
        if (lookup.observation === 'present' && await this.readTag(tag, deadline) === sha) return lookup.release;
        throw error; }
    },
    updateNotes: (id, body, deadline) => mutate(`releases/${id}`, 'PATCH', { body }, deadline),
    uploadAsset,
    downloadAsset: (asset, deadline) => bytes(`releases/assets/${asset.id}`, { deadline,
      headers: { Accept: 'application/octet-stream' }, maxBytes: 512 * 1024 ** 2 }),
    async replaceStateAsset(releaseID, name, content, deadline) {
      const release = await json(`releases/${releaseID}`, { deadline });
      const snapshotName = `state-${digest(content)}-${name}`;
      // Keep the new authoritative facts intact even if replacing the public
      // latest-state filename fails after the old asset has been deleted.
      if (!await readMatchingAsset(release, snapshotName, content, deadline)) {
        const saved = await uploadAsset(release, snapshotName, content, deadline);
        assert.equal(digest(await this.downloadAsset(saved, deadline)), digest(content));
      }
      if (await readMatchingAsset(release, name, content, deadline).catch(error => {
        if (/differs; refuse clobber/u.test(error.message)) return null; throw error;
      })) return;
      const assets = await pages(`releases/${releaseID}/assets`, null, deadline);
      const matches = assets.filter(asset => asset.name === name); assert(matches.length <= 1, 'Ambiguous state asset');
      if (matches.length) {
        const previous = await this.downloadAsset(matches[0], deadline);
        const previousName = `state-${digest(previous)}-${name}`;
        if (!await readMatchingAsset(release, previousName, previous, deadline)) {
          const snapshot = await uploadAsset(release, previousName, previous, deadline);
          assert.equal(digest(await this.downloadAsset(snapshot, deadline)), digest(previous));
        }
        await bytes(`releases/assets/${matches[0].id}`, { method: 'DELETE', deadline });
      }
      const saved = await uploadAsset(release, name, content, deadline);
      assert.equal(digest(await this.downloadAsset(saved, deadline)), digest(content));
      return saved;
    },
    async deleteTriggerTag(context, completion, deadline) {
      assert.equal(completion.status, 'complete'); assert.equal(completion.releaseSHA, context.releaseSHA);
      assert.equal(await this.readTag(context.finalTag, deadline), context.releaseSHA);
      const trigger = await this.readTag(context.triggerTag, deadline);
      if (trigger === null) return { status: 'passed', trigger: 'already-absent' };
      assert.equal(trigger, context.releaseSHA, 'Trigger tag moved after validation');
      try { await bytes(`git/refs/tags/${context.triggerTag.split('/').map(encodeURIComponent).join('/')}`, { method: 'DELETE', deadline }); }
      catch (error) { if (await this.readTag(context.triggerTag, deadline) !== null) throw error; }
      assert.equal(await this.readTag(context.triggerTag, deadline), null, 'Trigger deletion was not observed');
      return { status: 'passed', trigger: 'deleted' };
    }
  };
}

export async function collectReleaseFacts(context, { client = githubClient({ repository: context.repository }), output,
  deadline = Date.now() + 300000, allowedNames, namesForJobs, allowHistoricalRun = false, allowIncomplete = false } = {}) {
  const run = await client.json(`actions/runs/${context.run.id}`, { deadline });
  assert.equal(run.id, Number(context.run.id));
  if (allowHistoricalRun) assert(run.run_attempt >= context.run.attempt); else assert.equal(run.run_attempt, context.run.attempt);
  assert.equal(run.head_sha, context.run.headSHA);
  const jobs = (await client.pages(`actions/runs/${run.id}/attempts/${context.run.attempt}/jobs`, 'jobs', deadline))
    .map(job => ({ id: job.id, name: job.name.split(' / ').at(-1), status: job.status, conclusion: job.conclusion,
      steps: job.steps?.map(step => ({ name: step.name, status: step.status, conclusion: step.conclusion })) ?? [] }));
  const all = await client.pages(`actions/runs/${run.id}/artifacts`, 'artifacts', deadline);
  const artifacts = [], errors = [];
  for (const name of allowedNames) {
    try {
    const matches = all.filter(artifact => artifact.name === name); assert.equal(matches.length, 1, `Missing/ambiguous ${name}`);
    const artifact = matches[0]; assert.equal(artifact.expired, false);
    assert.equal(artifact.workflow_run?.id, run.id); assert.equal(artifact.workflow_run.head_sha, context.run.headSHA);
    const matchingJobs = jobs.filter(job => job.name === namesForJobs(name)); assert.equal(matchingJobs.length, 1);
    const job = matchingJobs[0]; assert.equal(job.status, 'completed');
    const logs = (await client.bytes(`actions/jobs/${job.id}/logs`, { deadline, maxBytes: 64 * 1024 ** 2 })).toString('utf8');
    assert(new RegExp(`\\bArtifact ID(?::| is)? ${artifact.id}\\b`).test(logs)
      || logs.includes(`/artifacts/${artifact.id}`), 'Artifact ID is not bound to its actual producer log');
    const bytes = await client.bytes(`actions/artifacts/${artifact.id}/zip`, { deadline });
    const directory = path.join(output, name); await fs.mkdir(directory, { recursive: true });
    const inspected = await inspectArtifactArchive(bytes, directory);
    if (artifact.digest) assert.equal(artifact.digest, `sha256:${inspected.archiveHash}`);
    artifacts.push({ id: artifact.id, name, jobID: job.id, archiveHash: digest(bytes),
      receiptDigests: inspected.receiptDigests, runID: String(run.id), attempt: context.run.attempt, headSHA: run.head_sha });
    } catch (error) {
      if (!allowIncomplete) throw error;
      errors.push({ artifact: name, reason: error.message });
    }
  }
  const facts = { schemaVersion: 1, repository: context.repository, runID: String(run.id),
    attempt: context.run.attempt, headSHA: run.head_sha, jobs, artifacts,
    artifactNames: all.map(artifact => artifact.name), errors };
  await writeJSON(path.join(output, 'release-provenance.json'), facts); return facts;
}

export const releaseArtifactJob = name => name.startsWith('prepared-release-') ? releaseJobName('prepare-release')
  : name.startsWith('release-prepare-evidence-') ? releaseJobName('prepare-release')
  : name.startsWith('marketplace-result-open-vsx-') ? releaseJobName('publish-open-vsx')
    : name.startsWith('marketplace-result-visual-studio-') ? releaseJobName('publish-visual-studio')
      : name.startsWith('marketplace-release-') ? releaseJobName('finalize-release')
      : (() => { throw new Error(`Unknown release artifact ${name}`); })();
