import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import * as path from 'node:path';

import { EXECUTION_CANDIDATE_BUDGETS, WINDOWS_EXECUTION_CANDIDATE_PROFILE, normalizeExecutionAdmissionLimits,
  type ExecutionAdmissionLimits, type ExecutionCandidateMode, type ExecutionIdentity } from '../common/executionLifecycle';
import type { WindowsExecutionOwnerOptions } from './executionOwnerLifecycle';
import { createExecutionProviderTransport, createNodeExecutionScheduler } from './executionProviderTransport';
import type { ExecutionScheduler } from './executionSessionAdapter';

declare const __DEV_SESSION_CANVAS_EXECUTION_ADMISSION__: ExecutionAdmissionLimits | undefined;

export const WINDOWS_EXECUTION_NATIVE_EXPORTS = Object.freeze([
  'executionClose', 'executionConnect', 'executionPollWait', 'executionResize', 'executionSnapshot', 'executionStart'
]);
const dependencyFiles = Object.freeze(['conpty/conpty.dll', 'conpty/OpenConsole.exe']);

export interface WindowsExecutionProviderAssets {
  readonly entryPoint: string;
  readonly binaryPath: string;
  readonly workerPath: string;
  readonly binarySha256: string;
  readonly manifestSha256: string;
  readonly entrySha256: string;
  readonly workerSha256: string;
}

const digest = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid Windows candidate manifest.');
  return value as Record<string, unknown>;
}
function readAsset(file: string, maximumBytes: number): Buffer {
  const stat = lstatSync(file);
  if (!stat.isFile() || stat.size < 1 || stat.size > maximumBytes) throw new Error(`Invalid Windows candidate asset: ${file}`);
  return readFileSync(file);
}
function assertPE(bytes: Buffer, arch: string, dll: boolean): void {
  if (bytes.length < 64 || bytes.readUInt16LE(0) !== 0x5a4d) throw new Error('Windows candidate DOS header mismatch.');
  const pe = bytes.readUInt32LE(0x3c);
  if (pe < 64 || pe + 26 > bytes.length || bytes.readUInt32LE(pe) !== 0x4550 ||
      bytes.readUInt16LE(pe + 4) !== (arch === 'arm64' ? 0xaa64 : 0x8664)) {
    throw new Error('Windows candidate PE target mismatch.');
  }
  const optionalSize = bytes.readUInt16LE(pe + 20);
  const characteristics = bytes.readUInt16LE(pe + 22);
  if (optionalSize < 112 || pe + 24 + optionalSize > bytes.length || bytes.readUInt16LE(pe + 24) !== 0x20b ||
      !(characteristics & 0x0002) || Boolean(characteristics & 0x2000) !== dll) {
    throw new Error('Windows candidate PE image type mismatch.');
  }
}

export function resolveWindowsExecutionProviderAssets(distDirectory: string): WindowsExecutionProviderAssets {
  if (process.platform !== 'win32' || !['arm64', 'x64'].includes(process.arch)) {
    throw new Error('Windows candidate assets require Windows arm64 or x64.');
  }
  if (!path.isAbsolute(distDirectory)) throw new Error('An absolute extension dist directory is required.');
  const dist = realpathSync(distDirectory);
  const directory = path.join(dist, `native/windows-execution-candidate/win32-${process.arch}`);
  const conptyDirectory = path.join(directory, 'conpty');
  if (realpathSync(directory) !== directory || realpathSync(conptyDirectory) !== conptyDirectory) {
    throw new Error('Windows candidate asset directories must not be redirected.');
  }
  const manifestBytes = readAsset(path.join(directory, 'manifest.json'), 32768);
  const manifest = record(JSON.parse(manifestBytes.toString('utf8')));
  if (manifest.schemaVersion !== 1 || manifest.profile !== WINDOWS_EXECUTION_CANDIDATE_PROFILE ||
      manifest.platform !== 'win32' || manifest.arch !== process.arch) throw new Error('Windows candidate manifest target mismatch.');
  const runtime = record(manifest.runtime);
  const expected = { name: process.versions.electron ? 'electron' : 'node',
    version: process.versions.electron ?? process.versions.node, node: process.versions.node,
    modules: process.versions.modules, napi: process.versions.napi };
  for (const [key, value] of Object.entries(expected)) {
    if (typeof value !== 'string' || runtime[key] !== value) throw new Error(`Windows candidate runtime mismatch: ${key}.`);
  }
  const binary = record(manifest.binary);
  if (!Array.isArray(manifest.dependencies) || manifest.dependencies.length !== dependencyFiles.length) {
    throw new Error('Windows candidate requires both ConPTY dependencies.');
  }
  const dependencies = manifest.dependencies.map(record);
  for (const [index, descriptor] of [binary, ...dependencies].entries()) {
    const expectedFile = index === 0 ? 'conpty.node' : dependencyFiles[index - 1];
    if (descriptor.file !== expectedFile || typeof descriptor.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(descriptor.sha256)) {
      throw new Error('Invalid Windows candidate binary descriptor.');
    }
    const bytes = readAsset(path.join(directory, expectedFile), 32 * 1024 * 1024);
    if (digest(bytes) !== descriptor.sha256) throw new Error('Windows candidate binary content mismatch.');
    assertPE(bytes, process.arch, index !== 2);
  }
  if (JSON.stringify(manifest.exports) !== JSON.stringify(WINDOWS_EXECUTION_NATIVE_EXPORTS)) {
    throw new Error('Windows candidate declared exports mismatch.');
  }
  const sources = record(manifest.sources);
  for (const key of ['ownerSha256', 'patchSha256', 'nodePtySha256', 'patchedSha256', 'pathUtilSha256',
    'windowsHeadersSha256', 'headersSha256', 'nodeAddonApiSha256', 'nodeLibSha256', 'delayLoadHookSha256']) {
    if (typeof sources[key] !== 'string' || !/^[a-f0-9]{64}$/.test(sources[key] as string)) {
      throw new Error('Windows candidate provenance is incomplete.');
    }
  }
  const verification = record(manifest.verification);
  if (verification.compiled !== true || verification.nativeLoaded !== false || verification.nativeCalls !== false ||
      verification.productValidated !== false) throw new Error('Windows candidate requires compile-only build evidence.');
  const entryPoint = path.join(dist, 'windows-execution-provider.js');
  const workerPath = path.join(dist, 'windows-execution-output-worker.js');
  return Object.freeze({ entryPoint, binaryPath: path.join(directory, 'conpty.node'), workerPath,
    binarySha256: binary.sha256 as string, manifestSha256: digest(manifestBytes),
    entrySha256: digest(readAsset(entryPoint, 8 * 1024 * 1024)), workerSha256: digest(readAsset(workerPath, 8 * 1024 * 1024)) });
}

export function createWindowsExecutionOwnerOptions(options: {
  extensionRoot: string;
  mode: ExecutionCandidateMode;
  scheduler?: ExecutionScheduler;
  admissionLimits?: ExecutionAdmissionLimits;
}): WindowsExecutionOwnerOptions {
  if (options.mode !== 'live-runtime' && options.mode !== 'snapshot-only') throw new Error('An explicit candidate owner mode is required.');
  const compiledAdmission = typeof __DEV_SESSION_CANVAS_EXECUTION_ADMISSION__ === 'undefined'
    ? undefined : __DEV_SESSION_CANVAS_EXECUTION_ADMISSION__;
  const admissionLimits = normalizeExecutionAdmissionLimits(
    options.admissionLimits === undefined ? compiledAdmission : options.admissionLimits);
  const dist = path.join(options.extensionRoot, 'dist');
  const assets = resolveWindowsExecutionProviderAssets(dist);
  const scheduler = options.scheduler ?? createNodeExecutionScheduler();
  return Object.freeze({ kind: 'windows-provider', profile: WINDOWS_EXECUTION_CANDIDATE_PROFILE, profileMode: options.mode,
    budgets: EXECUTION_CANDIDATE_BUDGETS, admissionLimits, scheduler,
    capabilities: Object.freeze(['execution-lifecycle-v1', 'execution-close-observation-v1', 'execution-parent-cleanup-v1',
      'execution-owner-boundary-v1', 'terminal-interaction-v1', ...(options.mode === 'live-runtime'
        ? ['terminal-read-settlement-v1'] : ['terminal-local-settlement-v1', 'terminal-local-persistence-v1'])]),
    createTransport(identity: ExecutionIdentity) {
      const current = resolveWindowsExecutionProviderAssets(dist);
      if (current.binarySha256 !== assets.binarySha256 || current.manifestSha256 !== assets.manifestSha256 ||
          current.entrySha256 !== assets.entrySha256 || current.workerSha256 !== assets.workerSha256) {
        throw new Error('Windows candidate assets changed after owner preparation.');
      }
      return createExecutionProviderTransport({ identity, executable: process.execPath, entryPoint: assets.entryPoint,
        args: [assets.binarySha256, assets.manifestSha256, assets.entrySha256, assets.workerSha256],
        env: { ...process.env, ...(process.versions.electron ? { ELECTRON_RUN_AS_NODE: '1' } : {}) },
        parentCleanup: { scheduler,
          expectedNativeResourceIds: ['conpty-owner', 'conpty-process', 'conpty-input', 'conpty-source'] } });
    }
  });
}
