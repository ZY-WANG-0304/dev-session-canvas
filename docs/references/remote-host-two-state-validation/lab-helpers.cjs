const fs = require('node:fs/promises');
const path = require('node:path');
const net = require('node:net');
const { createHash } = require('node:crypto');
const assert = require('node:assert/strict');
async function processIdentity(pid) {
  try {
    const text = await fs.readFile(`/proc/${pid}/stat`, 'utf8');
    const fields = text.slice(text.lastIndexOf(')') + 2).trim().split(/\s+/);
    return {pid, state:fields[0], ppid:Number(fields[1]), startTicks:fields[19]};
  } catch (e) { if (['ENOENT','ESRCH'].includes(e.code)) return; throw e; }
}
async function sameLiveProcess(expected) {
  const actual = await processIdentity(expected.pid);
  assert(actual && actual.startTicks === expected.startTicks && !['Z','X'].includes(actual.state), `Original process is no longer live: ${JSON.stringify({expected,actual})}`);
  return actual;
}
async function hostCondition(expected, scenario) {
  const actual = await processIdentity(expected.pid);
  if (scenario === 'retain') return sameLiveProcess(expected);
  assert(!actual || actual.startTicks !== expected.startTicks, `Original Host still exists: ${JSON.stringify(actual)}`);
  return {pid:expected.pid, state:'original-absent'};
}
function runtimePaths(storageDir) {
  const resolved = path.join(storageDir,'runtime-supervisor');
  const digest = createHash('sha1').update(path.resolve(resolved)).digest('hex').slice(0,24);
  return {socketPath:path.join('/tmp',`dsc-root-${process.getuid()}`,`d-${digest}.sock`), registryPath:path.join(resolved,'registry.json')};
}
async function request(storageDir,method,params,timeoutMs=5000) {
  const socket = net.createConnection(runtimePaths(storageDir).socketPath);
  const id = `lab-${Date.now()}-${Math.random()}`;
  return new Promise((resolve,reject) => {
    let buffer=''; let done=false;
    const end=(error,value)=>{if(done)return;done=true;socket.destroy();error?reject(error):resolve(value)};
    socket.setTimeout(timeoutMs,()=>end(new Error(`Supervisor ${method} timeout`)));
    socket.on('error',e=>end(e));
    socket.on('connect',()=>socket.write(JSON.stringify({type:'request',id,method,params})+'\n'));
    socket.on('data',chunk=>{
      buffer+=chunk.toString();let newline;
      while((newline=buffer.indexOf('\n'))>=0){
        const line=buffer.slice(0,newline);buffer=buffer.slice(newline+1);
        const message=JSON.parse(line);
        if(message.type==='response'&&message.id===id)end(message.ok?null:new Error(message.error?.message||'Supervisor rejected'),message.result);
      }
    });
    socket.on('close',()=>{if(!done)end(new Error(`Supervisor closed before ${method} response`))});
  });
}
const shellQuote = value => "'"+String(value).replaceAll("'", "'\\''")+"'";
module.exports={processIdentity,sameLiveProcess,hostCondition,runtimePaths,request,shellQuote};
