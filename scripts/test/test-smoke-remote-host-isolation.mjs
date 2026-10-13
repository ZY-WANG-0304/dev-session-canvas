import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

if (process.platform !== 'linux') {
  console.log('Remote Host socket directory isolation requires Linux; skipped.');
} else {
  const exec = promisify(execFile);
  const suite = path.resolve('scripts/test/test-smoke-remote-host.mjs');
  const helper = path.resolve('tests/vscode-smoke/remote-host-control.cjs');
  const realDirectory = `/tmp/dsc-root-${process.getuid()}`;
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'dsc-host-isolation-'));
  const inspect = async directory => {
    let stat;
    try { stat = await fs.lstat(directory, { bigint: true }); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    return { inode: String(stat.ino), device: String(stat.dev), mode: String(stat.mode),
      uid: String(stat.uid), gid: String(stat.gid), mtime: String(stat.mtimeNs),
      files: await fs.readdir(directory), sentinel: await fs.readFile(path.join(directory, 'sentinel'), 'utf8')
        .catch(error => { if (error.code === 'ENOENT') return null; throw error; }) };
  };
  try {
    for (const initial of ['absent', 'private-0700', 'existing-0755']) {
      const directory = path.join(temporary, initial);
      if (initial !== 'absent') {
        await fs.mkdir(directory, { mode: 0o700 });
        await fs.writeFile(path.join(directory, 'sentinel'), 'existing runtime contents\n');
        await fs.chmod(directory, initial === 'private-0700' ? 0o700 : 0o755);
      }
      // Isolate the real helper's namespace, preserving any accidental mkdir/connection from the full suite.
      const preload = path.join(temporary, `${initial}.cjs`);
      await fs.writeFile(preload, `
        const Module = require('node:module');
        const actualPath = require('node:path');
        const load = Module._load;
        Module._load = function(name, parent, main) {
          if (name === 'node:path' && parent?.filename === ${JSON.stringify(helper)}) {
            return { ...actualPath, join(...parts) {
              const filename = actualPath.join(...parts);
              const original = ${JSON.stringify(realDirectory)};
              return filename === original || filename.startsWith(original + '/')
                ? ${JSON.stringify(directory)} + filename.slice(original.length) : filename;
            }};
          }
          return load.apply(this, arguments);
        };
        process.umask(0o022);
      `);
      const before = await inspect(directory);
      const result = await exec(process.execPath, ['--require', preload, suite], { timeout: 20000, maxBuffer: 65536 });
      const count = /Remote Host control tests passed \((\d+)\)/.exec(result.stdout);
      assert(count && Number(count[1]) >= 17, 'The complete original Remote Host suite must pass');
      assert.deepEqual(await inspect(directory), before, `Remote Host suite must leave ${initial} namespace unchanged`);
      console.log(`PASS full Remote Host suite (${count[1]}): ${initial} namespace unchanged`);
    }
  } finally {
    // The child suites completed before deleting only this test's fixtures.
    await fs.rm(temporary, { recursive: true, force: true });
  }
  console.log('Remote Host socket directory isolation tests passed (3).');
}
