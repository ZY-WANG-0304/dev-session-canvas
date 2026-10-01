import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { stripVTControlCharacters } from 'node:util';
import reopenHelpers from '../../tests/vscode-smoke/agent-candidate-reopen.cjs';

const count = value => Array.isArray(value) ? value.length : null;
const boolean = value => typeof value === 'boolean' ? value : null;
const integer = value => Number.isSafeInteger(value) ? value : null;
const dispositions = new Set(['eof', 'interrupted', 'error', 'unknown']);
const agentStatuses = new Set(['idle', 'starting', 'waiting-input', 'running', 'resuming', 'resume-ready',
  'resume-failed', 'suspended', 'stopping', 'stopped', 'error', 'interrupted']);
const readerSettlementKinds = new Set(['applied', 'cancelled', 'lost', 'legacy-released']);
const geometryKeys = ['cols', 'rows', 'cursorX', 'cursorY', 'viewportY', 'bufferType'];
const observationFailures = new Set(['helper-start-failed', 'helper-ended-before-release', 'helper-input-failed',
  'helper-stderr-budget', 'helper-response-budget', 'helper-invalid-response', 'helper-request-deadline',
  'helper-request-failed', 'original-process-unknown', 'missing-original-process', 'wrapper-ended-while-cli-live',
  'fixed-event-budget', 'sample-failed', 'cleanup-observation-unknown', 'helper-release-deadline', 'process-observation-unknown']);
const observationOperations = new Set(['initialize', 'launch', 'root', 'sample', 'cleanup']);
const signalledActions = new Set(['terminated-original-handle', 'SIGKILL-after-product-cleanup-failed']);
const unconfirmedActions = new Set(['original-handle-signal-unconfirmed', 'signal-unconfirmed']);
const cleanupActions = new Set([...signalledActions, ...unconfirmedActions, 'unknown-identity-no-signal',
  'already-exited', 'already-absent-no-signal', 'already-ended-no-signal',
  'identity-changed-no-signal', 'identity-unconfirmed-no-signal']);

function cleanupSignalSummary(actions) {
  if (!Array.isArray(actions)) return { forcedSignals: null, unconfirmedSignals: null, cleanupActionKinds: null };
  const kinds = actions.map(entry => cleanupActions.has(entry?.action) ? entry.action : 'unclassified');
  const unconfirmed = kinds.filter(kind => unconfirmedActions.has(kind) || kind === 'unclassified').length;
  return { forcedSignals: unconfirmed ? null : kinds.filter(kind => signalledActions.has(kind)).length,
    unconfirmedSignals: unconfirmed, cleanupActionKinds: kinds };
}

function snapshotGeometrySummary(value, dimensionsOnly = false) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const keys = dimensionsOnly ? ['cols', 'rows'] : geometryKeys;
  return Object.fromEntries(keys.map(name => [name, name === 'bufferType'
    ? ['normal', 'alternate'].includes(value[name]) ? value[name] : null
    : Number.isSafeInteger(value[name]) && value[name] >= 0 ? value[name] : null]));
}

function snapshotEvidenceSummary(value) {
  if (!value || typeof value !== 'object') return null;
  const result = { schemaVersion: value.schemaVersion === 1 ? 1 : null };
  for (const name of ['savedNodeMatched', 'savedStatePresent', 'savedStateValid', 'readerApplied', 'readerLifecycleMatched', 'sequenceMatched',
    'helpProbePresent', 'finalProbePresent', 'pageGeometryMatched', 'pageVisibleMatched', 'pageBufferMatched',
    'savedMatchesPage', 'replayComplete', 'replayMatchesSaved', 'replayMatchesPage', 'publishedFinalMatchesSaved',
    'replayInitialZeroSequenceInferred', 'resizedSavedPageGeometryMatched', 'resizedSavedPageVisibleMatched',
    'resizedSavedPageBufferMatched', 'resizedSavedMatchesPage']) {
    result[name] = boolean(value[name]);
  }
  for (const name of ['savedDataBytes', 'savedOutputSequence', 'snapshotOutputSequence', 'readerFinalOutputSequence',
    'helpNonEmptyLines', 'savedCols', 'savedRows', 'messageCount', 'replayInitialSequence',
    'replayOutputMessages', 'replayResizeSnapshots', 'replayInactivePrefixSnapshots', 'replayEquivalentInitialSnapshots']) {
    result[name] = Number.isSafeInteger(value[name]) && value[name] >= 0 ? value[name] : null;
  }
  for (const name of ['helperSha256', 'savedDataSha256', 'hydratedStateSha256', 'replayStateSha256']) {
    result[name] = typeof value[name] === 'string' && /^[a-f0-9]{64}$/.test(value[name]) ? value[name] : null;
  }
  result.replayReason = ['unknown', 'complete', 'messages-missing', 'message-window-full', 'execution-changed',
    'initial-checkpoint-missing', 'reader-changed', 'output-range-missing', 'snapshot-invalid',
    'resize-checkpoint-mismatch', 'projection-recovery-or-unknown-snapshot', 'exit-boundary-missing',
    'final-sequence-mismatch', 'saved-state-invalid', 'evidence-computation-failed', 'evidence-inputs-unavailable']
    .includes(value.replayReason) ? value.replayReason : null;
  result.pageProjectionIndependence = value.pageProjectionIndependence === 'not-proven' ? 'not-proven' : null;
  result.savedGeometry = snapshotGeometrySummary(value.savedGeometry);
  result.pageGeometry = snapshotGeometrySummary(value.pageGeometry);
  result.publishedGeometry = snapshotGeometrySummary(value.publishedGeometry, true);
  result.pageGeometryMatches = value.pageGeometryMatches && typeof value.pageGeometryMatches === 'object' &&
    !Array.isArray(value.pageGeometryMatches)
    ? Object.fromEntries(geometryKeys.map(name => [name, boolean(value.pageGeometryMatches[name])])) : null;
  return result;
}

export async function writeAgentCandidateCIReport({ directory, output, input, scenarios, phase, failed, apiKey, failureMessage = '' }) {
  const rows = [];
  for (const scenario of scenarios) {
    assert(/^(codex|claude)-(live-runtime|snapshot-only)-(natural|stop)$/.test(scenario.name));
    const artifacts = path.join(output, scenario.name, 'artifacts');
    const read = name => readOptionalJson(path.join(artifacts, `${name}.json`));
    const result = await read('result');
    const auth = await read('auth-status');
    const cleanup = await read('cleanup');
    const processes = await read('process-observations') ?? cleanup?.process;
    const processEntries = Array.isArray(processes?.entries) ? processes.entries : undefined;
    const windows = input?.platform === 'win32';
    const windowsObservationComplete = !windows || !processEntries ? null :
      !processes.error && processEntries.every(entry => entry.platform === 'win32' && entry.observationUnknown !== true) &&
      ['host', 'provider', 'cli', ...(scenario.name.includes('-live-runtime-') ? ['supervisor'] : [])]
        .every(role => processEntries.some(entry => entry.role === role)) &&
      processEntries.some(entry => entry.role === 'wrapper' && entry.wrapperKind === 'cmd') &&
      (!scenario.name.startsWith('codex-') ||
        processEntries.some(entry => entry.role === 'wrapper' && entry.wrapperKind === 'node'));
    const completed = await read('completed');
    const reopen = await read('reopen/reopen-result');
    const reopenRequired = result?.reopenRequired === true || result?.reopenHandoffReady === true ||
      (scenario.name.endsWith('-snapshot-only-stop') && completed?.savedNode?.metadata?.agent?.serializedTerminalState?.data === '');
    const reopenDecisionValid = (result?.reopenRequired === undefined || typeof result.reopenRequired === 'boolean') &&
      (result?.reopenHandoffReady === undefined || typeof result.reopenHandoffReady === 'boolean') &&
      !(result?.reopenHandoffReady === true && result?.reopenRequired !== true);
    const reopenPassed = reopenHelpers.reopenReportPassed(reopen);
    const firstFailure = await read('first-failure');
    const failureSnapshot = await read('first-failure-snapshot');
    const events = await read('completed-events') ?? await read('first-failure-events');
    const remainder = await read('remaining-resources');
    const nodeId = completed?.node?.id ?? firstFailure?.nodeId;
    const executionId = completed?.executionId ?? firstFailure?.executionId;
    const failureLocation = typeof firstFailure?.stack === 'string'
      ? /agent-candidate-tests\.cjs:(\d+):(\d+)/.exec(firstFailure.stack) : null;
    const failureNode = failureSnapshot?.state?.nodes?.find(node => node.id === nodeId);
    const failureAgent = failureNode?.metadata?.agent;
    const source = events?.find(event => event.kind === 'runtime/terminalSourceDisposition' &&
      typeof nodeId === 'string' && typeof executionId === 'string' && event.detail?.nodeId === nodeId &&
      (event.detail.executionSessionId === executionId || event.detail.sessionId === executionId));
    const readerSettlement = events?.find(event => typeof nodeId === 'string' && typeof executionId === 'string' &&
      event.detail?.nodeId === nodeId &&
      ((event.kind === 'runtime/terminalReadSettled' && event.detail.sessionId === executionId) ||
      (event.kind === 'execution/localTerminalReaderSettled' && event.detail.executionSessionId === executionId)));
    let rawOutput;
    try { rawOutput = await fs.readFile(path.join(artifacts, 'host-received-output.txt')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const records = rawOutput === undefined ? undefined : stripVTControlCharacters(rawOutput.toString('utf8'))
      .split(/\r?\n/).flatMap(line => {
        try { const record = JSON.parse(line); return record && typeof record === 'object' ? [record] : []; }
        catch { return []; }
      });
    let lastMessage;
    if (scenario.name.startsWith('codex-')) {
      try { lastMessage = await fs.readFile(path.join(artifacts, 'codex-final-message.txt'), 'utf8'); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    rows.push({
      name: scenario.name,
      state: ['not-run', 'started', 'passed', 'failed'].includes(scenario.state) ? scenario.state : 'unknown',
      pass: !reopenDecisionValid || (reopenRequired && !reopenPassed) ? false : boolean(result?.pass),
      cliObserved: boolean(result?.cliObserved),
      naturalResponseVerified: boolean(result?.naturalResponseVerified),
      failureLocation: failureLocation ? { file: 'agent-candidate-tests.cjs',
        line: Number(failureLocation[1]), column: Number(failureLocation[2]) } : null,
      failureState: failureNode ? {
        status: agentStatuses.has(failureNode.status) ? failureNode.status : null,
        liveSession: boolean(failureAgent?.liveSession),
        exitCode: integer(failureAgent?.lastExitCode),
        outputSequence: integer(failureAgent?.outputSequence),
        serializedStatePresent: failureAgent ? failureAgent.serializedTerminalState !== undefined : null,
        serializedStateBytes: typeof failureAgent?.serializedTerminalState?.data === 'string'
          ? Buffer.byteLength(failureAgent.serializedTerminalState.data) : null,
        readerSettlementObserved: Array.isArray(events) ? readerSettlement !== undefined : null,
        readerSettlementKind: readerSettlementKinds.has(readerSettlement?.detail?.outcome?.kind)
          ? readerSettlement.detail.outcome.kind : null,
        readerFinalOutputSequence: integer(readerSettlement?.detail?.outcome?.finalOutputSequence)
      } : null,
      snapshotEvidence: scenario.name.endsWith('-snapshot-only-stop')
        ? snapshotEvidenceSummary(await read('snapshot-evidence')) : null,
      snapshotReopen: scenario.name.endsWith('-snapshot-only-stop') ? {
        required: reopenDecisionValid ? reopenRequired : null, reportPresent: reopen !== undefined, pass: reopenPassed,
        ...Object.fromEntries([...reopenHelpers.REOPEN_CHECKS, 'stateRetained', 'pageBufferMatched',
          'pageGeometryMatched'].map(key => [key, boolean(reopen?.[key])]))
      } : null,
      cliEvidence: {
        turnCompleted: records ? records.some(record => record.type === 'turn.completed') : null,
        turnFailed: records ? records.some(record => record.type === 'turn.failed') : null,
        expectedResponseInOutput: records && typeof scenario.nonce === 'string'
          ? records.some(record => (record.item?.type === 'agent_message' && typeof record.item.text === 'string' &&
            record.item.text.trim() === scenario.nonce) || (record.type === 'result' && record.is_error === false &&
            typeof record.result === 'string' && record.result.trim() === scenario.nonce)) : null,
        lastMessageMatches: lastMessage !== undefined && typeof scenario.nonce === 'string'
          ? lastMessage.trim() === scenario.nonce : null,
        modelMetadataFallback: records ? records.some(record => record.item?.type === 'error' &&
          record.item.message === 'Model metadata for `deepseek-flash` not found. Defaulting to fallback metadata; this can degrade performance and cause issues.') : null
      },
      sourceDisposition: dispositions.has(source?.detail?.sourceDisposition?.kind)
        ? source.detail.sourceDisposition.kind : null,
      processObservation: {
        failureKinds: Array.isArray(processes?.failures) ? processes.failures.map(entry =>
          observationFailures.has(entry?.kind) ? entry.kind : 'unclassified') : null,
        failedOperations: Array.isArray(processes?.samples) ? processes.samples.filter(entry => entry?.complete !== true)
          .map(entry => observationOperations.has(entry?.operation) ? entry.operation : 'unclassified') : null
      },
      authentication: { exitCode: integer(auth?.exitCode), loggedIn: boolean(auth?.loggedIn),
        configurationParsed: boolean(auth?.configurationParsed), networkAuthenticationVerifiedByPreflight: false },
      cleanup: { bindings: count(cleanup?.runtime?.bindings), failures: count(processes?.failures),
        ...cleanupSignalSummary(remainder?.forcedSignals ?? cleanup?.forcedSignals),
        remainingActiveProcesses: processEntries && (!windows || windowsObservationComplete)
          ? processEntries.filter(entry => ['cli', 'wrapper', 'provider'].includes(entry.role) &&
            (windows ? !windowsExitConfirmed(entry)
              : entry.active && !['Z', 'X'].includes(entry.state))).length : null,
        windowsObservationComplete,
        windowsUnknownProcesses: windows && processEntries
          ? processEntries.filter(entry => entry.observationUnknown === true).length : null,
        windowsUnconfirmedExits: windowsObservationComplete
          ? processEntries.filter(entry => ['cli', 'wrapper', 'provider'].includes(entry.role) &&
            !windowsExitConfirmed(entry)).length : null },
      diagnosticClasses: classifyFailure(`${result?.error ?? ''}\n${rawOutput?.toString('utf8') ?? ''}`),
      receivedOutput: rawOutput ? { bytes: rawOutput.length,
        sha256: createHash('sha256').update(rawOutput).digest('hex') } : null
    });
  }
  const safeVersions = {};
  for (const provider of ['codex', 'claude']) {
    const version = input?.cli?.[provider]?.version;
    safeVersions[provider] = /^(?:codex-cli )?\d+\.\d+\.\d+(?: \(Claude Code\))?$/.test(version ?? '') ? version : null;
  }
  const platform = ['linux', 'darwin', 'win32'].includes(input?.platform) ? input.platform : 'unknown';
  const report = {
    schemaVersion: 1,
    scope: 'Real Codex/Claude CLI + DeepSeek + candidate Host/Webview on the recorded platform; not cross-platform closure.',
    platform,
    backend: 'deepseek', model: 'deepseek-flash', cli: safeVersions,
    phase: ['prepare', 'native-assets', 'complete', 'credential-cleanup'].includes(phase) || rows.some(row => row.name === phase)
      ? phase : 'unknown',
    pass: !failed && rows.length === 8 && rows.every(row => row.state === 'passed' && row.pass === true),
    plannedModelTurns: 4, automaticHarnessRetries: 0,
    failureClasses: failed ? classifyFailure(failureMessage) : [],
    scenarios: rows,
    buildHashes: Object.fromEntries(Object.entries(input?.hashes ?? {}).filter(([name, hash]) =>
      /^(extensions|scripts|tests)\/[a-zA-Z0-9_./-]+$/.test(name) && /^[a-f0-9]{64}$/.test(hash))),
    credentialContentsRecorded: false, rawLogsPublished: false
  };
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  // Publish only fixed fields, never CLI error text, environment values, or private files.
  if (typeof apiKey === 'string' && apiKey.length) {
    for (const representation of [apiKey, JSON.stringify(apiKey).slice(1, -1), Buffer.from(apiKey).toString('base64')]) {
      assert(!serialized.includes(representation), 'Secret detected in CI report; publication refused.');
    }
  }
  // Refuse an existing destination so a stale report cannot survive a failed publication.
  await fs.mkdir(directory, { mode: 0o700 });
  await fs.writeFile(path.join(directory, 'summary.json'), serialized, { mode: 0o600, flag: 'wx' });
}

async function readOptionalJson(file) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return undefined; throw error; }
}

function windowsExitConfirmed(entry) {
  return entry.observationUnknown !== true && entry.exitConfirmed === true && entry.hasExited === true &&
    Number.isInteger(entry.exitCode);
}

function classifyFailure(text) {
  return [
    ['credential-configuration', /DeepSeek API key|DeepSeek configuration/i],
    ['cli-version', /requires.*(?:codex|claude|Node 25)|version query failed/i],
    ['missing-path', /ENOENT|missing:|no such file/i],
    ['sandbox', /bwrap|bubblewrap|sandbox|unshare|operation not permitted/i],
    ['authentication', /unauthorized|invalid.*(?:key|token)|authentication.*(?:failed|unavailable)|\b401\b/i],
    ['rate-or-balance', /rate.limit|insufficient.*(?:balance|quota)|\b(?:402|429)\b/i],
    ['model-or-protocol', /model.*(?:not found|not supported|does not exist)|unsupported.*(?:parameter|protocol)/i],
    ['network', /ECONN|ENOTFOUND|ETIMEDOUT|network|connection.*(?:failed|closed|reset)/i],
    ['timeout', /Timed out/i],
    ['response', /response|nonce|turn.failed|is_error/],
    ['cleanup', /cleanup|resources live|Wrapper must not finish/],
    ['source-eof', /source EOF|source disposition/]
  ].filter(([, pattern]) => pattern.test(text)).map(([name]) => name);
}
