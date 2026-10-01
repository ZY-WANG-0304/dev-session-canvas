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
  assert.equal(summary.platform, 'unknown', 'Do not label legacy evidence as a newly tested platform.');
  const macDirectory = path.join(root, 'darwin-report');
  await writeAgentCandidateCIReport({ ...options, directory: macDirectory, input: { platform: 'darwin' } });
  assert.equal(JSON.parse(await fs.readFile(path.join(macDirectory, 'summary.json'), 'utf8')).platform, 'darwin');
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
  await fs.writeFile(path.join(artifacts, 'process-observations.json'), JSON.stringify({ failures: [], entries: [
    { platform: 'win32', role: 'cli', active: true, hasExited: true, exitConfirmed: true, exitCode: 0 },
    { platform: 'win32', role: 'wrapper', active: false, state: 'Z', hasExited: false, exitConfirmed: false },
    { platform: 'win32', role: 'provider', active: false, hasExited: true, exitConfirmed: true, exitCode: 0,
      observationUnknown: true }
  ] }));
  const windowsDirectory = path.join(root, 'windows-report');
  await writeAgentCandidateCIReport({ ...options, directory: windowsDirectory, scenarios: [scenario], failed: true,
    input: { platform: 'win32' } });
  const windowsReport = JSON.parse(await fs.readFile(path.join(windowsDirectory, 'summary.json'), 'utf8'));
  assert.equal(windowsReport.platform, 'win32');
  assert.equal(windowsReport.pass, false);
  assert.equal(windowsReport.scenarios[0].cleanup.windowsObservationComplete, false);
  assert.equal(windowsReport.scenarios[0].cleanup.remainingActiveProcesses, null,
    'An incomplete Windows observation must not claim that unobserved objects have exited.');
  assert.equal(windowsReport.scenarios[0].cleanup.windowsUnknownProcesses, 1);
  assert.equal(windowsReport.scenarios[0].cleanup.windowsUnconfirmedExits, null);
  await fs.writeFile(path.join(artifacts, 'process-observations.json'), JSON.stringify({ failures: [], entries: [
    { role: 'host' }, { role: 'supervisor' },
    { role: 'provider', active: true, hasExited: true, exitConfirmed: true, exitCode: 0 },
    { role: 'cli', active: true, hasExited: true, exitConfirmed: true, exitCode: 0 },
    { role: 'wrapper', wrapperKind: 'cmd', active: false, state: 'Z', hasExited: false, exitConfirmed: false },
    { role: 'wrapper', wrapperKind: 'node', active: true, hasExited: true, exitConfirmed: true, exitCode: 0 }
  ].map(value => ({ platform: 'win32', ...value })) }));
  const windowsCompleteDirectory = path.join(root, 'windows-complete-observation-report');
  await writeAgentCandidateCIReport({ ...options, directory: windowsCompleteDirectory, scenarios: [scenario], failed: true,
    input: { platform: 'win32' } });
  const windowsCompleteReport = JSON.parse(await fs.readFile(path.join(windowsCompleteDirectory, 'summary.json'), 'utf8'));
  assert.equal(windowsCompleteReport.scenarios[0].cleanup.windowsObservationComplete, true);
  assert.equal(windowsCompleteReport.scenarios[0].cleanup.remainingActiveProcesses, 1);
  assert.equal(windowsCompleteReport.scenarios[0].cleanup.windowsUnconfirmedExits, 1,
    'Use final original-handle facts, not an empty earlier cleanup snapshot or Unix absence/zombie states.');
  await fs.writeFile(path.join(artifacts, 'process-observations.json'), JSON.stringify({ error: 'unknown',
    failures: [{ kind: 'helper-failed' }], entries: [] }));
  const windowsEmptyDirectory = path.join(root, 'windows-empty-observation-report');
  await writeAgentCandidateCIReport({ ...options, directory: windowsEmptyDirectory, scenarios: [scenario], failed: true,
    input: { platform: 'win32' } });
  const windowsEmptyReport = JSON.parse(await fs.readFile(path.join(windowsEmptyDirectory, 'summary.json'), 'utf8'));
  assert.equal(windowsEmptyReport.scenarios[0].cleanup.windowsObservationComplete, false);
  assert.equal(windowsEmptyReport.scenarios[0].cleanup.remainingActiveProcesses, null);
  for (const [index, entry] of [
    { action: 'unknown-identity-no-signal', forced: 0, unconfirmed: 0 },
    { action: 'terminated-original-handle', forced: 1, unconfirmed: 0 },
    { action: 'original-handle-signal-unconfirmed', forced: null, unconfirmed: 1 },
    { action: key, forced: null, unconfirmed: 1 }
  ].entries()) {
    await fs.writeFile(path.join(artifacts, 'remaining-resources.json'), JSON.stringify({
      forcedSignals: [{ action: entry.action, pid: 1234, path: key }] }));
    await fs.writeFile(path.join(artifacts, 'process-observations.json'), JSON.stringify({ error: key, entries: [],
      failures: [{ kind: 'helper-request-failed', error: key }, { kind: key }],
      samples: [{ operation: 'launch', complete: true }, { operation: 'sample', error: key }, { operation: key }] }));
    const target = path.join(root, `cleanup-actions-${index}`);
    await writeAgentCandidateCIReport({ ...options, directory: target, scenarios: [scenario], failed: true,
      input: { platform: 'win32' } });
    const safeText = await fs.readFile(path.join(target, 'summary.json'), 'utf8');
    const row = JSON.parse(safeText).scenarios[0];
    assert.equal(row.cleanup.forcedSignals, entry.forced);
    assert.equal(row.cleanup.unconfirmedSignals, entry.unconfirmed);
    assert.deepEqual(row.cleanup.cleanupActionKinds, [entry.action === key ? 'unclassified' : entry.action]);
    assert.deepEqual(row.processObservation, { failureKinds: ['helper-request-failed', 'unclassified'],
      failedOperations: ['sample', 'unclassified'] });
    assert.equal(safeText.includes(key), false);
  }
  await fs.unlink(path.join(artifacts, 'remaining-resources.json'));
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
  const stopped = { ...scenarios.find(value => value.name === 'codex-snapshot-only-stop'), state: 'failed' };
  const stopArtifacts = path.join(options.output, stopped.name, 'artifacts');
  const snapshotEvidence = { schemaVersion: 1, savedStatePresent: true, savedStateValid: true, savedDataBytes: 0,
    savedOutputSequence: 15, snapshotOutputSequence: 15, readerFinalOutputSequence: 15, sequenceMatched: true,
    savedDataSha256: 'a'.repeat(64), helperSha256: 'b'.repeat(64), replayComplete: true,
    replayReason: 'complete', replayMatchesSaved: true, savedMatchesPage: true, replayMatchesPage: true,
    replayInactivePrefixSnapshots: 1, replayEquivalentInitialSnapshots: 1, replayInitialZeroSequenceInferred: true,
    savedGeometry: { cols: 66, rows: 21, cursorX: 0, cursorY: 0, viewportY: 0, bufferType: 'normal', raw: key },
    pageGeometry: { cols: 96, rows: 30, cursorX: 0, cursorY: 0, viewportY: 0, bufferType: 'normal' },
    publishedGeometry: { cols: 66, rows: 21, raw: key },
    pageGeometryMatches: { cols: false, rows: false, cursorX: true, cursorY: true, viewportY: true, bufferType: true, raw: key },
    resizedSavedPageGeometryMatched: true, resizedSavedPageVisibleMatched: true,
    resizedSavedPageBufferMatched: true, resizedSavedMatchesPage: true,
    pageProjectionIndependence: 'not-proven', raw: key, snapshot: { data: key }, error: key };
  await fs.writeFile(path.join(stopArtifacts, 'snapshot-evidence.json'), JSON.stringify(snapshotEvidence));
  await fs.writeFile(path.join(stopArtifacts, 'result.json'), JSON.stringify({ pass: false }));
  const snapshotDirectory = path.join(root, 'snapshot-report');
  await writeAgentCandidateCIReport({ ...options, directory: snapshotDirectory, scenarios: [stopped], failed: true });
  const snapshotText = await fs.readFile(path.join(snapshotDirectory, 'summary.json'), 'utf8');
  const snapshotReport = JSON.parse(snapshotText);
  assert.equal(snapshotReport.pass, false, 'A diagnostic match must not turn the retained truthy assertion green.');
  assert.equal(snapshotReport.scenarios[0].pass, false);
  assert.equal(snapshotReport.scenarios[0].snapshotEvidence.savedDataBytes, 0);
  assert.equal(snapshotReport.scenarios[0].snapshotEvidence.replayMatchesSaved, true);
  assert.equal(snapshotReport.scenarios[0].snapshotEvidence.pageProjectionIndependence, 'not-proven');
  assert.equal(snapshotReport.scenarios[0].snapshotEvidence.savedDataSha256, 'a'.repeat(64));
  assert.equal(snapshotReport.scenarios[0].snapshotEvidence.replayInitialZeroSequenceInferred, true);
  assert.equal(snapshotReport.scenarios[0].snapshotEvidence.replayEquivalentInitialSnapshots, 1);
  assert.deepEqual(snapshotReport.scenarios[0].snapshotEvidence.savedGeometry,
    { cols: 66, rows: 21, cursorX: 0, cursorY: 0, viewportY: 0, bufferType: 'normal' });
  assert.deepEqual(snapshotReport.scenarios[0].snapshotEvidence.publishedGeometry, { cols: 66, rows: 21 });
  assert.deepEqual(snapshotReport.scenarios[0].snapshotEvidence.pageGeometryMatches,
    { cols: false, rows: false, cursorX: true, cursorY: true, viewportY: true, bufferType: true });
  assert.equal(snapshotReport.scenarios[0].snapshotEvidence.resizedSavedMatchesPage, true);
  assert.equal(snapshotText.includes(key), false);
  assert.equal(snapshotReport.scenarios[0].snapshotEvidence.raw, undefined);
  assert.equal(snapshotReport.scenarios[0].snapshotEvidence.snapshot, undefined);
  await fs.writeFile(path.join(stopArtifacts, 'snapshot-evidence.json'), JSON.stringify({ ...snapshotEvidence,
    replayReason: key, replayMatchesSaved: key, savedDataBytes: -1, savedDataSha256: key,
    replayInitialZeroSequenceInferred: key, replayInactivePrefixSnapshots: -1,
    savedGeometry: { cols: key, rows: -1, cursorX: key, bufferType: key }, pageGeometry: key,
    publishedGeometry: { cols: key, rows: -1, raw: key }, pageGeometryMatches: { cols: key, raw: key },
    resizedSavedPageGeometryMatched: key, resizedSavedPageVisibleMatched: key,
    resizedSavedPageBufferMatched: key, resizedSavedMatchesPage: key,
    pageProjectionIndependence: 'independent', helperSha256: `invalid ${key}` }));
  const invalidSnapshotDirectory = path.join(root, 'invalid-snapshot-report');
  await writeAgentCandidateCIReport({ ...options, directory: invalidSnapshotDirectory, scenarios: [stopped], failed: true });
  const invalidSnapshotText = await fs.readFile(path.join(invalidSnapshotDirectory, 'summary.json'), 'utf8');
  const invalidSnapshot = JSON.parse(invalidSnapshotText).scenarios[0].snapshotEvidence;
  for (const field of ['replayReason', 'replayMatchesSaved', 'savedDataBytes', 'savedDataSha256',
    'pageProjectionIndependence', 'helperSha256', 'replayInitialZeroSequenceInferred', 'replayInactivePrefixSnapshots',
    'resizedSavedPageGeometryMatched', 'resizedSavedPageVisibleMatched', 'resizedSavedPageBufferMatched',
    'resizedSavedMatchesPage', 'pageGeometry']) assert.equal(invalidSnapshot[field], null, field);
  assert.deepEqual(invalidSnapshot.savedGeometry,
    { cols: null, rows: null, cursorX: null, cursorY: null, viewportY: null, bufferType: null });
  assert.deepEqual(invalidSnapshot.publishedGeometry, { cols: null, rows: null });
  assert.deepEqual(invalidSnapshot.pageGeometryMatches,
    { cols: null, rows: null, cursorX: null, cursorY: null, viewportY: null, bufferType: null });
  assert.equal(invalidSnapshotText.includes(key), false);
  for (const entry of scenarios) await fs.writeFile(path.join(options.output, entry.name, 'artifacts', 'result.json'),
    JSON.stringify({ pass: true }));
  const reopenFields = ['attempted', 'newHost', 'sameRuntime', 'sameWorkspace', 'sameUserData', 'persistedNodeLoaded',
    'stoppedNodeRetained', 'emptyStateRetained', 'sequenceRetained', 'freshPage', 'pageBufferEmpty',
    'pageCursorOrigin', 'pageViewportOrigin', 'pageNormalBuffer', 'noNewExecution', 'cleanupComplete'];
  await fs.writeFile(path.join(stopArtifacts, 'result.json'), JSON.stringify({ pass: true, reopenRequired: true }));
  const missingReopenDirectory = path.join(root, 'missing-reopen-report');
  await writeAgentCandidateCIReport({ ...options, directory: missingReopenDirectory });
  const missingReopen = JSON.parse(await fs.readFile(path.join(missingReopenDirectory, 'summary.json'), 'utf8'));
  assert.equal(missingReopen.pass, false, 'A passed first Host cannot substitute for the required second Host report.');
  const missingRow = missingReopen.scenarios.find(row => row.name === stopped.name);
  assert.equal(missingRow.pass, false);
  assert.equal(missingRow.snapshotReopen.required, true);
  assert.equal(missingRow.snapshotReopen.reportPresent, false);
  assert.equal(missingRow.snapshotReopen.pass, false);
  const reopenDir = path.join(stopArtifacts, 'reopen');
  await fs.mkdir(reopenDir);
  const reopenReport = { schemaVersion: 1, pass: true,
    ...Object.fromEntries(reopenFields.map(field => [field, true])), raw: key, error: key, savedState: { data: key } };
  await fs.writeFile(path.join(reopenDir, 'reopen-result.json'), JSON.stringify(reopenReport));
  const reopenedDirectory = path.join(root, 'reopened-report');
  await writeAgentCandidateCIReport({ ...options, directory: reopenedDirectory });
  const reopenedText = await fs.readFile(path.join(reopenedDirectory, 'summary.json'), 'utf8');
  const reopened = JSON.parse(reopenedText);
  assert.equal(reopened.pass, true);
  assert.deepEqual(reopened.scenarios.find(row => row.name === stopped.name).snapshotReopen,
    { required: true, reportPresent: true, pass: true, ...Object.fromEntries(reopenFields.map(field => [field, true])) });
  assert.equal(reopenedText.includes(key), false);
  for (const [index, field] of [...reopenFields, 'pass'].entries()) {
    await fs.writeFile(path.join(reopenDir, 'reopen-result.json'), JSON.stringify({ ...reopenReport, [field]: key }));
    const invalidDirectory = path.join(root, `invalid-reopen-report-${index}`);
    await writeAgentCandidateCIReport({ ...options, directory: invalidDirectory });
    const invalidText = await fs.readFile(path.join(invalidDirectory, 'summary.json'), 'utf8');
    const invalid = JSON.parse(invalidText);
    assert.equal(invalid.pass, false, field);
    const invalidRow = invalid.scenarios.find(row => row.name === stopped.name);
    assert.equal(invalidRow.pass, false, field);
    assert.equal(invalidRow.snapshotReopen[field], field === 'pass' ? false : null);
    assert.equal(invalidText.includes(key), false, field);
  }
  await fs.writeFile(path.join(stopArtifacts, 'result.json'), JSON.stringify({ pass: true,
    reopenRequired: true, reopenHandoffReady: key }));
  const invalidDecisionDirectory = path.join(root, 'invalid-reopen-decision-report');
  await writeAgentCandidateCIReport({ ...options, directory: invalidDecisionDirectory });
  const invalidDecisionText = await fs.readFile(path.join(invalidDecisionDirectory, 'summary.json'), 'utf8');
  assert.equal(JSON.parse(invalidDecisionText).pass, false);
  assert.equal(JSON.parse(invalidDecisionText).scenarios.find(row => row.name === stopped.name).pass, false);
  assert.equal(invalidDecisionText.includes(key), false);
  await fs.writeFile(path.join(stopArtifacts, 'result.json'), JSON.stringify({ pass: true,
    reopenRequired: false, reopenHandoffReady: true }));
  const contradictoryDecisionDirectory = path.join(root, 'contradictory-reopen-decision-report');
  await writeAgentCandidateCIReport({ ...options, directory: contradictoryDecisionDirectory });
  const contradictoryDecisionText = await fs.readFile(path.join(contradictoryDecisionDirectory, 'summary.json'), 'utf8');
  assert.equal(JSON.parse(contradictoryDecisionText).pass, false);
  assert.equal(contradictoryDecisionText.includes(key), false);
  await fs.writeFile(path.join(reopenDir, 'reopen-result.json'), JSON.stringify(reopenReport));
  await fs.writeFile(path.join(stopArtifacts, 'result.json'), JSON.stringify({ pass: false, reopenRequired: true }));
  const originalFailureDirectory = path.join(root, 'original-failure-reopen-report');
  await writeAgentCandidateCIReport({ ...options, directory: originalFailureDirectory });
  const originalFailure = JSON.parse(await fs.readFile(path.join(originalFailureDirectory, 'summary.json'), 'utf8'));
  assert.equal(originalFailure.pass, false, 'Even a complete reopen report cannot erase a first-stage failure.');
  console.log('Agent candidate CI report: fixed fields, missing evidence, failed run, and secret refusal passed.');
} finally {
  await fs.rm(root, { recursive: true, force: true });
}
