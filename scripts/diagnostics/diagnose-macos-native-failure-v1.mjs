// Three new U1-6 inputs. The previous U1-0 evidence and entrypoints stay frozen.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { budgets } from './diagnose-native-failure-v1.mjs';
import { assessCase } from './macos-native-failure-verifier-v1.mjs';
import { expected, fixedEntries, sourceNames, verifyBuild, verifySaved } from './macos-native-failure-saved-v1.mjs';

const script = fileURLToPath(import.meta.url);
const roleScript = fileURLToPath(new URL('./macos-native-failure-roles-v1.mjs', import.meta.url));
const writerScript = fileURLToPath(new URL('./diagnose-native-failure-v1.mjs', import.meta.url));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const save = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
const errorFact = error => ({ name: error.name, message: error.message, code: error.code ?? null });

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
    observation.callerClose = { code, signal, ms: performance.now() - started }; resolveDone();
  });
  const control = setTimeout(() => mark('caller-control', { signal: 'SIGTERM', returned: child.kill('SIGTERM') }), budgets.afterAwait);
  const deadline = setTimeout(() => {
    mark('observation-deadline');
    mark('caller-control', { signal: 'SIGKILL', returned: child.kill('SIGKILL') }); resolveDone();
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

export async function runSchedule(values, dependencies = {}) {
  const deps = { platform: process.platform, version: process.version, arch: process.arch,
    kernel: os.release(), versions: process.versions, execPath: process.execPath, cwd: process.cwd(),
    env: process.env, randomBytes, observe, persist, log: value => console.log(JSON.stringify(value)), ...dependencies };
  assert.equal(deps.platform, 'darwin'); assert.equal(deps.version, 'v22.23.2');
  assert(values.output && values.binary, '--output and --binary are required');
  const output = path.resolve(values.output), binary = path.resolve(values.binary);
  const buildDirectory = path.resolve(values['build-directory'] ?? path.dirname(binary));
  const { build, buildManifestHash } = verifyBuild(buildDirectory);
  assert.equal(build.binary.path, binary); assert.equal(build.arch, deps.arch);
  assert.equal(build.versions.node, deps.versions.node);
  assert.equal(hash(fs.readFileSync(binary)), build.binary.sha256, 'Use the source-bound U1-6 candidate');
  assert.equal(hash(fs.readFileSync(build.helper.path)), build.helper.sha256, 'Source-bound helper changed');
  assert(fs.statSync(build.helper.path).mode & 0o111, 'Helper must be executable');
  assert(!fs.existsSync(output), 'Evidence directory must be new');
  const entries = fixedEntries.map(entry => ({ ...entry, token: deps.randomBytes(16).toString('hex') }));
  assert(entries.every(entry => /^[a-f0-9]{32}$/.test(entry.token)));
  assert.equal(new Set(entries.map(entry => entry.token)).size, 3);
  fs.mkdirSync(output, { recursive: true });
  const sources = sourceNames.map(name => {
    const source = fileURLToPath(new URL(name, import.meta.url));
    fs.copyFileSync(source, path.join(output, name), fs.constants.COPYFILE_EXCL);
    return { source, snapshot: name, hash: hash(fs.readFileSync(source)) };
  });
  const identity = { platform: deps.platform, binary, binaryHash: build.binary.sha256,
    helper: build.helper.path, helperHash: build.helper.sha256, executablePath: deps.execPath,
    buildDirectory, buildManifestHash, cwd: deps.cwd };
  save(path.join(output, 'schedule.json'), { schema: 'macos-native-failure-v1', ...identity,
    arch: deps.arch, kernel: deps.kernel, versions: deps.versions, budgets, entries, sources,
    github: { sha: deps.env.GITHUB_SHA ?? null, run: deps.env.GITHUB_RUN_ID ?? null,
      attempt: deps.env.GITHUB_RUN_ATTEMPT ?? null, image: deps.env.ImageVersion ?? null },
    scope: 'Three new U1-6 registration-substitute inputs; closed data gate and token-bound abort.',
    notScheduled: ['U1-0 rerun', 'Real kevent failure', 'Other U1/W1', 'Actual Agent and product chain'] });
  const configs = entries.map(entry => {
    const directory = path.join(output, `${entry.scenario}-${entry.attempt}`); fs.mkdirSync(directory);
    const configPath = path.join(directory, 'config.json');
    const config = { ...entry, ...identity, fixtureScenario: 'U1-6', configPath, expected };
    save(configPath, config); return config;
  });
  const results = [];
  let admitted = true;
  for (const [index, entry] of entries.entries()) {
    if (!admitted) {
      results.push({ ...entry, status: 'not-run', reason: 'Previous resource settlement or evidence insufficient' });
      continue;
    }
    const config = configs[index], directory = path.dirname(config.configPath);
    const observation = await deps.observe(config);
    const evidence = await deps.persist(path.join(directory, 'raw.json'), observation);
    save(path.join(directory, 'evidence.json'), evidence);
    const assessment = assessCase(config, observation, evidence);
    results.push({ ...entry, status: 'executed', ...assessment });
    admitted = assessment.safeToContinue;
    deps.log(results.at(-1));
  }
  save(path.join(output, 'summary.json'), results);
  const verification = await verifySaved(output);
  save(path.join(output, 'verification.json'), verification);
  deps.log({ output, ...verification });
  return verification;
}

if (process.argv[1] && path.resolve(process.argv[1]) === script) {
  try {
    const { values } = parseArgs({ options: { output: { type: 'string' }, binary: { type: 'string' },
      'build-directory': { type: 'string' }, 'verify-saved': { type: 'string' } } });
    if (values['verify-saved']) {
      const result = await verifySaved(path.resolve(values['verify-saved']), {
        buildDirectory: values['build-directory'] ? path.resolve(values['build-directory']) : undefined
      });
      console.log(JSON.stringify(result, null, 2));
      if (!result.pass) process.exitCode = 1;
    } else if (!(await runSchedule(values)).pass) process.exitCode = 1;
  } catch (error) { console.error(error.stack ?? String(error)); process.exitCode = 1; }
}
