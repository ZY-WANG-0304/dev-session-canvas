const assert = require('assert');
const vscode = require('vscode');

const EXTENSION_ID = 'devsessioncanvas.dev-session-canvas';
const COMMAND_IDS = {
  openCanvasInEditor: 'devSessionCanvas.openCanvasInEditor',
  openCanvasInPanel: 'devSessionCanvas.openCanvasInPanel',
  testGetDebugState: 'devSessionCanvas.__test.getDebugState',
  testWaitForCanvasReady: 'devSessionCanvas.__test.waitForCanvasReady',
  testCreateNode: 'devSessionCanvas.__test.createNode',
  testResetState: 'devSessionCanvas.__test.resetState'
};

module.exports = {
  run
};

async function run() {
  const extension = vscode.extensions.getExtension(EXTENSION_ID);
  assert.ok(extension, `Missing extension ${EXTENSION_ID}.`);
  await extension.activate();

  const commands = await vscode.commands.getCommands(true);
  for (const command of Object.values(COMMAND_IDS)) {
    assert.ok(commands.includes(command), `Missing command ${command}.`);
  }

  await vscode.commands.executeCommand(COMMAND_IDS.testResetState);

  await vscode.commands.executeCommand(COMMAND_IDS.openCanvasInEditor);
  await vscode.commands.executeCommand(COMMAND_IDS.testWaitForCanvasReady, 'editor', 20000);

  let snapshot = await vscode.commands.executeCommand(COMMAND_IDS.testGetDebugState);
  assert.strictEqual(snapshot.activeSurface, 'editor');
  assert.strictEqual(snapshot.sidebar.canvasSurface, 'visible');
  assert.strictEqual(snapshot.surfaceReady.editor, true);
  assert.strictEqual(snapshot.state.nodes.length, 0);

  for (const kind of ['agent', 'terminal', 'task', 'note']) {
    await vscode.commands.executeCommand(COMMAND_IDS.testCreateNode, kind);
  }

  snapshot = await vscode.commands.executeCommand(COMMAND_IDS.testGetDebugState);
  assert.deepStrictEqual(
    snapshot.state.nodes.map((node) => node.kind).sort(),
    ['agent', 'note', 'task', 'terminal']
  );

  await vscode.commands.executeCommand(COMMAND_IDS.openCanvasInPanel);
  await vscode.commands.executeCommand(COMMAND_IDS.testWaitForCanvasReady, 'panel', 20000);

  snapshot = await vscode.commands.executeCommand(COMMAND_IDS.testGetDebugState);
  assert.strictEqual(snapshot.activeSurface, 'panel');
  assert.strictEqual(snapshot.sidebar.surfaceLocation, 'panel');
  assert.strictEqual(snapshot.surfaceReady.panel, true);

  await vscode.commands.executeCommand(COMMAND_IDS.testResetState);
  snapshot = await vscode.commands.executeCommand(COMMAND_IDS.testGetDebugState);
  assert.strictEqual(snapshot.state.nodes.length, 0);

  await vscode.commands.executeCommand('workbench.action.closeAllEditors');
}
