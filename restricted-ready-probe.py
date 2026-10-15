from pathlib import Path
import hashlib,json
root=Path.cwd()
changes={}
def change(rel, old, new):
 p=root/rel
 text=p.read_text()
 count=text.count(old)
 if count!=1: raise RuntimeError(f'{rel}: expected one anchor, found {count}')
 before=hashlib.sha256(text.encode()).hexdigest()
 text=text.replace(old,new,1)
 p.write_text(text)
 changes[rel]={'original_sha256':changes.get(rel,{}).get('original_sha256',before),'probe_sha256':hashlib.sha256(text.encode()).hexdigest()}
manager='extensions/vscode/dev-session-canvas/src/panel/CanvasPanelManager.ts'
change(manager, '    const deadline = Date.now() + timeoutMs;\n\n    while (Date.now() < deadline) {', """    const deadline = Date.now() + timeoutMs;
    const readyProbeStartedAt = Date.now();
    let readyProbeLastState = '';
    const readyProbe = (stage: string): void => {
      const state = { target: surface, active: this.activeSurface, modes: this.surfaceMode,
        ready: this.surfaceReady, lifecycle: this.surfaceLifecycle,
        editorVisible: this.editorPanel?.visible, editorActive: this.editorPanel?.active };
      const encoded = JSON.stringify(state);
      if (stage !== 'poll' || encoded !== readyProbeLastState) {
        console.info('[restricted-ready-host]', JSON.stringify({time: Date.now(), stage,
          elapsedMs: Date.now()-readyProbeStartedAt, ...state}));
        readyProbeLastState = encoded;
      }
    };
    readyProbe('wait-start');
    while (Date.now() < deadline) {
      readyProbe('poll');""")
change(manager, '        return this.getDebugSnapshot();\n      }\n\n      await delay(50);', """        readyProbe('wait-success');
        return this.getDebugSnapshot();
      }

      await delay(50);""")
change(manager, "    const targetLabel = surface ?? this.activeSurface ?? 'active surface';", "    readyProbe('wait-timeout');\n    const targetLabel = surface ?? this.activeSurface ?? 'active surface';")
change(manager, "    if (parsedMessage.type === 'webview/ready') {", """    if (parsedMessage.type === 'webview/ready') {
      console.info('[restricted-ready-host]', JSON.stringify({time:Date.now(),stage:'ready-received',
        sourceSurface,lifecycle,currentLifecycle:this.getSurfaceLifecycleIdentity(sourceSurface)}));""")
change(manager, '  private recordDiagnosticEvent(kind: string, detail?: Record<string, unknown>): void {', """  private recordDiagnosticEvent(kind: string, detail?: Record<string, unknown>): void {
    if (kind.startsWith('surface/') || kind.startsWith('webview/') || kind==='state/reset' || kind==='workspace/trustGranted')
      console.info('[restricted-ready-event]', JSON.stringify({time:Date.now(),kind,detail}));""")
html='extensions/vscode/dev-session-canvas/src/panel/getWebviewHtml.ts'
change(html, '      window.__DEV_SESSION_CANVAS_I18N__ = ${escapeHtmlScriptJson(i18n)};', """      window.__DEV_SESSION_CANVAS_I18N__ = ${escapeHtmlScriptJson(i18n)};
      window.__DSC_READY_STAGES__ = [];
      window.__DSC_READY_STAGE__ = (stage, extra) => {
        const entry = {time:Date.now(),stage,identity:window.__DEV_SESSION_CANVAS_WEBVIEW_IDENTITY__,
          readyState:document.readyState,visibility:document.visibilityState,focused:document.hasFocus(),...extra};
        window.__DSC_READY_STAGES__.push(entry);
        console.info('[ready-frame]', JSON.stringify(entry));
      };
      window.__DSC_READY_STAGE__('inline-identity');
      window.addEventListener('error',event=>window.__DSC_READY_STAGE__('error',{message:event.message,resource:event.target?.src}),true);
      window.addEventListener('unhandledrejection',event=>window.__DSC_READY_STAGE__('rejection',{message:String(event.reason)}));
      window.addEventListener('securitypolicyviolation',event=>window.__DSC_READY_STAGE__('csp',{directive:event.violatedDirective,blocked:event.blockedURI}));
      document.addEventListener('DOMContentLoaded',()=>window.__DSC_READY_STAGE__('dom-content-loaded'));
      document.addEventListener('visibilitychange',()=>window.__DSC_READY_STAGE__('visibility-change'));""")
main='extensions/vscode/dev-session-canvas/src/webview/main.tsx'
change(main, '    __DEV_SESSION_CANVAS_I18N__?: WebviewI18nBootstrap;', '    __DEV_SESSION_CANVAS_I18N__?: WebviewI18nBootstrap;\n    __DSC_READY_STAGE__?: (stage: string, extra?: Record<string, unknown>) => void;')
change(main, 'const vscode = acquireVsCodeApi<LocalUiState>();', "window.__DSC_READY_STAGE__?.('bundle-main');\nconst vscode = acquireVsCodeApi<LocalUiState>();\nwindow.__DSC_READY_STAGE__?.('api-acquired');")
change(main, 'const root = createRoot(rootElement);', "window.__DSC_READY_STAGE__?.('create-root-call');\nconst root = createRoot(rootElement);\nwindow.__DSC_READY_STAGE__?.('create-root-return');")
change(main, "    postMessage({ type: 'webview/ready', payload: { capabilities: {", "    window.__DSC_READY_STAGE__?.('react-ready-effect', {lifecycle:webviewLifecycleIdentity});\n    postMessage({ type: 'webview/ready', payload: { capabilities: {")
change(main, 'function postMessage(message: WebviewToHostMessage): void {', "function postMessage(message: WebviewToHostMessage): void {\n  if(message.type==='webview/ready') window.__DSC_READY_STAGE__?.('ready-post-call',{lifecycle:webviewLifecycleIdentity});")
change(main, 'root.render(<App />);', "window.__DSC_READY_STAGE__?.('root-render-call');\nroot.render(<App />);\nwindow.__DSC_READY_STAGE__?.('root-render-return');")
test='tests/vscode-smoke/extension-tests.cjs'
change(test, 'async function runSmoke() {', """async function runSmoke() {
  console.info('[restricted-ready-test]', JSON.stringify({time:Date.now(),stage:'test-start',scenario:smokeScenario}));""")
change(test, '  await verifyFirstOpenDefaultTemplate();\n  await vscode.commands.executeCommand(COMMAND_IDS.testResetState);', """  await verifyFirstOpenDefaultTemplate();
  console.info('[restricted-ready-test]', JSON.stringify({time:Date.now(),stage:'before-reset',snapshot:await getDebugSnapshot()}));
  await vscode.commands.executeCommand(COMMAND_IDS.testResetState);
  console.info('[restricted-ready-test]', JSON.stringify({time:Date.now(),stage:'after-reset',snapshot:await getDebugSnapshot()}));""")
change(test, 'async function runRestrictedSmoke() {', """async function runRestrictedSmoke() {
  console.info('[restricted-ready-test]', JSON.stringify({time:Date.now(),stage:'restricted-start',snapshot:await getDebugSnapshot()}));""")
(root/'probe-inputs.json').write_text(json.dumps(changes,indent=2)+'\n')
print('Applied diagnostic-only stage records; no timeout or assertion changed.')
