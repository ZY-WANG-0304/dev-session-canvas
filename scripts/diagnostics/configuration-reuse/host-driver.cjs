// Loaded only into a copied diagnostic artifact, never the shipped extension.
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
exports.start = function(manager, vscode, context, views) {
  const sidebar = views ? require('./sidebar-driver.cjs').instrument(manager, vscode, views) : undefined;
  const config = require('./configuration-reuse-driver.json');
  let stateLoad;
  const server = http.createServer(async (request, response) => {
    response.setHeader('content-type', 'application/json');
    if (request.headers.authorization !== config.token) { response.writeHead(403).end('{}'); return; }
    try {
      let body = ''; for await (const chunk of request) { body += chunk; if (body.length > 65536) throw Error('request too large'); }
      const { action, args = {} } = JSON.parse(body);
      let result;
      if (action.startsWith('sidebar-') && sidebar) result = await sidebar(action,args);
      else if (action === 'initialize') {
        await vscode.workspace.getConfiguration().update('devSessionCanvas.agent.codexCommand',config.fixture,vscode.ConfigurationTarget.Global);
        const command=manager.getRuntimeContext().agentLaunchDefaults.codex.command;
        if(command!==config.fixture)throw Error('Machine-scoped CLI fixture configuration was not applied in this Host');
        result={machineCommandVerified:true};
      } else if (action === 'status') result = { pid: process.pid, version: vscode.version, versions: process.versions,
        remoteName: vscode.env.remoteName, mode: context.extensionMode, runtime: manager.getRuntimeContext(),
        state: manager.state, sidebar: manager.getSidebarState() };
      else if (action === 'diagnostics') result = manager.testDiagnosticEvents;
      else if (action === 'open') { await manager.revealInEditor(); result = true; }
      else if (action === 'create') {
        const node = manager.applyCreateNode('agent', { x: args.index * 560 + 30, y: 30 }, {
          agentProvider: 'codex', cwdOverride: path.join(config.workspace, `node${args.index}`),
          titleOverride: `Probe ${args.index}` });
        result = node?.id;
      } else if (action === 'state-load') {
        clearInterval(stateLoad); stateLoad = args.enabled ? setInterval(() => manager.postState('host/stateUpdated', {reason:'other'}), args.hz === 20 ? 50 : 100) : undefined; result = true;
      } else if (action === 'start-trace') { manager.startExecutionFlowTrace(); result = true; }
      else if (action === 'trace') result = await manager.collectExecutionFlowTrace();
      else if (action === 'reset') { await manager.resetState(); result = true; }
      else if (action === 'benchmark') {
        const { Reference } = require('./configuration-reuse-reference.cjs');
        const reference = Object.create(manager);
        for(const name of Object.getOwnPropertyNames(Reference.prototype)) {
          if(name !== 'constructor') Object.defineProperty(reference,name,Object.getOwnPropertyDescriptor(Reference.prototype,name));
        }
        const samples = { runtime: [], sidebar: [], referenceRuntime: [], referenceSidebar: [] };
        let equivalent = true;
        for (let i = 0; i < 60; i++) {
          await new Promise(resolve => setImmediate(resolve));
          const results = {};
          const operations = [ ['runtime',()=>manager.getRuntimeContext()], ['referenceRuntime',()=>reference.getRuntimeContext()],
            ['sidebar',()=>manager.getSidebarState()], ['referenceSidebar',()=>reference.getSidebarState()] ];
          if(i%2)operations.reverse();
          for(const [name,operation] of operations) {
            const start=performance.now(); results[name]=operation();
            const elapsed=performance.now()-start; if(i>=10)samples[name].push(elapsed);
          }
          equivalent &&= JSON.stringify(results.runtime) === JSON.stringify(results.referenceRuntime)
            && JSON.stringify(results.sidebar) === JSON.stringify(results.referenceSidebar);
        }
        if(!equivalent)throw Error('Reference/candidate payload mismatch');
        result = { samples, equivalent, warmupPairs:10, measuredPairs:50,
          runtime: manager.getRuntimeContext(), sidebar: manager.getSidebarState() };
      } else if (action === 'configuration-check') {
        const root = vscode.workspace.getConfiguration();
        const key = 'devSessionCanvas.agent.codexDefaultArgs';
        const original = root.inspect(key)?.workspaceValue;
        const before = manager.getRuntimeContext();
        try {
          await root.update(key, '--diagnostic-fresh-value', vscode.ConfigurationTarget.Workspace);
          const after = manager.getRuntimeContext();
          if (after.agentLaunchDefaults.codex.defaultArgs !== '--diagnostic-fresh-value') throw Error('stale configuration');
          if (before.agentLaunchDefaults.codex.defaultArgs === '--diagnostic-fresh-value') throw Error('invalid fixture');
          result = { fresh: true, priorPayloadUnchanged: before.agentLaunchDefaults.codex.defaultArgs !== '--diagnostic-fresh-value' };
        } finally { await root.update(key, original, vscode.ConfigurationTarget.Workspace); }
      } else throw Error('unknown action');
      response.end(JSON.stringify({ result }));
    } catch (error) { response.writeHead(500).end(JSON.stringify({ error: String(error), stack: error.stack })); }
  });
  server.listen(0, '127.0.0.1', async () => {
    await fs.writeFile(config.receipt + '.tmp', JSON.stringify({ port: server.address().port, pid: process.pid }));
    await fs.rename(config.receipt + '.tmp', config.receipt);
  });
  context.subscriptions.push({ dispose() { clearInterval(stateLoad); server.close(); } });
};
