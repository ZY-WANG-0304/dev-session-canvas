import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import esbuild from 'esbuild';

const require = createRequire(import.meta.url);
const helperPath = path.resolve('extensions/vscode/dev-session-canvas/src/panel/linuxExecutionRuntimeCompatibility.ts');
const compatibilityPath = path.resolve('extensions/vscode/dev-session-canvas/src/panel/executionAssetCompatibility.ts');
const compile = async entryPoint => (await esbuild.build({
  entryPoints: [entryPoint], bundle: true, format: 'cjs', platform: 'node', write: false
})).outputFiles[0].text;
const helperSource = await compile(helperPath);
const compatibilitySource = await compile(compatibilityPath);
const evaluate = (source, targetProcess, spawnSync) => {
  const loaded = { exports: {} };
  new Function('require', 'module', 'exports', 'process', source)(specifier => {
    if (specifier === 'node:child_process') return { spawnSync };
    assert(!specifier.endsWith('.node'), 'Runtime version detection must not load native assets.');
    return require(specifier);
  }, loaded, loaded.exports, targetProcess);
  return loaded.exports;
};
const { assertMinimumExecutionLibraryVersion } = evaluate(compatibilitySource, process, undefined);
const success = version => ({ status: 0, signal: null, stdout: JSON.stringify(version), stderr: '' });
const makeRuntime = (report, overrides = {}) => ({ ...process, report, ...overrides });
const load = (targetProcess, handler = () => success('2.35')) => {
  const calls = [];
  const loaded = evaluate(helperSource, targetProcess, (...args) => {
    calls.push(args);
    return handler(...args);
  });
  return { read: loaded.readLinuxRuntimeGlibcVersion, calls };
};
const localReport = value => ({ getReport: () => ({ header: { glibcVersionRuntime: value } }) });
let count = 0;

{
  const { read, calls } = load(makeRuntime(localReport('2.35')));
  assert.equal(read(), '2.35');
  assert.equal(read(), '2.35');
  assert.equal(calls.length, 0);
  count++;
}
{
  let reports = 0;
  const { read, calls } = load(makeRuntime({ getReport: () => {
    reports++;
    return { header: { glibcVersionRuntime: '2.35' } };
  } }));
  assert.equal(read(), '2.35');
  assert.equal(read(), '2.35');
  assert.equal(reports, 1, 'Cache the successful runtime fact, not repeated report generation.');
  assert.equal(calls.length, 0);
  count++;
}
for (const report of [undefined, {}, { getReport: undefined }, { getReport: () => undefined },
  { getReport: () => ({}) }, { getReport: () => ({ header: {} }) },
  { getReport: () => { throw new Error('report is unavailable'); } }]) {
  const { read, calls } = load(makeRuntime(report));
  assert.equal(read(), '2.35');
  assert.equal(read(), '2.35');
  assert.equal(calls.length, 1, 'Only one successful fallback is needed per helper instance.');
  count++;
}
for (const version of ['unknown', '2.35-extra', '2', '2.35.0.1', '2.9007199254740992', 2.35]) {
  const { read, calls } = load(makeRuntime(localReport(version)));
  assert.throws(() => assertMinimumExecutionLibraryVersion(read(), '2.28'));
  assert.equal(calls.length, 0, 'Malformed local versions must not silently use another source.');
  count++;
}
{
  const { read, calls } = load(makeRuntime(localReport('2.27')));
  assert.throws(() => assertMinimumExecutionLibraryVersion(read(), '2.28'), /minimum/);
  assert.equal(calls.length, 0, 'A known incompatible runtime does not trigger another probe.');
  count++;
}
{
  const env = { KEEP_RUNTIME_TEST: 'kept', NODE_OPTIONS: '--require=/preload-test-only.cjs',
    NODE_PATH: '/preload-test-only', VSCODE_INSPECTOR_OPTIONS: 'test-only-inspector' };
  const original = { ...env };
  const { read, calls } = load(makeRuntime(undefined, { execPath: '/test-only/node', env }));
  assert.equal(read(), '2.35');
  const [executable, args, options] = calls[0];
  assert.equal(executable, '/test-only/node');
  assert.equal(args.length, 2);
  assert.equal(args[0], '-e');
  assert.equal(typeof args[1], 'string');
  assert(!args[1].includes('/preload-test-only'));
  assert.equal(options.timeout, 5000);
  assert.equal(options.killSignal, 'SIGKILL');
  assert.equal(options.maxBuffer, 1024);
  assert.equal(options.encoding, 'utf8');
  assert.notEqual(options.shell, true);
  assert.equal(options.env.KEEP_RUNTIME_TEST, 'kept');
  for (const key of ['NODE_OPTIONS', 'NODE_PATH', 'VSCODE_INSPECTOR_OPTIONS']) {
    assert.equal(options.env[key], undefined);
  }
  assert.deepEqual(env, original, 'The probe must not mutate the Extension Host environment.');
  count++;
}
{
  const { read, calls } = load(makeRuntime(undefined, {
    versions: { ...process.versions, electron: '39.8.7' }, env: { ELECTRON_RUN_AS_NODE: '0' }
  }));
  assert.equal(read(), '2.35');
  assert.equal(calls[0][2].env.ELECTRON_RUN_AS_NODE, '1');
  count++;
}
for (const result of [
  { ...success('2.35'), error: Object.assign(new Error('probe timed out'), { code: 'ETIMEDOUT' }) },
  { ...success('2.35'), error: Object.assign(new Error('probe overflowed'), { code: 'ENOBUFS' }) },
  { ...success('2.35'), status: 1 },
  { ...success('2.35'), status: null, signal: 'SIGKILL' },
  { ...success('2.35'), stdout: '' },
  { ...success('2.35'), stdout: 'not-json' },
  ...[undefined, null, {}, [], 2.35, 'unknown', '2.35-extra', '2.9007199254740992']
    .map(version => success(version)),
  { ...success('2.35'), stdout: `${JSON.stringify('2.35')}\n${JSON.stringify('2.35')}` }
]) {
  const { read, calls } = load(makeRuntime(undefined), () => result);
  assert.throws(() => assertMinimumExecutionLibraryVersion(read(), '2.28'));
  assert.equal(calls.length, 1);
  count++;
}
{
  let attempts = 0;
  const { read, calls } = load(makeRuntime(undefined), () => {
    if (++attempts === 1) return { ...success('2.35'), status: 1 };
    return success('2.35');
  });
  assert.throws(() => read());
  assert.equal(read(), '2.35');
  assert.equal(read(), '2.35');
  assert.equal(calls.length, 2, 'An unsuccessful observation must not become a cached runtime fact.');
  count++;
}
{
  const { read, calls } = load(makeRuntime(undefined), () => success('2.27'));
  assert.throws(() => assertMinimumExecutionLibraryVersion(read(), '2.28'), /minimum/);
  assert.equal(calls.length, 1);
  count++;
}
{
  const { read } = load(makeRuntime(undefined), () => { throw new Error('spawn is unavailable'); });
  assert.throws(() => read());
  count++;
}

if (process.platform === 'linux') {
  const expected = process.report.getReport().header.glibcVersionRuntime;
  assert.equal(typeof expected, 'string', 'The native fallback regression requires a glibc Linux test host.');
  // Another extension can replace this shared API without changing the underlying Node executable.
  const targetProcess = makeRuntime({ getReport: () => undefined }, {
    env: { ...process.env, NODE_OPTIONS: '--require=/dsc-test-missing-preload.cjs',
      NODE_PATH: '/dsc-test-missing-modules', VSCODE_INSPECTOR_OPTIONS: 'dsc-test-unused-inspector' }
  });
  assert.throws(() => assertMinimumExecutionLibraryVersion(
    targetProcess.report.getReport()?.header?.glibcVersionRuntime, expected), /Invalid execution asset library version/);
  const { read, calls } = load(targetProcess, (...args) => require('node:child_process').spawnSync(...args));
  assert.equal(read(), expected);
  assert.doesNotThrow(() => assertMinimumExecutionLibraryVersion(read(), expected));
  assert.equal(calls.length, 1);
  count++;
}

console.log(`Linux execution runtime compatibility: ${count}/${count} passed (bounded metadata probe, no native provider load)`);
