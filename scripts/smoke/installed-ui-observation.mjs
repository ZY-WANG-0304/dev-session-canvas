import assert from 'node:assert/strict';

const corners = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];

export async function prepareInstalledLocalizedStop({ frame, create, deadline, record = () => {} }) {
  const remaining = () => {
    const value = deadline - Date.now();
    assert(Number.isFinite(value) && value > 0, 'Original localized Terminal preparation deadline exhausted');
    return value;
  };
  const readNodeIDs = () => frame.locator('[data-node-kind="terminal"][data-node-id]').evaluateAll(nodes =>
    nodes.map(node => node.getAttribute('data-node-id')));
  const wait = async (label, read, predicate) => {
    let value;
    while (true) {
      remaining(); value = await read(); remaining();
      if (predicate(value)) return value;
      await new Promise(resolve => setTimeout(resolve, Math.min(100, remaining())));
    }
  };
  remaining();
  const existing = await readNodeIDs();
  assert.equal(new Set(existing).size, existing.length, 'Installed Terminal identities are duplicated');
  await create(deadline);
  const nodeID = await wait('Unique newly created installed Terminal', readNodeIDs, ids => {
    assert.equal(new Set(ids).size, ids.length, 'Installed Terminal identities are duplicated');
    const added = ids.filter(id => !existing.includes(id));
    assert(added.length <= 1, 'Public creation produced multiple ambiguous Terminal subjects');
    return added.length === 1;
  }).then(ids => ids.find(id => !existing.includes(id)));
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
