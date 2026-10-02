import { assertExecutionCandidateProfile, type ExecutionCandidateProfile } from '../common/executionLifecycle';
import type { NativeExecutionOwnerOptions } from './executionOwnerLifecycle';
import { createNativeExecutionOwnerOptions } from './executionOwnerFactory';

declare const __DEV_SESSION_CANVAS_EXECUTION_PROFILE__: string | undefined;

export function resolveExecutionRuntimeSelection(extensionRoot: string): {
  readonly profile?: ExecutionCandidateProfile;
  readonly ownerOptions?: NativeExecutionOwnerOptions;
} {
  let profile = typeof __DEV_SESSION_CANVAS_EXECUTION_PROFILE__ === 'undefined'
    ? undefined : __DEV_SESSION_CANVAS_EXECUTION_PROFILE__;
  if (profile === undefined) return Object.freeze({});
  if (profile === 'platform') {
    if (process.arch !== 'x64' && process.arch !== 'arm64') {
      throw new Error(`Unsupported execution candidate architecture: ${process.arch}.`);
    }
    switch (process.platform) {
      case 'linux': profile = 'linux-owner-v1-candidate'; break;
      case 'darwin': profile = 'macos-owner-v1-candidate'; break;
      case 'win32': profile = 'windows-owner-v1-candidate'; break;
      default: throw new Error(`Unsupported execution candidate platform: ${process.platform}.`);
    }
  }
  try { assertExecutionCandidateProfile(profile); }
  catch { throw new Error('Unknown compiled execution candidate profile.'); }
  const ownerOptions = createNativeExecutionOwnerOptions({ extensionRoot, mode: 'snapshot-only', profile });
  return Object.freeze({ profile, ownerOptions });
}
