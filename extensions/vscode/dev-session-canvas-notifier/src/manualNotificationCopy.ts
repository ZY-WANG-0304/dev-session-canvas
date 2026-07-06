import type { AttentionNotificationDeliveryResult } from '../../../../packages/attention-protocol/src/index';
import type { NotifierLocalize } from './notifierLocalization.ts';

export function buildManualNotificationMessage(
  result: AttentionNotificationDeliveryResult,
  l10n: NotifierLocalize
): string {
  if (result.status !== 'posted') {
    return l10n('Test desktop notification failed (backend={backend}). {detail}', {
      backend: result.backend,
      detail: result.detail ?? l10n('Open the diagnostic output for details.')
    });
  }

  if (result.activationMode === 'none') {
    return l10n('Test desktop notification was sent (backend={backend}), but the current backend only guarantees display and does not support clicking back to VS Code.', {
      backend: result.backend
    });
  }

  return l10n('Test desktop notification was sent (backend={backend}, activation={activation}). Click the system notification to complete manual validation.', {
    backend: result.backend,
    activation: result.activationMode
  });
}
