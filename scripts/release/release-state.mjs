import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { assertDigest, digest, objectDigest, writeJSON } from '../gates/receipts.mjs';
import { findUniqueFile } from '../gates/check-acceptance.mjs';
import { collectReleaseFacts, releaseArtifactJob } from './release-github.mjs';
import { validateReleaseContext, releaseJobName } from './release-completion.mjs';

export function appendReleaseState(manifest, { phase, parent = null }) {
  assert(['prepare', 'finalize', 'cleanup'].includes(phase));
  const context = validateReleaseContext(manifest.context);
  assert(parent || phase === 'prepare' && context.mode === 'release-tag', 'Release state needs its causal predecessor');
  return { ...manifest, stateChain: { schemaVersion: 1, sequence: parent ? parent.stateChain.sequence + 1 : 0,
    parentDigest: parent ? objectDigest(parent) : null, phase,
    producer: { runID: String(context.run.id), attempt: context.run.attempt, repository: context.repository,
      job: phase === 'prepare' ? 'prepare-release' : 'finalize-release' }, recordedAt: new Date().toISOString() } };
}

export async function saveReleaseState(directory, name, manifest) {
  const canonical = path.join(directory, name);
  await writeJSON(canonical, manifest);
  const bytes = await fs.readFile(canonical);
  const snapshot = path.join(directory, `state-${digest(bytes)}-${name}`);
  await fs.writeFile(snapshot, bytes, { flag: 'wx' });
  return bytes;
}

function validateState(manifest, context, identity) {
  assert.equal(manifest.schemaVersion, 2, 'Release state has no supported schema');
  assert.equal(manifest.releaseRef, context.releaseSHA); assert.equal(manifest.version, context.version);
  assert.equal(manifest.identityDigest, objectDigest(identity));
  const source = validateReleaseContext(manifest.context);
  assert.equal(source.repository, context.repository); assert.equal(source.releaseSHA, context.releaseSHA);
  assert.equal(source.version, context.version); assert.equal(source.finalTag, context.finalTag);
  const chain = manifest.stateChain;
  assert.equal(chain?.schemaVersion, 1, 'Release state has no causal chain');
  assert(Number.isSafeInteger(chain.sequence) && chain.sequence >= 0);
  if (chain.parentDigest !== null) assertDigest(chain.parentDigest, 'parent state');
  assert(['prepare', 'finalize', 'cleanup'].includes(chain.phase));
  assert(Number.isFinite(Date.parse(chain.recordedAt)));
  assert.deepEqual(chain.producer, { runID: String(source.run.id), attempt: source.run.attempt,
    repository: source.repository, job: chain.phase === 'prepare' ? 'prepare-release' : 'finalize-release' });
  assert.equal(manifest.githubRelease?.receipt?.identityDigest, objectDigest(identity));
  return chain;
}

// Canonical may lag an uploaded successor. Only a unique, connected chain with
// independently downloaded producer artifacts can identify the current state.
export async function recoverReleaseState({ context, identity, assets, client, output, deadline,
  collector = collectReleaseFacts }) {
  const name = `release-manifest-${context.version}.json`;
  const snapshots = new RegExp(`^state-([a-f0-9]{64})-${name.replaceAll('.', '\\.')}\u0024`, 'u');
  const candidates = assets.filter(asset => asset.name === name || snapshots.test(asset.name));
  assert(candidates.length > 0, 'Original Release has no recoverable manifest');
  assert(candidates.filter(asset => asset.name === name).length <= 1, 'Ambiguous canonical release state');
  assert.equal(new Set(candidates.map(asset => asset.name)).size, candidates.length, 'Duplicate release state asset');
  const states = new Map(), downloaded = [];
  for (const asset of candidates) {
    assert.equal(asset.state, 'uploaded');
    const bytes = await client.downloadAsset(asset, deadline);
    const rawHash = digest(bytes), match = snapshots.exec(asset.name);
    if (match) assert.equal(match[1], rawHash, 'Release state snapshot filename does not match its bytes');
    const manifest = JSON.parse(bytes.toString('utf8')); validateState(manifest, context, identity);
    const stateDigest = objectDigest(manifest);
    await fs.mkdir(output, { recursive: true });
    await fs.writeFile(path.join(output, asset.name), bytes, { flag: 'wx' });
    downloaded.push({ name: asset.name, assetID: asset.id, sha256: rawHash, stateDigest });
    if (!states.has(stateDigest)) states.set(stateDigest, { manifest, bytes, asset });
  }
  const roots = [...states.values()].filter(state => state.manifest.stateChain.parentDigest === null);
  assert.equal(roots.length, 1, 'Release state chain has missing or ambiguous root');
  assert.equal(roots[0].manifest.stateChain.sequence, 0);
  assert.equal(roots[0].manifest.stateChain.phase, 'prepare');
  assert.equal(roots[0].manifest.context.mode, 'release-tag');
  const children = new Map();
  for (const [stateDigest, state] of states) {
    const chain = state.manifest.stateChain;
    if (chain.parentDigest === null) continue;
    const parent = states.get(chain.parentDigest);
    assert(parent, 'Release state predecessor is missing');
    assert.equal(chain.sequence, parent.manifest.stateChain.sequence + 1, 'Release state sequence is not causal');
    assert(!children.has(chain.parentDigest), 'Release state chain forked; refuse an arbitrary historical result');
    children.set(chain.parentDigest, stateDigest);
    assert.notEqual(chain.phase, 'prepare', 'Release state has a second prepare root');
    if (chain.phase === 'cleanup') {
      assert.equal(parent.manifest.stateChain.phase, 'finalize');
      assert.deepEqual(state.manifest.context, parent.manifest.context);
      assert.deepEqual(state.manifest.releaseCompletion, parent.manifest.releaseCompletion);
      assert.equal(state.manifest.releaseCompletion.status, 'complete');
      assert(['passed', 'failed'].includes(state.manifest.cleanup?.status));
    }
  }
  const visited = [], proof = new Map();
  let selected = roots[0];
  while (selected) {
    const manifest = selected.manifest, stateDigest = objectDigest(manifest);
    assert(!visited.includes(stateDigest), 'Release state chain is cyclic'); visited.push(stateDigest);
    const chain = manifest.stateChain, source = manifest.context;
    const stem = chain.phase === 'prepare' ? 'release-prepare-evidence' : 'marketplace-release';
    const artifactName = `${stem}-${source.run.id}-${source.run.attempt}`;
    let sourceProof = proof.get(artifactName);
    if (!sourceProof) {
      const facts = await collector(source, { client, deadline, output: path.join(output, 'producers', artifactName),
        allowedNames: [artifactName], namesForJobs: releaseArtifactJob, allowHistoricalRun: true });
      assert.equal(facts.repository, context.repository); assert.equal(facts.runID, String(source.run.id));
      assert.equal(facts.attempt, source.run.attempt); assert.equal(facts.headSHA, source.run.headSHA);
      const artifact = facts.artifacts.find(artifact => artifact.name === artifactName);
      const job = facts.jobs.find(job => job.id === artifact?.jobID);
      assert.equal(job?.name, releaseJobName(chain.producer.job)); assert.equal(job.status, 'completed');
      // finalize may fail after persisting these facts. Its failed conclusion
      // never turns failed delivery into success, but does not erase the state.
      assert(['success', 'failure'].includes(job.conclusion), 'Cancelled or unknown state producer');
      sourceProof = { artifact, root: path.join(output, 'producers', artifactName, artifactName) };
      proof.set(artifactName, sourceProof);
    }
    assert(sourceProof.artifact.receiptDigests.includes(stateDigest), 'Release state is absent from its actual producer artifact');
    const snapshotName = `state-${digest(selected.bytes)}-${name}`;
    const actualFile = await findUniqueFile(sourceProof.root, snapshotName);
    assert.deepEqual(await fs.readFile(actualFile), selected.bytes, 'Release state bytes differ from its actual producer');
    if (!children.has(stateDigest)) break;
    selected = states.get(children.get(stateDigest));
  }
  assert.equal(visited.length, states.size, 'Release state chain is disconnected');
  return { manifest: selected.manifest, bytes: selected.bytes, stateDigest: objectDigest(selected.manifest),
    downloaded, chain: visited };
}
