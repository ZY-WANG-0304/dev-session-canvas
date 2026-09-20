import assert from 'node:assert/strict';

// Design-stage models only. Neither class reads a PTY or proves a native EOF.
export class SourceCompletionModel {
  constructor({ onData = () => {}, onFinal = () => {}, sourceEndV1 = true } = {}) {
    this.onData = onData;
    this.onFinal = onFinal;
    this.sourceEndV1 = sourceEndV1;
    this.stopRequested = false;
    this.resourcesReleased = false;
  }

  data(chunk) {
    assert.equal(typeof chunk, 'string');
    assert.equal(this.sourceResult, undefined, 'data after source end');
    this.onData(chunk);
  }

  processExit(result) {
    assert(Number.isSafeInteger(result.exitCode), 'missing process result');
    if (this.processResult) {
      assert.deepEqual(result, this.processResult, 'conflicting process result');
      return;
    }
    this.processResult = Object.freeze({ ...result });
    this.finalize();
  }

  sourceEnd(result) {
    assert(['eof', 'interrupted', 'error', 'legacy-unknown'].includes(result.kind));
    assert(this.sourceEndV1 || result.kind !== 'eof', 'legacy provider cannot prove EOF');
    if (result.kind !== 'eof') assert.equal(typeof result.reason, 'string');
    if (this.sourceResult) {
      assert.deepEqual(result, this.sourceResult, 'conflicting source result');
      return;
    }
    this.sourceResult = Object.freeze({ ...result });
    this.finalize();
  }

  requestStop() { this.stopRequested = true; }
  releaseResources() { this.resourcesReleased = true; }

  finalize() {
    if (this.final || !this.processResult || !this.sourceResult) return;
    this.final = Object.freeze({ process: this.processResult, source: this.sourceResult });
    this.onFinal(this.final);
  }
}

export class ReadSettlementModel {
  constructor(sessionId, authorityId) {
    this.sessionId = sessionId;
    this.authorityId = authorityId;
    this.reads = new Map();
  }

  open(readId, ownerId) {
    if (this.finalRevision !== undefined) return undefined;
    assert(!this.reads.has(readId), 'read IDs are not reused');
    const identity = Object.freeze({ sessionId: this.sessionId, authorityId: this.authorityId, readId, ownerId });
    this.reads.set(readId, { identity, phase: 'opening' });
    return identity;
  }

  resolveOpen(identity, checkpointRevision) {
    const read = this.find(identity);
    if (!read || read.settlement) return false;
    assert.equal(read.phase, 'opening');
    validateRevision(checkpointRevision);
    assert(this.finalRevision === undefined || checkpointRevision <= this.finalRevision);
    read.deliveredRevision = checkpointRevision;
    read.phase = 'active';
    return true;
  }

  deliver(identity, revision) {
    const read = this.find(identity);
    assert(read && !read.settlement && read.phase === 'active', 'reader is not active');
    validateRevision(revision);
    assert(revision >= read.deliveredRevision, 'delivery cannot move backwards');
    assert(this.finalRevision === undefined || revision <= this.finalRevision, 'delivery exceeds final');
    read.deliveredRevision = revision;
  }

  complete(finalRevision) {
    validateRevision(finalRevision);
    if (this.finalRevision !== undefined) {
      assert.equal(finalRevision, this.finalRevision, 'conflicting final revision');
      return;
    }
    for (const read of this.reads.values()) {
      assert(read.deliveredRevision === undefined || read.deliveredRevision <= finalRevision);
    }
    this.finalRevision = finalRevision;
  }

  settle(identity, result) {
    if (!['applied', 'cancelled'].includes(result.kind)) return 'invalid';
    const read = this.find(identity);
    if (!read) return 'ignored';
    if (read.settlement) return same(read.settlement, result) ? 'duplicate' : 'invalid';
    if (result.kind === 'applied' && (read.phase !== 'active' || this.finalRevision === undefined ||
        result.revision !== this.finalRevision || read.deliveredRevision < result.revision)) return 'invalid';
    read.settlement = Object.freeze({ ...result });
    return 'accepted';
  }

  closeLegacy(identity) {
    const read = this.find(identity);
    if (read && !read.settlement) read.settlement = Object.freeze({ kind: 'legacy-released' });
  }

  disconnect(ownerId) {
    for (const read of this.reads.values()) {
      if (read.identity.ownerId === ownerId && !read.settlement) {
        read.settlement = Object.freeze({ kind: 'lost' });
      }
    }
  }

  find(identity) {
    const read = this.reads.get(identity.readId);
    return read && ['sessionId', 'authorityId', 'readId', 'ownerId'].every(
      key => read.identity[key] === identity[key]) ? read : undefined;
  }

  get retirable() {
    return this.finalRevision !== undefined && [...this.reads.values()].every(read => read.settlement);
  }
}

export function negotiateSettlement(host, supervisor, provider) {
  return {
    settlementV1: host?.terminalReadSettlementV1 === true && supervisor?.terminalReadSettlementV1 === true,
    sourceEndV1: provider?.sourceEndV1 === true
  };
}

function validateRevision(revision) {
  assert(Number.isSafeInteger(revision) && revision >= 0, 'invalid revision');
}

function same(left, right) {
  try { assert.deepEqual(left, right); return true; } catch { return false; }
}
