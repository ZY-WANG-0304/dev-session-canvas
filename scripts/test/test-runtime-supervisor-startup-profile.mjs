import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';

import esbuild from 'esbuild';

const require = createRequire(import.meta.url);
const candidateProfile = 'linux-owner-v1-candidate';
const storageRoot = '/tmp/dsc startup"%';
const candidateBase = path.join(storageRoot, 'runtime-supervisor-generations', 'terminal-current-state-linux-v1');
const rootOwnerBase = path.join(storageRoot, 'runtime-supervisor-generations', 'terminal-root-owner-linux-v1');
const stockBase = path.join(storageRoot, 'runtime-supervisor-generations', 'terminal-stream-v1');
const startupScripts = {
  supervisorScriptPath: '/test scripts/supervisor"%.js',
  supervisorLauncherScriptPath: '/test scripts/launcher.js'
};
const backendCode = await bundle('panel/runtimeHostBackend.ts');
const startCode = await bundle('supervisor/runtimeSupervisorStart.ts');
const launcherCode = await bundle('supervisor/runtimeSupervisorLauncher.ts');
let passed = 0;

for (const profile of [undefined, candidateProfile]) {
  await test(`detached ${profile ?? 'stock'} passes both startup hops`, async () => {
    const harness = createHarness();
    const backend = loadBackend(harness, 'legacy-detached', profile ? candidateBase : stockBase);
    await backend.startSupervisor({ ...startupScripts, ...(profile ? { executionProfile: profile } : {}) });
    assert.deepEqual(harness.effects.map(({ kind }) => kind), ['spawn', 'unref']);
    const firstHop = harness.effects[0];
    assert.equal(firstHop.file, '/test-node');
    assert.deepEqual(firstHop.args, expectedBackendArgs(backend, profile));
    assert.equal(firstHop.options.detached, true);
    assert.equal(firstHop.options.stdio, 'ignore');
    assert.equal(firstHop.options.windowsHide, true);
    assert.equal(firstHop.options.env.ELECTRON_RUN_AS_NODE, '1');
    assert.equal(firstHop.options.env.ELECTRON_NO_ATTACH_CONSOLE, '1');

    const launcher = await runLauncher(firstHop.args);
    assert.deepEqual(launcher.errors, []);
    assert.equal(launcher.process.exitCode, undefined);
    assert.deepEqual(launcher.effects.map(({ kind }) => kind), ['spawn', 'unref']);
    const secondHop = launcher.effects[0];
    assert.equal(secondHop.file, '/test-node');
    assert.deepEqual(secondHop.args, expectedLauncherArgs(backend, profile));
    assert.deepEqual(secondHop.options, { detached: true, stdio: 'ignore', windowsHide: true });
  });

  await test(`systemd ${profile ?? 'stock'} renders the selected startup`, async () => {
    const harness = createHarness();
    const backend = loadBackend(harness, 'systemd-user', profile ? candidateBase : stockBase);
    await backend.startSupervisor({ ...startupScripts, ...(profile ? { executionProfile: profile } : {}) });
    assert.deepEqual(harness.effects.map(({ kind }) => kind), [
      'mkdir', 'mkdir', 'mkdir', 'chmod', 'writeFile', 'execFile', 'execFile'
    ]);
    assert.deepEqual(harness.effects[0].args, [backend.paths.storageDir, { recursive: true }]);
    const unit = harness.effects.find(({ kind }) => kind === 'writeFile');
    assert.equal(unit.args[0], backend.paths.unitFilePath);
    assert.equal(unit.args[2], 'utf8');
    const expectedArgs = [
      '/test-node', startupScripts.supervisorScriptPath,
      '--storage-dir', backend.paths.storageDir,
      '--socket-path', backend.paths.socketPath,
      '--runtime-backend', backend.kind,
      '--runtime-guarantee', backend.guarantee,
      '--control-dir', backend.paths.controlDir,
      ...(profile ? ['--execution-profile', profile] : [])
    ];
    assert.equal(unit.args[1].split('\n').find((line) => line.startsWith('ExecStart=')),
      `ExecStart=${expectedArgs.map(quoteSystemdArg).join(' ')}`);
    assert.equal(unit.args[1].split('\n').find((line) => line.startsWith('WorkingDirectory=')),
      `WorkingDirectory=${backend.paths.storageDir.replace(/%/g, '%%')}`);
    assert.equal(unit.args[1].split('\n').find((line) => line.startsWith('Restart=')),
      profile ? 'Restart=no' : 'Restart=on-failure');
    const commands = harness.effects.filter(({ kind }) => kind === 'execFile');
    assert.deepEqual(commands.map(({ file, args }) => [file, args]), [
      ['systemctl', ['--user', 'daemon-reload']],
      ['systemctl', ['--user', 'start', backend.paths.unitName]]
    ]);
  });
}

for (const kind of ['legacy-detached', 'systemd-user']) {
  await test(`${kind} shares the standalone startup and forwards the root launch token`, async () => {
    const harness = createHarness();
    const backend = loadBackend(harness, kind, rootOwnerBase);
    const runtimeLaunchToken = 'b1d709fa-a79d-4c19-a97d-c0d992a3ed83';
    const args = { ...startupScripts, executionProfile: candidateProfile, runtimeLaunchToken };
    await backend.startSupervisor(args);

    const standalone = createHarness({ allowVscode: false });
    await standalone.load(startCode).startRuntimeSupervisor(backend, args);
    assert.deepEqual(standalone.effects, harness.effects);

    if (kind === 'legacy-detached') {
      assert.deepEqual(harness.effects.map(({ kind }) => kind), ['spawn', 'unref']);
      const firstHop = harness.effects[0];
      assert.deepEqual(firstHop.args, [...expectedBackendArgs(backend, candidateProfile),
        '--runtime-launch-token', runtimeLaunchToken]);
      const launcher = await runLauncher(firstHop.args);
      assert.deepEqual(launcher.errors, []);
      assert.deepEqual(launcher.effects.map(({ kind }) => kind), ['spawn', 'unref']);
      assert.deepEqual(launcher.effects[0].args, [...expectedLauncherArgs(backend, candidateProfile),
        '--runtime-launch-token', runtimeLaunchToken]);
    } else {
      assert.deepEqual(harness.effects[0].args, [backend.paths.storageDir, { recursive: true, mode: 0o700 }]);
      const unit = harness.effects.find(({ kind }) => kind === 'writeFile').args[1];
      const execStart = unit.split('\n').find((line) => line.startsWith('ExecStart='));
      assert.ok(execStart.endsWith(` ${quoteSystemdArg('--runtime-launch-token')} ${quoteSystemdArg(runtimeLaunchToken)}`));
      assert.equal(unit.split('\n').find((line) => line.startsWith('WorkingDirectory=')),
        `WorkingDirectory=${backend.paths.storageDir.replace(/%/g, '%%')}`);
      assert.equal(unit.split('\n').find((line) => line.startsWith('Restart=')), 'Restart=no');
    }
  });
}

for (const [base, profile] of [[stockBase, undefined], [candidateBase, candidateProfile], [rootOwnerBase, candidateProfile]]) {
  for (const separator of ['\n', '\r', '\0']) {
    await test(`systemd ${path.basename(base)} rejects path control ${JSON.stringify(separator)} before startup effects`, async () => {
      const harness = createHarness();
      const unsafeBase = path.join(`/tmp/dsc${separator}unsafe`, 'runtime-supervisor-generations', path.basename(base));
      const backend = loadBackend(harness, 'systemd-user', unsafeBase);
      await assert.rejects(backend.startSupervisor({ ...startupScripts, ...(profile ? { executionProfile: profile } : {}) }),
        /single.line/);
      assert.deepEqual(harness.effects, []);
    });
  }
}

await test('systemd working directory preserves literal backslashes while escaping specifiers', async () => {
  const harness = createHarness();
  const backend = loadBackend(harness, 'systemd-user', '/tmp/dsc back\\slash"%/runtime-supervisor-generations/terminal-stream-v1');
  await backend.startSupervisor(startupScripts);
  const unit = harness.effects.find(({ kind }) => kind === 'writeFile').args[1];
  assert.equal(unit.split('\n').find(line => line.startsWith('WorkingDirectory=')),
    `WorkingDirectory=${backend.paths.storageDir.replace(/%/g, '%%')}`);
});

await test('systemd rejects a multiline supervisor script before startup effects', async () => {
  const harness = createHarness();
  const backend = loadBackend(harness, 'systemd-user', rootOwnerBase);
  await assert.rejects(backend.startSupervisor({ ...startupScripts, supervisorScriptPath: '/tmp/script\ninjected.js',
    executionProfile: candidateProfile }), /single.line/);
  assert.deepEqual(harness.effects, []);
});

for (const kind of ['legacy-detached', 'systemd-user']) {
  for (const profile of ['', 'future-profile']) {
    await test(`${kind} rejects unsupported profile ${JSON.stringify(profile)} without startup effects`, async () => {
      const harness = createHarness();
      const backend = loadBackend(harness, kind, candidateBase);
      await assert.rejects(backend.startSupervisor({ ...startupScripts, executionProfile: profile }), /Unsupported/);
      assert.deepEqual(harness.effects, []);
    });
  }
  await test(`${kind} rejects candidate in stock generation without startup effects`, async () => {
    const harness = createHarness();
    const backend = loadBackend(harness, kind, stockBase);
    await assert.rejects(backend.startSupervisor({ ...startupScripts, executionProfile: candidateProfile }), /isolated/);
    assert.deepEqual(harness.effects, []);
  });
}

for (const values of [[], [''], [' '], ['future-profile'], ['--runtime-backend', 'legacy-detached']]) {
  await test(`launcher rejects explicit invalid profile ${JSON.stringify(values)} without spawning`, async () => {
    const launcher = await runLauncher([
      startupScripts.supervisorLauncherScriptPath,
      '--supervisor-script', startupScripts.supervisorScriptPath,
      '--storage-dir', path.join(candidateBase, 'runtime-supervisor'),
      '--execution-profile', ...values
    ]);
    assert.equal(launcher.process.exitCode, 1);
    assert.equal(launcher.errors.length, 1);
    assert.match(launcher.errors[0].message, /Unsupported/);
    assert.deepEqual(launcher.effects, []);
  });
}

await test('launcher rejects candidate in stock generation without spawning', async () => {
  const launcher = await runLauncher([
    startupScripts.supervisorLauncherScriptPath,
    '--supervisor-script', startupScripts.supervisorScriptPath,
    '--storage-dir', path.join(stockBase, 'runtime-supervisor'),
    '--execution-profile', candidateProfile
  ]);
  assert.equal(launcher.process.exitCode, 1);
  assert.equal(launcher.errors.length, 1);
  assert.match(launcher.errors[0].message, /isolated/);
  assert.deepEqual(launcher.effects, []);
});

console.log(`runtime supervisor startup profile tests passed (${passed} cases)`);

async function bundle(relativePath) {
  const result = await esbuild.build({
    entryPoints: [path.resolve('extensions/vscode/dev-session-canvas/src', relativePath)],
    bundle: true,
    format: 'cjs',
    platform: 'node',
    target: 'node18',
    external: ['vscode'],
    write: false
  });
  return result.outputFiles[0].text;
}

function createHarness({ allowVscode = true } = {}) {
  const effects = [];
  const errors = [];
  const fakeProcess = {
    platform: 'linux',
    execPath: '/test-node',
    env: { XDG_CONFIG_HOME: '/test-config', XDG_STATE_HOME: '/test-state', XDG_RUNTIME_DIR: '/test-runtime' },
    getuid: () => 1000,
    argv: [],
    exitCode: undefined
  };
  const childProcess = {
    spawn(file, args, options) {
      effects.push({ kind: 'spawn', file, args, options });
      return { unref: () => effects.push({ kind: 'unref' }) };
    },
    execFile(file, args, options, callback) {
      effects.push({ kind: 'execFile', file, args, options });
      callback(null, '', '');
    }
  };
  const fs = Object.fromEntries(['mkdir', 'chmod', 'writeFile'].map((kind) => [kind, async (...args) => {
    effects.push({ kind, args });
  }]));
  const guardedRequire = (name) => {
    if (name === 'child_process') return childProcess;
    if (name === 'fs/promises') return fs;
    if (name === 'vscode' && allowVscode) return { ExtensionMode: { Test: 3 } };
    if (['crypto', 'os', 'path', 'util'].includes(name)) return require(name);
    throw new Error(`Unexpected test dependency: ${name}`);
  };
  return {
    effects, errors, process: fakeProcess,
    load(code) {
      const module = { exports: {} };
      new Function('require', 'module', 'exports', 'process', 'console', code)(
        guardedRequire, module, module.exports, fakeProcess, { error: (error) => errors.push(error) }
      );
      return module.exports;
    }
  };
}

function loadBackend(harness, kind, baseStoragePath) {
  return harness.load(backendCode).createRuntimeHostBackend(kind, { baseStoragePath, extensionMode: 3 });
}

async function runLauncher(args) {
  const harness = createHarness();
  harness.process.argv = ['/test-node', ...args];
  harness.load(launcherCode);
  await new Promise((resolve) => setImmediate(resolve));
  return harness;
}

function expectedBackendArgs(backend, profile) {
  return [
    startupScripts.supervisorLauncherScriptPath,
    '--supervisor-script', startupScripts.supervisorScriptPath,
    '--storage-dir', backend.paths.storageDir,
    '--socket-path', backend.paths.socketPath,
    '--runtime-backend', backend.kind,
    '--runtime-guarantee', backend.guarantee,
    ...(backend.paths.runtimeDir ? ['--runtime-dir', backend.paths.runtimeDir] : []),
    ...(backend.paths.controlDir ? ['--control-dir', backend.paths.controlDir] : []),
    ...(profile ? ['--execution-profile', profile] : [])
  ];
}

function expectedLauncherArgs(backend, profile) {
  return [
    startupScripts.supervisorScriptPath,
    '--storage-dir', backend.paths.storageDir,
    '--socket-path', backend.paths.socketPath,
    ...(backend.paths.runtimeDir ? ['--runtime-dir', backend.paths.runtimeDir] : []),
    ...(backend.paths.controlDir ? ['--control-dir', backend.paths.controlDir] : []),
    '--runtime-backend', backend.kind,
    '--runtime-guarantee', backend.guarantee,
    ...(profile ? ['--execution-profile', profile] : [])
  ];
}

function quoteSystemdArg(value) {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/%/g, '%%')}"`;
}

async function test(name, run) {
  try {
    await run();
    passed += 1;
  } catch (error) {
    throw new Error(name, { cause: error });
  }
}
