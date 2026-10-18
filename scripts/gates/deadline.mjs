import assert from 'node:assert/strict';

// A timeout is a failed operation even when abort makes it return normally.
// Wait for its settlement before callers start resource cleanup. The settlement
// allowance consumes an existing reserve; it never extends the work deadline.
export async function withinDeadline(label, deadline, operation, { settlementDeadline = deadline, signal } = {}) {
  assert(Number.isFinite(deadline) && deadline > Date.now(), `${label} original deadline exhausted`);
  assert(Number.isFinite(settlementDeadline) && settlementDeadline >= deadline);
  const controller = new AbortController();
  const cancel = () => controller.abort(signal.reason);
  signal?.addEventListener('abort', cancel, { once: true });
  if (signal?.aborted) cancel();
  let timer, settlementTimer, expiration;
  const observed = Promise.resolve().then(() => operation(controller.signal))
    .then(value => ({ value }), error => ({ error }));
  try {
    const outcome = await Promise.race([observed, new Promise(resolve => {
      timer = setTimeout(() => {
        expiration = new Error(`${label} original deadline exhausted`);
        controller.abort(expiration); resolve({ expired: true });
      }, Math.max(1, deadline - Date.now()));
    })]);
    if (outcome.expired) {
      const settled = await Promise.race([observed, new Promise(resolve => {
        settlementTimer = setTimeout(() => resolve({ unsettled: true }), Math.max(0, settlementDeadline - Date.now()));
      })]);
      expiration.unsettled = settled.unsettled === true;
      throw expiration;
    }
    if (outcome.error) throw outcome.error;
    assert(!controller.signal.aborted, `${label} was cancelled`);
    assert(Date.now() <= deadline, `${label} original deadline exhausted`);
    return outcome.value;
  } finally {
    clearTimeout(timer); clearTimeout(settlementTimer);
    signal?.removeEventListener('abort', cancel);
  }
}
