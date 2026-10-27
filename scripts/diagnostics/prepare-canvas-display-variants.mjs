import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
const exec=promisify(execFile),repo=process.cwd();
const output=path.resolve(process.argv[2]??'.debug/canvas-display-variants');
const baseline=process.argv[3]??'0b68468245bf4d065063e131a4006f3a3d778db5';
const executionAssets=await fs.realpath(process.env.DEV_SESSION_CANVAS_EXECUTION_ASSETS_SET??path.join(repo,'generated/execution-assets'));
await fs.mkdir(output); // Refuse to overwrite a prior evidence set.
const checkout=path.join(output,'baseline-checkout');let created=false;
const run=async(cmd,args,cwd=repo)=>{const result=await exec(cmd,args,{cwd,maxBuffer:16*1024**2});process.stdout.write(result.stdout);};
try {
  await run('git',['worktree','add','--detach',checkout,baseline]);created=true;
  await fs.symlink(path.join(repo,'node_modules'),path.join(checkout,'node_modules'),'dir');
  await run(process.execPath,['scripts/build/build.mjs','--execution-assets-set',executionAssets],checkout);
  await run(process.execPath,['scripts/shared/prepare-debug-main-only-extension.mjs'],checkout);
  await fs.cp(path.join(checkout,'.debug/vscode-extension-main-only'),path.join(output,'full'),{recursive:true});
} finally {if(created)await run('git',['worktree','remove','--force',checkout]);}
await run(process.execPath,['scripts/build/build.mjs','--execution-assets-set',executionAssets]);
await run(process.execPath,['scripts/shared/prepare-debug-main-only-extension.mjs']);
for(const mode of ['skip','delta','paired'])await fs.cp('.debug/vscode-extension-main-only',path.join(output,mode),{recursive:true});
const host=path.join(output,'skip/dist/extension.js'),source=await fs.readFile(host,'utf8');
const from='return delta ? { type: "host/stateDelta", payload: delta } : { type: "host/stateUpdated", payload: next };';
if(source.split(from).length!==2)throw Error('Expected exactly one publisher return; inspect before changing diagnostic overlay');
await fs.writeFile(host,source.replace(from,'return { type: "host/stateUpdated", payload: next };'));
await fs.writeFile(path.join(output,'paired/dist/extension.js'),source.replace(from,'return delta && globalThis.__dscCanvasDisplayMode !== "skip" ? { type: "host/stateDelta", payload: delta } : { type: "host/stateUpdated", payload: next };'));
const hashes={};for(const mode of ['full','skip','delta','paired']){hashes[mode]={};for(const file of ['extension.js','webview.js'])hashes[mode][file]=createHash('sha256').update(await fs.readFile(path.join(output,mode,'dist',file))).digest('hex');}
await fs.writeFile(path.join(output,'inputs.json'),JSON.stringify({baseline,executionAssets,candidateHead:(await exec('git',['rev-parse','HEAD'])).stdout.trim(),candidateDiffSha256:createHash('sha256').update((await exec('git',['diff','HEAD'],{maxBuffer:16*1024**2})).stdout).digest('hex'),hashes},null,2));
console.log('Frozen variants:',output);
