import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const directory = fileURLToPath(new URL('.', import.meta.url));
const roles = fs.readFileSync(`${directory}/macos-native-failure-roles-v1.mjs`, 'utf8');
const fixture = fs.readFileSync(`${directory}/macos-native-failure-fixture-process-v1.mjs`, 'utf8');

test('U1-6 roles keep the data gate closed and use token-bound abort acknowledgement', () => {
  assert(roles.includes("snapshot.registrationFailureInjected && !snapshot.registrationInFlight"));
  assert(roles.includes("type: 'abort', token: config.token, pid: child.pid"));
  assert(roles.includes("message.type === 'abort-ack'"));
  assert(roles.includes('report.permissionSent, false'));
  assert(roles.includes('report.readCalls, 0'));
  assert(!roles.includes("type: 'go'"));
  assert(!roles.includes("signal: 'SIGTERM'"));
  assert(!roles.includes("signal: 'SIGKILL'"));
});

test('U1-6 fixture acknowledges only its matching abort and rejects output permission', () => {
  assert(fixture.includes("message.type === 'abort'"));
  assert(fixture.includes("type: 'abort-ack', token: config.token, pid: process.pid"));
  assert(fixture.includes("message.type === 'go'"));
  assert(fixture.includes('finish(1)'));
});
