import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import * as path from 'node:path';
import { release } from 'node:os';

import { EXECUTION_CANDIDATE_BUDGETS, MACOS_EXECUTION_CANDIDATE_PROFILE, normalizeExecutionAdmissionLimits,
  type ExecutionAdmissionLimits, type ExecutionCandidateMode, type ExecutionIdentity } from '../common/executionLifecycle';
import type { MacosExecutionOwnerOptions } from './executionOwnerLifecycle';
import { createExecutionProviderTransport, createNodeExecutionScheduler } from './executionProviderTransport';
import type { ExecutionScheduler } from './executionSessionAdapter';
import { assertExecutionAssetRuntime, assertMinimumExecutionLibraryVersion } from './executionAssetCompatibility';

declare const __DEV_SESSION_CANVAS_EXECUTION_ADMISSION__: ExecutionAdmissionLimits | undefined;

export const MACOS_EXECUTION_NATIVE_EXPORTS = Object.freeze([
  'executionClaimNamespace', 'executionClose', 'executionConfigure', 'executionPollWait', 'executionRead',
  'executionResize', 'executionSignal', 'executionSnapshot', 'executionWrite', 'fork'
]);

export interface MacosExecutionProviderAssets {
  readonly entryPoint: string;
  readonly binaryPath: string;
  readonly helperPath: string;
  readonly binarySha256: string;
  readonly helperSha256: string;
  readonly manifestSha256: string;
  readonly entrySha256: string;
}

const digest = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid macOS candidate manifest.');
  return value as Record<string, unknown>;
}
function readAsset(file: string, maximumBytes: number, executable = false): Buffer {
  const stat = lstatSync(file);
  if (!stat.isFile() || stat.size < 1 || stat.size > maximumBytes || (executable && !(stat.mode & 0o111))) {
    throw new Error(`Invalid macOS candidate asset: ${file}`);
  }
  return readFileSync(file);
}
function assertMachO(bytes: Buffer, arch: string, filetype: number): void {
  if (bytes.length < 32 || bytes.readUInt32LE(0) !== 0xfeedfacf ||
      bytes.readUInt32LE(4) !== (arch === 'arm64' ? 0x0100000c : 0x01000007) || bytes.readUInt32LE(12) !== filetype) {
    throw new Error('macOS candidate Mach-O target mismatch.');
  }
}

export function resolveMacosExecutionProviderAssets(distDirectory: string): MacosExecutionProviderAssets {
  if (process.platform !== 'darwin' || !['arm64', 'x64'].includes(process.arch)) {
    throw new Error('macOS candidate assets require Darwin arm64 or x64.');
  }
  if (!path.isAbsolute(distDirectory)) throw new Error('An absolute extension dist directory is required.');
  const dist = realpathSync(distDirectory);
  const directory = path.join(dist, `native/macos-execution-candidate/darwin-${process.arch}`);
  if (realpathSync(directory) !== directory) throw new Error('macOS candidate asset directories must not be redirected.');
  const manifestBytes = readAsset(path.join(directory, 'manifest.json'), 32768);
  const manifest = record(JSON.parse(manifestBytes.toString('utf8')));
  if (manifest.schemaVersion !== 2 || manifest.profile !== MACOS_EXECUTION_CANDIDATE_PROFILE ||
      manifest.platform !== 'darwin' || manifest.arch !== process.arch) throw new Error('macOS candidate manifest target mismatch.');
  const requirements = record(manifest.requirements);
  const macos = record(requirements.macos);
  if (macos.deploymentTarget !== (process.arch === 'arm64' ? '11.0' : '10.13')) {
    throw new Error('macOS candidate deployment target mismatch.');
  }
  assertMinimumExecutionLibraryVersion(release(), process.arch === 'arm64' ? '20.0' : '17.0');
  assertExecutionAssetRuntime(record(manifest.runtime), requirements.napi);
  const binary = record(manifest.binary);
  const helper = record(manifest.helper);
  if (binary.file !== 'execution-owner.node' || helper.file !== 'spawn-helper' ||
      typeof binary.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(binary.sha256) ||
      typeof helper.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(helper.sha256)) {
    throw new Error('Invalid macOS candidate binary descriptors.');
  }
  const binaryPath = path.join(directory, binary.file);
  const helperPath = path.join(directory, helper.file);
  const bytes = readAsset(binaryPath, 32 * 1024 * 1024);
  const helperBytes = readAsset(helperPath, 8 * 1024 * 1024, true);
  if (digest(bytes) !== binary.sha256 || digest(helperBytes) !== helper.sha256) throw new Error('macOS candidate binary content mismatch.');
  assertMachO(bytes, process.arch, 8);
  assertMachO(helperBytes, process.arch, 2);
  if (JSON.stringify(manifest.exports) !== JSON.stringify(MACOS_EXECUTION_NATIVE_EXPORTS)) {
    throw new Error('macOS candidate declared exports mismatch.');
  }
  const sources = record(manifest.sources);
  for (const key of ['ownerSha256', 'sharedOwnerSha256', 'patchSha256', 'nodePtySha256', 'patchedSha256',
    'helperSourceSha256', 'helperPatchedSha256', 'headersSha256', 'nodeAddonApiSha256']) {
    if (typeof sources[key] !== 'string' || !/^[a-f0-9]{64}$/.test(sources[key] as string)) {
      throw new Error('macOS candidate provenance is incomplete.');
    }
  }
  const verification = record(manifest.verification);
  if (verification.compiled !== true || verification.nativeLoaded !== false || verification.nativeCalls !== false ||
      verification.productValidated !== false) throw new Error('macOS candidate requires compile-only build evidence.');
  const entryPoint = path.join(dist, 'macos-execution-provider.js');
  return Object.freeze({ entryPoint, binaryPath, helperPath, binarySha256: binary.sha256, helperSha256: helper.sha256,
    manifestSha256: digest(manifestBytes), entrySha256: digest(readAsset(entryPoint, 8 * 1024 * 1024)) });
}

export function createMacosExecutionOwnerOptions(options: {
  extensionRoot: string;
  mode: ExecutionCandidateMode;
  scheduler?: ExecutionScheduler;
  admissionLimits?: ExecutionAdmissionLimits;
}): MacosExecutionOwnerOptions {
  if (options.mode !== 'live-runtime' && options.mode !== 'snapshot-only') throw new Error('An explicit candidate owner mode is required.');
  const compiledAdmission = typeof __DEV_SESSION_CANVAS_EXECUTION_ADMISSION__ === 'undefined'
    ? undefined : __DEV_SESSION_CANVAS_EXECUTION_ADMISSION__;
  const admissionLimits = normalizeExecutionAdmissionLimits(options.admissionLimits ?? compiledAdmission);
  const dist = path.join(options.extensionRoot, 'dist');
  const assets = resolveMacosExecutionProviderAssets(dist);
  const scheduler = options.scheduler ?? createNodeExecutionScheduler();
  const currentAssets = () => {
    const current = resolveMacosExecutionProviderAssets(dist);
    if (current.binarySha256 !== assets.binarySha256 || current.helperSha256 !== assets.helperSha256 ||
        current.manifestSha256 !== assets.manifestSha256 || current.entrySha256 !== assets.entrySha256) {
      throw new Error('macOS candidate assets changed after owner preparation.');
    }
    return current;
  };
  return Object.freeze({ kind: 'macos-provider', profile: MACOS_EXECUTION_CANDIDATE_PROFILE, profileMode: options.mode,
    budgets: EXECUTION_CANDIDATE_BUDGETS, admissionLimits, scheduler,
    capabilities: Object.freeze(['execution-lifecycle-v1', 'execution-close-observation-v1', 'execution-parent-cleanup-v1',
      'execution-owner-boundary-v1', 'terminal-interaction-v1', ...(options.mode === 'live-runtime'
        ? ['terminal-read-settlement-v1'] : ['terminal-local-settlement-v1', 'terminal-local-persistence-v1'])]),
    claimNamespace(storageDir: string) {
      if (options.mode !== 'live-runtime') throw new Error('Only the Runtime authority may claim a Supervisor namespace.');
      const current = currentAssets();
      const binding = require(current.binaryPath) as { executionClaimNamespace: (file: string) => void };
      binding.executionClaimNamespace(path.join(realpathSync(storageDir), 'supervisor-owner.lock'));
    },
    createTransport(identity: ExecutionIdentity) {
      currentAssets();
      return createExecutionProviderTransport({ identity, executable: process.execPath, entryPoint: assets.entryPoint,
        args: [assets.binarySha256, assets.manifestSha256, assets.entrySha256, assets.helperSha256],
        env: { ...process.env, ...(process.versions.electron ? { ELECTRON_RUN_AS_NODE: '1' } : {}) },
        parentCleanup: { scheduler, expectedNativeResourceIds: ['pty-master', 'pty-child', 'pty-source', 'pty-creation'] } });
    }
  });
}
