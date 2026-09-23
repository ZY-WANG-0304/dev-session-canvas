// Three Darwin normal-exit inputs; no fault injection or historical rerun.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { budgets, fixtureBytes, terminalState } from './diagnose-native-failure-v1.mjs';
import { assessCase, verifySaved } from './macos-native-baseline-verifier-v1.mjs';

const script = fileURLToPath(import.meta.url);
const roleScript = fileURLToPath(new URL('./macos-native-baseline-roles-v1.mjs', import.meta.url));
const writerScript = fileURLToPath(new URL('./diagnose-native-failure-v1.mjs', import.meta.url));
const require = createRequire(import.meta.url);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const save = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
const errorFact = error => ({ name: error.name, message: error.message, code: error.code ?? null });
const fixed = [1, 2, 3].map(attempt => ({ scenario: 'U1-0', attempt }));

async function expectedInput(token, dependencyRoot) {
  const written = fixtureBytes(token);
  const wire = Buffer.from(written.toString().replaceAll('\n', '\r\n'));
  const { Terminal } = require(path.join(dependencyRoot, '@xterm/headless'));
  const terminal = new Terminal({ cols: 80, rows: 24, scrollback: 1000, allowProposedApi: true });
  try {
    await new Promise(resolve => terminal.write(wire, resolve));
    return { writtenBytes: written.length, writtenHash: hash(written), wireBytes: wire.length,
      wireHash: hash(wire), wireBase64: wire.toString('base64'), state: terminalState(terminal) };
  } finally { terminal.dispose(); }
}

async function observe(config) {
  const started = performance.now();
  const observation = { token: config.token, messages: [], events: [], callerExit: null, callerClose: null };
  const mark = (name, detail = {}) => observation.events.push({ name, ms: performance.now() - started, ...detail });
  const child = spawn(process.execPath, [roleScript, '--caller', config.configPath],
    { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  child.stdout.on('data', data => mark('caller-stdout', { data: String(data).slice(0, 65536) }));
  child.stderr.on('data', data => mark('caller-stderr', { data: String(data).slice(0, 65536) }));
  child.on('message', value => observation.messages.push({ ms: performance.now() - started, value }));
  child.on('error', error => mark('caller-error', errorFact(error)));
  child.on('exit', (code, signal) => { observation.callerExit = { code, signal, ms: performance.now() - started }; });
  let resolveDone;
  const done = new Promise(resolve => { resolveDone = resolve; });
  child.on('close', (code, signal) => {
    observation.callerClose = { code, signal, ms: performance.now() - started };
    resolveDone();
  });
  const control = setTimeout(() => mark('caller-control', { signal: 'SIGTERM', returned: child.kill('SIGTERM') }), budgets.afterAwait);
  const deadline = setTimeout(() => {
    mark('observation-deadline');
    mark('caller-control', { signal: 'SIGKILL', returned: child.kill('SIGKILL') });
    resolveDone();
  }, budgets.observation);
  await done;
  clearTimeout(control); clearTimeout(deadline);
  return structuredClone(observation);
}

async function persist(file, record) {
  const started = performance.now();
  const child = spawn(process.execPath, [writerScript, '--writer', file], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  let receipt = null, close = null, error = null;
  child.stderr.resume();
  child.on('error', cause => { error = errorFact(cause); });
  child.on('message', value => { receipt = { ms: performance.now() - started, value }; });
  let finish;
  const done = new Promise(resolve => { finish = resolve; });
  child.on('close', (code, signal) => { close = { code, signal, ms: performance.now() - started }; finish(); });
  child.send(record, cause => { if (cause) error = errorFact(cause); });
  const work = setTimeout(() => child.kill('SIGTERM'), budgets.writer);
  const total = setTimeout(() => { child.kill('SIGKILL'); finish(); }, budgets.writerObservation);
  await done;
  clearTimeout(work); clearTimeout(total);
  return structuredClone({ receipt, close, error });
}

async function runSchedule(values) {
  assert.equal(process.platform, 'darwin');
  assert.equal(process.version, 'v22.23.2');
  assert(values.output && values.binary && values['dependency-root'], '--output, --binary and --dependency-root are required');
  const output = path.resolve(values.output);
  const binary = path.resolve(values.binary);
  const dependencyRoot = path.resolve(values['dependency-root']);
  const buildDirectory = path.resolve(values['build-directory'] ?? path.dirname(binary));
  const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
  const build = read(path.join(buildDirectory, 'build.json'));
  const manifestFile = path.join(buildDirectory, 'manifest.json');
  const manifest = read(manifestFile);
  const buildManifestHash = hash(fs.readFileSync(manifestFile));
  assert.equal(build.status, 'built-and-load-verified');
  assert.equal(build.binary.path, binary);
  const binaryHash = build.binary.sha256;
  const helper = build.helper.path;
  const helperHash = build.helper.sha256;
  assert.equal(hash(fs.readFileSync(helper)), helperHash, 'Source-bound helper changed');
  assert(fs.statSync(helper).mode & 0o111, 'Helper must be executable');
  for (const member of manifest.files) assert.equal(hash(fs.readFileSync(path.join(buildDirectory, member.file))), member.sha256);
  assert.equal(hash(Buffer.from(JSON.stringify(manifest.files))), manifest.sha256);
  for (const source of build.sources.tools) assert.equal(hash(fs.readFileSync(fileURLToPath(new URL(source.name, import.meta.url)))), source.sha256);
  assert(!fs.existsSync(output), 'Evidence directory must be new');
  assert.equal(hash(fs.readFileSync(binary)), binaryHash, 'Use the source-bound Darwin candidate');
  assert.equal(hash(fs.readFileSync(writerScript)), '94e77d2fe45854ba15affb23783d9544313c29da765a1c8b2b7e7869c6e61708');
  const v1Verifier = fileURLToPath(new URL('./native-failure-verifier-v1.mjs', import.meta.url));
  assert.equal(hash(fs.readFileSync(v1Verifier)), 'd6d98885aa4aa68a68a515f1c57c836f6d402fa594d3516c5e4d57b7516c7fc1');
  assert.equal(require(path.join(dependencyRoot, 'node-pty/package.json')).version, '1.2.0-beta.12');
  fs.mkdirSync(output, { recursive: true });
  const entries = fixed.map(entry => ({ ...entry, token: randomBytes(16).toString('hex') }));
  const sources = [script, fileURLToPath(new URL('./macos-native-baseline-verifier-v1.mjs', import.meta.url)),
    fileURLToPath(new URL('./macos-native-baseline-v1.test.mjs', import.meta.url)), roleScript, writerScript, v1Verifier,
    ...['build-macos-native-baseline-v1.mjs', 'macos-native-baseline-patch-v1.mjs', 'macos-native-baseline-support-v1.h',
      'macos-native-baseline-patch-v1.test.mjs'].map(name => fileURLToPath(new URL(name, import.meta.url))),
    require.resolve(path.join(dependencyRoot, '@xterm/headless'))].map(source => {
    const snapshot = path.basename(source);
    fs.copyFileSync(source, path.join(output, snapshot));
    return { source, snapshot, hash: hash(fs.readFileSync(source)) };
  });
  save(path.join(output, 'schedule.json'), { schema: 'macos-native-baseline-v1', platform: process.platform,
    arch: process.arch, kernel: os.release(), versions: process.versions, binary, binaryHash, helper, helperHash,
    executablePath: process.execPath, constants: { O_NONBLOCK: fs.constants.O_NONBLOCK },
    github: { sha: process.env.GITHUB_SHA ?? null, run: process.env.GITHUB_RUN_ID ?? null,
      attempt: process.env.GITHUB_RUN_ATTEMPT ?? null, image: process.env.ImageVersion ?? null },
    dependencyRoot, buildDirectory, buildManifestHash, budgets, entries, sources,
    scope: 'Three new Darwin U1-0 normal inputs with registered kqueue and same-source helper; no previous matrix rerun.',
    notScheduled: ['Linux U1', 'macOS U1-1..7', 'Windows W1', 'Actual Agent and product chain'] });
  const configs = [];
  for (const entry of entries) {
    const directory = path.join(output, `${entry.scenario}-${entry.attempt}`);
    fs.mkdirSync(directory);
    const configPath = path.join(directory, 'config.json');
    const config = { ...entry, platform: 'darwin', fixtureScenario: 'U1-0', binary, binaryHash, helper, helperHash,
      executablePath: process.execPath, constants: { O_NONBLOCK: fs.constants.O_NONBLOCK },
      dependencyRoot, buildDirectory, buildManifestHash, cwd: process.cwd(), configPath,
      expected: await expectedInput(entry.token, dependencyRoot) };
    save(configPath, config);
    configs.push(config);
  }
  const results = [];
  let admitted = true;
  for (const [index, entry] of entries.entries()) {
    if (!admitted) {
      results.push({ ...entry, status: 'not-run', reason: 'Previous resource settlement or evidence insufficient' });
      continue;
    }
    const config = configs[index], directory = path.dirname(config.configPath);
    const observation = await observe(config);
    const evidence = await persist(path.join(directory, 'raw.json'), observation);
    save(path.join(directory, 'evidence.json'), evidence);
    const assessment = assessCase(config, observation, evidence);
    results.push({ ...entry, status: 'executed', ...assessment });
    admitted = assessment.safeToContinue;
    console.log(JSON.stringify(results.at(-1)));
  }
  save(path.join(output, 'summary.json'), results);
  const verification = await verifySaved(output);
  save(path.join(output, 'verification.json'), verification);
  console.log(JSON.stringify({ output, ...verification }));
  if (!verification.pass) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === script) {
  const { values } = parseArgs({ options: { output: { type: 'string' }, binary: { type: 'string' },
    'dependency-root': { type: 'string' }, 'build-directory': { type: 'string' }, 'verify-saved': { type: 'string' } } });
  try {
    if (values['verify-saved']) {
      const result = await verifySaved(path.resolve(values['verify-saved']), {
        buildDirectory: values['build-directory'] ? path.resolve(values['build-directory']) : undefined,
        dependencyRoot: values['dependency-root'] ? path.resolve(values['dependency-root']) : undefined,
      });
      console.log(JSON.stringify(result, null, 2));
      if (!result.pass) process.exitCode = 1;
    } else await runSchedule(values);
  } catch (error) { console.error(error.stack); process.exitCode = 1; }
}
