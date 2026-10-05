import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import * as path from 'node:path';

import { EXECUTION_CANDIDATE_BUDGETS, EXECUTION_CANDIDATE_PROFILE, normalizeExecutionAdmissionLimits,
  type ExecutionAdmissionLimits, type ExecutionCandidateMode, type ExecutionIdentity } from '../common/executionLifecycle';
import type { LinuxExecutionOwnerOptions } from './executionOwnerLifecycle';
import { createExecutionProviderTransport, createNodeExecutionScheduler } from './executionProviderTransport';
import type { ExecutionScheduler } from './executionSessionAdapter';
import { assertExecutionAssetRuntime, assertMinimumExecutionLibraryVersion } from './executionAssetCompatibility';
import { readLinuxRuntimeGlibcVersion } from './linuxExecutionRuntimeCompatibility';

declare const __DEV_SESSION_CANVAS_EXECUTION_ADMISSION__: ExecutionAdmissionLimits | undefined;

export const LINUX_EXECUTION_NATIVE_EXPORTS = Object.freeze([
  'executionClaimNamespace', 'executionClose', 'executionConfigure', 'executionPollWait', 'executionRead', 'executionResize',
  'executionSignal', 'executionSnapshot', 'executionWrite', 'fork'
]);
export const LINUX_EXECUTION_ASSET_DIRECTORY = 'native/linux-execution-candidate/linux-x64-glibc';

export interface LinuxExecutionProviderAssets {
  readonly entryPoint: string;
  readonly binaryPath: string;
  readonly binarySha256: string;
  readonly manifestSha256: string;
  readonly entrySha256: string;
}

const digest = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');
const record = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid Linux candidate manifest.');
  return value as Record<string, unknown>;
};

function readAsset(file: string, maximumBytes: number): Buffer {
  const stat = lstatSync(file);
  if (!stat.isFile() || stat.size < 1 || stat.size > maximumBytes) throw new Error(`Invalid Linux candidate asset: ${file}`);
  return readFileSync(file);
}

export function resolveLinuxExecutionProviderAssets(distDirectory: string): LinuxExecutionProviderAssets {
  if (process.platform !== 'linux' || !['x64', 'arm64'].includes(process.arch)) {
    throw new Error('Linux candidate assets require Linux x64 or arm64.');
  }
  if (!path.isAbsolute(distDirectory)) throw new Error('An absolute extension dist directory is required.');
  const dist = realpathSync(distDirectory);
  const directory = path.join(dist, `native/linux-execution-candidate/linux-${process.arch}-glibc`);
  if (realpathSync(directory) !== directory) throw new Error('Linux candidate asset directories must not be redirected.');
  const manifestBytes = readAsset(path.join(directory, 'manifest.json'), 32768);
  const manifest = record(JSON.parse(manifestBytes.toString('utf8')));
  if (manifest.schemaVersion !== 2 || manifest.profile !== EXECUTION_CANDIDATE_PROFILE ||
      manifest.platform !== 'linux' || manifest.arch !== process.arch) throw new Error('Linux candidate manifest target mismatch.');
  const libc = record(manifest.libc);
  const requirements = record(manifest.requirements);
  const linux = record(requirements.linux);
  if (libc.name !== 'glibc' || linux.libc !== 'glibc') throw new Error('Linux candidate assets require glibc.');
  assertMinimumExecutionLibraryVersion(libc.version, libc.version);
  assertMinimumExecutionLibraryVersion(linux.glibcMinimum, linux.glibcMinimum);
  // The provider's dynamic loader checks these independently before acquiring a PTY.
  for (const key of ['glibcxxMinimum', 'cxxabiMinimum']) {
    assertMinimumExecutionLibraryVersion(linux[key], linux[key]);
  }
  assertExecutionAssetRuntime(record(manifest.runtime), requirements.napi);
  assertMinimumExecutionLibraryVersion(readLinuxRuntimeGlibcVersion(), linux.glibcMinimum);
  const binary = record(manifest.binary);
  if (binary.file !== 'execution-owner.node' || typeof binary.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(binary.sha256)) {
    throw new Error('Invalid Linux candidate binary descriptor.');
  }
  const binaryPath = path.join(directory, binary.file);
  const bytes = readAsset(binaryPath, 32 * 1024 * 1024);
  if (digest(bytes) !== binary.sha256 || bytes.length < 64 ||
      !bytes.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46])) || bytes[4] !== 2 || bytes[5] !== 1 ||
      bytes.readUInt16LE(16) !== 3 || bytes.readUInt16LE(18) !== (process.arch === 'arm64' ? 183 : 62)) {
    throw new Error('Linux candidate binary content mismatch.');
  }
  const declaredExports = manifest.exports;
  if (!Array.isArray(declaredExports) || declaredExports.length !== LINUX_EXECUTION_NATIVE_EXPORTS.length ||
      LINUX_EXECUTION_NATIVE_EXPORTS.some((name, index) => declaredExports[index] !== name)) {
    throw new Error('Linux candidate declared exports mismatch.');
  }
  const sources = record(manifest.sources);
  for (const key of ['ownerSha256', 'sharedOwnerSha256', 'patchSha256', 'nodePtySha256', 'patchedSha256', 'headersSha256', 'nodeAddonApiSha256']) {
    const hash = sources[key];
    if (typeof hash !== 'string' || !/^[a-f0-9]{64}$/.test(hash)) throw new Error('Linux candidate provenance is incomplete.');
  }
  const verification = record(manifest.verification);
  if (verification.compiled !== true || verification.nativeLoaded !== false || verification.nativeCalls !== false ||
      verification.productValidated !== false) throw new Error('Linux candidate build evidence is not the supported compile-only format.');
  const entryPoint = path.join(dist, 'linux-execution-provider.js');
  const entry = readAsset(entryPoint, 8 * 1024 * 1024);
  return Object.freeze({ entryPoint, binaryPath, binarySha256: binary.sha256,
    manifestSha256: digest(manifestBytes), entrySha256: digest(entry) });
}

export function createLinuxExecutionOwnerOptions(options: {
  extensionRoot: string;
  mode: ExecutionCandidateMode;
  scheduler?: ExecutionScheduler;
  admissionLimits?: ExecutionAdmissionLimits;
}): LinuxExecutionOwnerOptions {
  if (options.mode !== 'live-runtime' && options.mode !== 'snapshot-only') throw new Error('An explicit candidate owner mode is required.');
  const compiledAdmission = typeof __DEV_SESSION_CANVAS_EXECUTION_ADMISSION__ === 'undefined'
    ? undefined : __DEV_SESSION_CANVAS_EXECUTION_ADMISSION__;
  const admissionLimits = normalizeExecutionAdmissionLimits(
    options.admissionLimits === undefined ? compiledAdmission : options.admissionLimits);
  const dist = path.join(options.extensionRoot, 'dist');
  const assets = resolveLinuxExecutionProviderAssets(dist);
  const scheduler = options.scheduler ?? createNodeExecutionScheduler();
  const capabilities = Object.freeze(['execution-lifecycle-v1', 'execution-close-observation-v1', 'execution-parent-cleanup-v1',
    'execution-owner-boundary-v1', 'terminal-interaction-v1', ...(options.mode === 'live-runtime'
      ? ['terminal-read-settlement-v1'] : ['terminal-local-settlement-v1', 'terminal-local-persistence-v1'])]);
  return Object.freeze({ kind: 'linux-provider', profile: EXECUTION_CANDIDATE_PROFILE, profileMode: options.mode,
    budgets: EXECUTION_CANDIDATE_BUDGETS, admissionLimits, capabilities, scheduler,
    claimNamespace(storageDir: string) {
      if (options.mode !== 'live-runtime') throw new Error('Only the Runtime authority may claim a Supervisor namespace.');
      const current = resolveLinuxExecutionProviderAssets(dist);
      if (current.binarySha256 !== assets.binarySha256 || current.manifestSha256 !== assets.manifestSha256 ||
          current.entrySha256 !== assets.entrySha256) throw new Error('Linux candidate assets changed after owner preparation.');
      if (typeof process.getuid !== 'function') throw new Error('Linux candidate namespace requires a user identity.');
      const identity = { uid: process.getuid(), storageDir: realpathSync(storageDir) };
      const address = `\0dsc-runtime-owner-${digest(Buffer.from(JSON.stringify(identity)))}`;
      const binding = require(current.binaryPath) as { executionClaimNamespace: (address: string) => void };
      binding.executionClaimNamespace(address);
    },
    createTransport(identity: ExecutionIdentity) {
      const current = resolveLinuxExecutionProviderAssets(dist);
      if (current.binarySha256 !== assets.binarySha256 || current.manifestSha256 !== assets.manifestSha256 ||
          current.entrySha256 !== assets.entrySha256) throw new Error('Linux candidate assets changed after owner preparation.');
      return createExecutionProviderTransport({ identity, executable: process.execPath, entryPoint: assets.entryPoint,
        args: [assets.binarySha256, assets.manifestSha256, assets.entrySha256],
        env: { ...process.env, ...(process.versions.electron ? { ELECTRON_RUN_AS_NODE: '1' } : {}) },
        parentCleanup: { scheduler, expectedNativeResourceIds: ['pty-master', 'pty-child', 'pty-source'] } });
    }
  });
}
