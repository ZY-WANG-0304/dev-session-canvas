const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vscode = require('vscode');

module.exports.run = async function () {
  assert.equal(process.platform, 'linux');
  const extension = vscode.extensions.getExtension('devsessioncanvas.dev-session-canvas');
  assert(extension, 'The staged extension must be present.');
  assert.equal(extension.isActive, false, 'The report stub must precede product activation.');
  const selection = JSON.parse(readFileSync(path.join(extension.extensionPath, 'dist/execution-candidate-selection.json'), 'utf8'));
  assert.equal(selection.schemaVersion, 1);
  assert(['platform', 'linux-owner-v1-candidate'].includes(selection.profile), 'A stock build cannot cover native compatibility.');
  const descriptor = Object.getOwnPropertyDescriptor(process.report, 'getReport');
  const unavailable = () => undefined;
  try {
    Object.defineProperty(process.report, 'getReport', { value: unavailable, writable: true, configurable: true });
    await extension.activate();
    assert.equal(extension.isActive, true);
    assert.strictEqual(process.report.getReport, unavailable, 'The product must not repair shared global state.');
    console.log('Linux extension activation passed with the shared process report unavailable.');
  } finally {
    Object.defineProperty(process.report, 'getReport', descriptor);
  }
};
