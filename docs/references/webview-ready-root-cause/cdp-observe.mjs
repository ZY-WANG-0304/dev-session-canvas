import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
const output = process.argv[2];
const port = Number(process.argv[3] ?? 38991);
await mkdir(output, { recursive: true });
const log = entry => { writes = writes.then(() => appendFile(path.join(output, 'cdp.jsonl'), JSON.stringify({ observedAt: Date.now(), ...entry }) + '\n')); };
let writes = Promise.resolve(), stopping = false, sockets = new Set();
process.on('SIGTERM', () => { stopping = true; for (const socket of sockets) socket.close(); });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let generation = 0;
while (!stopping) {
  let version;
  try { version = await (await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(500) })).json(); }
  catch { await sleep(100); continue; }
  const run = ++generation;
  log({ type: 'browser-connect', run, browser: version.Browser });
  const socket = new WebSocket(version.webSocketDebuggerUrl);
  sockets.add(socket);
  let id = 0, closed = false;
  const pending = new Map(), sessions = new Map(), enabledSessions = new Set(), contexts = new Map(), attachedTargets = new Set();
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const requestId = ++id;
    const timer = setTimeout(() => { pending.delete(requestId); reject(new Error(`CDP timed out: ${method}`)); }, 3000);
    pending.set(requestId, { resolve, reject, timer });
    socket.send(JSON.stringify({ id: requestId, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
  async function enable(sessionId, info) {
    if (enabledSessions.has(sessionId)) return;
    enabledSessions.add(sessionId); sessions.set(sessionId, info);
    log({ type: 'attached', run, sessionId, info });
    await Promise.allSettled([send('Runtime.enable', {}, sessionId), send('Network.enable', {}, sessionId),
      send('Page.enable', {}, sessionId), send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }, sessionId)]);
  }
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.id) {
      const item = pending.get(message.id); if (!item) return;
      clearTimeout(item.timer); pending.delete(message.id);
      if (message.error) item.reject(new Error(message.error.message)); else item.resolve(message.result);
      return;
    }
    const p = message.params;
    if (message.method === 'Target.attachedToTarget') { void enable(p.sessionId, p.targetInfo).catch(error => log({type:'enable-error', run, error:String(error)})); return; }
    if (message.method === 'Target.detachedFromTarget') {
      sessions.delete(p.sessionId); enabledSessions.delete(p.sessionId); contexts.delete(p.sessionId); log({ type: 'detached', run, ...p }); return;
    }
    if (message.method === 'Target.targetCreated' && p.targetInfo.type === 'service_worker' && !attachedTargets.has(p.targetInfo.targetId)) {
      attachedTargets.add(p.targetInfo.targetId);
      void send('Target.attachToTarget',{targetId:p.targetInfo.targetId,flatten:true}).catch(error=>log({type:'worker-attach-error',run,error:String(error)}));
      return;
    }
    const target = sessions.get(message.sessionId);
    const method = message.method;
    if (method === 'Network.requestWillBeSent') {
      if (/vscode-webview|webview\.js|webview\.css/.test(p.request.url))
        log({ run, sessionId: message.sessionId, method, frameId: p.frameId, requestId: p.requestId,
          timestamp: p.timestamp, url: p.request.url, resourceType: p.type, initiator: p.initiator.type });
    } else if (method === 'Network.responseReceived') {
      if (/vscode-webview|webview\.js|webview\.css/.test(p.response.url))
        log({ run, sessionId: message.sessionId, method, requestId: p.requestId, timestamp: p.timestamp,
          url: p.response.url, status: p.response.status, resourceType: p.type,
          fromDiskCache: p.response.fromDiskCache, fromServiceWorker: p.response.fromServiceWorker });
    } else if (method === 'Network.loadingFinished' || method === 'Network.loadingFailed' || method === 'Runtime.exceptionThrown' || method === 'Inspector.targetCrashed') {
      log({ run, sessionId: message.sessionId, method, params: p });
    } else if (method === 'Runtime.consoleAPICalled') {
      const values = p.args.map(arg => arg.value ?? arg.description);
      if (p.type === 'error' || p.type === 'warning' || values.some(v => typeof v === 'string' && (v.includes('[ready-frame]') || v.includes('[ready-worker]'))))
        log({ run, sessionId: message.sessionId, method, executionContextId: p.executionContextId, timestamp: p.timestamp, values });
    } else if (method === 'Runtime.executionContextCreated') {
      log({ run, sessionId: message.sessionId, method, context: p.context });
      if((p.context.auxData?.isDefault || target?.type === 'service_worker') && /vscode-webview|vscode-resource/.test(p.context.origin)) {
        if(!contexts.has(message.sessionId)) contexts.set(message.sessionId,new Map());
        contexts.get(message.sessionId).set(p.context.id,p.context.origin);
      }
    } else if (method === 'Runtime.executionContextDestroyed') {
      contexts.get(message.sessionId)?.delete(p.executionContextId);
    } else if (method === 'Runtime.executionContextsCleared') {
      contexts.delete(message.sessionId);
    } else if (method === 'Page.frameNavigated' || method === 'Page.frameDetached') {
      log({ run, sessionId: message.sessionId, method, params: p });
    }
  });
  socket.addEventListener('close', () => { closed = true; sockets.delete(socket); for (const item of pending.values()) { clearTimeout(item.timer); item.reject(new Error('CDP disconnected')); } pending.clear(); });
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); }).catch(() => { closed = true; });
  if (!closed) {
    await send('Target.setDiscoverTargets', { discover: true }).catch(() => {});
    await send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }).catch(() => {});
    while (!closed && !stopping) {
      await sleep(500);
      for(const [sessionId, items] of contexts) {
        for(const [contextId, origin] of items) {
          void send('Runtime.evaluate', {contextId, returnByValue:true, awaitPromise:true, expression:sessions.get(sessionId)?.type === 'service_worker' ? `({time:Date.now(),url:location.href,activeCount:globalThis.__DSC_SW_DIAG__?.semaphore.activeCount,waiters:globalThis.__DSC_SW_DIAG__?.semaphore.waiters.length,requestCount:globalThis.__DSC_SW_DIAG__?.requests.map.size,requestIds:globalThis.__DSC_SW_DIAG__?Array.from(globalThis.__DSC_SW_DIAG__.requests.map.keys()):[],marks:performance.getEntriesByType('mark').map(x=>({name:x.name,startTime:x.startTime,detail:x.detail}))})` : `(async () => ({time:Date.now(),url:location.href,readyState:document.readyState,marks:performance.getEntriesByType('mark').filter(x=>x.name.startsWith('webview/')).map(x=>({name:x.name,startTime:x.startTime,detail:x.detail})),workerController:navigator.serviceWorker?.controller?.scriptURL,registrations:navigator.serviceWorker?Array.from(await navigator.serviceWorker.getRegistrations(),r=>({scope:r.scope,installing:r.installing?.state,waiting:r.waiting?.state,active:r.active?.state})):[],frames:Array.from(document.querySelectorAll('iframe'),f=>({id:f.id,src:f.src,connected:f.isConnected,readyState:f.contentDocument?.readyState,html:f.contentDocument?.documentElement?.outerHTML?.slice(0,350),stages:f.contentWindow?.__DSC_READY_STAGES__})),stages:window.__DSC_READY_STAGES__,appChildren:document.getElementById('app')?.childElementCount,scripts:Array.from(document.scripts,x=>({src:x.src,type:x.type}))}))()`},sessionId)
          .then(result=>log({type:'snapshot',run,sessionId,contextId,origin,result:result.result?.value,exception:result.exceptionDetails}))
          .catch(()=>{});
        }
      }
    }
  }
  log({ type: 'browser-disconnect', run });
}
await writes;
