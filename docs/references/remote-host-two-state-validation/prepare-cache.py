from pathlib import Path
import hashlib,json
root=Path('/tmp/dscsshdiag-two-cache/vscode-linux-x64-1.141.0/resources/app/out/vs/workbench/workbench.desktop.main.js');s=root.read_text();old=s
needle='async disconnect(){this._protocol&&!this._hasDisconnected&&(this._protocol.send(fat(2)),this._protocol.sendDisconnect(),this._hasDisconnected=!0,await this._protocol.drain())}'
repl='async disconnect(){if(this._protocol&&!this._hasDisconnected){if(this._environmentService.extensionTestsLocationURI?.path?.includes("real-reopen-loss-tests")){this._logService.info("[SSH-TWO-STATE] suppress setup terminate/disconnect");}else{this._protocol.send(fat(2));this._protocol.sendDisconnect();}this._hasDisconnected=!0;await this._protocol.drain();}}'
assert s.count(needle)==1;s=s.replace(needle,repl);root.write_text(s)
Path('/tmp/dscssh2-evidence/upstream-input.json').write_text(json.dumps({'stockSha256':hashlib.sha256(old.encode()).hexdigest(),'labSha256':hashlib.sha256(s.encode()).hexdigest(),'before':needle,'after':repl},indent=2))
