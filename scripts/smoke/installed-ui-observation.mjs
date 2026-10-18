import assert from 'node:assert/strict';

const corners = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];

export function findUniqueInstalledTerminalCreation(ids, originalIDs) {
  for (const identities of [ids, originalIDs]) {
    assert(Array.isArray(identities) && identities.every(id => typeof id === 'string' && id.length > 0),
      'Installed Terminal identities are invalid');
    assert.equal(new Set(identities).size, identities.length, 'Installed Terminal identities are duplicated');
  }
  assert(originalIDs.every(id => ids.includes(id)), 'Public creation lost original Terminal subjects');
  const added = ids.filter(id => !originalIDs.includes(id));
  assert(added.length <= 1, 'Public creation produced multiple ambiguous Terminal subjects');
  return added[0] ?? null;
}

export async function prepareInstalledLocalizedStop({ frame, closedTerminalIDs, create, deadline, record = () => {} }) {
  assert(Array.isArray(closedTerminalIDs) && closedTerminalIDs.length > 0,
    'Installed locale requires the Terminal identities observed before public close');
  assert(closedTerminalIDs.every(id => typeof id === 'string' && id.length > 0),
    'Original closed Terminal identities are invalid');
  assert.equal(new Set(closedTerminalIDs).size, closedTerminalIDs.length,
    'Original closed Terminal identities are duplicated');
  const originalIDs = [...closedTerminalIDs].sort();
  const remaining = () => {
    const value = deadline - Date.now();
    assert(Number.isFinite(value) && value > 0, 'Original localized Terminal preparation deadline exhausted');
    return value;
  };
  const readNodeIDs = () => frame.locator('[data-node-kind="terminal"][data-node-id]').evaluateAll(nodes =>
    nodes.map(node => node.getAttribute('data-node-id')));
  const observations = new Map();
  const observeNodeIDs = async phase => {
    remaining();
    const ids = await readNodeIDs();
    const sample = JSON.stringify(ids);
    if (observations.get(phase) !== sample) {
      observations.set(phase, sample);
      await record({ phase, ids, originalIDs, deadline, observedAt: Date.now() });
    }
    remaining();
    assert(ids.every(id => typeof id === 'string' && id.length > 0), 'Installed Terminal identities are invalid');
    assert.equal(new Set(ids).size, ids.length, 'Installed Terminal identities are duplicated');
    return ids;
  };
  const wait = async (label, read, predicate) => {
    let value;
    while (true) {
      remaining(); value = await read(); remaining();
      if (predicate(value)) return value;
      await new Promise(resolve => setTimeout(resolve, Math.min(100, remaining())));
    }
  };
  // The shell renders before bootstrap has restored its nodes. Use the exact
  // subjects observed before the original public close, not an empty first
  // sample or a time-based guess that rendering has settled.
  const existing = await wait('Original installed Terminal identities restored',
    () => observeNodeIDs('restored-baseline-observation'), ids => {
      assert(ids.every(id => originalIDs.includes(id)), 'Installed locale restored unknown Terminal subjects');
      return ids.length === originalIDs.length;
    });
  await record({ phase: 'restored-baseline-ready', ids: existing, originalIDs, deadline });
  remaining();
  await record({ phase: 'public-create-requested', originalIDs, deadline, requestedAt: Date.now() });
  remaining();
  await create(deadline);
  remaining();
  await record({ phase: 'public-create-completed', originalIDs, deadline, completedAt: Date.now() });
  remaining();
  const nodeID = await wait('Unique newly created installed Terminal',
    async () => findUniqueInstalledTerminalCreation(await observeNodeIDs('post-create-observation'), originalIDs),
    id => id !== null);
  assert(typeof nodeID === 'string' && nodeID, 'Original localized Terminal identity is missing');
  const node = frame.locator(`[data-node-kind="terminal"][data-node-id=${JSON.stringify(nodeID)}]`);
  const shell = frame.locator('.canvas-shell');
  const stop = node.getByRole('button', { name: '停止', exact: true });
  await record({ phase: 'original-node-bound', nodeID, existing,
    overview: await shell.getAttribute('data-canvas-overview-mode', { timeout: remaining() }), deadline });
  // User navigation uses the titlebar's own double-click handler. It leaves
  // the product overview configuration and action visibility unchanged.
  const chrome = node.locator('.window-chrome');
  await chrome.dblclick({ position: { x: 4, y: 4 }, timeout: remaining() });
  await wait('Original localized Terminal interactive view', async () => {
    const stopVisible = await stop.isVisible();
    return { originalCount: await node.count(),
      overview: await shell.getAttribute('data-canvas-overview-mode', { timeout: remaining() }),
      selected: await node.getAttribute('data-node-selected', { timeout: remaining() }), stopVisible,
      stopEnabled: stopVisible && await stop.isEnabled({ timeout: remaining() }) };
  }, view => view.originalCount === 1 && view.overview === 'false' && view.selected === 'true'
    && view.stopVisible && view.stopEnabled);
  remaining();
  await record({ phase: 'localized-stop-interactive', nodeID, overview: 'false', name: '停止', deadline });
  remaining();
  return { nodeID, stop, deadline };
}

export function installedGeometryMatchesResize(before, after, { nonce, requestedAt }) {
  return after?.method === 'original-stdout-fresh-tty-handle' && after.pid === before.pid && after.ppid === before.ppid
    && after.nonce === nonce && Number.isFinite(after.observedAt) && after.observedAt >= requestedAt
    && Number.isSafeInteger(after.cols) && after.cols > 0 && Number.isSafeInteger(after.rows) && after.rows > 0
    && (after.cols !== before.cols || after.rows !== before.rows);
}

export function selectInstalledResizeGesture(canvas, handles) {
  assert(canvas && ['x', 'y', 'width', 'height'].every(key => Number.isFinite(canvas[key]))
    && canvas.width > 0 && canvas.height > 0, 'Installed canvas bounds are unavailable');
  const margin = 12;
  const bounds = { left: canvas.x + margin, top: canvas.y + margin,
    right: canvas.x + canvas.width - margin, bottom: canvas.y + canvas.height - margin };
  const candidates = [];
  for (const direction of corners) {
    const box = handles[direction];
    if (!box || !['x', 'y', 'width', 'height'].every(key => Number.isFinite(box[key]))
      || box.width <= 0 || box.height <= 0) continue;
    const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    if (start.x < bounds.left || start.x > bounds.right
      || start.y < bounds.top || start.y > bounds.bottom) continue;
    const xSign = direction.endsWith('left') ? -1 : 1;
    const ySign = direction.startsWith('top') ? -1 : 1;
    const dx = Math.min(120, xSign < 0 ? start.x - bounds.left : bounds.right - start.x);
    const dy = Math.min(80, ySign < 0 ? start.y - bounds.top : bounds.bottom - start.y);
    // Both dimensions must receive a finite growth gesture. A corner outside
    // the clipped canvas or without enough room is not a valid test action.
    if (dx < 40 || dy < 30) continue;
    candidates.push({ direction, start, end: { x: start.x + xSign * dx, y: start.y + ySign * dy },
      bounds, score: dx * dy });
  }
  assert(candidates.length, 'No public resize corner has a bounded growth path inside the installed canvas');
  candidates.sort((a, b) => b.score - a.score);
  const { score, ...gesture } = candidates[0];
  return gesture;
}

export async function resizeInstalledNode(frame, node) {
  const canvas = await frame.locator('.canvas-shell').boundingBox();
  const handles = Object.fromEntries(await Promise.all(corners.map(async direction => [direction,
    await node.locator(`[data-node-resize-direction="${direction}"]`).boundingBox()])));
  const gesture = selectInstalledResizeGesture(canvas, handles);
  const mouse = frame.page().mouse;
  await mouse.move(gesture.start.x, gesture.start.y);
  await mouse.down();
  try { await mouse.move(gesture.end.x, gesture.end.y, { steps: 8 }); }
  finally { await mouse.up(); }
  return gesture;
}

export async function observeInstalledCanvas(frame, nodeID) {
  return frame.locator('.canvas-shell').evaluate((canvas, targetID) => {
    const target = [...canvas.querySelectorAll('[data-node-id][data-node-kind]')]
      .find(node => node.getAttribute('data-node-id') === targetID);
    if (!target) return null;
    const rect = element => { const box = element.getBoundingClientRect();
      return { x: box.x, y: box.y, width: box.width, height: box.height }; };
    const canvasBox = rect(canvas), nodeBox = rect(target);
    return { canvas: canvasBox, node: nodeBox,
      centerDistance: { x: nodeBox.x + nodeBox.width / 2 - (canvasBox.x + canvasBox.width / 2),
        y: nodeBox.y + nodeBox.height / 2 - (canvasBox.y + canvasBox.height / 2) },
      selected: [...canvas.querySelectorAll('[data-node-kind][data-node-selected="true"]')]
        .map(node => node.getAttribute('data-node-id')).sort(),
      attention: target.querySelector('.window-chrome')?.getAttribute('data-execution-attention-pending'),
      activeElement: { tag: document.activeElement?.tagName,
        nodeID: document.activeElement?.closest('[data-node-id]')?.getAttribute('data-node-id') ?? null } };
  }, nodeID);
}

export function installedNodeIsCentered(observation) {
  return observation !== null && Math.abs(observation.centerDistance.x) <= 4
    && Math.abs(observation.centerDistance.y) <= 4;
}
