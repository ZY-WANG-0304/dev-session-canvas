import { assertExecutionCandidateProfile, type ExecutionCandidateProfile } from '../common/executionLifecycle';
import type { NativeExecutionOwnerOptions } from './executionOwnerLifecycle';
import { createNativeExecutionOwnerOptions } from './executionOwnerFactory';

declare const __DEV_SESSION_CANVAS_EXECUTION_PROFILE__: string | undefined;

export function resolveExecutionRuntimeSelection(extensionRoot: string): {
  readonly profile?: ExecutionCandidateProfile;
  readonly ownerOptions?: NativeExecutionOwnerOptions;
} {
  const profile = typeof __DEV_SESSION_CANVAS_EXECUTION_PROFILE__ === 'undefined'
    ? undefined : __DEV_SESSION_CANVAS_EXECUTION_PROFILE__;
  if (profile === undefined) return Object.freeze({});
  try { assertExecutionCandidateProfile(profile); }
  catch { throw new Error('Unknown compiled execution candidate profile.'); }
  const ownerOptions = createNativeExecutionOwnerOptions({ extensionRoot, mode: 'snapshot-only', profile });
  return Object.freeze({ profile, ownerOptions });
}
