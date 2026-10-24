import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { releaseFixture } from './release-fixture.mjs';
import { writeJSON, objectDigest } from '../gates/receipts.mjs';
import { publishChannel } from '../release/publish-marketplaces.mjs';

const f = await releaseFixture(), root = await fs.mkdtemp(path.join(os.tmpdir(),'dsc-channel-contract-'));
try {
  const prepared=path.join(root,'prepared'); await fs.mkdir(prepared);
  for(const [name,bytes]of Object.entries(f.packageBytes))await fs.writeFile(path.join(prepared,name),bytes);
  for(const [name,value]of Object.entries({ 'package-receipt.json':f.packageReceipt,'gate-plan.json':f.plan,
    'acceptance-receipt.json':f.acceptance,'release-identity.json':f.identity,'validated-channel-history.json':{},
    'prepared-receipt.json':{status:'passed',identityDigest:objectDigest(f.identity),producer:{runID:f.plan.run.id,attempt:f.plan.run.attempt}}}))
    await writeJSON(path.join(prepared,name),value);
  const calls=[];
  const result=await publishChannel({context:f.context,prepared,target:'open-vsx',output:path.join(root,'result'),
    attempts:2,intervalMs:0,client:{query:async(pkg)=>{calls.push(pkg.id);return f.observation(pkg);},
      submit:async()=>{throw new Error('Present verified package must not submit');}}});
  assert.equal(result.complete,true); assert(calls[0].endsWith('-notifier'));
  assert.equal(result.partial.packages.length,2);
  const invalidContext=structuredClone(f.context); invalidContext.releaseSHA='d'.repeat(40);
  await assert.rejects(()=>publishChannel({context:invalidContext,prepared,target:'open-vsx',output:path.join(root,'bad-ref'),
    client:{query:async()=>{throw new Error('Wrong ref must not query');}}}));
  await fs.writeFile(path.join(prepared,'main.vsix'),'stale package');
  let queried=false;
  await assert.rejects(()=>publishChannel({context:f.context,prepared,target:'open-vsx',output:path.join(root,'stale'),
    client:{query:async()=>{queried=true;return f.observation(f.identity.packages[0]);}}}));
  assert.equal(queried,false,'Stale package cannot reach public channels');
  for(const args of [[],['--yes'],['--skip-package'],['--package-only']]) {
    const run=spawnSync(process.execPath,['scripts/release/publish-marketplaces.mjs',...args],{encoding:'utf8',timeout:5000});
    assert.notEqual(run.status,0,'No implicit package lookup/build/publish entry is allowed');
  }
  console.log('publish-marketplaces: accepted original pair, notifier order, wrong ref/hash and implicit packaging rejection passed');
}finally{await fs.rm(root,{recursive:true,force:true});}
