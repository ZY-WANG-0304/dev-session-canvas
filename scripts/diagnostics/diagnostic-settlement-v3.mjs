import { spawn } from 'node:child_process';
import { isAbsolute, posix, win32 } from 'node:path';
import { ERROR_POLICY, ErrorBudget, normalizeError } from './settlement-error-budget-v1.mjs';

export const SCHEMA = 'diagnostic-settlement-v3';
export const FRAME_SCHEMA = 'diagnostic-settlement-frame-v3';
export const REQUEST_SCHEMA = 'diagnostic-settlement-request-v3';
export const ACK_SCHEMA = 'diagnostic-settlement-ack-v3';
export const BUDGET_MS = Object.freeze({ observation: 2000, term: 5000, kill: 5500, hard: 6000, work: 1000, helperKill: 1500, helperHard: 2000 });
export const LIMITS = Object.freeze({ frame: 4096, events: 4096, traceBytes: 1048576, controlEvents: 64, controlBytes: 65536, lateEvents: 256, lateBytes: 65536, helperFrames: 8, helperStderr: 16384, input: 2097152, publicationInput: 4194304 });

const NS_PER_MS = 1000000n;
const CHANNELS = ['stdout', 'stderr', 'fd3'];
const FRAME_KEYS = ['schema', 'role', 'runId', 'caseId', 'generation', 'nonce', 'attemptId', 'requestId', 'sourceSequence', 'sentNs', 'type', 'payload'];
const REAL_CLOCK = Object.freeze({ nowNs: () => process.hrtime.bigint(), setTimeout, clearTimeout, queueMicrotask });
const own = (object, key) => Object.hasOwn(object, key);
const jsonCopy = (value) => JSON.parse(JSON.stringify(value));
const freeze = (value) => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
};
const immutable = (value) => freeze(jsonCopy(value));
const exactKeys = (value, keys) => value !== null && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === keys.length && keys.every((key) => own(value, key));
const text = (value, max = 256) => typeof value === 'string' && value.length > 0 && value.length <= max;
const integer = (value) => Number.isSafeInteger(value) && value >= 0;
const digest = (value) => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
const decimalNs = (value) => typeof value === 'string' && /^(0|[1-9][0-9]{0,29})$/.test(value);
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};

function validateId(id) {
  if (!exactKeys(id, ['schema', 'runId', 'caseId', 'generation', 'nonce']) || id.schema !== SCHEMA || !text(id.runId) || !text(id.caseId) || !text(id.nonce) || !(integer(id.generation) || text(id.generation))) throw new TypeError('Invalid complete case identity');
}

function absoluteTestPath(value, style) {
  if (!style) return isAbsolute(value);
  if (style === 'posix') return posix.isAbsolute(value);
  const windowsPath = value.replaceAll('/', '\\');
  if (/^\\\\[?.]\\/.test(windowsPath)) return false;
  return win32.isAbsolute(windowsPath) && (/^[A-Za-z]:\\/.test(windowsPath) || /^\\\\[^\\]+\\[^\\]+(?:\\|$)/.test(windowsPath));
}

function validateSpec(spec, publication, pathStyle) {
  const allowed = publication
    ? ['id', 'scenario', 'entryPath', 'artifactDirectory', 'archiveAttemptId', 'snapshotOrdinal', 'payloadBase64', 'gates']
    : ['id', 'scenario', 'entryPath', 'artifactDirectory', 'command', 'gates'];
  if (!spec || typeof spec !== 'object' || Array.isArray(spec) || Object.keys(spec).some((key) => !allowed.includes(key))) throw new TypeError('Invalid case configuration keys');
  validateId(spec.id);
  if (!text(spec.scenario) || !text(spec.entryPath, 32768) || !absoluteTestPath(spec.entryPath, pathStyle) || !text(spec.artifactDirectory, 32768) || !absoluteTestPath(spec.artifactDirectory, pathStyle)) throw new TypeError('Scenario and absolute entry/artifact paths are required');
  if (own(spec, 'command') && (!exactKeys(spec.command, ['file', 'args']) || !text(spec.command.file, 32768) || !absoluteTestPath(spec.command.file, pathStyle) || !Array.isArray(spec.command.args) || spec.command.args.some((arg) => typeof arg !== 'string'))) throw new TypeError('Invalid direct executable command');
  const gates = publication ? ['publisher'] : ['caller', 'writer', 'capture'];
  if (own(spec, 'gates') && (!spec.gates || typeof spec.gates !== 'object' || Array.isArray(spec.gates) || Object.entries(spec.gates).some(([key, value]) => !gates.includes(key) || typeof value !== 'boolean'))) throw new TypeError('Invalid gate configuration');
  if (publication) {
    if (!text(spec.archiveAttemptId) || !integer(spec.snapshotOrdinal) || typeof spec.payloadBase64 !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(spec.payloadBase64)) throw new TypeError('Invalid publication snapshot');
    if (Buffer.byteLength(spec.payloadBase64) > LIMITS.publicationInput) throw new TypeError('Publication request exceeds capacity');
  }
}

function validateDependencies(deps) {
  if (!deps || typeof deps !== 'object' || Object.keys(deps).some((key) => !['clock', 'spawnRole', 'pathStyle'].includes(key))) throw new TypeError('Invalid test dependencies');
  if (own(deps, 'pathStyle') && (!['posix', 'win32'].includes(deps.pathStyle) || !own(deps, 'clock') || !deps.clock || !own(deps, 'spawnRole') || typeof deps.spawnRole !== 'function')) throw new TypeError('Path style requires an explicit diagnostic clock and transport');
  const clock = deps.clock ?? REAL_CLOCK;
  if (['nowNs', 'setTimeout', 'clearTimeout', 'queueMicrotask'].some((key) => typeof clock[key] !== 'function')) throw new TypeError('Invalid diagnostic clock');
  if (own(deps, 'spawnRole') && typeof deps.spawnRole !== 'function') throw new TypeError('Invalid direct-child transport');
  return clock;
}

function validatePayload(role, type, payload, scenario) {
  const empty = () => exactKeys(payload, []);
  if (role === 'caller') {
    if (type === 'caller-start') return exactKeys(payload, ['scenario']) && payload.scenario === scenario;
    if (['result-ready', 'operation-pending', 'after-await-ready'].includes(type)) return empty();
    if (['operation-returned', 'caller-after-await'].includes(type)) return exactKeys(payload, ['kind']) && ['returned', 'timeout'].includes(payload.kind);
    if (type === 'bulk') return exactKeys(payload, ['index', 'body']) && integer(payload.index) && payload.index > 0 && typeof payload.body === 'string';
    return type === 'caller-finished' && exactKeys(payload, ['exitCode']) && payload.exitCode === 0;
  }
  if (type === 'start') return exactKeys(payload, ['scenario']) && payload.scenario === scenario;
  const action = { writer: 'write', verifier: 'verify', publisher: 'publish' }[role];
  if (type === `${action}-entered`) return exactKeys(payload, ['mode']) && [action, 'sync-block'].includes(payload.mode);
  if (type === 'failed') return exactKeys(payload, ['code', 'message']) && text(payload.code) && typeof payload.message === 'string' && payload.message.length <= 2048;
  if (type === 'publish-claim' && role === 'publisher') return exactKeys(payload, ['files', 'manifestSha256']) && integer(payload.files) && digest(payload.manifestSha256);
  return ((role === 'writer' && type === 'seal-claim') || (role === 'verifier' && type === 'verified')) && exactKeys(payload, ['bytes', 'sha256', 'manifestSha256']) && integer(payload.bytes) && digest(payload.sha256) && digest(payload.manifestSha256);
}

class SettlementOwner {
  constructor(spec, deps, publication) {
    this.spec = immutable(spec);
    this.id = this.spec.id;
    this.clock = validateDependencies(deps);
    this.spawnRole = deps.spawnRole;
    this.publicationOnly = publication;
    this.t0 = this.clock.nowNs();
    if (typeof this.t0 !== 'bigint' || this.t0 < 0n) throw new TypeError('Clock must return nonnegative bigint nanoseconds');
    this.ordinal = 0;
    this.trace = [];
    this.traceBytes = 0;
    this.normalEvents = 0;
    this.normalBytes = 0;
    this.controlEvents = 0;
    this.controlBytes = 0;
    this.traceOverflow = null;
    this.controlOverflow = false;
    this.lateJournal = [];
    this.lateIds = new Set();
    this.lateBytes = 0;
    this.lateOverflow = false;
    this.listeners = new Set();
    this.listenerQueue = [];
    this.listenerQueued = false;
    this.listenerFailureBudget = new ErrorBudget();
    this.listenerFailures = this.listenerFailureBudget.records;
    this.errorFieldsTruncated = false;
    this.roles = [];
    this.requests = [];
    this.reports = {};
    this.pending = {};
    this.timers = new Set();
    this.deadlineFacts = new Set();
    this.capture = null;
    this.e0 = null;
    this.p0 = publication ? this.t0 : null;
    this.blocked = false;
    this.blockReasons = [];
    this.evidenceErrors = new Set();
    this.evidenceIncomplete = new Set();
    this.guardActive = false;
    this.pumpActive = false;
    this.heldAcks = new Map();
    this.gateWaiters = new Map();
    this.gateReports = new Map();
    this.captureHeld = [];
    this.captureHeldBytes = 0;
    this.releasedGates = new Set();
    for (const name of publication ? ['publication'] : ['observation', 'processSettlement', 'evidenceSettlement']) this.pending[name] = deferred();
    this.record(publication ? 'publication-start' : 'case-start', null, publication
      ? { p0Ns: this.t0.toString(), deadlines: this.helperDeadlines(this.t0), archiveAttemptId: spec.archiveAttemptId, snapshotOrdinal: spec.snapshotOrdinal }
      : { t0Ns: this.t0.toString(), deadlines: this.callerDeadlines() }, true);
    this.arm(this.t0 + BigInt(publication ? BUDGET_MS.work : BUDGET_MS.observation) * NS_PER_MS);
    this.arm(this.t0 + BigInt(publication ? BUDGET_MS.helperKill : BUDGET_MS.term) * NS_PER_MS);
    this.arm(this.t0 + BigInt(publication ? BUDGET_MS.helperHard : BUDGET_MS.kill) * NS_PER_MS);
    if (!publication) this.arm(this.t0 + BigInt(BUDGET_MS.hard) * NS_PER_MS);
    this.clock.queueMicrotask(() => {
      this.guard();
      if (publication) {
        if (!this.reports.publication) this.launch('publisher', spec.payloadBase64);
      } else if (!this.reports.processSettlement) this.launch('caller', '');
      this.pump();
    });
  }

  callerDeadlines() {
    return Object.fromEntries(['observation', 'term', 'kill', 'hard'].map((name) => [`${name}Ns`, (this.t0 + BigInt(BUDGET_MS[name]) * NS_PER_MS).toString()]));
  }

  helperDeadlines(origin) {
    return { workNs: (origin + 1000n * NS_PER_MS).toString(), killNs: (origin + 1500n * NS_PER_MS).toString(), hardNs: (origin + 2000n * NS_PER_MS).toString() };
  }

  arm(deadline) {
    const delay = Number((deadline - this.clock.nowNs() + NS_PER_MS - 1n) / NS_PER_MS);
    let timer;
    timer = this.clock.setTimeout(() => {
      this.timers.delete(timer);
      this.guard();
      this.pump();
    }, Math.max(0, delay));
    this.timers.add(timer);
  }

  record(event, state, details, control = false) {
    if (details.truncatedFields?.length || details.error?.truncatedFields?.length) this.errorFieldsTruncated = true;
    const ordinal = ++this.ordinal;
    const fact = { factId: `${this.id.nonce}:fact:${ordinal}`, eventOrdinal: ordinal, receiptNs: this.clock.nowNs().toString(), event, role: state?.role ?? null, attemptId: state?.attemptId ?? null, details: jsonCopy(details) };
    const bytes = Buffer.byteLength(JSON.stringify(fact));
    const fitsNormal = this.normalEvents < LIMITS.events - LIMITS.controlEvents && this.normalBytes + bytes <= LIMITS.traceBytes - LIMITS.controlBytes;
    if (fitsNormal && !this.traceOverflow) {
      this.normalEvents++;
      this.normalBytes += bytes;
      this.trace.push(freeze(fact));
      this.traceBytes += bytes;
    } else if (control && this.controlEvents < LIMITS.controlEvents && this.controlBytes + bytes <= LIMITS.controlBytes) {
      this.controlEvents++;
      this.controlBytes += bytes;
      this.trace.push(freeze(fact));
      this.traceBytes += bytes;
    } else if (!this.traceOverflow) {
      this.traceOverflow = { firstOmittedOrdinal: ordinal, reason: 'trace-capacity' };
      this.evidenceIncomplete.add('trace-capacity');
      this.record('trace-overflow', null, this.traceOverflow, true);
    } else if (control) {
      this.controlOverflow = true;
      this.evidenceIncomplete.add('control-capacity');
    }
    if (!['report-frozen', 'listener-error'].includes(event) && (this.reports.evidenceSettlement || this.reports.publication || (state?.role === 'caller' && this.reports.processSettlement?.kind === 'unconfirmed'))) this.appendLate(fact, Object.values(this.reports).map((report) => report.reportId));
    return fact;
  }

  appendLate(fact, reportIds) {
    if (this.lateIds.has(fact.factId)) return;
    const entry = { ...jsonCopy(fact), lateFactId: `${fact.factId}:late`, firstReportIds: reportIds };
    const bytes = Buffer.byteLength(JSON.stringify(entry));
    if (this.lateJournal.length >= LIMITS.lateEvents || this.lateBytes + bytes > LIMITS.lateBytes) {
      this.lateOverflow = true;
      return;
    }
    this.lateJournal.push(freeze(entry));
    this.lateIds.add(fact.factId);
    this.lateBytes += bytes;
    if (this.listeners.size) {
      this.listenerQueue.push(entry);
      if (!this.listenerQueued) {
        this.listenerQueued = true;
        this.clock.queueMicrotask(() => this.deliverLate());
      }
    }
  }

  deliverLate() {
    this.listenerQueued = false;
    const queued = this.listenerQueue.splice(0);
    for (const entry of queued) for (const listener of [...this.listeners]) {
      try { listener(entry); } catch (error) {
        const normalized = normalizeError(error);
        // Observer failures are recorded without recursively notifying the same listeners.
        const fact = this.record('listener-error', null, { sourceFactId: entry.factId, error: normalized }, true);
        this.listenerFailureBudget.append({ factId: entry.factId, error: normalized }, fact.factId, Boolean(normalized.truncatedFields?.length));
      }
    }
  }

  first(name, kind, reason, deadline, facts = [], extra = {}) {
    if (this.reports[name]) return this.reports[name];
    if (name === 'evidenceSettlement') this.expireGate('writer', 'evidence-settled-without-gate');
    if (name === 'publication') this.expireGate('publisher', 'publication-settled-without-gate');
    const reportId = `${this.id.nonce}:report:${name}`;
    const fact = this.record('report-frozen', null, { name, reportId, kind, reason }, true);
    const report = immutable({ id: this.id, reportId, deadlineNs: deadline.toString(), frozenNs: fact.receiptNs, eventOrdinal: fact.eventOrdinal, kind, reason, factIds: facts.map((value) => typeof value === 'string' ? value : value.factId), ...extra, errorDiagnosticsComplete: this.errorDiagnosticsComplete() });
    this.reports[name] = report;
    this.pending[name].resolve(report);
    return report;
  }

  block(reason) {
    this.blocked = true;
    if (!this.blockReasons.includes(reason)) this.blockReasons.push(reason);
  }

  deadline(name, deadline) {
    if (this.deadlineFacts.has(name) || this.clock.nowNs() < deadline) return false;
    this.deadlineFacts.add(name);
    this.record('deadline', null, { name, deadlineNs: deadline.toString() }, true);
    return true;
  }

  guard() {
    if (this.guardActive) return;
    this.guardActive = true;
    try {
      if (!this.publicationOnly) {
        const caller = this.roles.find((state) => state.role === 'caller');
        const observation = this.t0 + 2000n * NS_PER_MS;
        if (this.deadline('observation', observation) && !this.reports.observation) this.first('observation', 'not-observed', 'observation-deadline', observation);
        if (this.deadline('caller-hard', this.t0 + 6000n * NS_PER_MS)) {
          this.expireGate('caller', 'caller-hard-deadline');
          this.expireGate('capture', 'caller-hard-deadline');
          if (!this.reports.processSettlement) {
            this.first('processSettlement', 'unconfirmed', 'process-hard-deadline', this.t0 + 6000n * NS_PER_MS, [], { code: null, signal: null, controlAttempts: caller?.controlAttempts ?? [] });
            this.block('caller-process-unconfirmed');
          }
          if (!this.capture) {
            this.evidenceIncomplete.add('capture-hard-deadline');
            if (!this.readersSettled(caller)) this.block('caller-capture-unconfirmed');
            this.settleCapture(caller, true);
            this.cancelStreams(caller, 'capture-hard-deadline');
          }
        }
        if (this.deadline('caller-term', this.t0 + 5000n * NS_PER_MS)) this.control(caller, 'SIGTERM');
        if (this.deadline('caller-kill', this.t0 + 5500n * NS_PER_MS)) this.control(caller, 'SIGKILL');
      }
      const origin = this.publicationOnly ? this.p0 : this.e0;
      if (origin !== null) {
        const prefix = this.publicationOnly ? 'publication' : 'evidence';
        const active = this.roles.filter((state) => this.publicationOnly ? state.role === 'publisher' : ['writer', 'verifier'].includes(state.role));
        if (this.deadline(`${prefix}-hard`, origin + 2000n * NS_PER_MS)) {
          this.expireGate(this.publicationOnly ? 'publisher' : 'writer', `${prefix}-hard-deadline`);
          const reportName = this.publicationOnly ? 'publication' : 'evidenceSettlement';
          if (!this.reports[reportName]) {
            this.evidenceIncomplete.add(`${prefix}-hard-deadline`);
            for (const state of active) if (!this.processKnown(state) || !this.readersSettled(state)) this.block(`${state.role}-responsibility-unconfirmed`);
            this.finishEvidence(true);
            for (const state of active) this.cancelStreams(state, `${prefix}-hard-deadline`);
          }
        }
        if (this.deadline(`${prefix}-work`, origin + 1000n * NS_PER_MS)) {
          for (const state of active) this.control(state, 'SIGTERM');
          if (!this.reports[prefix === 'evidence' ? 'evidenceSettlement' : 'publication']) {
            if (active.some((state) => !this.processKnown(state))) this.evidenceIncomplete.add(`${prefix}-work-deadline`);
            if (!this.publicationOnly && !active.some((state) => state.role === 'verifier')) this.evidenceIncomplete.add('verifier-not-started-before-work-deadline');
          }
        }
        if (this.deadline(`${prefix}-kill`, origin + 1500n * NS_PER_MS)) for (const state of active) this.control(state, 'SIGKILL');
      }
    } finally { this.guardActive = false; }
  }

  launch(role, payloadBase64) {
    this.guard();
    const attemptId = `${this.id.caseId}:${role}:1`;
    const requestId = `${this.id.nonce}:${role}:request:1`;
    const request = { schema: REQUEST_SCHEMA, id: this.id, role, attemptId, requestId, scenario: this.spec.scenario, artifactDirectory: this.spec.artifactDirectory, payloadBase64 };
    const encoded = Buffer.from(JSON.stringify(request), 'utf8');
    const state = { role, attemptId, requestId, request, child: null, spawned: false, spawnFailed: false, launchRejected: false, readersRegistered: false, exit: null, close: false, streams: {}, errors: [], protocolErrors: [], frames: [], frameCount: 0, sequences: new Set(), channelSequences: {}, parser: {}, stage: 0, terminal: null, controlAttempts: [], enteredAcknowledged: false, omittedBulk: 0, gateBuffer: Buffer.alloc(0), lastHelperSentNs: -1n };
    state.errorBudget = new ErrorBudget();
    state.errors = state.errorBudget.records;
    for (const channel of CHANNELS) {
      const errorBudget = new ErrorBudget();
      state.streams[channel] = { registered: false, end: false, close: false, cancelled: false, errors: errorBudget.records, errorBudget, receivedBytes: 0, retainedBytes: 0 };
      state.parser[channel] = Buffer.alloc(0);
    }
    this.roles.push(state);
    this.requests.push(immutable(request));
    const { payloadBase64: payload, ...requestIdentity } = request;
    this.record('spawn-request', state, { request: requestIdentity, inputBytes: encoded.length, payloadReference: `requests:${role}:${attemptId}` }, true);
    if (encoded.length > (role === 'publisher' ? LIMITS.publicationInput : LIMITS.input)) {
      state.spawnFailed = true;
      state.launchRejected = true;
      const error = { name: 'RangeError', code: 'INPUT_CAPACITY', message: 'Helper request exceeds capacity' };
      const fact = this.record('launch-rejected', state, { reason: 'input-capacity', inputBytes: encoded.length, limitBytes: role === 'publisher' ? LIMITS.publicationInput : LIMITS.input, error }, true);
      state.errorBudget.append({ ...error, factId: fact.factId }, fact.factId);
      this.registerReaders(state);
      this.evidenceErrors.add(`${role}-input-capacity`);
      this.pump();
      return state;
    }
    try {
      const command = role === 'caller' && this.spec.command ? this.spec.command : { file: process.execPath, args: [this.spec.entryPath, '--role', role] };
      state.child = this.spawnRole ? this.spawnRole(role, immutable(request)) : spawn(command.file, command.args, { stdio: ['pipe', 'pipe', 'pipe', 'pipe', 'pipe'], shell: false, windowsHide: true });
      const child = state.child;
      child.on('spawn', () => {
        this.guard();
        state.spawned = true;
        this.record('spawn', state, { pid: child.pid ?? null }, true);
        this.pump();
      });
      child.on('error', (error) => this.childError(state, error));
      child.on('exit', (code, signal) => this.childExit(state, code, signal));
      child.on('close', (code, signal) => {
        this.guard();
        state.close = true;
        this.record('process-close', state, { code, signal }, true);
        this.pump();
      });
      const streams = { stdout: child.stdout ?? child.stdio?.[1], stderr: child.stderr ?? child.stdio?.[2], fd3: child.stdio?.[3] };
      for (const [channel, stream] of Object.entries(streams)) {
        if (!stream?.on) throw new TypeError(`Transport is missing ${channel}`);
        state.streams[channel].registered = true;
        state.streams[channel].stream = stream;
        stream.on('data', (bytes) => this.ingress(state, channel, 'data', bytes));
        stream.on('end', () => this.ingress(state, channel, 'end'));
        stream.on('close', () => this.ingress(state, channel, 'close'));
        stream.on('error', (error) => this.ingress(state, channel, 'error', error));
      }
      const ack = child.stdio?.[4];
      if (ack?.on) ack.on('error', (error) => {
        this.guard();
        this.record('ack-error', state, { error: normalizeError(error) }, true);
        this.pump();
      });
      if (child.stdin?.on) child.stdin.on('error', (error) => {
        this.guard();
        const normalized = normalizeError(error);
        const fact = this.record('request-error', state, { error: normalized }, true);
        state.errorBudget.append({ ...normalized, factId: fact.factId }, fact.factId, Boolean(normalized.truncatedFields?.length));
        if (!state.spawnFailed) this.evidenceErrors.add(`${role}-request-error`);
        this.pump();
      });
      this.registerReaders(state);
      child.stdin?.end(encoded);
      if (role === 'caller' && this.spec.scenario === 'D3v3-05') ack?.end();
    } catch (error) {
      this.registerReaders(state);
      this.childError(state, error, Boolean(state.child));
    }
    return state;
  }

  registerReaders(state) {
    if (state.readersRegistered) return;
    state.readersRegistered = true;
    this.record('readers-registered', state, { channels: CHANNELS.filter((channel) => state.streams[channel].registered) }, true);
  }

  childError(state, error, setupError = false) {
    this.guard();
    const failed = !setupError && !state.spawned && !state.exit;
    if (failed) state.spawnFailed = true;
    const normalized = normalizeError(error);
    const fact = this.record(failed ? 'spawn-error' : 'process-error', state, normalized, true);
    state.errorBudget.append({ ...normalized, factId: fact.factId }, fact.factId, Boolean(normalized.truncatedFields?.length));
    if (state.role === 'caller' && failed) this.first('processSettlement', 'spawn-failed', 'direct-spawn-error', this.t0 + 6000n * NS_PER_MS, [fact], { code: null, signal: null, error: normalized, controlAttempts: state.controlAttempts });
    else this.evidenceErrors.add(`${state.role}-${failed ? 'spawn-failed' : 'process-error'}`);
    this.pump();
  }

  childExit(state, code, signal) {
    this.guard();
    const fact = this.record('exit', state, { code, signal }, true);
    if (state.exit) { this.evidenceErrors.add(`${state.role}-duplicate-exit`); return; }
    state.exit = { code, signal, receiptNs: fact.receiptNs, factId: fact.factId, eventOrdinal: fact.eventOrdinal };
    if (state.role === 'caller') {
      if (this.reports.processSettlement) this.appendLate(fact, [this.reports.processSettlement.reportId]);
      else this.first('processSettlement', 'exit-observed', 'direct-child-exit', this.t0 + 6000n * NS_PER_MS, [fact], { code, signal, controlAttempts: state.controlAttempts });
    }
    state.child?.stdio?.[4]?.end?.();
    this.pump();
  }

  ingress(state, channel, type, data) {
    this.guard();
    const ingressNs = this.clock.nowNs().toString();
    if (state.role === 'caller' && this.spec.gates?.capture && !this.releasedGates.has('capture')) {
      if (type === 'end') {
        if (channel === 'stdout' && state.gateBuffer.length) {
          this.deliver(state, channel, 'data', state.gateBuffer, ingressNs);
          state.gateBuffer = Buffer.alloc(0);
        }
        this.holdCapture({ state, channel, type, data, ingressNs });
        return;
      }
      if (type === 'data' && channel === 'stdout') {
        const bytes = Buffer.from(data);
        let offset = 0;
        while (offset < bytes.length) {
          const newline = bytes.indexOf(10, offset);
          const end = newline < 0 ? bytes.length : newline + 1;
          const fragment = bytes.subarray(offset, end);
          if (state.gateBuffer.length + fragment.length > LIMITS.frame) {
            this.deliver(state, channel, 'data', Buffer.concat([state.gateBuffer, fragment]), ingressNs);
            state.gateBuffer = Buffer.alloc(0);
          } else {
            state.gateBuffer = Buffer.concat([state.gateBuffer, fragment]);
            if (newline >= 0) {
              const line = state.gateBuffer;
              state.gateBuffer = Buffer.alloc(0);
              let terminal = false;
              try { terminal = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(line)).type === 'caller-finished'; } catch {}
              if (terminal) this.holdCapture({ state, channel, type, data: line, ingressNs });
              else this.deliver(state, channel, type, line, ingressNs);
            }
          }
          offset = end;
        }
        return;
      }
    }
    this.deliver(state, channel, type, data, ingressNs);
  }

  holdCapture(event) {
    const bytes = event.type === 'data' ? event.data.length : 0;
    if (this.captureHeld.length >= LIMITS.lateEvents || this.captureHeldBytes + bytes > LIMITS.lateBytes) {
      this.evidenceIncomplete.add('capture-gate-capacity');
      this.cancelStreams(event.state, 'capture-gate-capacity');
      return;
    }
    this.captureHeldBytes += bytes;
    this.captureHeld.push(event);
    const fact = this.record('gate-held', event.state, { name: 'capture', channel: event.channel, type: event.type, ingressNs: event.ingressNs, bytesBase64: event.type === 'data' ? event.data.toString('base64') : null }, true);
    this.establishGate('capture', fact);
  }

  deliver(state, channel, type, data, ingressNs) {
    this.guard();
    const stream = state.streams[channel];
    if (type === 'data') {
      if (stream.cancelled) return;
      const bytes = Buffer.from(data);
      const remaining = channel === 'stderr' && state.role !== 'caller' ? Math.max(0, LIMITS.helperStderr - stream.receivedBytes) : bytes.length;
      const retained = bytes.subarray(0, remaining);
      stream.receivedBytes += bytes.length;
      const fact = this.record('stream-data', state, { channel, bytesBase64: retained.toString('base64'), ingressNs, deliveryNs: this.clock.nowNs().toString(), receivedBytes: bytes.length, retainedBytes: retained.length }, state.role !== 'caller' || channel === 'fd3');
      if (this.trace.at(-1)?.factId === fact.factId) stream.retainedBytes += retained.length;
      if (channel === 'stderr') {
        if (state.role !== 'caller' && stream.receivedBytes > LIMITS.helperStderr) {
          this.evidenceIncomplete.add(`${state.role}-stderr-capacity`);
          this.record('stream-truncated', state, { channel, reason: 'stderr-capacity', receivedBytes: stream.receivedBytes, retainedBytes: stream.retainedBytes }, true);
          this.cancelStream(state, channel, 'stderr-capacity');
        }
      } else this.parse(state, channel, bytes, fact);
      if (this.traceOverflow && state.role === 'caller') this.cancelStream(state, channel, 'trace-capacity');
    } else if (type === 'end') {
      stream.end = true;
      const fact = this.record('stream-end', state, { channel, ingressNs, deliveryNs: this.clock.nowNs().toString() }, true);
      if (channel !== 'stderr' && state.parser[channel].length) this.protocolError(state, channel, 'eof-fragment', fact);
      if (state.role === 'caller' && channel === 'fd3' && !this.reports.observation) this.first('observation', 'not-observed', 'target-channel-ended', this.t0 + 2000n * NS_PER_MS, [fact]);
    } else if (type === 'close') {
      stream.close = true;
      this.record('stream-close', state, { channel, ended: stream.end, ingressNs, deliveryNs: this.clock.nowNs().toString() }, true);
    } else {
      const error = normalizeError(data);
      const fact = this.record('stream-error', state, { channel, error, ingressNs, deliveryNs: this.clock.nowNs().toString() }, true);
      stream.errorBudget.append(error, fact.factId, Boolean(error.truncatedFields?.length));
      this.evidenceErrors.add(`${state.role}-${channel}-error`);
    }
    this.pump();
  }

  parse(state, channel, bytes, rawFact) {
    let start = 0;
    for (let index = 0; index < bytes.length; index++) {
      if (bytes[index] !== 10) continue;
      const fragment = bytes.subarray(start, index + 1);
      if (state.parser[channel].length + fragment.length > LIMITS.frame) {
        this.protocolError(state, channel, 'frame-capacity', rawFact);
        state.parser[channel] = Buffer.alloc(0);
      } else {
        const line = Buffer.concat([state.parser[channel], fragment]);
        state.parser[channel] = Buffer.alloc(0);
        this.frame(state, channel, line, rawFact);
      }
      if (state.streams[channel].cancelled) return;
      start = index + 1;
    }
    const remaining = bytes.subarray(start);
    if (state.parser[channel].length + remaining.length >= LIMITS.frame) {
      this.protocolError(state, channel, 'frame-capacity', rawFact);
      state.parser[channel] = Buffer.alloc(0);
      this.cancelStream(state, channel, 'frame-capacity');
    } else if (remaining.length) state.parser[channel] = Buffer.concat([state.parser[channel], remaining]);
  }

  protocolError(state, channel, reason, fact) {
    if (state.protocolErrors.length < LIMITS.helperFrames) state.protocolErrors.push({ channel, reason, factId: fact?.factId ?? null });
    const error = `${state.role}-protocol:${reason}`;
    this.evidenceErrors.add(error);
    const errorFact = this.record('protocol-error', state, { channel, reason, sourceFactId: fact?.factId ?? null }, true);
    if (state.role === 'caller' && !this.reports.observation) this.first('observation', 'protocol-failed', reason, this.t0 + 2000n * NS_PER_MS, [errorFact]);
    if (state.protocolErrors.length >= LIMITS.helperFrames) this.cancelStream(state, channel, 'protocol-error-capacity');
  }

  frame(state, channel, line, rawFact) {
    state.frameCount++;
    if (state.role !== 'caller' && state.frameCount > LIMITS.helperFrames) {
      this.protocolError(state, channel, 'helper-frame-capacity', rawFact);
      this.cancelStream(state, channel, 'helper-frame-capacity');
      return;
    }
    let frame;
    try { frame = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(line.subarray(0, -1))); }
    catch { this.protocolError(state, channel, 'invalid-json-or-utf8', rawFact); return; }
    if (!exactKeys(frame, FRAME_KEYS) || frame.schema !== FRAME_SCHEMA || frame.role !== state.role || ['runId', 'caseId', 'generation', 'nonce'].some((key) => frame[key] !== this.id[key]) || frame.attemptId !== state.attemptId || frame.requestId !== state.requestId || !integer(frame.sourceSequence) || frame.sourceSequence === 0 || !decimalNs(frame.sentNs) || !validatePayload(state.role, frame.type, frame.payload, this.spec.scenario)) {
      this.protocolError(state, channel, 'invalid-envelope-or-payload', rawFact); return;
    }
    if ((frame.type === 'caller-after-await' ? channel !== 'fd3' : channel !== 'stdout') || state.sequences.has(frame.sourceSequence) || (state.channelSequences[channel] ?? 0) >= frame.sourceSequence) {
      this.protocolError(state, channel, 'channel-or-source-sequence', rawFact); return;
    }
    state.sequences.add(frame.sourceSequence);
    state.channelSequences[channel] = frame.sourceSequence;
    if (state.role !== 'caller' && state.frames.length >= LIMITS.helperFrames) {
      this.protocolError(state, channel, 'helper-frame-capacity', rawFact); return;
    }
    if (state.role === 'caller' && frame.type === 'bulk' && this.traceOverflow) {
      state.omittedBulk++;
      return;
    }
    if (state.frames.length >= LIMITS.events) {
      this.evidenceIncomplete.add('caller-frame-capacity');
      this.cancelStream(state, channel, 'caller-frame-capacity');
      return;
    }
    const fact = this.record('protocol-frame', state, { channel, frame, sourceFactId: rawFact.factId }, frame.type !== 'bulk');
    state.frames.push({ frame, factId: fact.factId, receiptNs: fact.receiptNs, eventOrdinal: fact.eventOrdinal, channel });
    if (state.role === 'caller') {
      if (frame.type !== 'bulk' && state.frames.slice(0, -1).some((value) => value.frame.type === frame.type)) {
        this.protocolError(state, channel, 'duplicate-caller-frame', rawFact);
        return;
      }
      if (state.terminal && state.terminal.frame.sourceSequence < frame.sourceSequence) {
        this.protocolError(state, channel, 'caller-frame-after-terminal', rawFact);
        return;
      }
      if (frame.type === 'caller-after-await') {
        if (frame.sourceSequence !== (this.spec.scenario === 'D3v3-09' ? 5 : 4)) {
          this.protocolError(state, channel, 'caller-target-source-position', rawFact);
          return;
        }
        if (!this.reports.observation) this.first('observation', 'observed-within-budget', 'caller-after-await-received', this.t0 + 2000n * NS_PER_MS, [rawFact, fact], { operationKind: frame.payload.kind });
        else this.appendLate(fact, [this.reports.observation.reportId]);
        this.ackOrGate(state, frame.type, 'caller');
      } else if (frame.type === 'after-await-ready') {
        const target = this.t0 + 2200n * NS_PER_MS;
        if (this.clock.nowNs() >= target) this.sendAck(state, frame.type);
        else {
          let timer;
          timer = this.clock.setTimeout(() => { this.timers.delete(timer); this.guard(); this.sendAck(state, frame.type); this.pump(); }, Number((target - this.clock.nowNs() + NS_PER_MS - 1n) / NS_PER_MS));
          this.timers.add(timer);
        }
      }
      if (frame.type === 'caller-finished') state.terminal = { frame, factId: fact.factId };
      return;
    }
    const entered = { writer: 'write-entered', verifier: 'verify-entered', publisher: 'publish-entered' }[state.role];
    const terminal = { writer: 'seal-claim', verifier: 'verified', publisher: 'publish-claim' }[state.role];
    const legal = state.stage === 0 ? frame.type === 'start' : state.stage === 1 ? [entered, 'failed'].includes(frame.type) : state.stage === 2 ? [terminal, 'failed'].includes(frame.type) : false;
    if (!legal || frame.sourceSequence !== state.frames.length) { this.protocolError(state, channel, 'helper-grammar', rawFact); return; }
    if (BigInt(frame.sentNs) < state.lastHelperSentNs) { this.protocolError(state, channel, 'source-time-reversed', rawFact); return; }
    state.lastHelperSentNs = BigInt(frame.sentNs);
    if (frame.type === 'start') state.stage = 1;
    else if (frame.type === entered) {
      state.stage = 2;
      this.ackOrGate(state, frame.type, state.role);
    } else {
      state.stage = 3;
      state.terminal = { frame, factId: fact.factId };
      if (frame.type === 'failed') this.evidenceErrors.add(`${state.role}-reported-failure:${frame.payload.code}`);
    }
  }

  ackOrGate(state, type, gate) {
    if (this.spec.gates?.[gate] && !this.releasedGates.has(gate)) {
      this.heldAcks.set(gate, { state, type });
      const fact = this.record('gate-held', state, { name: gate, forType: type }, true);
      this.establishGate(gate, fact);
    } else this.sendAck(state, type);
  }

  sendAck(state, forType) {
    this.guard();
    if (state.exit || state.spawnFailed) return;
    const ack = { schema: ACK_SCHEMA, role: state.role, runId: this.id.runId, caseId: this.id.caseId, generation: this.id.generation, nonce: this.id.nonce, attemptId: state.attemptId, requestId: state.requestId, type: 'ack', payload: { forType } };
    try {
      const stream = state.child?.stdio?.[4];
      if (!stream?.write) throw new Error('Missing ACK stream');
      const returned = stream.write(`${JSON.stringify(ack)}\n`);
      this.record('ack-sent', state, { forType, ack, returned }, true);
      if (forType.endsWith('-entered')) state.enteredAcknowledged = true;
      // A pending fs.read in the child cannot finish until this writer sends EOF.
      if (forType === 'caller-after-await' || forType.endsWith('-entered')) stream.end();
    } catch (error) {
      this.record('ack-error', state, { forType, error: normalizeError(error) }, true);
      this.evidenceErrors.add(`${state.role}-ack-error`);
    }
  }

  control(state, signal) {
    if (!state?.child || state.exit || state.spawnFailed || state.controlAttempts.some((attempt) => attempt.signal === signal)) return;
    let returned = false;
    let error = null;
    try { returned = state.child.kill(signal); } catch (caught) { error = normalizeError(caught); }
    const fact = this.record('control-attempt', state, { signal, returned, error }, true);
    state.controlAttempts.push({ signal, returned, error, receiptNs: fact.receiptNs, factId: fact.factId });
  }

  cancelStream(state, channel, reason) {
    if (!state || !state.streams[channel].registered || state.streams[channel].end || state.streams[channel].cancelled) return;
    state.streams[channel].cancelled = true;
    this.record('stream-cancel', state, { channel, reason }, true);
    try { state.streams[channel].stream?.destroy(); } catch (error) {
      const normalized = normalizeError(error);
      const fact = this.record('stream-destroy-error', state, { channel, error: normalized }, true);
      state.streams[channel].errorBudget.append(normalized, fact.factId, Boolean(normalized.truncatedFields?.length));
    }
  }

  cancelStreams(state, reason) {
    for (const channel of CHANNELS) this.cancelStream(state, channel, reason);
  }

  processKnown(state) { return Boolean(state?.exit || state?.spawnFailed); }
  readersEnded(state) { return Boolean(state) && CHANNELS.every((channel) => !state.streams[channel].registered || state.streams[channel].end); }
  readersSettled(state) { return Boolean(state) && CHANNELS.every((channel) => !state.streams[channel].registered || state.streams[channel].end || state.streams[channel].close); }
  streamsSnapshot(state) {
    return state ? Object.fromEntries(CHANNELS.map((channel) => {
      const { stream, errorBudget, ...facts } = state.streams[channel];
      return [channel, { ...facts, errorCapacity: errorBudget.snapshot(), pendingBytes: state.parser[channel].length }];
    })) : {};
  }

  checkCompletedProtocol(state) {
    if (!state || state.protocolChecked || !this.processKnown(state) || !this.readersEnded(state)) return;
    state.protocolChecked = true;
    if (state.spawnFailed) return;
    if (state.role === 'caller') {
      const sequences = [...state.sequences].sort((a, b) => a - b);
      if (sequences.some((value, index) => value !== index + 1)) this.protocolError(state, 'stdout', 'source-sequence-gap');
      const sorted = [...state.frames].sort((a, b) => a.frame.sourceSequence - b.frame.sourceSequence);
      if (!sorted.length || sorted[0].frame.type !== 'caller-start') this.protocolError(state, 'stdout', 'caller-start-missing');
      if (state.terminal && sorted.some((value) => value.frame.sourceSequence > state.terminal.frame.sourceSequence)) this.protocolError(state, 'stdout', 'caller-frame-after-terminal');
      let previousSentNs = -1n;
      let stage = 0;
      let kind = null;
      let bulkIndex = 0;
      for (const { frame } of sorted) {
        const sentNs = BigInt(frame.sentNs);
        if (sentNs < previousSentNs) this.protocolError(state, 'stdout', 'source-time-reversed');
        previousSentNs = sentNs;
        if (frame.type === 'caller-start' && stage === 0) stage = 1;
        else if (['result-ready', 'operation-pending'].includes(frame.type) && stage === 1) stage = 2;
        else if (frame.type === 'operation-returned' && stage === 2) { stage = 3; kind = frame.payload.kind; }
        else if (frame.type === 'after-await-ready' && stage === 3) stage = 4;
        else if (frame.type === 'caller-after-await' && [3, 4].includes(stage) && frame.payload.kind === kind) stage = 5;
        else if (frame.type === 'bulk' && stage === 5 && frame.payload.index === bulkIndex + 1) bulkIndex++;
        else if (frame.type === 'caller-finished' && [3, 5].includes(stage)) stage = 6;
        else this.protocolError(state, 'stdout', 'caller-grammar');
      }
    }
    if (!state.terminal) {
      if (state.controlAttempts.length || state.exit?.signal || CHANNELS.some((channel) => state.streams[channel].cancelled)) this.evidenceIncomplete.add(`${state.role}-protocol-incomplete`);
      else this.protocolError(state, 'stdout', 'natural-exit-before-terminal');
    }
  }

  settleCapture(caller, forced = false) {
    if (this.capture) return;
    this.expireGate('caller', 'capture-settled-without-gate');
    this.expireGate('capture', 'capture-settled-without-gate');
    this.checkCompletedProtocol(caller);
    const reasons = [];
    if (forced) reasons.push('capture-hard-deadline');
    if (this.traceOverflow) reasons.push('trace-capacity');
    if (caller) for (const channel of CHANNELS) {
      const stream = caller.streams[channel];
      if (stream.registered && !stream.end) reasons.push(`${channel}-not-ended`);
      if (stream.cancelled) reasons.push(`${channel}-cancelled`);
      if (caller.parser[channel].length) reasons.push(`${channel}-fragment`);
    }
    const failed = Boolean(caller?.protocolErrors.length || (caller && CHANNELS.some((channel) => caller.streams[channel].errors.length)));
    const integrity = failed ? 'failed' : reasons.length ? 'incomplete' : 'complete';
    const fact = this.record('capture-settled', caller, { integrity, reasons, streams: this.streamsSnapshot(caller) }, true);
    this.capture = immutable({ integrity, reasons, factId: fact.factId, receiptNs: fact.receiptNs, streams: this.streamsSnapshot(caller) });
  }

  helperSuccessful(state, origin) {
    return state && state.exit?.code === 0 && state.exit.signal === null && BigInt(state.exit.receiptNs) < origin + 1000n * NS_PER_MS && state.controlAttempts.length === 0 && this.readersEnded(state) && state.protocolErrors.length === 0 && state.errors.length === 0 && state.stage === 3 && state.terminal?.frame.type !== 'failed' && CHANNELS.every((channel) => !state.streams[channel].cancelled && !state.streams[channel].errors.length && state.parser[channel].length === 0);
  }

  pump() {
    if (this.pumpActive || this.guardActive) return;
    this.pumpActive = true;
    try {
      this.guard();
      for (const state of this.roles) this.checkCompletedProtocol(state);
      if (!this.publicationOnly) {
        const caller = this.roles.find((state) => state.role === 'caller');
        if (!this.capture && this.readersEnded(caller) && this.processKnown(caller)) this.settleCapture(caller);
        if (this.e0 === null && this.reports.observation && this.reports.processSettlement && this.capture) {
          this.e0 = this.clock.nowNs();
          const payload = { schema: 'diagnostic-settlement-payload-v3', id: this.id, reports: this.reports, capture: this.capture, controlFacts: this.trace.filter((fact) => ['control-attempt', 'deadline', 'stream-cancel', 'spawn-error', 'process-error', 'trace-overflow'].includes(fact.event)) };
          const payloadBase64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
          this.record('evidence-start', null, { e0Ns: this.e0.toString(), deadlines: this.helperDeadlines(this.e0), payloadBase64 }, true);
          this.arm(this.e0 + 1000n * NS_PER_MS);
          this.arm(this.e0 + 1500n * NS_PER_MS);
          this.arm(this.e0 + 2000n * NS_PER_MS);
          this.launch('writer', payloadBase64);
        }
        const writer = this.roles.find((state) => state.role === 'writer');
        const verifier = this.roles.find((state) => state.role === 'verifier');
        if (writer && !verifier && this.helperSuccessful(writer, this.e0) && !this.reports.evidenceSettlement) {
          if (this.clock.nowNs() < this.e0 + 1000n * NS_PER_MS) {
            const input = { schema: 'diagnostic-settlement-verification-input-v3', expectedPayloadBase64: writer.request.payloadBase64, writerAttemptId: writer.attemptId, writerRequestId: writer.requestId };
            this.launch('verifier', Buffer.from(JSON.stringify(input), 'utf8').toString('base64'));
          }
          else this.evidenceIncomplete.add('verifier-not-started-before-work-deadline');
        }
        const currentVerifier = this.roles.find((state) => state.role === 'verifier');
        if (currentVerifier && this.processKnown(currentVerifier) && this.readersEnded(currentVerifier)) this.finishEvidence(false);
        else if (writer && this.processKnown(writer) && this.readersEnded(writer) && !currentVerifier && (!this.helperSuccessful(writer, this.e0) || this.clock.nowNs() >= this.e0 + 1000n * NS_PER_MS)) this.finishEvidence(false);
      } else {
        const publisher = this.roles.find((state) => state.role === 'publisher');
        if (publisher && this.processKnown(publisher) && this.readersEnded(publisher)) this.finishEvidence(false);
      }
      if (Object.keys(this.pending).every((name) => this.reports[name]) && this.roles.every((state) => this.processKnown(state) && this.readersSettled(state))) {
        for (const timer of this.timers) this.clock.clearTimeout(timer);
        this.timers.clear();
      }
    } finally { this.pumpActive = false; }
  }

  finishEvidence(hard) {
    const name = this.publicationOnly ? 'publication' : 'evidenceSettlement';
    if (this.reports[name]) return;
    const origin = this.publicationOnly ? this.p0 : this.e0;
    const states = this.roles.filter((state) => this.publicationOnly ? state.role === 'publisher' : ['writer', 'verifier'].includes(state.role));
    for (const state of states) {
      this.checkCompletedProtocol(state);
      if (state.spawnFailed) this.evidenceErrors.add(`${state.role}-spawn-failed`);
      if (state.exit && state.exit.code !== 0 && !state.controlAttempts.length) this.evidenceErrors.add(`${state.role}-nonzero-exit`);
    }
    const verifier = states.find((state) => state.role === 'verifier');
    const writer = states.find((state) => state.role === 'writer');
    const artifactVerified = Boolean(verifier?.terminal?.frame.type === 'verified' && verifier.protocolErrors.length === 0);
    if (artifactVerified && writer?.terminal?.frame.type === 'seal-claim') {
      const claim = writer.terminal.frame.payload;
      const actual = verifier.terminal.frame.payload;
      if (['bytes', 'sha256', 'manifestSha256'].some((key) => claim[key] !== actual[key])) this.evidenceErrors.add('writer-verifier-claim-mismatch');
    }
    if (!this.publicationOnly && this.capture?.integrity === 'failed') this.evidenceErrors.add('capture-failed');
    if (!this.publicationOnly && this.capture?.integrity !== 'complete') this.evidenceIncomplete.add('capture-incomplete');
    const allSuccessful = states.length === (this.publicationOnly ? 1 : 2) && states.every((state) => this.helperSuccessful(state, origin));
    const errors = [...this.evidenceErrors];
    const incomplete = [...this.evidenceIncomplete];
    const kind = errors.length ? 'failed' : allSuccessful && !incomplete.length && !hard ? (this.publicationOnly ? 'published' : 'sealed') : 'incomplete';
    const reason = errors[0] ?? incomplete[0] ?? (kind === 'incomplete' ? 'helper-proof-incomplete' : this.publicationOnly ? 'publisher-protocol-and-exit-complete' : 'independent-artifact-verification-complete');
    this.first(name, kind, reason, origin + 2000n * NS_PER_MS, states.flatMap((state) => [state.exit?.factId, state.terminal?.factId].filter(Boolean)), { captureIntegrity: this.capture?.integrity ?? null, artifactVerified, errors, incomplete, helpers: states.map((state) => this.roleSnapshot(state)), ...(this.publicationOnly ? { archiveAttemptId: this.spec.archiveAttemptId, snapshotOrdinal: this.spec.snapshotOrdinal, archiveIntegrity: 'not-verified-offline' } : {}) });
  }

  roleSnapshot(state) {
    return { role: state.role, attemptId: state.attemptId, requestId: state.requestId, spawned: state.spawned, spawnFailed: state.spawnFailed, launchRejected: state.launchRejected, exit: state.exit, close: state.close, streams: this.streamsSnapshot(state), errors: state.errors, errorCapacity: state.errorBudget.snapshot(), protocolErrors: state.protocolErrors, terminal: state.terminal, controlAttempts: state.controlAttempts, enteredAcknowledged: state.enteredAcknowledged, omittedBulk: state.omittedBulk, processResponsibility: this.processKnown(state) ? 'concluded' : 'unconfirmed', streamResponsibility: this.readersSettled(state) ? 'concluded' : 'unconfirmed' };
  }

  errorDiagnosticsComplete() {
    if (this.errorFieldsTruncated || this.traceOverflow || this.controlOverflow) return false;
    const budgets = [this.listenerFailureBudget, ...this.roles.flatMap(state => [state.errorBudget, ...CHANNELS.map(channel => state.streams[channel].errorBudget)])];
    return budgets.every(budget => { const summary = budget.snapshot(); return !summary.omitted && !summary.fieldsTruncated; });
  }

  getOwnerSnapshot() {
    return immutable({ id: this.id, reservedSlots: ['caller', 'evidence-helper', 'publisher'], blocked: this.blocked, blockReasons: this.blockReasons, roles: this.roles.map((state) => this.roleSnapshot(state)), traceCapacity: { events: this.trace.length, bytes: this.traceBytes, overflow: this.traceOverflow, controlOverflow: this.controlOverflow }, lateCapacity: { events: this.lateJournal.length, bytes: this.lateBytes, overflow: this.lateOverflow }, listenerFailures: this.listenerFailures, listenerFailureCapacity: this.listenerFailureBudget.snapshot(), errorPolicy: ERROR_POLICY, errorDiagnosticsComplete: this.errorDiagnosticsComplete() });
  }

  getEvidenceSnapshot() {
    return immutable({ schema: SCHEMA, id: this.id, spec: this.spec, trace: this.trace, reports: this.reports, capture: this.capture, owner: this.getOwnerSnapshot(), requests: this.requests, gates: Object.fromEntries(this.gateReports), lateJournal: this.lateJournal, lateArchiveStatus: 'external-confirmation-required' });
  }

  establishGate(name, fact) {
    if (this.gateReports.has(name)) return;
    const report = immutable({ kind: 'held', name, fact });
    this.gateReports.set(name, report);
    this.gateWaiters.get(name)?.resolve(report);
  }

  expireGate(name, reason) {
    if (!this.spec.gates?.[name] || this.gateReports.has(name)) return;
    const fact = this.record('gate-not-established', null, { name, reason }, true);
    const report = immutable({ kind: 'not-established', name, reason, fact });
    this.gateReports.set(name, report);
    this.gateWaiters.get(name)?.resolve(report);
  }

  waitForGate(name) {
    if (!this.spec.gates?.[name]) throw new TypeError('Cannot wait for an unconfigured gate');
    this.guard();
    if (this.gateReports.has(name)) return Promise.resolve(this.gateReports.get(name));
    if (!this.gateWaiters.has(name)) this.gateWaiters.set(name, deferred());
    return this.gateWaiters.get(name).promise;
  }

  releaseGate(name) {
    if (!['caller', 'writer', 'publisher', 'capture'].includes(name)) throw new TypeError('Unknown gate');
    this.guard();
    if (this.releasedGates.has(name)) return;
    this.releasedGates.add(name);
    this.record('gate-released', null, { name }, true);
    const held = this.heldAcks.get(name);
    if (held) { this.heldAcks.delete(name); this.sendAck(held.state, held.type); }
    if (name === 'capture') {
      this.captureHeldBytes = 0;
      for (const event of this.captureHeld.splice(0)) this.deliver(event.state, event.channel, event.type, event.data, event.ingressNs);
      for (const state of this.roles) if (state.gateBuffer.length) {
        const buffer = state.gateBuffer;
        state.gateBuffer = Buffer.alloc(0);
        this.deliver(state, 'stdout', 'data', buffer, this.clock.nowNs().toString());
      }
    }
    this.pump();
  }

  recordConsumerAwait(name) {
    if (!own(this.pending, name) || !this.reports[name]) throw new TypeError('Consumer can record only an already settled report');
    this.guard();
    return immutable(this.record('consumer-after-await', null, { name, reportId: this.reports[name].reportId }, true));
  }

  handle() {
    const handle = {
      id: this.id,
      getOwnerSnapshot: () => this.getOwnerSnapshot(),
      getEvidenceSnapshot: () => this.getEvidenceSnapshot(),
      waitForGate: (name) => this.waitForGate(name),
      releaseGate: (name) => this.releaseGate(name),
      recordConsumerAwait: (name) => this.recordConsumerAwait(name),
      subscribeLateFacts: (listener) => {
        if (typeof listener !== 'function') throw new TypeError('Late-fact listener must be a function');
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
      },
    };
    for (const [name, pending] of Object.entries(this.pending)) handle[name] = pending.promise;
    return Object.freeze(handle);
  }
}

export function startObservedCase(spec, testDependencies = {}) {
  validateDependencies(testDependencies);
  validateSpec(spec, false, own(testDependencies, 'pathStyle') ? testDependencies.pathStyle : undefined);
  return new SettlementOwner(spec, testDependencies, false).handle();
}

export function startPublication(spec, testDependencies = {}) {
  validateDependencies(testDependencies);
  validateSpec(spec, true, own(testDependencies, 'pathStyle') ? testDependencies.pathStyle : undefined);
  return new SettlementOwner(spec, testDependencies, true).handle();
}
