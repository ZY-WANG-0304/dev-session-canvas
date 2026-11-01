import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { invoke } from '@tauri-apps/api/core';
import './style.css';
function App() {
  const [events, setEvents] = useState<string[]>([]);
  const [sources,setSources]=useState(0);
  const [error, setError] = useState('');
  async function refresh() { const [events,sources]=await Promise.all([invoke<string[]>('diagnostics'),invoke<number>('connected_sources')]);setEvents(events);setSources(sources); }
  useEffect(() => { const timer = setInterval(() => { void refresh().catch(e => setError(String(e))); }, 1000); return () => clearInterval(timer); }, []);
  async function act(action: string) {
    try { setError(''); await invoke('notification_action', { action }); await refresh(); }
    catch (e) { setError(String(e)); }
  }
  return <main><h1>DSCanvas Notifier</h1><p>{sources>0?`已连接 ${sources} 个 IDE 来源`:'尚未连接 IDE'}</p>
    <div className="actions">{[['status','查询权限'],['authorize','请求权限'],['post','发送测试通知'],['withdraw','撤销测试通知']].map(([id,label]) => <button key={id} onClick={() => void act(id)}>{label}</button>)}</div>
    {error && <p role="alert">{error}</p>}<h2>诊断记录</h2><p>系统提交、展示回调和用户点击分别记录。点击测试通知仅打开此窗口。</p><pre aria-label="诊断记录">{events.join('\n')}</pre>
  </main>;
}
createRoot(document.getElementById('root')!).render(<App />);
