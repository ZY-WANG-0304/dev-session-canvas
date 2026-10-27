// Test-only measurement in copied extension artifacts. Identical instrumentation for A/B/C.
exports.instrument = manager => {
  let measurement;
  const original=manager.postState.bind(manager);
  manager.postState=function(...args) {
    if(!measurement)return original(...args);
    const start=performance.now();
    try{return original(...args);}finally{measurement.calls++;measurement.totalMs+=performance.now()-start;}
  };
  return (action, args) => {
    if(action==='display-mode') {
      if(!['skip','delta'].includes(args.mode))throw Error('Unknown mode');
      globalThis.__dscCanvasDisplayMode=args.mode;
      for(const p of manager.canvasDisplayPublishers.values())p.invalidate();
      manager.postState('host/stateUpdated',{full:true,reason:'diagnostic-mode-switch'});
      return true;
    }
    if(action==='display-change') {if(measurement)measurement.changes.push(args);return true;}
    if(action==='display-reset') {measurement={changes:[],calls:0,totalMs:0,start:performance.now(),cpu:process.cpuUsage()};return true;}
    if(action==='display-metrics') {const cpu=process.cpuUsage(measurement.cpu);return {...measurement,elapsedMs:performance.now()-measurement.start,cpu};}
  };
};
