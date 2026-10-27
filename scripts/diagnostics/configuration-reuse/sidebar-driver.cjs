// Test-only instrumentation of real sidebar instances in a copied extension.
exports.instrument = function(manager, vscode, views) {
  let counters, last = {};
  const reset = () => counters = {configurationBuilds:0,configurationMs:0,treeRefreshes:0,actionsMessages:0,actionsBytes:0,nodesMessages:0,nodesBytes:0};
  reset();
  const get = manager.getSidebarState.bind(manager);
  manager.getSidebarState = (...args) => {const start=performance.now();try{return get(...args);}finally{counters.configurationBuilds++;counters.configurationMs+=performance.now()-start;}};
  const fire = views.summary.changeEmitter.fire.bind(views.summary.changeEmitter);
  views.summary.changeEmitter.fire = (...args) => {counters.treeRefreshes++;return fire(...args);};
  for(const kind of ['actions','nodes']) {
    const original=views[kind].resolveWebviewView.bind(views[kind]);
    views[kind].resolveWebviewView=(view,...rest)=>{
      const post=view.webview.postMessage.bind(view.webview);
      view.webview.postMessage=message=>{
        if(message.type===`sidebar${kind==='actions'?'Actions':'NodeList'}/state`) {
          counters[`${kind}Messages`]++;counters[`${kind}Bytes`]+=Buffer.byteLength(JSON.stringify(message));last[kind]=message.payload;
        }
        return post(message);
      };
      return original(view,...rest);
    };
  }
  return async function(action,args={}) {
    if(action==='sidebar-show') {
      if(args.visible===false)await vscode.commands.executeCommand('workbench.view.explorer');
      else {
        await vscode.commands.executeCommand('devSessionCanvas.sidebar.focus');
        await vscode.commands.executeCommand('devSessionCanvas.sidebarFilters.focus');
        await vscode.commands.executeCommand('devSessionCanvas.sidebarNodes.focus');
      }
      return true;
    }
    if(action==='sidebar-mutate') {
      manager.updateCanvasFileFilterState('include',['sidebar-probe/**']);
      const surface=manager.activeSurface;
      manager.handleWebviewMessage(surface,{type:'webview/updateNodeTitle',lifecycle:manager.getSurfaceLifecycleIdentity(surface),
        payload:{nodeId:args.nodeId,title:'Renamed while hidden'}},manager.getActiveWebview());
      return true;
    }
    if(action==='sidebar-reset-metrics'){reset();return true;}
    if(action==='sidebar-metrics')return {counters:{...counters},views:Object.fromEntries(['actions','nodes'].map(k=>[k,{created:!!views[k].view,visible:views[k].view?.visible??false}])),last};
    if(action==='sidebar-check') {
      const state=get();
      return {summary:views.summary.getChildren().map(({id,label,description,tooltip})=>({id,label,description,tooltip})),
        expectedNodes:manager.state.nodes.filter(n=>n.kind==='agent').map(n=>({id:n.id,title:n.title})),
        expectedFilters:{canvasSurface:state.canvasSurface,filesFeatureEnabled:state.filesFeatureEnabled,fileFilters:state.fileFilters},last};
    }
    throw Error('Unknown sidebar action');
  };
};
