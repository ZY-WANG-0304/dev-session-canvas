import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import path from 'node:path';
import ts from 'typescript';
import esbuild from 'esbuild';

export async function buildReference(outfile) {
  const ref='cce236b3ec1a6eb776c494f9f8ce971f408f4f16';
  const filename='extensions/vscode/dev-session-canvas/src/panel/CanvasPanelManager.ts';
  const {stdout:source}=await promisify(execFile)('git',['show',`${ref}:${filename}`],{maxBuffer:4*1024**2});
  const ast=ts.createSourceFile(filename,source,ts.ScriptTarget.Latest,true);
  const declaration=ast.statements.find(n=>ts.isClassDeclaration(n)&&n.name?.text==='CanvasPanelManager');
  const names=['getRuntimeContext','getSidebarState','getCanvasFileViewConfiguration','getAgentCliConfig',
    'getAgentLaunchDefaults','getAgentLaunchDefaultsByProvider','getCanvasOverviewMode','getCanvasOverviewZoomThreshold',
    'getCanvasMultiRootPresentationMode','getWorkspaceRootWatermarksEnabled'];
  const methods=names.map(name=>{const method=declaration.members.find(n=>n.name?.getText(ast)===name);assert(method);return method.getText(ast);}).join('\n');
  const clone=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='cloneJsonValue');assert(clone);
  await esbuild.build({stdin:{contents:`${ast.statements.filter(ts.isImportDeclaration).map(n=>n.getText(ast)).join('\n')}
    ${clone.getText(ast)}
    export class Reference { ${methods} }`,resolveDir:path.resolve(path.dirname(filename)),loader:'ts'},
    bundle:true,platform:'node',format:'cjs',external:['vscode'],outfile,logLevel:'silent'});
  return {ref,sourceSha256:createHash('sha256').update(source).digest('hex'),methods:names,
    semantics:'Original configuration-consuming methods bound to an object inheriting the active manager. Unchanged dependencies resolve from this checkout; root configuration helper defaults remain equivalent.'};
}
