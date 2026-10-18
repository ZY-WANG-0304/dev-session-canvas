import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import { digest, objectDigest, readJSON, writeJSON } from './receipts.mjs';
import { verifyEvidenceManifest } from './evidence.mjs';

export function expectedArtifactProducer(name, plan) {
  const suffix=`-${plan.run.id}-${plan.run.attempt}`;assert(name.endsWith(suffix));
  const transfers={ 'gate-transfer-plan':'Gate resolve (default)', 'gate-transfer-browser':'Gate frontend-build (default)',
    'gate-transfer-source':'Gate source-build (default)', 'gate-transfer-candidate':'Gate package-clean (default)',
    'gate-acceptance':'Gate verify-result (default)' };
  const stem=name.slice(0,-suffix.length);if(transfers[stem])return transfers[stem];
  for(const task of plan.tasks) {
    if(stem===`gate-${task.job}-${task.variant}`||task.job==='native-assets'&&stem===`gate-native-load-${task.variant}`)
      return `Gate ${task.job} (${task.variant})`;
  }
  throw new Error(`Unknown gate artifact: ${name}`);
}
export async function inspectArtifactArchive(bytes, destination) {
  const zip=await JSZip.loadAsync(bytes);const receiptDigests=[];
  for(const [name,entry]of Object.entries(zip.files)) {
    assert(!entry.unsafeOriginalName || entry.unsafeOriginalName === name, 'Sanitized artifact member');
    assert(!name.startsWith('/')&&!name.includes('\\')&&!name.split('/').includes('..'),'Unsafe artifact member');
    assert(!entry.unixPermissions||((entry.unixPermissions>>12)&15)!==10,'Artifact symlinks are forbidden');
    const file=path.join(destination,name);
    if(entry.dir){await fs.mkdir(file,{recursive:true});continue;}
    const content=await entry.async('nodebuffer');await fs.mkdir(path.dirname(file),{recursive:true});
    await fs.writeFile(file,content,{flag:'wx',mode:(entry.unixPermissions??0o644)&0o777});
    if(name.endsWith('.task.json')||/^(?:package|source-build|browser-build|acceptance)-receipt\.json$/.test(path.basename(name))
      || ['release-context.json','release-identity.json','github-delivery.json','channel-partial.json','release-completion.json',
        'prepared-receipt.json','recovery-verification.json'].includes(path.basename(name))
      || /^(?:state-[a-f0-9]{64}-)?release-manifest-\d+\.\d+\.\d+\.json$/u.test(path.basename(name)))
      receiptDigests.push(objectDigest(JSON.parse(content.toString('utf8'))));
  }
  return {archiveHash:digest(bytes),receiptDigests};
}
// Download by actual artifact ID after binding its upload to a completed job.
// Receipts are parsed from these downloaded bytes, not from caller self-reports.
export async function collectGitHubProvenance(plan,{repository=process.env.GITHUB_REPOSITORY,output, scope='all',
  allowHistoricalRun=false,
  api=route=>JSON.parse(execFileSync('gh',['api',route],{encoding:'utf8',maxBuffer:32*1024**2})),
  log=id=>execFileSync('gh',['api',`repos/${repository}/actions/jobs/${id}/logs`],
    {encoding:'utf8',maxBuffer:64*1024**2}),
  download=id=>execFileSync('gh',['api',`repos/${repository}/actions/artifacts/${id}/zip`],
    {maxBuffer:512*1024**2})}={}) {
  assert(repository&&!String(plan.run.id).startsWith('local-'),'GitHub run identity required');assert(output);
  assert(['all','native-load','acceptance','candidate'].includes(scope),'Unknown provenance collection scope');
  const run=await api(`repos/${repository}/actions/runs/${plan.run.id}`);
  assert.equal(run.id,Number(plan.run.id));assert.equal(run.head_sha,plan.run.headSHA);
  if(allowHistoricalRun) assert(run.run_attempt>=plan.run.attempt,'Original run attempt is unavailable');
  else assert.equal(run.run_attempt,plan.run.attempt,'Run attempt changed while collecting results');
  const jobs=[];for(let page=1;;page++){const response=await api(`repos/${repository}/actions/runs/${plan.run.id}/attempts/${plan.run.attempt}/jobs?per_page=100&page=${page}`);
    jobs.push(...response.jobs);if(response.jobs.length<100)break;}
  const artifacts=[];for(let page=1;;page++){const response=await api(`repos/${repository}/actions/runs/${plan.run.id}/artifacts?per_page=100&page=${page}`);
    artifacts.push(...response.artifacts);if(response.artifacts.length<100)break;}
  const normalizedJobs=jobs.map(job=>({id:job.id,name:job.name.split(' / ').at(-1),status:job.status,conclusion:job.conclusion,
    steps:(job.steps??[]).map(step=>({name:step.name,conclusion:step.conclusion,status:step.status}))}));
  const selected=artifacts.filter(item=>item.name.startsWith('gate-')&&item.name.endsWith(`-${plan.run.id}-${plan.run.attempt}`)
    &&(scope==='acceptance'?item.name.startsWith('gate-acceptance-'):scope==='candidate'?item.name.startsWith('gate-transfer-candidate-'):
      !item.name.startsWith('gate-acceptance-')&&(scope==='all'||item.name.startsWith('gate-native-load-'))));
  const normalizedArtifacts=[];const logs=new Map();
  for(const artifact of selected) {
    const jobName=expectedArtifactProducer(artifact.name,plan);const producers=normalizedJobs.filter(job=>job.name===jobName);
    assert.equal(producers.length,1,`Cannot bind ${artifact.name} to an actual job`);const producer=producers[0];
    assert.equal(producer.status,'completed','Artifact producer is still running');
    if(!logs.has(producer.id))logs.set(producer.id,await log(producer.id));const outputLog=logs.get(producer.id);
    assert(new RegExp(`\\bArtifact ID(?::| is)? ${artifact.id}\\b`).test(outputLog)
      ||outputLog.includes(`/artifacts/${artifact.id}`),'Upload output does not bind artifact ID to job');
    assert.equal(artifact.expired,false);assert.equal(artifact.workflow_run?.id,Number(plan.run.id));
    assert.equal(artifact.workflow_run?.head_sha,plan.run.headSHA);
    const bytes=await download(artifact.id);const destination=path.join(output,artifact.name);await fs.mkdir(destination,{recursive:true});
    const inspected=await inspectArtifactArchive(bytes,destination);
    if(artifact.digest)assert.equal(artifact.digest,`sha256:${inspected.archiveHash}`,'Downloaded archive differs from GitHub artifact digest');
    let evidence = null;
    if(!artifact.name.startsWith('gate-transfer-')&&!artifact.name.startsWith('gate-native-load-')
      &&!artifact.name.startsWith('gate-acceptance-')) {
      const task=plan.tasks.find(task=>artifact.name===`gate-${task.job}-${task.variant}-${plan.run.id}-${plan.run.attempt}`);
      assert(task,'Unknown result producer');
      evidence=await verifyEvidenceManifest(destination,{identity:{inputSHA:plan.inputSHA,job:task.job,variant:task.variant,
        runID:String(plan.run.id),attempt:plan.run.attempt}});
    }
    normalizedArtifacts.push({id:artifact.id,name:artifact.name,expired:artifact.expired,runID:String(artifact.workflow_run.id),
      attempt:plan.run.attempt,headSHA:artifact.workflow_run.head_sha,jobID:producer.id,...inspected,
      ...(evidence?{evidenceDigest:objectDigest(evidence)}:{})});
  }
  return {schemaVersion:1,scope,repository,runID:String(run.id),attempt:plan.run.attempt,headSHA:run.head_sha,
    jobs:normalizedJobs,artifacts:normalizedArtifacts};
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===path.resolve(process.argv[1])) {
  const {values}=parseArgs({options:{plan:{type:'string'},output:{type:'string'},download:{type:'string'},scope:{type:'string'}}});
  assert(values.plan&&values.output&&values.download);
  await writeJSON(values.output,await collectGitHubProvenance(await readJSON(values.plan),{output:values.download,scope:values.scope}));
}
