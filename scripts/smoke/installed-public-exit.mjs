import assert from 'node:assert/strict';

export function installedPublicExitCommand(platform) {
  assert(['linux', 'darwin', 'win32'].includes(platform), 'Unsupported installed application platform');
  return platform === 'darwin' ? 'workbench.action.quit' : 'workbench.action.closeWindow';
}

export async function observeInstalledPublicExit({ platform, command, readChildExit, expectedHost,
  observeHost, deadline, record = () => {} }) {
  assert(expectedHost?.startTicks || expectedHost?.startTime, 'Original installed Host identity is required');
  const remaining = () => {
    const value = deadline - Date.now();
    assert(Number.isFinite(value) && value > 0, 'Original installed public exit deadline exhausted');
    return value;
  };
  remaining();
  const name = installedPublicExitCommand(platform);
  const requested = await command(name, [], deadline);
  remaining();
  assert.equal(requested.status, 'exit-requested');
  assert.equal(requested.command, name, 'Public exit request belongs to another command');
  await record({ phase: 'exit-requested', command: name, expectedHost, deadline });
  let exit;
  while (true) {
    remaining();
    exit = await readChildExit();
    remaining();
    if (exit !== undefined) break;
    await new Promise(resolve => setTimeout(resolve, Math.min(100, remaining())));
  }
  assert.equal(exit.code, 0, 'Original installed application did not exit normally');
  assert.equal(exit.signal, null, 'Original installed application was terminated by a signal');
  await record({ phase: 'application-closed', command: name, exit, deadline });
  const absence = await observeHost(expectedHost, deadline);
  remaining();
  assert.equal(absence.result, 'original-absent');
  assert.deepEqual(absence.expected, expectedHost, 'Public exit observation belongs to another Host');
  return { command: name, exit, absence, deadline, completedAt: Date.now() };
}
