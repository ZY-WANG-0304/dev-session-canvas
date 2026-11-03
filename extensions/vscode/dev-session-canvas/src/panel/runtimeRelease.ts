import type { ExecutionCandidateProfile } from '../common/executionLifecycle';
import { resolveRootRuntimeSupervisorGeneration } from '../common/runtimeRootOwnership';

const manifest: { version: string } = require('../../package.json');

export const RUNTIME_RELEASE_VERSION = manifest.version;

export function resolveCurrentRootRuntimeSupervisorGeneration(profile: ExecutionCandidateProfile): string {
  return resolveRootRuntimeSupervisorGeneration(profile, RUNTIME_RELEASE_VERSION);
}

export function assertRuntimeRootRelease(generation: string, profile: ExecutionCandidateProfile): void {
  if (generation !== resolveRootRuntimeSupervisorGeneration(profile) &&
      generation !== resolveCurrentRootRuntimeSupervisorGeneration(profile)) {
    throw new Error('Root runtime release does not match this executable.');
  }
}
