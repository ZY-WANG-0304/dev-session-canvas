const vscode=require('vscode');
const fs=require('node:fs/promises');
const path=require('node:path');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
async function writeAtomic(file, value) {
  const temporary = `${file}.${process.pid}.pending`;
  await fs.writeFile(temporary, JSON.stringify(value));
  await fs.rename(temporary, file);
}
exports.activate=async function(context) {
  const config=JSON.parse(await fs.readFile(path.join(context.extensionPath,'config.json'),'utf8'));
  const subjects=[];
  for(const pkg of config.expected) {
    const extension=vscode.extensions.getExtension(pkg.id);assert(extension,'Original installed extension missing');
    const installedPath=await fs.realpath(extension.extensionPath),privateRoot=await fs.realpath(config.extensionsDir);
    assert(installedPath.startsWith(privateRoot+path.sep),'Subject was not loaded from the private original installation');
    const manifest=JSON.parse(await fs.readFile(path.join(installedPath,'package.json'),'utf8'));
    const {__metadata,...product}=manifest;assert.deepEqual(product,pkg.manifest,'Installed manifest changed');
    assert.equal(manifest.main,'./dist/extension.js');
    for(const file of pkg.files)assert.equal(hash(await fs.readFile(path.join(installedPath,file.path))),file.sha256,
      `Installed product payload changed: ${file.path}`);
    await extension.activate();assert(extension.isActive);
    subjects.push({id:pkg.id,version:manifest.version,path:installedPath,main:manifest.main,active:extension.isActive});
  }
  const commands=await vscode.commands.getCommands(true);
  assert(!commands.some(name=>name.startsWith('devSessionCanvas.__test.')||name.startsWith('devSessionCanvasNotifier.__test.')),
    'Installed subjects must not register product test commands');
  const receiverRoot=path.resolve(path.dirname(config.notificationReceiver));
  assert.equal(path.resolve((process.env.PATH??'').split(path.delimiter)[0]),receiverRoot,
    'Installed Host replaced the controlled notification receiver PATH');
  assert.equal(process.env.DSC_NOTIFICATION_CAPTURE,config.notificationCapture);
  assert.equal(process.env.DSC_NOTIFICATION_ACTIVATE,config.notificationActivate);
  await writeAtomic(config.receipt,({schemaVersion:1,subjects,hostPID:process.pid,
    testCommandsAbsent:true,locale:vscode.env.language,launchArgs:process.argv,
    notificationReceiver:{executable:config.notificationReceiver,environmentVerified:true}}));
  let busy=false;
  const timer=setInterval(async()=>{if(busy)return;busy=true;
    let request;
    try {
      request=JSON.parse(await fs.readFile(config.request,'utf8'));await fs.unlink(config.request);
      if(request.command==='driver/describeUri') {
        assert.equal(request.args?.length,1);assert.equal(typeof request.args[0],'string');
        const uri=vscode.Uri.parse(request.args[0]);
        await writeAtomic(config.response,{id:request.id,result:{original:request.args[0],serialized:uri.toString()}});
        return;
      }
      const allowed=['devSessionCanvasNotifier.postSystemNotification','workbench.action.closeWindow','workbench.action.quit',
        'workbench.action.closeAllEditors',
        'workbench.view.extension.devSessionCanvasNotifier','devSessionCanvasNotifier.status.focus',
        'devSessionCanvasNotifier.notes.focus','devSessionCanvasNotifier.codex.focus',
        'devSessionCanvas.openCanvasInEditor','devSessionCanvas.createTerminalFromExplorerResource','vscode.open'];
      assert(allowed.includes(request.command),'Driver command not allowed');
      if(['workbench.action.closeWindow','workbench.action.quit'].includes(request.command)) {
        // The Host disappears during shutdown. This receipt confirms only the
        // public request; the external observer must prove the original exits.
        await writeAtomic(config.response,({id:request.id,status:'exit-requested',command:request.command}));
        await vscode.commands.executeCommand(request.command);return;
      }
      const args=request.command==='vscode.open'?[vscode.Uri.parse(request.args[0])]
        :request.command==='devSessionCanvas.createTerminalFromExplorerResource'?[vscode.Uri.file(config.workspace)]:request.args??[];
      const result=await vscode.commands.executeCommand(request.command,...args);
      await writeAtomic(config.response,({id:request.id,result:result??null}));
    }catch(error){if(error.code!=='ENOENT')await writeAtomic(config.response,({id:request?.id,error:error.message}));}
    finally{busy=false;}
  },50);context.subscriptions.push({dispose(){clearInterval(timer);}});
};
