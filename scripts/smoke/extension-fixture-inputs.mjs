import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import JSZip from 'jszip';
import { digest, writeJSON } from '../gates/receipts.mjs';
import { runProcess } from '../gates/process.mjs';

export function validateExtensionFixtureInput(input) {
  assert.match(input.id ?? '', /^[a-z0-9][a-z0-9-]*\.[a-z0-9][a-z0-9-]*$/);
  assert.match(input.version ?? '', /^\d+\.\d+\.\d+$/u, 'Extension fixture requires a fixed version');
  assert.match(input.sha256 ?? '', /^[a-f0-9]{64}$/u);
  const [publisher, name] = input.id.split('.');
  const expected = `https://${publisher}.gallery.vsassets.io/_apis/public/gallery/publisher/${publisher}/extension/${name}/${input.version}/assetbyname/Microsoft.VisualStudio.Services.VSIXPackage`;
  assert.equal(input.url, expected, 'Extension fixture must use its versioned official supplier URL');
  return input;
}

export async function verifyExtensionFixture(bytes, input) {
  validateExtensionFixtureInput(input);
  assert.equal(digest(bytes), input.sha256, `Fixed extension fixture bytes changed: ${input.id}`);
  const zip = await JSZip.loadAsync(bytes);
  const entry = zip.file('extension/package.json'); assert(entry, 'Extension fixture has no manifest');
  const manifest = JSON.parse(await entry.async('string'));
  assert.equal(`${manifest.publisher}.${manifest.name}`, input.id);
  assert.equal(manifest.version, input.version, 'Remote SSH fixture version differs from the plan');
  return manifest;
}

export async function ensureExtensionFixtureInputs(inputs, cache, deadline) {
  assert(Number.isFinite(deadline) && deadline > Date.now());
  assert(Array.isArray(inputs) && inputs.length > 0, 'Fixed extension fixture inputs cannot be empty');
  assert.equal(new Set(inputs.map(input => input.id)).size, inputs.length);
  await fs.mkdir(cache, { recursive: true });
  const files = [];
  for (const input of inputs) {
    validateExtensionFixtureInput(input);
    const file = path.join(cache, `${input.id}-${input.version}-${input.sha256.slice(0, 16)}.vsix`);
    if (!await fs.stat(file).catch(() => null)) {
      const pending = `${file}.${randomUUID()}.pending`;
      const result = await runProcess('curl', ['--fail', '--location', '--proto', '=https', '--proto-redir', '=https', '--connect-timeout', '20',
        '--max-time', String(Math.max(1, Math.ceil((deadline - Date.now()) / 1000))), '--output', pending, input.url],
      { deadline, quiet: true, logPath: `${pending}.log` });
      assert.equal(result.status, 'passed', `Fixed extension acquisition failed: ${input.id}`);
      await verifyExtensionFixture(await fs.readFile(pending), input);
      await fs.rename(pending, file);
    }
    await verifyExtensionFixture(await fs.readFile(file), input);
    assert(Date.now() <= deadline, 'Fixed extension acquisition exhausted its original deadline');
    await writeJSON(`${file}.supplier.json`, input);
    files.push(file);
  }
  return files;
}
