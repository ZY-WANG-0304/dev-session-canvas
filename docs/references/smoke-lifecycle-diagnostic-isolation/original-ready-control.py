from pathlib import Path
import hashlib,json
manager=Path('extensions/vscode/dev-session-canvas/src/panel/CanvasPanelManager.ts')
test=Path('tests/vscode-smoke/extension-tests.cjs')
changes={}
def change(p, old, new):
 s=p.read_text(); assert s.count(old)==1,(str(p),s.count(old)); before=hashlib.sha256(s.encode()).hexdigest()
 s=s.replace(old,new,1);p.write_text(s)
 changes[str(p)]={'original_sha256':changes.get(str(p),{}).get('original_sha256',before),'control_sha256':hashlib.sha256(s.encode()).hexdigest()}
change(manager, '    const lifecycle = extractWebviewMessageLifecycle(message);', '''    const gate = (globalThis as any).__lifecycleReadyControl ??= { delivered: false, delivering: false };
    if (sourceSurface === 'editor' && (message as any)?.type === 'webview/ready' && !gate.delivered && !gate.delivering) {
      if (gate.original) throw new Error('Control observed more than one original editor ready');
      gate.original = { manager: this, sourceSurface, message, sourceWebview };
      console.info('[lifecycle-control]', JSON.stringify({ stage: 'original-ready-held', lifecycle: (message as any).lifecycle }));
      return;
    }
    const lifecycle = extractWebviewMessageLifecycle(message);''')
change(manager, '      templateCatalogPostSettled = await this.waitForLifecycleRaceTemplateCatalogPost(oldFrame);', '''      templateCatalogPostSettled = await this.waitForLifecycleRaceTemplateCatalogPost(oldFrame);
      if (process.env.DSC_READY_TIMING === 'during') {
        const gate = (globalThis as any).__lifecycleReadyControl;
        const deadline = Date.now() + 20000;
        while (!gate?.original && Date.now() < deadline) await delay(10);
        if (!gate?.original) throw new Error('Original editor ready missing in controlled diagnostic');
        gate.delivering = true;
        const original = gate.original;
        original.manager.handleWebviewMessage(original.sourceSurface, original.message, original.sourceWebview);
        gate.delivered = true; gate.delivering = false;
        console.info('[lifecycle-control]', JSON.stringify({ stage: 'original-ready-delivered-during',
          fakeActive: this.activeSurface, realActive: original.manager.activeSurface,
          ready: original.manager.surfaceReady.editor, lifecycle: original.manager.surfaceLifecycle.editor }));
      }''')
change(test,'  await verifyWebviewLifecycleRaceDiagnostics();','''  const mode = process.env.DSC_READY_TIMING;
  const waitOriginal = async () => {
    const deadline = Date.now() + 20000;
    while (!globalThis.__lifecycleReadyControl?.original && Date.now() < deadline) await sleep(10);
    assert.ok(globalThis.__lifecycleReadyControl?.original, 'Control must observe original editor ready');
  };
  const deliverOriginal = async () => {
    await waitOriginal();
    const gate = globalThis.__lifecycleReadyControl, original = gate.original;
    assert.strictEqual(gate.delivered, false, 'Original ready is delivered once');
    gate.delivering = true;
    original.manager.handleWebviewMessage(original.sourceSurface, original.message, original.sourceWebview);
    gate.delivered = true; gate.delivering = false;
  };
  if (mode === 'before') { await deliverOriginal(); }
  await verifyWebviewLifecycleRaceDiagnostics();
  if (mode === 'after') { await deliverOriginal(); }
  await waitOriginal();
  const controlSnapshot = await getDebugSnapshot();
  console.info('[lifecycle-control]', JSON.stringify({ stage: 'after-diagnostic', mode,
    ready: controlSnapshot.surfaceReady.editor, lifecycle: controlSnapshot.surfaceLifecycle.editor }));
  assert.strictEqual(controlSnapshot.surfaceReady.editor, mode !== 'none', 'Diagnostic preserves original ready only when delivered');
  if (mode !== 'none') {
    await vscode.commands.executeCommand(COMMAND_IDS.testWaitForCanvasReady, 'editor', 20000);
    const deadline = Date.now() + 20000;
    let ack = await getDebugSnapshot();
    while (!ack.surfaceLifecycle.editor.bootstrapAck && Date.now() < deadline) {
      await sleep(10); ack = await getDebugSnapshot();
    }
    assert.strictEqual(ack.surfaceLifecycle.editor.bootstrapAck, true, 'Original ready must complete actual bootstrap ack');
    console.info('[lifecycle-control]', JSON.stringify({ stage: 'real-bootstrap-ack', mode, lifecycle: ack.surfaceLifecycle.editor }));
  }''')
Path('control-inputs.json').write_text(json.dumps(changes,indent=2)+'\n')
