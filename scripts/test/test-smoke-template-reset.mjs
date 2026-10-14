import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const { resetCanvasAfterFinalPersistence } = require('../../tests/vscode-smoke/reset-canvas.cjs');
const source = await readFile('tests/vscode-smoke/extension-tests.cjs', 'utf8');
const parsed = ts.createSourceFile('extension-tests.cjs', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const templateTest = parsed.statements.find(statement => ts.isFunctionDeclaration(statement)
  && statement.name?.text === 'verifyCanvasTemplatesTrusted');
assert.ok(templateTest?.body, 'The template smoke function must be present.');
const statements = [...templateTest.body.statements];
const exportIndex = statements.findIndex(statement => statement.getText(parsed)
  .includes('await exportCanvasTemplateToPathForTest('));
assert.ok(exportIndex >= 0, 'The original template export must be present.');
assert.match(statements[exportIndex + 1].getText(parsed), /existsSync\(exportPath\)/);
const cleanup = statements[exportIndex + 2].getText(parsed);
const ready = statements[exportIndex + 3].getText(parsed);
assert.match(ready, /await ensureEditorCanvasReady\(\)/);

// Execute the actual cleanup and continuation statements, rather than a copy of the fix.
const runCleanup = new vm.Script(`(async scope => {
  const { vscode, COMMAND_IDS, resetCanvasAfterFinalPersistence, getDebugSnapshot,
    getDiagnosticEvents, agentNode, terminalNode, ensureEditorCanvasReady } = scope;
  let snapshot;
  ${cleanup}
  ${ready}
  return snapshot;
})`).runInThisContext();

function fixture({ pendingKind, saveResult = 'saved', foreignPending = false, missingTerminal = false } = {}) {
  const agentNode = { kind: 'agent', id: 'template-agent' };
  const terminalNode = { kind: 'terminal', id: 'template-terminal' };
  const originalNodes = [agentNode, terminalNode, { kind: 'note', id: 'template-note' }];
  let nodes = originalNodes, resets = 0, readyCalls = 0, reads = 0, clock = 0;
  const key = `${pendingKind}:${foreignPending ? 'other-node' : `${pendingKind === 'agent' ? 'template-agent' : 'template-terminal'}`}`;
  const pending = new Error(`Local final snapshot persistence is pending: ${key}`);
  const result = (node, kind) => ({ kind: 'execution/localFinalPersistence', detail: {
    kind: node.kind, nodeId: node.id, executionId: `original-${node.id}`, generation: 'original-generation',
    submitted: kind === 'saved', result: { kind }
  } });
  const getDebugSnapshot = async () => ({ state: { nodes } });
  const scope = {
    agentNode, terminalNode, COMMAND_IDS: { testResetState: 'test.reset' }, getDebugSnapshot,
    getDiagnosticEvents: async () => {
      reads++;
      if (reads === 1) return [];
      return [result(agentNode, pendingKind === 'agent' ? saveResult : 'saved'),
        ...(missingTerminal ? [] : [result(terminalNode, pendingKind === 'terminal' ? saveResult : 'not-required')])];
    },
    vscode: { commands: { executeCommand: async id => {
      assert.equal(id, 'test.reset');
      resets++;
      if (pendingKind && resets === 1) throw pending;
      nodes = [];
    } } },
    resetCanvasAfterFinalPersistence: options => {
      assert.deepEqual(options.expectedExecutions, [agentNode, terminalNode], 'Only the original template executions authorize cleanup.');
      return resetCanvasAfterFinalPersistence({ ...options,
        now: () => clock, sleep: async ms => { clock += ms; } });
    },
    ensureEditorCanvasReady: async () => {
      readyCalls++;
      assert.equal(nodes.length, 0, 'The next template phase must start with an empty canvas.');
    }
  };
  return { run: () => runCleanup(scope), pending, resets: () => resets, readyCalls: () => readyCalls,
    assertOriginalNodes: () => assert.deepEqual(nodes, originalNodes) };
}

const tests = [];
const test = (name, run) => tests.push({ name, run });
test('template export cleanup continues after one successful reset', async () => {
  const f = fixture(); await f.run();
  assert.equal(f.resets(), 1); assert.equal(f.readyCalls(), 1);
});
for (const pendingKind of ['agent', 'terminal']) {
  test(`template export cleanup waits for original ${pendingKind} save before one new reset`, async () => {
    const f = fixture({ pendingKind }); await f.run();
    assert.equal(f.resets(), 2); assert.equal(f.readyCalls(), 1);
  });
  for (const saveResult of ['failed', 'unconfirmed']) {
    test(`template export cleanup retains nodes when ${pendingKind} save is ${saveResult}`, async () => {
      const f = fixture({ pendingKind, saveResult });
      await assert.rejects(f.run(), /Final persistence did not succeed/);
      assert.equal(f.resets(), 1); assert.equal(f.readyCalls(), 0); f.assertOriginalNodes();
    });
  }
}
test('another execution cannot authorize template cleanup retry', async () => {
  const f = fixture({ pendingKind: 'agent', foreignPending: true });
  await assert.rejects(f.run(), error => error === f.pending);
  assert.equal(f.resets(), 1); assert.equal(f.readyCalls(), 0); f.assertOriginalNodes();
});
test('missing original Terminal save cannot be replaced by Agent success', async () => {
  const f = fixture({ pendingKind: 'agent', missingTerminal: true });
  await assert.rejects(f.run(), /Timed out/);
  assert.equal(f.resets(), 1); assert.equal(f.readyCalls(), 0); f.assertOriginalNodes();
});
for (const { name, run } of tests) { await run(); console.log(`ok - ${name}`); }
console.log(`Smoke template reset: ${tests.length}/${tests.length} passed.`);
