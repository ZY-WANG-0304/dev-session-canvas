import { randomUUID } from 'crypto';
import { constants } from 'fs';
import * as fs from 'fs/promises';
import * as path from 'path';

import type { RuntimeHostBackendKind } from '../common/protocol';
import {
  parseRuntimeOwnerDescriptor,
  resolveRuntimeRootOwnerGlobalStoragePath,
  runtimeOwnerDescriptorsEqual,
  type RuntimeOwnerDescriptorV1
} from '../common/runtimeRootOwnership';

const INTENT_FILE = 'startup-intent.json';
const STARTED_FILE = 'startup-started.json';
const MAX_RECORD_BYTES = 16 * 1024;
const TOKEN_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const INTENT_FIELDS = ['schema', 'token', 'backend', 'owner', 'compatibilityFingerprint'];

export interface RuntimeRootStartupIntentV1 {
  readonly schema: 1;
  readonly token: string;
  readonly backend: RuntimeHostBackendKind;
  readonly owner: RuntimeOwnerDescriptorV1;
  readonly compatibilityFingerprint: string;
}

export type RuntimeRootStartupObservation =
  | { kind: 'fresh' }
  | { kind: 'previous-started'; intent: RuntimeRootStartupIntentV1 }
  | { kind: 'unknown'; reason: 'invalid-record' | 'missing-started' | 'mismatched-started' | 'orphan-started' };

export function createRuntimeRootStartupIntent(
  owner: RuntimeOwnerDescriptorV1,
  backend: RuntimeHostBackendKind,
  compatibilityFingerprint: string
): RuntimeRootStartupIntentV1 {
  return parseIntent({ schema: 1, token: randomUUID(), backend, owner, compatibilityFingerprint });
}

export async function readRuntimeRootStartupIntent(
  storageDir: string,
  owner: RuntimeOwnerDescriptorV1
): Promise<RuntimeRootStartupIntentV1 | undefined> {
  const base = await privateBase(storageDir, owner);
  return readIntent(base, owner);
}

export function assertRuntimeRootStartupIntentMatches(
  value: unknown,
  expected: Omit<RuntimeRootStartupIntentV1, 'schema'>
): asserts value is RuntimeRootStartupIntentV1 {
  const intent = parseIntent(value);
  if (intent.token !== expected.token || intent.backend !== expected.backend ||
      intent.compatibilityFingerprint !== expected.compatibilityFingerprint ||
      !runtimeOwnerDescriptorsEqual(intent.owner, expected.owner)) {
    throw new Error('Runtime startup intent does not match this launch.');
  }
}

// The caller must hold preparation ownership; previous-started still requires a separate runtime claim probe.
export async function writeRuntimeRootStartupIntent(storageDir: string, value: RuntimeRootStartupIntentV1): Promise<void> {
  const intent = parseIntent(value);
  const base = await privateBase(storageDir, intent.owner);
  const previous = await inspectRuntimeRootStartup(storageDir, intent.owner);
  if (previous.kind === 'unknown' || (previous.kind === 'previous-started' && previous.intent.token === intent.token)) {
    throw new Error('Runtime startup intent cannot replace an unknown launch or reuse its token.');
  }
  await writeRecord(base, INTENT_FILE, intent);
}

// Only the Supervisor holding runtime ownership may publish this receipt, before cleanup or listening.
export async function writeRuntimeRootStartupStarted(storageDir: string, value: RuntimeRootStartupIntentV1): Promise<void> {
  const intent = parseIntent(value);
  const base = await privateBase(storageDir, intent.owner);
  assertRuntimeRootStartupIntentMatches(await readIntent(base, intent.owner), intent);
  const previous = await readStarted(base);
  if (previous && !runtimeOwnerDescriptorsEqual(previous.owner, intent.owner)) {
    throw new Error('Runtime startup started receipt belongs to another owner.');
  }
  if (previous?.token === intent.token) throw new Error('Runtime startup token has already been consumed.');
  await writeRecord(base, STARTED_FILE, { ...intent, state: 'started' });
}

export async function inspectRuntimeRootStartup(
  storageDir: string,
  owner: RuntimeOwnerDescriptorV1
): Promise<RuntimeRootStartupObservation> {
  try {
    const base = await privateBase(storageDir, owner);
    const intent = await readIntent(base, owner);
    const started = await readStarted(base);
    if (!intent) return started === undefined ? { kind: 'fresh' } : { kind: 'unknown', reason: 'orphan-started' };
    if (started === undefined) return { kind: 'unknown', reason: 'missing-started' };
    try { assertRuntimeRootStartupIntentMatches(started, intent); }
    catch { return { kind: 'unknown', reason: 'mismatched-started' }; }
    return { kind: 'previous-started', intent };
  } catch {
    return { kind: 'unknown', reason: 'invalid-record' };
  }
}

async function readIntent(base: string, owner: RuntimeOwnerDescriptorV1): Promise<RuntimeRootStartupIntentV1 | undefined> {
  const value = await readRecord(path.join(base, INTENT_FILE));
  if (value === undefined) return undefined;
  const intent = parseIntent(value);
  if (!runtimeOwnerDescriptorsEqual(intent.owner, owner)) throw new Error('Runtime startup intent belongs to another owner.');
  return intent;
}

async function readStarted(base: string): Promise<RuntimeRootStartupIntentV1 | undefined> {
  const value = await readRecord(path.join(base, STARTED_FILE));
  if (value === undefined) return undefined;
  if (!hasFields(value, [...INTENT_FIELDS, 'state']) || value.state !== 'started') {
    throw new Error('Invalid runtime startup started receipt.');
  }
  const { state: _state, ...intent } = value;
  return parseIntent(intent);
}

function parseIntent(value: unknown): RuntimeRootStartupIntentV1 {
  if (!hasFields(value, INTENT_FIELDS) || value.schema !== 1 ||
      typeof value.token !== 'string' || !TOKEN_PATTERN.test(value.token) ||
      !['legacy-detached', 'systemd-user'].includes(value.backend as string) ||
      typeof value.compatibilityFingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(value.compatibilityFingerprint)) {
    throw new Error('Invalid runtime startup intent.');
  }
  const owner = parseRuntimeOwnerDescriptor(value.owner);
  return Object.freeze({ schema: 1, token: value.token, backend: value.backend as RuntimeHostBackendKind,
    owner: Object.freeze({ ...owner, root: Object.freeze(owner.root) }), compatibilityFingerprint: value.compatibilityFingerprint });
}

async function privateBase(storageDir: string, owner: RuntimeOwnerDescriptorV1): Promise<string> {
  resolveRuntimeRootOwnerGlobalStoragePath(storageDir, owner);
  const base = path.dirname(path.resolve(storageDir));
  const canonical = await fs.realpath(base);
  if ((process.platform === 'win32' ? canonical.toLowerCase() !== base.toLowerCase() : canonical !== base)) {
    throw new Error('Runtime startup storage must be canonical.');
  }
  const stat = await fs.stat(base);
  if (!stat.isDirectory()) throw new Error('Runtime startup storage must be a directory.');
  assertPrivate(stat, 0o700);
  return base;
}

async function readRecord(filename: string): Promise<unknown | undefined> {
  let handle: fs.FileHandle | undefined;
  try {
    const before = await fs.lstat(filename);
    if (!before.isFile() || before.nlink !== 1 || before.size > MAX_RECORD_BYTES) {
      throw new Error('Runtime startup record must be a bounded regular private file.');
    }
    assertPrivate(before, 0o600);
    handle = await fs.open(filename, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const opened = await handle.stat();
    if (opened.dev !== before.dev || opened.ino !== before.ino) throw new Error('Runtime startup record changed while opening.');
    const buffer = Buffer.alloc(MAX_RECORD_BYTES + 1);
    let size = 0;
    while (size < buffer.length) {
      const { bytesRead } = await handle.read(buffer, size, buffer.length - size, size);
      if (bytesRead === 0) break;
      size += bytesRead;
    }
    if (size > MAX_RECORD_BYTES) throw new Error('Runtime startup record exceeds its byte limit.');
    return JSON.parse(buffer.toString('utf8', 0, size));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  } finally {
    await handle?.close();
  }
}

async function writeRecord(base: string, name: string, value: object): Promise<void> {
  const filename = path.join(base, name);
  const encoded = JSON.stringify(value);
  if (Buffer.byteLength(encoded) > MAX_RECORD_BYTES) throw new Error('Runtime startup record exceeds its byte limit.');
  await readRecord(filename);
  const temporary = `${filename}.${randomUUID()}.tmp`;
  const handle = await fs.open(temporary, 'wx', 0o600);
  try {
    await handle.writeFile(encoded, 'utf8');
    await handle.sync();
    await handle.close();
    await fs.rename(temporary, filename);
  } finally {
    await handle.close();
    await fs.rm(temporary, { force: true });
  }
}

function assertPrivate(stat: { uid: number; mode: number }, mode: number): void {
  if (process.platform !== 'win32' && (stat.uid !== process.getuid?.() || (stat.mode & 0o7777) !== mode)) {
    throw new Error('Runtime startup storage must be private to the current OS user.');
  }
}

function hasFields(value: unknown, fields: readonly string[]): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' ||
      (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) return false;
  const keys = Reflect.ownKeys(value);
  return keys.length === fields.length && keys.every(key => {
    const field = Object.getOwnPropertyDescriptor(value, key);
    return typeof key === 'string' && fields.includes(key) && field?.enumerable && 'value' in field;
  });
}
