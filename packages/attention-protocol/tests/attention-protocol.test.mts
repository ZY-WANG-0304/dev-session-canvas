import assert from 'node:assert/strict';

import {
  ATTENTION_NOTIFICATION_PROTOCOL_VERSION,
  decodeAttentionNotificationFocusAction,
  encodeAttentionNotificationFocusAction,
  isAttentionNotificationDeliveryResult,
  isAttentionNotificationRequest,
  parseAttentionNotificationRequest
} from '../src/index.ts';

const validRequest = {
  version: ATTENTION_NOTIFICATION_PROTOCOL_VERSION,
  kind: 'execution-attention',
  title: 'Dev Session Canvas',
  message: 'Agent needs attention',
  dedupeKey: 'osc9:agent-needs-attention',
  focusAction: {
    command: 'devSessionCanvas.__internal.focusNode',
    arguments: ['node-1']
  }
};

assert.equal(isAttentionNotificationRequest(validRequest), true);
assert.deepEqual(parseAttentionNotificationRequest(validRequest), validRequest);
assert.equal(
  isAttentionNotificationRequest({
    ...validRequest,
    focusAction: {
      command: 'devSessionCanvas.__internal.focusNode',
      arguments: [1]
    }
  }),
  false
);

const encoded = encodeAttentionNotificationFocusAction(validRequest.focusAction);
assert.deepEqual(decodeAttentionNotificationFocusAction(encoded), validRequest.focusAction);
assert.equal(decodeAttentionNotificationFocusAction('not-base64'), undefined);

assert.equal(
  isAttentionNotificationDeliveryResult({
    status: 'posted',
    backend: 'test',
    activationMode: 'test-replay',
    detail: 'ok'
  }),
  true
);
assert.equal(
  isAttentionNotificationDeliveryResult({
    status: 'posted',
    backend: 'somewhere-else',
    activationMode: 'protocol'
  }),
  false
);
assert.equal(
  isAttentionNotificationDeliveryResult({
    status: 'posted',
    backend: 'test',
    activationMode: 'somewhere-else'
  }),
  false
);

console.log('attention-protocol tests passed');
