import assert from 'node:assert/strict';

// vscode.open is a public request. A fresh installed profile asks the user
// before dispatching an extension URI; waiting for that request first would
// prevent the very interaction that completes it.
export async function openInstalledNotificationCallback({ page, callback, deadline, describe, open, record = () => {} }) {
  const uri = new URL(callback);
  assert.match(uri.protocol, /^vscode[^:]*:$/u, 'Notification callback must use the installed host protocol');
  assert.equal(uri.hostname, 'devsessioncanvas.dev-session-canvas-notifier');
  assert.equal(uri.pathname, '/focus');
  assert(uri.searchParams.get('token'), 'Original callback identity is missing');
  assert(Number.isFinite(deadline) && deadline > Date.now(), 'Original notification callback deadline exhausted');
  const remaining = () => {
    const value = deadline - Date.now();
    assert(value > 0, 'Original notification callback deadline exhausted');
    return value;
  };
  const description = await describe(callback, deadline);
  assert.equal(description.original, callback, 'Public URI description belongs to another callback');
  assert.equal(typeof description.serialized, 'string');
  assert(description.serialized, 'Public URI serialization is missing');
  remaining();
  // Start the command and retain its result immediately. An early command
  // failure is observed even while the external UI waits for the dialog.
  const command = Promise.resolve().then(() => open(callback, deadline));
  const result = command.then(value => ({ value }), error => ({ error }));
  const dialog = page.getByRole('dialog').filter({
    hasText: "Allow 'Dev Session Canvas Notifier' extension to open this URI?"
  });
  await Promise.race([
    dialog.waitFor({ state: 'visible', timeout: remaining() }),
    result.then(outcome => {
      if (outcome.error) throw outcome.error;
      throw new Error('Installed URI open completed without its fresh-profile confirmation');
    })
  ]);
  assert.equal(await dialog.count(), 1, 'Original URI confirmation is ambiguous');
  const shownURI = await dialog.locator('.rendered-markdown [title]').evaluateAll(elements =>
    elements.map(element => element.getAttribute('title')));
  assert.equal(shownURI.filter(value => value === description.serialized).length, 1,
    'URI confirmation does not refer to the original notification callback');
  const remember = dialog.getByRole('checkbox', { name: 'Do not ask me again for this extension', exact: true });
  assert.equal(await remember.isChecked({ timeout: remaining() }), false, 'The fresh profile must not pre-authorize extension URIs');
  await record({ phase: 'confirmation-visible', callback, serialized: description.serialized, remember: false });
  await dialog.getByRole('button', { name: 'Open', exact: true }).click({ timeout: remaining() });
  await dialog.waitFor({ state: 'hidden', timeout: remaining() });
  let timer;
  const outcome = await Promise.race([result, new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('Original notification callback deadline exhausted')), remaining());
  })]).finally(() => clearTimeout(timer));
  if (outcome.error) throw outcome.error;
  remaining();
  await record({ phase: 'confirmation-opened', callback, remember: false });
  return outcome.value;
}
