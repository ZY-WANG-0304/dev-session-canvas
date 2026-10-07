import assert from 'node:assert/strict';
import { StringDecoder } from 'node:string_decoder';

// Isolated candidate: read results are injected, never inferred from a PTY or a timer.
export class ExitBarrierModel {
  constructor({ consume = async () => {}, trace = [] } = {}) {
    this.consume = consume;
    this.trace = trace;
    this.decoder = new StringDecoder('utf8');
    this.readSequence = 0;
    this.operations = [];
    this.queue = Promise.resolve();
    this.resourceState = { kind: 'owned' };
  }

  record(type, detail = {}) {
    this.trace.push({ sequence: this.trace.length + 1, type, ...detail });
  }

  beginRead() {
    this.record('read-requested');
    assert(!this.sourceResult, 'source already ended');
    assert(!this.cancelRequest, 'read admission closed by cancellation request');
    assert(this.pendingRead === undefined, 'only one owned read may be in flight');
    const id = ++this.readSequence;
    this.pendingRead = id;
    this.record('read-started', { id });
    return id;
  }

  completeRead(id, result) {
    this.record('read-callback', { id, kind: result.kind,
      ...(result.bytes ? { bytesHex: result.bytes.toString('hex') } : {}),
      ...(result.error ? { error: errorMessage(result.error) } : {}) });
    assert(this.pendingRead === id && id !== undefined, 'late or foreign read callback');
    assert(['data', 'eof', 'error'].includes(result.kind), 'invalid read result');
    if (result.kind === 'data') {
      assert(Buffer.isBuffer(result.bytes) && result.bytes.length > 0, 'data needs positive bytes');
    }
    if (result.kind === 'error') assert(result.error instanceof Error, 'read error must be explicit');
    this.pendingRead = undefined;
    if (result.kind === 'data') {
      this.enqueue(this.decoder.write(result.bytes), 'read');
      if (this.cancelApplied) this.endSource({ kind: 'interrupted', reason: this.cancelApplied.reason });
      return;
    }
    if (this.cancelApplied) {
      this.endSource({ kind: 'interrupted', reason: this.cancelApplied.reason,
        observedReadEnd: result.kind,
        ...(result.kind === 'error' ? { readError: errorMessage(result.error) } : {}) });
      return;
    }
    this.endSource(result.kind === 'eof'
      ? { kind: 'eof' }
      : { kind: 'error', reason: errorMessage(result.error) });
  }

  requestCancel(reason) {
    this.record('cancel-requested', { reason });
    assert(typeof reason === 'string' && reason.length > 0, 'cancellation requires a reason');
    if (this.cancelRequest) {
      assert.equal(reason, this.cancelRequest.reason, 'conflicting cancellation reason');
      return 'duplicate';
    }
    if (this.sourceResult) return 'source-already-ended';
    this.cancelRequest = Object.freeze({ reason });
    return 'requested';
  }

  applyCancel() {
    this.record('cancel-application-requested');
    assert(this.cancelRequest, 'cannot apply an unrequested cancellation');
    if (this.cancelApplied) return 'duplicate';
    if (this.sourceResult) return 'source-already-ended';
    this.cancelApplied = this.cancelRequest;
    this.record('cancel-applied', { reason: this.cancelApplied.reason });
    if (this.pendingRead === undefined) {
      this.endSource({ kind: 'interrupted', reason: this.cancelApplied.reason });
    }
    return 'applied';
  }

  processExit(result) {
    this.record('process-result', { result });
    assert(Number.isSafeInteger(result.exitCode), 'missing process result');
    if (this.processResult) {
      assert.deepEqual(result, this.processResult, 'conflicting process result');
      return;
    }
    this.processResult = Object.freeze({ ...result });
    this.maybeFinalize();
  }

  endSource(result) {
    assert(this.pendingRead === undefined, 'owned read must settle before source end');
    assert(!this.sourceResult, 'source already ended');
    const tail = this.decoder.end();
    this.record('decoder-ended', { tail });
    this.enqueue(tail, 'decoder-tail');
    this.sourceResult = Object.freeze({ ...result });
    this.record('source-ended', { result: this.sourceResult });
    this.maybeFinalize();
  }

  enqueue(text, origin) {
    if (!text) return;
    const operation = { id: this.operations.length + 1, text, origin, status: 'queued' };
    this.operations.push(operation);
    this.record('operation-accepted', { id: operation.id, text, origin });
    this.queue = this.queue.then(async () => {
      operation.status = 'consuming';
      this.record('operation-started', { id: operation.id });
      try {
        await this.consume(text, operation.id);
        operation.status = 'applied';
        this.record('operation-applied', { id: operation.id });
      } catch (error) {
        operation.status = 'failed';
        operation.error = errorMessage(error);
        this.record('operation-failed', { id: operation.id, error: operation.error });
      }
      this.maybeFinalize();
    });
  }

  maybeFinalize() {
    if (this.final || !this.processResult || !this.sourceResult ||
        this.operations.some(operation => !['applied', 'failed'].includes(operation.status))) return;
    const failures = this.operations.filter(operation => operation.status === 'failed')
      .map(({ id, error }) => Object.freeze({ id, error }));
    const delivery = Object.freeze({ kind: failures.length ? 'failed' : 'applied',
      acceptedOperations: this.operations.length, failures: Object.freeze(failures) });
    this.final = Object.freeze({ process: this.processResult, source: this.sourceResult, delivery,
      ...(failures.length ? {} : { finalRevision: this.operations.length }) });
    this.record('final', { result: this.final });
  }

  releaseResources(release) {
    this.record('resource-release-requested');
    assert(this.sourceResult && this.pendingRead === undefined,
      'resource release would invalidate unfinished source reads');
    if (this.resourcePromise) return this.resourcePromise;
    assert.equal(typeof release, 'function', 'resource release needs a callback');
    this.resourceState = Object.freeze({ kind: 'releasing' });
    this.resourcePromise = Promise.resolve().then(release).then(() => {
      this.resourceState = Object.freeze({ kind: 'released' });
      this.record('resources-released');
      return this.resourceState;
    }, error => {
      this.resourceState = Object.freeze({ kind: 'failed', error: errorMessage(error) });
      this.record('resource-release-failed', { error: this.resourceState.error });
      return this.resourceState;
    });
    return this.resourcePromise;
  }

  canRetire(reads) {
    return Boolean(this.final && this.resourceState.kind === 'released' && (!reads || reads.retirable));
  }

  async settleQueue() { await this.queue; }
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
