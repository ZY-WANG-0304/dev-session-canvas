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
  assert.equal(summary.scenarios[0].cliEvidence.lastMessageMatches, null);
  await assert.rejects(writeAgentCandidateCIReport({ ...options, directory }), { code: 'EEXIST' });
  const failedDirectory = path.join(root, 'failure-report');
  await writeAgentCandidateCIReport({ ...options, directory: failedDirectory, failed: true, phase: 'prepare', scenarios: [] });
  assert.equal(JSON.parse(await fs.readFile(path.join(failedDirectory, 'summary.json'), 'utf8')).pass, false);
  const rejectedDirectory = path.join(root, 'rejected-report');
  await assert.rejects(writeAgentCandidateCIReport({ ...options, directory: rejectedDirectory, apiKey: 'deepseek' }),
    /publication refused/);
  await assert.rejects(fs.stat(rejectedDirectory), { code: 'ENOENT' });
  const scenario = { ...scenarios[0], nonce: 'DSC_FIXED_NONCE', state: 'failed' };
  const artifacts = path.join(options.output, scenario.name, 'artifacts');
  await fs.writeFile(path.join(artifacts, 'result.json'), JSON.stringify({ pass: false, naturalResponseVerified: false }));
  await fs.writeFile(path.join(artifacts, 'host-received-output.txt'), [
    { type: 'item.completed', item: { type: 'error', message: 'Model metadata for `deepseek-flash` not found. Defaulting to fallback metadata; this can degrade performance and cause issues.' } },
    { type: 'item.completed', item: { type: 'agent_message', text: scenario.nonce } },
    { type: 'turn.completed' },
    { type: 'error', message: key }
  ].map(value => JSON.stringify(value)).join('\r\n'));
  await fs.writeFile(path.join(artifacts, 'codex-final-message.txt'), `${scenario.nonce}\n`);
  await fs.writeFile(path.join(artifacts, 'first-failure.json'), JSON.stringify({ nodeId: 'n1', executionId: 'e1', error: key,
    stack: `Error: ${key}\n at run (/private/${key}/agent-candidate-tests.cjs:164:7)` }));
  await fs.writeFile(path.join(artifacts, 'first-failure-snapshot.json'), JSON.stringify({ state: { nodes: [
    { id: 'n1', status: 'stopped', metadata: { agent: { liveSession: false, lastExitCode: 0, outputSequence: 3,
      serializedTerminalState: { data: key } } } }
  ] } }));
  await fs.writeFile(path.join(artifacts, 'first-failure-events.json'), JSON.stringify([
    { kind: 'runtime/terminalSourceDisposition', detail: { nodeId: 'other', sessionId: 'e1', sourceDisposition: { kind: 'error' } } },
    { kind: 'runtime/terminalSourceDisposition', detail: { nodeId: 'n1', sessionId: 'e1', sourceDisposition: { kind: 'eof' } } }
  ]));
  const warningDirectory = path.join(root, 'warning-report');
  await writeAgentCandidateCIReport({ ...options, directory: warningDirectory, scenarios: [scenario], failed: true });
  const warningText = await fs.readFile(path.join(warningDirectory, 'summary.json'), 'utf8');
  const warningReport = JSON.parse(warningText);
  assert.equal(warningReport.pass, false, 'A response or EOF must not override a failed acceptance assertion.');
  assert.equal(warningReport.scenarios[0].naturalResponseVerified, false);
  assert.equal(warningReport.scenarios[0].sourceDisposition, 'eof');
  assert.deepEqual(warningReport.scenarios[0].failureLocation, { file: 'agent-candidate-tests.cjs', line: 164, column: 7 });
  assert.deepEqual(warningReport.scenarios[0].failureState, { status: 'stopped', liveSession: false,
    exitCode: 0, outputSequence: 3, serializedStatePresent: true,
    serializedStateBytes: Buffer.byteLength(key), readerSettlementObserved: false,
    readerSettlementKind: null, readerFinalOutputSequence: null });
  assert.deepEqual(warningReport.scenarios[0].cliEvidence, { turnCompleted: true, turnFailed: false,
    expectedResponseInOutput: true, lastMessageMatches: true, modelMetadataFallback: true });
  assert.equal(warningText.includes(key), false);
  assert.equal(warningText.includes(scenario.nonce), false);
  assert.equal(warningText.includes('Defaulting to fallback metadata'), false);
  const enumCases = [
    { status: 'starting', outcome: 'lost', local: true },
    { status: 'waiting-input', outcome: 'cancelled', local: false },
    { status: 'stopping', outcome: 'applied', local: true },
    { status: 'resume-failed', outcome: 'legacy-released', local: false },
    { status: 'waiting', outcome: 'unknown', local: true, unsupported: true },
    { status: key, outcome: key, local: false, unsupported: true }
  ];
  for (const [index, entry] of enumCases.entries()) {
    await fs.writeFile(path.join(artifacts, 'first-failure-snapshot.json'), JSON.stringify({ state: { nodes: [
      { id: 'n1', status: entry.status, metadata: { agent: { liveSession: true } } }
    ] } }));
    await fs.writeFile(path.join(artifacts, 'first-failure-events.json'), JSON.stringify([
      { kind: entry.local ? 'execution/localTerminalReaderSettled' : 'runtime/terminalReadSettled',
        detail: { nodeId: 'n1', ...(entry.local ? { executionSessionId: 'e1' } : { sessionId: 'e1' }),
          outcome: { kind: entry.outcome, reason: key } } }
    ]));
    const enumDirectory = path.join(root, `enum-report-${index}`);
    await writeAgentCandidateCIReport({ ...options, directory: enumDirectory, scenarios: [scenario], failed: true });
    const enumText = await fs.readFile(path.join(enumDirectory, 'summary.json'), 'utf8');
    const failureState = JSON.parse(enumText).scenarios[0].failureState;
    assert.equal(failureState.status, entry.unsupported ? null : entry.status);
    assert.equal(failureState.readerSettlementObserved, true);
    assert.equal(failureState.readerSettlementKind, entry.unsupported ? null : entry.outcome);
    assert.equal(enumText.includes(key), false, 'Unknown status, outcome and reason text must remain private.');
  }
  console.log('Agent candidate CI report: fixed fields, missing evidence, failed run, and secret refusal passed.');
} finally {
  await fs.rm(root, { recursive: true, force: true });
}
