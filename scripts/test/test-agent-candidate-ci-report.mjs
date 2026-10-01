import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { writeAgentCandidateCIReport } from '../smoke/agent-candidate-ci-report.mjs';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dsc-agent-ci-report-test-'));
const key = 'sk-test-only-do-not-use-12345';
const scenarios = ['codex', 'claude'].flatMap(provider => ['live-runtime', 'snapshot-only'].flatMap(mode =>
  ['natural', 'stop'].map(lifecycle => ({ name: `${provider}-${mode}-${lifecycle}`, state: 'passed' }))));
try {
  for (const scenario of scenarios) {
    const artifacts = path.join(root, 'evidence', scenario.name, 'artifacts');
    await fs.mkdir(artifacts, { recursive: true });
    await fs.writeFile(path.join(artifacts, 'result.json'), JSON.stringify({ pass: true, cliObserved: true,
      naturalResponseVerified: scenario.name.endsWith('natural'), error: `must not publish ${key}` }));
    await fs.writeFile(path.join(artifacts, 'host-received-output.txt'), `nonce and private data ${key}`);
    await fs.writeFile(path.join(artifacts, 'cleanup.json'), JSON.stringify({ runtime: { bindings: [] },
      process: { entries: [], failures: [] }, forcedSignals: [] }));
  }
  const options = { output: path.join(root, 'evidence'), scenarios, phase: 'complete', failed: false, apiKey: key };
  const directory = path.join(root, 'report');
  await writeAgentCandidateCIReport({ ...options, directory });
  const text = await fs.readFile(path.join(directory, 'summary.json'), 'utf8');
  const summary = JSON.parse(text);
  assert.equal(summary.pass, true);
  assert.equal(summary.scenarios.length, 8);
  assert.equal(summary.scenarios[0].cleanup.forcedSignals, 0);
  assert.equal(summary.scenarios[0].sourceDisposition, null, 'Do not infer EOF from pass or exit.');
  assert.equal(text.includes(key), false);
  assert.equal(text.includes('private data'), false);
  assert.equal(summary.scenarios[0].receivedOutput.sha256.length, 64);
  await assert.rejects(writeAgentCandidateCIReport({ ...options, directory }), { code: 'EEXIST' });
  const failedDirectory = path.join(root, 'failure-report');
  await writeAgentCandidateCIReport({ ...options, directory: failedDirectory, failed: true, phase: 'prepare', scenarios: [] });
  assert.equal(JSON.parse(await fs.readFile(path.join(failedDirectory, 'summary.json'), 'utf8')).pass, false);
  const rejectedDirectory = path.join(root, 'rejected-report');
  await assert.rejects(writeAgentCandidateCIReport({ ...options, directory: rejectedDirectory, apiKey: 'deepseek' }),
    /publication refused/);
  await assert.rejects(fs.stat(rejectedDirectory), { code: 'ENOENT' });
  console.log('Agent candidate CI report: fixed fields, missing evidence, failed run, and secret refusal passed.');
} finally {
  await fs.rm(root, { recursive: true, force: true });
}
