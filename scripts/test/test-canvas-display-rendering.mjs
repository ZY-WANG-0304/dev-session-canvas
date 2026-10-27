import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
const directory=path.resolve('.debug/canvas-display-updates/render-instrumented');
await fs.cp('extensions/vscode/dev-session-canvas/dist',directory,{recursive:true});
const file=path.join(directory,'webview.js');let count=0;
const code=(await fs.readFile(file,'utf8')).replace(/(function (?:AgentSessionNode|TerminalSessionNode)\(\{ id: (\w+), data, xPos, yPos \}\) \{)/g,(_,header,id)=>{
 count++;return `${header}\n(globalThis.__dscDisplayRenderCounts ??= {})[${id}] = (globalThis.__dscDisplayRenderCounts[${id}] ?? 0) + 1;`;
});assert.equal(count,2,'instrument actual Agent/Terminal component bodies');await fs.writeFile(file,code);
const run=spawnSync(process.execPath,['scripts/test/run-playwright-webview.mjs','--grep','canvas display component rendering','--workers=1'],{stdio:'inherit',env:{...process.env,DEV_SESSION_CANVAS_BROWSER_ASSETS:directory,DSC_DISPLAY_RENDER_COUNTS:'1'}});
process.exitCode=run.status??1;
