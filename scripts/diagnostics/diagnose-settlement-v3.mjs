import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { execFileSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import * as core from './diagnostic-settlement-v3.mjs';
import { verifySavedCase, verifyPublicationSnapshot } from './settlement-oracle-v3.mjs';
import { runOracleSelfTests, runCoreSelfTests } from './settlement-fixtures-v3.mjs';
import { runBoundarySelfTests } from './settlement-boundary-fixtures-v3.mjs';
import { assertRecordedLinkTarget, portableProfile, producerPathStyle, profileSourceBytes, syntheticLinkTarget, validateProducerPath } from './settlement-portable-fixtures-v3.mjs';

const ENTRY = fileURLToPath(import.meta.url);
const REPO = path.resolve(path.dirname(ENTRY), '../..');
const SCHEMA = 'diagnostic-settlement-v3';
const FRAME_SCHEMA = 'diagnostic-settlement-frame-v3';
const REQUEST_SCHEMA = 'diagnostic-settlement-request-v3';
const ACK_SCHEMA = 'diagnostic-settlement-ack-v3';
const PAYLOAD_MANIFEST = 'diagnostic-settlement-payload-manifest-v3';
const PUBLICATION_PAYLOAD = 'diagnostic-settlement-publication-payload-v3';
const PUBLICATION_MANIFEST = 'diagnostic-settlement-publication-manifest-v3';
const MAX_REQUEST = 2 * 1024 * 1024;
const MAX_PUBLICATION = 4 * 1024 * 1024;
export const CONSUMER_POLICY = Object.freeze({ schema: 'diagnostic-consumer-delivery-v1', budgetNs: '100000000',
  boundary: 'exclusive', timelyFreezeAlsoRequiresOriginalDeadline: true });
const FILE_FIXTURES = [
  ['normal', 'accept'], ['claim-no-file', 'reject'], ['wrong-size', 'reject'], ['wrong-hash', 'reject'],
  ['self-consistent-wrong-payload', 'reject'], ['missing-payload', 'reject'], ['extra-file', 'reject'],
  ['duplicate-inventory', 'reject'], ['symlink', 'reject'], ['path-escape', 'reject'], ['bad-manifest', 'reject'],
  ['wrong-schema', 'reject'], ['wrong-identity', 'reject'], ['wrong-writer-attempt', 'reject'], ['wrong-writer-request', 'reject'],
];
const ARCHIVE_FIXTURES = [
  ['bad-first-continues-through-last', 'traversal', true], ['bad-root', 'traversal', true], ['swapped-publisher', 'traversal', true],
  ['complete-saved-envelope', 'snapshot', true],
  ...['schema', 'id', 'owner', 'requests', 'lateJournal', 'gates'].map(key => [`missing-snapshot-${key}`, 'snapshot', false]),
  ['consumer-valid', 'consumer', true],
  ...['missing', 'duplicate', 'identity', 'deadline', 'before-freeze', 'deadline-first'].map(key => [`consumer-${key}`, 'consumer', key === 'deadline-first']),
  ...['early', 'deadline', 'late-freeze'].flatMap(kind => ['minus-one', 'equal', 'plus-one'].map(offset =>
    [`consumer-budget-${kind}-${offset}`, 'consumer', offset === 'minus-one'])),
  ...['minus-one', 'equal', 'plus-one'].map(offset => [`consumer-original-deadline-${offset}`, 'consumer', offset === 'minus-one']),
  ['publisher-preflight-binding', 'binding', true], ['publisher-case-swap-binding', 'binding', false],
  ['source-exact', 'sources', true], ['source-crlf', 'sources', true], ['source-content-tamper', 'sources', false],
  ['publication-real-root', 'publication-root', true], ['publication-symlink-root', 'publication-root', false], ['publication-symlink-ancestor', 'publication-root', false],
];
const json = value => `${JSON.stringify(value, null, 2)}\n`;
const hash = value => createHash('sha256').update(value).digest('hex');
const now = () => process.hrtime.bigint();
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const ownKeys = (value, keys, label) => {
  assert(value && typeof value === 'object' && !Array.isArray(value), `${label} is not an object`);
  assert.deepEqual(Object.keys(value).sort(), [...keys].sort(), `${label} fields differ`);
};

function identity(id) {
  ownKeys(id, ['schema', 'runId', 'caseId', 'generation', 'nonce'], 'identity');
  assert.equal(id.schema, SCHEMA);
  for (const field of ['runId', 'caseId', 'nonce']) assert(typeof id[field] === 'string' && id[field].length > 0, `invalid ${field}`);
  assert((typeof id.generation === 'string' && id.generation.length > 0) ||
    (Number.isSafeInteger(id.generation) && id.generation >= 0), 'invalid generation');
}

function decodeBase64(value, limit, label) {
  assert.equal(typeof value, 'string', `${label} is not base64 text`);
  assert(value.length <= Math.ceil(limit / 3) * 4, `${label} exceeds encoded limit`);
  const bytes = Buffer.from(value, 'base64');
  assert.equal(bytes.toString('base64'), value, `${label} is not canonical base64`);
  assert(bytes.length <= limit, `${label} exceeds byte limit`);
  return bytes;
}

function parseUtf8(bytes, label) {
  const text = bytes.toString('utf8');
  assert(Buffer.from(text).equals(bytes), `${label} is not valid UTF-8`);
  return JSON.parse(text);
}

function validateRequest(request, role) {
  ownKeys(request, ['schema', 'id', 'role', 'attemptId', 'requestId', 'scenario', 'artifactDirectory', 'payloadBase64'], 'request');
  assert.equal(request.schema, REQUEST_SCHEMA);
  identity(request.id);
  assert.equal(request.role, role);
  for (const field of ['attemptId', 'requestId', 'scenario', 'artifactDirectory', 'payloadBase64']) {
    assert.equal(typeof request[field], 'string', `invalid request ${field}`);
    if (field !== 'payloadBase64') assert(request[field].length > 0, `empty request ${field}`);
  }
  assert(path.posix.isAbsolute(request.artifactDirectory) || path.win32.isAbsolute(request.artifactDirectory), 'artifactDirectory must be absolute');
  decodeBase64(request.payloadBase64, role === 'publisher' ? MAX_PUBLICATION : MAX_REQUEST, 'request payload');
  return request;
}

async function readRequest(role) {
  const limit = role === 'publisher' ? MAX_PUBLICATION : MAX_REQUEST;
  const chunks = [];
  let count = 0;
  for await (const chunk of process.stdin) {
    count += chunk.length;
    assert(count <= limit, 'request exceeds byte limit');
    chunks.push(chunk);
  }
  return validateRequest(parseUtf8(Buffer.concat(chunks), 'request'), role);
}

function createRoleIO(request) {
  let sourceSequence = 0;
  let failed = null;
  const pending = new Map();
  const early = new Set();
  const received = new Set();
  const acknowledgements = fs.createReadStream(null, { fd: 4, autoClose: true });
  const target = fs.createWriteStream(null, { fd: 3, autoClose: true });
  let buffer = Buffer.alloc(0);
  const fail = error => {
    if (failed) return;
    failed = error;
    for (const entry of pending.values()) entry.reject(error);
    pending.clear();
  };
  acknowledgements.on('data', chunk => {
    if (failed) return;
    try {
      let offset = 0;
      while (offset < chunk.length) {
        const newline = chunk.indexOf(10, offset);
        const end = newline < 0 ? chunk.length : newline;
        assert(buffer.length + end - offset + 1 <= 4096, 'ACK exceeds frame limit');
        buffer = Buffer.concat([buffer, chunk.subarray(offset, end)]);
        if (newline < 0) break;
        const message = parseUtf8(buffer, 'ACK');
        buffer = Buffer.alloc(0);
        ownKeys(message, ['schema', 'role', 'runId', 'caseId', 'generation', 'nonce', 'attemptId', 'requestId', 'type', 'payload'], 'ACK');
        assert.equal(message.schema, ACK_SCHEMA);
        assert.equal(message.role, request.role);
        for (const field of ['runId', 'caseId', 'generation', 'nonce']) assert.equal(message[field], request.id[field], `ACK ${field} differs`);
        for (const field of ['attemptId', 'requestId']) assert.equal(message[field], request[field], `ACK ${field} differs`);
        assert.equal(message.type, 'ack');
        ownKeys(message.payload, ['forType'], 'ACK payload');
        const type = message.payload.forType;
        assert(typeof type === 'string' && type.length > 0, 'invalid ACK type');
        assert(!received.has(type), 'duplicate ACK');
        received.add(type);
        const waiter = pending.get(type);
        if (waiter) { pending.delete(type); waiter.resolve(); }
        else early.add(type);
        offset = newline + 1;
      }
    } catch (error) { fail(error); }
  });
  acknowledgements.on('error', fail);
  acknowledgements.on('end', () => {
    if (buffer.length || pending.size) fail(new Error('ACK stream ended before a complete response'));
  });
  const makeFrame = (type, payload) => ({
    schema: FRAME_SCHEMA, role: request.role,
    runId: request.id.runId, caseId: request.id.caseId, generation: request.id.generation, nonce: request.id.nonce,
    attemptId: request.attemptId, requestId: request.requestId,
    sourceSequence: ++sourceSequence, sentNs: String(now()), type, payload,
  });
  const write = (stream, frame) => new Promise((resolve, reject) => {
    const line = `${JSON.stringify(frame)}\n`;
    assert(Buffer.byteLength(line) <= 4096, 'emitted frame exceeds limit');
    stream.write(line, error => error ? reject(error) : resolve());
  });
  return {
    emit: (type, payload = {}, channel = 'stdout') => write(channel === 'fd3' ? target : process.stdout, makeFrame(type, payload)),
    emitInvalid: async () => { const frame = makeFrame('seal-claim', { bytes: 0, sha256: '0'.repeat(64), manifestSha256: '0'.repeat(64) }); frame.schema = 'invalid-schema'; await write(process.stdout, frame); },
    waitForAck(type) {
      if (failed) return Promise.reject(failed);
      if (early.delete(type)) return Promise.resolve();
      assert(!pending.has(type), 'duplicate ACK wait');
      return new Promise((resolve, reject) => pending.set(type, { resolve, reject }));
    },
    async closeTarget() {
      if (!target.writableEnded && !target.destroyed) await new Promise((resolve, reject) => target.end(error => error ? reject(error) : resolve()));
    },
    async close() {
      acknowledgements.destroy();
      await this.closeTarget();
    },
  };
}

function busyWait(milliseconds) {
  const deadline = now() + BigInt(milliseconds) * 1_000_000n;
  while (now() < deadline) {}
}

async function runCaller(request, io) {
  const scenario = request.scenario;
  await io.emit('caller-start', { scenario });
  let kind = 'returned';
  if (scenario === 'D3v3-02') {
    await io.emit('operation-pending');
    await sleep(1000);
    kind = 'timeout';
  } else {
    await io.emit('result-ready');
    if (scenario === 'D3v3-03') busyWait(7000);
    await Promise.resolve();
  }
  await io.emit('operation-returned', { kind });
  await Promise.resolve();
  if (scenario === 'D3v3-05') {
    await io.closeTarget();
  } else {
    if (scenario === 'D3v3-09') {
      await io.emit('after-await-ready');
      await io.waitForAck('after-await-ready');
    }
    await io.emit('caller-after-await', { kind }, 'fd3');
    await io.waitForAck('caller-after-await');
  }
  if (scenario === 'D3v3-04') busyWait(7000);
  if (scenario === 'D3v3-08') {
    for (let index = 1; index <= 4296; index += 1) await io.emit('bulk', { index, body: 'x'.repeat(220) });
  }
  await io.emit('caller-finished', { exitCode: 0 });
}

function exclusive(file, bytes) {
  fs.writeFileSync(file, bytes, { flag: 'wx' });
}

function createDirectory(directory) {
  fs.mkdirSync(directory, { recursive: false });
}

function safeRelative(file) {
  assert(typeof file === 'string' && file.length > 0, 'empty inventory path');
  assert(!path.posix.isAbsolute(file) && !path.win32.isAbsolute(file), 'absolute inventory path');
  assert(!file.includes('\\') && !file.includes('\0') && !file.includes(':'), 'unsafe inventory path');
  assert(file.split('/').every(part => part && part !== '.' && part !== '..'), 'unsafe inventory path');
  return file;
}

function fileBytes(file, maxBytes) {
  assertNoSymlinkAncestors(file);
  const stat = fs.lstatSync(file);
  assert(stat.isFile() && !stat.isSymbolicLink(), 'inventory member is not a regular file');
  assert(stat.size <= maxBytes, 'inventory member exceeds byte limit');
  const value = fs.readFileSync(file);
  assert.equal(value.length, stat.size, 'file changed size during read');
  return value;
}

function assertNoSymlinkAncestors(target) {
  let current = path.resolve(target);
  while (true) {
    assert(!fs.lstatSync(current).isSymbolicLink(), `symlink is not a trusted evidence path: ${current}`);
    const parent = path.dirname(current);
    if (parent === current) return;
    current = parent;
  }
}

function payloadManifest(request, payload) {
  return {
    schema: PAYLOAD_MANIFEST, id: request.id,
    writerAttemptId: request.attemptId, writerRequestId: request.requestId,
    entries: [{ path: 'payload.json', bytes: payload.length, sha256: hash(payload) }],
  };
}

export function verifyPayloadDirectory(request) {
  const input = parseUtf8(decodeBase64(request.payloadBase64, MAX_REQUEST, 'verification input'), 'verification input');
  ownKeys(input, ['schema', 'expectedPayloadBase64', 'writerAttemptId', 'writerRequestId'], 'verification input');
  assert.equal(input.schema, 'diagnostic-settlement-verification-input-v3');
  for (const key of ['writerAttemptId', 'writerRequestId']) assert(typeof input[key] === 'string' && input[key], `invalid ${key}`);
  const expected = decodeBase64(input.expectedPayloadBase64, MAX_REQUEST, 'expected payload');
  const directory = request.artifactDirectory;
  assert(fs.lstatSync(directory).isDirectory() && !fs.lstatSync(directory).isSymbolicLink(), 'payload directory is not a real directory');
  assert.deepEqual(fs.readdirSync(directory).sort(), ['manifest.json', 'payload.json'], 'payload inventory differs');
  const manifestBytes = fileBytes(path.join(directory, 'manifest.json'), 64 * 1024);
  const manifest = parseUtf8(manifestBytes, 'payload manifest');
  ownKeys(manifest, ['schema', 'id', 'writerAttemptId', 'writerRequestId', 'entries'], 'payload manifest');
  assert.equal(manifest.schema, PAYLOAD_MANIFEST);
  assert.deepEqual(manifest.id, request.id, 'payload identity differs');
  assert.equal(manifest.writerAttemptId, input.writerAttemptId, 'writer attempt differs');
  assert.equal(manifest.writerRequestId, input.writerRequestId, 'writer request differs');
  assert(Array.isArray(manifest.entries), 'manifest entries are not an array');
  const names = new Set();
  for (const item of manifest.entries) {
    ownKeys(item, ['path', 'bytes', 'sha256'], 'inventory item');
    safeRelative(item.path);
    assert(!names.has(item.path), 'duplicate inventory path');
    names.add(item.path);
    assert(Number.isSafeInteger(item.bytes) && item.bytes >= 0, 'invalid inventory byte size');
    assert(/^[a-f0-9]{64}$/.test(item.sha256), 'invalid inventory hash');
  }
  assert.deepEqual([...names], ['payload.json'], 'manifest inventory differs');
  const payload = fileBytes(path.join(directory, 'payload.json'), MAX_REQUEST);
  assert.equal(payload.length, manifest.entries[0].bytes, 'payload byte size differs');
  assert.equal(hash(payload), manifest.entries[0].sha256, 'payload hash differs');
  assert(payload.equals(expected), 'payload differs from requested bytes');
  return { bytes: payload.length, sha256: hash(payload), manifestSha256: hash(manifestBytes) };
}

async function runWriter(request, io) {
  await io.emit('start', { scenario: request.scenario });
  await io.emit('write-entered', { mode: request.scenario === 'D3v3-07' ? 'sync-block' : 'write' });
  await io.waitForAck('write-entered');
  if (request.scenario === 'D3v3-07') { busyWait(5500); return; }
  const payload = decodeBase64(request.payloadBase64, MAX_REQUEST, 'writer payload');
  createDirectory(request.artifactDirectory);
  const target = path.join(request.artifactDirectory, 'payload.json');
  if (request.scenario === 'D3v3-06') exclusive(target, 'fixture\n');
  exclusive(target, payload);
  const manifestBytes = Buffer.from(json(payloadManifest(request, payload)));
  exclusive(path.join(request.artifactDirectory, 'manifest.json'), manifestBytes);
  if (request.scenario === 'D3v3-11') await io.emitInvalid();
  await io.emit('seal-claim', { bytes: payload.length, sha256: hash(payload), manifestSha256: hash(manifestBytes) });
}

async function runVerifier(request, io) {
  await io.emit('start', { scenario: request.scenario });
  await io.emit('verify-entered', { mode: request.scenario === 'D3v3-12' ? 'sync-block' : 'verify' });
  await io.waitForAck('verify-entered');
  if (request.scenario === 'D3v3-12') { busyWait(5500); return; }
  await io.emit('verified', verifyPayloadDirectory(request));
}

function decodePublication(request) {
  const payload = parseUtf8(decodeBase64(request.payloadBase64, MAX_PUBLICATION, 'publication payload'), 'publication payload');
  ownKeys(payload, ['schema', 'id', 'archiveAttemptId', 'snapshotOrdinal', 'files'], 'publication payload');
  assert.equal(payload.schema, PUBLICATION_PAYLOAD);
  assert.deepEqual(payload.id, request.id, 'publication identity differs');
  assert(typeof payload.archiveAttemptId === 'string' && payload.archiveAttemptId, 'invalid archive attempt');
  assert(Number.isSafeInteger(payload.snapshotOrdinal) && payload.snapshotOrdinal >= 0, 'invalid publication ordinal');
  assert(Array.isArray(payload.files) && payload.files.length <= 128, 'invalid publication file inventory');
  const names = new Set();
  const files = payload.files.map(item => {
    ownKeys(item, ['path', 'bytesBase64'], 'publication file');
    safeRelative(item.path);
    assert(item.path !== 'manifest.json' && !names.has(item.path), 'duplicate/reserved publication file');
    names.add(item.path);
    return { path: item.path, bytes: decodeBase64(item.bytesBase64, MAX_PUBLICATION, 'publication file bytes') };
  });
  assert(files.reduce((total, item) => total + item.bytes.length, 0) <= MAX_PUBLICATION, 'publication files exceed limit');
  return { payload, files };
}

async function runPublisher(request, io) {
  await io.emit('start', { scenario: request.scenario });
  await io.emit('publish-entered', { mode: request.scenario === 'publisher-block' ? 'sync-block' : 'publish' });
  await io.waitForAck('publish-entered');
  if (request.scenario === 'publisher-block') { busyWait(5500); return; }
  const { payload, files } = decodePublication(request);
  createDirectory(request.artifactDirectory);
  const entries = [];
  for (const item of files) {
    const target = path.join(request.artifactDirectory, item.path);
    if (path.dirname(item.path) !== '.') fs.mkdirSync(path.dirname(target), { recursive: true });
    if (request.scenario === 'publisher-eexist' && entries.length === 0) exclusive(target, 'fixture\n');
    if (request.scenario === 'publisher-partial-failure' && entries.length === 0) {
      exclusive(target, item.bytes.subarray(0, Math.max(1, Math.floor(item.bytes.length / 2))));
      const error = new Error('injected failure after writing a prefix'); error.code = 'INJECTED_PARTIAL'; throw error;
    }
    exclusive(target, item.bytes);
    entries.push({ path: item.path, bytes: item.bytes.length, sha256: hash(item.bytes) });
  }
  const bytes = Buffer.from(json({ schema: PUBLICATION_MANIFEST, id: request.id,
    archiveAttemptId: payload.archiveAttemptId, snapshotOrdinal: payload.snapshotOrdinal, entries }));
  exclusive(path.join(request.artifactDirectory, 'manifest.json'), bytes);
  await io.emit('publish-claim', { files: files.length, manifestSha256: hash(bytes) });
}

export async function runRole(role) {
  assert(['caller', 'writer', 'verifier', 'publisher'].includes(role), 'invalid role');
  const request = await readRequest(role);
  const io = createRoleIO(request);
  try {
    if (role === 'caller') await runCaller(request, io);
    else if (role === 'writer') await runWriter(request, io);
    else if (role === 'verifier') await runVerifier(request, io);
    else await runPublisher(request, io);
  } catch (error) {
    if (role === 'caller') throw error;
    await io.emit('failed', { code: String(error.code ?? 'ROLE_FAILED'), message: String(error.message).slice(0, 512) });
  } finally { await io.close(); }
}

const SOURCE_FILES = [
  'diagnostic-settlement-v3.mjs', 'diagnose-settlement-v3.mjs',
  'settlement-oracle-v3.mjs', 'settlement-fixtures-v3.mjs', 'settlement-boundary-fixtures-v3.mjs',
  'settlement-portable-fixtures-v3.mjs',
  'settlement-error-budget-v1.mjs',
];

export function fullSchedule() {
  const main = Array.from({ length: 12 }, (_, index) => `D3v3-${String(index + 1).padStart(2, '0')}`)
    .flatMap(scenario => [1, 2, 3].map(repetition => ({ id: `${scenario}-${repetition}`, group: 'main', scenario, repetition })));
  const gates = [
    { id: 'D3v3-G1', group: 'gate', scenario: 'D3v3-01', repetition: 1 },
    { id: 'D3v3-G2', group: 'gate', scenario: 'D3v3-01', repetition: 1 },
  ];
  const publication = ['normal', 'eexist', 'partial-failure', 'block'].map((kind, index) => ({
    id: `D3v3-P${index + 1}`, group: 'publisher', scenario: `publisher-${kind}`, repetition: 1,
  }));
  return [...main, ...gates, ...publication];
}

function listMembers(directory, prefix = '') {
  const output = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const name = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (!prefix && name === 'manifest.json') continue;
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) output.push(...listMembers(target, name));
    else if (entry.isSymbolicLink()) output.push({ path: name, type: 'symlink', target: fs.readlinkSync(target) });
    else {
      assert(entry.isFile(), 'unsupported evidence member type');
      const bytes = fs.readFileSync(target);
      output.push({ path: name, type: 'file', bytes: bytes.length, sha256: hash(bytes) });
    }
  }
  return output;
}

function writeRunManifest(directory) {
  exclusive(path.join(directory, 'manifest.json'), json({ schema: 'diagnostic-settlement-run-manifest-v3', entries: listMembers(directory) }));
}

function verifyRunManifest(directory) {
  assertNoSymlinkAncestors(directory);
  const manifest = parseUtf8(fileBytes(path.join(directory, 'manifest.json'), 8 * 1024 * 1024), 'run manifest');
  ownKeys(manifest, ['schema', 'entries'], 'run manifest');
  assert.equal(manifest.schema, 'diagnostic-settlement-run-manifest-v3');
  assert.deepEqual(manifest.entries, listMembers(directory), 'run inventory or bytes differ');
  return { members: manifest.entries.length };
}

export function verifyPublicationDirectory(directory, expectedIdentity, expectedRequest) {
  assertNoSymlinkAncestors(directory);
  assert(fs.lstatSync(directory).isDirectory(), 'publication root is not a directory');
  const bytes = fileBytes(path.join(directory, 'manifest.json'), 512 * 1024);
  const manifest = parseUtf8(bytes, 'publication manifest');
  ownKeys(manifest, ['schema', 'id', 'archiveAttemptId', 'snapshotOrdinal', 'entries'], 'publication manifest');
  assert.equal(manifest.schema, PUBLICATION_MANIFEST);
  assert.deepEqual(manifest.id, expectedIdentity, 'publication identity differs');
  assert(typeof manifest.archiveAttemptId === 'string' && manifest.archiveAttemptId, 'invalid archive attempt');
  assert(Number.isSafeInteger(manifest.snapshotOrdinal) && manifest.snapshotOrdinal >= 0, 'invalid snapshot ordinal');
  assert(Array.isArray(manifest.entries), 'publication inventory is not an array');
  const names = new Set();
  for (const entry of manifest.entries) {
    ownKeys(entry, ['path', 'bytes', 'sha256'], 'publication entry');
    safeRelative(entry.path);
    assert(entry.path !== 'manifest.json' && !names.has(entry.path), 'duplicate/reserved publication entry');
    names.add(entry.path);
    assert(Number.isSafeInteger(entry.bytes) && entry.bytes >= 0 && /^[a-f0-9]{64}$/.test(entry.sha256), 'invalid publication file attributes');
    const actual = fileBytes(path.join(directory, entry.path), MAX_PUBLICATION);
    assert.equal(actual.length, entry.bytes, 'publication file byte size differs');
    assert.equal(hash(actual), entry.sha256, 'publication file hash differs');
  }
  const actual = listMembers(directory);
  assert(actual.every(item => item.type === 'file'), 'publication contains a symlink');
  assert.deepEqual(actual.map(item => item.path).sort(), [...names].sort(), 'publication inventory differs');
  if (expectedRequest) {
    const { payload, files } = decodePublication(expectedRequest);
    assert.equal(manifest.archiveAttemptId, payload.archiveAttemptId, 'archive attempt differs from request');
    assert.equal(manifest.snapshotOrdinal, payload.snapshotOrdinal, 'archive ordinal differs from request');
    assert.deepEqual([...names].sort(), files.map(item => item.path).sort(), 'publication inventory differs from request');
    for (const item of files) assert(fs.readFileSync(path.join(directory, item.path)).equals(item.bytes), `published bytes differ from request: ${item.path}`);
  }
  return { files: names.size, manifestSha256: hash(bytes) };
}

async function prepareOutput(output, mode, schedule, options = {}) {
  assert.equal(process.version, 'v22.23.2', 'D3 v3 requires the frozen Node 22.23.2 runtime');
  await fsp.mkdir(output, { recursive: false });
  for (const name of ['sources', 'cases', 'writer-artifacts', 'outer', 'preflight']) await fsp.mkdir(path.join(output, name));
  const profile = options.portableProfile === undefined ? null : portableProfile(options.portableProfile);
  if (profile) await fsp.mkdir(path.join(output, 'execution-sources'));
  const sourceHashes = {}, executionSourceHashes = {};
  for (const name of SOURCE_FILES) {
    const executed = await fsp.readFile(path.join(path.dirname(ENTRY), name));
    const bytes = profile ? profileSourceBytes(executed, profile.sourceLineEndings) : executed;
    if (profile) {
      executionSourceHashes[name] = hash(executed);
      await fsp.writeFile(path.join(output, 'execution-sources', name), executed, { flag: 'wx' });
    }
    sourceHashes[name] = hash(bytes);
    await fsp.writeFile(path.join(output, 'sources', name), bytes, { flag: 'wx' });
  }
  const metadata = {
    schema: SCHEMA, mode, runId: randomUUID(), node: process.version, platform: process.platform, arch: process.arch,
    entryPath: ENTRY, outputDirectory: output,
    osRelease: os.release(), createdAt: new Date().toISOString(),
    sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO, encoding: 'utf8' }).trim(),
    sourceCommitKind: 'worktree-base; exact execution input is sourceHashes',
    sourceHashes, schedule, consumerPolicy: CONSUMER_POLICY, nativeProcesses: 0, pty: false,
    scope: 'Node diagnostic roles only; no PTY, native API, descendants, product acceptance, or production topology.',
  };
  if (profile) {
    const paths = path[producerPathStyle(profile.platform)];
    metadata.platform = profile.platform;
    metadata.outputDirectory = profile.outputDirectory;
    metadata.entryPath = paths.join(paths.dirname(profile.outputDirectory), 'diagnose-settlement-v3.mjs');
    metadata.syntheticProducer = { schema: 'diagnostic-synthetic-producer-v1', profileId: profile.id,
      physicalPlatform: process.platform, physicalOutputDirectory: output, physicalEntryPath: ENTRY,
      logicalProducerPlatform: profile.platform, sourceLineEndings: profile.sourceLineEndings,
      linkTargetForm: profile.linkTargetForm, executionSourceHashes, sourceVariant: 'profile',
      sharedPureFixtureSource: options.pureFixtureSource ?? null };
    metadata.sourceCommitKind = 'worktree-base; executionSourceHashes identify executed local code; sourceHashes identify synthetic archive bytes';
    metadata.scope = 'Synthetic producer paths and source bytes on a local filesystem; not a native producer capture or live matrix.';
  }
  await fsp.writeFile(path.join(output, 'run.json'), json(metadata), { flag: 'wx' });
  return metadata;
}

function createSpec(output, metadata, entry) {
  const spec = {
    id: { schema: SCHEMA, runId: metadata.runId, caseId: entry.id, generation: 'generation-1', nonce: randomUUID() },
    scenario: entry.scenario, entryPath: ENTRY, artifactDirectory: path.join(output, 'writer-artifacts', entry.id),
  };
  if (entry.scenario === 'D3v3-10') spec.command = { file: path.join(output, 'preflight', `missing-${randomUUID()}`), args: [] };
  if (entry.id === 'D3v3-G1') spec.gates = { caller: true, writer: true };
  if (entry.id === 'D3v3-G2') spec.gates = { capture: true };
  return spec;
}

function publicationPayload(id, archiveAttemptId, snapshotOrdinal, files) {
  const value = { schema: PUBLICATION_PAYLOAD, id, archiveAttemptId, snapshotOrdinal,
    files: Object.entries(files).map(([file, bytes]) => ({ path: file, bytesBase64: Buffer.from(bytes).toString('base64') })) };
  const bytes = Buffer.from(json(value));
  assert(bytes.length <= MAX_PUBLICATION, 'publication request snapshot exceeds frozen capacity');
  return bytes.toString('base64');
}

function hasUnknown(snapshot) {
  const walk = value => {
    if (!value || typeof value !== 'object') return false;
    if (value.kind === 'unconfirmed') return true;
    if (value.processResponsibility === 'unconfirmed' || value.streamResponsibility === 'unconfirmed') return true;
    return Object.values(value).some(walk);
  };
  return walk(snapshot);
}

function fileRequest(id, directory, expected = Buffer.from('{"test":"payload"}\n')) {
  const writer = { schema: REQUEST_SCHEMA, id, role: 'writer', attemptId: 'writer-attempt', requestId: 'writer-request',
    scenario: 'D3v3-01', artifactDirectory: directory, payloadBase64: expected.toString('base64') };
  const request = { ...writer, role: 'verifier', attemptId: 'verifier-attempt', requestId: 'verifier-request',
    payloadBase64: Buffer.from(json({ schema: 'diagnostic-settlement-verification-input-v3',
      expectedPayloadBase64: writer.payloadBase64, writerAttemptId: writer.attemptId, writerRequestId: writer.requestId })).toString('base64') };
  return { writer, request, expected };
}

function fileFixtureIdentity(metadata) {
  return { schema: SCHEMA, runId: metadata.runId, caseId: 'file-self-test', generation: 'generation-1', nonce: `${metadata.runId}:file-fixture` };
}

function fixtureTree() {
  const entries = new Map();
  return { entries,
    directory: name => entries.set(name, { type: 'directory' }),
    file: (name, bytes) => entries.set(name, { type: 'file', bytes: Buffer.from(bytes) }),
    symlink: (name, target, kind) => entries.set(name, { type: 'symlink', target, kind }),
  };
}

function treeMembers(tree, prefix = '') {
  return [...tree.entries].filter(([name, item]) => item.type !== 'directory' && name.startsWith(prefix) && name !== `${prefix}manifest.json`)
    .map(([name, item]) => item.type === 'symlink'
      ? { path: name.slice(prefix.length), type: 'symlink', target: item.target }
      : { path: name.slice(prefix.length), type: 'file', bytes: item.bytes.length, sha256: hash(item.bytes) })
    .sort((a, b) => a.path.localeCompare(b.path));
}

function treeManifest(tree, prefix) {
  tree.file(`${prefix}manifest.json`, json({ schema: 'diagnostic-settlement-run-manifest-v3', entries: treeMembers(tree, prefix) }));
}

function materializeTree(directory, tree, producer = null) {
  createDirectory(directory);
  for (const [name, item] of tree.entries) {
    const target = path.join(directory, ...name.split('/'));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    if (item.type === 'directory') fs.mkdirSync(target, { recursive: true });
    else if (item.type === 'file') exclusive(target, item.bytes);
    else {
      const rawTarget = producer ? syntheticLinkTarget(item.target, producer.logicalProducerPlatform, producer.linkTargetForm) : item.target;
      fs.symlinkSync(rawTarget, target, process.platform === 'win32' && item.kind === 'dir' ? 'junction' : item.kind);
    }
  }
}

function verifyFixtureTree(directory, tree, label, run) {
  assertNoSymlinkAncestors(directory);
  const expected = treeMembers(tree);
  const actual = listMembers(directory).sort((a, b) => a.path.localeCompare(b.path));
  assert.equal(actual.length, expected.length, `${label} member inventory differs`);
  for (const [index, item] of actual.entries()) {
    const definition = expected[index];
    if (item.type === 'symlink' && definition.type === 'symlink' && item.path === definition.path) {
      if (run.syntheticProducer) assert.equal(item.target,
        syntheticLinkTarget(definition.target, run.platform, run.syntheticProducer.linkTargetForm), 'synthetic link raw form differs from profile');
      assertRecordedLinkTarget(item.target, definition.target, run.platform);
    } else assert.deepEqual(item, definition, `${label} bytes or fixture mutations differ from trusted definitions`);
  }
  for (const [name, item] of tree.entries) if (item.type === 'directory') {
    const target = path.join(directory, ...name.split('/'));
    assertNoSymlinkAncestors(target);
    assert(fs.lstatSync(target).isDirectory(), `${label} directory is missing: ${name}`);
  }
}

function buildFileFixtures(output, id, paths = path) {
  const root = paths.join(output, 'file-fixtures');
  const tree = fixtureTree(), cases = [];
  for (const [name, expectedOutcome] of FILE_FIXTURES) {
    const directory = paths.join(root, name);
    tree.directory(name);
    const { writer, request, expected } = fileRequest(id, directory);
    const payload = name === 'self-consistent-wrong-payload' ? Buffer.from('{"test":"another"}\n') : expected;
    const manifest = payloadManifest(writer, payload);
    if (name === 'wrong-size') manifest.entries[0].bytes += 1;
    if (name === 'wrong-hash') manifest.entries[0].sha256 = '0'.repeat(64);
    if (name === 'duplicate-inventory') manifest.entries.push({ ...manifest.entries[0] });
    if (name === 'path-escape') manifest.entries[0].path = '../escaped.json';
    if (name === 'wrong-schema') manifest.schema = 'wrong-schema';
    if (name === 'wrong-identity') manifest.id = { ...id, nonce: `${id.nonce}-wrong` };
    if (name === 'wrong-writer-attempt') manifest.writerAttemptId += '-wrong';
    if (name === 'wrong-writer-request') manifest.writerRequestId += '-wrong';
    if (name !== 'claim-no-file') {
      if (name === 'symlink') {
        tree.file('symlink-target.json', payload);
        tree.symlink(`${name}/payload.json`, paths.join(root, 'symlink-target.json'), 'file');
      } else if (name !== 'missing-payload') tree.file(`${name}/payload.json`, payload);
      tree.file(`${name}/manifest.json`, name === 'bad-manifest' ? '{not-json\n' : json(manifest));
    }
    if (name === 'extra-file') tree.file(`${name}/extra.json`, '{}\n');
    cases.push({ id: name, request, expected: expectedOutcome });
  }
  return { tree, cases };
}

export function runFileSelfTests(output, id, metadata = null) {
  const { tree, cases } = buildFileFixtures(metadata?.outputDirectory ?? output, id, path[producerPathStyle(metadata?.platform ?? process.platform)]);
  materializeTree(path.join(output, 'file-fixtures'), tree, metadata?.syntheticProducer);
  for (const entry of cases) {
    try { entry.actual = { accepted: true, result: verifyPayloadDirectory({ ...entry.request, artifactDirectory: path.join(output, 'file-fixtures', entry.id) }) }; }
    catch (error) { entry.actual = { accepted: false, error: String(error.message) }; }
    entry.pass = entry.actual.accepted === (entry.expected === 'accept');
  }
  return { pass: cases.every(item => item.pass), attempted: cases.length, passed: cases.filter(item => item.pass).length, cases };
}

function archiveFiles(snapshot, attempt) {
  const { spec, trace, ...reports } = snapshot;
  return {
    'spec.json': json(spec),
    'trace.ndjson': `${trace.map(item => JSON.stringify(item)).join('\n')}\n`,
    'reports.json': json(reports),
    'publication-attempt.json': json(attempt),
  };
}

async function executeCase(output, spec, entry, resources) {
  const handle = core.startObservedCase(spec);
  resources.handle = handle;
  const gateObservations = [];
  const consume = async (name, gateName) => {
    let held;
    if (gateName) {
      held = await handle.waitForGate(gateName);
      gateObservations.push({ name: gateName, reportName: name, observation: held });
    }
    const report = await handle[name];
    handle.recordConsumerAwait(name);
    if (held?.kind === 'held') handle.releaseGate(gateName);
    return report;
  };
  const consumers = [
    consume('observation', entry.id === 'D3v3-G1' ? 'caller' : null),
    consume('processSettlement', entry.id === 'D3v3-G1' ? 'writer' : entry.id === 'D3v3-G2' ? 'capture' : null),
  ];
  // Publication coordination is distinct from the consumer's actual await continuation.
  const publisherReady = handle.evidenceSettlement.then(() => {
    const snapshot = handle.getEvidenceSnapshot();
    const archiveAttemptId = `${entry.id}:archive:1`;
    const snapshotOrdinal = snapshot.trace.at(-1)?.eventOrdinal ?? 0;
    const attempt = { schema: 'diagnostic-settlement-publication-attempt-v3', id: spec.id,
      archiveAttemptId, snapshotOrdinal, source: 'immutable-in-memory-snapshot',
      containsPublicationResult: false, sourceOwnerBlocked: snapshot.owner.blocked };
    const publicationSpec = {
      id: spec.id, entryPath: ENTRY, artifactDirectory: path.join(output, 'cases', entry.id),
      archiveAttemptId, snapshotOrdinal,
      payloadBase64: publicationPayload(spec.id, archiveAttemptId, snapshotOrdinal, archiveFiles(snapshot, attempt)),
      scenario: 'publisher-normal',
      ...(entry.id === 'D3v3-G1' ? { gates: { publisher: true } } : {}),
    };
    const publisher = core.startPublication(publicationSpec);
    resources.publisher = publisher;
    return { publisher, snapshot, snapshotOrdinal };
  });
  // Await the same result below; this handler only prevents a temporarily unhandled rejection.
  publisherReady.catch(() => {});
  await Promise.all(consumers);
  const { publisher, snapshot, snapshotOrdinal } = await publisherReady;
  if (entry.id === 'D3v3-G1') {
    const held = await publisher.waitForGate('publisher');
    gateObservations.push({ name: 'publisher', reportName: 'evidenceSettlement', observation: held });
    await handle.evidenceSettlement;
    handle.recordConsumerAwait('evidenceSettlement');
    if (held.kind === 'held') publisher.releaseGate('publisher');
  } else {
    await handle.evidenceSettlement;
    handle.recordConsumerAwait('evidenceSettlement');
  }
  const publication = await publisher.publication;
  publisher.recordConsumerAwait('publication');
  const publicationSnapshot = publisher.getEvidenceSnapshot();
  const replay = verifySavedCase(snapshot);
  const publicationReplay = verifyPublicationSnapshot(publicationSnapshot);
  const pass = replay.pass && publicationReplay.pass && publication.kind === 'published' && gateObservations.every(item => item.observation.kind === 'held');
  return {
    handle, publisher,
    control: { schema: 'diagnostic-settlement-outer-control-v3', entry, inputSnapshot: snapshot,
      publicationSnapshot, archivedSnapshotOrdinal: snapshotOrdinal, gateObservations, replay, publicationReplay, pass },
  };
}

async function executePublisherCase(output, spec, entry, resources) {
  const archiveAttemptId = `${entry.id}:archive:1`;
  const snapshotOrdinal = 0;
  const requestSpec = {
    id: spec.id, entryPath: ENTRY, artifactDirectory: path.join(output, 'cases', entry.id),
    archiveAttemptId, snapshotOrdinal, scenario: entry.scenario,
    payloadBase64: publicationPayload(spec.id, archiveAttemptId, snapshotOrdinal, {
      'fixture.json': json({ schema: 'diagnostic-settlement-publication-fixture-v3', id: spec.id, expectedScenario: entry.scenario }),
    }),
  };
  const publisher = core.startPublication(requestSpec);
  resources.publisher = publisher;
  await publisher.publication;
  publisher.recordConsumerAwait('publication');
  const publicationSnapshot = publisher.getEvidenceSnapshot();
  const replay = verifyPublicationSnapshot(publicationSnapshot);
  return { publisher, control: { schema: 'diagnostic-settlement-outer-control-v3', entry, publicationSnapshot, publicationReplay: replay, pass: replay.pass } };
}

export async function runEvidence(output) {
  const schedule = fullSchedule();
  const metadata = await prepareOutput(output, 'full', schedule);
  const specs = schedule.map(entry => createSpec(output, metadata, entry));
  for (const spec of specs) if (spec.command) assert(!fs.existsSync(spec.command.file), 'missing-executable fixture already exists');
  await fsp.writeFile(path.join(output, 'specs.json'), json(specs), { flag: 'wx' });
  const completed = [];
  const results = [];
  let blocked = false;
  // All case preparation is complete before the first caller is spawned.
  for (const [index, entry] of schedule.entries()) {
    if (blocked) {
      results.push({ id: entry.id, group: entry.group, pass: false, status: 'blocked/not-run', reason: 'prior-owner-unconfirmed' });
      continue;
    }
    const resources = {};
    try {
      const result = entry.group === 'publisher'
        ? await executePublisherCase(output, specs[index], entry, resources)
        : await executeCase(output, specs[index], entry, resources);
      completed.push(result);
      blocked = Boolean(result.handle?.getOwnerSnapshot().blocked || result.publisher.getOwnerSnapshot().blocked ||
        hasUnknown(result.handle?.getOwnerSnapshot()) || hasUnknown(result.publisher.getOwnerSnapshot()));
      results.push({ id: entry.id, group: entry.group, pass: result.control.pass && !blocked, status: 'attempted', ownerBlocked: blocked });
      process.stdout.write(`${JSON.stringify({ event: 'case-settlement', id: entry.id, pass: result.control.pass,
        reports: result.control.inputSnapshot?.reports ?? null, publication: result.control.publicationSnapshot.reports.publication,
        ownerBlocked: blocked })}\n`);
    } catch (error) {
      if (resources.handle) await Promise.all(['observation', 'processSettlement', 'evidenceSettlement'].map(name => resources.handle[name]));
      if (resources.publisher) await resources.publisher.publication;
      completed.push({ ...resources, control: { schema: 'diagnostic-settlement-outer-control-v3', entry,
        inputSnapshot: resources.handle?.getEvidenceSnapshot() ?? null,
        publicationSnapshot: resources.publisher?.getEvidenceSnapshot() ?? null,
        pass: false, harnessError: String(error.stack ?? error) } });
      results.push({ id: entry.id, group: entry.group, pass: false, status: 'harness-failed', error: String(error.stack ?? error) });
      blocked = true;
      process.stdout.write(`${JSON.stringify({ event: 'harness-failure', id: entry.id, error: String(error.stack ?? error) })}\n`);
    }
  }
  // These are outer observations, not facts a publisher could have certified about itself.
  const controls = completed.map(item => ({ ...item.control,
    finalCaseSnapshot: item.handle?.getEvidenceSnapshot() ?? null,
    finalPublicationSnapshot: item.publisher?.getEvidenceSnapshot() ?? null,
  }));
  for (const control of controls) await fsp.writeFile(path.join(output, 'outer', `${control.entry.id}.json`), json(control), { flag: 'wx' });
  await fsp.writeFile(path.join(output, 'run-control.ndjson'), `${controls.map(control => JSON.stringify({
    id: control.entry.id, publication: control.publicationSnapshot?.reports.publication ?? null,
    harnessError: control.harnessError ?? null,
    archiveBoundary: control.archivedSnapshotOrdinal ?? null,
    finalCaseOrdinal: control.finalCaseSnapshot?.trace.at(-1)?.eventOrdinal ?? null,
    source: 'outer-observer-after-await',
  })).join('\n')}\n`, { flag: 'wx' });
  const summary = { schema: SCHEMA, pass: results.every(item => item.pass), mode: 'full', results,
    counts: { scheduledMain: 36, scheduledGates: 2, scheduledPublishers: 4, attempted: completed.length }, ownerBlocked: blocked };
  await fsp.writeFile(path.join(output, 'summary.json'), json(summary), { flag: 'wx' });
  writeRunManifest(output);
  return verifyEvidence(output);
}

export async function runSelfTests(output, options = {}) {
  assert(options && typeof options === 'object' && Object.keys(options).every(key => ['portableProfile', 'pureFixtureSource'].includes(key)), 'unknown self-test options');
  assert(options.pureFixtureSource === undefined || options.portableProfile !== undefined, 'pure fixture sharing is only available to portable synthetic producers');
  const metadata = await prepareOutput(output, 'self-test', [], options);
  let oracle, coreResult, boundaries;
  if (options.pureFixtureSource) {
    const sourceRun = readJSON(path.join(options.pureFixtureSource, 'run.json'));
    verifySources(options.pureFixtureSource, sourceRun);
    assert.deepEqual(sourceRun.syntheticProducer?.executionSourceHashes ?? sourceRun.sourceHashes,
      metadata.syntheticProducer.executionSourceHashes, 'shared pure fixtures executed different sources');
    const summary = readJSON(path.join(options.pureFixtureSource, 'summary.json'));
    assert.equal(summary.pass, true, 'shared pure fixtures did not pass');
    const reused = {};
    for (const name of ['oracle', 'core', 'boundaries']) {
      const source = path.join(options.pureFixtureSource, `${name}-tests.json`);
      assertNoSymlinkAncestors(source);
      const stat = fs.lstatSync(source);
      assert(stat.isFile() && stat.size <= (name === 'boundaries' ? 128 : 64) * 1024 * 1024, 'shared pure fixture file is invalid');
      fs.copyFileSync(source, path.join(output, `${name}-tests.json`), fs.constants.COPYFILE_EXCL | fs.constants.COPYFILE_FICLONE);
      const counts = summary.counts[name];
      assert(Number.isSafeInteger(counts?.attempted) && counts.attempted > 0 && counts.passed === counts.attempted, 'shared pure fixture count is invalid');
      reused[name] = { pass: true, ...counts };
    }
    ({ oracle, core: coreResult, boundaries } = reused);
  } else {
    oracle = await runOracleSelfTests();
    coreResult = await runCoreSelfTests();
    boundaries = await runBoundarySelfTests();
  }
  const files = runFileSelfTests(output, fileFixtureIdentity(metadata), metadata);
  const archives = await runArchiveSelfTests(output, metadata);
  for (const [name, report] of Object.entries({ oracle, core: coreResult, boundaries, files, archives })) {
    if (options.pureFixtureSource && ['oracle', 'core', 'boundaries'].includes(name)) continue;
    await fsp.writeFile(path.join(output, `${name}-tests.json`), json(report), { flag: 'wx' });
  }
  const result = { schema: SCHEMA, mode: 'self-test', pass: oracle.pass && coreResult.pass && boundaries.pass && files.pass && archives.pass,
    counts: Object.fromEntries(Object.entries({ oracle, core: coreResult, boundaries, files, archives }).map(([key, value]) => [key, { attempted: value.attempted, passed: value.passed }])),
    realNodeCases: 0, nativeProcesses: 0, pty: false };
  await fsp.writeFile(path.join(output, 'summary.json'), json(result), { flag: 'wx' });
  writeRunManifest(output);
  return result;
}

function readJSON(file) { return parseUtf8(fileBytes(file, 64 * 1024 * 1024), file); }

function validateSyntheticProducer(run) {
  const value = run.syntheticProducer;
  ownKeys(value, ['schema', 'profileId', 'physicalPlatform', 'physicalOutputDirectory', 'physicalEntryPath', 'logicalProducerPlatform',
    'sourceLineEndings', 'linkTargetForm', 'executionSourceHashes', 'sourceVariant', 'sharedPureFixtureSource'], 'synthetic producer');
  assert.equal(value.schema, 'diagnostic-synthetic-producer-v1');
  const profile = portableProfile(value.profileId);
  assert.equal(run.platform, profile.platform);
  assert.equal(value.logicalProducerPlatform, profile.platform);
  assert.equal(value.sourceLineEndings, profile.sourceLineEndings);
  assert.equal(value.linkTargetForm, profile.linkTargetForm);
  assert(['profile', 'exact', 'crlf', 'content-tamper'].includes(value.sourceVariant), 'unknown synthetic source variant');
  validateProducerPath(value.physicalOutputDirectory, value.physicalPlatform, 'physical output path');
  validateProducerPath(value.physicalEntryPath, value.physicalPlatform, 'physical source path');
  if (value.sharedPureFixtureSource !== null) validateProducerPath(value.sharedPureFixtureSource, value.physicalPlatform, 'shared pure fixture path');
  const paths = path[producerPathStyle(profile.platform)];
  assert.equal(run.outputDirectory, run.mode === 'full' && run.syntheticArchiveFixture === true
    ? paths.join(profile.outputDirectory, 'archive-fixtures', 'traversal') : profile.outputDirectory, 'logical producer output identity differs');
  assert.equal(run.entryPath, paths.join(paths.dirname(profile.outputDirectory), 'diagnose-settlement-v3.mjs'), 'logical producer entry identity differs');
  assert.deepEqual(Object.keys(value.executionSourceHashes).sort(), [...SOURCE_FILES].sort(), 'execution source inventory differs');
  return profile;
}

function verifySources(directory, run) {
  assert.equal(run.schema, SCHEMA);
  assert(['full', 'self-test'].includes(run.mode), 'unsupported evidence mode');
  assert.equal(run.node, 'v22.23.2');
  assert.equal(run.nativeProcesses, 0);
  assert.equal(run.pty, false);
  assert.deepEqual(run.consumerPolicy, CONSUMER_POLICY, 'recorded consumer policy differs from trusted diagnostic policy');
  assert(typeof run.runId === 'string' && run.runId, 'run identity is missing');
  assert(['linux', 'darwin', 'win32'].includes(run.platform), 'unsupported recorded platform');
  validateProducerPath(run.outputDirectory, run.platform, 'recorded output path');
  validateProducerPath(run.entryPath, run.platform, 'recorded source entry path');
  const synthetic = run.syntheticProducer ? validateSyntheticProducer(run) : null;
  assert.deepEqual(Object.keys(run.sourceHashes).sort(), [...SOURCE_FILES].sort(), 'source inventory differs');
  const sources = [];
  for (const name of SOURCE_FILES) {
    const current = fs.readFileSync(path.join(path.dirname(ENTRY), name));
    const archived = fileBytes(path.join(directory, 'sources', name), 2 * 1024 * 1024);
    if (synthetic) {
      const executed = fileBytes(path.join(directory, 'execution-sources', name), 2 * 1024 * 1024);
      assert.equal(hash(executed), run.syntheticProducer.executionSourceHashes[name], `execution source hash differs: ${name}`);
      assert.equal(executed.toString('utf8').replace(/\r\n/g, '\n'), current.toString('utf8').replace(/\r\n/g, '\n'), `executed source differs beyond CRLF: ${name}`);
      let expected = profileSourceBytes(executed, synthetic.sourceLineEndings);
      if (run.syntheticProducer.sourceVariant === 'crlf') expected = profileSourceBytes(expected, 'crlf');
      if (run.syntheticProducer.sourceVariant === 'content-tamper') expected = Buffer.concat([expected, Buffer.from('// changed input\n')]);
      assert(archived.equals(expected), `synthetic archive source transform differs: ${name}`);
    }
    assert.equal(hash(archived), run.sourceHashes[name], `archived source differs: ${name}`);
    const archivedText = archived.toString('utf8');
    assert(Buffer.from(archivedText).equals(archived), `source is not valid UTF-8: ${name}`);
    assert.equal(archivedText.replace(/\r\n/g, '\n'), current.toString('utf8').replace(/\r\n/g, '\n'), `trusted verifier source differs beyond CRLF: ${name}`);
    sources.push({ file: name, archivedSha256: hash(archived), trustedSha256: hash(current), exact: archived.equals(current),
      crlfOnly: !archived.equals(current) });
  }
  return sources;
}

function validatePreflightSpecs(run, specs) {
  const schedule = fullSchedule();
  assert(Array.isArray(specs) && specs.length === schedule.length, 'preflight spec count differs');
  const paths = run.platform === 'win32' ? path.win32 : path.posix;
  validateProducerPath(run.outputDirectory, run.platform, 'preflight output path');
  validateProducerPath(run.entryPath, run.platform, 'preflight source path');
  assert.equal(paths.basename(run.entryPath), path.basename(ENTRY), 'preflight entrypoint differs');
  const nonces = new Set();
  for (const [index, entry] of schedule.entries()) {
    const spec = specs[index];
    identity(spec.id);
    assert.equal(spec.id.runId, run.runId);
    assert.equal(spec.id.caseId, entry.id);
    assert.equal(spec.id.generation, 'generation-1');
    assert(!nonces.has(spec.id.nonce), 'preflight nonce is reused');
    nonces.add(spec.id.nonce);
    const expected = { id: spec.id, scenario: entry.scenario, entryPath: run.entryPath,
      artifactDirectory: paths.join(run.outputDirectory, 'writer-artifacts', entry.id) };
    if (entry.id === 'D3v3-G1') expected.gates = { caller: true, writer: true };
    if (entry.id === 'D3v3-G2') expected.gates = { capture: true };
    if (entry.scenario === 'D3v3-10') {
      ownKeys(spec.command, ['file', 'args'], 'preflight missing command');
      validateProducerPath(spec.command.file, run.platform, 'preflight executable path');
      assert.equal(paths.dirname(spec.command.file), paths.join(run.outputDirectory, 'preflight'), 'missing command is outside preflight directory');
      assert(/^missing-[a-f0-9-]+$/.test(paths.basename(spec.command.file)), 'missing command identity differs');
      assert.deepEqual(spec.command.args, []);
      expected.command = spec.command;
    }
    assert.deepEqual(spec, expected, `preflight spec differs: ${entry.id}`);
  }
  return specs;
}

function verifyPublicationBinding(run, entry, spec, outer) {
  const paths = run.platform === 'win32' ? path.win32 : path.posix;
  const archiveAttemptId = `${entry.id}:archive:1`;
  const snapshotOrdinal = entry.group === 'publisher' ? 0 : outer.inputSnapshot.trace.at(-1)?.eventOrdinal ?? 0;
  let files;
  if (entry.group === 'publisher') {
    files = { 'fixture.json': json({ schema: 'diagnostic-settlement-publication-fixture-v3', id: spec.id, expectedScenario: entry.scenario }) };
  } else {
    const attempt = { schema: 'diagnostic-settlement-publication-attempt-v3', id: spec.id,
      archiveAttemptId, snapshotOrdinal, source: 'immutable-in-memory-snapshot', containsPublicationResult: false,
      sourceOwnerBlocked: outer.inputSnapshot.owner.blocked };
    files = archiveFiles(outer.inputSnapshot, attempt);
    assert.equal(outer.archivedSnapshotOrdinal, snapshotOrdinal, 'outer snapshot ordinal differs');
  }
  const expected = { id: spec.id, entryPath: run.entryPath, artifactDirectory: paths.join(run.outputDirectory, 'cases', entry.id),
    archiveAttemptId, snapshotOrdinal, payloadBase64: publicationPayload(spec.id, archiveAttemptId, snapshotOrdinal, files),
    scenario: entry.group === 'publisher' ? entry.scenario : 'publisher-normal',
    ...(entry.id === 'D3v3-G1' ? { gates: { publisher: true } } : {}) };
  assert.deepEqual(outer.publicationSnapshot.id, spec.id, 'publication identity differs from preflight');
  assert.deepEqual(outer.publicationSnapshot.spec, expected, 'publication spec differs from trusted schedule/preflight');
  assert.deepEqual(outer.finalPublicationSnapshot.spec, expected, 'final publication spec differs from preflight');
  const requests = outer.publicationSnapshot.requests;
  assert(Array.isArray(requests) && requests.length === 1, 'publication request count differs');
  const request = requests[0];
  validateRequest(request, 'publisher');
  assert.deepEqual(request.id, spec.id);
  assert.equal(request.scenario, expected.scenario);
  assert.equal(request.artifactDirectory, expected.artifactDirectory);
  assert.equal(request.payloadBase64, expected.payloadBase64, 'publication role received different bytes');
  return expected;
}

export function validateSavedSnapshot(snapshot) {
  ownKeys(snapshot, ['schema', 'id', 'spec', 'trace', 'reports', 'capture', 'owner', 'requests', 'gates', 'lateJournal', 'lateArchiveStatus'], 'saved snapshot');
  assert.equal(snapshot.schema, SCHEMA);
  identity(snapshot.id);
  assert.deepEqual(snapshot.spec.id, snapshot.id, 'snapshot spec identity differs');
  assert.deepEqual(snapshot.owner.id, snapshot.id, 'snapshot owner identity differs');
  assert(Array.isArray(snapshot.trace) && Array.isArray(snapshot.requests) && Array.isArray(snapshot.lateJournal), 'snapshot raw arrays are missing');
  assert(Array.isArray(snapshot.owner.roles), 'snapshot owner roles are missing');
  assert(snapshot.reports && typeof snapshot.reports === 'object' && !Array.isArray(snapshot.reports), 'snapshot reports are missing');
  assert.equal(snapshot.lateArchiveStatus, 'external-confirmation-required');
}

async function syntheticBlockedPublication(spec, pathStyle) {
  let time = 0n, timerId = 0;
  const timers = new Map(), queued = [];
  const clock = {
    nowNs: () => time,
    setTimeout: (callback, ms) => { const id = ++timerId; timers.set(id, { at: time + BigInt(Math.ceil(ms * 1e6)), callback }); return id; },
    clearTimeout: id => timers.delete(id), queueMicrotask: callback => queued.push(callback),
  };
  const flush = async () => { for (let n = 0; n < 16; n += 1) { while (queued.length) queued.shift()(); await Promise.resolve(); } };
  const stream = () => {
    const value = new EventEmitter();
    value.write = (_bytes, callback) => { callback?.(); return true; };
    value.end = () => value;
    value.destroy = () => { value.destroyed = true; value.emit('close'); return value; };
    value.pause = value.resume = value.unref = () => value;
    return value;
  };
  let child, request;
  const spawnRole = (role, input) => {
    assert.equal(role, 'publisher'); request = input;
    child = new EventEmitter(); child.pid = 4242;
    child.stdio = Array.from({ length: 5 }, stream);
    [child.stdin, child.stdout, child.stderr] = child.stdio;
    child.unref = () => child;
    child.kill = signal => {
      queued.push(() => { child.emit('exit', null, signal); for (const channel of [1, 2, 3]) { child.stdio[channel].emit('end'); child.stdio[channel].emit('close'); } child.emit('close', null, signal); });
      return true;
    };
    queued.push(() => child.emit('spawn'));
    return child;
  };
  const handle = core.startPublication(spec, { clock, spawnRole, pathStyle });
  await flush();
  for (const [index, [type, payload]] of [['start', { scenario: spec.scenario }], ['publish-entered', { mode: 'sync-block' }]].entries()) {
    time += 1_000_000n;
    const frame = { schema: FRAME_SCHEMA, role: 'publisher', runId: spec.id.runId, caseId: spec.id.caseId,
      generation: spec.id.generation, nonce: spec.id.nonce, attemptId: request.attemptId, requestId: request.requestId,
      sourceSequence: index + 1, sentNs: String(time), type, payload };
    child.stdout.emit('data', Buffer.from(`${JSON.stringify(frame)}\n`));
    await flush();
  }
  const next = [...timers.entries()].sort((a, b) => a[1].at < b[1].at ? -1 : 1)[0];
  assert(next && next[1].at === 1_000_000_000n, 'synthetic publisher work timer differs');
  time = next[1].at; timers.delete(next[0]); next[1].callback(); await flush();
  const report = await handle.publication;
  assert.equal(report.kind, 'incomplete');
  handle.recordConsumerAwait('publication');
  const snapshot = handle.getEvidenceSnapshot();
  assert(verifyPublicationSnapshot(snapshot).pass, 'synthetic publisher prerequisite does not pass independent replay');
  return snapshot;
}

async function evaluateArchiveFixture(fixture, output) {
  const { input } = fixture;
  if (fixture.operation === 'snapshot') { validateSavedSnapshot(input); return null; }
  if (fixture.operation === 'consumer') return verifyConsumerReceipts(input, ['publication']);
  if (fixture.operation === 'sources') return verifySources(path.join(output, input.directory), input.run);
  if (fixture.operation === 'publication-root') return verifyPublicationDirectory(path.join(output, input.directory), input.id);
  if (fixture.operation === 'binding') return verifyPublicationBinding(input.run, input.entry, input.spec, input.outer);
  if (fixture.operation === 'traversal') {
    const result = await verifyEvidence(path.join(output, input.directory));
    assert.equal(result.attempted, 42);
    assert.equal(result.verified, 1);
    assert(result.evidenceErrors.some(error => error.id === 'D3v3-01-1'), 'bad first case was not rejected');
    assert(!result.evidenceErrors.some(error => error.id === 'D3v3-P4'), 'last intact publisher was not verified');
    assert.equal(result.evidenceErrors.some(error => error.id === 'shared-manifest'), input.badRootManifest);
    if (input.swappedPublisher) assert(result.evidenceErrors.some(error => error.id === 'D3v3-P2'), 'cross-case publisher was accepted');
    return { attempted: result.attempted, verified: result.verified, evidenceErrors: result.evidenceErrors };
  }
  throw new Error('unknown archive fixture operation');
}

async function buildArchiveFixtures(metadata, sourceBytes, executionSourceBytes = null) {
  const paths = metadata.platform === 'win32' ? path.win32 : path.posix;
  const root = paths.join(metadata.outputDirectory, 'archive-fixtures');
  const tree = fixtureTree(), cases = [];
  const add = (id, operation, input, expectedAccepted = true) => cases.push({ id, operation, input, expectedAccepted });
  const directory = paths.join(root, 'traversal');
  for (const member of ['', 'sources', 'outer', 'cases', 'writer-artifacts', 'preflight']) tree.directory(`traversal${member ? `/${member}` : ''}`);
  const run = { ...metadata, mode: 'full', outputDirectory: directory, schedule: fullSchedule(), syntheticArchiveFixture: true,
    scope: 'Synthetic partial archive verifier fixture only; zero real Node cases, not a full matrix result.' };
  for (const name of SOURCE_FILES) tree.file(`traversal/sources/${name}`, sourceBytes[name]);
  if (executionSourceBytes) for (const name of SOURCE_FILES) tree.file(`traversal/execution-sources/${name}`, executionSourceBytes[name]);
  const specs = fullSchedule().map(entry => ({
    id: { schema: SCHEMA, runId: run.runId, caseId: entry.id, generation: 'generation-1', nonce: `${run.runId}:archive-fixture:${entry.id}` },
    scenario: entry.scenario, entryPath: metadata.entryPath, artifactDirectory: paths.join(directory, 'writer-artifacts', entry.id),
    ...(entry.id === 'D3v3-G1' ? { gates: { caller: true, writer: true } } : {}),
    ...(entry.id === 'D3v3-G2' ? { gates: { capture: true } } : {}),
    ...(entry.scenario === 'D3v3-10' ? { command: { file: paths.join(directory, 'preflight', `missing-${hash(`${run.runId}:${entry.id}`).slice(0, 32)}`), args: [] } } : {}),
  }));
  const entry = fullSchedule().at(-1), spec = specs.at(-1);
  const publicationSpec = { id: spec.id, entryPath: metadata.entryPath, artifactDirectory: paths.join(directory, 'cases', entry.id),
    archiveAttemptId: `${entry.id}:archive:1`, snapshotOrdinal: 0, scenario: entry.scenario,
    payloadBase64: publicationPayload(spec.id, `${entry.id}:archive:1`, 0, {
      'fixture.json': json({ schema: 'diagnostic-settlement-publication-fixture-v3', id: spec.id, expectedScenario: entry.scenario }),
    }) };
  const snapshot = await syntheticBlockedPublication(publicationSpec, producerPathStyle(metadata.platform));
  const outer = { entry, publicationSnapshot: snapshot, finalPublicationSnapshot: snapshot };
  tree.file('traversal/run.json', json(run));
  tree.file('traversal/specs.json', json(specs));
  tree.file(`traversal/outer/${entry.id}.json`, json(outer));
  tree.file('traversal/outer/D3v3-01-1.json', '{broken-first-case\n');
  tree.file('traversal/summary.json', json({ schema: SCHEMA, pass: false, synthetic: true,
    results: fullSchedule().map(item => ({ id: item.id, pass: item.id === entry.id })) }));
  treeManifest(tree, 'traversal/');
  add('bad-first-continues-through-last', 'traversal', { directory: 'archive-fixtures/traversal', badRootManifest: false });
  for (const [name, badRootManifest, swappedPublisher] of [['bad-root', true, false], ['swapped-publisher', false, true]]) {
    for (const [key, value] of [...tree.entries]) if (key === 'traversal' || key.startsWith('traversal/')) tree.entries.set(`${name}${key.slice('traversal'.length)}`, value);
    if (swappedPublisher) tree.file(`${name}/outer/D3v3-P2.json`, json({ ...outer, entry: fullSchedule().find(item => item.id === 'D3v3-P2') }));
    if (badRootManifest) tree.file(`${name}/manifest.json`, json({ schema: 'diagnostic-settlement-run-manifest-v3', entries: [] }));
    else treeManifest(tree, `${name}/`);
    add(name, 'traversal', { directory: `archive-fixtures/${name}`, badRootManifest, swappedPublisher });
  }
  add('complete-saved-envelope', 'snapshot', snapshot);
  for (const name of ['schema', 'id', 'owner', 'requests', 'lateJournal', 'gates']) {
    const input = structuredClone(snapshot); delete input[name];
    add(`missing-snapshot-${name}`, 'snapshot', input, false);
  }
  add('consumer-valid', 'consumer', snapshot);
  for (const kind of ['missing', 'duplicate', 'identity', 'deadline', 'before-freeze', 'deadline-first']) {
    const input = structuredClone(snapshot);
    const index = input.trace.findIndex(fact => fact.event === 'consumer-after-await');
    if (kind === 'missing') input.trace.splice(index, 1);
    if (kind === 'duplicate') input.trace.push(structuredClone(input.trace[index]));
    if (kind === 'identity') input.trace[index].details.reportId = 'foreign-report';
    if (kind === 'deadline') input.trace[index].receiptNs = input.reports.publication.deadlineNs;
    if (kind === 'before-freeze') input.trace[index].receiptNs = String(BigInt(input.reports.publication.frozenNs) - 1n);
    if (kind === 'deadline-first') input.reports.publication.deadlineNs = input.reports.publication.frozenNs;
    add(`consumer-${kind}`, 'consumer', input, kind === 'deadline-first');
  }
  for (const kind of ['early', 'deadline', 'late-freeze']) for (const [offset, delta] of [['minus-one', -1n], ['equal', 0n], ['plus-one', 1n]]) {
    const input = structuredClone(snapshot), report = input.reports.publication;
    const frozen = BigInt(report.frozenNs);
    report.deadlineNs = String(kind === 'early' ? frozen + 1_000_000_000n : kind === 'deadline' ? frozen : frozen - 1n);
    input.trace.find(fact => fact.event === 'consumer-after-await').receiptNs = String(frozen + BigInt(CONSUMER_POLICY.budgetNs) + delta);
    add(`consumer-budget-${kind}-${offset}`, 'consumer', input, delta < 0n);
  }
  for (const [offset, delta] of [['minus-one', -1n], ['equal', 0n], ['plus-one', 1n]]) {
    const input = structuredClone(snapshot), report = input.reports.publication;
    report.deadlineNs = String(BigInt(report.frozenNs) + 50_000_000n);
    input.trace.find(fact => fact.event === 'consumer-after-await').receiptNs = String(BigInt(report.deadlineNs) + delta);
    add(`consumer-original-deadline-${offset}`, 'consumer', input, delta < 0n);
  }
  add('publisher-preflight-binding', 'binding', { run, entry, spec, outer });
  add('publisher-case-swap-binding', 'binding', { run, entry: fullSchedule().find(item => item.id === 'D3v3-P2'), spec: specs.find(item => item.id.caseId === 'D3v3-P2'), outer }, false);
  for (const [name, mutate, accepted] of [['exact', bytes => bytes, true], ['crlf', bytes => Buffer.from(bytes.toString('utf8').replace(/\r\n/g, '\n').replace(/\n/g, '\r\n')), true],
    ['content-tamper', bytes => Buffer.concat([bytes, Buffer.from('// changed input\n')]), false]]) {
    tree.directory(`sources-${name}/sources`);
    const sourceRun = { ...metadata, sourceHashes: {} };
    if (metadata.syntheticProducer) sourceRun.syntheticProducer = { ...metadata.syntheticProducer, sourceVariant: name };
    for (const file of SOURCE_FILES) {
      const bytes = mutate(sourceBytes[file]);
      tree.file(`sources-${name}/sources/${file}`, bytes); sourceRun.sourceHashes[file] = hash(bytes);
      if (executionSourceBytes) tree.file(`sources-${name}/execution-sources/${file}`, executionSourceBytes[file]);
    }
    add(`source-${name}`, 'sources', { directory: `archive-fixtures/sources-${name}`, run: sourceRun }, accepted);
  }
  const publicationDirectory = paths.join(root, 'publication-target');
  tree.directory('publication-target');
  const bytes = Buffer.from('{}\n');
  tree.file('publication-target/fixture.json', bytes);
  tree.file('publication-target/manifest.json', json({ schema: PUBLICATION_MANIFEST, id: spec.id,
    archiveAttemptId: 'path-fixture', snapshotOrdinal: 0, entries: [{ path: 'fixture.json', bytes: bytes.length, sha256: hash(bytes) }] }));
  add('publication-real-root', 'publication-root', { directory: 'archive-fixtures/publication-target', id: spec.id });
  tree.symlink('publication-symlink', publicationDirectory, 'dir');
  add('publication-symlink-root', 'publication-root', { directory: 'archive-fixtures/publication-symlink', id: spec.id }, false);
  tree.directory('ancestor-target/publication-target');
  for (const [key, value] of [...tree.entries]) if (key.startsWith('publication-target/')) tree.entries.set(`ancestor-target/${key}`, value);
  tree.symlink('ancestor-symlink', paths.join(root, 'ancestor-target'), 'dir');
  add('publication-symlink-ancestor', 'publication-root', { directory: 'archive-fixtures/ancestor-symlink/publication-target', id: spec.id }, false);
  assert.deepEqual(cases.map(item => [item.id, item.operation, item.expectedAccepted]), ARCHIVE_FIXTURES, 'archive fixture schedule differs');
  return { tree, cases };
}

function archivedSourceBytes(output) {
  return Object.fromEntries(SOURCE_FILES.map(name => [name, fileBytes(path.join(output, 'sources', name), 2 * 1024 * 1024)]));
}

function archivedExecutionSourceBytes(output, metadata) {
  return metadata.syntheticProducer ? Object.fromEntries(SOURCE_FILES.map(name => [name, fileBytes(path.join(output, 'execution-sources', name), 2 * 1024 * 1024)])) : null;
}

export async function runArchiveSelfTests(output, metadata) {
  const { tree, cases } = await buildArchiveFixtures(metadata, archivedSourceBytes(output), archivedExecutionSourceBytes(output, metadata));
  materializeTree(path.join(output, 'archive-fixtures'), tree, metadata.syntheticProducer);
  for (const fixture of cases) {
    try { fixture.actual = { accepted: true, result: await evaluateArchiveFixture(fixture, output) }; }
    catch (error) { fixture.actual = { accepted: false, error: String(error.message) }; }
    fixture.pass = fixture.actual.accepted === fixture.expectedAccepted;
  }
  return { pass: cases.every(item => item.pass), attempted: cases.length, passed: cases.filter(item => item.pass).length,
    synthetic: true, realNodeCases: 0, cases };
}

function loadPublishedSnapshot(directory) {
  assertNoSymlinkAncestors(directory);
  const spec = readJSON(path.join(directory, 'spec.json'));
  const text = fileBytes(path.join(directory, 'trace.ndjson'), MAX_PUBLICATION).toString('utf8');
  assert(text.endsWith('\n'), 'truncated published trace');
  const trace = text.trimEnd().split('\n').map(line => JSON.parse(line));
  return { ...readJSON(path.join(directory, 'reports.json')), spec, trace };
}

function terminalClaim(snapshot, type) {
  const bytes = Buffer.concat(snapshot.trace.filter(fact => fact.event === 'stream-data' && fact.details.channel === 'stdout')
    .map(fact => Buffer.from(fact.details.bytesBase64, 'base64')));
  const frames = bytes.toString('utf8').trimEnd().split('\n').map(line => JSON.parse(line));
  const matching = frames.filter(frame => frame.type === type);
  assert.equal(matching.length, 1, 'terminal claim is not unique');
  return matching[0].payload;
}

function verifyGateOrdering(control) {
  if (control.entry.group !== 'gate') return;
  const caseTrace = control.finalCaseSnapshot.trace;
  const pubTrace = control.finalPublicationSnapshot.trace;
  const expected = control.entry.id === 'D3v3-G1'
    ? [['caller', 'observation'], ['writer', 'processSettlement'], ['publisher', 'evidenceSettlement']]
    : [['capture', 'processSettlement']];
  assert.deepEqual(control.gateObservations.map(item => [item.name, item.reportName]).sort(), [...expected].sort(), 'gate observation schedule differs');
  for (const [name, reportName] of expected) {
    const source = name === 'publisher' ? pubTrace : caseTrace;
    const held = source.find(fact => fact.event === 'gate-held' && fact.details.name === name);
    const consumer = caseTrace.find(fact => fact.event === 'consumer-after-await' && fact.details.name === reportName);
    const released = source.find(fact => fact.event === 'gate-released' && fact.details.name === name);
    assert(held && consumer && released, `gate was not physically established/consumed/released: ${name}`);
    assert(BigInt(held.receiptNs) <= BigInt(consumer.receiptNs) && BigInt(consumer.receiptNs) <= BigInt(released.receiptNs), `gate causal timing differs: ${name}`);
    if (name !== 'publisher') assert(held.eventOrdinal < consumer.eventOrdinal && consumer.eventOrdinal < released.eventOrdinal, `gate local order differs: ${name}`);
    const observed = control.gateObservations.find(item => item.name === name).observation;
    assert.equal(observed.kind, 'held');
    assert.deepEqual(observed.fact, held, 'waitForGate receipt differs from raw gate fact');
    if (name === 'capture') {
      const captured = caseTrace.find(fact => fact.event === 'capture-settled');
      assert(captured && captured.eventOrdinal > released.eventOrdinal, 'capture completed before its gate was released');
    }
  }
}

export function verifyConsumerReceipts(snapshot, names) {
  const receipts = [];
  const consumers = snapshot.trace.filter(fact => fact.event === 'consumer-after-await');
  assert(consumers.every(fact => names.includes(fact.details.name)), 'unexpected consumer report name');
  for (const name of names) {
    const report = snapshot.reports[name];
    assert(report, `missing consumer report: ${name}`);
    const matching = snapshot.trace.filter(fact => fact.event === 'consumer-after-await' && fact.details.name === name);
    assert.equal(matching.length, 1, `consumer receipt must be unique: ${name}`);
    const fact = matching[0];
    ownKeys(fact.details, ['name', 'reportId'], 'consumer receipt');
    assert.equal(fact.details.reportId, report.reportId, `consumer report identity differs: ${name}`);
    assert(fact.eventOrdinal > report.eventOrdinal, `consumer precedes report freeze: ${name}`);
    const received = BigInt(fact.receiptNs), frozen = BigInt(report.frozenNs), deadline = BigInt(report.deadlineNs);
    assert(received >= frozen, `consumer clock precedes report freeze: ${name}`);
    const beforeDeadline = frozen < deadline;
    const deliveryDeadline = frozen + BigInt(CONSUMER_POLICY.budgetNs);
    assert(received < deliveryDeadline, `consumer continuation reached or exceeded independent delivery deadline: ${name}`);
    if (beforeDeadline) assert(received < deadline, `consumer continuation reached or exceeded report deadline: ${name}`);
    receipts.push({ name, reportId: report.reportId, receiptFactId: fact.factId,
      policy: CONSUMER_POLICY.schema, deliveryDeadlineNs: String(deliveryDeadline),
      freezeDeadlineDeltaNs: String(frozen - deadline), frozenToConsumerNs: String(received - frozen),
      originalDeadlineRequired: beforeDeadline, status: 'within-consumer-budget' });
  }
  return receipts;
}

function canonicalFixtureOutcome(actual, operation, output, run) {
  const normalized = structuredClone(actual);
  const producerSourceHashes = run.syntheticProducer?.executionSourceHashes ?? run.sourceHashes;
  if (operation === 'sources' && normalized.accepted) normalized.result = normalized.result.map(item => ({ ...item,
    trustedSha256: producerSourceHashes[item.file], exact: item.archivedSha256 === producerSourceHashes[item.file],
    crlfOnly: item.archivedSha256 !== producerSourceHashes[item.file] }));
  const prefixes = [output, run.outputDirectory, run.syntheticProducer?.physicalOutputDirectory].filter(value => value !== undefined)
    .map(value => value.replaceAll('\\', '/').replace(/\/+/g, '/').replace(/\/$/, ''));
  return JSON.parse(JSON.stringify(normalized, (key, value) => {
    if (typeof value !== 'string' || !['error', 'artifactDirectory', 'outputDirectory', 'entryPath'].includes(key)) return value;
    const portable = value.replaceAll('\\', '/').replace(/\/+/g, '/');
    if (key === 'error') return prefixes.reduce((result, prefix) => result.replaceAll(`${prefix}/`, '<evidence>/'), portable);
    const prefix = prefixes.find(candidate => portable === candidate || portable.startsWith(`${candidate}/`));
    return prefix === undefined ? portable : `<evidence>${portable.slice(prefix.length)}`;
  }));
}

export function verifySourceFixtureResult(actual, replay, producerSourceHashes) {
  assert(Array.isArray(actual) && Array.isArray(replay), 'source fixture result is not an array');
  assert.deepEqual(actual.map(item => item.file), SOURCE_FILES, 'saved source result inventory differs');
  assert.deepEqual(replay.map(item => item.file), SOURCE_FILES, 'replayed source result inventory differs');
  for (const [index, item] of actual.entries()) {
    ownKeys(item, ['file', 'archivedSha256', 'trustedSha256', 'exact', 'crlfOnly'], 'saved source result');
    assert.equal(item.archivedSha256, replay[index].archivedSha256, `saved source archive bytes differ: ${item.file}`);
    assert.equal(item.trustedSha256, producerSourceHashes[item.file], `saved source trusted hash differs: ${item.file}`);
    assert.equal(item.exact, item.archivedSha256 === item.trustedSha256, `saved source exact flag differs: ${item.file}`);
    assert.equal(item.crlfOnly, !item.exact, `saved source difference flag differs: ${item.file}`);
  }
}

export function assessDiagnosticEvidence(entry, phase, snapshots, verifications) {
  const verified = snapshots.length === 2 && verifications.length === 2 && verifications.every(item => item.pass === true);
  const complete = verifications.length === 2 && verifications.every(item => item.errorDiagnosticsComplete === true);
  const intact = capacity => capacity?.omitted === false && capacity.fieldsTruncated === false;
  // Only the frozen bulk-overflow case expects source loss; loss of its proof is never exempt.
  const expectedOverflow = verified && entry.group === 'main' && entry.scenario === 'D3v3-08' && phase === 'case' &&
    snapshots.every(snapshot => {
      const owner = snapshot.owner;
      const evidence = snapshot.reports.evidenceSettlement;
      const overflow = owner?.traceCapacity?.overflow;
      return snapshot.spec?.scenario === entry.scenario && snapshot.spec.id.caseId === entry.id &&
        evidence.kind === 'incomplete' && evidence.incomplete.includes('trace-capacity') &&
        evidence.artifactVerified === true && evidence.helpers.length === 2 &&
        ['writer', 'verifier'].every(role => evidence.helpers.some(helper => helper.role === role &&
          helper.exit?.code === 0 && helper.exit.signal === null && helper.controlAttempts.length === 0 &&
          BigInt(helper.exit.receiptNs) < BigInt(evidence.deadlineNs) - 1_000_000_000n &&
          ['stdout', 'stderr', 'fd3'].every(channel => helper.streams[channel].end && !helper.streams[channel].cancelled))) &&
        overflow?.reason === 'trace-capacity' &&
        Number.isSafeInteger(overflow.firstOmittedOrdinal) && overflow.firstOmittedOrdinal > 0 &&
        snapshot.trace.some(fact => fact.event === 'trace-overflow' && fact.details.reason === overflow.reason &&
          fact.details.firstOmittedOrdinal === overflow.firstOmittedOrdinal && fact.eventOrdinal > overflow.firstOmittedOrdinal) &&
        owner.traceCapacity.controlOverflow === false && owner.lateCapacity.overflow === false &&
        intact(owner.listenerFailureCapacity) && owner.roles.every(role => intact(role.errorCapacity) &&
          ['stdout', 'stderr', 'fd3'].every(channel => intact(role.streams[channel].errorCapacity))) &&
        snapshot.trace.every(fact => !fact.details.truncatedFields?.length && !fact.details.error?.truncatedFields?.length);
    });
  const sufficient = verified && (complete || expectedOverflow);
  return { id: entry.id, phase, complete, sufficient,
    basis: !sufficient ? 'insufficient-evidence' : complete ? 'complete-error-diagnostics' : 'expected-trace-capacity' };
}

export function evaluateRunAcceptance(run, report) {
  const boundedConsumerDelivery = report.consumerDeliveries.length > 0 && report.consumerDeliveries.every(item =>
    item.receipts.every(receipt => receipt.status === 'within-consumer-budget'));
  const errorDiagnosticsComplete = report.errorDiagnostics.length > 0 && report.errorDiagnostics.every(item => item.complete);
  const scenarioEvidenceSufficient = report.errorDiagnostics.length > 0 && report.errorDiagnostics.every(item => item.sufficient);
  return { boundedConsumerDelivery, errorDiagnosticsComplete, scenarioEvidenceSufficient,
    acceptanceReady: run?.mode === 'full' && run.syntheticArchiveFixture !== true && !run.syntheticProducer &&
      report.pass && boundedConsumerDelivery && scenarioEvidenceSufficient };
}

export async function verifyEvidence(directory) {
  const report = { schema: SCHEMA, directory, attempted: 0, verified: 0, evidenceErrors: [], cases: [], consumerDeliveries: [], errorDiagnostics: [], pass: false };
  const selfTestCounts = {};
  try { report.manifest = verifyRunManifest(directory); }
  catch (error) { report.evidenceErrors.push({ id: 'shared-manifest', error: String(error.message) }); }
  let run;
  try {
    run = readJSON(path.join(directory, 'run.json')); report.sources = verifySources(directory, run);
    if (run.syntheticProducer) assert.equal(run.syntheticProducer.sourceVariant, 'profile', 'root archive has a non-root source transform');
  }
  catch (error) { report.evidenceErrors.push({ id: 'shared-input', error: String(error.message) }); }
  if (run?.mode === 'self-test') {
    for (const name of ['oracle', 'core', 'boundaries', 'files', 'archives']) {
      report.attempted += 1;
      try {
        const saved = parseUtf8(fileBytes(path.join(directory, `${name}-tests.json`), name === 'boundaries' ? 128 * 1024 * 1024 : 64 * 1024 * 1024), `${name} self-test`);
        assert(saved.pass && saved.attempted === saved.passed && Array.isArray(saved.cases), `${name} self-test failed`);
        assert.equal(saved.cases.length, saved.attempted, `${name} fixture inventory differs`);
        selfTestCounts[name] = { attempted: saved.attempted, passed: saved.passed };
        if (name === 'oracle') assert.deepEqual(saved, runOracleSelfTests(), 'saved oracle fixtures differ from trusted pure replay');
        if (name === 'core') assert.deepEqual(saved, await runCoreSelfTests(), 'saved virtual-clock fixtures differ from trusted replay');
        if (name === 'boundaries') assert.deepEqual(saved, await runBoundarySelfTests(), 'saved boundary fixtures differ from trusted replay');
        if (name === 'files') {
          ownKeys(saved, ['pass', 'attempted', 'passed', 'cases'], 'saved file test report');
          assert.deepEqual(saved.cases.map(entry => [entry.id, entry.expected]), FILE_FIXTURES, 'file fixture schedule differs');
          const trusted = buildFileFixtures(run.outputDirectory, fileFixtureIdentity(run), run.platform === 'win32' ? path.win32 : path.posix);
          verifyFixtureTree(path.join(directory, 'file-fixtures'), trusted.tree, 'file fixtures', run);
          for (const [index, entry] of saved.cases.entries()) {
            ownKeys(entry, ['id', 'request', 'expected', 'actual', 'pass'], 'saved file fixture');
            const { actual, pass, ...definition } = entry;
            assert.deepEqual(definition, trusted.cases[index], `file fixture input differs from trusted definition: ${entry.id}`);
            assert(pass && !actual.setupError, `file fixture not established: ${entry.id}`);
            if (entry.id === 'normal') {
              assert.equal(actual.result?.manifestSha256,
                hash(fileBytes(path.join(directory, 'file-fixtures', entry.id, 'manifest.json'), 512 * 1024)),
                `saved file manifest result differs: ${entry.id}`);
            }
            const request = { ...trusted.cases[index].request, artifactDirectory: path.join(directory, 'file-fixtures', entry.id) };
            let replay;
            try { replay = { accepted: true, result: verifyPayloadDirectory(request) }; }
            catch (error) { replay = { accepted: false, error: String(error.message) }; }
            assert.equal(replay.accepted, entry.expected === 'accept', `file fixture verdict differs: ${entry.id}`);
            assert.deepEqual(canonicalFixtureOutcome(actual, 'file', run.outputDirectory, run),
              canonicalFixtureOutcome(replay, 'file', directory, run), `saved file fixture outcome differs: ${entry.id}`);
          }
        }
        if (name === 'archives') {
          ownKeys(saved, ['pass', 'attempted', 'passed', 'synthetic', 'realNodeCases', 'cases'], 'saved archive test report');
          assert.equal(saved.synthetic, true);
          assert.equal(saved.realNodeCases, 0);
          assert.deepEqual(saved.cases.map(item => [item.id, item.operation, item.expectedAccepted]), ARCHIVE_FIXTURES, 'archive fixture schedule differs');
          const trusted = await buildArchiveFixtures(run, archivedSourceBytes(directory), archivedExecutionSourceBytes(directory, run));
          verifyFixtureTree(path.join(directory, 'archive-fixtures'), trusted.tree, 'archive fixtures', run);
          for (const [index, fixture] of saved.cases.entries()) {
            ownKeys(fixture, ['id', 'operation', 'input', 'expectedAccepted', 'actual', 'pass'], 'saved archive fixture');
            const { actual, pass, ...definition } = fixture;
            assert.deepEqual(definition, trusted.cases[index], `archive fixture input differs from trusted definition: ${fixture.id}`);
            assert(pass && !actual.setupError, `archive fixture not established: ${fixture.id}`);
            let replay;
            try { replay = { accepted: true, result: await evaluateArchiveFixture(trusted.cases[index], directory) }; }
            catch (error) { replay = { accepted: false, error: String(error.message) }; }
            assert.equal(replay.accepted, fixture.expectedAccepted, `archive fixture verdict differs: ${fixture.id}`);
            if (fixture.operation === 'sources' && replay.accepted) verifySourceFixtureResult(actual.result, replay.result, run.syntheticProducer?.executionSourceHashes ?? run.sourceHashes);
            assert.deepEqual(canonicalFixtureOutcome(actual, fixture.operation, directory, run),
              canonicalFixtureOutcome(replay, fixture.operation, directory, run), `saved archive fixture outcome differs: ${fixture.id}`);
          }
        }
        report.verified += 1;
      } catch (error) { report.evidenceErrors.push({ id: `${name}-self-test`, error: String(error.message) }); }
    }
  } else {
    const schedule = fullSchedule();
    let specs;
    try { assert.deepEqual(run?.schedule, schedule, 'run schedule differs'); }
    catch (error) { report.evidenceErrors.push({ id: 'schedule', error: String(error.message) }); }
    try { specs = validatePreflightSpecs(run, readJSON(path.join(directory, 'specs.json'))); }
    catch (error) { report.evidenceErrors.push({ id: 'preflight-specs', error: String(error.message) }); }
    for (const entry of schedule) {
      report.attempted += 1;
      const errors = [];
      try {
        const outer = readJSON(path.join(directory, 'outer', `${entry.id}.json`));
        assert.deepEqual(outer.entry, entry, 'outer schedule differs');
        validateSavedSnapshot(outer.publicationSnapshot);
        validateSavedSnapshot(outer.finalPublicationSnapshot);
        assert(specs, 'no verified preflight specs');
        const spec = specs[schedule.findIndex(item => item.id === entry.id)];
        verifyPublicationBinding(run, entry, spec, outer);
        const publication = verifyPublicationSnapshot(outer.publicationSnapshot);
        errors.push(...publication.errors.map(error => `publication:${error}`));
        assert.deepEqual(outer.finalPublicationSnapshot.reports, outer.publicationSnapshot.reports, 'publication first report was rewritten');
        assert.deepEqual(outer.finalPublicationSnapshot.trace.slice(0, outer.publicationSnapshot.trace.length), outer.publicationSnapshot.trace, 'publication facts were rewritten');
        const finalPublication = verifyPublicationSnapshot(outer.finalPublicationSnapshot);
        errors.push(...finalPublication.errors.map(error => `final-publication:${error}`));
        report.errorDiagnostics.push(assessDiagnosticEvidence(entry, 'publication',
          [outer.publicationSnapshot, outer.finalPublicationSnapshot], [publication, finalPublication]));
        report.consumerDeliveries.push({ id: entry.id, phase: 'publication', receipts: verifyConsumerReceipts(outer.finalPublicationSnapshot, ['publication']) });
        if (entry.group !== 'publisher') {
          const snapshot = loadPublishedSnapshot(path.join(directory, 'cases', entry.id));
          validateSavedSnapshot(snapshot);
          validateSavedSnapshot(outer.inputSnapshot);
          validateSavedSnapshot(outer.finalCaseSnapshot);
          assert.deepEqual(snapshot, outer.inputSnapshot, 'published snapshot differs from outer input');
          assert.deepEqual(snapshot.spec, spec, 'case spec differs from preflight');
          assert.deepEqual(outer.finalCaseSnapshot.spec, spec, 'final case spec differs from preflight');
          assert.equal(snapshot.spec.id.caseId, entry.id);
          assert.equal(snapshot.spec.id.runId, run.runId);
          assert.equal(snapshot.spec.scenario, entry.scenario);
          const caseResult = verifySavedCase(snapshot);
          errors.push(...caseResult.errors);
          assert.deepEqual(outer.finalCaseSnapshot.reports, snapshot.reports, 'case first reports were rewritten');
          assert.deepEqual(outer.finalCaseSnapshot.trace.slice(0, snapshot.trace.length), snapshot.trace, 'case facts were rewritten after publication');
          const finalCase = verifySavedCase(outer.finalCaseSnapshot);
          errors.push(...finalCase.errors.map(error => `final-case:${error}`));
          report.errorDiagnostics.push(assessDiagnosticEvidence(entry, 'case',
            [snapshot, outer.finalCaseSnapshot], [caseResult, finalCase]));
          report.consumerDeliveries.push({ id: entry.id, phase: 'case', receipts: verifyConsumerReceipts(outer.finalCaseSnapshot, ['observation', 'processSettlement', 'evidenceSettlement']) });
          verifyGateOrdering(outer);
          assert.equal(outer.publicationSnapshot.reports.publication.kind, 'published', 'case publisher did not complete');
          const archive = verifyPublicationDirectory(path.join(directory, 'cases', entry.id), snapshot.spec.id, outer.publicationSnapshot.spec);
          assert.deepEqual(terminalClaim(outer.publicationSnapshot, 'publish-claim'), archive, 'publication claim differs from actual archive');
          if (snapshot.reports.evidenceSettlement.artifactVerified) {
            const request = snapshot.requests.find(item => item.role === 'verifier');
            assert(request, 'verified artifact lacks a verifier request');
            const payload = verifyPayloadDirectory({ ...request, artifactDirectory: path.join(directory, 'writer-artifacts', entry.id) });
            const verifierTrace = { trace: snapshot.trace.filter(fact => fact.role === 'verifier') };
            assert.deepEqual(terminalClaim(verifierTrace, 'verified'), payload, 'verified claim differs from actual payload');
          }
          const attempt = readJSON(path.join(directory, 'cases', entry.id, 'publication-attempt.json'));
          assert.equal(attempt.snapshotOrdinal, outer.archivedSnapshotOrdinal, 'archive boundary differs');
          assert.equal(attempt.containsPublicationResult, false, 'publisher payload claims its own success');
          report.cases.push({ id: entry.id, archive, errors });
        } else {
          if (entry.scenario === 'publisher-normal') {
            const archive = verifyPublicationDirectory(path.join(directory, 'cases', entry.id), outer.publicationSnapshot.id, outer.publicationSnapshot.spec);
            assert.deepEqual(terminalClaim(outer.publicationSnapshot, 'publish-claim'), archive, 'publisher fixture claim differs from actual archive');
          }
          report.cases.push({ id: entry.id, errors });
        }
        assert(errors.length === 0, errors.join('; '));
        report.verified += 1;
      } catch (error) { report.evidenceErrors.push({ id: entry.id, error: String(error.message) }); }
    }
  }
  try {
    const summary = readJSON(path.join(directory, 'summary.json'));
    assert.equal(summary.schema, SCHEMA);
    assert.equal(summary.pass, true, 'saved summary reports failure');
    if (run?.mode === 'self-test') {
      ownKeys(summary, ['schema', 'mode', 'pass', 'counts', 'realNodeCases', 'nativeProcesses', 'pty'], 'self-test summary');
      assert.equal(summary.mode, 'self-test');
      assert.deepEqual(summary.counts, selfTestCounts, 'saved self-test counts differ from independent groups');
      assert.equal(summary.realNodeCases, 0); assert.equal(summary.nativeProcesses, 0); assert.equal(summary.pty, false);
    }
    if (run?.mode === 'full') assert.deepEqual(summary.results.map(item => item.id), fullSchedule().map(item => item.id), 'summary schedule differs');
  } catch (error) { report.evidenceErrors.push({ id: 'summary', error: String(error.message) }); }
  report.pass = report.attempted > 0 && report.verified === report.attempted && report.evidenceErrors.length === 0;
  Object.assign(report, evaluateRunAcceptance(run, report));
  return report;
}

async function main() {
  const { values } = parseArgs({ options: {
    role: { type: 'string' }, output: { type: 'string' }, 'self-test': { type: 'boolean', default: false },
    'verify-saved': { type: 'string' }, help: { type: 'boolean', default: false },
  }, strict: true });
  if (values.help) {
    process.stdout.write('D3 v3: --output NEW_DIRECTORY | --self-test --output NEW_DIRECTORY | --verify-saved DIRECTORY\n');
    return;
  }
  if (values.role) { await runRole(values.role); return; }
  let result;
  if (values['verify-saved']) {
    assert(!values.output && !values['self-test'], 'verify-saved cannot run a new experiment');
    result = await verifyEvidence(path.resolve(values['verify-saved']));
  } else {
    assert(values.output, '--output requires a new evidence directory');
    const output = path.resolve(values.output);
    result = values['self-test'] ? await runSelfTests(output) : await runEvidence(output);
  }
  process.stdout.write(`${json(result)}`);
  if (!result.pass) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === ENTRY) main().catch(error => {
  process.stderr.write(`${String(error.stack ?? error)}\n`);
  process.exitCode = 1;
});
