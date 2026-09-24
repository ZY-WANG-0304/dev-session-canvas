import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const directory = path.dirname(fileURLToPath(import.meta.url));
const builderPath = path.join(directory, 'build-macos-native-failure-v1.mjs');
const builder = fs.readFileSync(builderPath, 'utf8');
const workflow = fs.readFileSync(path.resolve(directory, '../../.github/workflows/runtime-macos-native-failure.yml'), 'utf8');

test('U1-6 build binds frozen inputs and preserves compiler identity without opening sessions', () => {
  for (const expected of ["kind: 'macos-native-failure-v1-build'", "const nodeVersion = '22.23.2'",
    "const ptyVersion = '1.2.0-beta.12'", "const addonVersion = '7.1.1'",
    '19210adfdaba3cd09809b56bb3281b14e74a8e5efc1f35d467d3c423c30856db',
    '22195de1710b574d5904fc89be5624c25e531de20d5e17e5998a2fd19d86e0e6',
    '85e104c89fdba601b92c2c03dfb50291561226716ab6555bf8be2a59a13e11a6',
    "'macos-native-failure-patch-v1.mjs'", "'macos-native-failure-support-v1.h'",
    "command('xcrun', ['--find', 'clang++']", 'const compiler = located.stdout.trim();',
    'const resolvedCompiler = fs.realpathSync(compiler);', 'command(compiler, args, directory)',
    'command(compiler, helperArgs, directory)', "'-bundle', '-undefined', 'dynamic_lookup'",
    "'-stdlib=libc++', '-isysroot', sdk, '-arch', arch", 'record.helper.mode & 0o111',
    'nativeExecutions: 0', 'nativeCalls:0', 'assert.equal(record.load.nativeCalls, 0)',
    "'fork', 'open', 'resize', 'process', 'failureConfigure', 'failureSnapshot', 'failureCloseMaster'",
    'save(directory, \'build.json\', record); seal(directory);']) assert(builder.includes(expected), expected);
  assert(!builder.includes('macos-native-baseline'));
  assert(!builder.includes('-lutil'));
  const loadProgram = builder.slice(builder.indexOf('const loadProgram ='), builder.indexOf('const loaded ='));
  assert(!/addon\.[A-Za-z]+\(/.test(loadProgram));
  assert(!loadProgram.includes('addon['));
  assert(builder.indexOf("assert.equal(process.platform, 'darwin'") < builder.indexOf('await build(freshDirectory'));
  assert(builder.indexOf("assert(values.output && values.headers && values['dependency-root']") < builder.indexOf('await build(freshDirectory'));
});

test('U1-6 workflow is branch-scoped, records sources and keeps bounded native and offline paths separate', () => {
  for (const expected of ['branches: [runtime-exit-integrity-native-candidates]', 'contents: read',
    'runs-on: macos-latest', "node-version: '22.23.2'", "schema: 'macos-native-failure-runner-v1'",
    'DSC_NATIVE_HEADERS_ROOT="$HEADERS/include/node" node --test scripts/diagnostics/macos-native-failure-*.test.mjs',
    '--output macos-native-failure-build --dependency-root "$PWD/node_modules" --headers "$HEADERS/include/node"',
    "'--build-directory', path.resolve('macos-native-failure-build')", 'timeout: 180000',
    '--verify-saved macos-native-failure-evidence --build-directory macos-native-failure-build',
    'actions/upload-artifact@v4', 'include-hidden-files: true', 'if: always()']) assert(workflow.includes(expected), expected);
  for (const name of ['build-macos-native-failure-v1.mjs', 'macos-native-failure-build-v1.test.mjs',
    'macos-native-failure-support-v1.h', 'macos-native-failure-patch-v1.mjs',
    'macos-native-failure-patch-v1.test.mjs', 'macos-native-failure-roles-v1.mjs',
    'macos-native-failure-roles-v1.test.mjs', 'macos-native-failure-fixture-process-v1.mjs',
    'macos-native-failure-fixture-v1.mjs', 'macos-native-failure-verifier-v1.mjs',
    'macos-native-failure-v1.test.mjs', 'diagnose-macos-native-failure-v1.mjs',
    'macos-native-failure-saved-v1.mjs', 'macos-native-failure-schedule-v1.test.mjs',
    'diagnose-native-failure-v1.mjs', 'native-failure-verifier-v1.mjs'])
    assert(workflow.includes(`'scripts/diagnostics/${name}'`), name);
  assert(!workflow.includes('workflow_dispatch'));
  assert(!workflow.includes('pull_request'));
  assert(!workflow.includes('macos-native-baseline'));
  assert(!workflow.includes('U1-0'));
  assert(!workflow.includes('headless'));
  const scheduleArgs = workflow.slice(workflow.indexOf('const args ='), workflow.indexOf('const startedAt ='));
  assert(!scheduleArgs.includes('--dependency-root'));
  assert.equal(workflow.match(/timeout: 180000/g)?.length, 1);
});

test('unsupported or incomplete build invocation fails before creating any build directory', () => {
  const output = path.join(os.tmpdir(), `dsc-macos-failure-guard-${randomUUID()}`);
  assert(!fs.existsSync(output));
  const result = spawnSync(process.execPath, [builderPath, '--output', output],
    { encoding: 'utf8', timeout: 5000, maxBuffer: 1024 * 1024 });
  assert.equal(result.error, undefined);
  assert.equal(result.signal, null);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /macOS-only|Use the frozen Node runtime|Unsupported macOS architecture|Specify --output, --dependency-root and --headers/);
  assert(!fs.existsSync(output), 'A rejected preflight must not create build output or compile');
});
