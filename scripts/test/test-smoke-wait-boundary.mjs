import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile('tests/vscode-smoke/extension-tests.cjs', 'utf8');
const cases = [
  { name: 'first observation matches', reads: [{ ms: 0, match: true }], expectedTime: 0 },
  { name: 'first observation matches on deadline', reads: [{ ms: 100, match: true }], expectedTime: 100 },
  { name: 'first observation matches across deadline', reads: [{ ms: 101, match: true }], expectedTime: 101 },
  { name: 'first observation misses across deadline', reads: [{ ms: 101 }], expectedTime: 101, fails: true },
  { name: 'ordinary next observation matches', timeout: 1000, reads: [{ ms: 0 }, { ms: 0, match: true }], sleeps: [100], expectedTime: 100 },
  { name: 'final observation matches on deadline', reads: [{ ms: 0 }, { ms: 0, match: true }], sleeps: [100], expectedTime: 100 },
  { name: 'final observation matches across deadline', reads: [{ ms: 0 }, { ms: 1, match: true }], sleeps: [100], expectedTime: 101 },
  { name: 'final observation misses on deadline', reads: [{ ms: 0 }, { ms: 0 }], sleeps: [100], expectedTime: 100, fails: true },
  { name: 'final observation misses across deadline', reads: [{ ms: 0 }, { ms: 1 }], sleeps: [100], expectedTime: 101, fails: true },
  { name: 'sleep uses remaining budget', timeout: 70, reads: [{ ms: 20 }, { ms: 0, match: true }], sleeps: [50], expectedTime: 70 },
  { name: 'sleep overshoot still inspects final match', timeout: 70, overshoot: 30, reads: [{ ms: 20 }, { ms: 0, match: true }], sleeps: [50], expectedTime: 100 },
  { name: 'sleep overshoot misses without retry', timeout: 70, overshoot: 30, reads: [{ ms: 20 }, { ms: 0 }], sleeps: [50], expectedTime: 100, fails: true },
  { name: 'all unmatched observations fail without extra reads', timeout: 250, reads: [{ ms: 0 }, { ms: 50 }, { ms: 0 }], sleeps: [100, 100], expectedTime: 250, fails: true },
  { name: 'zero budget still inspects first match', timeout: 0, reads: [{ ms: 0, match: true }], expectedTime: 0 },
  { name: 'zero budget misses without polling', timeout: 0, reads: [{ ms: 0 }], expectedTime: 0, fails: true },
  { name: 'first read error propagates', reads: [{ ms: 0, error: true }], expectedTime: 0, error: true },
  { name: 'final read error propagates', reads: [{ ms: 0 }, { ms: 1, error: true }], sleeps: [100], expectedTime: 101, error: true },
  { name: 'default budget remains unchanged', useDefault: true, sleeps: [10], fails: true }
];

let passed = 0;
for (const [name, next, reader, defaultBudget, isEvents] of [
  ['waitForSnapshot', 'async function waitForDiagnosticEvents(', 'getDebugSnapshot', 15000, false],
  ['waitForDiagnosticEvents', 'function cloneJsonValue(', 'getDiagnosticEvents', 8000, true]
]) {
  const start = source.indexOf(`async function ${name}(`);
  const end = source.indexOf(`\n${next}`, start);
  assert(start >= 0 && end > start, `Cannot find exact ${name} helper`);
  const helper = source.slice(start, end);
  for (const scenario of cases) {
    const reads = scenario.useDefault ? [{ ms: defaultBudget - 10 }, { ms: 0 }] : scenario.reads;
    let now = 0, readCount = 0, predicateCalls = 0, lastValue;
    const sleeps = [], readError = new Error('diagnostic read failed');
    const context = vm.createContext({ assert, Date: { now: () => now },
      [reader]: async () => {
        assert(readCount < reads.length, `${name}: unexpected extra read`);
        const input = reads[readCount++];
        now += input.ms;
        if (input.error) throw readError;
        const value = { marker: `observation-${readCount}`, matches: input.match === true };
        lastValue = isEvents ? [value] : value;
        return lastValue;
      },
      sleep: async ms => { sleeps.push(ms); now += ms + (scenario.overshoot ?? 0); }
    });
    const run = vm.runInContext(`${helper}\n${name}`, context);
    const predicate = value => { predicateCalls++; return isEvents ? value.some(event => event.matches) : value.matches; };
    const operation = () => scenario.useDefault ? run(predicate) : run(predicate, scenario.timeout ?? 100);
    if (scenario.error) {
      await assert.rejects(operation, error => error === readError);
    } else if (scenario.fails) {
      await assert.rejects(operation, error => {
        assert.match(error.message, /Timed out while waiting for/);
        assert(error.message.endsWith(JSON.stringify(lastValue)), 'Failure must retain the final observation');
        return true;
      });
    } else {
      assert.equal(await operation(), lastValue, 'Return the matching observation unchanged');
    }
    assert.equal(readCount, reads.length, `${name}: ${scenario.name}`);
    assert.equal(predicateCalls, readCount - (scenario.error ? 1 : 0), 'Every completed observation must be inspected exactly once');
    assert.deepEqual(sleeps, scenario.sleeps ?? [], `${name}: ${scenario.name}`);
    assert.equal(now, scenario.useDefault ? defaultBudget : scenario.expectedTime);
    console.log(`PASS ${name}: ${scenario.name}`);
    passed++;
  }
}
console.log(`Smoke wait boundary tests passed (${passed}).`);
