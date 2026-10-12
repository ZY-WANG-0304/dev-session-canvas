const assert = require('node:assert/strict');

// The container target is independent of the transient xterm snapshot dimensions.
function terminalMatchesContainer(node, expected) {
  return Boolean(node && node.nodeId === expected.nodeId && node.kind === expected.kind &&
    node.renderedWidth === expected.size.width && node.renderedHeight === expected.size.height &&
    node.terminalExecutionSessionId === expected.sessionId && node.terminalProjectionPending === false &&
    Number.isInteger(node.terminalFitCols) && node.terminalFitCols > 0 &&
    Number.isInteger(node.terminalFitRows) && node.terminalFitRows > 0 &&
    node.terminalCols === node.terminalFitCols && node.terminalRows === node.terminalFitRows);
}

async function waitForTerminalResize({
  expectedNodes, getSnapshot, getProbe, getSession, before, timeoutMs = 20000,
  onSample = () => {}, now = Date.now, sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
}) {
  const startedAt = now();
  const deadline = startedAt + timeoutMs;
  let lastSample;
  const timeout = () => new Error(`Timed out waiting for original terminals to match their containers. Last sample: ${JSON.stringify(lastSample)}`);
  const withinDeadline = async operation => {
    const remaining = deadline - now();
    if (remaining <= 0) throw timeout();
    let timer;
    try {
      const value = await Promise.race([
        operation(remaining),
        new Promise((_, reject) => { timer = setTimeout(() => reject(timeout()), remaining); })
      ]);
      if (now() >= deadline) throw timeout();
      return value;
    } finally { clearTimeout(timer); }
  };
  while (now() < deadline) {
    const snapshot = await withinDeadline(() => getSnapshot());
    const probe = await withinDeadline(remaining => getProbe(remaining));
    const sessions = [];
    for (const expected of expectedNodes) {
      sessions.push(await withinDeadline(remaining => getSession(expected.sessionId, remaining)));
    }
    const observations = expectedNodes.map((expected, index) => {
      const host = snapshot.state.nodes.find(node => node.id === expected.nodeId);
      const node = probe?.nodes?.find(node => node.nodeId === expected.nodeId);
      const session = sessions[index];
      const metadata = host?.metadata?.[expected.kind];
      // A replaced binding or response cannot prove that the original execution resized.
      assert.equal(host?.kind, expected.kind, `Original node missing: ${expected.nodeId}`);
      assert.equal(metadata?.runtimeSessionId, expected.sessionId, `Original binding changed: ${expected.nodeId}`);
      assert.equal(metadata?.runtimeStoragePath, expected.runtimeStoragePath, `Original Supervisor changed: ${expected.nodeId}`);
      assert.equal(session.sessionId, expected.sessionId, `Wrong Supervisor session: ${expected.nodeId}`);
      assert.equal(session.kind, expected.kind, `Wrong Supervisor kind: ${expected.nodeId}`);
      const previous = before?.probe.nodes.find(item => item.nodeId === expected.nodeId);
      const changed = !before || Boolean(previous &&
        (node?.terminalCols !== previous.terminalCols || node?.terminalRows !== previous.terminalRows));
      const matches = metadata.liveSession === true && metadata.attachmentState === 'attached-live' &&
        host.size?.width === expected.size.width && host.size?.height === expected.size.height &&
        terminalMatchesContainer(node, expected) && changed && session.live === true &&
        session.cols === node.terminalCols && session.rows === node.terminalRows &&
        expected.markers.every(marker => session.output?.includes(marker)) &&
        node.terminalVisibleLines?.join('\n').includes(expected.visibleMarker);
      return { nodeId: expected.nodeId, hostSize: host.size,
        binding: { sessionId: metadata.runtimeSessionId, runtimeStoragePath: metadata.runtimeStoragePath },
        page: node && { width: node.renderedWidth, height: node.renderedHeight,
          cols: node.terminalCols, rows: node.terminalRows, fitCols: node.terminalFitCols, fitRows: node.terminalFitRows,
          pending: node.terminalProjectionPending, sessionId: node.terminalExecutionSessionId },
        session: { sessionId: session.sessionId, kind: session.kind, live: session.live,
          cols: session.cols, rows: session.rows, markers: expected.markers.map(marker => [marker, Boolean(session.output?.includes(marker))]) },
        changed, matches: Boolean(matches) };
    });
    lastSample = { elapsedMs: now() - startedAt, observations };
    // Artifact capture is observational and must never mask the actual assertion.
    try { onSample(lastSample); } catch { /* Preserve the resize result. */ }
    if (now() >= deadline) throw timeout();
    if (observations.every(item => item.matches)) return { snapshot, probe, sessions };
    await withinDeadline(remaining => sleep(Math.min(100, remaining)));
  }
  throw timeout();
}

module.exports = { terminalMatchesContainer, waitForTerminalResize };
