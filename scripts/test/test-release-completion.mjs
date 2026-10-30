import assert from 'node:assert/strict';
import { test } from 'node:test';
import http from 'node:http';
import JSZip from 'jszip';
import { releaseFixture } from './release-fixture.mjs';
import { compareRemotePackage, calculateReleaseCompletion, deliverPackage, deliveryIsComplete, validatePackageDelivery } from '../release/release-completion.mjs';
import { openVsxClient } from '../release/channel-client.mjs';
import { objectDigest } from '../gates/receipts.mjs';

test('remote content binds actual VSIX bytes, extension and member payload', async () => {
  const f = await releaseFixture(); const pkg = f.identity.packages[0];
  assert.equal((await compareRemotePackage(f.packageBytes[pkg.path], pkg)).content, 'match');
  const zip = await JSZip.loadAsync(f.packageBytes[pkg.path]);
  zip.file('extension/dist/extension.js', 'different product');
  assert.equal((await compareRemotePackage(await zip.generateAsync({ type: 'nodebuffer' }), pkg)).content, 'mismatch');
  const same = await JSZip.loadAsync(f.packageBytes[pkg.path]);
  assert.equal((await compareRemotePackage(await same.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }), pkg)).content, 'unknown');
});
test('unknown version observations never submit; submission timeout queries without a second write', async () => {
  const f = await releaseFixture(), pkg = f.identity.packages[0]; let submits = 0, queries = 0;
  const unknown = () => ({ observation: 'unknown', content: 'unknown', observedAt: new Date().toISOString(), remote: null });
  const absent = () => ({ observation: 'absent', content: 'unknown', observedAt: new Date().toISOString(), remote: null });
  const submit = async () => { submits++; return { submission: 'unknown' }; };
  const missing = await deliverPackage({ pkg, query: async () => unknown(), submit, deadline: Date.now()+1000, attempts: 3, intervalMs: 0 });
  assert.equal(submits, 0); assert(!deliveryIsComplete(missing));
  const timed = await deliverPackage({ pkg, query: async () => { queries++; return queries === 1 ? absent() : unknown(); },
    submit, deadline: Date.now()+1000, attempts: 4, intervalMs: 0 });
  assert.equal(submits, 1); assert.equal(queries, 4); assert.equal(timed.submission, 'unknown'); assert(!deliveryIsComplete(timed));
});
test('selected fresh failure cannot be replaced by a historical success', async () => {
  const f = await releaseFixture(), pkg = f.identity.packages[0], previous = f.delivery(pkg);
  const query = async () => ({ observation: 'unknown', content: 'unknown', observedAt: new Date().toISOString(), remote: null });
  const fresh = await deliverPackage({ pkg, query, submit: async () => { throw new Error('must not submit'); },
    selected: true, previous, deadline: Date.now()+1000, attempts: 1, intervalMs: 0 });
  assert.equal(fresh.evidenceUse, 'fresh'); assert(!deliveryIsComplete(fresh, true));
  const reused = await deliverPackage({ pkg, query, selected: false, previous, deadline: Date.now()+1000, attempts: 1 });
  validatePackageDelivery(reused, pkg); assert.equal(reused.content, 'unknown'); assert.equal(reused.evidenceUse, 'reused');
  assert(deliveryIsComplete(reused, true)); assert(!deliveryIsComplete(reused, false));
  const mismatch = await deliverPackage({ pkg, selected: false, previous, deadline: Date.now()+1000, attempts: 1,
    query: async () => ({ observation: 'present', content: 'mismatch', observedAt: new Date().toISOString(), remote: null }) });
  assert(!deliveryIsComplete(mismatch, true));
});
test('Open VSX actual HTTP fixture checks bytes and never republishes an uncertain submission', async () => {
  const f = await releaseFixture(), pkg = f.identity.packages[0]; let mode = 'unknown', submissions = 0, published = false, received;
  const server = http.createServer(async (req,res) => {
    if (req.method === 'POST') {
      submissions++; const chunks=[]; for await (const chunk of req) chunks.push(chunk); received = Buffer.concat(chunks);
      published = true; res.writeHead(503); res.end('submission response lost'); return;
    }
    if (req.url === '/download') { res.writeHead(200); res.end(f.packageBytes[pkg.path]); return; }
    if (mode === 'unknown') { res.writeHead(503); res.end(); return; }
    if (!published) { res.writeHead(404); res.end(); return; }
    res.setHeader('Content-Type','application/json'); res.end(JSON.stringify({ namespace: 'devsessioncanvas',
      name: 'dev-session-canvas', version: f.context.version, files: { download: '/download' } }));
  });
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  try {
    const client = openVsxClient({ baseURL: `http://127.0.0.1:${server.address().port}`, token: 'fixture-token' });
    const unknown = await deliverPackage({ pkg, query: (p,d) => client.query(p,d),
      submit: (p,d) => client.submit(p,d, '/does-not-exist'), deadline: Date.now()+2000, attempts: 2, intervalMs: 0 });
    assert.equal(submissions,0); assert.equal(unknown.content,'unknown');
    mode = 'absent';
    const clientWithBytes = openVsxClient({ baseURL: `http://127.0.0.1:${server.address().port}`, token: 'fixture-token',
      request: async (url,options) => { const { requestBytes } = await import('../release/channel-client.mjs');
        return requestBytes(url, { ...options, body: options.method === 'POST' ? f.packageBytes[pkg.path] : options.body }); } });
    const delivered = await deliverPackage({ pkg, query: (p,d) => clientWithBytes.query(p,d),
      submit: async (_p,d) => {
        const { requestBytes } = await import('../release/channel-client.mjs');
        try { await requestBytes(`http://127.0.0.1:${server.address().port}/api/-/publish`, { deadline:d, method:'POST',body:f.packageBytes[pkg.path] }); }
        catch { return { submission:'unknown' }; }
      }, deadline:Date.now()+2000, attempts:3, intervalMs:0 });
    assert.equal(submissions,1); assert.deepEqual(received,f.packageBytes[pkg.path]); assert(deliveryIsComplete(delivered));
    assert.equal(delivered.submission,'unknown'); assert.equal(delivered.content,'match');
  } finally { await new Promise(resolve => server.close(resolve)); }
});
function completionFixture(f) {
  const producer = { runID:f.context.run.id,attempt:f.context.run.attempt,repository:f.context.repository,job:'prepare-release' };
  const completedAt = new Date().toISOString();
  const github = { schemaVersion:1,identityDigest:objectDigest(f.identity),producer,releaseID:42,
    releaseSHA:f.context.releaseSHA,version:f.context.version,completedAt,packages:f.identity.packages.map((pkg,i)=>({
    extensionID:pkg.id,sourcePackageHash:pkg.sha256,remotePackageHash:pkg.sha256,observation:'present',content:'match',assetID:i+10,verifiedAt:completedAt})) };
  const partials=['open-vsx','visual-studio'].map(f.partial);
  const jobs=['prepare-release','publish-open-vsx','publish-visual-studio'].map((name,i)=>({id:i+1,name:`Release ${name}`,status:'completed',conclusion:'success',steps:[]}));
  const artifacts=[{name:`prepared-release-${f.context.run.id}-${f.context.run.attempt}`,jobID:1,receiptDigests:[objectDigest(github)]},
    ...partials.map((partial,i)=>({name:`marketplace-result-${partial.target}-${f.context.run.id}-${f.context.run.attempt}`,jobID:i+2,receiptDigests:[objectDigest(partial)]}))];
  artifacts.forEach((artifact,i)=>Object.assign(artifact,{id:i+100,runID:f.context.run.id,attempt:f.context.run.attempt,
    headSHA:f.context.run.headSHA,archiveHash:'c'.repeat(64)}));
  return { context:f.context,identity:f.identity,github,partials,facts:{schemaVersion:1,repository:f.context.repository,
    runID:f.context.run.id,attempt:f.context.run.attempt,headSHA:f.context.run.headSHA,jobs,artifacts} };
}
test('completion refuses wrong partial provenance and original-byte substitutions', async () => {
  const f=await releaseFixture();const complete=completionFixture(f);
  assert.equal(calculateReleaseCompletion(complete).status,'complete');
  for(const mutate of [v=>{v.partials[1].releaseSHA='d'.repeat(40);},v=>{v.partials[0].producer.attempt=1;},
    v=>{v.facts.artifacts[1].jobID=3;},v=>{v.facts.jobs[1].conclusion='cancelled';},
    v=>{v.github.packages[0].remotePackageHash='c'.repeat(64);},v=>{v.partials.push(v.partials[0]);},
    v=>{v.facts.headSHA='d'.repeat(40);},v=>{v.facts.attempt=1;},v=>{v.facts.artifacts[1].runID='54321';},
    v=>{v.github.releaseSHA='d'.repeat(40);},v=>{v.partials[0].packages[0].remote.payloadHash='d'.repeat(64);}]) {
    const value=structuredClone(complete);mutate(value);assert.throws(()=>calculateReleaseCompletion(value));
  }
});
test('incomplete-release recovery completion stays bound to the existing Release ID', async () => {
  const f = await releaseFixture(), complete = completionFixture(f);
  complete.context = { ...complete.context, mode: 'incomplete-release-recovery', existingReleaseID: 42,
    recoverySourceRun: { id: '54321', attempt: 1, headSHA: complete.context.releaseSHA } };
  assert.equal(calculateReleaseCompletion(complete).status, 'complete');
  const wrong = structuredClone(complete); wrong.github.releaseID = 43;
  assert.throws(() => calculateReleaseCompletion(wrong), /releaseID|equal/u);
});
test('missing optional partial is structural failure; valid deferred gallery does not replace required success', async () => {
  const f=await releaseFixture();const complete=completionFixture(f);
  const gallery=complete.partials[1];
  for(const entry of gallery.packages) {
    const unknown={observation:'unknown',content:'unknown',remote:null,observedAt:new Date().toISOString()};
    Object.assign(entry,{observation:'unknown',content:'unknown',remote:null,observations:[unknown],verifiedAt:null});
  }
  gallery.completedAt=new Date().toISOString();
  complete.facts.artifacts[2].receiptDigests=[objectDigest(gallery)];
  assert.equal(calculateReleaseCompletion(complete).status,'complete');
  complete.partials.pop();assert.equal(calculateReleaseCompletion(complete).status,'failed');
});

test('final submission query failure remains unknown with one write and a complete receipt', async () => {
  const f=await releaseFixture(),pkg=f.identity.packages[0];let queries=0,submits=0;
  const receipt=await deliverPackage({pkg,deadline:Date.now()+1000,attempts:1,intervalMs:0,
    query:async()=>{queries++;if(queries===1)return {observation:'absent',content:'unknown',remote:null,observedAt:new Date().toISOString()};
      throw new Error('lost final response');},
    submit:async()=>{submits++;return {submission:'unknown'};}});
  assert.equal(submits,1);assert.equal(queries,2);assert.equal(receipt.content,'unknown');
  assert.equal(receipt.submission,'unknown');assert.equal(receipt.observations.length,2);
  validatePackageDelivery(receipt,pkg);assert(!deliveryIsComplete(receipt));
});
