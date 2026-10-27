// Observe fields actually sent by the Host; an unrelated delta is not a runtime update.
function readCanvasRuntimeUpdate(message) {
  if (message?.type === 'host/stateUpdated') return message.payload?.runtime;
  if (message?.type !== 'host/stateDelta' || !message.payload?.runtime) return undefined;
  const groups = message.payload.runtime;
  return Object.assign({}, groups.terminal, groups.presentation, groups.workspace, groups.launch);
}
module.exports = { readCanvasRuntimeUpdate };
