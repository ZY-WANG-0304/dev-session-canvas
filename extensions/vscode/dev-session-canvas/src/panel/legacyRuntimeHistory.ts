import { constants, type BigIntStats } from 'fs';
import * as fs from 'fs/promises';
import * as net from 'net';
import * as path from 'path';

import type { ExecutionNodeKind } from '../common/protocol';
import { resolveLegacyRuntimeSupervisorPathsFromStorageDir,
  resolveSystemdUserRuntimeSupervisorPathsFromStorageDir } from '../common/runtimeSupervisorPaths';
import { linuxRuntimeSocketAbsent, noLinuxRuntimeSupervisor } from './linuxRuntimeHistoryObservation';
import { observeInactiveSystemdUserSupervisor, type RuntimeHostBackend } from './runtimeHostBackend';

const LEGACY_HISTORY_GENERATIONS = new Set(['agent-provider-lifecycle-v1', 'terminal-stream-v1']);
const LEGACY_SESSION_LIFECYCLES: Record<ExecutionNodeKind, ReadonlySet<string>> = {
  agent: new Set(['idle', 'starting', 'waiting-input', 'running', 'resuming', 'resume-ready', 'resume-failed',
    'suspended', 'stopping', 'stopped', 'error', 'interrupted']),
  terminal: new Set(['idle', 'launching', 'live', 'stopping', 'closed', 'error', 'interrupted'])
};
const MAX_REGISTRY_BYTES = 32 * 1024 * 1024;
const SOCKET_OBSERVATION_TIMEOUT_MS = 1000;

export type LegacyRuntimeHistoryEvidence = 'recorded-exit' | 'stopped-runtime' | 'detached-recovered-history';

export async function inspectStoppedLegacyRuntimeSession(
  backend: RuntimeHostBackend,
  session: { sessionId: string; kind: ExecutionNodeKind }, signal?: AbortSignal
): Promise<LegacyRuntimeHistoryEvidence | undefined> {
  if (process.platform !== 'linux' || !['systemd-user', 'legacy-detached'].includes(backend.kind) || signal?.aborted || !session.sessionId
    || !['agent', 'terminal'].includes(session.kind)) return undefined;
  try {
    const storageDir = backend.paths.storageDir;
    const generationDir = path.dirname(storageDir);
    if (!path.isAbsolute(storageDir) || path.resolve(storageDir) !== storageDir
      || path.basename(storageDir) !== 'runtime-supervisor'
      || !LEGACY_HISTORY_GENERATIONS.has(path.basename(generationDir))
      || path.basename(path.dirname(generationDir)) !== 'runtime-supervisor-generations'
      || await fs.realpath(storageDir) !== storageDir || signal?.aborted) return undefined;
    const detached = backend.kind === 'legacy-detached';
    const expected = detached ? resolveLegacyRuntimeSupervisorPathsFromStorageDir(storageDir)
      : resolveSystemdUserRuntimeSupervisorPathsFromStorageDir(storageDir);
    const pathKeys = detached ? ['registryPath', 'socketPath', 'runtimeDir', 'socketLocation']
      : ['registryPath', 'socketPath', 'unitName', 'unitFilePath'];
    if (pathKeys.some(key =>
      backend.paths[key as keyof typeof expected] !== expected[key as keyof typeof expected])) return undefined;

    const before = detached ? undefined : await observeInactiveSystemdUserSupervisor(backend);
    if (detached ? !await noLinuxRuntimeSupervisor(storageDir, signal)
        || !await linuxRuntimeSocketAbsent(backend.paths.socketPath, signal)
      : !before || !await observeSocketAbsent(backend.paths.socketPath)) return undefined;
    if (signal?.aborted) return undefined;
    const observedRegistry = await readStableRegistry(backend.paths.registryPath, signal);
    if (!observedRegistry) return undefined;
    const registry = observedRegistry.value;
    if (!isRecord(registry) || registry.version !== 1 || !Array.isArray(registry.sessions)) return undefined;
    const matching = registry.sessions.filter(entry => isRecord(entry) && entry.sessionId === session.sessionId);
    if (matching.length !== 1) return undefined;
    const target = matching[0] as Record<string, unknown>;
    if (target.kind !== session.kind || target.runtimeBackend !== backend.kind || typeof target.live !== 'boolean'
      || typeof target.lifecycle !== 'string' || !LEGACY_SESSION_LIFECYCLES[session.kind].has(target.lifecycle)
      || (target.lastExitCode !== undefined && !Number.isSafeInteger(target.lastExitCode))) return undefined;
    if (detached) {
      const descriptor = target.lastExitMessageDescriptor;
      if (target.live !== false || target.lifecycle !== (session.kind === 'agent' ? 'stopped' : 'closed')
        || !isRecord(descriptor) || descriptor.id !== 'recoveredHistoryOnly'
        || (descriptor.params !== undefined && (!isRecord(descriptor.params)
          || Object.values(descriptor.params).some(value => typeof value !== 'string')))
        || (target.lastExitSignal !== undefined && typeof target.lastExitSignal !== 'string')
        || (target.runtimeGuarantee !== undefined && target.runtimeGuarantee !== 'best-effort')) return undefined;
      return await noLinuxRuntimeSupervisor(storageDir, signal) && await linuxRuntimeSocketAbsent(backend.paths.socketPath, signal)
        && await fs.realpath(storageDir) === storageDir
        && sameFile(observedRegistry.stat, await fs.lstat(backend.paths.registryPath, { bigint: true }))
        && !signal?.aborted ? 'detached-recovered-history' : undefined;
    }
    const recordedExit = target.live === false && target.lifecycle === (session.kind === 'agent' ? 'stopped' : 'closed')
      && Number.isSafeInteger(target.lastExitCode);
    const evidence = recordedExit ? 'recorded-exit' : before!.controlGroupStopped ? 'stopped-runtime' : undefined;
    if (!evidence) return undefined;
    // This authorizes local history cleanup only, not an RPC acknowledgment or terminal EOF.
    const after = await observeInactiveSystemdUserSupervisor(backend);
    return before!.stateToken === after?.stateToken && await observeSocketAbsent(backend.paths.socketPath)
      && sameFile(observedRegistry.stat, await fs.lstat(backend.paths.registryPath, { bigint: true }))
      && !signal?.aborted ? evidence : undefined;
  } catch {
    return undefined;
  }
}

async function observeSocketAbsent(socketPath: string): Promise<boolean> {
  return new Promise(resolve => {
    const socket = net.createConnection(socketPath);
    let settled = false;
    const timer = setTimeout(() => finish(false), SOCKET_OBSERVATION_TIMEOUT_MS);
    const finish = (absent: boolean): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      resolve(absent);
    };
    socket.once('connect', () => finish(false));
    socket.once('error', error => finish(['ECONNREFUSED', 'ENOENT'].includes((error as NodeJS.ErrnoException).code ?? '')));
  });
}

async function readStableRegistry(registryPath: string, signal?: AbortSignal): Promise<{ value: unknown; stat: BigIntStats } | undefined> {
  if (signal?.aborted) return undefined;
  const before = await fs.lstat(registryPath, { bigint: true });
  if (!before.isFile() || before.size <= 0n || before.size > BigInt(MAX_REGISTRY_BYTES)) return undefined;
  const handle = await fs.open(registryPath, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    if (!sameFile(before, await handle.stat({ bigint: true }))) return undefined;
    const bytes = Buffer.alloc(Number(before.size) + 1);
    let offset = 0;
    while (offset < bytes.length && !signal?.aborted) {
      const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset);
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    if (signal?.aborted || offset !== Number(before.size) || !sameFile(before, await handle.stat({ bigint: true }))
      || !sameFile(before, await fs.lstat(registryPath, { bigint: true }))) return undefined;
    return { value: JSON.parse(bytes.subarray(0, offset).toString('utf8')), stat: before };
  } finally {
    await handle.close();
  }
}

function sameFile(left: BigIntStats, right: BigIntStats): boolean {
  return right.isFile() && left.dev === right.dev && left.ino === right.ino && left.size === right.size
    && left.mtimeNs === right.mtimeNs && left.ctimeNs === right.ctimeNs;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
