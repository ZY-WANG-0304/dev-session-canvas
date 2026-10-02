import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { parseArgs } from 'node:util';
import esbuild from 'esbuild';

const { values } = parseArgs({ options: { output: { type: 'string' }, preflight: { type: 'boolean' },
  stage: { type: 'string' }, only: { type: 'string' } } });
const stage = values.stage ?? 's11';
assert.ok(stage === 's11' || stage === 's12', 'Only the frozen s11 and s12 business scenarios are supported');
assert.ok(values.only === undefined || (stage === 's12' && values.only === 'runtime-lifecycle'),
  'Only the unfinished s12 runtime-lifecycle scenario may be selected independently');
const scenarios = values.only ? [values.only] : stage === 's11'
  ? ['snapshot-normal', 'runtime-normal', 'paused-stop', 'isolation']
  : ['snapshot-deactivation', 'runtime-lifecycle'];
assert.equal(process.platform, 'linux');
assert.equal(process.arch, 'x64');
assert.equal(process.version, 'v25.6.0');
assert.ok(!process.env.NODE_OPTIONS && !process.env.NODE_PATH, 'Remove Node injection variables before the Linux business run');
assert.ok(values.output, 'Specify a new evidence directory with --output');
const root = process.cwd();
const outputDirectory = path.resolve(values.output);
const extensionRoot = path.resolve('extensions/vscode/dev-session-canvas');
const require = createRequire(import.meta.url);
const inputs = new Map();
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const json = (file, value) => fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

async function load(file, { mocks = {} } = {}) {
  const filename = path.resolve(file);
  const bundled = await esbuild.build({ entryPoints: [filename], bundle: true, write: false,
    format: 'cjs', platform: 'node', target: 'node25', metafile: true,
    external: ['vscode', 'node-pty', ...Object.keys(mocks)] });
  for (const input of Object.keys(bundled.metafile.inputs)) {
    inputs.set(input, digest(await fs.readFile(input)));
  }
  const module = { exports: {} };
  const guardedRequire = name => {
    if (Object.hasOwn(mocks, name)) return mocks[name];
    assert.ok(name !== 'node-pty' && !name.endsWith('.node'), 'The authority must not load native code');
    return require(name);
  };
  new Function('require', 'module', 'exports', '__filename', '__dirname', bundled.outputFiles[0].text)(
    guardedRequire, module, module.exports, filename, path.dirname(filename));
  return module.exports;
}

const factory = await load('extensions/vscode/dev-session-canvas/src/panel/linuxExecutionOwnerFactory.ts');
const assets = factory.resolveLinuxExecutionProviderAssets(path.join(extensionRoot, 'dist'));
const manifest = JSON.parse(await fs.readFile(path.join(path.dirname(assets.binaryPath), 'manifest.json')));
assert.equal(manifest.runtime.name, 'node');
assert.equal(manifest.libc.version, '2.35');
const fixturePrefix = stage === 's11' ? 'linux-business' : 'linux-lifecycle';
const subjectPath = path.resolve(`scripts/test/fixtures/${fixturePrefix}-subject.mjs`);
const files = ['scripts/test/test-linux-execution-business.mjs', `scripts/test/fixtures/${fixturePrefix}-subject.mjs`,
  `scripts/test/fixtures/${fixturePrefix}-host.mjs`,
  `scripts/test/fixtures/${fixturePrefix}-${stage === 's11' ? 'supervisor' : 'runtime'}.mjs`];
const fixedInputs = {};
for (const file of files) fixedInputs[file] = digest(await fs.readFile(file));
if (values.preflight) {
  console.log(JSON.stringify({ stage, scenarios, preflight: true, assets, manifest, fixedInputs,
    nativeLoaded: false, providerStarted: false }));
  process.exit(0);
}
await fs.mkdir(outputDirectory);
await fs.mkdir(path.join(outputDirectory, 'inputs'));
for (const file of files) await fs.copyFile(file, path.join(outputDirectory, 'inputs', path.basename(file)));
const subjectCopy = path.join(outputDirectory, 'inputs', path.basename(subjectPath));
const schedule = { stage, sourceCommit: stage === 's11' ? 'ae3c42cf' : '7b480cbd', executable: process.execPath, versions: process.versions,
  platform: process.platform, arch: process.arch, manifest, assets, fixedInputs,
  scenarios, partialSelection: values.only !== undefined,
  maximumSubjects: values.only ? 1 : stage === 's11' ? 5 : 2,
  caseBudgetMs: 45000, cleanupBudgetMs: 35000, subjectSafetyMs: 25000,
  boundary: stage === 's11'
    ? 'real Node authority/provider/PTY and disk; controlled VSCode services and reader connections; no UI/Electron/Agent'
    : 'real Node Host/Supervisor/client/Unix socket/provider/PTY and disk; controlled VSCode services; no Webview/Electron/Agent or OS Host exit' };
await json(path.join(outputDirectory, 'schedule.json'), schedule);
const runHostScenario = stage === 's11' ? (await import('./fixtures/linux-business-host.mjs')).runHostScenario
  : (await import('./fixtures/linux-lifecycle-host.mjs')).runHostLifecycleScenario;
const runSupervisorScenario = stage === 's11' ? (await import('./fixtures/linux-business-supervisor.mjs')).runSupervisorScenario
  : (await import('./fixtures/linux-lifecycle-runtime.mjs')).runRuntimeLifecycleScenario;
const results = [];

function contextFor(directory, maximumProviders) {
  const nonce = randomBytes(16).toString('hex');
  const probes = [];
  const executions = new Set();
  const owners = new Set();
  const cleanups = [];
  const began = performance.now();
  let sealed = false;
  let taskSettled = false;
  const assertAdmission = () => {
    if (sealed || performance.now() >= began + 45000) throw new Error(`${stage} scenario acquisition is closed`);
  };
  const until = async (condition, label, milliseconds = 8000) => {
    const deadline = Math.min(began + 45000, performance.now() + milliseconds);
    while (!condition()) {
      assertAdmission();
      if (performance.now() >= deadline) throw new Error(`${stage} observation deadline: ${label}`);
      await delay(5);
    }
  };
  const before = async (promise, label, milliseconds = 8000) => {
    let timer;
    try {
      return await Promise.race([promise, new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${stage} observation deadline: ${label}`)),
          Math.max(0, Math.min(began + 45000, performance.now() + milliseconds) - performance.now()));
      })]);
    } finally { clearTimeout(timer); }
  };
  const probeFor = execution => {
    const identity = execution.identity ?? execution;
    return probes.find(probe => probe.identity.executionId === identity.executionId);
  };
  function frames(probe) {
    if (!probe) return [];
    const bytes = Buffer.concat(probe.raw);
    let offset = 0;
    const result = [];
    while (offset + 4 <= bytes.length) {
      const length = bytes.readUInt32BE(offset);
      if (offset + 4 + length > bytes.length) break;
      result.push(JSON.parse(bytes.subarray(offset + 4, offset + 4 + length).toString('utf8')));
      offset += 4 + length;
    }
    return result;
  }
  const context = {
    directory, nonce, expectedHash: digest(nonce), subjectPath: subjectCopy, load, until, before,
    assertActive: assertAdmission,
    seal() { sealed = true; for (const owner of owners) owner.closeAdmission(true); },
    taskSettled() { taskSettled = true; },
    trackExecution(execution) { executions.add(execution); },
    trackOwner(owner) {
      owners.add(owner);
      if (sealed) owner.closeAdmission(true);
      assertAdmission();
    },
    addCleanup(fn, timeoutMs = 2000) { cleanups.push({ fn, timeoutMs }); },
    launchSpec(label) {
      assert.match(label, /^[a-z0-9-]+$/);
      return { file: process.execPath, args: [subjectCopy, path.join(directory, label)], cwd: directory,
        env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: directory, TERM: 'xterm-256color', LANG: 'C.UTF-8' },
        cols: 107, rows: 33 };
    },
    ownerOptions(mode) {
      assertAdmission();
      const options = factory.createLinuxExecutionOwnerOptions({ extensionRoot, mode });
      return { ...options, createTransport(identity) {
        assertAdmission();
        assert.ok(probes.length < maximumProviders, 'The fixed scenario provider limit cannot be exceeded');
        const transport = options.createTransport(identity);
        const probe = { identity, transport, controls: [], commands: [], raw: [], rawBytes: 0, incomplete: false };
        probes.push(probe);
        const connect = transport.connect.bind(transport);
        const send = transport.send.bind(transport);
        transport.connect = sink => {
          assertAdmission();
          connect({ ...sink,
          message(message) {
            if (probe.controls.length < 20000) probe.controls.push({ at: performance.now() - began, message });
            else probe.incomplete = true;
            sink.message(message);
          },
          data(bytes) {
            if (probe.rawBytes + bytes.length <= 8 * 1024 * 1024) {
              probe.raw.push(Buffer.from(bytes)); probe.rawBytes += bytes.length;
            } else probe.incomplete = true;
            sink.data(bytes);
          }
          });
        };
        transport.send = message => {
          if (probe.commands.length < 20000) probe.commands.push({ at: performance.now() - began, message });
          else probe.incomplete = true;
          return send(message);
        };
        return transport;
      } };
    },
    output(execution) { return frames(probeFor(execution)).map(frame => frame.text).join(''); },
    async verifyWritten(label, execution) {
      const written = await fs.readFile(path.join(directory, `${label}-written.bin`));
      const complete = JSON.parse(await fs.readFile(path.join(directory, `${label}-complete.json`), 'utf8'));
      assert.deepEqual(complete, { exitCode: 7, writtenComplete: true });
      const expected = written.toString('utf8').replace(/\n/g, '\r\n');
      assert.equal(context.output(execution), expected, 'PTY output must equal the successful subject writes under ONLCR');
      return { writtenBytes: written.length, ptyBytes: Buffer.byteLength(expected), sha256: digest(expected) };
    },
    assertScreen(tracker) {
      const terminal = tracker.terminal;
      const buffer = terminal.buffer.active;
      const rows = Array.from({ length: terminal.rows }, (_, i) => buffer.getLine(buffer.baseY + i)?.translateToString(true) ?? '');
      assert.equal(terminal.cols, 119); assert.equal(terminal.rows, 41);
      assert.equal(buffer.cursorX, 6); assert.equal(buffer.cursorY, 4);
      assert.equal(rows[0], 'ROOT'); assert.equal(rows[2], '    \u4e2d\u6587');
      assert.equal(buffer.getLine(buffer.baseY + 2).getCell(4).getFgColor(), 1);
      return { cols: terminal.cols, rows: terminal.rows, cursorX: buffer.cursorX, cursorY: buffer.cursorY, lines: rows };
    },
    evidence() {
      return probes.map(probe => ({ identity: probe.identity, controls: probe.controls, commands: probe.commands,
        transport: probe.transport.snapshot(), incomplete: probe.incomplete, frameCount: frames(probe).length,
        rawBytes: probe.rawBytes, stderr: probe.transport.stderr?.subarray(0, probe.transport.stderrBytes).toString('utf8') }));
    },
    async cleanup() {
      context.seal();
      const actions = [];
      const deadline = performance.now() + 35000;
      for (const cleanup of cleanups.reverse()) {
        let timer;
        try {
          await Promise.race([cleanup.fn(), new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error('Fixture cleanup observation timed out')),
              Math.max(0, Math.min(cleanup.timeoutMs, deadline - performance.now())));
          })]);
        }
        catch (error) { actions.push({ step: 'fixture-release', error: String(error) }); }
        finally { clearTimeout(timer); }
      }
      for (const owner of owners) for (const execution of owner.list()) executions.add(execution);
      for (const execution of executions) {
        if (!execution.snapshot().settled) {
          actions.push({ step: 'original-owner-stop', identity: execution.identity });
          void execution.requestStop(`${stage} failure cleanup`).catch(error => actions.push({ step: 'stop-error', error: String(error) }));
        }
      }
      while ((!taskSettled || probes.some(probe => !probe.transport.snapshot().closed)) && performance.now() < deadline) await delay(10);
      for (const owner of owners) for (const execution of owner.list()) executions.add(execution);
      const safe = taskSettled && !actions.some(action => action.error)
        && probes.every(probe => probe.transport.snapshot().closed) && [...executions].every(execution => {
        const snapshot = execution.snapshot().adapter;
        return !snapshot || (!snapshot.resourceLedgerIncomplete &&
          Object.values(snapshot.resources).every(resource => resource.current?.kind === 'released'));
      });
      return { safe, taskSettled, actions, executions: [...executions].map(execution => execution.snapshot()) };
    },
    async save() {
      for (let i = 0; i < probes.length; i++) {
        await fs.writeFile(path.join(directory, `provider-${i + 1}-frames.bin`), Buffer.concat(probes[i].raw), { flag: 'wx' });
        await fs.writeFile(path.join(directory, `provider-${i + 1}-output.txt`), context.output(probes[i].identity), { flag: 'wx' });
      }
      await json(path.join(directory, 'evidence.json'), { nonce, providers: context.evidence(),
        executions: [...executions].map(execution => execution.snapshot()) });
    }
  };
  return context;
}

for (const scenario of schedule.scenarios) {
  const directory = path.join(outputDirectory, scenario);
  await fs.mkdir(directory);
  const context = contextFor(directory, scenario === 'isolation' ? 2 : 1);
  let first;
  let cleanup;
  const evidenceErrors = [];
  try {
    const task = scenario === 'snapshot-normal' || scenario === 'snapshot-deactivation' ? runHostScenario(context)
      : runSupervisorScenario(context, scenario === 'runtime-normal' ? 'normal' : scenario);
    void task.then(() => context.taskSettled(), () => context.taskSettled());
    const value = await context.before(task, `whole ${scenario}`, 45000);
    first = { scenario, pass: true, value };
  } catch (error) {
    first = { scenario, pass: false, error: error.stack ?? String(error) };
  } finally {
    context.seal();
    first = structuredClone(first);
    cleanup = await context.cleanup();
  }
  try {
    await json(path.join(directory, 'first.json'), first);
    await json(path.join(directory, 'cleanup.json'), cleanup);
    await context.save();
  } catch (error) { evidenceErrors.push(`final evidence: ${error}`); }
  if (context.evidence().some(probe => probe.incomplete)) evidenceErrors.push('Fixed evidence capacity exceeded');
  const result = { ...first, pass: first.pass && evidenceErrors.length === 0, cleanupSafe: cleanup.safe, evidenceErrors };
  results.push(result);
  console.log(JSON.stringify(result));
  if (!result.pass || !cleanup.safe) break;
}
await json(path.join(outputDirectory, 'loaded-sources.json'), Object.fromEntries(inputs));
await json(path.join(outputDirectory, 'report.json'), { stage, scenarios, partialSelection: values.only !== undefined, results,
  pass: results.length === schedule.scenarios.length && results.every(result => result.pass && result.cleanupSafe),
  unattempted: schedule.scenarios.slice(results.length), nativeEvidence: true, uiElectronAgentEvidence: false });
if (results.length !== schedule.scenarios.length || results.some(result => !result.pass || !result.cleanupSafe)) process.exitCode = 1;
