import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const method=process.env.PROBE_METHOD,file=process.env.PROBE_FILE;
const base='https://nodejs.org/dist/v16.17.1',url=base+'/'+file;
const report={acceptance:false,scope:'Public supplier GET diagnostic; no product execution',method,url,node:process.version,platform:process.platform,arch:process.arch,bytes:0};
const started=Date.now(),temporary=path.join(os.tmpdir(),'dsc-supplier-compare.bin');
let timer;
try {
 const sums=await fetch(base+'/SHASUMS256.txt',{signal:AbortSignal.timeout(30000)});
 if(!sums.ok)throw new Error('Checksum HTTP '+sums.status);
 const match=(await sums.text()).split(/\r?\n/).map(line=>/^([a-f0-9]{64})\s+\*?(.+)$/i.exec(line)).find(match=>match?.[2]===file);
 if(!match)throw new Error('No exact supplier checksum');report.expectedSha256=match[1];
 const begin=Date.now();let bytes;
 if(method==='curl') {
  try{const value=await promisify(execFile)('curl',['--location','--fail','--silent','--show-error','--max-time','120','--output',temporary,'--write-out','{"status":%{http_code},"bytes":%{size_download},"seconds":%{time_total}}',url],{timeout:125000,maxBuffer:1024*1024});report.curl=JSON.parse(value.stdout);}
  catch(error){report.curlOutput=error.stdout;throw error;}
  bytes=await fs.readFile(temporary);report.bytes=bytes.length;
 }else{
  const response=await fetch(url,{signal:AbortSignal.timeout(120000)});report.status=response.status;
  report.headers=Object.fromEntries([...response.headers].filter(([key])=>['content-length','content-encoding','transfer-encoding','etag','cf-cache-status','accept-ranges'].includes(key)));
  console.log(JSON.stringify({method,status:report.status,headers:report.headers}));
  if(!response.ok)throw new Error('Payload HTTP '+response.status);
  timer=setInterval(()=>console.log(JSON.stringify({method,bytes:report.bytes,elapsedMs:Date.now()-begin,lastProgressMs:report.lastProgressMs})),15000);
  if(method==='node-buffer'){bytes=Buffer.from(await response.arrayBuffer());report.bytes=bytes.length;}
  else{const chunks=[];for await(const chunk of response.body){chunks.push(chunk);report.bytes+=chunk.length;report.lastProgressMs=Date.now()-begin;}bytes=Buffer.concat(chunks);}
 }
 report.sha256=createHash('sha256').update(bytes).digest('hex');report.passed=report.sha256===report.expectedSha256;
 if(!report.passed)throw new Error('Supplier hash mismatch');
}catch(error){report.passed=false;report.error={name:error.name,message:error.message,code:error.cause?.code??error.code};process.exitCode=1;}
finally{clearInterval(timer);report.elapsedMs=Date.now()-started;await fs.writeFile('supplier-probe.json',JSON.stringify(report,null,2));await fs.rm(temporary,{force:true});console.log(JSON.stringify(report));}
