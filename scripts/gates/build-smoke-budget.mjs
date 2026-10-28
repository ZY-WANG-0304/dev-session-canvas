import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { createHash } from 'node:crypto';
import { smokeCatalog } from '../smoke/smoke-catalog.mjs';

// An inventory of the retained adapters, generated from real call sites. This
// gives a conservative ceiling, not a calibrated runtime or a product SLA.
const files = ['extension-tests.cjs', 'real-reopen-tests.cjs', 'two-window-shared-runtime-tests.cjs',
  'legacy-supervisor-upgrade-tests.cjs', 'runtime-compatibility-tests.cjs', 'notifier-companion-tests.cjs',
  'notifier-locale-tests.cjs', 'ui-copy-locale-tests.cjs', 'template-marketplace-tests.cjs',
  'template-marketplace-preview-tests.cjs'];
const defaultWaits = { waitForSnapshot: [1, 15000], waitForWebviewProbe: [1, 8000],
  waitForWebviewProbeOnSurface: [2, 8000], waitForDiagnosticEvents: [1, 8000],
  waitForRuntimeSupervisorState: [1, 15000], waitForHostMessages: [1, 8000],
  waitForActiveEditor: [1, 8000], waitForActiveTab: [1, 8000], waitForVisibleEditor: [1, 8000],
  waitForInterceptedInformationMessage: [3, 8000], performWebviewDomAction: [2, 5000],
  performSidebarNodeListAction: [1, 5000], performSidebarSessionHistoryAction: [1, 5000],
  captureWebviewProbe: [1, 8000], activateVisibleExtension: [2, 20000], waitForCommand: [-1, 20000],
  waitForVisibleExtension: [-1, 20000], resetCanvasAfterFinalPersistence: [-1, 15000],
  stopRuntimeExecutionsAfterRetirement: [-1, 15000], restoreTerminalHistory: [-1, 20000] };
const loopBounds = { 'runIndependentHostBoundary:expected.nodes': [2, 'Two original execution nodes across the Host boundary'],
  'runIndependentHostBoundary:expected.originalProcesses': [2, 'Original fake provider and Terminal shell processes'],
  'verifyGapLocalFinal:readers': [8, 'Bounded original visible page reader observations'], 'runRuntimeCheckpointRefreshSmoke:chunks': [512, 'Current-state pages are bounded by the finite 18000-row fixture'],
  'runGenerationContinuity:[legacyAgentSessionId, legacyTerminalSessionId].filter(Boolean)':
    [2, 'Only the original previous-generation Agent and Terminal'],
  'runRuntimeCheckpointRefreshSmoke:legacy.nodes': [2, 'Only the two original execution nodes'],
  'verifyCanvasTemplatesTrusted:snapshot.state.nodes': [3, 'The imported finite fixture has three nodes'],
  'settleSidebarHistoryAgents:createdAgents': [8, 'At most eight fixture-created history Agents'],
  'verifyFileActivityViewsAndOpenFiles:fileActivityExecutions': [2, 'Agent and Terminal fixture'],
  'verifyEmbeddedTerminalThemeOnSurface:Object.entries': [2, 'Dark Modern and Light Modern'],
  'writeCodexSessionFile:userMessages': [8, 'Only bounded fixture transcript messages'],
  'listAvailableTerminalShellPaths:candidates': [12, 'Finite platform shell candidate list'],
  'resolveAvailableShellPath:pathEntries': [64, 'Formal controlled PATH is bounded to 64 entries'],
  'resolveAvailableShellPath:commandCandidates': [4, 'Finite executable suffix list'],
  'writeSmokeUserSettings:Object.entries': [32, 'Finite declared setting fixture'],
  'withInterceptedCreateQuickPicks:listeners.': [8, 'Listeners are registered by the single product QuickPick'],
  'runVerifyPhase:resized': [2, 'Original Agent and Terminal resize'],
  'openNotifierSidebar:commands': [4, 'Finite notifier sidebar focus commands'],
  'run:': [1, 'A suite run has no unbounded action loop'] };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const sourceHashes = Object.fromEntries([...files.map(name => `tests/vscode-smoke/${name}`),
  'scripts/smoke/smoke-catalog.mjs',
  'tests/vscode-smoke/test-helpers.cjs','tests/vscode-smoke/runtime-retirement.cjs',
  'tests/vscode-smoke/native-file-click.cjs', 'tests/vscode-smoke/canvas-runtime-update.cjs',
  'tests/vscode-smoke/reset-canvas.cjs','tests/vscode-smoke/terminal-history.cjs',
  'tests/vscode-smoke/terminal-resize.cjs','tests/vscode-smoke/remote-host-control.cjs',
  'tests/vscode-smoke/smoke-gap-observations.cjs','tests/vscode-smoke/fixtures/smoke-geometry-output-subject.cjs',
  'scripts/smoke/snapshot-host-boundary.mjs']
  .map(file => [file, hash(fs.readFileSync(file))]));
const models = new Map();
function model(name) {
  if (models.has(name)) return models.get(name);
  const file = `tests/vscode-smoke/${name}`;
  const ast = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const functions = new Map(); const constants = new Map();
  function scan(node) {
    if (ts.isFunctionDeclaration(node) && node.name) functions.set(node.name.text, node);
    if (ts.isBinaryExpression(node) && node.left.getText(ast)==='module.exports.run' && ts.isFunctionExpression(node.right))
      functions.set('run', node.right);
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) constants.set(node.name.text, node.initializer);
    ts.forEachChild(node, scan);
  }
  scan(ast); const result = { ast, functions, constants, file }; models.set(name, result); return result;
}
function number(node, model, fallback) {
  if (!node) return fallback;
  if (ts.isNumericLiteral(node)) return Number(node.text);
  if (ts.isIdentifier(node) && model.constants.has(node.text)) return number(model.constants.get(node.text), model, fallback);
  if (ts.isConditionalExpression(node)) return Math.max(number(node.whenTrue, model, fallback), number(node.whenFalse, model, fallback));
  if (ts.isBinaryExpression(node)) {
    const left=number(node.left,model,NaN), right=number(node.right,model,NaN);
    if (node.operatorToken.kind===ts.SyntaxKind.AsteriskToken && Number.isFinite(left*right)) return left*right;
    if (node.operatorToken.kind===ts.SyntaxKind.PlusToken && Number.isFinite(left+right)) return left+right;
  }
  return fallback;
}
function literal(node, bindings, ast) {
  if (!node) return undefined;
  if (ts.isParenthesizedExpression(node)) return literal(node.expression, bindings, ast);
  if (ts.isStringLiteral(node)) return node.text;
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
  return bindings[node.getText(ast)];
}
function condition(node, bindings, ast) {
  if (ts.isParenthesizedExpression(node)) return condition(node.expression, bindings, ast);
  if (ts.isBinaryExpression(node)) {
    const op = node.operatorToken.kind;
    if (op === ts.SyntaxKind.BarBarToken || op === ts.SyntaxKind.AmpersandAmpersandToken) {
      const left = condition(node.left, bindings, ast), right = condition(node.right, bindings, ast);
      if (op === ts.SyntaxKind.BarBarToken) return left === true || right === true ? true
        : left === false && right === false ? false : undefined;
      return left === false || right === false ? false : left === true && right === true ? true : undefined;
    }
    const left = literal(node.left, bindings, ast), right = literal(node.right, bindings, ast);
    if (left !== undefined && right !== undefined) {
      if (op === ts.SyntaxKind.EqualsEqualsEqualsToken) return left === right;
      if (op === ts.SyntaxKind.ExclamationEqualsEqualsToken) return left !== right;
    }
  }
  return undefined;
}
function inspectSuite(file, scenario, entry = 'run', times = 1, allowSynchronous = false) {
  const m = model(file); const evidence = [];
  const add=(node,kind,timeoutMs,multiplier,detail)=>{assert(Number.isSafeInteger(timeoutMs)&&timeoutMs>=0);
    evidence.push({file:m.file,line:m.ast.getLineAndCharacterOfPosition(node.getStart()).line+1,
      kind,timeoutMs,multiplier,detail});return timeoutMs*multiplier;};
  function fn(name,multiplier,chain=[],bindings={smokeScenario:scenario},args=[]) {
    if(name==='writeFailureArtifacts'||name==='persistLastWebviewProbe')return 0; // Independent 30s evidence phase.
    if (chain.includes(name)) throw new Error(`Recursive adapter budget: ${chain.join(' -> ')} -> ${name}`);
    const n=m.functions.get(name); if(!n)return 0;
    const local = { ...bindings };
    for (const [index, parameter] of n.parameters.entries()) {
      const value = literal(args[index] ?? parameter.initializer, bindings, m.ast);
      if (value !== undefined) local[parameter.name.getText(m.ast)] = value;
      else delete local[parameter.name.getText(m.ast)];
    }
    return visit(n.body,multiplier,[...chain,name],local);
  }
  function visit(n,multiplier,chain,bindings) {
    if(!n)return 0;
    if(ts.isFunctionDeclaration(n))return 0;
    if(ts.isBlock(n)) {
      let total=0;for(const statement of n.statements){total+=visit(statement,multiplier,chain,bindings);
        if(ts.isReturnStatement(statement)||ts.isIfStatement(statement)&&condition(statement.expression,bindings,m.ast)===true
          && statement.thenStatement.getText(m.ast).match(/\breturn;/))break;}return total;
    }
    if(ts.isIfStatement(n)) {
      const known=condition(n.expression,bindings,m.ast);if(known===false)return visit(n.elseStatement,multiplier,chain,bindings);
      if(known===true)return visit(n.thenStatement,multiplier,chain,bindings);
    }
    if(ts.isForOfStatement(n)||ts.isForStatement(n)) {
      let count,reason;const expression=(n.expression??n.condition)?.getText(m.ast)??'';
      const pure = !/\bawait\b/.test(n.statement.getText(m.ast));
      if(pure){count=1;reason='Synchronous loop has no timed action';}
      if(ts.isForOfStatement(n)&&ts.isArrayLiteralExpression(n.expression)){count=n.expression.elements.length;reason='Literal finite array';}
      if(ts.isForStatement(n)){const match=expression.match(/<\s*(\d+)$/);if(match){count=Number(match[1]);reason='Original numeric iteration bound';}}
      if(!count){const match=Object.entries(loopBounds).find(([key])=>{const [owner,prefix]=key.split(':');return owner===chain.at(-1)&&expression.startsWith(prefix);});
        assert(match,`Unbounded loop in ${m.file}:${m.ast.getLineAndCharacterOfPosition(n.getStart()).line+1}: ${chain.at(-1)} ${expression}`);
        [count,reason]=match[1];}
      add(n,'loop-bound',0,multiplier,{count,reason,expression});return visit(n.statement,multiplier*count,chain,bindings);
    }
    if(ts.isCallExpression(n)) {
      const name=n.expression.getText(m.ast);
      let total=0;
      if(defaultWaits[name]) {const [index,def]=defaultWaits[name];let value=n.arguments[index<0?n.arguments.length-1:index];
        total+=add(n,'original-wait',number(value,m,def),multiplier,{callee:name,expression:value?.getText(m.ast)??'default'});return total;}
      if(name==='sleep')return add(n,'fixture-sleep',number(n.arguments[0],m,1000),multiplier,{expression:n.arguments[0]?.getText(m.ast)});
      if(name==='vscode.commands.executeCommand'&&n.arguments[0]?.getText(m.ast).includes('testWaitForCanvasReady'))
        return add(n,'original-canvas-ready',number(n.arguments.at(-1),m,20000),multiplier,{});
      if(/^waitFor/.test(name)) {
        const own=m.functions.get(name);const params=own?.parameters??[];
        const timeoutIndex=params.findIndex(p=>/timeoutMs|deadline/.test(p.name.getText(m.ast)));
        const index=timeoutIndex>=0?timeoutIndex:n.arguments.length-1;
        const fallback=number(params[index]?.initializer,m,20000);
        return add(n,'original-wait',number(n.arguments[index],m,fallback),multiplier,{callee:name,
          expression:n.arguments[index]?.getText(m.ast)??'default',defaultMs:fallback});
      }
      if(m.functions.has(name))total+=fn(name,multiplier,chain,bindings,n.arguments);
      else if(name==='extension.activate'||name==='mainExtension.activate'||name==='notifierExtension.activate')
        total+=add(n,'host-activation-reserve',20000,multiplier,{reason:'Host handshake; not a product wait'});
      else if(name==='vscode.commands.executeCommand')total+=add(n,'command-infrastructure-reserve',5000,multiplier,
        {command:n.arguments[0]?.getText(m.ast),reason:'A command returning no timeout is bounded by the original outer case deadline'});
      else if(name==='vscode.window.tabGroups.close')total+=add(n,'command-infrastructure-reserve',5000,multiplier,
        {command:'public target-tab close',reason:'Keeps the original active-editor-close infrastructure reserve; focus preparation shares the original click budget'});
      // Traverse callbacks too: interception helpers execute their caller's body.
      for(const arg of n.arguments)total+=visit(arg,multiplier,chain,bindings);
      return total;
    }
    let total=0;ts.forEachChild(n,child=>{total+=visit(child,multiplier,chain,bindings)});return total;
  }
  const timeoutMs=fn(entry,times);
  assert(timeoutMs > 0 || allowSynchronous, `No bounded calls in ${file} ${scenario}/${entry}`);
  return {timeoutMs,entry,file:m.file,times,method:'Conservative call-site sum; original product waits unchanged',evidence};
}
const suites={};
// Two sequential real providers, each bounded by an actual absolute deadline.
const tuiFile = 'tests/vscode-smoke/agent-tui-tests.cjs';
const tuiSource = fs.readFileSync(tuiFile, 'utf8');
sourceHashes[tuiFile] = hash(tuiSource);
const tuiProviderBudget = Number(tuiSource.match(/const PROVIDER_BUDGET_MS = (\d+);/)[1]);
for (const entry of smokeCatalog.filter(item => item.kind === 'real-tui')) {
  suites[entry.id] = { timeoutMs: tuiProviderBudget * entry.providers.length + 40000,
    method: 'Two fixed provider absolute deadlines plus activation/ready; inner waits cannot renew the deadline',
    evidence: [{ file: tuiFile, kind: 'provider-absolute-deadline', timeoutMs: tuiProviderBudget,
      count: entry.providers.length }, { kind: 'host-ready', timeoutMs: 40000 }] };
}
for (const entry of smokeCatalog.filter(item => item.testFile === 'extension-tests.cjs')) {
  if (entry.kind === 'product-case') {
    const parts = [entry.prepare, entry.entry, 'assertNoOwnedResizeFailures']
      .map(fn => inspectSuite('extension-tests.cjs', entry.id, fn, entry.hostRoles ? 2 : 1, true));
    suites[entry.id] = { timeoutMs: parts.reduce((n, part) => n + part.timeoutMs, 0) + (entry.hostRoles ? 30000 : 0),
      method: 'Independent fixture and business call-site bounds; original product waits unchanged', parts };
  } else suites[entry.id] = inspectSuite('extension-tests.cjs', entry.id);
}
for(const id of ['real-reopen','multi-root-real-reopen','single-to-multi-root-real-reopen','systemd-user-real-reopen','systemd-fallback-real-reopen',
  'remote-ssh-real-reopen-exit','remote-ssh-real-reopen-retain']) {
  suites[id]=inspectSuite('real-reopen-tests.cjs',id); // Both setup/verify branches, including original 45s ready and 35s offline waits.
  if(id.startsWith('remote-')) {suites[id].timeoutMs+=120000+30000;suites[id].evidence.push({kind:'runner-coordination',timeoutMs:150000,
    detail:'Original setup-ready 120s and controlled remote completion 30s'});}
  else {suites[id].timeoutMs+=30000;suites[id].evidence.push({kind:'offline-completion-barrier',timeoutMs:30000,
    detail:'Observe original Host absence and exact original offline session completion; no product wait is extended'});}
}
for(const [id,file,times] of [['two-window-shared-runtime','two-window-shared-runtime-tests.cjs',1],
  ['legacy-supervisor-upgrade','legacy-supervisor-upgrade-tests.cjs',1],['linux-runtime-report-unavailable','runtime-compatibility-tests.cjs',1],
  ['notifier-companion','notifier-companion-tests.cjs',1],['notifier-locale','notifier-locale-tests.cjs',2],['ui-copy-locale','ui-copy-locale-tests.cjs',2]])
  suites[id]=inspectSuite(file,id,'run',times);
for (const [id, file] of [['marketplace-host', 'template-marketplace-tests.cjs'],
  ['marketplace-preview', 'template-marketplace-preview-tests.cjs']]) {
  suites[id] = inspectSuite(file, id);
}
fs.writeFileSync('scripts/smoke/smoke-budget-inventory.json',JSON.stringify({schemaVersion:1,sourceHashes,loopBounds,suites},null,2)+'\n');
console.log(JSON.stringify(Object.fromEntries(Object.entries(suites).map(([id,s])=>[id,s.timeoutMs]))));
