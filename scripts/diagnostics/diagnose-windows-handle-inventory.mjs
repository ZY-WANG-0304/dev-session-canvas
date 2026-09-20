// Isolated inventory: the frozen lifecycle oracle and reader are unchanged.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const script = fileURLToPath(import.meta.url), sourceDir = path.dirname(script);
const originalName = 'diagnose-runtime-owned-lifecycle.mjs';
const workerName = 'runtime-owned-cancel-worker.mjs';
const observerName = 'windows-handle-inventory.c';
const expected = Object.freeze({
  [originalName]: '4c2e3decf149c120c06faa9fcb3f997aa6f6dc2990dcad7cedece7b622cfb09d',
  [workerName]: '8630eab630bb085c843e92467d578b59f3f4480cccef4c6b56e5b3a75ebc1489',
  'native-runtime-resources.c': 'fcd2cc8d55d8033b53c5e23e647e8ce7bb8b39f2c8931bcd50a302cb06b72adb',
});
const schedule = Array.from({ length: 2 }, (_, i) => ['control', 'native'].map(mode =>
  ({ id: `${mode}-${i + 1}`, kind: 'resources', mode, run: i + 1 }))).flat();
const settings = { runs: 3, warmup: 3, measured: 20, snapshots: 5, snapshotMs: 20,
  settleMs: 100, sampleMs: 30000, resourceGuardMs: 2000, cancelHardMs: 35000, batchHardMs: 150000,
  cols: 96, rows: 28, pollMs: 2 };
const replacements = [
  { name: 'resources-only-schedule', before: `  const entries = platform === 'win32' ? scenarios.flatMap(scenario => Array.from({ length: settings.runs }, (_, i) =>
    ({ id: \`\${scenario}-\${i + 1}\`, kind: 'cancel', scenario, run: i + 1 }))) : [];`, after: '  const entries = [];' },
  { name: 'inventory-observer-source', before: "const source = path.join(path.dirname(script), 'native-runtime-resources.c');",
    after: "const source = path.join(path.dirname(script), 'windows-handle-inventory.c');" },
];
const { values } = parseArgs({ options: { output: { type: 'string' }, 'verify-saved': { type: 'string' }, 'self-test': { type: 'boolean' } } });
try {
  if (values['self-test']) await selfTest();
  else if (values['verify-saved']) {
    const report = verifySaved(path.resolve(values['verify-saved']));
    console.log(JSON.stringify(report)); process.exitCode = report.pass ? 0 : 1;
  } else run();
} catch (error) { console.error(error.stack ?? error); process.exitCode = 1; }

function hash(value) { return createHash('sha256').update(value).digest('hex'); }
function lf(value) { return value.toString('utf8').replaceAll('\r\n', '\n'); }
function json(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function save(dir, name, value) { fs.writeFileSync(path.join(dir, name), `${JSON.stringify(value, null, 2)}\n`); }
function files(dir, prefix = '') {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const relative = path.posix.join(prefix, entry.name);
    assert(!entry.isSymbolicLink(), `Unexpected symlink ${relative}`);
    return entry.isDirectory() ? files(path.join(dir, entry.name), relative) : [relative];
  }).sort();
}
function manifest(dir) { return files(dir).filter(file => file !== 'manifest.json').map(file => ({ file, hash: hash(fs.readFileSync(path.join(dir, file))) })); }
function checkManifest(dir) {
  const saved = json(path.join(dir, 'manifest.json'));
  assert.deepEqual(saved, manifest(dir), `Manifest mismatch ${dir}`);
}
function transform(text) {
  assert.equal(hash(text), expected[originalName], 'Unknown frozen lifecycle source');
  for (const replacement of replacements) {
    assert.equal(text.split(replacement.before).length, 2, `Nonunique transform ${replacement.name}`);
    text = text.replace(replacement.before, replacement.after);
  }
  return text;
}
function diffText(original, modified) {
  const result = spawnSync('git', ['diff', '--no-index', '--no-ext-diff', '--text', '--', original, modified], { encoding: 'utf8', timeout: 10000 });
  assert.equal(result.status, 1, result.error?.message ?? result.stderr);
  return result.stdout;
}
function prepare(dir) {
  const generated = path.join(dir, 'generated'); fs.mkdirSync(generated);
  const originals = path.join(generated, 'original'); fs.mkdirSync(originals);
  for (const [name, digest] of Object.entries(expected)) {
    const bytes = fs.readFileSync(path.join(sourceDir, name));
    assert.equal(hash(lf(bytes)), digest, `Unknown source ${name}`);
    fs.writeFileSync(path.join(originals, name), bytes);
  }
  const original = lf(fs.readFileSync(path.join(originals, originalName)));
  const modified = transform(original);
  fs.writeFileSync(path.join(generated, originalName), modified);
  fs.copyFileSync(path.join(sourceDir, workerName), path.join(generated, workerName));
  fs.copyFileSync(path.join(sourceDir, observerName), path.join(generated, observerName));
  fs.copyFileSync(script, path.join(generated, 'inventory-wrapper-source.mjs'));
  fs.writeFileSync(path.join(generated, 'original-normalized.mjs'), original);
  fs.writeFileSync(path.join(generated, 'lifecycle.diff'), diffText(path.join(generated, 'original-normalized.mjs'), path.join(generated, originalName)));
  save(generated, 'transforms.json', { schema: 1, normalizedOriginalHash: hash(original), generatedHash: hash(modified),
    changes: replacements, note: 'Only schedule and observer source selection change; original worker bytes are preserved.' });
  save(generated, 'manifest.json', manifest(generated));
  return path.join(generated, originalName);
}
function verifyGenerated(dir) {
  const generated = path.join(dir, 'generated'); checkManifest(generated);
  for (const [name, digest] of Object.entries(expected))
    assert.equal(hash(lf(fs.readFileSync(path.join(generated, 'original', name)))), digest, `Unknown saved source ${name}`);
  const original = lf(fs.readFileSync(path.join(generated, 'original', originalName)));
  assert.equal(fs.readFileSync(path.join(generated, 'original-normalized.mjs'), 'utf8'), original);
  assert.equal(fs.readFileSync(path.join(generated, originalName), 'utf8'), transform(original));
  assert(fs.readFileSync(path.join(generated, workerName)).equals(fs.readFileSync(path.join(generated, 'original', workerName))), 'Worker changed');
  const record = json(path.join(generated, 'transforms.json'));
  assert.deepEqual(record.changes, replacements); assert.equal(record.generatedHash, hash(transform(original)));
  assert.equal(record.normalizedOriginalHash, expected[originalName]);
  return path.join(generated, originalName);
}
function execute(scriptPath, args, timeout, env = process.env) {
  const result = spawnSync(process.execPath, [scriptPath, ...args], { env, encoding: 'utf8', timeout, maxBuffer: 64 * 1024 * 1024 });
  return { command: [process.execPath, scriptPath, ...args], scriptHash: hash(fs.readFileSync(scriptPath)), status: result.status, signal: result.signal,
    stdout: result.stdout ?? '', stderr: result.stderr ?? '', error: result.error?.message };
}
function legacyReport(execution) {
  const lines = execution.stdout.trim().split(/\r?\n/);
  for (const line of lines.reverse()) {
    try { const value = JSON.parse(line); if (value.attempted !== undefined && Array.isArray(value.evidenceErrors)) return value; }
    catch { /* Non-JSON command output is retained verbatim in execution evidence. */ }
  }
  return null;
}
function slotKey(entry) { return [entry.slot, entry.typeIndex, entry.access, entry.attributes].join(':'); }
function strengthenedKey(entry) { return `${slotKey(entry)}:${entry.type}:${entry.process?.pid ?? ''}:${entry.process?.creationTime ?? ''}`; }
function validHex(value) { return typeof value === 'string' && /^0x[0-9a-f]+$/.test(value); }
function inventoryAssessment(sample) {
  const problems = [], inventory = sample?.inventory;
  if (!inventory || inventory.schema !== 1) return { status: 'inconclusive', problems: ['Missing inventory schema'], entries: [] };
  const before = inventory.before, after = inventory.after;
  const tables = [before, after];
  for (const [index, table] of tables.entries()) {
    if (!table || table.valid !== true || table.status !== '0x00000000' || !Array.isArray(table.entries) ||
        table.count !== table.entries.length || !Number.isSafeInteger(table.count) || table.count < 0) {
      problems.push(`Incomplete ${index === 0 ? 'before' : 'after'} table`); continue;
    }
    if (table.attempts < 1 || table.attempts > 8 || table.capacity > 16 * 1024 * 1024 || table.returnedBytes > table.capacity || table.returnedBytes < 16)
      problems.push(`Invalid query bounds in table ${index}`);
    const slots = new Set();
    for (const entry of table.entries) {
      if (!validHex(entry.slot) || slots.has(entry.slot) || ![entry.typeIndex, entry.access, entry.attributes].every(Number.isSafeInteger) ||
          !validHex(entry.handleCount) || !validHex(entry.pointerCount)) problems.push(`Malformed/repeated slot in table ${index}`);
      slots.add(entry.slot);
    }
  }
  const entries = Array.isArray(before?.entries) ? before.entries : [];
  for (const entry of entries) {
    if (entry.typeValid !== true || entry.typeStatus !== '0x00000000' || !entry.type || typeof entry.type !== 'string' ||
        !Number.isSafeInteger(entry.typeAttempts) || entry.typeAttempts < 1 || entry.typeAttempts > 8)
      problems.push(`Missing type ${entry.slot}`);
    if (entry.type === 'File' && !Number.isSafeInteger(entry.fileType)) problems.push(`Missing file kind ${entry.slot}`);
    if (entry.type === 'Process') {
      const owner = entry.process;
      if (!owner || !Number.isSafeInteger(owner.pid) || owner.pid <= 0 || !validHex(owner.creationTime) || !Number.isSafeInteger(owner.exitCode) ||
          typeof owner.imageApiAvailable !== 'boolean' || (owner.imageApiAvailable && (typeof owner.image !== 'string' || !owner.image)))
        problems.push(`Missing process identity ${entry.slot}`);
    }
  }
  const beforeKeys = entries.map(slotKey).sort();
  const afterKeys = Array.isArray(after?.entries) ? after.entries.map(slotKey).sort() : [];
  if (JSON.stringify(beforeKeys) !== JSON.stringify(afterKeys)) problems.push('Changed slot/type/access/attributes during observation');
  if (inventory.countBeforeValid !== true || inventory.countAfterValid !== true || inventory.handleCountBefore !== before?.count ||
      inventory.handleCountAfter !== after?.count || inventory.handleCountBefore !== inventory.handleCountAfter || sample.handles !== inventory.handleCountAfter)
    problems.push('Counter/table disagreement');
  if (!Array.isArray(inventory.errors) || inventory.errors.length) problems.push('Native query errors');
  if (inventory.observerRace !== false) problems.push('Native observer race');
  if (inventory.valid !== true) problems.push('Native observer marked inconclusive');
  if (JSON.stringify(sample.descriptors) !== JSON.stringify(entries)) problems.push('Descriptor/table disagreement');
  return { status: problems.length ? 'inconclusive' : 'valid', problems, entries };
}
function types(entries) {
  const counts = {};
  for (const entry of entries) counts[entry.type ?? '(unknown)'] = (counts[entry.type ?? '(unknown)'] ?? 0) + 1;
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}
function difference(previous, current) {
  const old = new Map(previous.map(entry => [entry.slot, entry])), next = new Map(current.map(entry => [entry.slot, entry]));
  const added = current.filter(entry => !old.has(entry.slot)), removed = previous.filter(entry => !next.has(entry.slot));
  const changed = current.filter(entry => old.has(entry.slot) && strengthenedKey(entry) !== strengthenedKey(old.get(entry.slot)))
    .map(entry => ({ before: old.get(entry.slot), after: entry }));
  const retainedSlots = current.filter(entry => old.has(entry.slot) && strengthenedKey(entry) === strengthenedKey(old.get(entry.slot))).map(entry => entry.slot);
  const a = types(previous), b = types(current);
  const typeDelta = Object.fromEntries([...new Set([...Object.keys(a), ...Object.keys(b)])].sort().map(type => [type, (b[type] ?? 0) - (a[type] ?? 0)]));
  return { typeDelta, added, removed, changed, retainedSlots,
    note: 'Retention refers to observed slots and available attributes, not proven kernel object identity; same-type File reuse can be invisible.' };
}
function countsAssessment(counts) {
  const issues = [], windows = [];
  if (!Array.isArray(counts)) return { status: 'inconclusive', issues: ['Missing counts'], windows };
  if (counts.length !== 21) issues.push('Incomplete 21-window schedule');
  let previous = [];
  for (const [offset, window] of counts.entries()) {
    const problems = [];
    if (window.index !== offset + 2 || !Array.isArray(window.samples) || window.samples.length !== 5) problems.push('Incomplete window');
    const observations = (window.samples ?? []).map(sample => inventoryAssessment(sample.native));
    for (const [i, observation] of observations.entries()) if (observation.status !== 'valid') problems.push({ sample: i, reasons: observation.problems });
    const entries = observations[0]?.entries ?? [];
    const keys = JSON.stringify(entries.map(strengthenedKey).sort());
    const stable = observations.length === 5 && observations.every(item => JSON.stringify(item.entries.map(strengthenedKey).sort()) === keys);
    if (!stable) problems.push('Slot/strengthened identity differs inside window');
    windows.push({ index: window.index, status: problems.length ? 'inconclusive' : 'valid', problems,
      typeCounts: types(entries), snapshotTimes: (window.samples ?? []).map(sample => sample.ns),
      change: offset ? difference(previous, entries) : null, baselineEntries: offset ? undefined : entries });
    previous = entries;
  }
  if (windows.some(window => window.status !== 'valid')) issues.push('At least one window is inconclusive');
  return { status: issues.length ? 'inconclusive' : 'valid', issues, windows };
}
function inspectDrivers(evidence) {
  const result = { attempted: 0, verified: 0, inconclusive: [], evidenceErrors: [], drivers: [] };
  for (const entry of schedule) {
    result.attempted++;
    try {
      const dir = path.join(evidence, entry.id); checkManifest(dir);
      const config = json(path.join(dir, 'config.json'));
      for (const [key, value] of Object.entries(entry)) assert.equal(config[key], value);
      assert.equal(config.platform, 'win32');
      const counts = json(path.join(dir, 'counts.json'));
      const report = countsAssessment(counts);
      result.drivers.push({ id: entry.id, ...report }); result.verified++;
      if (report.status !== 'valid') result.inconclusive.push(entry.id);
    } catch (error) { result.evidenceErrors.push({ id: entry.id, error: String(error) }); }
  }
  result.status = result.verified === 4 && !result.inconclusive.length && !result.evidenceErrors.length ? 'valid' : 'inconclusive';
  return result;
}
function summarizeCandidate(inventory, overallStatus = inventory.status) {
  const controls = inventory.drivers.filter(driver => driver.id.startsWith('control'));
  const native = inventory.drivers.filter(driver => driver.id.startsWith('native'));
  const controlsStable = controls.length === 2 && controls.every(driver => driver.status === 'valid' && driver.windows.slice(1).every(window =>
    window.change.added.length === 0 && window.change.removed.length === 0 && window.change.changed.length === 0));
  const nativePairs = native.length === 2 && native.every(driver => driver.status === 'valid' && driver.windows.slice(1).every(window => {
    const change = window.change;
    return change.added.length === 2 && !change.removed.length && !change.changed.length &&
      change.added.filter(entry => entry.type === 'File' && entry.fileType === 3).length === 1 &&
      change.added.filter(entry => entry.type === 'Process' && /(?:^|[\\/])OpenConsole\.exe$/i.test(entry.process?.image ?? '')).length === 1;
  }));
  return { controlsStable, nativeFileOpenConsolePairs: nativePairs,
    candidateSupport: overallStatus === 'valid' && inventory.status === 'valid' && controlsStable && nativePairs,
    conclusion: 'Read-only supporting evidence only; no HPCON release intervention or stable anonymous File object identity is established.' };
}
function observerCompilationInput(compilation) {
  const sources = compilation.sources.filter(item => item.snapshot === `compiled/${observerName}`);
  assert.equal(sources.length, 1, 'Inventory C absent or repeated in compilation inputs');
  return sources[0];
}
function validateExecution(execution, derived, legacy) {
  assert(execution && !execution.error && !execution.signal, 'Missing/interrupted collection execution');
  assert(Array.isArray(execution.command) && execution.command.length === 4 && execution.command[2] === '--output', 'Unexpected collection command');
  assert.equal(execution.scriptHash, hash(fs.readFileSync(derived)), 'Collection script hash mismatch');
  const recorded = legacyReport(execution);
  assert(recorded, 'Collection did not complete its frozen verifier');
  assert.equal(execution.status, recorded.pass ? 0 : 1, 'Collection exit does not match frozen verdict');
  assert.deepEqual(recorded, legacy, 'Collection and offline frozen-verifier verdicts differ');
}
function verifySaved(dir) {
  const globalErrors = [];
  let derived, legacyExecution, legacy;
  try { derived = verifyGenerated(dir); } catch (error) { globalErrors.push(String(error)); }
  const evidence = path.join(dir, 'evidence');
  try {
    const recorded = json(path.join(evidence, 'schedule.json'));
    assert.equal(recorded.platform, 'win32'); assert.deepEqual(recorded.entries, schedule); assert.deepEqual(recorded.settings, settings);
    const compilation = json(path.join(evidence, 'compilation.json'));
    const observedSource = observerCompilationInput(compilation);
    assert.equal(hash(fs.readFileSync(path.join(evidence, observedSource.snapshot))), hash(fs.readFileSync(path.join(dir, 'generated', observerName))));
    const environment = json(path.join(evidence, 'environment.json'));
    assert.equal(environment.platform, 'win32'); assert.equal(environment.nodePty, '1.2.0-beta.12');
    assert.equal(environment.versions.node, '22.23.2'); assert.equal(compilation.headerVersion, environment.versions.node);
    const dll = environment.sources.filter(item => item.snapshot.endsWith('-conpty.dll'));
    assert.equal(dll.length, 1, 'Missing/repeated frozen ConPTY DLL');
    assert.equal(dll[0].hash, '3319b484b80bb53d1f4d0a9eb0ea60fd0f61da69db7280ca43b84215f19245ff');
  } catch (error) { globalErrors.push(String(error)); }
  if (derived) {
    legacyExecution = execute(derived, ['--verify-saved', evidence], 120000);
    legacy = legacyReport(legacyExecution);
    if (!legacy || legacy.attempted !== 4 || legacy.verified !== 4 || legacy.evidenceErrors.length || legacyExecution.error ||
        legacyExecution.status !== (legacy.pass ? 0 : 1)) globalErrors.push('Frozen lifecycle verifier incomplete or invalid');
    try { validateExecution(json(path.join(dir, 'execution.json')), derived, legacy); }
    catch (error) { globalErrors.push(String(error)); }
  }
  const inventory = inspectDrivers(evidence);
  const status = !globalErrors.length && inventory.status === 'valid' ? 'valid' : 'inconclusive';
  return { schema: 1, status, pass: status === 'valid' && legacy?.pass === true, globalErrors,
    legacy, legacyExecution, inventory, candidate: summarizeCandidate(inventory, status),
    note: 'Legacy resource failures remain failures. Valid inventory is not product acceptance and does not close a resource leak.' };
}
function run() {
  assert.equal(process.platform, 'win32', 'Native inventory requires Windows');
  assert(values.output, 'Use --output with a new evidence directory');
  const dir = path.resolve(values.output); assert(!fs.existsSync(dir), 'Refusing to overwrite evidence'); fs.mkdirSync(dir, { recursive: true });
  const derived = prepare(dir), evidence = path.join(dir, 'evidence');
  const execution = execute(derived, ['--output', evidence], 660000); save(dir, 'execution.json', execution);
  const report = verifySaved(dir); save(dir, 'inventory-report.json', report);
  console.log(JSON.stringify({ status: report.status, pass: report.pass, legacy: report.legacy,
    inventory: { attempted: report.inventory.attempted, verified: report.inventory.verified, inconclusive: report.inventory.inconclusive,
      evidenceErrors: report.inventory.evidenceErrors }, candidate: report.candidate, globalErrors: report.globalErrors }));
  process.exitCode = report.pass ? 0 : 1;
}
function syntheticEntry(slot, type = 'File') {
  return { slot: `0x${slot.toString(16)}`, typeIndex: type === 'Process' ? 7 : 1, access: 1, attributes: 0,
    handleCount: '0x1', pointerCount: '0x2', type, typeStatus: '0x00000000', typeValid: true, typeAttempts: 1,
    typeReturnedBytes: 128, ...(type === 'File' ? { fileType: 1 } : { process: { pid: slot, creationTime: `0x${slot.toString(16)}`,
      exitCode: 0, imageApiAvailable: true, image: 'C:\\fixture\\OpenConsole.exe' } }) };
}
function syntheticObservation(entries) {
  const table = { valid: true, status: '0x00000000', attempts: 1, capacity: 65536, returnedBytes: 16 + entries.length * 40,
    count: entries.length, entries: structuredClone(entries) };
  return { pid: 10, threads: 1, handles: entries.length, descriptors: structuredClone(entries), inventory: { schema: 1,
    handleCountBefore: entries.length, handleCountAfter: entries.length, countBeforeValid: true, countAfterValid: true,
    before: table, after: structuredClone(table), errors: [], observerRace: false, valid: true } };
}
function syntheticCounts(growth = false) {
  return Array.from({ length: 21 }, (_, i) => {
    const entries = [syntheticEntry(4)];
    if (growth) for (let k = 0; k < i; k++) entries.push({ ...syntheticEntry(100 + k * 2), fileType: 3 }, syntheticEntry(101 + k * 2, 'Process'));
    return { index: i + 2, samples: Array.from({ length: 5 }, (_, j) => ({ ns: `${i * 10 + j}`, native: syntheticObservation(entries) })) };
  });
}
async function selfTest() {
  const dir = process.env.DSC_ATTRIBUTION_SELFTEST_EVIDENCE ? path.resolve(process.env.DSC_ATTRIBUTION_SELFTEST_EVIDENCE) :
    fs.mkdtempSync(path.join(os.tmpdir(), 'dsc-inventory-selftest-'));
  if (fs.existsSync(dir)) assert.equal(fs.readdirSync(dir).length, 0, 'Refusing to overwrite self-test evidence');
  else fs.mkdirSync(dir, { recursive: true });
  const derived = prepare(dir); verifyGenerated(dir);
  assert.throws(() => transform(`${lf(fs.readFileSync(path.join(sourceDir, originalName)))}\n`));
  const windowsInput = { file: `D:\\a\\repo\\generated\\${observerName}`, snapshot: `compiled/${observerName}` };
  assert.deepEqual(observerCompilationInput({ sources: [windowsInput] }), windowsInput);
  assert.throws(() => observerCompilationInput({ sources: [{ ...windowsInput, snapshot: 'compiled/other.c' }] }));
  assert.throws(() => observerCompilationInput({ sources: [windowsInput, windowsInput] }));
  const valid = syntheticObservation([syntheticEntry(4), syntheticEntry(8, 'Process')]);
  assert.equal(inventoryAssessment(valid).status, 'valid');
  const mutations = {
    'observer-race': value => { value.inventory.observerRace = true; },
    'query-error': value => { value.inventory.errors.push({ api: 'NtQueryObject', win32: 6 }); },
    'missing-type': value => { delete value.inventory.before.entries[0].type; },
    'changed-slot': value => { value.inventory.after.entries[0].slot = '0x100'; },
    'same-count-different-object-type': value => { value.inventory.after.entries[0].typeIndex++; },
    'counter-mismatch': value => { value.handles++; },
    'missing-process-time': value => { delete value.inventory.before.entries[1].process.creationTime; },
    'duplicate-slot': value => { value.inventory.before.entries[1].slot = '0x4'; },
    'missing-snapshot': value => { delete value.inventory.after; },
  };
  const negatives = {};
  for (const [name, mutate] of Object.entries(mutations)) {
    const value = structuredClone(valid); mutate(value);
    negatives[name] = inventoryAssessment(value); assert.equal(negatives[name].status, 'inconclusive', name);
  }
  assert.equal(countsAssessment(syntheticCounts()).status, 'valid');
  assert.equal(countsAssessment(syntheticCounts(true)).status, 'valid');
  assert.equal(countsAssessment(syntheticCounts().slice(1)).status, 'inconclusive');
  const reused = difference([syntheticEntry(8, 'Process')], [{ ...syntheticEntry(8, 'Process'), process: { ...syntheticEntry(8, 'Process').process, creationTime: '0x999' } }]);
  assert.equal(reused.changed.length, 1); assert.equal(reused.retainedSlots.length, 0);
  const sampleRoot = path.join(dir, 'synthetic-inventory'); fs.mkdirSync(sampleRoot);
  for (const entry of schedule) {
    const target = path.join(sampleRoot, entry.id); fs.mkdirSync(target);
    save(target, 'config.json', { ...entry, platform: 'win32' });
    save(target, 'counts.json', syntheticCounts(entry.mode === 'native')); save(target, 'manifest.json', manifest(target));
  }
  const complete = inspectDrivers(sampleRoot); assert.equal(complete.status, 'valid'); assert(summarizeCandidate(complete).candidateSupport);
  assert(!summarizeCandidate(complete, 'inconclusive').candidateSupport);
  fs.appendFileSync(path.join(sampleRoot, schedule[0].id, 'counts.json'), 'corrupt');
  const corrupt = inspectDrivers(sampleRoot);
  assert.equal(corrupt.attempted, 4); assert.equal(corrupt.verified, 3); assert.equal(corrupt.evidenceErrors.length, 1);
  assert.equal(corrupt.drivers.at(-1).id, 'native-2');
  const failuresDir = path.join(dir, 'synthetic-lifecycle-failures'); fs.mkdirSync(failuresDir);
  save(failuresDir, 'schedule.json', { platform: 'win32', settings, entries: schedule });
  save(failuresDir, 'environment.json', { synthetic: true, sources: [] }); save(failuresDir, 'compilation.json', { synthetic: true, sources: [] });
  for (const entry of schedule) {
    const target = path.join(failuresDir, entry.id); fs.mkdirSync(target);
    save(target, 'config.json', { ...entry, platform: 'win32' });
    save(target, 'assessment.json', { pass: false, lifecycle: false, sameProcess: true, sessions: [], resources: { pass: false, reason: 'Incomplete resource schedule' } });
    save(target, 'manifest.json', manifest(target));
  }
  const oldFailuresExecution = execute(derived, ['--verify-saved', failuresDir], 30000), oldFailures = legacyReport(oldFailuresExecution);
  assert.equal(oldFailuresExecution.status, 1); assert.equal(oldFailures?.attempted, 4); assert.equal(oldFailures.verified, 4);
  assert.equal(oldFailures.failures.length, 4); assert.equal(oldFailures.evidenceErrors.length, 0);
  const collection = { ...oldFailuresExecution, command: [process.execPath, derived, '--output', failuresDir] };
  validateExecution(collection, derived, oldFailures);
  assert.throws(() => validateExecution(null, derived, oldFailures));
  assert.throws(() => validateExecution({ ...collection, error: 'outer watchdog' }, derived, oldFailures));
  assert.throws(() => validateExecution({ ...collection, signal: 'SIGTERM' }, derived, oldFailures));
  assert.throws(() => validateExecution({ ...collection, status: 0 }, derived, oldFailures));
  assert.throws(() => validateExecution({ ...collection, scriptHash: 'other' }, derived, oldFailures));
  fs.appendFileSync(path.join(failuresDir, schedule[0].id, 'config.json'), 'corrupt');
  const oldCorruptExecution = execute(derived, ['--verify-saved', failuresDir], 30000), oldCorrupt = legacyReport(oldCorruptExecution);
  assert.equal(oldCorruptExecution.status, 1); assert.equal(oldCorrupt?.attempted, 4); assert.equal(oldCorrupt.verified, 3);
  assert.equal(oldCorrupt.evidenceErrors.length, 1); assert.equal(oldCorrupt.failures.at(-1).id, 'native-2');
  save(dir, 'selftest-results.json', { negatives, reused, complete, corrupt, oldFailuresExecution, oldCorruptExecution,
    scope: 'Synthetic inventory and frozen-verifier tests; no native PTY execution.' });
  if (process.platform === 'win32') {
    const oldSelftest = path.join(dir, 'native-counter-selftest');
    const execution = execute(derived, ['--self-test'], 120000, { ...process.env, DSC_OWNED_SELFTEST_EVIDENCE: oldSelftest });
    save(dir, 'native-selftest-execution.json', execution); assert.equal(execution.status, 0, execution.stderr);
    const counter = json(path.join(oldSelftest, 'counter-control.json'));
    for (const sample of Object.values(counter)) assert.equal(inventoryAssessment(sample).status, 'valid');
    const opened = difference(counter.before.descriptors, counter.during.descriptors);
    const closed = difference(counter.during.descriptors, counter.after.descriptors);
    assert.equal(opened.added.length, 3); assert.equal(opened.removed.length, 0); assert.equal(opened.changed.length, 0);
    assert(opened.added.every(entry => entry.type === 'File' && entry.fileType === 1));
    assert.equal(closed.removed.length, 3); assert.equal(closed.added.length, 0); assert.equal(closed.changed.length, 0);
    assert.deepEqual(closed.removed.map(entry => entry.slot).sort(), opened.added.map(entry => entry.slot).sort());
    save(dir, 'file-type-control.json', { opened, closed });
  }
  console.log(`Inventory self-tests passed: ${dir}; no PTY sessions or resource-release intervention.`);
}
