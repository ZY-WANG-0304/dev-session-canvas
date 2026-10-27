// Serializable browser-side observer; used unchanged by the CDP runner and regression test.
export function installEchoProbe(id) {
    const t=window.__dscConfigurationProbeRegistry.get(id).terminal;
    const p=window.__dscEchoProbe={sequence:0,samples:[],active:false,parsed:0,renders:0};
    document.addEventListener('keydown',e=>{
      if(p.active && e.target===t.textarea && /^[a-z]$/.test(e.key)) {
        const sequence=++p.sequence;p.samples.push({sequence,key:e.key,started:performance.now(),reply:`REPLY_${String(sequence).padStart(6,'0')}_${e.key.charCodeAt(0).toString(16)}`});
      }
    },true);
    t.onWriteParsed(()=>{
      if(!p.active)return; p.parsed++;
      const pending=p.samples.filter(s=>s.applied===undefined);if(!pending.length)return;
      const b=t.buffer.active,remaining=new Map(pending.map(s=>[s.reply,s]));
      // Search backwards until all pending replies are found. Wraps and a large
      // coalesced page must not hide a reply behind an arbitrary line cap.
      for(let i=b.length-1;i>=0&&remaining.size;i--) {
        const line=b.getLine(i)?.translateToString(true),sample=remaining.get(line);
        if(sample){sample.applied=performance.now();sample.durationMs=sample.applied-sample.started;remaining.delete(line);}
      }
    });
    t.onRender(()=>{if(p.active)p.renders++;});
}
