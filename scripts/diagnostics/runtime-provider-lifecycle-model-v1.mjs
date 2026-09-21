// Injected lifecycle model only. No native process, PTY, or production module is used.
import { isDeepStrictEqual } from 'node:util';

export const MODEL_SCHEMA = 'runtime-provider-lifecycle-model-v1';
const RESOURCE_NAMES = ['reader', 'input', 'waiter', 'native'];
const copy = value => structuredClone(value);
const knownTermination = result => result && result.kind !== 'unconfirmed';

export class ProviderLifecycleModel {
  constructor({ identity, binding, capabilities, emit }) {
    this.identity = copy(identity);
    this.binding = copy(binding);
    this.capabilities = copy(capabilities);
    this.emitSink = emit;
    this.data = [];
    this.acceptedTransfers = new Map();
    this.operations = [];
    this.process = null;
    this.source = null;
    this.seal = null;
    this.authority = null;
    this.revision = 0;
    this.throughDataSequence = 0;
    this.openAdmission = true;
    this.pendingReads = new Set();
    this.messages = new Map();
    this.decoderTail = '';
    this.cancelRequested = false;
    this.cancelEffective = false;
    this.readers = new Map();
    this.receipts = new Map();
    this.requests = new Map();
    this.release = null;
    this.resources = { kind: 'retained', reason: 'owner-created' };
    this.resourceLedger = Object.fromEntries(RESOURCE_NAMES.map(name => [name, 'retained']));
    this.metadataSaved = false;
    this.retired = false;
    this.parsing = null;
    this.emit('sink-ready', { binding: this.binding, capabilities: this.capabilities });
  }

  emit(event, detail = {}) {
    this.emitSink({ event, identity: copy(this.identity), detail: copy(detail) });
  }

  fault(code) {
    this.emit('fault', { code });
    return false;
  }

  acceptData(text, origin = 'provider') {
    if (this.source) return this.fault('data-after-source');
    if (typeof text !== 'string' || text.length === 0) return this.fault('invalid-data');
    const sequence = this.data.length + 1;
    if (!Number.isSafeInteger(sequence)) return this.fault('sequence-overflow');
    this.data.push({ sequence, text, origin });
    this.acceptTransfer(sequence, text);
    this.emit('data', { sequence, text, origin });
    return sequence;
  }

  acceptTransfer(sequence, text) {
    const previous = this.acceptedTransfers.get(sequence);
    if (previous !== undefined) {
      if (previous !== text) return this.fault('conflicting-data-sequence');
      this.emit('transfer-duplicate', { sequence });
      return;
    }
    if (!Number.isSafeInteger(sequence) || sequence !== this.acceptedTransfers.size + 1) return this.fault('non-contiguous-data-sequence');
    this.acceptedTransfers.set(sequence, text);
    this.operations.push({ type: 'data', sequence, text });
  }

  processResult(result) {
    if (!result || !['exited', 'signaled', 'terminated', 'unconfirmed'].includes(result.kind) ||
      (result.kind === 'exited' && !Number.isInteger(result.exitCode)) ||
      (result.kind === 'signaled' && typeof result.signal !== 'string') ||
      (['terminated', 'unconfirmed'].includes(result.kind) && typeof result.reason !== 'string')) {
      return this.fault('invalid-process-result');
    }
    if (isDeepStrictEqual(this.process, result)) {
      this.emit('process-duplicate', { result });
      return;
    }
    if (knownTermination(this.process)) return this.fault('conflicting-process-result');
    this.process = copy(result);
    this.emit('process', { result });
    this.maybeSeal();
  }

  sourceEnd(disposition) {
    if (this.pendingReads.size || this.messages.size || this.decoderTail) return this.fault('source-has-owned-data');
    if (!disposition || !['eof', 'interrupted', 'error', 'unknown'].includes(disposition.kind)) {
      return this.fault('invalid-source-result');
    }
    let result = { ...copy(disposition), lastDataSequence: this.data.length };
    if (!this.capabilities.source) result = { kind: 'unknown', reason: 'provider-capability-unproven', lastDataSequence: this.data.length };
    else if (this.cancelEffective && result.kind === 'eof') {
      result = { kind: 'interrupted', reason: 'cancel-effective', lastDataSequence: this.data.length };
    }
    if (this.source) {
      if (!isDeepStrictEqual(this.source, result)) return this.fault('conflicting-source-result');
      this.emit('source-duplicate', { result });
      return;
    }
    this.source = result;
    this.emit('source', { result });
    this.maybeSeal();
  }

  maybeSeal() {
    if (this.seal || !this.source || !this.process) return;
    this.seal = { ...this.identity, process: copy(this.process), source: copy(this.source), lastDataSequence: this.data.length };
    this.emit('seal', { seal: this.seal });
    this.maybeFinalizeAuthority();
  }

  maybeFinalizeAuthority() {
    if (!this.seal || this.authority || this.operations.length || this.parsing) return;
    this.openAdmission = false;
    this.authority = { kind: 'applied', finalRevision: this.revision, throughDataSequence: this.throughDataSequence };
    this.emit('authority-final', { result: this.authority });
  }

  beginApply() {
    if (this.parsing || !this.operations.length || this.authority) return this.fault('invalid-parser-start');
    const operation = this.operations[0];
    let resolve, reject;
    const parserPromise = new Promise((done, failed) => { resolve = done; reject = failed; });
    const task = parserPromise.then(
      () => {
        this.operations.shift();
        this.revision += 1;
        if (operation.type === 'data') this.throughDataSequence = operation.sequence;
        this.emit('parse-complete', { revision: this.revision, throughDataSequence: this.throughDataSequence });
      },
      error => {
        this.authority = { kind: 'failed', throughDataSequence: this.throughDataSequence, reason: error.message };
        this.emit('authority-failed', { result: this.authority });
      }
    ).then(() => {
      this.parsing = null;
      this.maybeFinalizeAuthority();
    });
    this.parsing = { operation, resolve, reject, task, parserPromise };
    this.emit('parse-start', { operation });
  }

  finishApply(error) {
    if (!this.parsing) return this.fault('parser-not-running');
    const { resolve, reject, task } = this.parsing;
    if (error) reject(new Error(error));
    else resolve();
    return task;
  }

  request(kind, requestId, params) {
    const previous = this.requests.get(requestId);
    if (previous) {
      if (previous.kind !== kind || !isDeepStrictEqual(previous.params, params)) return this.fault('conflicting-request');
      this.emit('request-reused', { kind, requestId });
      return previous;
    }
    const record = { kind, params: copy(params) };
    this.requests.set(requestId, record);
    if (kind === 'cancel') this.cancelRequested = true;
    this.emit('request', { kind, requestId, params });
    return record;
  }

  requestRelease(requestId, params) {
    if (this.release) {
      if (this.release.requestId !== requestId || !isDeepStrictEqual(this.release.params, params)) return this.fault('conflicting-release');
      this.emit('release-reused', { requestId });
      return this.release.promise;
    }
    if (!this.source || !knownTermination(this.process) || this.pendingReads.size || this.messages.size || this.decoderTail) {
      return this.fault('release-precondition');
    }
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    this.release = { requestId, params: copy(params), promise, resolve, returned: false };
    for (const name of RESOURCE_NAMES) this.resourceLedger[name] = 'in-flight';
    this.emit('release-start', { requestId, params, owners: RESOURCE_NAMES });
    return promise;
  }

  observeRelease(requestId, returned) {
    if (!this.release || this.release.requestId !== requestId || this.release.returned) return this.fault('invalid-release-observation');
    const kind = returned && this.capabilities.resources ? 'released' : 'unknown';
    const result = kind === 'released' ? { kind } : { kind, reason: returned ? 'resource-capability-unproven' : 'observation-deadline' };
    this.resources = result;
    for (const name of RESOURCE_NAMES) this.resourceLedger[name] = kind;
    if (returned) {
      this.release.returned = true;
      this.release.resolve(copy(result));
    }
    this.emit('resource', { operationId: requestId, result });
  }

  openRead({ readId, owner, authorityId, surface }) {
    if (!this.openAdmission) return this.fault('open-after-final');
    if (authorityId !== this.binding.authorityId || this.readers.has(readId) || this.receipts.has(readId)) return this.fault('invalid-reader');
    this.readers.set(readId, { readId, owner, authorityId, surface, ready: false, sentRevision: 0, appliedRevision: 0 });
    this.emit('read-begin', { readId, owner, authorityId, surface });
  }

  reader(readId, owner, authorityId) {
    const read = this.readers.get(readId);
    return read && read.owner === owner && read.authorityId === authorityId ? read : null;
  }

  settleRead(action) {
    const { readId, owner, authorityId, outcome } = action;
    const previous = this.receipts.get(readId);
    if (previous) {
      if (previous.owner !== owner || previous.authorityId !== authorityId || !isDeepStrictEqual(previous.requestedOutcome, outcome ?? null)) return this.fault('conflicting-reader-settlement');
      this.emit('reader-settlement-reused', { readId, outcome: previous.outcome });
      return;
    }
    const read = this.reader(readId, owner, authorityId);
    if (!read) return this.fault('reader-identity');
    if (outcome && !this.capabilities.settlement) return this.fault('settlement-not-negotiated');
    if (outcome && !['applied', 'cancelled'].includes(outcome.kind)) return this.fault('invalid-outcome');
    if (outcome?.kind === 'applied' && (!this.authority || this.authority.kind !== 'applied' ||
      outcome.finalRevision !== this.authority.finalRevision || !read.ready || read.sentRevision < outcome.finalRevision)) {
      return this.fault('unproven-final-application');
    }
    const result = outcome ?? { kind: 'legacy-released' };
    this.receipts.set(readId, { owner, authorityId, requestedOutcome: outcome ?? null, outcome: copy(result) });
    this.readers.delete(readId);
    this.emit('reader-settled', { readId, outcome: result });
  }

  canRetire() {
    return this.metadataSaved && this.authority?.kind === 'applied' && !this.openAdmission && this.readers.size === 0 &&
      knownTermination(this.process) && this.source?.kind === 'eof' && this.resources.kind === 'released';
  }

  inspect() {
    return copy({ identity: this.identity, binding: this.binding, capabilities: this.capabilities,
      process: this.process, source: this.source, seal: this.seal, authority: this.authority,
      data: this.data, revision: this.revision, throughDataSequence: this.throughDataSequence,
      queuedOperations: this.operations.length, parserPending: Boolean(this.parsing), openAdmission: this.openAdmission,
      pendingReads: [...this.pendingReads], pendingMessages: [...this.messages.keys()], decoderTail: this.decoderTail,
      cancelRequested: this.cancelRequested, cancelEffective: this.cancelEffective,
      readers: [...this.readers.values()], receipts: [...this.receipts].map(([readId, receipt]) => ({ readId, ...receipt })),
      resources: this.resources, resourceLedger: this.resourceLedger, releaseRequestId: this.release?.requestId ?? null,
      metadataSaved: this.metadataSaved, retireEligible: Boolean(this.canRetire()), retired: this.retired });
  }

  perform(action) {
    if (action.identity && !isDeepStrictEqual(action.identity, this.identity)) return this.fault('execution-identity');
    switch (action.type) {
      case 'data': return this.acceptData(action.text);
      case 'process': return this.processResult(action.result);
      case 'source': return this.sourceEnd(action.result);
      case 'inject-transfer': return this.acceptTransfer(action.sequence, action.text);
      case 'inject-seal':
        if (action.lastDataSequence !== this.data.length || action.sourceLastDataSequence !== this.data.length) return this.fault('seal-watermark-mismatch');
        return this.fault('unowned-seal');
      case 'resize':
        if (this.seal) return this.fault('mutation-after-seal');
        this.operations.push({ type: 'resize', cols: action.cols, rows: action.rows });
        this.emit('resize', { cols: action.cols, rows: action.rows });
        return;
      case 'parse-start': return this.beginApply();
      case 'parse-complete': return this.finishApply();
      case 'parse-fail': return this.finishApply(action.reason);
      case 'stop': return this.request('stop', action.requestId, { mode: action.mode });
      case 'cancel': return this.request('cancel', action.requestId, { reason: action.reason });
      case 'cancel-effective':
        if (!this.cancelRequested || this.source) return this.fault('invalid-cancel-effect');
        this.cancelEffective = true;
        this.emit('cancel-effective');
        return;
      case 'read-start':
        if (this.cancelRequested || this.source || this.pendingReads.has(action.id)) return this.fault('read-admission-closed');
        this.pendingReads.add(action.id);
        this.emit('read-start', { id: action.id });
        return;
      case 'read-return':
        if (!this.pendingReads.delete(action.id)) return this.fault('unknown-read');
        this.emit('read-return', { id: action.id });
        if (action.text) this.acceptData(action.text, 'read');
        return;
      case 'queue-message':
        if (this.source || this.messages.has(action.id)) return this.fault('invalid-worker-message');
        this.messages.set(action.id, action.text);
        this.emit('worker-queued', { id: action.id, text: action.text });
        return;
      case 'deliver-message': {
        if (!this.messages.has(action.id)) return this.fault('unknown-worker-message');
        const text = this.messages.get(action.id);
        this.messages.delete(action.id);
        this.emit('worker-delivered', { id: action.id });
        this.acceptData(text, 'worker');
        return;
      }
      case 'decoder-buffer':
        if (this.source || this.decoderTail) return this.fault('invalid-decoder-buffer');
        this.decoderTail = action.text;
        this.emit('decoder-buffered', { text: action.text });
        return;
      case 'decoder-flush': {
        const text = this.decoderTail;
        this.decoderTail = '';
        this.emit('decoder-flushed');
        if (text) this.acceptData(text, 'decoder');
        return;
      }
      case 'source-budget':
        this.emit('source-observation', { kind: this.source ? 'settled' : 'pending', pendingReads: [...this.pendingReads], pendingMessages: [...this.messages.keys()] });
        return;
      case 'release':
        return { promise: this.requestRelease(action.requestId, action.params) };
      case 'release-timeout': return this.observeRelease(action.requestId, false);
      case 'release-return': return this.observeRelease(action.requestId, true);
      case 'read-open': return this.openRead(action);
      case 'read-ready': {
        const read = this.reader(action.readId, action.owner, action.authorityId);
        if (!read || read.ready) return this.fault('reader-identity');
        read.ready = true;
        this.emit('read-ready', { readId: read.readId });
        return;
      }
      case 'page-send':
      case 'page-apply': {
        const read = this.reader(action.readId, action.owner, action.authorityId);
        const applying = action.type === 'page-apply';
        const limit = applying ? read?.sentRevision : this.revision;
        if (!read?.ready || !Number.isSafeInteger(action.revision) || action.revision < read.appliedRevision || action.revision > limit) return this.fault('invalid-page-revision');
        if (applying) read.appliedRevision = action.revision;
        else read.sentRevision = action.revision;
        this.emit(applying ? 'page-applied' : 'page-sent', { readId: read.readId, revision: action.revision });
        return;
      }
      case 'read-settle': return this.settleRead(action);
      case 'disconnect':
        for (const read of [...this.readers.values()]) {
          if (read.owner !== action.owner) continue;
          const outcome = { kind: 'lost', reason: 'connection-closed' };
          this.receipts.set(read.readId, { owner: read.owner, authorityId: read.authorityId, requestedOutcome: null, outcome });
          this.readers.delete(read.readId);
          this.emit('reader-settled', { readId: read.readId, outcome });
        }
        return;
      case 'metadata-save':
        this.metadataSaved = true;
        this.emit('metadata-saved');
        return;
      case 'retire':
        if (!this.canRetire()) return this.fault('retirement-precondition');
        if (this.retired) return this.fault('already-retired');
        this.retired = true;
        this.emit('retired');
        return;
      default: throw new Error(`Unknown injected action: ${action.type}`);
    }
  }
}

export function openExecution(spec, emit, start = () => {}) {
  const execution = new ProviderLifecycleModel({ ...spec, emit });
  start(execution);
  return execution;
}
