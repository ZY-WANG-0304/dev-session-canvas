import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import esbuild from 'esbuild';
import { WINDOWS_EXECUTION_EXPORTS } from '../build/windows-execution-provider-patch.mjs';

const require = createRequire(import.meta.url);
const actualCommandLine = require('node-pty/lib/windowsPtyAgent').argsToCommandLine;
const { outputFiles } = await esbuild.build({
  entryPoints: [path.resolve('extensions/vscode/dev-session-canvas/src/panel/windowsExecutionProviderMain.ts')],
  bundle: true, format: 'cjs', platform: 'node', target: 'node18', write: false,
  external: ['node-pty', 'node-pty/*'],
  plugins: [{ name: 'controlled-windows-main', setup(build) {
    build.onResolve({ filter: /^\.\/windowsExecutionOwnerFactory$/ }, () => ({ path: 'controlled-factory', external: true }));
    build.onResolve({ filter: /^\.\/windowsExecutionProvider$/ }, () => ({ path: 'controlled-provider', external: true }));
  } }]
});
const hash = 'a'.repeat(64);
async function main(options = {}) {
  const state = { errors: [], disconnected: false, nativeLoads: 0, launches: [], encodings: [] };
  const module = { exports: {} };
  const processView = { platform: 'win32', connected: true, send() {}, env: {},
    argv: ['node', 'provider', 'execution-1', 'generation-1', hash, hash, hash, options.changedWorker ? 'b'.repeat(64) : hash],
    stderr: { write(text) { state.errors.push(text); } }, disconnect() { state.disconnected = true; } };
  const native = Object.fromEntries(WINDOWS_EXECUTION_EXPORTS.map(name => [name, () => {}]));
  if (options.missingExport) delete native.executionClose;
  const controlledRequire = name => {
    if (name === 'controlled-factory') return {
      WINDOWS_EXECUTION_NATIVE_EXPORTS: WINDOWS_EXECUTION_EXPORTS,
      resolveWindowsExecutionProviderAssets: () => ({ binaryPath: '/controlled/conpty.node', workerPath: '/controlled/worker.js',
        binarySha256: hash, manifestSha256: hash, entrySha256: hash, workerSha256: hash })
    };
    if (name === 'controlled-provider') return { async runWindowsExecutionProvider(value) { state.launches.push(value); return { kind: 'closed' }; } };
    if (name === '/controlled/conpty.node') { state.nativeLoads++; return native; }
    if (name === 'node-pty/lib/windowsPtyAgent') return { argsToCommandLine(file, args) {
      state.encodings.push({ file, args });
      return actualCommandLine(file, args);
    } };
    return require(name);
  };
  controlledRequire.main = module;
  new Function('require', 'module', 'exports', 'process', '__dirname', outputFiles[0].text)(
    controlledRequire, module, module.exports, processView, '/controlled');
  for (let turn = 0; turn < 20; turn++) await Promise.resolve();
  return { ...state, processView };
}

{
  const state = await main();
  assert.equal(state.errors.length, 0);
  assert.equal(state.launches.length, 1);
  const launch = state.launches[0];
  const shell = 'C:\\Windows\\System32\\cmd.exe';
  const command = launch.commandLine('C:\\Program Files\\Agents\\agent.cmd', ['literal space', 'value&more'], { ComSpec: shell });
  assert.equal(state.encodings[0].file, shell);
  assert.equal(typeof state.encodings[0].args, 'string', 'cmd receives the existing pre-escaped shell syntax, not CRT argv escaping');
  assert(state.encodings[0].args.startsWith('/d /s /c "'));
  assert(state.encodings[0].args.includes('value^&more'));
  assert(command.startsWith(`${shell} /d /s /c `));
  launch.commandLine('C:\\Apps\\node.exe', ['literal space'], { ComSpec: shell });
  assert.deepEqual(state.encodings[1], { file: 'C:\\Apps\\node.exe', args: ['literal space'] });
}

{
  const state = await main({ changedWorker: true });
  assert.equal(state.nativeLoads, 0);
  assert.equal(state.launches.length, 0);
  assert(state.errors.some(error => error.includes('assets changed')));
  assert.equal(state.processView.exitCode, 1);
  assert(state.disconnected);
}

{
  const state = await main({ missingExport: true });
  assert.equal(state.launches.length, 0);
  assert(state.errors.some(error => error.includes('incompatible native exports')));
  assert.equal(state.processView.exitCode, 1);
}

console.log('Windows provider Main: 3 controlled cases passed, including actual launch resolution; no native calls.');
