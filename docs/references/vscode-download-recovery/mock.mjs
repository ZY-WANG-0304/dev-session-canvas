import fs from 'node:fs';
import {spawn} from 'node:child_process';
export async function downloadAndUnzipVSCode() {
 const file=process.env.DSC_PROBE_COUNT;
 let count=0;try{count=Number(fs.readFileSync(file,'utf8'));}catch{}
 fs.writeFileSync(file,String(++count));
 const mode=process.env.DSC_PROBE_MODE;
 if(mode==='recover' && count>1)return '/fixture/code';
 if(mode==='semantic')throw new Error('Checksum mismatch');
 if(mode==='unrecorded')process.exit(7);
 const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});
 fs.appendFileSync(file+'.children',child.pid+'\n');
 Promise.reject(Object.assign(new Error('controlled reset'),{code:'ECONNRESET'}));
 await new Promise(()=>{});
}
