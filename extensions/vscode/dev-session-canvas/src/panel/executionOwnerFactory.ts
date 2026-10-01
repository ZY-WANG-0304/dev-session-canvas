import { EXECUTION_CANDIDATE_PROFILE, MACOS_EXECUTION_CANDIDATE_PROFILE, WINDOWS_EXECUTION_CANDIDATE_PROFILE,
  type ExecutionCandidateMode, type ExecutionCandidateProfile } from '../common/executionLifecycle';
import type { NativeExecutionOwnerOptions } from './executionOwnerLifecycle';
import { createLinuxExecutionOwnerOptions } from './linuxExecutionOwnerFactory';
import { createMacosExecutionOwnerOptions } from './macosExecutionOwnerFactory';
import { createWindowsExecutionOwnerOptions } from './windowsExecutionOwnerFactory';

export function createNativeExecutionOwnerOptions(options: {
  extensionRoot: string;
  mode: ExecutionCandidateMode;
  profile: ExecutionCandidateProfile;
}): NativeExecutionOwnerOptions {
  if (options.profile === EXECUTION_CANDIDATE_PROFILE) return createLinuxExecutionOwnerOptions(options);
  if (options.profile === MACOS_EXECUTION_CANDIDATE_PROFILE) return createMacosExecutionOwnerOptions(options);
  if (options.profile === WINDOWS_EXECUTION_CANDIDATE_PROFILE) return createWindowsExecutionOwnerOptions(options);
  throw new Error('Unknown execution candidate factory profile.');
}
