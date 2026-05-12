import type {
  AttentionNotificationActivationMode,
  AttentionNotificationDebugRecord
} from '../../../../packages/attention-protocol/src/index';
import type { NotifierEnvironmentSnapshot } from './sidebarEnvironment';

export function resolveSidebarActivationMode(
  snapshot: Pick<NotifierEnvironmentSnapshot, 'activationKind'>,
  latestRecord: AttentionNotificationDebugRecord | undefined
): AttentionNotificationActivationMode {
  if (latestRecord?.result.status === 'posted') {
    return latestRecord.result.activationMode;
  }

  return mapSnapshotActivationKindToMode(snapshot.activationKind);
}

export function activationModeSupportsCallback(mode: AttentionNotificationActivationMode): boolean {
  return mode === 'protocol' || mode === 'direct-action' || mode === 'test-replay';
}

function mapSnapshotActivationKindToMode(
  activationKind: NotifierEnvironmentSnapshot['activationKind']
): AttentionNotificationActivationMode {
  switch (activationKind) {
    case 'protocol':
      return 'protocol';
    case 'direct-action':
      return 'direct-action';
    case 'test-replay':
      return 'test-replay';
    case 'none':
    default:
      return 'none';
  }
}
