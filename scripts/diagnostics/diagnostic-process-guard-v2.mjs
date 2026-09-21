import { spawn } from 'node:child_process';

export const PROCESS_GUARD_BUDGETS = Object.freeze({
  deadlineMs: 1000,
  cleanupMs: 1000,
  settlementReserveMs: 50,
  outerCutoffMs: 5000,
  outerObservationMs: 1000,
});

// This owns one ChildProcess and its capture streams, not a process tree.
export function guardProcess({ command, args = [], spawnOptions = {}, spawnImpl = spawn,
  record = () => {}, capture = () => {}, onSpawn = () => {}, onDeadline = () => {} }) {
  const t0 = process.hrtime.bigint();
  const elapsed = () => Number(process.hrtime.bigint() - t0) / 1e6;
  const emit = (type, fields = {}) => record({ type, atMs: elapsed(), ...fields });
  const streams = {};
  let child;
  let exit;
  let spawnError;
  let childClose = false;
  let spawned = false;
  let deadline = false;
  let returned = false;
  let deadlineTimer;
  let finalTimer;
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  emit('guard-start', { t0Ns: String(t0), budgets: PROCESS_GUARD_BUDGETS });

  function snapshot() {
    return Object.fromEntries(Object.entries(streams).map(([name, state]) => [name, {
      endObserved: state.endObserved, closeObserved: state.closeObserved,
      localDestroyed: state.localDestroyed, bytes: state.bytes, error: state.error,
    }]));
  }

  function settle(reason) {
    if (returned) return;
    returned = true;
    clearTimeout(deadlineTimer);
    clearTimeout(finalTimer);
    const result = {
      kind: deadline ? 'deadline-exceeded' : spawnError ? 'spawn-error' : 'natural-exit',
      reason, returnedAtMs: elapsed(), deadlineExceeded: deadline,
      exit: exit ?? null, spawnError: spawnError ?? null, childCloseObserved: childClose,
      streams: snapshot(),
      captureIntegrity: Object.values(streams).some((state) => state.error) ? 'error'
        : Object.values(streams).some((state) => state.localDestroyed) ? 'truncated'
          : deadline ? 'deadline-incomplete'
            : Object.keys(streams).length === 2 && Object.values(streams).every((state) => state.endObserved) ? 'complete' : 'unknown',
    };
    emit('guard-returned', { result });
    resolve(result);
  }

  function checkCompletion() {
    if (returned) return;
    if (!deadline && elapsed() >= PROCESS_GUARD_BUDGETS.deadlineMs) expire();
    if ((exit || spawnError) && Object.values(streams).every((state) => state.closeObserved)) {
      settle('observed-exit-and-capture-close');
    }
  }

  function expire() {
    if (deadline || returned) return;
    if (elapsed() < PROCESS_GUARD_BUDGETS.deadlineMs) {
      deadlineTimer = setTimeout(expire, Math.ceil(PROCESS_GUARD_BUDGETS.deadlineMs - elapsed()));
      return;
    }
    deadline = true;
    emit('guard-deadline');
    if (child && !exit && !spawnError) {
      emit('termination-request', { target: 'owned-child-handle', signal: 'SIGKILL' });
      try {
        emit('termination-returned', { value: child.kill('SIGKILL') });
      } catch (error) {
        emit('termination-threw', { error: String(error) });
      }
    } else {
      emit('termination-skipped', { reason: exit ? 'exit-already-observed' : 'no-running-child' });
    }
    try { onDeadline(child); } catch (error) { emit('deadline-hook-error', { error: String(error) }); }
  }

  function finishLocally() {
    if (returned) return;
    expire();
    for (const [name, state] of Object.entries(streams)) {
      if (!state.closeObserved) {
        state.localDestroyed = true;
        emit('capture-local-destroy', { stream: name, reason: 'absolute-return-budget', incomplete: true });
        state.stream.destroy();
        state.stream.unref?.();
      }
    }
    child?.unref?.();
    emit('owned-handles-unref');
    settle('absolute-return-budget');
  }

  emit('spawn-attempt', { command, args, synthetic: spawnImpl !== spawn });
  try {
    child = spawnImpl(command, args, { ...spawnOptions, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (error) {
    spawnError = String(error);
    emit('spawn-threw', { error: spawnError });
    if (elapsed() >= PROCESS_GUARD_BUDGETS.deadlineMs) expire();
    settle('spawn-threw');
    return promise;
  }
  emit('spawn-returned', { pid: child.pid ?? null });
  for (const name of ['stdout', 'stderr']) {
    const stream = child[name];
    if (!stream) continue;
    const state = { stream, endObserved: false, closeObserved: false, localDestroyed: false, bytes: 0, error: null };
    streams[name] = state;
    stream.on('data', (data) => {
      const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
      state.bytes += buffer.length;
      capture(name, buffer);
      emit('capture-data', { stream: name, bytes: buffer.length, afterReturn: returned });
    });
    stream.on('end', () => {
      if (!state.localDestroyed) state.endObserved = true;
      emit('capture-end', { stream: name, afterLocalDestroy: state.localDestroyed, afterReturn: returned });
    });
    stream.on('close', () => {
      state.closeObserved = true;
      emit('capture-close', { stream: name, afterLocalDestroy: state.localDestroyed, afterReturn: returned });
      checkCompletion();
    });
    stream.on('error', (error) => {
      state.error = String(error);
      emit('capture-error', { stream: name, error: state.error, afterReturn: returned });
    });
  }
  child.on('spawn', () => { spawned = true; emit('child-spawn'); });
  child.on('exit', (code, signal) => {
    exit = { code, signal };
    emit('child-exit', { code, signal, afterReturn: returned });
    checkCompletion();
  });
  child.on('error', (error) => {
    if (!spawned && !child.pid) spawnError = String(error);
    emit('child-error', { error: String(error), spawnError: Boolean(spawnError), afterReturn: returned });
    checkCompletion();
  });
  child.on('close', (code, signal) => {
    childClose = true;
    emit('child-close', { code, signal, afterReturn: returned });
    checkCompletion();
  });
  // Reserve 50 ms for synchronous recording/settlement, inside the frozen 2000 ms limit.
  deadlineTimer = setTimeout(expire, Math.max(0, PROCESS_GUARD_BUDGETS.deadlineMs - elapsed()));
  finalTimer = setTimeout(finishLocally, Math.max(0,
    PROCESS_GUARD_BUDGETS.deadlineMs + PROCESS_GUARD_BUDGETS.cleanupMs
      - PROCESS_GUARD_BUDGETS.settlementReserveMs - elapsed()));
  try { onSpawn(child); } catch (error) { emit('spawn-hook-error', { error: String(error) }); }
  checkCompletion();
  return promise;
}
