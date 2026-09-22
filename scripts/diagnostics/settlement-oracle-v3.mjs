import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

const ID_KEYS = ['runId', 'caseId', 'generation', 'nonce'];
const FRAME_KEYS = ['schema', 'role', ...ID_KEYS, 'attemptId', 'requestId', 'sourceSequence', 'sentNs', 'type', 'payload'];
const ROLES = ['caller', 'writer', 'verifier', 'publisher'];
const EVENTS = new Set(['case-start', 'publication-start', 'evidence-start', 'spawn-request', 'spawn', 'spawn-error',
  'process-error', 'process-close', 'exit', 'control-attempt', 'trace-overflow', 'stream-data', 'stream-end',
  'stream-close', 'stream-error', 'stream-cancel', 'stream-truncated', 'capture-settled', 'report-frozen',
  'protocol-frame', 'protocol-error', 'ack-sent', 'ack-error', 'request-error', 'deadline', 'gate-held',
  'gate-released', 'gate-not-established', 'consumer-after-await', 'readers-registered', 'launch-rejected']);
const NS = 1_000_000n;
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const same = isDeepStrictEqual;
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const keysEqual = (value, keys) => isObject(value) && Object.keys(value).sort().join(',') === [...keys].sort().join(',');
const text = value => typeof value === 'string' && value.length > 0;
const identityText = value => text(value) && value.length <= 256;
const hex = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const integer = value => Number.isSafeInteger(value) && value >= 0;

function ns(value) {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,29})$/.test(value)) throw new Error('invalid-monotonic-time');
  return BigInt(value);
}

function decodeBase64(value) {
  if (typeof value !== 'string') throw new Error('invalid-base64');
  const bytes = Buffer.from(value, 'base64');
  if (bytes.toString('base64') !== value) throw new Error('noncanonical-base64');
  return bytes;
}

// This parser and reducer deliberately do not import any observer implementation.
export function inspectFrame(frame, { id, role, attemptId, requestId, channel }) {
  const errors = [];
  const fail = reason => errors.push(reason);
  if (!keysEqual(frame, FRAME_KEYS)) return ['frame-fields'];
  if (frame.schema !== 'diagnostic-settlement-frame-v3') fail('frame-schema');
  if (frame.role !== role || !ROLES.includes(role)) fail('frame-role');
  for (const key of ID_KEYS) if (!(identityText(frame[key]) || key === 'generation' && integer(frame[key])) || frame[key] !== id[key]) fail(`frame-${key}`);
  if (!text(frame.attemptId) || frame.attemptId !== attemptId) fail('frame-attemptId');
  if (!text(frame.requestId) || frame.requestId !== requestId) fail('frame-requestId');
  if (!integer(frame.sourceSequence) || frame.sourceSequence === 0) fail('frame-sequence');
  try { ns(frame.sentNs); } catch { fail('frame-sentNs'); }
  if (channel !== (frame.type === 'caller-after-await' && role === 'caller' ? 'fd3' : 'stdout')) fail('frame-channel');
  const p = frame.payload;
  let valid = false;
  if (role === 'caller') {
    switch (frame.type) {
      case 'caller-start': valid = keysEqual(p, ['scenario']) && identityText(p.scenario); break;
      case 'result-ready': case 'operation-pending': case 'after-await-ready': valid = keysEqual(p, []); break;
      case 'operation-returned': case 'caller-after-await': valid = keysEqual(p, ['kind']) && ['returned', 'timeout'].includes(p.kind); break;
      case 'bulk': valid = keysEqual(p, ['index', 'body']) && integer(p.index) && p.index > 0 && p.body === 'x'.repeat(220); break;
      case 'caller-finished': valid = keysEqual(p, ['exitCode']) && p.exitCode === 0; break;
      default: fail('frame-type');
    }
  } else {
    switch (frame.type) {
      case 'start': valid = keysEqual(p, ['scenario']) && identityText(p.scenario); break;
      case 'write-entered': valid = role === 'writer' && keysEqual(p, ['mode']) && ['write', 'sync-block'].includes(p.mode); break;
      case 'verify-entered': valid = role === 'verifier' && keysEqual(p, ['mode']) && ['verify', 'sync-block'].includes(p.mode); break;
      case 'publish-entered': valid = role === 'publisher' && keysEqual(p, ['mode']) && ['publish', 'sync-block'].includes(p.mode); break;
      case 'seal-claim': case 'verified':
        valid = ((role === 'writer' && frame.type === 'seal-claim') || (role === 'verifier' && frame.type === 'verified')) &&
          keysEqual(p, ['bytes', 'sha256', 'manifestSha256']) && integer(p.bytes) && hex(p.sha256) && hex(p.manifestSha256);
        break;
      case 'publish-claim': valid = role === 'publisher' && keysEqual(p, ['files', 'manifestSha256']) && integer(p.files) && hex(p.manifestSha256); break;
      case 'failed': valid = keysEqual(p, ['code', 'message']) && identityText(p.code) && typeof p.message === 'string' && p.message.length <= 2048; break;
      default: fail('frame-type');
    }
  }
  if (!valid) fail('frame-payload');
  return errors;
}

function newRole(role) {
  return { role, request: null, spawnAt: null, spawned: false, registered: null, closed: false, launchRejected: false,
    exited: null, spawnError: null, frames: [], errors: [], controls: [], truncated: false,
    streams: Object.fromEntries(['stdout', 'stderr', 'fd3'].map(channel =>
      [channel, { pending: Buffer.alloc(0), endedAt: null, closedAt: null, cancelledAt: null, diagnosticBytes: 0, receivedBytes: 0, retainedBytes: 0 }])),
    channels: new Map(), sequences: new Set(), terminal: null };
}

function replay(input) {
  const errors = [];
  const check = (ok, reason) => { if (!ok) errors.push(reason); };
  const roles = Object.fromEntries(ROLES.map(role => [role, newRole(role)]));
  const trace = input.trace;
  if (!Array.isArray(trace)) return { errors: ['trace-missing'], roles, reports: new Map() };
  const id = input.spec?.id;
  check(id?.schema === 'diagnostic-settlement-v3' && ID_KEYS.every(key => identityText(id?.[key]) || key === 'generation' && integer(id?.[key])), 'spec-identity');
  const ids = new Set();
  const reports = new Map();
  let previousTime = -1n;
  let previousOrdinal = 0;
  let t0 = null;
  let e0 = null;
  let p0 = null;
  let overflow = false;
  let capture = null;
  let payloadBase64 = null;
  let blocked = false;
  const rawFrames = [];
  for (const [index, fact] of trace.entries()) {
    let at;
    try { at = ns(fact.receiptNs); } catch { errors.push(`fact-time:${index}`); continue; }
    check(at >= previousTime, `fact-time-regression:${index}`);
    previousTime = at;
    check(integer(fact.eventOrdinal) && fact.eventOrdinal > previousOrdinal, `fact-ordinal:${index}`);
    if (fact.eventOrdinal !== previousOrdinal + 1) check(overflow ||
      (fact.event === 'trace-overflow' && fact.details?.firstOmittedOrdinal === previousOrdinal + 1), `unexplained-fact-gap:${index}`);
    previousOrdinal = fact.eventOrdinal;
    check(text(fact.factId) && !ids.has(fact.factId), `fact-id:${index}`);
    ids.add(fact.factId);
    const d = fact.details;
    if (!isObject(d)) { errors.push(`fact-details:${index}`); continue; }
    check(EVENTS.has(fact.event), `unknown-event:${fact.event}`);
    const state = roles[fact.role];
    let frameOffset = -1;
    const issue = reason => {
      const category = ['process-error', 'request-error', 'launch-rejected'].includes(fact.event) ? 'lifecycle' :
        fact.event === 'stream-error' ? 'stream' : 'protocol';
      const value = { at, ordinal: fact.eventOrdinal, frameOffset, reason, category };
      if (state) state.errors.push(value);
      else errors.push(reason);
    };
    if (fact.event === 'case-start') {
      check(t0 === null, 'duplicate-case-start');
      try { t0 = ns(d.t0Ns); check(t0 <= at, 't0-after-start'); } catch { errors.push('bad-t0'); }
      if (t0 !== null) for (const [key, ms] of Object.entries({ observationNs: 2000, termNs: 5000, killNs: 5500, hardNs: 6000 }))
        check(d.deadlines?.[key] === String(t0 + BigInt(ms) * NS), `caller-deadline:${key}`);
    } else if (fact.event === 'evidence-start' || fact.event === 'publication-start') {
      const publish = fact.event === 'publication-start';
      let start;
      try { start = ns(publish ? d.p0Ns : d.e0Ns); } catch { errors.push('phase-start-time'); continue; }
      check(start <= at, 'phase-start-after-receipt');
      if (publish) { check(p0 === null, 'duplicate-publication-start'); p0 = start; }
      else { check(e0 === null, 'duplicate-evidence-start'); e0 = start; payloadBase64 = d.payloadBase64; }
      for (const [key, ms] of Object.entries({ workNs: 1000, killNs: 1500, hardNs: 2000 }))
        check(d.deadlines?.[key] === String(start + BigInt(ms) * NS), `helper-deadline:${key}`);
    } else if (fact.event === 'spawn-request') {
      if (!state) { errors.push('spawn-role'); continue; }
      check(state.request === null, `duplicate-spawn:${fact.role}`);
      state.request = input.requests?.find(r => r.role === fact.role && r.attemptId === fact.attemptId) ?? d.request;
      state.spawnAt = at;
      state.spawnOrdinal = fact.eventOrdinal;
      check(d.request?.role === fact.role && d.request?.attemptId === fact.attemptId, 'request-role-attempt');
      check(d.request?.schema === 'diagnostic-settlement-request-v3', 'request-schema');
      check(ID_KEYS.every(key => d.request?.id?.[key] === id?.[key]), 'request-identity');
      check(same(state.request.id, id) && state.request.role === fact.role && state.request.attemptId === fact.attemptId &&
        state.request.requestId === d.request.requestId && state.request.scenario === input.spec.scenario, 'request-content-binding');
      if (input.requests) {
        const { payloadBase64, ...metadata } = state.request;
        check(same(metadata, d.request), 'request-metadata-binding');
        check(d.inputBytes === Buffer.byteLength(JSON.stringify(state.request)), 'request-input-bytes');
        check(d.payloadReference === `requests:${fact.role}:${fact.attemptId}`, 'request-payload-reference');
      }
    } else if (fact.event === 'readers-registered' && state) {
      check(state.registered === null && Array.isArray(d.channels) && new Set(d.channels).size === d.channels.length &&
        d.channels.every(channel => ['stdout', 'stderr', 'fd3'].includes(channel)), 'reader-registration');
      state.registered = d.channels;
    } else if (fact.event === 'spawn' && state) {
      check(!state.spawned && !state.spawnError && !state.launchRejected, 'spawn-lifecycle'); state.spawned = true;
    } else if (fact.event === 'process-close' && state) {
      state.closed = true;
    } else if (fact.event === 'launch-rejected' && state) {
      check(!state.spawned && d.reason === 'input-capacity' && d.inputBytes > d.limitBytes, 'invalid-launch-rejection');
      state.launchRejected = true;
      issue('input-capacity');
    } else if (fact.event === 'spawn-error' && state) {
      check(!state.exited, `spawn-error-after-exit:${fact.role}`);
      check(!state.spawned, `spawn-error-after-spawn:${fact.role}`);
      state.spawnError = { at, ...d };
    } else if (fact.event === 'exit' && state) {
      check(state.exited === null, `duplicate-exit:${fact.role}`);
      check((Number.isInteger(d.code) && d.signal === null) || (d.code === null && typeof d.signal === 'string'), 'exit-result');
      state.exited = { at, ordinal: fact.eventOrdinal, factId: fact.factId, ...d };
    } else if (fact.event === 'control-attempt' && state) {
      check(!state.exited && !state.spawnError, `control-after-exit:${fact.role}`);
      check(['SIGTERM', 'SIGKILL'].includes(d.signal), 'control-signal');
      state.controls.push({ at, ...d });
    } else if (fact.event === 'trace-overflow') {
      check(!overflow, 'duplicate-overflow'); overflow = true;
    } else if (fact.event === 'stream-data' && state) {
      const stream = state.streams[d.channel];
      if (!stream) { issue('stream-channel'); continue; }
      if (stream.endedAt !== null) issue('data-after-stream-end');
      let bytes;
      try { bytes = decodeBase64(d.bytesBase64); } catch { issue('stream-base64'); continue; }
      check(d.retainedBytes === undefined || d.retainedBytes === bytes.length, 'retained-byte-count');
      check(d.receivedBytes === undefined || integer(d.receivedBytes) && d.receivedBytes >= bytes.length, 'received-byte-count');
      stream.receivedBytes += d.receivedBytes ?? bytes.length;
      stream.retainedBytes += bytes.length;
      if ((d.receivedBytes ?? bytes.length) > bytes.length) state.truncated = true;
      if (d.channel === 'stderr') {
        stream.diagnosticBytes += bytes.length;
        if (stream.diagnosticBytes > 16 * 1024) issue('stderr-capacity');
        continue;
      }
      let offset = 0;
      while (offset < bytes.length) {
        frameOffset = offset;
        const newline = bytes.indexOf(10, offset);
        const end = newline < 0 ? bytes.length : newline + 1;
        const length = stream.pending.length + end - offset;
        if (length > 4096 || (newline < 0 && length === 4096)) {
          issue('frame-capacity'); stream.pending = Buffer.alloc(0);
          if (newline < 0) break;
          offset = end;
          continue;
        }
        stream.pending = Buffer.concat([stream.pending, bytes.subarray(offset, end)]);
        offset = end;
        if (newline < 0) break;
        const line = stream.pending;
        stream.pending = Buffer.alloc(0);
        if (!Buffer.from(line.toString('utf8')).equals(line)) { issue('frame-utf8'); continue; }
        let frame;
        try { frame = JSON.parse(line.toString('utf8')); } catch { issue('frame-json'); continue; }
        const failures = inspectFrame(frame, { id, role: fact.role, attemptId: state.request?.attemptId,
          requestId: state.request?.requestId, channel: d.channel });
        if (['start', 'caller-start'].includes(frame.type) && frame.payload?.scenario !== input.spec.scenario) failures.push('frame-scenario');
        for (const failure of failures) issue(failure);
        if (failures.length) continue;
        const sequence = frame.sourceSequence;
        if (state.sequences.has(sequence) || sequence <= (state.channels.get(d.channel) ?? 0)) issue('source-sequence');
        if (fact.role === 'caller') {
          if (frame.type !== 'bulk' && state.frames.some(prior => prior.frame.type === frame.type)) issue('caller-singleton-duplicate');
          if (state.frames.some(prior => prior.frame.type === 'caller-finished' && prior.frame.sourceSequence < sequence)) issue('caller-frame-after-terminal');
        }
        state.sequences.add(sequence);
        state.channels.set(d.channel, sequence);
        const record = { frame, at, ordinal: fact.eventOrdinal, frameOffset, factId: fact.factId, channel: d.channel };
        state.frames.push(record); rawFrames.push(record);
        if (fact.role === 'caller' && frame.type === 'caller-after-await' &&
            frame.sourceSequence !== (input.spec.scenario === 'D3v3-09' ? 5 : 4)) issue('caller-target-source-position');
        if (fact.role !== 'caller') {
          if (state.frames.length > 8) issue('helper-frame-capacity');
          if (state.terminal) issue('frame-after-terminal');
          if (['seal-claim', 'verified', 'publish-claim', 'failed'].includes(frame.type)) state.terminal = record;
        }
      }
    } else if (fact.event === 'stream-truncated' && state) {
      state.truncated = true;
    } else if (/^stream-(end|close|error|cancel)$/.test(fact.event) && state) {
      const stream = state.streams[d.channel];
      if (!stream) { issue('stream-channel'); continue; }
      if (fact.event === 'stream-end') {
        if (stream.endedAt !== null) issue('duplicate-stream-end');
        stream.endedAt = at;
        stream.endOrdinal = fact.eventOrdinal;
        if (stream.pending.length && !overflow) issue('truncated-frame');
      } else if (fact.event === 'stream-close') stream.closedAt = at;
      else if (fact.event === 'stream-cancel') stream.cancelledAt = at;
      else issue('stream-error');
    } else if (['process-error', 'request-error'].includes(fact.event) && state) {
      issue('process-error');
    } else if (fact.event === 'deadline') {
      if (d.name === 'caller-hard' && (!reports.has('processSettlement') || !capture && !readersSettled(roles.caller))) blocked = true;
      if (['evidence-hard', 'publication-hard'].includes(d.name) && !reports.has(d.name === 'evidence-hard' ? 'evidenceSettlement' : 'publication')) {
        const subjects = d.name === 'evidence-hard' ? [roles.writer, roles.verifier] : [roles.publisher];
        if (subjects.some(subject => subject.request && (!processKnown(subject) || !readersSettled(subject)))) blocked = true;
      }
    } else if (fact.event === 'capture-settled') {
      check(capture === null, 'duplicate-capture'); capture = { at, ordinal: fact.eventOrdinal, ...d };
    } else if (fact.event === 'report-frozen') {
      check(!reports.has(d.name), `duplicate-first-report:${d.name}`);
      reports.set(d.name, { ...d, at, ordinal: fact.eventOrdinal });
    }
  }
  for (const state of Object.values(roles)) {
    const frames = [...state.frames].sort((a, b) => a.frame.sourceSequence - b.frame.sourceSequence);
    const completion = Object.values(state.streams).reduce((at, s) => s.endedAt !== null && s.endedAt > at ? s.endedAt : at, frames.reduce((at, f) => f.at > at ? f.at : at, state.exited?.at ?? 0n));
    const completionOrdinal = Math.max(state.exited?.ordinal ?? 0, ...Object.values(state.streams).map(s => s.endOrdinal ?? 0), ...frames.map(frame => frame.ordinal));
    const callerFinished = state.role !== 'caller' || Boolean((state.exited || state.spawnError) && Object.values(state.streams).every(s => s.endedAt !== null));
    if (state.role === 'caller' && state.exited && callerFinished && !state.spawnError && frames.length === 0)
      state.errors.push({ at: completion, ordinal: completionOrdinal, reason: 'caller-start-missing' });
    for (let i = 0; i < frames.length; i++) {
      const current = frames[i], previous = frames[i - 1];
      if (callerFinished && !overflow && current.frame.sourceSequence !== i + 1) state.errors.push({ at: completion, ordinal: completionOrdinal, reason: 'source-gap' });
      if (callerFinished && previous && ns(current.frame.sentNs) < ns(previous.frame.sentNs)) state.errors.push({ at: completion, ordinal: completionOrdinal, reason: 'source-clock-regression' });
    }
    if (state.role === 'caller' && callerFinished && frames.length && !overflow) {
      let stage = 0, operation = null, bulk = 0;
      for (const { frame } of frames) {
        const type = frame.type;
        if (stage === 0 && type === 'caller-start') stage = 1;
        else if (stage === 1 && ['result-ready', 'operation-pending'].includes(type)) stage = 2;
        else if (stage === 2 && type === 'operation-returned') { stage = 3; operation = frame.payload.kind; }
        else if (stage === 3 && type === 'after-await-ready') stage = 4;
        else if ([3, 4].includes(stage) && type === 'caller-after-await' && frame.payload.kind === operation) stage = 5;
        else if (stage === 5 && type === 'bulk' && frame.payload.index === bulk + 1) bulk++;
        else if ([3, 5].includes(stage) && type === 'caller-finished') stage = 6;
        else state.errors.push({ at: completion, ordinal: completionOrdinal, reason: 'caller-grammar' });
      }
      if (state.exited && state.controls.length === 0 && completeBy(state, completion + 1n) && stage !== 6)
        state.errors.push({ at: completion, ordinal: completionOrdinal, reason: 'caller-missing-terminal' });
    }
    if (state.role !== 'caller' && frames.length) {
      const entered = { writer: 'write-entered', verifier: 'verify-entered', publisher: 'publish-entered' }[state.role];
      const terminal = { writer: 'seal-claim', verifier: 'verified', publisher: 'publish-claim' }[state.role];
      const types = frames.map(v => v.frame.type);
      const prefixes = [['start'], ['start', entered], ['start', 'failed'], ['start', entered, terminal], ['start', entered, 'failed']];
      if (!prefixes.some(p => same(p, types))) state.errors.push({ at: frames.at(-1).at, ordinal: frames.at(-1).ordinal, reason: 'helper-grammar' });
    }
  }
  return { errors, check, roles, reports, ids, id, trace, t0, e0, p0, overflow, capture, payloadBase64, rawFrames, blocked };
}

function processKnown(state) { return Boolean(state.exited || state.spawnError || state.launchRejected); }
function readersSettled(state) {
  return (state.registered ?? Object.keys(state.streams)).every(channel => state.streams[channel].endedAt !== null || state.streams[channel].closedAt !== null);
}

function completeBy(state, hard) {
  return (state.registered ?? Object.keys(state.streams)).every(channel => {
    const s = state.streams[channel];
    return s.endedAt !== null && s.endedAt < hard && s.cancelledAt === null && s.pending.length === 0;
  });
}

function helperResult(state, start, hard, expectedTerminal) {
  if (!state.request) return 'incomplete';
  const beforeHard = item => item.at < hard;
  if (state.errors.some(beforeHard) || (state.spawnError && state.spawnError.at < hard) ||
      state.frames.some(f => f.at < hard && f.frame.type === 'failed')) return 'failed';
  if (state.exited && state.exited.at < hard && state.controls.length === 0 && (state.exited.code !== 0 || state.exited.signal !== null)) return 'failed';
  const natural = state.exited && state.exited.code === 0 && state.exited.signal === null && state.exited.at < start + 1000n * NS && state.controls.length === 0;
  const terminal = state.terminal?.frame.type === expectedTerminal && state.terminal.at < hard;
  if (natural && completeBy(state, hard) && !terminal) return 'failed';
  return natural && completeBy(state, hard) && terminal && !state.truncated ? 'sealed' : 'incomplete';
}

function checkReport(result, report, name, expectedKind, deadline, earliest) {
  const { check, reports, ids } = result;
  if (!report || !check) { result.errors.push(`missing-report:${name}`); return; }
  check(report.kind === expectedKind, `report-kind:${name}:${expectedKind}`);
  check(report.deadlineNs === String(deadline), `report-deadline:${name}`);
  check(text(report.reason) && text(report.reportId), `report-identity:${name}`);
  check(same(report.id, result.id), `report-full-identity:${name}`);
  const event = reports.get(name);
  check(Boolean(event), `report-event:${name}`);
  if (event) {
    check(event.reportId === report.reportId && event.kind === report.kind && event.reason === report.reason, `report-event-mismatch:${name}`);
    check(report.frozenNs === String(event.at), `report-freeze-time:${name}`);
    check(report.eventOrdinal === event.ordinal, `report-freeze-ordinal:${name}`);
    check(event.at >= earliest, `report-before-fact:${name}`);
    check(report.factIds?.every(id => result.trace.some(f => f.factId === id && f.eventOrdinal < event.ordinal)), `report-future-fact:${name}`);
  }
  check(Array.isArray(report.factIds) && report.factIds.every(id => ids.has(id)), `report-fact-references:${name}`);
}

export function verifySavedCase(input) {
  try {
    const full = replay(input);
    const result = replayAtReport(input, 'evidenceSettlement');
    result.errors.push(...full.errors);
    const { check, roles, t0, e0, capture, overflow } = result;
    if (!check || t0 === null || e0 === null) return { pass: false, errors: [...result.errors, 'missing-phase-start'] };
    const caller = roles.caller;
    const observed = replayAtReport(input, 'observation').roles.caller;
    const observationDeadline = t0 + 2000n * NS, processDeadline = t0 + 6000n * NS;
    const candidate = observed.frames.find(f => f.frame.type === 'caller-after-await' && f.at < observationDeadline);
    const firstBad = observed.errors.find(e => (!e.category || e.category === 'protocol') && e.at < observationDeadline && (!candidate || e.at < candidate.at ||
      (e.at === candidate.at && (e.ordinal < candidate.ordinal || (e.ordinal === candidate.ordinal && e.frameOffset <= candidate.frameOffset)))));
    const observationKind = firstBad ? 'protocol-failed' : candidate ? 'observed-within-budget' : 'not-observed';
    const earlyEnd = observed.streams.fd3.endedAt;
    const observationAt = firstBad?.at ?? candidate?.at ?? (earlyEnd !== null && earlyEnd < observationDeadline ? earlyEnd : observationDeadline);
    checkReport(result, input.reports?.observation, 'observation', observationKind, observationDeadline, observationAt);
    const processFacts = replayAtReport(input, 'processSettlement').roles.caller;
    const exit = processFacts.exited && processFacts.exited.at < processDeadline ? processFacts.exited : null;
    const spawnError = processFacts.spawnError && processFacts.spawnError.at < processDeadline ? processFacts.spawnError : null;
    const processKind = exit ? 'exit-observed' : spawnError ? 'spawn-failed' : 'unconfirmed';
    checkReport(result, input.reports?.processSettlement, 'processSettlement', processKind, processDeadline, exit?.at ?? spawnError?.at ?? processDeadline);
    if (exit) {
      check(input.reports.processSettlement.code === exit.code, 'process-exit-code');
      check(input.reports.processSettlement.signal === exit.signal, 'process-exit-signal');
    }
    if (input.reports?.processSettlement?.controlAttempts) {
      const cutoff = result.reports.get('processSettlement')?.ordinal ?? 0;
      const controls = input.trace.filter(f => f.event === 'control-attempt' && f.role === 'caller' && f.eventOrdinal < cutoff)
        .map(f => ({ ...f.details, receiptNs: f.receiptNs, factId: f.factId }));
      check(same(input.reports.processSettlement.controlAttempts, controls), 'process-control-attempts');
    }
    check(Boolean(capture), 'capture-missing');
    check(result.reports.has('observation') && result.reports.has('processSettlement'), 'missing-first-reports');
    if (capture) {
      check(e0 >= capture.at, 'evidence-before-capture');
      for (const name of ['observation', 'processSettlement']) check(e0 >= (result.reports.get(name)?.at ?? e0 + 1n), `evidence-before-${name}`);
    }
    // Capture is a first observation too: later exit/EOF cannot repair its cutoff.
    const capturePrefix = replay({ ...input, trace: input.trace.filter(fact => fact.eventOrdinal <= (capture?.ordinal ?? 0)) });
    const captureFailed = capturePrefix.roles.caller.errors.some(e => e.category !== 'lifecycle');
    const captureComplete = Boolean(capture && capture.at < processDeadline && !captureFailed && !capturePrefix.overflow &&
      completeBy(capturePrefix.roles.caller, processDeadline));
    if (capture) check(capture.integrity === (captureFailed ? 'failed' : captureComplete ? 'complete' : 'incomplete'), 'capture-integrity');
    const hard = e0 + 2000n * NS;
    const writer = helperResult(roles.writer, e0, hard, 'seal-claim');
    const verifier = helperResult(roles.verifier, e0, hard, 'verified');
    if (roles.verifier.request) {
      check(roles.verifier.spawnAt < e0 + 1000n * NS, 'late-verifier-spawn');
      check(roles.writer.exited && roles.writer.exited.ordinal < roles.verifier.spawnOrdinal, 'verifier-before-writer-exit');
      check(completeBy(roles.writer, roles.verifier.spawnAt + 1n) && Object.values(roles.writer.streams).every(stream => stream.endOrdinal < roles.verifier.spawnOrdinal), 'verifier-before-writer-eof');
      check(roles.writer.terminal?.frame.type === 'seal-claim' && roles.writer.terminal.ordinal < roles.verifier.spawnOrdinal &&
        !roles.writer.errors.some(error => error.ordinal < roles.verifier.spawnOrdinal), 'verifier-before-valid-claim');
      const verification = JSON.parse(decodeBase64(roles.verifier.request.payloadBase64).toString('utf8'));
      check(keysEqual(verification, ['schema', 'expectedPayloadBase64', 'writerAttemptId', 'writerRequestId']) &&
        verification.schema === 'diagnostic-settlement-verification-input-v3' && verification.expectedPayloadBase64 === result.payloadBase64 &&
        verification.writerAttemptId === roles.writer.request.attemptId && verification.writerRequestId === roles.writer.request.requestId &&
        roles.writer.request.payloadBase64 === result.payloadBase64, 'verifier-request-content');
    }
    const missingCallerTerminal = !caller.spawnError && !caller.frames.some(f => f.frame.type === 'caller-finished');
    let integrity = captureFailed || caller.errors.some(e => e.category === 'lifecycle') || writer === 'failed' || verifier === 'failed' ? 'failed' :
      captureComplete && !missingCallerTerminal && writer === 'sealed' && verifier === 'sealed' ? 'sealed' : 'incomplete';
    if (roles.verifier.terminal?.frame.type === 'verified') {
      const bytes = decodeBase64(result.payloadBase64);
      const expected = roles.verifier.terminal.frame.payload;
      check(expected.bytes === bytes.length && expected.sha256 === digest(bytes), 'verified-wrong-request-content');
      check(same(expected, roles.writer.terminal?.frame.payload), 'writer-verifier-claim-mismatch');
    }
    const evidence = input.reports?.evidenceSettlement;
    checkReport(result, evidence, 'evidenceSettlement', integrity, hard, e0);
    const artifactVerified = Boolean(roles.verifier.terminal?.frame.type === 'verified' &&
      !roles.verifier.errors.some(error => !error.category || error.category === 'protocol'));
    check(evidence?.artifactVerified === artifactVerified, 'artifact-proof-flag');
    verifyLedgers(input, full, result, evidence, ['writer', 'verifier']);
    for (const role of ['caller', 'writer', 'verifier']) for (const action of roles[role].controls) {
      const base = role === 'caller' ? t0 : e0;
      const ms = role === 'caller' ? (action.signal === 'SIGTERM' ? 5000 : 5500) : (action.signal === 'SIGTERM' ? 1000 : 1500);
      check(action.at >= base + BigInt(ms) * NS, `premature-control:${role}`);
    }
    checkScenario(input, result, { observationKind, processKind, integrity });
    return { pass: result.errors.length === 0, errors: result.errors,
      derived: { observation: observationKind, processSettlement: processKind, evidenceSettlement: integrity, captureComplete } };
  } catch (error) { return { pass: false, errors: [`oracle-exception:${error.message}`] }; }
}

function checkScenario(input, result, { observationKind, processKind, integrity }) {
  const scenario = input.spec.scenario;
  if (!/^D3v3-(0[1-9]|1[0-2])$/.test(scenario)) return;
  const { check, roles, trace, t0 } = { ...result, trace: input.trace };
  const number = Number(scenario.slice(-2));
  check(observationKind === ([3, 5, 9, 10].includes(number) ? 'not-observed' : 'observed-within-budget'), 'scenario-observation');
  check(processKind === (number === 10 ? 'spawn-failed' : 'exit-observed'), 'scenario-process');
  const expectedEvidence = [6, 11].includes(number) ? 'failed' : [3, 4, 7, 8, 12].includes(number) ? 'incomplete' : 'sealed';
  check(integrity === expectedEvidence, `scenario-evidence:${expectedEvidence}`);
  const hasFrame = (role, type) => roles[role].frames.find(f => f.frame.type === type);
  const ackFor = (role, type) => trace.find(f => f.role === role && f.event === 'ack-sent' && f.details.forType === type);
  if (number === 2) check(hasFrame('caller', 'operation-returned')?.frame.payload.kind === 'timeout', 'pending-operation-raw');
  if ([3, 4].includes(number)) {
    check(Boolean(hasFrame('caller', 'result-ready')), 'caller-block-prerequisite');
    check(roles.caller.controls.length > 0, 'caller-block-not-controlled');
  }
  if ([4, 8].includes(number)) {
    const ack = ackFor('caller', 'caller-after-await'), observed = hasFrame('caller', 'caller-after-await');
    check(Boolean(ack && observed && ns(ack.receiptNs) >= observed.at), 'after-await-ack-prerequisite');
    const bulk = hasFrame('caller', 'bulk');
    if (number === 8) check(Boolean(result.overflow && bulk && ack && bulk.at >= ns(ack.receiptNs)), 'bulk-after-ack-overflow');
  }
  if (number === 6) check(hasFrame('writer', 'failed')?.frame.payload.code === 'EEXIST', 'writer-eexist-prerequisite');
  for (const [n, role, type] of [[7, 'writer', 'write-entered'], [12, 'verifier', 'verify-entered']]) if (number === n) {
    const entered = hasFrame(role, type), ack = ackFor(role, type);
    check(Boolean(entered?.frame.payload.mode === 'sync-block' && ack && ns(ack.receiptNs) >= entered.at), 'helper-block-prerequisite');
    check(roles[role].controls.length > 0, 'helper-block-not-controlled');
  }
  if (number === 9) {
    const ack = ackFor('caller', 'after-await-ready'), late = hasFrame('caller', 'caller-after-await');
    check(Boolean(ack && ns(ack.receiptNs) >= t0 + 2200n * NS && late && late.at >= ns(ack.receiptNs)), 'late-delivery-prerequisite');
  }
  if (number === 11) check(roles.writer.errors.length > 0 && roles.verifier.request === null, 'invalid-writer-sticky');
}

export function verifyPublicationSnapshot(input) {
  try {
    const full = replay(input);
    const result = replayAtReport(input, 'publication');
    result.errors.push(...full.errors);
    if (result.p0 === null || !result.check) return { pass: false, errors: [...result.errors, 'missing-publication-start'] };
    const hard = result.p0 + 2000n * NS;
    const helper = helperResult(result.roles.publisher, result.p0, hard, 'publish-claim');
    const kind = helper === 'sealed' ? 'published' : helper;
    const report = input.report ?? input.publication ?? input.reports?.publication;
    checkReport(result, report, 'publication', kind, hard, result.p0);
    verifyLedgers(input, full, result, report, ['publisher']);
    for (const control of result.roles.publisher.controls) result.check(control.at >= result.p0 + BigInt(control.signal === 'SIGTERM' ? 1000 : 1500) * NS, 'premature-publisher-control');
    const expected = { 'publisher-normal': 'published', 'publisher-eexist': 'failed', 'publisher-partial-failure': 'failed', 'publisher-block': 'incomplete' }[input.spec?.scenario];
    if (expected) result.check(kind === expected, 'publisher-scenario-result');
    return { pass: result.errors.length === 0, errors: result.errors, derived: { publication: kind } };
  } catch (error) { return { pass: false, errors: [`oracle-exception:${error.message}`] }; }
}

function replayAtReport(input, name) {
  const ordinal = input.reports?.[name]?.eventOrdinal ?? input.report?.eventOrdinal ?? input.publication?.eventOrdinal;
  return replay({ ...input, trace: input.trace?.filter(fact => fact.eventOrdinal <= ordinal) });
}

function verifyLedgers(input, full, first, report, helperRoles) {
  if (!input.owner) {
    if (input.schema === 'diagnostic-settlement-v3') first.check(false, 'missing-owner-snapshot');
    return;
  }
  const check = first.check;
  const owner = input.owner;
  check(same(owner.id, input.spec.id), 'owner-identity');
  check(owner.blocked === full.blocked, 'owner-blocked');
  check(same(owner.reservedSlots, ['caller', 'evidence-helper', 'publisher']), 'owner-reserved-slots');
  const inspect = (ledger, state, prefix) => {
    if (!ledger || !state.request) { check(false, `${prefix}-missing`); return; }
    check(ledger.attemptId === state.request.attemptId && ledger.requestId === state.request.requestId, `${prefix}-identity`);
    check(ledger.spawned === state.spawned && ledger.spawnFailed === Boolean(state.spawnError || state.launchRejected) &&
      ledger.launchRejected === state.launchRejected && ledger.close === state.closed, `${prefix}-process-flags`);
    check(ledger.processResponsibility === (processKnown(state) ? 'concluded' : 'unconfirmed'), `${prefix}-process-responsibility`);
    check(ledger.streamResponsibility === (readersSettled(state) ? 'concluded' : 'unconfirmed'), `${prefix}-stream-responsibility`);
    const exited = state.exited;
    check(same(ledger.exit, exited ? { code: exited.code, signal: exited.signal, receiptNs: String(exited.at),
      factId: exited.factId, eventOrdinal: exited.ordinal } : null), `${prefix}-exit-proof`);
    check(Array.isArray(state.registered), `${prefix}-missing-reader-registration`);
    for (const [channel, stream] of Object.entries(state.streams)) {
      const saved = ledger.streams?.[channel];
      check(saved?.registered === Boolean(state.registered?.includes(channel)) && saved.end === (stream.endedAt !== null) &&
        saved.close === (stream.closedAt !== null) && saved.cancelled === (stream.cancelledAt !== null), `${prefix}-${channel}-reader-proof`);
      if (!full.overflow) check(saved?.receivedBytes === stream.receivedBytes && saved?.retainedBytes === stream.retainedBytes, `${prefix}-${channel}-bytes`);
    }
  };
  const active = Object.values(full.roles).filter(state => state.request);
  check(Array.isArray(owner.roles) && same(owner.roles.map(role => role.role), active.map(role => role.role)), 'owner-role-inventory');
  for (const state of active) inspect(owner.roles?.find(role => role.role === state.role), state, `owner-${state.role}`);
  const helpers = helperRoles.filter(role => first.roles[role].request);
  check(Array.isArray(report?.helpers) && same(report.helpers.map(role => role.role), helpers), 'report-helper-inventory');
  for (const role of helpers) inspect(report?.helpers?.find(helper => helper.role === role), first.roles[role], `report-${role}`);
  check(Array.isArray(report?.errors) && Array.isArray(report?.incomplete), 'report-error-inventory');
  if (['sealed', 'published'].includes(report?.kind)) check(report.errors.length === 0 && report.incomplete.length === 0, 'successful-report-extra-errors');
  if (report?.kind === 'failed') check(report.errors.length > 0, 'failed-report-missing-errors');
  check(owner.traceCapacity?.events === input.trace.length && owner.traceCapacity?.bytes === input.trace.reduce((bytes, fact) => bytes + Buffer.byteLength(JSON.stringify(fact)), 0), 'trace-capacity-counts');
  check(input.trace.length <= 4096 && (owner.traceCapacity?.bytes ?? Infinity) <= 1024 * 1024, 'trace-capacity-bound');
  check(owner.lateCapacity?.events === input.lateJournal?.length && owner.lateCapacity?.bytes === input.lateJournal?.reduce((bytes, fact) => bytes + Buffer.byteLength(JSON.stringify(fact)), 0), 'late-capacity-counts');
  check((input.lateJournal?.length ?? Infinity) <= 256 && (owner.lateCapacity?.bytes ?? Infinity) <= 64 * 1024, 'late-capacity-bound');
  const lateIds = new Set();
  for (const entry of input.lateJournal ?? []) {
    const { lateFactId, firstReportIds, ...fact } = entry;
    check(lateFactId === `${entry.factId}:late` && !lateIds.has(lateFactId), 'late-fact-identity');
    lateIds.add(lateFactId);
    const original = input.trace.find(candidate => candidate.factId === entry.factId);
    check(original ? same(fact, original) : full.overflow, 'late-raw-fact-binding');
    check(Array.isArray(firstReportIds) && firstReportIds.length > 0 && firstReportIds.every(id =>
      Object.values(input.reports).some(report => report.reportId === id && report.eventOrdinal < entry.eventOrdinal)), 'late-first-report-binding');
  }
}
