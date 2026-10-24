import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { inspectVsix, treeHashes } from '../release/build-release-candidate.mjs';
import { readJSON, verifyPackageFiles } from '../gates/receipts.mjs';
import { assertRuntimeFileList, extractVsixDist } from '../release/vsix-file-list.mjs';
import { resolveCommand, resolveVsceEntry, stageMainPackageFiles } from '../release/package-vsix.mjs';
import { stagePackageFiles as stageNotifierPackageFiles } from '../../extensions/vscode/dev-session-canvas-notifier/scripts/package-vsix.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const { values } = parseArgs({ options: { candidate: { type: 'string' } } });
const vsceEntry = resolveVsceEntry(repoRoot);
assert(vsceEntry, 'Local @vscode/vsce executable was not found. Run npm install in the repository root first.');
const command = resolveCommand(vsceEntry, ['ls']);
const privateRoot = mkdtempSync(path.join(os.tmpdir(), 'dsc-vsix-file-list-'));

try {
  let receipt, plan;
  if (values.candidate) {
    receipt = await readJSON(path.join(values.candidate, 'package-receipt.json'));
    plan = await readJSON(process.env.DEV_SESSION_CANVAS_GATE_PLAN);
    await verifyPackageFiles(receipt, plan, values.candidate);
  }
  for (const [label, name, stage] of [
    ['main', 'dev-session-canvas', stageMainPackageFiles],
    ['notifier', 'dev-session-canvas-notifier', stageNotifierPackageFiles]
  ]) {
    const extensionRoot = path.join(repoRoot, 'extensions', 'vscode', name);
    const packageJson = JSON.parse(readFileSync(path.join(extensionRoot, 'package.json'), 'utf8'));
    let dist = path.join(extensionRoot, 'dist'), inspected;
    if (receipt) {
      const pkg = receipt.packages.find(pkg => pkg.id === `devsessioncanvas.${name}`);
      const file = path.join(values.candidate, pkg.path);
      inspected = await inspectVsix(file, pkg.id, pkg.version);
      assert.equal(inspected.payloadDigest, pkg.payloadDigest, 'Production ZIP content differs from the package receipt');
      dist = path.join(privateRoot, `${label}-dist`);
      await extractVsixDist(file, dist);
      assert.deepEqual(await treeHashes(dist), receipt.buildHashes[label], 'Candidate dist differs from its one production build');
    }
    const stageRoot = path.join(privateRoot, `${label}-stage`);
    mkdirSync(stageRoot);
    stage(stageRoot, packageJson, 'README.marketplace.md', { dist, developmentComparison: !receipt });
    const result = spawnSync(command.file, command.args, { cwd: stageRoot, encoding: 'utf8',
      maxBuffer: 20 * 1024 * 1024, windowsVerbatimArguments: command.windowsVerbatimArguments });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const files = result.stdout.split(/\r?\n/u).map(line => line.trim().replace(/\\/g, '/')).filter(Boolean);
    assertRuntimeFileList(files, { production: Boolean(receipt) });
    if (inspected) {
      const stagedFiles = await treeHashes(stageRoot);
      for (const relative of ['package.nls.json', 'package.nls.zh-cn.json', 'l10n/bundle.l10n.zh-cn.json']) {
        const actual = inspected.extensionFiles.find(file => file.path === relative);
        const expected = stagedFiles.find(file => file.path === relative);
        assert(actual && expected, `Localization file is missing from ${label} staging: ${relative}`);
        assert.equal(actual.sha256, expected.sha256, `Production localization changed during ${label} staging: ${relative}`);
      }
    }
    console.log(`${label}: real staging rules and vsce file list passed${receipt ? ' with the original production VSIX dist' : ''}`);
  }
  if (receipt) {
    await verifyPackageFiles(receipt, plan, values.candidate);
    console.log('Original candidate bytes, production ZIP runtime payload and six targets verified');
  }
} finally {
  rmSync(privateRoot, { recursive: true, force: true });
}
