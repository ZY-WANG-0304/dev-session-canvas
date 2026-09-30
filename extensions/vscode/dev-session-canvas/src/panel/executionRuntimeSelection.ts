import { EXECUTION_CANDIDATE_PROFILE, type ExecutionCandidateProfile } from '../common/executionLifecycle';
import type { LinuxExecutionOwnerOptions } from './executionOwnerLifecycle';
import { createLinuxExecutionOwnerOptions } from './linuxExecutionOwnerFactory';

declare const __DEV_SESSION_CANVAS_EXECUTION_PROFILE__: string | undefined;

export function resolveExecutionRuntimeSelection(extensionRoot: string): {
  readonly profile?: ExecutionCandidateProfile;
  readonly ownerOptions?: LinuxExecutionOwnerOptions;
} {
  const profile = typeof __DEV_SESSION_CANVAS_EXECUTION_PROFILE__ === 'undefined'
    ? undefined : __DEV_SESSION_CANVAS_EXECUTION_PROFILE__;
  if (profile === undefined) return Object.freeze({});
  if (profile !== EXECUTION_CANDIDATE_PROFILE) throw new Error('Unknown compiled execution candidate profile.');
  const ownerOptions = createLinuxExecutionOwnerOptions({ extensionRoot, mode: 'snapshot-only' });
  return Object.freeze({ profile, ownerOptions });
}
