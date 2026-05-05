async function waitForVisibleExtension(vscode, extensionId, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const extension = vscode.extensions.all.find((candidate) => candidate.id === extensionId);
    if (extension) {
      return extension;
    }

    await sleep(100);
  }

  const visibleIds = vscode.extensions.all
    .map((extension) => extension.id)
    .filter((id) => id.startsWith('devsessioncanvas'))
    .sort();
  throw new Error(
    `Timed out waiting for extension ${extensionId}. Visible devsessioncanvas extensions: ${visibleIds.join(', ')}`
  );
}

async function activateVisibleExtension(vscode, extensionId, timeoutMs = 20000) {
  const extension = await waitForVisibleExtension(vscode, extensionId, timeoutMs);
  await extension.activate();
  return extension;
}

async function waitForCommand(vscode, commandId, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const commands = await vscode.commands.getCommands(true);
    if (commands.includes(commandId)) {
      return;
    }

    await sleep(100);
  }

  throw new Error(`Timed out waiting for command ${commandId}.`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = {
  activateVisibleExtension,
  waitForCommand,
  waitForVisibleExtension
};
