import assert from 'node:assert/strict';
export function verifyInstrumentation({beforeMain,beforeNotifier,afterMain,afterNotifier,beforeManifest,afterManifest}) {
  const expectedManifest={...beforeManifest,main:'./extension.js'};
  delete expectedManifest.extensionDependencies;delete expectedManifest.extensionPack;
  assert.deepEqual(afterManifest,expectedManifest,'Packaged instrumentation changed unexpected manifest fields');
  assert.deepEqual(afterNotifier,beforeNotifier,'Packaged notifier payload must come unchanged from its VSIX');
  const before=new Map(beforeMain.map(file=>[file.path,file.sha256]));
  const after=new Map(afterMain.map(file=>[file.path,file.sha256]));
  for(const [file,hash]of before)assert(file==='package.json'||after.get(file)===hash,`Original packaged payload changed: ${file}`);
  const changed=[];
  for(const [file,hash]of after) {
    if(before.get(file)===hash)continue;
    assert(file==='package.json'||file==='extension.js'||file.startsWith('tests/vscode-smoke/')||file.startsWith('notifier-extension/'),
      `Unplanned packaged instrumentation: ${file}`);
    changed.push({path:file,sha256:hash});
  }
  assert(changed.some(file=>file.path==='extension.js'),'Packaged wrapper is missing');
  return changed;
}
