// Node 22，仓库根：xvfb-run -a node <本文件>
// 输入：fa645cfc 的 VSIX smoke-host。产品载荷不改，仅包装原失败断言作定位。
import assert from 'node:assert/strict';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import esbuild from 'esbuild';
import { runVSCodeScenario } from '../../../scripts/smoke/vscode-smoke-runner.mjs';

const projectRoot = process.cwd();
const root = path.join(projectRoot, '.debug/runtime-scrollback-snapshot-rca');
await mkdir(root, { recursive:true });
const host = path.join(root, 'host');
await cp(path.join(projectRoot, '.debug/vscode-vsix-smoke/smoke-host'), host, {recursive:true});
const codecPath = path.join(root, 'current-state-codec.cjs');
await esbuild.build({ entryPoints:[path.join(projectRoot, 'extensions/vscode/dev-session-canvas/src/common/terminalCurrentState.ts')],
  bundle:true, platform:'node', format:'cjs', outfile:codecPath });
const hashes = {};
for (const file of ['extension.js','runtime-supervisor.js','webview.js']) {
  hashes[file] = createHash('sha256').update(await readFile(path.join(host,'dist',file))).digest('hex');
}
await writeFile(path.join(root,'payload-hashes.json'), JSON.stringify(hashes,null,2));
const suitePath = path.join(host,'tests/vscode-smoke/extension-tests.cjs');
let suite = await readFile(suitePath,'utf8');
const entryAnchor = "  if (smokeScenario === 'local-execution-flow') {";
assert.equal(suite.split(entryAnchor).length,2);
suite = suite.replace(entryAnchor,String.raw`
  if (process.env.DEV_SESSION_CANVAS_SCROLLBACK_SNAPSHOT_RCA) {
    try {
      const {terminalNode} = await prepareTrustedBaseNodesForAppliedRuntimePersistenceMode(true);
      await verifyLiveRuntimeReloadPreservesUpdatedTerminalScrollbackHistory(terminalNode.id);
      console.log('Scrollback snapshot investigation: original timeout reproduced; all 220 lines restored from the original paged reader.');
    } finally {
      const nodes = (await getDebugSnapshot()).state.nodes;
      for (const node of nodes) {
        if (node.kind === 'agent') await ensureAgentStopped(node.id);
        else if (node.kind === 'terminal') await ensureTerminalStopped(node.id);
      }
    }
    return;
  }
`+entryAnchor);
const funcStart = suite.indexOf('async function verifyLiveRuntimeReloadPreservesUpdatedTerminalScrollbackHistory(');
const funcEnd = suite.indexOf('async function verifyCompletedLiveRuntimeDiscardsHistoryAfterDrain(',funcStart);
let func = suite.slice(funcStart,funcEnd);
const clearAnchor = "    await clearHostMessages();\n    await requestExecutionSnapshot('terminal', terminalNodeId, 'editor');";
assert.equal(func.split(clearAnchor).length,2);
func = func.replace(clearAnchor,`    const rcaBootstrapMessages = await getHostMessages();\n${clearAnchor}`);
const assertionStart = func.indexOf('    const hostMessages = await waitForHostMessages(',func.indexOf('const rcaBootstrapMessages'));
const assertionEnd = func.indexOf('    await ensureTerminalStopped(terminalNodeId);',assertionStart);
assert.ok(assertionStart>0 && assertionEnd>assertionStart);
const originalAssertion = func.slice(assertionStart,assertionEnd);
const diagnostic = String.raw`
    const rcaAfter = await getHostMessages();
    const requested = rcaAfter.find(m => m.type === 'host/executionSnapshot' &&
      m.payload.kind === 'terminal' && m.payload.nodeId === terminalNodeId &&
      m.payload.executionSessionId === runtimeSessionId);
    assert.ok(requested?.payload.terminalRead, 'Original request must receive its paged snapshot.');
    assert.equal(requested.payload.terminalStream, undefined);
    assert.equal(readTerminalStreamProjectionText(requested.payload.terminalStream), '');
    const descriptor = requested.payload.terminalRead;
    const sameLifecycle = m => JSON.stringify(m.lifecycle) === JSON.stringify(requested.lifecycle);
    const sameReaderPage = m => m.type === 'host/executionTerminalPage' &&
      m.payload.kind === 'terminal' && m.payload.nodeId === terminalNodeId &&
      m.payload.executionSessionId === runtimeSessionId && m.payload.authorityId === descriptor.authorityId &&
      m.payload.readId === descriptor.readId && sameLifecycle(m);
    const bootstrap = rcaBootstrapMessages.find(m => m.type === 'host/executionSnapshot' &&
      m.payload.executionSessionId === runtimeSessionId && m.payload.terminalRead?.readId === descriptor.readId && sameLifecycle(m));
    assert.ok(bootstrap, 'Repeated snapshot must refer to the exact bootstrap reader.');
    assert.deepEqual(bootstrap.payload.terminalRead, descriptor);
    assert.equal(requested.payload.outputSequence, descriptor.checkpoint.revision);
    assert.equal(descriptor.sessionId, runtimeSessionId);
    assert.equal(descriptor.authorityId, descriptor.checkpoint.authorityId);
    const pages = [...rcaBootstrapMessages, ...rcaAfter].filter(sameReaderPage).map(m => m.payload.page);
    assert.ok(pages.length>0 && pages.every(Boolean));
    const chunks = new Map();
    for (const page of pages) {
      if (!page.stateChunk) continue;
      const chunk = page.stateChunk;
      if (chunks.has(chunk.offset)) assert.deepEqual(chunks.get(chunk.offset),chunk);
      chunks.set(chunk.offset,chunk);
      assert.equal(page.events.length,0);
    }
    let offset = 0, serialized = '';
    for (const chunk of [...chunks.values()].sort((a,b)=>a.offset-b.offset)) {
      assert.equal(chunk.offset,offset); serialized += chunk.data; offset += chunk.data.length;
    }
    assert.equal(offset,descriptor.currentState.length);
    assert.equal(descriptor.currentState.format,'xterm-current-state-v1');
    const state = JSON.parse(serialized);
    const {Terminal} = require(process.env.DEV_SESSION_CANVAS_RCA_HEADLESS);
    const {restoreTerminalCurrentState} = require(process.env.DEV_SESSION_CANVAS_RCA_CODEC);
    const terminal = new Terminal({cols:state.cols, rows:state.rows, scrollback:state.scrollback, allowProposedApi:true});
    let markerNumbers;
    try {
      restoreTerminalCurrentState(terminal,state);
      const lines = [];
      for (let i=0; i<terminal.buffer.active.length; i++) lines.push(terminal.buffer.active.getLine(i).translateToString(true));
      await fs.writeFile(path.join(artifactDir, 'decoded-state.json'), JSON.stringify({state,lines,pages}));
      markerNumbers = lines.flatMap(line => {
        const match = line.match(/^DSC_LRSP-([0-9]{3})$/);
        return match ? [Number(match[1])] : [];
      });
      assert.deepEqual(markerNumbers,Array.from({length:markerLineCount},(_,i)=>i+1));
    } finally { terminal.dispose(); }
    const revisions = [...new Set(pages.flatMap(page=>page.events.map(e=>e.revision)))].sort((a,b)=>a-b);
    for (let i=0;i<revisions.length;i++) assert.equal(revisions[i],descriptor.checkpoint.revision+i+1);
    await fs.writeFile(path.join(artifactDir,'scrollback-snapshot-investigation.json'),JSON.stringify({
      originalWaitTimedOut:true, waitMs:Date.now()-rcaWaitStart, runtimeSessionId,
      lifecycle:requested.lifecycle, descriptor, requestedKeys:Object.keys(requested.payload),
      originalPredicateText:'', bootstrapReaderReused:true,
      stateChunks:chunks.size,stateLength:offset, cols:state.cols,rows:state.rows,scrollback:state.scrollback,
      restoredMarkerCount:markerNumbers.length,firstMarker:markerNumbers[0],lastMarker:markerNumbers.at(-1),
      markersContiguousUnique:true,followingRevisions:revisions,
      pagesBeforeRequest:rcaBootstrapMessages.filter(sameReaderPage).length,
      pagesAfterRequest:rcaAfter.filter(sameReaderPage).length
    },null,2));
`;
func = func.slice(0,assertionStart)+`    const rcaWaitStart = Date.now();\n    let rcaOriginalError;\n    try {\n${originalAssertion}    } catch (error) { rcaOriginalError = error; }\n    assert.match(rcaOriginalError?.message ?? '', /Timed out while waiting for host messages/);\n`+diagnostic+func.slice(assertionEnd);
suite=suite.slice(0,funcStart)+func+suite.slice(funcEnd);
await writeFile(suitePath,suite);
await runVSCodeScenario({projectRoot,debugRoot:path.join(root,'native'),runtimeDirName:'dsc-scrollback-snapshot-rca',
  workspacePath:projectRoot,extensionDevelopmentPath:[host,path.join(host,'notifier-extension')],
  extensionTestsPath:suitePath,disableWorkspaceTrust:true,extensionTestsEnv:{
    DEV_SESSION_CANVAS_SMOKE_TEST_MODE:'1',DEV_SESSION_CANVAS_SMOKE_SCENARIO:'local-links-and-stop',
    DEV_SESSION_CANVAS_SCROLLBACK_SNAPSHOT_RCA:'1',DEV_SESSION_CANVAS_RCA_HEADLESS:path.join(projectRoot,'node_modules/@xterm/headless'),
    DEV_SESSION_CANVAS_RCA_CODEC:codecPath,
    DEV_SESSION_CANVAS_TEST_CODEX_COMMAND:path.join(projectRoot,'tests/vscode-smoke/fixtures/fake-agent-provider'),
    DEV_SESSION_CANVAS_TEST_CLAUDE_COMMAND:path.join(projectRoot,'tests/vscode-smoke/fixtures/missing-agent-provider')
  }});
