import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import vm from 'node:vm';

import esbuild from 'esbuild';

const tempDir = await mkdtemp(path.join(os.tmpdir(), 'dsc-runtime-environment-'));
const require = createRequire(import.meta.url);
const execFileAsync = promisify(execFile);
const bootIdentifier = '9dce24ce-31f7-479d-920f-856cf735ed90';
const namespaceNames = ['pid', 'mnt', 'user', 'net'];

try {
  const outfile = path.join(tempDir, 'runtimeExecutionEnvironment.cjs');
  await esbuild.build({
    entryPoints: [path.resolve('extensions/vscode/dev-session-canvas/src/panel/runtimeExecutionEnvironment.ts')],
    bundle: true,
    format: 'cjs',
    outfile,
    platform: 'node',
    target: 'node18'
  });
  const bundle = await readFile(outfile, 'utf8');

  // Only system reads are replaced; production callers have no injected identity path.
  function loadFixture(platform, changes = {}) {
    const calls = [];
    const module = { exports: {} };
    const processFixture = {
      platform,
      env: { SystemRoot: 'C:\\Windows', ...changes.env },
      getuid: changes.missingUid ? undefined : () => changes.uid ?? 501
    };
    const fsFixture = {
      readFile: async (file) => {
        assert.equal(file, '/proc/sys/kernel/random/boot_id');
        if (changes.readError) throw new Error('private OS identifier must not leak');
        return changes.bootIdentifier ?? `${bootIdentifier}\n`;
      },
      readlink: async (file) => {
        const name = path.posix.basename(file);
        assert.equal(file, `/proc/self/ns/${name}`);
        assert.ok(namespaceNames.includes(name));
        if (changes.namespaceError) throw new Error('private OS identifier must not leak');
        return changes.namespaces?.[name] ?? `${name}:[4026531836]`;
      }
    };
    const fixtureRequire = (name) => {
      if (name === 'node:fs/promises') return fsFixture;
      if (name === 'node:child_process') return {
        execFile: (file, args, options, callback) => {
          calls.push({ file, args, options });
          const output = platform === 'darwin' ? `${bootIdentifier}\n`
            : JSON.stringify({ bootIdentifier, userIdentity: 'S-1-5-21-100-200-300-400' });
          callback(changes.execError ?? null, changes.stdout ?? output, changes.stderr ?? '');
        }
      };
      return require(name);
    };
    const wrapper = vm.runInNewContext(`(function(require, module, exports, process, Buffer) { ${bundle}\n })`, {
      Date: class extends Date { static now() { throw new Error('Wall clock must not determine environment identity'); } }
    });
    wrapper(fixtureRequire, module, module.exports, processFixture, Buffer);
    return { read: module.exports.readRuntimeExecutionEnvironment, calls };
  }

  async function expectUnknown(platform, changes) {
    await assert.rejects(loadFixture(platform, changes).read(), (error) => {
      assert.equal(error.message, `Runtime execution environment is unknown (${platform}); OS identity probe failed.`);
      return true;
    });
  }

  const linux = await loadFixture('linux').read();
  assert.match(linux.environmentKey, /^[a-f0-9]{64}$/);
  assert.equal(linux.userIdentity, 'uid:501');
  assert.equal(linux.environmentKey, (await loadFixture('linux', { uid: 502 }).read()).environmentKey);
  for (const name of namespaceNames) {
    const changed = await loadFixture('linux', { namespaces: { [name]: `${name}:[4026531837]` } }).read();
    assert.notEqual(changed.environmentKey, linux.environmentKey);
    await expectUnknown('linux', { namespaces: { [name]: '' } });
    await expectUnknown('linux', { namespaces: { [name]: 'unknown:[123]' } });
  }
  assert.notEqual(linux.environmentKey, (await loadFixture('linux', {
    bootIdentifier: '8dce24ce-31f7-479d-920f-856cf735ed90'
  }).read()).environmentKey);
  for (const value of ['', 'not-a-uuid', '00000000-0000-0000-0000-000000000000']) {
    await expectUnknown('linux', { bootIdentifier: value });
    await expectUnknown('darwin', { stdout: value });
  }
  await expectUnknown('linux', { readError: true });
  await expectUnknown('linux', { namespaceError: true });
  await expectUnknown('linux', { missingUid: true });
  await expectUnknown('linux', { uid: -1 });
  await expectUnknown('linux', { uid: Number.NaN });
  await expectUnknown('freebsd', {});

  for (const platform of ['darwin', 'win32']) {
    const fixture = loadFixture(platform);
    const result = await fixture.read();
    assert.match(result.environmentKey, /^[a-f0-9]{64}$/);
    assert.notEqual(result.environmentKey, linux.environmentKey);
    assert.equal(fixture.calls.length, 1);
    const { file, args, options } = fixture.calls[0];
    assert.equal(options.timeout, 10_000);
    assert.equal(options.maxBuffer, 16 * 1024);
    assert.equal(options.windowsHide, true);
    assert.equal(options.shell, undefined);
    if (platform === 'darwin') {
      assert.equal(file, '/usr/sbin/sysctl');
      assert.equal(JSON.stringify(args), JSON.stringify(['-n', 'kern.bootsessionuuid']));
      assert.equal(result.userIdentity, 'uid:501');
    } else {
      assert.equal(file, 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
      assert.equal(JSON.stringify(args.slice(0, 4)), JSON.stringify([
        '-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand'
      ]));
      const script = Buffer.from(args[4], 'base64').toString('utf16le');
      assert.match(script, /NtQuerySystemInformation\(90,/);
      assert.match(script, /WindowsIdentity\]::GetCurrent\(\)/);
      assert.doesNotMatch(script, /LastBootUpTime|boottime|Get-Date|Invoke-WebRequest/);
      assert.equal(result.userIdentity, 'sid:S-1-5-21-100-200-300-400');
    }
    await expectUnknown(platform, { execError: new Error('private probe output') });
    await expectUnknown(platform, { execError: Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' }) });
    await expectUnknown(platform, { stderr: 'unexpected probe diagnostics' });
  }
  for (const stdout of [
    '', 'null', '[]', '{}', 'noise\n{}', '{"bootIdentifier":',
    JSON.stringify({ bootIdentifier, userIdentity: '' }),
    JSON.stringify({ bootIdentifier, userIdentity: 'unknown-user' }),
    JSON.stringify({ bootIdentifier: '', userIdentity: 'S-1-5-21-100' }),
    JSON.stringify({ bootIdentifier, userIdentity: 'S-1-5-21-100', extra: 'unexpected' })
  ]) {
    await expectUnknown('win32', { stdout });
  }
  await expectUnknown('win32', { env: { SystemRoot: 'relative-system-directory' } });
  console.log('Synthetic source validation and failure cases passed (not native platform evidence).');

  const { readRuntimeExecutionEnvironment } = require(outfile);
  const current = await readRuntimeExecutionEnvironment();
  const publicIdentity = (value) => ({
    environmentKey: value.environmentKey,
    userIdentityKey: createHash('sha256').update(value.userIdentity).digest('hex')
  });
  const script = `
    const { createHash } = require('node:crypto');
    require(process.argv[1]).readRuntimeExecutionEnvironment().then((value) => {
      process.stdout.write(JSON.stringify({
        environmentKey: value.environmentKey,
        userIdentityKey: createHash('sha256').update(value.userIdentity).digest('hex')
      }));
    }).catch(() => { process.stderr.write('OS identity probe failed'); process.exitCode = 1; });
  `;
  const children = await Promise.all([0, 1].map(() => execFileAsync(process.execPath, ['-e', script, outfile], {
    encoding: 'utf8', timeout: 20_000, maxBuffer: 16 * 1024,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
  })));
  for (const child of children) {
    assert.equal(child.stderr, '');
    assert.notEqual(child.stdout, '', 'Native child probe produced no output; check whether the environment permits child processes.');
    assert.deepEqual(JSON.parse(child.stdout), publicIdentity(current));
  }

  const originalNow = Date.now;
  try {
    Date.now = () => originalNow() - 86_400_000;
    assert.deepEqual(publicIdentity(await readRuntimeExecutionEnvironment()), publicIdentity(current));
    Date.now = () => originalNow() + 86_400_000;
    assert.deepEqual(publicIdentity(await readRuntimeExecutionEnvironment()), publicIdentity(current));
  } finally {
    Date.now = originalNow;
  }
  console.log(`Runtime execution environment tests passed; native ${process.platform} identity agrees across two child processes.`);
  console.log('Synthetic platform failure cases and JavaScript clock changes passed; other native platforms and OS clock/sleep/reboot behavior require their own runs.');
} finally {
  await rm(tempDir, { recursive: true, force: true });
}
