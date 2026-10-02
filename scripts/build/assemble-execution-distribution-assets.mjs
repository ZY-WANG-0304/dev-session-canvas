import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { distributionTargets } from './build-execution-distribution-assets.mjs';
import { readExecutionCandidateAssetSet } from './execution-candidate-assets-set.mjs';

export function assembleExecutionDistributionAssets({ source, output, inputCommit }) {
  assert.match(inputCommit, /^[a-f0-9]{40}$/, 'Asset input must be an immutable full commit SHA');
  const destination = path.resolve(output);
  assert(!fs.existsSync(destination), 'Do not overwrite an existing execution asset set');
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const staging = fs.mkdtempSync(path.join(path.dirname(destination), '.execution-assets-'));
  const tar = args => {
    const result = spawnSync('tar', args, { encoding: 'utf8', maxBuffer: 1024 * 1024, timeout: 30000 });
    if (result.error) throw result.error;
    assert.equal(result.status, 0, 'Execution archive operation failed');
    return result.stdout.trim().split(/\r?\n/);
  };
  try {
    for (const target of distributionTargets) {
      const archive = path.join(source, `${target.name}.tar.gz`);
      const summaryPath = path.join(source, `${target.name}-summary.json`);
      assert(fs.lstatSync(archive).isFile() && fs.lstatSync(summaryPath).isFile(), 'Native archive inputs must be regular files');
      const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
      assert.equal(summary.schemaVersion, 1);
      assert.equal(summary.target, target.name);
      assert.equal(summary.inputCommit, inputCommit, 'Native asset provenance differs from requested commit');
      assert.equal(summary.nativeLoaded, true);
      assert.equal(summary.executionApiCalled, false);
      assert.equal(summary.productValidated, false);
      const files = ['manifest.json', ...(target.platform === 'win32'
        ? ['conpty.node', 'conpty/conpty.dll', 'conpty/OpenConsole.exe']
        : ['execution-owner.node', ...(target.platform === 'darwin' ? ['spawn-helper'] : [])])];
      assert.deepEqual([...summary.files].sort(), [...files].sort(), 'Native archive payload must be the fixed runtime file set');
      assert.equal(createHash('sha256').update(fs.readFileSync(archive)).digest('hex'), summary.archiveSha256,
        'Native archive hash mismatch');
      const names = files.map(file => `${target.name}/${file}`);
      assert.deepEqual(tar(['--list', '--gzip', '--file', archive]).sort(), [...names].sort(), 'Unexpected archive member');
      assert(tar(['--list', '--verbose', '--gzip', '--file', archive]).every(line => line.startsWith('-')),
        'Native archives may contain only regular files');
      tar(['--extract', '--gzip', '--file', archive, '--directory', staging, ...names]);
    }
    readExecutionCandidateAssetSet(staging);
    fs.renameSync(staging, destination);
    return readExecutionCandidateAssetSet(destination);
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const { values } = parseArgs({ options: {
    source: { type: 'string' }, output: { type: 'string' }, 'input-sha': { type: 'string' }
  } });
  assembleExecutionDistributionAssets({ source: values.source, output: values.output, inputCommit: values['input-sha'] });
}
