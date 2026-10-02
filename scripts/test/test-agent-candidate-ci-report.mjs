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
  assert.equal(summary.selectedPass, true);
  assert.equal(summary.partialSelection, false);
  assert.deepEqual(summary.selectedScenarioNames, scenarios.map(value => value.name));
  assert.equal(summary.plannedModelTurns, 4);
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
  assert.equal(summary.scenarios[0].receivedOutput.source, 'host-received-output');
  assert.equal(summary.scenarios[0].cliEvidence.lastMessageMatches, null);
  assert.equal(summary.scenarios[0].pollStage, null);
  assert.equal(summary.scenarios[0].processObservation.beforeCleanup, null);
  const selectedScenarioNames = ['codex-snapshot-only-stop'];
  const partialScenarios = scenarios.map(value => ({ ...value,
    state: selectedScenarioNames.includes(value.name) ? 'passed' : 'not-run' }));
  const partialDirectory = path.join(root, 'partial-report');
  await writeAgentCandidateCIReport({ ...options, directory: partialDirectory, scenarios: partialScenarios,
    input: { selectedScenarioNames, partialSelection: true, plannedModelTurns: 0 } });
  const partial = JSON.parse(await fs.readFile(path.join(partialDirectory, 'summary.json'), 'utf8'));
  assert.equal(partial.pass, false, 'One selected pass must not claim the complete eight-scenario matrix.');
  assert.equal(partial.selectedPass, true);
  assert.equal(partial.partialSelection, true);
  assert.equal(partial.plannedModelTurns, 0);
  assert.deepEqual(partial.selectedScenarioNames, selectedScenarioNames);
  assert.equal(partial.scenarios.length, 8);
  assert.equal(partial.scenarios.filter(value => value.state === 'not-run').length, 7);
  const partialFailedDirectory = path.join(root, 'partial-failed-report');
  await writeAgentCandidateCIReport({ ...options, directory: partialFailedDirectory, scenarios: partialScenarios,
    failed: true, input: { selectedScenarioNames, partialSelection: true } });
  assert.equal(JSON.parse(await fs.readFile(path.join(partialFailedDirectory, 'summary.json'), 'utf8')).selectedPass, false);
  const duplicateRowsDirectory = path.join(root, 'partial-duplicate-rows-report');
  await writeAgentCandidateCIReport({ ...options, directory: duplicateRowsDirectory,
    scenarios: [scenarios[0], scenarios[0]],
    input: { selectedScenarioNames: [scenarios[0].name, scenarios[1].name], partialSelection: true } });
  assert.equal(JSON.parse(await fs.readFile(path.join(duplicateRowsDirectory, 'summary.json'), 'utf8')).selectedPass, false,
    'Duplicated selected rows must not hide a missing selected scenario.');
  for (const [label, selection] of [
    ['unknown', { selectedScenarioNames: [key], partialSelection: true }],
    ['duplicate', { selectedScenarioNames: [...selectedScenarioNames, ...selectedScenarioNames], partialSelection: true }],
    ['contradictory', { selectedScenarioNames, partialSelection: false }]
  ]) {
    const selectedDirectory = path.join(root, `invalid-selection-${label}`);
    await writeAgentCandidateCIReport({ ...options, directory: selectedDirectory, scenarios: partialScenarios, input: selection });
    const selectedText = await fs.readFile(path.join(selectedDirectory, 'summary.json'), 'utf8');
    const invalid = JSON.parse(selectedText);
    assert.equal(invalid.pass, false);
    assert.equal(invalid.selectedPass, false);
    assert.equal(invalid.partialSelection, null);
    assert.equal(invalid.plannedModelTurns, null);
    assert.deepEqual(invalid.selectedScenarioNames, []);
    assert.equal(selectedText.includes(key), false);
  }
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
  assert.deepEqual(warningReport.scenarios[0].cliEvidence, { recordCount: 4, threadStarted: false, turnStarted: false,
    turnCompleted: true, turnFailed: false, errorObserved: true,
    expectedResponseInOutput: true, lastMessageMatches: true, modelMetadataFallback: true });
  assert.equal(warningText.includes(key), false);
  assert.equal(warningText.includes(scenario.nonce), false);
  assert.equal(warningText.includes('Defaulting to fallback metadata'), false);
  await fs.writeFile(path.join(artifacts, 'process-observations.json'), JSON.stringify({
    error: key, failures: [{ kind: 'process-observation-unknown', reason: key }], samples: [], entries: []
  }));
  const darwinStates = [
    ...['idle', 'running', 'sleeping', 'stopped'].map(state => ({ entry: { state, active: true }, outcome: 'live' })),
    { entry: { state: 'running', active: false }, outcome: 'ended' },
    { entry: { state: 'sleeping', active: true, observationUnknown: true }, outcome: 'unknown' },
    { entry: { state: 'stopped', active: false, observationUnknown: true }, outcome: 'unknown' },
    ...['Z', 'X'].map(state => ({ entry: { state, active: true }, outcome: 'ended' })),
    ...['?', 'R', 'disk-sleep', key].map(state => ({ entry: { state, active: true }, outcome: 'unknown' })),
    { entry: { state: 'idle' }, outcome: 'unknown' },
    { entry: { state: 'running', active: 1 }, outcome: 'unknown' }
  ];
  for (const [index, { entry, outcome }] of darwinStates.entries()) {
    await fs.writeFile(path.join(artifacts, 'first-failure-process.json'), JSON.stringify({
      error: key, entries: [{ role: 'cli', ...entry }]
    }));
    const target = path.join(root, `darwin-state-${index}`);
    await writeAgentCandidateCIReport({ ...options, directory: target, scenarios: [scenario], failed: true,
      input: { platform: 'darwin' } });
    const safeText = await fs.readFile(path.join(target, 'summary.json'), 'utf8');
    const report = JSON.parse(safeText);
    const row = report.scenarios[0];
    assert.deepEqual(row.processObservation.beforeCleanup.roles.cli,
      { observed: 1, live: 0, ended: 0, unknown: 0, [outcome]: 1 });
    assert.equal(row.processObservation.beforeCleanup.observationError, true);
    assert.deepEqual(row.processObservation.failureKinds, ['process-observation-unknown']);
    assert.deepEqual(row.processObservation.failedOperations, []);
    assert.equal(row.cleanup.failures, 1);
    assert.equal(row.pass, false);
    assert.equal(report.pass, false);
    assert.equal(report.selectedPass, false);
    assert.equal(safeText.includes(key), false);
  }
  await fs.unlink(path.join(artifacts, 'first-failure-process.json'));
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
    assert.deepEqual(row.processObservation, { beforeCleanup: null, failureKinds: ['helper-request-failed', 'unclassified'],
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
    replaySavedGeometryMatched: true, replaySavedLinesMatched: true, replaySavedVisibleMatched: true,
    replaySavedSerializedMatched: false, replaySerializedMatchesSavedData: true,
    replaySavedSemanticMatched: true, replaySemanticStateSha256: 'c'.repeat(64), hydratedSemanticStateSha256: 'c'.repeat(64),
    semanticState: { cells: [{ chars: key }] },
    replayBufferLineCount: 21, savedBufferLineCount: 21, replaySerializedBytes: 10, hydratedSerializedBytes: 0,
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
  for (const field of ['replaySavedGeometryMatched', 'replaySavedLinesMatched', 'replaySavedVisibleMatched',
    'replaySavedSerializedMatched', 'replaySerializedMatchesSavedData', 'replayBufferLineCount',
    'savedBufferLineCount', 'replaySerializedBytes', 'hydratedSerializedBytes',
    'replaySavedSemanticMatched', 'replaySemanticStateSha256', 'hydratedSemanticStateSha256']) {
    assert.equal(snapshotReport.scenarios[0].snapshotEvidence[field], snapshotEvidence[field], field);
  }
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
  assert.equal(snapshotReport.scenarios[0].snapshotEvidence.semanticState, undefined);
  await fs.writeFile(path.join(stopArtifacts, 'snapshot-evidence.json'), JSON.stringify({ ...snapshotEvidence,
    replaySavedSemanticMatched: false }));
  const semanticMismatchDirectory = path.join(root, 'semantic-mismatch-report');
  await writeAgentCandidateCIReport({ ...options, directory: semanticMismatchDirectory, scenarios: [stopped], failed: true });
  const semanticMismatchReport = JSON.parse(await fs.readFile(path.join(semanticMismatchDirectory, 'summary.json'), 'utf8'));
  assert.equal(semanticMismatchReport.scenarios[0].snapshotEvidence.replaySavedSemanticMatched, false);
  await fs.writeFile(path.join(stopArtifacts, 'snapshot-evidence.json'), JSON.stringify({ ...snapshotEvidence,
    replayReason: key, replayMatchesSaved: key, savedDataBytes: -1, savedDataSha256: key,
    replaySavedGeometryMatched: key, replaySavedLinesMatched: key, replaySavedVisibleMatched: key,
    replaySavedSerializedMatched: key, replaySerializedMatchesSavedData: key,
    replaySavedSemanticMatched: key, replaySemanticStateSha256: key, hydratedSemanticStateSha256: 'invalid',
    replayBufferLineCount: key, savedBufferLineCount: -1, replaySerializedBytes: key, hydratedSerializedBytes: -1,
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
    'replaySavedGeometryMatched', 'replaySavedLinesMatched', 'replaySavedVisibleMatched',
    'replaySavedSerializedMatched', 'replaySerializedMatchesSavedData', 'replayBufferLineCount',
    'replaySavedSemanticMatched', 'replaySemanticStateSha256', 'hydratedSemanticStateSha256',
    'savedBufferLineCount', 'replaySerializedBytes', 'hydratedSerializedBytes',
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
    'pageCursorOrigin', 'pageViewportOrigin', 'pageNormalBuffer', 'noNewExecution', 'cleanupComplete',
    'stateRetained', 'pageBufferMatched', 'pageGeometryMatched'];
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
    { required: true, reportPresent: true, pass: true, schemaVersion: 1,
      ...Object.fromEntries(reopenFields.map(field => [field, true])) });
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

  await fs.unlink(path.join(artifacts, 'host-received-output.txt'));
  await fs.unlink(path.join(artifacts, 'codex-final-message.txt'));
  await fs.writeFile(path.join(artifacts, 'result.json'), JSON.stringify({ pass: false }));
  await fs.writeFile(path.join(artifacts, 'first-failure-output.txt'), [
    { type: 'turn.started' }, { type: 'error', message: `network connection reset ${key}` }
  ].map(record => JSON.stringify(record)).join('\r\n'));
  await fs.writeFile(path.join(artifacts, 'first-failure-process.json'), JSON.stringify({ entries: [
    { role: 'cli', active: true, state: 'S', executable: key },
    { role: 'wrapper', active: false, state: 'S' },
    { role: 'provider', active: true, state: 'Z' },
    { role: 'provider', active: true, state: 'S', observationUnknown: true },
    { role: 'host', active: true, state: key },
    { role: key, active: true, state: 'S' }, { role: '__proto__' }
  ] }));
  await fs.writeFile(path.join(artifacts, 'process-observations.json'), JSON.stringify({ entries: [], failures: [] }));
  for (const [index, entry] of [
    { error: 'Error: Timed out: Agent final product state', stage: 'agent-final-product-state' },
    { error: 'Error: Timed out: real Agent execution identity', stage: 'agent-execution-identity' },
    { error: `Error: Timed out: Agent final product state ${key}`, stage: null }
  ].entries()) {
    await fs.writeFile(path.join(artifacts, 'first-failure.json'), JSON.stringify({ nodeId: 'n1', executionId: 'e1',
      error: entry.error, stack: `Error: ${key}\n at poll (/private/${key}/agent-candidate-tests.cjs:50:9)` }));
    const target = path.join(root, `failure-observations-${index}`);
    await writeAgentCandidateCIReport({ ...options, directory: target, scenarios: [scenario], failed: true,
      input: { platform: 'linux' } });
    const safeText = await fs.readFile(path.join(target, 'summary.json'), 'utf8');
    const row = JSON.parse(safeText).scenarios[0];
    assert.equal(row.pollStage, entry.stage);
    assert.equal(row.pass, false, 'Evidence additions cannot turn an unsuccessful scenario green.');
    assert.equal(row.receivedOutput.source, 'first-failure-output');
    assert.equal(row.cliEvidence.recordCount, 2);
    assert.equal(row.cliEvidence.threadStarted, false);
    assert.equal(row.cliEvidence.turnStarted, true);
    assert.equal(row.cliEvidence.turnCompleted, false);
    assert.equal(row.cliEvidence.turnFailed, false);
    assert.equal(row.cliEvidence.errorObserved, true);
    assert.equal(row.cliEvidence.expectedResponseInOutput, false);
    assert.equal(row.cliEvidence.lastMessageMatches, null);
    assert.equal(row.diagnosticClasses.includes('network'), true);
    assert.equal(row.cleanup.remainingActiveProcesses, 0);
    assert.deepEqual(row.processObservation.beforeCleanup, { observationError: false, roles: {
      host: { observed: 1, live: 0, ended: 0, unknown: 1 },
      supervisor: { observed: 0, live: 0, ended: 0, unknown: 0 },
      provider: { observed: 2, live: 0, ended: 1, unknown: 1 },
      wrapper: { observed: 1, live: 0, ended: 1, unknown: 0 },
      cli: { observed: 1, live: 1, ended: 0, unknown: 0 }
    } });
    assert.equal(safeText.includes(key), false);
    assert.equal(safeText.includes('network connection reset'), false);
  }
  await fs.writeFile(path.join(artifacts, 'first-failure-process.json'), JSON.stringify({ error: key, entries: [
    { platform: 'win32', role: 'cli', active: true, hasExited: true, exitConfirmed: true, exitCode: 0 },
    { platform: 'win32', role: 'wrapper', active: false, hasExited: false, exitConfirmed: false,
      observationUnknown: false, exitCode: null },
    { platform: 'win32', role: 'provider', active: false, state: 'Z', observationUnknown: true },
    { role: 'cli', active: false, state: 'Z' }
  ] }));
  const beforeWindowsDirectory = path.join(root, 'before-cleanup-windows');
  await writeAgentCandidateCIReport({ ...options, directory: beforeWindowsDirectory, scenarios: [scenario], failed: true,
    input: { platform: 'win32' } });
  const beforeWindowsText = await fs.readFile(path.join(beforeWindowsDirectory, 'summary.json'), 'utf8');
  const beforeWindows = JSON.parse(beforeWindowsText).scenarios[0].processObservation.beforeCleanup;
  assert.equal(beforeWindows.observationError, true);
  assert.deepEqual(beforeWindows.roles.cli, { observed: 2, live: 0, ended: 1, unknown: 1 });
  assert.deepEqual(beforeWindows.roles.wrapper, { observed: 1, live: 1, ended: 0, unknown: 0 });
  assert.deepEqual(beforeWindows.roles.provider, { observed: 1, live: 0, ended: 0, unknown: 1 });
  assert.equal(beforeWindowsText.includes(key), false);

  const genericFields = ['attempted', 'newHost', 'sameRuntime', 'sameWorkspace', 'sameUserData', 'persistedNodeLoaded',
    'stoppedNodeRetained', 'stateRetained', 'sequenceRetained', 'freshPage', 'pageBufferMatched',
    'pageGeometryMatched', 'noNewExecution', 'cleanupComplete'];
  const genericReport = { schemaVersion: 2, pass: true,
    ...Object.fromEntries(genericFields.map(field => [field, true])), raw: key };
  await fs.writeFile(path.join(artifacts, 'result.json'), JSON.stringify({ pass: true }));
  await fs.writeFile(path.join(stopArtifacts, 'completed.json'), JSON.stringify({ savedNode: {
    metadata: { agent: { serializedTerminalState: { data: key } } } } }));
  for (const [index, entry] of [
    { first: { reopenRequired: true, reopenHandoffReady: true }, reopen: genericReport, pass: true },
    { first: { reopenRequired: true, reopenHandoffReady: true }, reopen: reopenReport, pass: false },
    { first: { reopenRequired: false, reopenHandoffReady: false }, reopen: genericReport, pass: false },
    { first: {}, reopen: genericReport, pass: false },
    { first: { reopenRequired: true, reopenHandoffReady: true }, reopen: { ...genericReport, pageBufferMatched: false }, pass: false },
    { first: { reopenRequired: true, reopenHandoffReady: true }, reopen: null, pass: false }
  ].entries()) {
    await fs.writeFile(path.join(stopArtifacts, 'result.json'), JSON.stringify({ schemaVersion: 2, pass: true, ...entry.first }));
    await fs.writeFile(path.join(reopenDir, 'reopen-result.json'), JSON.stringify(entry.reopen));
    const target = path.join(root, `generic-reopen-${index}`);
    await writeAgentCandidateCIReport({ ...options, directory: target });
    const safeText = await fs.readFile(path.join(target, 'summary.json'), 'utf8');
    const report = JSON.parse(safeText);
    const row = report.scenarios.find(value => value.name === stopped.name);
    assert.equal(report.pass, entry.pass, `Generic reopen ${index}`);
    assert.equal(row.pass, entry.pass);
    if (index === 0) {
      assert.equal(row.snapshotReopen.schemaVersion, 2);
      assert.equal(row.snapshotReopen.required, true);
      assert.equal(row.snapshotReopen.emptyStateRetained, null);
      assert.equal(row.snapshotReopen.pageCursorOrigin, null);
      assert.equal(row.snapshotReopen.pageBufferMatched, true);
    }
    assert.equal(safeText.includes(key), false);
  }
  console.log('Agent candidate CI report: fixed fields, missing evidence, failed run, and secret refusal passed.');
} finally {
  await fs.rm(root, { recursive: true, force: true });
}
