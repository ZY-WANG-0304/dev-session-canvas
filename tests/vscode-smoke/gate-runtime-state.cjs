const assert = require('node:assert/strict');

// Observe the public shape of the test snapshot. Never interpret an unknown
// schema or an unreadable registry as an empty resource set.
function readRuntimeSessions(state) {
  assert(state && typeof state === 'object' && state.registries && typeof state.registries === 'object',
    'Runtime registry observation is unavailable');
  assert(Number.isSafeInteger(state.pendingRuntimeSupervisorOperationCount), 'Pending operation count is unavailable');
  assert(Array.isArray(state.bindings), 'Runtime bindings observation is unavailable');
  const sessions = new Map();
  for (const registry of Object.values(state.registries)) {
    assert(registry && typeof registry === 'object' && typeof registry.exists === 'boolean', 'Unknown registry schema');
    assert(!registry.error, `Runtime registry read failed: ${registry.error}`);
    const entries = registry.entries === undefined ? [registry] : registry.entries;
    assert(Array.isArray(entries), 'Unknown registry entries schema');
    for (const entry of entries) {
      assert(entry && typeof entry.exists === 'boolean' && !entry.error, 'Runtime registry entry cannot be read');
      if (!entry.exists) { assert(!entry.registry, 'Absent registry cannot contain sessions'); continue; }
      assert(entry.registry && Array.isArray(entry.registry.sessions), 'Existing registry has no observed sessions');
      for (const session of entry.registry.sessions) {
        assert(typeof session?.sessionId === 'string' && session.sessionId, 'Unknown session identity');
        sessions.set(session.sessionId, session);
      }
    }
  }
  return [...sessions.values()];
}
function runtimeIsRetired(state) {
  return readRuntimeSessions(state).length === 0 && state.bindings.length === 0
    && state.pendingRuntimeSupervisorOperationCount === 0;
}
function verifyOriginalLocalRetirement(originalLocal, state, diagnostics) {
  assert(Array.isArray(originalLocal) && Array.isArray(diagnostics));
  return originalLocal.map(original => {
    assert(!state.localExecutions.some(record => record.identity.executionId === original.identity.executionId
      && record.identity.generation === original.identity.generation), 'Original fixture is still reserved');
    const saved = original.persistence?.result ?? diagnostics.find(event => event.kind === 'execution/localFinalPersistence'
      && event.detail?.executionId === original.identity.executionId
      && event.detail.generation === original.identity.generation)?.detail.result;
    if (original.persistence) assert(['saved', 'not-required'].includes(saved?.kind), 'Original local save has no settled evidence');
    const readers = diagnostics.filter(event => event.kind === 'execution/localTerminalReaderSettled'
      && event.detail?.executionSessionId === original.identity.executionId
      && event.detail?.kind === original.kind && event.detail?.nodeId === original.nodeId);
    const originalNode = state.state.nodes.find(node => node.id === original.nodeId && node.kind === original.kind);
    const surface = state.activeSurface;
    const readerWasRequired = saved?.kind === 'saved' && Boolean(surface && state.surfaceLifecycle[surface]?.ready
      && state.surfaceLifecycle[surface]?.terminalLocalSettlementV1 && originalNode);
    assert(!readerWasRequired || readers.length > 0, 'Original visible fixture reader has no settled evidence');
    assert(readers.every(event => ['applied', 'cancelled'].includes(event.detail.outcome?.kind)),
      'Original fixture reader settlement failed');
    return { identity: original.identity, kind: original.kind, nodeId: original.nodeId,
      persistence: saved ?? null, readers, readerWasRequired, retired: true };
  });
}
module.exports = { readRuntimeSessions, runtimeIsRetired, verifyOriginalLocalRetirement };
