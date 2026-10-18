import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { readJSON, objectDigest } from './receipts.mjs';
import { runProcess } from './process.mjs';

export const visualTestPattern = 'webview bundle emits ready and matches the baseline screenshot|minimap viewport contrast stays readable';
export function verifyBrowserReport(report,expected) {
  assert.equal(report.schemaVersion, 1); assert.equal(report.status, 'passed');
  assert(Array.isArray(report.expected) && report.expected.length > 0, 'An empty browser suite cannot pass');
  assert.equal(new Set(report.expected.map(test => test.id)).size, report.expected.length);
  assert(Array.isArray(expected)&&expected.length>0,'An independent frozen browser test set is required');
  assert.deepEqual(report.expected.map(test=>test.id).sort(),expected.map(test=>test.id).sort(),
    'Registered browser tests differ from the reviewed catalogue');
  assert.equal(report.results.length, report.expected.length, 'Missing/extra/retried browser test');
  assert.deepEqual(report.results.map(test => test.id).sort(), report.expected.map(test => test.id).sort());
  for (const result of report.results) {
    assert.equal(result.status, 'passed', 'Skipped/expected failures cannot satisfy the formal gate');
    assert.equal(result.expectedStatus, 'passed'); assert.equal(result.retry, 0);
  }
  return { count: report.results.length, testSetDigest: objectDigest(report.expected) };
}
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
const { values } = parseArgs({ options: { kind: { type: 'string' }, output: { type: 'string' }, deadline: { type: 'string' } } });
assert(['functional', 'visual'].includes(values.kind) && values.output);
const reportPath = path.resolve(values.output, 'playwright-execution.json');
const catalog=await readJSON(new URL('./browser-catalog.json',import.meta.url));
const installed=await readJSON('node_modules/playwright/package.json');
assert.equal(installed.version,catalog.playwrightVersion,'Browser catalogue uses the locked Playwright');
const visual=new RegExp(visualTestPattern);
const expected=catalog.tests.filter(test=>visual.test(test.title)===(values.kind==='visual'));
const args = ['node_modules/playwright/cli.js', 'test', '--config=playwright.config.mjs',
  '--output', path.resolve(values.output, 'failure-artifacts'),
  '--reporter=list,./scripts/gates/playwright-reporter.cjs', '--retries=0','--workers=2','--forbid-only',
  '--update-snapshots=none',
  values.kind === 'visual' ? '--grep' : '--grep-invert', visualTestPattern];
const deadline=values.deadline??process.env.DEV_SESSION_CANVAS_GATE_DEADLINE;
assert(deadline, 'Browser runner must inherit the original task deadline');
const result = await runProcess(process.execPath, args, { deadline: Number(deadline),
  env: { ...process.env, DEV_SESSION_CANVAS_PLAYWRIGHT_RECEIPT: reportPath },
  logPath: path.resolve(values.output, 'playwright.log') });
assert.equal(result.status, 'passed');
console.log(JSON.stringify(verifyBrowserReport(await readJSON(reportPath),expected)));
}
