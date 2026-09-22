import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { startObservedCase, startPublication } from './diagnostic-settlement-v3.mjs';
import { verifySavedCase, verifyPublicationSnapshot } from './settlement-oracle-v3.mjs';
import { VirtualClock, fakeTransport, makeProtocolFrame } from './settlement-fixtures-v3.mjs';

const NS = 1000000n;
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const copy = value => structuredClone(value);
const channels = ['stdout', 'stderr', 'fd3'];
const helpers = { writer: ['write-entered', 'write', 'seal-claim'], verifier: ['verify-entered', 'verify', 'verified'], publisher: ['publish-entered', 'publish', 'publish-claim'] };
const identity = caseId => ({ schema: 'diagnostic-settlement-v3', runId: 'boundary-fixture-run', caseId, generation: 'g1', nonce: `boundary-${caseId}` });
const streamOf = (child, channel) => channel === 'fd3' ? child.stdio[3] : child[channel];

function framed(frame, size) {
  const encoded = Buffer.from(`${JSON.stringify(frame)}\n`);
  assert(size === undefined || size >= encoded.length, 'requested frame size cannot truncate JSON');
  return size === undefined ? encoded : Buffer.concat([Buffer.alloc(size - encoded.length, 32), encoded]);
}

function makeContext(id, options) {
  const clock = new VirtualClock();
  const transport = fakeTransport(clock, { spawnEvent: options.spawnEvent });
  const publication = options.publication === true;
  const spec = { id: identity(id), scenario: `synthetic-${id}`, entryPath: '/fixture/never-executed.mjs', artifactDirectory: options.artifactDirectory ?? '/fixture/never-created',
    ...(options.gates ? { gates: options.gates } : {}),
    ...(publication ? { archiveAttemptId: 'boundary-archive', snapshotOrdinal: 1, payloadBase64: options.payloadBase64 ?? 'e30=' } : {}) };
  const actions = [];
  const checks = [];
  const record = (action, input = {}) => actions.push({ ordinal: actions.length + 1, atNs: String(clock.time), action, input: copy(input) });
  const spawnRole = (role, request) => {
    record('transport-spawn-request', { role, request });
    if (options.spawnThrow === role) throw Object.assign(new Error('synthetic spawn failure'), { code: 'ENOENT' });
    return transport.spawnRole(role, request);
  };
  record('start', { spec });
  const handle = publication ? startPublication(spec, { clock, spawnRole }) : startObservedCase(spec, { clock, spawnRole });
  const c = {
    clock, transport, spec, handle, actions, checks, publication, record,
    check(label, actual, expected) {
      checks.push({ label, expected: copy(expected), actual: copy(actual), pass: JSON.stringify(actual) === JSON.stringify(expected) });
      assert.deepEqual(actual, expected, label);
    },
    child(role) { const child = transport.children.get(role); assert(child, `missing fake ${role}`); return child; },
    snapshot() { return handle.getEvidenceSnapshot(); },
    owner(role) { return handle.getOwnerSnapshot().roles.find(value => value.role === role); },
    async flush() { record('flush'); await clock.flush(); },
    async advance(to, timers = true) { record('advance', { toNs: String(to), timers }); await clock.advance(to, timers); },
    frame(role, type, payload, changes = {}) {
      const child = c.child(role);
      return { ...makeProtocolFrame(spec.id, role, ++child.sequence, type, payload, clock.time), attemptId: child.request.attemptId, requestId: child.request.requestId, ...changes };
    },
    raw(role, channel, bytes) { record('stream-data', { role, channel, bytesBase64: bytes.toString('base64') }); streamOf(c.child(role), channel).emit('data', bytes); },
    send(role, type, payload, channel = type === 'caller-after-await' ? 'fd3' : 'stdout', size) { const frame = c.frame(role, type, payload); c.raw(role, channel, framed(frame, size)); return frame; },
    event(role, event, input = {}) {
      record(`process-${event}`, { role, ...input });
      const child = c.child(role);
      if (event === 'exit' || event === 'close') child.emit(event, input.code ?? 0, input.signal ?? null);
      else if (event === 'error') child.emit(event, Object.assign(new Error(input.message ?? 'synthetic error'), { code: input.code ?? 'EPERM' }));
      else child.emit(event);
    },
    stream(role, channel, event, input = {}) {
      record(`stream-${event}`, { role, channel, ...input });
      streamOf(c.child(role), channel).emit(event, event === 'error' ? Object.assign(new Error(input.message ?? 'synthetic stream error'), { code: input.code ?? 'EIO' }) : undefined);
    },
    end(role) { for (const channel of channels) { c.stream(role, channel, 'end'); c.stream(role, channel, 'close'); } c.event(role, 'close'); },
    initial() { c.send('caller', 'caller-start', { scenario: spec.scenario }); c.send('caller', 'result-ready', {}); c.send('caller', 'operation-returned', { kind: 'returned' }); },
    target() { c.send('caller', 'caller-after-await', { kind: 'returned' }); },
    async caller() { c.initial(); c.target(); c.send('caller', 'caller-finished', { exitCode: 0 }); c.event('caller', 'exit'); c.end('caller'); await c.flush(); },
    claim(role) {
      if (role === 'publisher') return { files: 1, manifestSha256: '1'.repeat(64) };
      const request = c.child(role).request;
      const payload = role === 'verifier' ? JSON.parse(Buffer.from(request.payloadBase64, 'base64')).expectedPayloadBase64 : request.payloadBase64;
      const bytes = Buffer.from(payload, 'base64');
      return { bytes: bytes.length, sha256: sha(bytes), manifestSha256: '1'.repeat(64) };
    },
    beginHelper(role) { c.send(role, 'start', { scenario: spec.scenario }); c.send(role, helpers[role][0], { mode: helpers[role][1] }); },
    terminal(role) { c.send(role, helpers[role][2], c.claim(role)); },
    async helper(role) { c.beginHelper(role); c.terminal(role); c.event(role, 'exit'); c.end(role); await c.flush(); },
    e0() { return BigInt(c.snapshot().trace.find(fact => fact.event === 'evidence-start').details.e0Ns); },
    async enterRole(role) { if (role === 'caller' || role === 'publisher') return; await c.caller(); if (role === 'verifier') await c.helper('writer'); },
    async finishAfter(role, started = false) {
      if (role === 'caller') {
        if (!started) c.initial();
        c.target(); c.send('caller', 'caller-finished', { exitCode: 0 }); c.event('caller', 'exit'); c.end('caller'); await c.flush();
      } else {
        if (!started) c.beginHelper(role);
        c.terminal(role); c.event(role, 'exit'); c.end(role); await c.flush();
      }
      for (const helper of ['writer', 'verifier']) if (transport.children.has(helper) && !c.owner(helper).exit) await c.helper(helper);
    },
    async settle() {
      const names = publication ? ['publication'] : ['observation', 'processSettlement', 'evidenceSettlement'];
      if (names.some(name => !c.snapshot().reports[name])) await c.advance(clock.time > 10000n * NS ? clock.time : 10000n * NS);
      for (const name of names) c.check(`complete-first-report:${name}`, Boolean(c.snapshot().reports[name]), true);
    },
  };
  return c;
}

export async function runBoundarySelfTests() {
  const cases = [];
  async function run(id, expected, operation, options = {}) {
    let c;
    let error = null;
    let verification = null;
    let watchdog;
    try {
      c = makeContext(id, options);
      if (!options.deferLaunch) await c.flush();
      await Promise.race([operation(c), new Promise((_, reject) => { watchdog = setTimeout(() => reject(new Error('boundary-fixture-did-not-settle')), 10000); })]);
      await c.settle();
      verification = (c.publication ? verifyPublicationSnapshot : verifySavedCase)(c.snapshot());
      c.check('independent-complete-snapshot-replay', verification.pass, options.replayExpected ?? true);
      for (const reason of options.replayErrors ?? []) c.check(`independent-rejection-reason:${reason}`, verification.errors.includes(reason), true);
    } catch (caught) { error = caught.stack ?? String(caught); }
    finally { clearTimeout(watchdog); }
    const evidence = c?.snapshot() ?? null;
    cases.push({ id, synthetic: true, native: false, input: { spec: c?.spec ?? null, actions: c?.actions ?? [] },
      expected: { ...expected, independentReplay: { pass: options.replayExpected ?? true, requiredErrors: options.replayErrors ?? [] } },
      actual: { checks: c?.checks ?? [], reports: evidence?.reports ?? null, owner: evidence?.owner ?? null }, evidence, verification,
      pass: error === null, error });
  }

  for (const [name, ms] of [['term', 5000], ['kill', 5500], ['hard', 6000]]) for (const delta of [-1n, 0n, 1n]) {
    await run(`caller-${name}-${delta}`, { controlCutoffInclusive: true, hardExitStrictlyBefore: true }, async c => {
      c.initial(); c.target();
      await c.advance(BigInt(ms) * NS + delta, false);
      c.event('caller', 'exit');
      const expected = ms === 5000 ? (delta < 0n ? [] : ['SIGTERM']) : ms === 5500 ? (delta < 0n ? ['SIGTERM'] : ['SIGTERM', 'SIGKILL']) : ['SIGTERM', 'SIGKILL'];
      c.check('control-attempts', c.child('caller').killAttempts, expected);
      c.check('process-first-kind', (await c.handle.processSettlement).kind, name === 'hard' && delta >= 0n ? 'unconfirmed' : 'exit-observed');
      if (name !== 'hard' || delta < 0n) { c.send('caller', 'caller-finished', { exitCode: 0 }); c.end('caller'); await c.flush(); }
      await c.helper('writer'); await c.helper('verifier');
    });
  }
  for (const role of ['writer', 'verifier', 'publisher']) for (const delta of [-1n, 0n, 1n]) {
    await run(`${role}-kill-${delta}`, { killDeadlineInclusive: true }, async c => {
      await c.enterRole(role); c.beginHelper(role);
      const origin = role === 'publisher' ? 0n : c.e0();
      await c.advance(origin + 1500n * NS + delta, false);
      c.terminal(role);
      c.check('helper-controls', c.child(role).killAttempts, delta < 0n ? ['SIGTERM'] : ['SIGTERM', 'SIGKILL']);
      c.event(role, 'exit'); c.end(role); await c.flush();
      c.check('helper-late-exit-is-incomplete', c.snapshot().reports[role === 'publisher' ? 'publication' : 'evidenceSettlement'].kind, 'incomplete');
    }, { publication: role === 'publisher' });
  }
  for (const publication of [false, true]) await run(`launch-queue-crosses-${publication ? 'publication' : 'caller'}-hard`, { directSpawn: false, firstReport: 'unconfirmed-or-incomplete' }, async c => {
    c.record('hold-start-microtask-until-hard');
    c.clock.time = BigInt(publication ? 2000 : 6000) * NS;
    await c.flush();
    c.check('expired-role-not-created', c.transport.children.has(publication ? 'publisher' : 'caller'), false);
    if (!publication && c.transport.children.has('writer')) { await c.helper('writer'); await c.helper('verifier'); }
  }, { publication, deferLaunch: true });

  for (const role of ['caller', 'writer', 'verifier', 'publisher']) for (const mode of ['synchronous-throw', 'asynchronous-ENOENT', 'asynchronous-ENOENT-close-only']) {
    await run(`${role}-${mode}`, { failureIsNotEOF: true, registeredReadersConserved: true }, async c => {
      if (role !== 'caller' && role !== 'publisher') {
        if (mode !== 'synchronous-throw') c.event('caller', 'spawn');
        await c.caller();
        if (role === 'verifier') { if (mode !== 'synchronous-throw') c.event('writer', 'spawn'); await c.helper('writer'); }
      }
      if (mode !== 'synchronous-throw') c.event(role, 'error', { code: 'ENOENT' });
      const owner = c.owner(role);
      c.check('spawn-failed', owner.spawnFailed, true);
      c.check('registered-readers', Object.values(owner.streams).filter(stream => stream.registered).length, mode === 'synchronous-throw' ? 0 : 3);
      c.check('no-invented-EOF', Object.values(owner.streams).every(stream => !stream.end), true);
      if (mode === 'asynchronous-ENOENT') c.end(role);
      if (mode === 'asynchronous-ENOENT-close-only') {
        for (const channel of channels) c.stream(role, channel, 'close');
        c.event(role, 'close');
        c.check('close-only-still-no-EOF', Object.values(c.owner(role).streams).every(stream => !stream.end), true);
        c.check('close-only-resource-concluded', c.owner(role).streamResponsibility, 'concluded');
      }
      await c.flush();
      if (role === 'caller') {
        if (!c.snapshot().trace.some(fact => fact.event === 'evidence-start')) await c.advance(BigInt(mode === 'asynchronous-ENOENT-close-only' ? 6000 : 2000) * NS);
        if (mode !== 'synchronous-throw') c.event('writer', 'spawn');
        await c.helper('writer');
        if (mode !== 'synchronous-throw') c.event('verifier', 'spawn');
        await c.helper('verifier');
      }
    }, { publication: role === 'publisher', spawnThrow: mode === 'synchronous-throw' ? role : undefined, spawnEvent: mode === 'synchronous-throw' });
  }

  for (const order of ['bad-before-target', 'bad-after-target']) for (const sameChunk of [false, true]) {
    await run(`${order}-${sameChunk ? 'same-chunk' : 'two-chunks'}`, { observation: order === 'bad-before-target' ? 'protocol-failed' : 'observed-within-budget', evidence: 'failed' }, async c => {
      c.initial();
      const target = framed(c.frame('caller', 'caller-after-await', { kind: 'returned' }));
      const bad = Buffer.from('{invalid}\n');
      const chunks = order === 'bad-before-target' ? [bad, target] : [target, bad];
      for (const bytes of sameChunk ? [Buffer.concat(chunks)] : chunks) c.raw('caller', 'fd3', bytes);
      c.check('observation-order', (await c.handle.observation).kind, order === 'bad-before-target' ? 'protocol-failed' : 'observed-within-budget');
      c.send('caller', 'caller-finished', { exitCode: 0 }); c.event('caller', 'exit'); c.end('caller'); await c.flush();
      await c.helper('writer'); await c.helper('verifier');
      c.check('evidence-retains-protocol-error', (await c.handle.evidenceSettlement).kind, 'failed');
    });
  }
  await run('legal-cross-pipe-reverse-receipt', { sourceOrderNotReceiptOrder: true, evidence: 'sealed' }, async c => {
    const frames = [c.frame('caller', 'caller-start', { scenario: c.spec.scenario }), c.frame('caller', 'result-ready', {}),
      c.frame('caller', 'operation-returned', { kind: 'returned' }), c.frame('caller', 'caller-after-await', { kind: 'returned' })];
    c.raw('caller', 'fd3', framed(frames[3]));
    for (const frame of frames.slice(0, 3)) c.raw('caller', 'stdout', framed(frame));
    c.send('caller', 'caller-finished', { exitCode: 0 }); c.event('caller', 'exit'); c.end('caller'); await c.flush();
    await c.helper('writer'); await c.helper('verifier');
    c.check('valid-reordered-evidence', (await c.handle.evidenceSettlement).kind, 'sealed');
  });

  for (const role of ['writer', 'verifier', 'publisher']) for (const boundary of ['exit-at-work', 'terminal-at-work', 'EOF-at-work', 'terminal-at-hard', 'EOF-at-hard']) for (const delta of [-1n, 0n, 1n]) {
    await run(`${role}-${boundary}-${delta}`, { sharedOrigin: true, boundaryIsExclusive: true }, async c => {
      if (role !== 'publisher') await c.caller();
      const origin = role === 'publisher' ? 0n : c.e0();
      if (role === 'verifier') { await c.advance(origin + 250n * NS); await c.helper('writer'); }
      c.beginHelper(role);
      if (!boundary.startsWith('terminal-')) c.terminal(role);
      if (boundary !== 'exit-at-work') c.event(role, 'exit');
      await c.advance(origin + BigInt(boundary.endsWith('-work') ? 1000 : 2000) * NS + delta, false);
      if (boundary === 'exit-at-work') c.event(role, 'exit');
      if (boundary.startsWith('terminal-')) c.terminal(role);
      c.end(role); await c.flush();
      const shouldSeal = role === 'writer' ? boundary.endsWith('-work') && delta < 0n : boundary !== 'exit-at-work' && boundary.endsWith('-work') || delta < 0n;
      if (role === 'writer' && shouldSeal) await c.helper('verifier');
      if (role !== 'publisher') c.check('shared-evidence-origin', c.e0().toString(), origin.toString());
      c.check('evidence-boundary-kind', (await (role === 'publisher' ? c.handle.publication : c.handle.evidenceSettlement)).kind, shouldSeal ? (role === 'publisher' ? 'published' : 'sealed') : 'incomplete');
    }, { publication: role === 'publisher' });
  }
  for (const role of ['caller', 'writer', 'verifier', 'publisher']) for (const length of [4095, 4096]) {
    await run(`${role}-unterminated-prefix-${length}`, { newlineCountsTowardLimit: true, noUnboundedParserBuffer: true }, async c => {
      await c.enterRole(role);
      const frame = c.frame(role, role === 'caller' ? 'caller-start' : 'start', { scenario: c.spec.scenario });
      const bytes = framed(frame, length + 1);
      c.raw(role, 'stdout', bytes.subarray(0, length));
      c.check('unterminated-prefix-cancelled', c.owner(role).streams.stdout.cancelled, length === 4096);
      c.raw(role, 'stdout', bytes.subarray(length));
      if (role === 'caller') { c.send('caller', 'result-ready', {}); c.send('caller', 'operation-returned', { kind: 'returned' }); }
      else c.send(role, helpers[role][0], { mode: helpers[role][1] });
      await c.finishAfter(role, true);
      c.check('unterminated-prefix-result', c.snapshot().reports[role === 'publisher' ? 'publication' : 'evidenceSettlement'].kind,
        length === 4095 ? (role === 'publisher' ? 'published' : 'sealed') : 'failed');
    }, { publication: role === 'publisher' });
  }

  for (const role of ['caller', 'writer', 'verifier', 'publisher']) for (const size of [4095, 4096, 4097]) for (const split of [false, true]) {
    await run(`${role}-frame-${size}-${split ? 'split' : 'whole'}`, { completeFrameLimit: 4096, fragmentationDoesNotChangeLimit: true }, async c => {
      await c.enterRole(role);
      const frame = c.frame(role, role === 'caller' ? 'caller-start' : 'start', { scenario: c.spec.scenario });
      const bytes = framed(frame, size);
      for (const part of split ? [bytes.subarray(0, 2048), bytes.subarray(2048)] : [bytes]) c.raw(role, 'stdout', part);
      if (role === 'caller') { c.send('caller', 'result-ready', {}); c.send('caller', 'operation-returned', { kind: 'returned' }); }
      else c.send(role, helpers[role][0], { mode: helpers[role][1] });
      await c.finishAfter(role, true);
      c.check('frame-boundary-kind', c.snapshot().reports[role === 'publisher' ? 'publication' : 'evidenceSettlement'].kind, size <= 4096 ? (role === 'publisher' ? 'published' : 'sealed') : 'failed');
    }, { publication: role === 'publisher' });
  }
  for (const role of ['caller', 'writer', 'verifier', 'publisher']) for (const malformed of ['invalid-utf8', 'double-terminal', 'terminal-tail-fragment']) {
    await run(`${role}-${malformed}`, { evidence: 'failed', protocolFailureSticky: true }, async c => {
      await c.enterRole(role);
      if (role === 'caller') { c.initial(); c.target(); c.send('caller', 'caller-finished', { exitCode: 0 }); }
      else { c.beginHelper(role); c.terminal(role); }
      if (malformed === 'double-terminal') {
        if (role === 'caller') c.send(role, 'caller-finished', { exitCode: 0 }); else c.terminal(role);
      } else c.raw(role, 'stdout', malformed === 'invalid-utf8' ? Buffer.from([0xff, 10]) : Buffer.from('{'));
      c.event(role, 'exit'); c.end(role); await c.flush();
      if (role === 'caller') { await c.helper('writer'); await c.helper('verifier'); }
      c.check('malformed-terminal-evidence', c.snapshot().reports[role === 'publisher' ? 'publication' : 'evidenceSettlement'].kind, 'failed');
    }, { publication: role === 'publisher' });
  }
  for (const role of ['writer', 'verifier', 'publisher']) for (const size of [16383, 16384, 16385]) {
    await run(`${role}-stderr-${size}`, { retainedBytesAtMost: 16384, overflowIsTruncation: true }, async c => {
      await c.enterRole(role); c.raw(role, 'stderr', Buffer.alloc(size, 120));
      c.check('stderr-received', c.owner(role).streams.stderr.receivedBytes, size);
      c.check('stderr-retained', c.owner(role).streams.stderr.retainedBytes, Math.min(size, 16384));
      c.check('stderr-not-invented-EOF', c.owner(role).streams.stderr.end, false);
      c.check('stderr-cancellation', c.owner(role).streams.stderr.cancelled, size > 16384);
      await c.helper(role);
      if (role === 'writer' && size <= 16384) await c.helper('verifier');
      c.check('stderr-evidence-kind', c.snapshot().reports[role === 'publisher' ? 'publication' : 'evidenceSettlement'].kind,
        size <= 16384 ? (role === 'publisher' ? 'published' : 'sealed') : 'incomplete');
    }, { publication: role === 'publisher' });
  }

  for (const delta of [-1, 0, 1]) {
    const id = `publication-request-capacity-${delta}`;
    const shell = { schema: 'diagnostic-settlement-request-v3', id: identity(id), role: 'publisher', attemptId: `${id}:publisher:1`, requestId: `boundary-${id}:publisher:request:1`, scenario: `synthetic-${id}`, artifactDirectory: '/fixture/never-created', payloadBase64: '' };
    const target = 4 * 1024 * 1024 + delta;
    const padding = (target - Buffer.byteLength(JSON.stringify(shell))) % 4;
    shell.artifactDirectory += 'x'.repeat(padding);
    const overhead = Buffer.byteLength(JSON.stringify(shell));
    const payloadLength = target - overhead;
    await run(id, { requestBytesAtMost: 4194304, launchRejectedAboveLimit: true, exactRequestBytes: target }, async c => {
      const request = c.snapshot().trace.find(fact => fact.event === 'spawn-request');
      const actualBytes = Buffer.byteLength(JSON.stringify(c.snapshot().requests[0]));
      c.check('encoded-request-byte-accounting', request.details.inputBytes, actualBytes);
      c.check('exact-fixture-byte-target', actualBytes, target);
      const rejected = actualBytes > 4194304;
      c.check('launch-rejection', c.owner('publisher').launchRejected, rejected);
      if (!rejected) await c.helper('publisher');
      else {
        c.check('transport-never-created', c.transport.children.size, 0);
        c.check('unregistered-readers', Object.values(c.owner('publisher').streams).every(stream => !stream.registered && !stream.end), true);
      }
    }, { publication: true, payloadBase64: 'A'.repeat(payloadLength), artifactDirectory: shell.artifactDirectory });
  }
  await run('publication-launch-rejected', { rejectionBeforeTransport: true, noEOFInvented: true }, async c => {
    c.check('capacity-rejected', c.owner('publisher').launchRejected, true);
    c.check('no-child', c.transport.children.size, 0);
    c.check('no-readers-or-EOF', Object.values(c.owner('publisher').streams).every(stream => !stream.registered && !stream.end), true);
  }, { publication: true, payloadBase64: 'A'.repeat(4 * 1024 * 1024) });

  await run('unknown-late-proof-does-not-reopen', { firstReportImmutable: true, blockedSticky: true }, async c => {
    c.initial(); c.target(); await c.advance(6000n * NS);
    const original = copy(await c.handle.processSettlement);
    c.check('unknown-process-first', original.kind, 'unconfirmed');
    c.check('unknown-blocks', c.handle.getOwnerSnapshot().blocked, true);
    c.event('caller', 'exit'); c.end('caller'); await c.flush();
    c.check('late-process-concluded', c.owner('caller').processResponsibility, 'concluded');
    c.check('late-streams-concluded', c.owner('caller').streamResponsibility, 'concluded');
    c.check('late-proof-no-auto-admission', c.handle.getOwnerSnapshot().blocked, true);
    c.check('first-report-not-rewritten', await c.handle.processSettlement, original);
    await c.helper('writer'); await c.helper('verifier');
  });
  await run('cancel-close-does-not-invent-EOF', { capture: 'incomplete', EOF: false, streamResponsibility: 'concluded' }, async c => {
    c.initial(); c.target(); c.event('caller', 'exit'); await c.advance(6000n * NS);
    c.check('capture-is-incomplete', c.snapshot().capture.integrity, 'incomplete');
    c.check('all-streams-cancelled-and-closed', Object.values(c.owner('caller').streams).every(stream => stream.cancelled && stream.close && !stream.end), true);
    c.check('resources-closed-not-EOF', c.owner('caller').streamResponsibility, 'concluded');
    await c.helper('writer'); await c.helper('verifier');
  });
  await run('late-listener-queued-and-exception-isolated', { callbackInline: false, listenerErrorDoesNotRewriteReport: true }, async c => {
    await c.caller(); await c.helper('writer'); await c.helper('verifier');
    const report = copy(await c.handle.evidenceSettlement);
    let calls = 0;
    c.record('subscribe-late-listener', { throws: true });
    const unsubscribe = c.handle.subscribeLateFacts(() => { calls++; throw new Error('synthetic listener failure'); });
    c.event('caller', 'error');
    c.check('listener-not-inline', calls, 0);
    await c.flush();
    c.check('listener-ran-on-queued-delivery', calls > 0, true);
    c.check('listener-failure-preserved', c.handle.getOwnerSnapshot().listenerFailures.length > 0, true);
    c.check('listener-cannot-mutate-first-report', await c.handle.evidenceSettlement, report);
    unsubscribe(); const prior = calls;
    c.record('unsubscribe-late-listener'); c.event('caller', 'error'); await c.flush();
    c.check('unsubscribe-prevents-later-delivery', calls, prior);
  });
  await run('verifier-lifecycle-error-after-verified', { artifactVerified: true, evidence: 'failed', lifecycleIsNotProtocolError: true }, async c => {
    await c.caller(); await c.helper('writer'); c.beginHelper('verifier'); c.terminal('verifier');
    c.event('verifier', 'error'); c.event('verifier', 'exit'); c.end('verifier'); await c.flush();
    const report = await c.handle.evidenceSettlement;
    c.check('lifecycle-fails-evidence', report.kind, 'failed');
    c.check('lifecycle-does-not-erase-valid-verification', report.artifactVerified, true);
  });
  await run('caller-timely-EOF-late-process-exit', { capture: 'incomplete', process: 'unconfirmed', lateExitCannotBackfillCapture: true }, async c => {
    c.initial(); c.target(); c.send('caller', 'caller-finished', { exitCode: 0 }); c.end('caller');
    await c.advance(6000n * NS + 1n);
    c.event('caller', 'exit'); await c.flush();
    c.check('late-process-first', (await c.handle.processSettlement).kind, 'unconfirmed');
    c.check('hard-capture-stays-incomplete', c.snapshot().capture.integrity, 'incomplete');
    await c.helper('writer'); await c.helper('verifier');
  });
  await run('trace-prefix-capacity-with-control-proof', { evidence: 'incomplete', retainedPrefixBounded: true, replay: true }, async c => {
    c.initial(); c.target(); c.send('caller', 'caller-finished', { exitCode: 0 });
    c.raw('caller', 'stderr', Buffer.alloc(1024 * 1024, 120));
    c.check('trace-overflow-recorded', Boolean(c.handle.getOwnerSnapshot().traceCapacity.overflow), true);
    c.check('trace-overflow-does-not-invent-EOF', c.owner('caller').streams.stderr.end, false);
    c.event('caller', 'exit');
    for (const channel of channels) c.stream('caller', channel, 'end');
    await c.flush();
    for (const role of ['writer', 'verifier']) {
      c.beginHelper(role); c.terminal(role); c.event(role, 'exit');
      for (const channel of channels) c.stream(role, channel, 'end');
      await c.flush();
    }
    const capacity = c.handle.getOwnerSnapshot().traceCapacity;
    c.check('control-reserve-remains-available', capacity.controlOverflow, false);
    c.check('trace-byte-bound', capacity.bytes <= 1024 * 1024, true);
    c.check('overflow-evidence-not-sealed', (await c.handle.evidenceSettlement).kind, 'incomplete');
  });
  for (const unit of ['events', 'bytes']) await run(`control-reserve-${unit}-exhaustion`, { lostControlProofRejected: true, replay: false }, async c => {
    c.initial(); c.target(); c.send('caller', 'caller-finished', { exitCode: 0 });
    c.raw('caller', 'stderr', Buffer.alloc(1024 * 1024, 120));
    for (let index = 0; index < 80; index++) c.event('caller', 'error', { message: unit === 'bytes' ? 'x'.repeat(2048) : 'pressure' });
    c.event('caller', 'exit'); c.end('caller'); await c.flush();
    await c.helper('writer'); await c.helper('verifier');
    c.check('control-overflow-recorded', c.handle.getOwnerSnapshot().traceCapacity.controlOverflow, true);
    c.check('control-loss-cannot-look-complete', (await c.handle.evidenceSettlement).kind, 'failed');
  }, { replayExpected: false, replayErrors: ['missing-phase-start'] });
  await run('late-capacity-and-listener-queue', { lateEventsAtMost: 256, lateBytesAtMost: 65536, listenerQueueBounded: true }, async c => {
    await c.caller(); await c.helper('writer'); await c.helper('verifier');
    const first = copy(c.snapshot().reports);
    const initialLateCount = c.snapshot().lateJournal.length;
    let deliveries = 0;
    c.record('subscribe-late-listener', { throws: false });
    c.handle.subscribeLateFacts(() => { deliveries++; });
    for (let index = 0; index < 300; index++) c.event('caller', 'close');
    c.check('late-delivery-is-not-inline', deliveries, 0);
    const owner = c.handle.getOwnerSnapshot();
    c.check('late-overflow-visible', owner.lateCapacity.overflow, true);
    c.check('late-count-bound', owner.lateCapacity.events <= 256, true);
    c.check('late-byte-bound', owner.lateCapacity.bytes <= 65536, true);
    await c.flush();
    c.check('only-retained-late-facts-delivered', deliveries, c.snapshot().lateJournal.length - initialLateCount);
    c.check('late-pressure-first-reports-unchanged', c.snapshot().reports, first);
  });
  for (const name of ['caller', 'writer', 'capture', 'publisher']) await run(`gate-${name}-never-established`, { gate: 'not-established', noAdditionalBudget: true }, async c => {
    c.record('wait-for-gate', { name });
    const waiting = c.handle.waitForGate(name);
    if (name === 'writer') await c.caller();
    await c.advance(BigInt(name === 'publisher' || name === 'writer' ? 2000 : 6000) * NS);
    const gate = await waiting;
    c.check('gate-cannot-pass-without-held', gate.kind, 'not-established');
    c.check('same-gate-report', await c.handle.waitForGate(name), gate);
    if (name === 'caller' || name === 'capture') { await c.helper('writer'); await c.helper('verifier'); }
  }, { publication: name === 'publisher', gates: { [name]: true } });
  for (const name of ['caller', 'writer', 'publisher']) await run(`gate-${name}-established-before-release`, { heldThenExplicitRelease: true, gateIsNotTimerSleep: true }, async c => {
    await c.enterRole(name);
    if (name === 'caller') { c.initial(); c.target(); } else c.beginHelper(name);
    const held = await c.handle.waitForGate(name);
    c.check('gate-held-fact', held.kind, 'held');
    c.check('ACK-is-held', c.child(name).stdio[4].writes.length, 0);
    if (name === 'caller') { await c.handle.observation; c.handle.recordConsumerAwait('observation'); }
    if (name === 'writer') { await c.handle.processSettlement; c.handle.recordConsumerAwait('processSettlement'); }
    c.record('release-gate', { name }); c.handle.releaseGate(name);
    c.check('ACK-after-explicit-release', c.child(name).stdio[4].writes.length, 1);
    if (name === 'caller') { c.send('caller', 'caller-finished', { exitCode: 0 }); c.event('caller', 'exit'); c.end('caller'); await c.flush(); await c.helper('writer'); await c.helper('verifier'); }
    else { c.terminal(name); c.event(name, 'exit'); c.end(name); await c.flush(); if (name === 'writer') await c.helper('verifier'); }
  }, { publication: name === 'publisher', gates: { [name]: true } });
  await run('gate-capture-await-process-before-release', { processBeforeCapture: true, deliveryTimeNotIngressTime: true }, async c => {
    c.initial(); c.target(); c.send('caller', 'caller-finished', { exitCode: 0 }); c.event('caller', 'exit'); c.end('caller');
    const gate = await c.handle.waitForGate('capture');
    c.check('capture-gate-held', gate.kind, 'held');
    c.check('process-first-independent', (await c.handle.processSettlement).kind, 'exit-observed');
    c.check('writer-not-created-while-capture-held', c.transport.children.has('writer'), false);
    c.handle.recordConsumerAwait('processSettlement');
    await c.advance(10n * NS);
    c.record('release-gate', { name: 'capture' }); c.handle.releaseGate('capture'); await c.flush();
    const delivered = c.snapshot().trace.filter(fact => fact.role === 'caller' && fact.event === 'stream-end');
    c.check('held-end-preserves-ingress', delivered.every(fact => fact.details.ingressNs === '0' && fact.details.deliveryNs === String(10n * NS)), true);
    await c.helper('writer'); await c.helper('verifier');
  }, { gates: { capture: true } });

  return { pass: cases.every(value => value.pass), attempted: cases.length, passed: cases.filter(value => value.pass).length, cases };
}
