import * as fs from 'fs/promises';
import * as path from 'path';
import { createHash, randomUUID } from 'crypto';
import { RUNTIME_SUPERVISOR_ERROR_CODES } from '../common/runtimeSupervisorProtocol';
import type { RuntimeHostBackendKind, ExecutionNodeKind } from '../common/protocol';
import type { RuntimeOwnerDescriptorV1 } from '../common/runtimeRootOwnership';

export function isRuntimeConnectionUnavailable(error: unknown): error is Error {
  return error instanceof Error && ['ENOENT', 'ECONNREFUSED', 'ECONNRESET', 'EPIPE', 'ETIMEDOUT',
    RUNTIME_SUPERVISOR_ERROR_CODES.clientConnectionClosed].includes((error as NodeJS.ErrnoException).code ?? '');
}

export interface DisconnectedRuntimeDeletionRecord {
  nodeId: string;
  kind: ExecutionNodeKind;
  sessionId: string;
  backendKind: RuntimeHostBackendKind;
  runtimeStoragePath: string;
  runtimeOwner?: RuntimeOwnerDescriptorV1;
  reason: string;
}

/** A durable stop-unconfirmed receipt, not proof of node persistence or process exit. */
export async function recordDisconnectedRuntimeDeletion(
  globalStoragePath: string, record: DisconnectedRuntimeDeletionRecord
): Promise<string> {
  const directory = path.join(globalStoragePath, 'unconfirmed-runtime-deletions-v1');
  const digest = createHash('sha256').update(JSON.stringify([
    record.nodeId, record.kind, record.backendKind, record.runtimeStoragePath, record.sessionId, record.runtimeOwner
  ])).digest('hex');
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const filename = path.join(directory, `${digest}.json`);
  const temporary = path.join(directory, `.${digest}-${randomUUID()}.tmp`);
  try {
    const file = await fs.open(temporary, 'wx', 0o600);
    try {
      await file.writeFile(JSON.stringify({ version: 1, status: 'runtime-stop-unconfirmed',
        recordedAt: new Date().toISOString(), ...record }, null, 2));
      await file.sync();
    } finally { await file.close(); }
    await fs.rename(temporary, filename);
  } finally { await fs.rm(temporary, { force: true }); }
  return filename;
}
