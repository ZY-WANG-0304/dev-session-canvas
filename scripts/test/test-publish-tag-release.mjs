import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { releaseFixture } from './release-fixture.mjs';
import { digest, writeJSON } from '../gates/receipts.mjs';
import { prepareRelease } from '../release/release-delivery.mjs';

const f=await releaseFixture(),root=await fs.mkdtemp(path.join(os.tmpdir(),'dsc-release-prepare-'));
try{
  const input=path.join(root,'input');await fs.mkdir(input);
  for(const [name,bytes]of Object.entries(f.packageBytes))await fs.writeFile(path.join(input,name),bytes);
  for(const [name,value]of Object.entries({'package-receipt.json':f.packageReceipt,'gate-plan.json':f.plan,
    'gate-result.json':f.result,'gate-provenance.json':f.provenance,'acceptance-receipt.json':f.acceptance}))await writeJSON(path.join(input,name),value);
  let tag=null,release=null;const remote=new Map(),calls=[];
  const client={repository:'test/repo',readTag:async()=>tag,
    createTag:async(_tag,sha)=>{calls.push('tag');tag=sha;},lookupRelease:async()=>({observation:release?'present':'absent',release}),
    createRelease:async()=>{calls.push('release');release={id:1};},pages:async()=>[...remote.values()].map(entry=>entry.asset),
    uploadAsset:async(_release,name,bytes)=>{calls.push(`upload:${name}`);const asset={id:remote.size+1,name};remote.set(name,{asset,bytes});return asset;},
    downloadAsset:async asset=>remote.get(asset.name).bytes,
    replaceStateAsset:async (_release,name,bytes)=>{
      calls.push(`upload:${name}`);const asset={id:remote.size+1,name};remote.set(name,{asset,bytes});return asset;
    }};
  const prepared=await prepareRelease({context:f.context,input,output:path.join(root,'prepared'),client});
  assert.equal(prepared.github.packages.length,2);
  assert.deepEqual(remote.get('main.vsix').bytes,f.packageBytes['main.vsix']);
  const pending=JSON.parse(remote.get('release-manifest-1.2.3.json').bytes.toString());
  assert.equal(pending.status,'pending');assert.equal(pending.tags.triggerTagStatus,'kept');
  assert.equal(pending.marketplaces.openVsx.main.content,'unknown');
  const uploads=calls.filter(call=>call.startsWith('upload:')).length;
  await assert.rejects(()=>prepareRelease({context:f.context,input,output:path.join(root,'again'),client}), /verified channel-retry/);
  assert.equal(calls.filter(call=>call.startsWith('upload:')).length,uploads,'A new prepare root must not overwrite accepted original state');
  remote.get('main.vsix').bytes=Buffer.from('different remote bytes');
  await assert.rejects(()=>prepareRelease({context:f.context,input,output:path.join(root,'conflict'),client}),/differs/);
  assert.equal(calls.filter(call=>call.startsWith('upload:')).length,uploads);
  const beforeCalls=calls.length;
  const bad=structuredClone(f.acceptance);bad.inputSHA='d'.repeat(40);await writeJSON(path.join(input,'acceptance-receipt.json'),bad);
  await assert.rejects(()=>prepareRelease({context:f.context,input,output:path.join(root,'unaccepted'),client}));
  assert.equal(calls.length,beforeCalls,'Wrong acceptance must fail before external mutation');
  for(const args of [[],['--package-only'],['--skip-package'],['--dry-run','--trigger-tag','publish/v1.2.3']]){
    const result=spawnSync(process.execPath,['scripts/release/publish-tag-release.mjs',...args],{encoding:'utf8',timeout:5000});
    assert.notEqual(result.status,0,'Delivery cannot silently build or trust old unverified manifests');
  }
  console.log('publish-tag-release: accepted original-byte upload/download, idempotence, conflict and input rejection passed');
}finally{await fs.rm(root,{recursive:true,force:true});}
