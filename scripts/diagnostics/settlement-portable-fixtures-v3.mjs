import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const ENTRY = fileURLToPath(import.meta.url);
const json = value => `${JSON.stringify(value, null, 2)}\n`;
const hash = value => createHash('sha256').update(value).digest('hex');
export const PORTABLE_PROFILES = Object.freeze([
  { id: 'linux-lf', platform: 'linux', outputDirectory: '/diagnostic-fixtures/linux', sourceLineEndings: 'lf', linkTargetForm: 'plain' },
  { id: 'darwin-lf', platform: 'darwin', outputDirectory: '/diagnostic-fixtures/darwin', sourceLineEndings: 'lf', linkTargetForm: 'plain' },
  { id: 'win-drive-lf', platform: 'win32', outputDirectory: 'C:\\diagnostic-fixtures\\drive', sourceLineEndings: 'lf', linkTargetForm: 'plain' },
  { id: 'win-drive-crlf', platform: 'win32', outputDirectory: 'D:\\diagnostic-fixtures\\drive-crlf', sourceLineEndings: 'crlf', linkTargetForm: 'extended' },
  { id: 'win-unc-lf', platform: 'win32', outputDirectory: '\\\\fixture-host\\fixture-share\\diagnostic-fixtures', sourceLineEndings: 'lf', linkTargetForm: 'plain' },
  { id: 'win-unc-crlf', platform: 'win32', outputDirectory: '\\\\fixture-host\\fixture-share\\diagnostic-crlf', sourceLineEndings: 'crlf', linkTargetForm: 'extended' },
].map(Object.freeze));

export function producerPathStyle(platform) {
  assert(['linux', 'darwin', 'win32'].includes(platform), 'unsupported producer platform');
  return platform === 'win32' ? 'win32' : 'posix';
}

export function validateProducerPath(value, platform, label = 'producer path') {
  const style = producerPathStyle(platform), paths = path[style];
  assert(typeof value === 'string' && value.length > 0 && value.length <= 32768 && !/[\u0000-\u001f]/.test(value), `${label} is invalid`);
  if (style === 'win32') {
    assert(!/^\\\\[?.]\\/.test(value) && !/^\\\?\?\\/.test(value), `${label} uses an unsupported namespace`);
    assert(/^[A-Za-z]:\\/.test(value) || /^\\\\[^\\/]+\\[^\\/]+(?:\\|$)/.test(value), `${label} is not fully qualified`);
    assert(!value.includes('/'), `${label} mixes producer separators`);
  } else assert(value.startsWith('/') && !value.startsWith('//'), `${label} is not a POSIX absolute path`);
  assert.equal(paths.normalize(value), value, `${label} contains noncanonical components`);
  assert(!value.split(style === 'win32' ? '\\' : '/').some(component => component === '.' || component === '..'), `${label} contains dot components`);
  return value;
}

export function recordedLinkIdentity(rawTarget, platform) {
  assert(typeof rawTarget === 'string', 'recorded link target is not text');
  let value = rawTarget;
  if (platform === 'win32' && value.startsWith('\\\\?\\UNC\\')) value = `\\\\${value.slice(8)}`;
  else if (platform === 'win32' && /^\\\\\?\\[A-Za-z]:\\/.test(value)) value = value.slice(4);
  return validateProducerPath(value, platform, 'recorded link target');
}

export function assertRecordedLinkTarget(rawTarget, expectedTarget, platform) {
  assert.equal(recordedLinkIdentity(rawTarget, platform), validateProducerPath(expectedTarget, platform, 'expected link target'), 'recorded link target differs from fixture identity');
}

export function syntheticLinkTarget(target, platform, form) {
  validateProducerPath(target, platform, 'synthetic link target');
  assert(['plain', 'extended'].includes(form), 'unknown synthetic link form');
  if (form === 'plain') return target;
  assert.equal(platform, 'win32', 'extended link targets require a Windows producer');
  return target.startsWith('\\\\') ? `\\\\?\\UNC\\${target.slice(2)}` : `\\\\?\\${target}`;
}

export function profileSourceBytes(bytes, style) {
  assert(['lf', 'crlf'].includes(style), 'unknown synthetic source line endings');
  const lf = bytes.toString('utf8').replace(/\r\n/g, '\n');
  return Buffer.from(style === 'crlf' ? lf.replace(/\n/g, '\r\n') : lf);
}

export function portableProfile(id) {
  const profile = PORTABLE_PROFILES.find(value => value.id === id);
  assert(profile, 'unknown portable producer profile');
  return profile;
}

const PATH_CASES = Object.freeze([
  ['posix-absolute', 'linux', '/diagnostic/fixture', true],
  ['darwin-absolute', 'darwin', '/diagnostic/fixture', true],
  ['drive-absolute', 'win32', 'C:\\diagnostic\\fixture', true],
  ['unc-absolute', 'win32', '\\\\server\\share\\fixture', true],
  ['drive-relative', 'win32', 'C:fixture', false],
  ['root-relative', 'win32', '\\fixture', false],
  ['device-namespace', 'win32', '\\\\?\\C:\\fixture', false],
  ['mixed-separators', 'win32', 'C:/fixture', false],
  ['foreign-drive', 'linux', 'C:\\fixture', false],
  ['drive-dotdot', 'win32', 'C:\\fixture\\..\\outside', false],
  ['posix-dotdot', 'linux', '/fixture/../outside', false],
]);

const LINK_CASES = Object.freeze([
  ['drive-plain', 'C:\\fixture\\target', 'C:\\fixture\\target', true],
  ['drive-extended', '\\\\?\\C:\\fixture\\target', 'C:\\fixture\\target', true],
  ['unc-extended', '\\\\?\\UNC\\server\\share\\target', '\\\\server\\share\\target', true],
  ['wrong-drive', 'D:\\fixture\\target', 'C:\\fixture\\target', false],
  ['wrong-share', '\\\\server\\other\\target', '\\\\server\\share\\target', false],
  ['wrong-target', 'C:\\fixture\\target-other', 'C:\\fixture\\target', false],
  ['case-folded-target', 'c:\\fixture\\target', 'C:\\fixture\\target', false],
  ['unknown-namespace', '\\\\.\\C:\\fixture\\target', 'C:\\fixture\\target', false],
  ['target-dotdot', 'C:\\fixture\\..\\target', 'C:\\target', false],
]);

const CORE_GATES = Object.freeze([
  ['posix', 'posix', '/fixture/entry.mjs', '/fixture/artifacts', null, true],
  ['drive', 'win32', 'C:\\fixture\\entry.mjs', 'C:\\fixture\\artifacts', null, true],
  ['unc', 'win32', '\\\\server\\share\\entry.mjs', '\\\\server\\share\\artifacts', null, true],
  ['missing-clock', 'posix', '/fixture/entry.mjs', '/fixture/artifacts', 'clock', false],
  ['missing-transport', 'posix', '/fixture/entry.mjs', '/fixture/artifacts', 'spawnRole', false],
  ['unknown-style', 'unknown', '/fixture/entry.mjs', '/fixture/artifacts', null, false],
  ['drive-relative', 'win32', 'C:entry.mjs', 'C:\\fixture\\artifacts', null, false],
  ['root-relative', 'win32', '\\entry.mjs', 'C:\\fixture\\artifacts', null, false],
  ['namespace', 'win32', '\\\\?\\C:\\entry.mjs', 'C:\\fixture\\artifacts', null, false],
  ['win-path-posix-style', 'posix', 'C:\\fixture\\entry.mjs', 'C:\\fixture\\artifacts', null, false],
  ['posix-path-win-style', 'win32', '/fixture/entry.mjs', '/fixture/artifacts', null, false],
  ['relative-artifact', 'win32', 'C:\\fixture\\entry.mjs', 'C:artifacts', null, false],
  ['inherited-style-ignored', null, '/fixture/entry.mjs', '/fixture/artifacts', 'inherited', true],
]);

const SAVED_NEGATIVES = Object.freeze([
  ['producer-platform', 'win-drive-lf', 'shared-input'],
  ['producer-drive-relative', 'win-drive-lf', 'shared-input'],
  ['producer-root-relative', 'win-drive-lf', 'shared-input'],
  ['producer-namespace', 'win-drive-lf', 'shared-input'],
  ['producer-dotdot', 'win-drive-lf', 'shared-input'],
  ['request-cross-root', 'win-drive-lf', 'files-self-test'],
  ['publication-cross-root', 'win-drive-lf', 'archives-self-test'],
  ['link-wrong-drive', 'win-drive-lf', 'files-self-test'],
  ['link-wrong-share', 'win-unc-lf', 'files-self-test'],
  ['link-unknown-namespace', 'win-drive-lf', 'files-self-test'],
  ['link-dotdot', 'win-drive-lf', 'files-self-test'],
  ['link-became-file', 'win-drive-lf', 'files-self-test'],
  ['raw-link-without-rehash', 'win-drive-lf', 'shared-manifest'],
  ['link-wrong-dialect', 'win-drive-lf', 'files-self-test'],
  ['request-input-bytes', 'win-drive-lf', 'archives-self-test'],
  ['payload-root-injection', 'win-drive-lf', 'archives-self-test'],
  ['link-form-class-swap', 'win-drive-crlf', 'files-self-test'],
]);

function save(directory, file, value) {
  fs.writeFileSync(path.join(directory, file), json(value), { flag: 'wx' });
}

function read(directory, file) {
  return JSON.parse(fs.readFileSync(path.join(directory, file), 'utf8'));
}

function changeJSON(directory, file, mutate) {
  const value = read(directory, file); mutate(value);
  fs.writeFileSync(path.join(directory, file), json(value));
}

function rehashManifest(directory) {
  changeJSON(directory, 'manifest.json', manifest => {
    for (const member of manifest.entries) {
      const target = path.join(directory, member.path), stat = fs.lstatSync(target);
      if (stat.isSymbolicLink()) {
        for (const key of Object.keys(member)) if (!['path', 'type'].includes(key)) delete member[key];
        member.type = 'symlink'; member.target = fs.readlinkSync(target);
      } else {
        assert(stat.isFile(), 'negative fixture introduced an unsupported member');
        const bytes = fs.readFileSync(target);
        delete member.target; member.type = 'file'; member.bytes = bytes.length; member.sha256 = hash(bytes);
      }
    }
  });
}

function copyArchive(source, target) {
  fs.cpSync(source, target, { recursive: true, errorOnExist: true, verbatimSymlinks: true, mode: fs.constants.COPYFILE_FICLONE });
}

function mutateSaved(id, directory) {
  const link = path.join(directory, 'file-fixtures', 'symlink', 'payload.json');
  const replaceLink = target => { fs.unlinkSync(link); fs.symlinkSync(target, link, 'file'); };
  if (id === 'producer-platform') changeJSON(directory, 'run.json', value => { value.platform = 'linux'; });
  else if (id === 'producer-drive-relative') changeJSON(directory, 'run.json', value => { value.outputDirectory = 'C:relative'; });
  else if (id === 'producer-root-relative') changeJSON(directory, 'run.json', value => { value.outputDirectory = '\\relative'; });
  else if (id === 'producer-namespace') changeJSON(directory, 'run.json', value => { value.outputDirectory = `\\\\?\\${value.outputDirectory}`; });
  else if (id === 'producer-dotdot') changeJSON(directory, 'run.json', value => { value.outputDirectory += '\\..\\outside'; });
  else if (id === 'request-cross-root') changeJSON(directory, 'files-tests.json', value => { value.cases[0].request.artifactDirectory = 'D:\\foreign\\normal'; });
  else if (id === 'publication-cross-root') changeJSON(directory, 'archives-tests.json', value => {
    value.cases.find(item => item.id === 'publisher-preflight-binding').input.outer.publicationSnapshot.spec.artifactDirectory = 'D:\\foreign\\publication';
  });
  else if (id === 'link-wrong-drive' || id === 'raw-link-without-rehash') replaceLink(fs.readlinkSync(link).replace(/^C:/, 'D:'));
  else if (id === 'link-wrong-share') replaceLink(fs.readlinkSync(link).replace('fixture-share', 'foreign-share'));
  else if (id === 'link-unknown-namespace') replaceLink(`\\\\.\\${fs.readlinkSync(link)}`);
  else if (id === 'link-dotdot') replaceLink(`${fs.readlinkSync(link)}\\..\\outside`);
  else if (id === 'link-became-file') { const raw = fs.readlinkSync(link); fs.unlinkSync(link); fs.writeFileSync(link, raw, { flag: 'wx' }); }
  else if (id === 'link-wrong-dialect') replaceLink('/diagnostic-fixtures/foreign');
  else if (id === 'request-input-bytes') {
    const traversal = path.join(directory, 'archive-fixtures', 'traversal');
    changeJSON(traversal, 'outer/D3v3-P4.json', value => {
      value.publicationSnapshot.trace.find(fact => fact.event === 'spawn-request').details.inputBytes += 1;
      value.finalPublicationSnapshot.trace.find(fact => fact.event === 'spawn-request').details.inputBytes += 1;
    });
    rehashManifest(traversal);
  } else if (id === 'payload-root-injection') changeJSON(directory, 'archives-tests.json', value => {
    const fixture = value.cases.find(item => item.id === 'publisher-preflight-binding');
    fixture.actual.result.payloadBase64 += fixture.input.run.outputDirectory;
  });
  else if (id === 'link-form-class-swap') replaceLink(recordedLinkIdentity(fs.readlinkSync(link), 'win32'));
  else throw new Error(`unknown saved negative: ${id}`);
  if (id !== 'raw-link-without-rehash') rehashManifest(directory);
}

async function runPortableGates() {
  const core = await import('./diagnostic-settlement-v3.mjs');
  const { VirtualClock } = await import('./settlement-fixtures-v3.mjs');
  const cases = [];
  const check = (id, expectedAccepted, invoke) => {
    let accepted = true, error = null;
    try { invoke(); } catch (failure) { accepted = false; error = String(failure.message); }
    cases.push({ id, expectedAccepted, accepted, error, pass: accepted === expectedAccepted });
  };
  for (const [id, platform, value, expected] of PATH_CASES) check(`path-${id}`, expected, () => validateProducerPath(value, platform));
  for (const [id, actual, expectedTarget, expected] of LINK_CASES) check(`link-${id}`, expected, () => assertRecordedLinkTarget(actual, expectedTarget, 'win32'));
  for (const entry of ['startObservedCase', 'startPublication']) for (const [id, style, entryPath, artifactDirectory, omitted, expected] of CORE_GATES) {
    check(`${entry}-${id}`, expected, () => {
      const clock = new VirtualClock();
      let transportCalls = 0, inheritedReads = 0;
      const dependencies = { clock, spawnRole: () => { transportCalls += 1; throw new Error('validation-only fixture transport must never be scheduled'); }, pathStyle: style };
      if (omitted === 'clock' || omitted === 'spawnRole') delete dependencies[omitted];
      if (omitted === 'inherited') {
        delete dependencies.pathStyle;
        Object.setPrototypeOf(dependencies, Object.defineProperty({}, 'pathStyle', { get() { inheritedReads += 1; throw new Error('inherited style must not be read'); } }));
      }
      const spec = { id: { schema: 'diagnostic-settlement-v3', runId: 'portable-core-gates', caseId: `${entry}-${id}`, generation: 1, nonce: `portable-${entry}-${id}` },
        scenario: 'synthetic-portable-validation', entryPath, artifactDirectory };
      if (entry === 'startPublication') Object.assign(spec, { archiveAttemptId: 'portable-archive', snapshotOrdinal: 0, payloadBase64: 'e30=' });
      core[entry](spec, dependencies);
      assert.equal(transportCalls, 0); assert.equal(inheritedReads, 0);
    });
  }
  return { schema: 'diagnostic-portable-gates-v1', scope: 'Pure path/link and core configuration validation only; virtual clock is never advanced.',
    attempted: cases.length, passed: cases.filter(item => item.pass).length, pass: cases.every(item => item.pass), cases };
}

export async function runPortableEvidence(output) {
  assert.equal(process.version, 'v22.23.2', 'portable diagnostics require Node 22.23.2');
  assert.equal(process.platform, 'linux', 'this driver models producer platforms on Linux only');
  fs.mkdirSync(output, { recursive: false });
  fs.mkdirSync(path.join(output, 'sources'));
  const sourceNames = ['diagnostic-settlement-v3.mjs', 'diagnose-settlement-v3.mjs', 'settlement-oracle-v3.mjs',
    'settlement-fixtures-v3.mjs', 'settlement-boundary-fixtures-v3.mjs', 'settlement-portable-fixtures-v3.mjs'];
  const sourceHashes = {};
  for (const name of sourceNames) {
    const bytes = fs.readFileSync(path.join(path.dirname(ENTRY), name)); sourceHashes[name] = hash(bytes);
    fs.writeFileSync(path.join(output, 'sources', name), bytes, { flag: 'wx' });
  }
  save(output, 'inputs.json', { schema: 'diagnostic-portable-inputs-v1', physicalPlatform: process.platform, node: process.version,
    profiles: PORTABLE_PROFILES, pathCases: PATH_CASES, linkCases: LINK_CASES, coreGates: CORE_GATES, savedNegatives: SAVED_NEGATIVES,
    sourceHashes, realNodeCases: 0, nativeProcesses: 0, pty: false });
  const gates = await runPortableGates(); save(output, 'gates.json', gates);
  const { runSelfTests, verifyEvidence } = await import('./diagnose-settlement-v3.mjs');
  const positives = [], negatives = [];
  let pureFixtureSource = null;
  for (const profile of PORTABLE_PROFILES) {
    const directory = path.join(output, profile.id), moved = path.join(output, `${profile.id}-moved`);
    const item = { id: profile.id, physicalPlatform: process.platform, logicalProducerPlatform: profile.platform,
      reusedPureFixtures: pureFixtureSource !== null, pass: false };
    try {
      item.selftest = await runSelfTests(directory, { portableProfile: profile.id, ...(pureFixtureSource ? { pureFixtureSource } : {}) });
      item.original = await verifyEvidence(directory);
      if (item.selftest.pass && item.original.pass) {
        pureFixtureSource ??= directory;
        copyArchive(directory, moved);
        item.moved = await verifyEvidence(moved);
      }
      item.pass = item.selftest.pass && item.original.pass && item.moved?.pass === true && !item.original.acceptanceReady && !item.moved.acceptanceReady;
    } catch (error) { item.error = String(error.stack ?? error); }
    save(output, `${profile.id}-result.json`, item); positives.push(item);
    process.stdout.write(`${JSON.stringify({ profile: item.id, pass: item.pass, original: item.original?.verified, moved: item.moved?.verified, error: item.error })}\n`);
  }
  for (const [id, profileId, expectedError] of SAVED_NEGATIVES) {
    const item = { id, profileId, expectedError, pass: false };
    const baseline = positives.find(value => value.id === profileId);
    if (!baseline?.pass) item.notRun = 'positive prerequisite did not pass';
    else {
      const directory = path.join(output, `negative-${id}`);
      try {
        copyArchive(path.join(output, profileId), directory); mutateSaved(id, directory);
        const verification = await verifyEvidence(directory);
        item.attempted = verification.attempted; item.verified = verification.verified; item.evidenceErrors = verification.evidenceErrors;
        item.pass = !verification.pass && verification.evidenceErrors.some(value => value.id === expectedError)
          && (id === 'raw-link-without-rehash' || !verification.evidenceErrors.some(value => value.id === 'shared-manifest'));
        save(output, `${id}-verification.json`, verification);
      } catch (error) { item.error = String(error.stack ?? error); }
    }
    negatives.push(item);
    process.stdout.write(`${JSON.stringify({ negative: id, pass: item.pass, notRun: item.notRun, error: item.error })}\n`);
  }
  const summary = { schema: 'diagnostic-portable-summary-v1', sourceHashes, physicalPlatform: process.platform,
    scope: 'Linux file-backed synthetic producer metadata only; no Windows/macOS native capture, junction proof, live matrix, or PTY.',
    gates: { attempted: gates.attempted, passed: gates.passed },
    positives: { attempted: positives.length, passed: positives.filter(item => item.pass).length },
    negatives: { scheduled: negatives.length, attempted: negatives.filter(item => !item.notRun).length, rejected: negatives.filter(item => item.pass).length },
    realNodeCases: 0, nativeProcesses: 0, pty: false, acceptanceReady: false,
    pass: gates.pass && positives.every(item => item.pass) && negatives.every(item => item.pass) };
  save(output, 'negative-results.json', negatives); save(output, 'summary.json', summary);
  return summary;
}

if (process.argv[1] && path.resolve(process.argv[1]) === ENTRY) {
  const { values } = parseArgs({ options: { output: { type: 'string' } } });
  assert(values.output, '--output NEW_DIRECTORY is required');
  runPortableEvidence(path.resolve(values.output)).then(result => {
    process.stdout.write(json(result));
    if (!result.pass) process.exitCode = 1;
  }).catch(error => { process.stderr.write(`${error.stack ?? error}\n`); process.exitCode = 1; });
}
