import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { createHash } from 'node:crypto';

// Evaluate the exact repository helper; time and diagnostic retrieval are controlled inputs.
const source = await readFile('tests/vscode-smoke/extension-tests.cjs', 'utf8');
const start = source.indexOf('async function waitForDiagnosticEvents(');
const end = source.indexOf('\nfunction cloneJsonValue', start);
assert(start >= 0 && end > start);
const helper = source.slice(start, end);
const event = { kind: 'execution/linkOpened', detail: { kind: 'terminal', nodeId: 'terminal-original',
  text: 'missing-target.ts:9:3', linkKind: 'search', openerKind: 'workbench.action.quickOpen' } };
const matches = events => events.some(e => e.kind === event.kind && Object.keys(event.detail).every(k => e.detail?.[k] === event.detail[k]));
const results = [];
for (const test of [
  {name: 'matching fetch within budget', firstFetchMs: 0, finalFetchMs: 99, matches: true, expected: 'passed'},
  {name: 'matching fetch on deadline', firstFetchMs: 0, finalFetchMs: 100, matches: true, expected: 'failed'},
  {name: 'matching fetch crosses deadline', firstFetchMs: 0, finalFetchMs: 101, matches: true, expected: 'failed'},
  {name: 'first matching fetch crosses deadline', firstFetchMs: 101, finalFetchMs: 0, matches: true, expected: 'failed'},
  {name: 'nonmatching fetch crosses deadline', firstFetchMs: 0, finalFetchMs: 101, matches: false, expected: 'failed'}
]) {
  let now = 0, reads = 0, predicateCalls = 0;
  const context = vm.createContext({ assert, Date: { now: () => now },
    getDiagnosticEvents: async () => {
      reads++;
      if (reads === 1) {now += test.firstFetchMs; return test.firstFetchMs > 0 && test.matches ? [event] : [];}
      now = test.finalFetchMs;
      return test.matches ? [event] : [];
    }, sleep: async () => { now += 1; } });
  const run = vm.runInContext(helper+'\nwaitForDiagnosticEvents', context);
  let outcome = 'passed', error;
  try {await run(events => {predicateCalls++; return matches(events);}, 100);}
  catch(e) {outcome = 'failed';error = e.message;}
  assert.equal(outcome,test.expected,test.name);
  results.push({...test, outcome, reads, predicateCalls, finalMatching: test.matches, now, error});
}
console.log(JSON.stringify({helperSha256: createHash('sha256').update(helper).digest('hex'),results},null,2));
