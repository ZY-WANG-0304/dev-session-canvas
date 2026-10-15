from pathlib import Path
import hashlib,json
files={}
def change(path,old,new):
 p=Path(path);s=p.read_text();assert s.count(old)==1,(path,s.count(old));before=hashlib.sha256(s.encode()).hexdigest();s=s.replace(old,new,1);p.write_text(s);files[path]={'original_sha256':files.get(path,{}).get('original_sha256',before),'probe_sha256':hashlib.sha256(s.encode()).hexdigest()}
p='tests/vscode-smoke/real-reopen-tests.cjs'
change(p, 'async function activateExtension() {', '''async function activateExtension() {
  console.info('[fallback-stage]', JSON.stringify({time:Date.now(),phase,stage:'activate-helper-begin'}));''')
for old,label in [
 ('  await activateVisibleExtension(vscode, EXTENSION_ID);','extension-active'),
 ('  await waitForCommand(vscode, COMMAND_IDS.openCanvasInEditor);','open-command-visible'),
 ('  await vscode.commands.executeCommand(COMMAND_IDS.openCanvasInEditor);','first-open-settled'),
 ('  await waitForCommand(vscode, COMMAND_IDS.testResetState);','reset-command-visible'),
 ("  await vscode.commands.executeCommand('workbench.action.closeAllEditors');",'close-editors-settled')]:
 # first-open also occurs in openCanvasEditor; target exact helper section only.
 text=Path(p).read_text();start=text.index('async function activateExtension() {');end=text.index('async function openCanvasEditor()',start)
 section=text[start:end];assert section.count(old)==1,label
 new=old+"\n  console.info('[fallback-stage]', JSON.stringify({time:Date.now(),phase,stage:'"+label+"'}));"
 before=hashlib.sha256(text.encode()).hexdigest();text=text[:start]+section.replace(old,new,1)+text[end:];Path(p).write_text(text)
 files[p]={'original_sha256':files[p]['original_sha256'],'probe_sha256':hashlib.sha256(text.encode()).hexdigest()}
change(p,'async function openCanvasEditor() {', '''async function openCanvasEditor() {
  console.info('[fallback-stage]', JSON.stringify({time:Date.now(),phase,stage:'verify-open-begin'}));''')
change(p,'  await vscode.commands.executeCommand(COMMAND_IDS.testWaitForCanvasReady, \'editor\', CANVAS_READY_TIMEOUT_MS);', '''  console.info('[fallback-stage]', JSON.stringify({time:Date.now(),phase,stage:'verify-open-settled'}));
  await vscode.commands.executeCommand(COMMAND_IDS.testWaitForCanvasReady, 'editor', CANVAS_READY_TIMEOUT_MS);
  console.info('[fallback-stage]', JSON.stringify({time:Date.now(),phase,stage:'verify-ready-settled'}));''')
p='tests/vscode-smoke/test-helpers.cjs'
change(p,'  await extension.activate();', '''  console.info('[fallback-stage]', JSON.stringify({time:Date.now(),stage:'visible-extension-activate-begin'}));
  await extension.activate();
  console.info('[fallback-stage]', JSON.stringify({time:Date.now(),stage:'visible-extension-activate-settled'}));''')
Path('fallback-stage-inputs.json').write_text(json.dumps(files,indent=2)+'\n')
