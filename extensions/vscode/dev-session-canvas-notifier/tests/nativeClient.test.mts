import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { createServer, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { NativeNotifierClient, targetOf } from '../src/nativeClient.ts';
import {
  decodeNativeFrame,
  type NativeEvent
} from '../../../../packages/attention-protocol/src/native.ts';

const root = await fs.mkdtemp(join(tmpdir(), 'dsc-native-client-'));
await fs.chmod(root, 0o700);
const directory = join(root, 'runtime');
await fs.mkdir(directory, { mode: 0o700 });
await fs.writeFile(join(directory, 'credential'), 'a'.repeat(64), {
  mode: 0o600
});
const syncs: string[][] = [];
let publishes = 0;
let queryAbsent = false;
let dropPublish = false;
const peers = new Map<string, Socket>();
const focusResults: string[] = [];
const allPeers = new Set<Socket>();
const server = createServer((socket) => {
  allPeers.add(socket);
  socket.on('close', () => allPeers.delete(socket));
  let buffer = Buffer.alloc(0);
  socket.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    let newline: number;
    while ((newline = buffer.indexOf(10)) >= 0) {
      const frame = buffer.subarray(0, newline + 1);
      buffer = buffer.subarray(newline + 1);
      const request = decodeNativeFrame(frame, Date.now());
      assert.ok(request);
      assert.equal(request.credential, 'a'.repeat(64));
      const op = request.operation;
      if (op.type === 'register') peers.set(request.sourceInstanceId, socket);
      if (op.type === 'sync') syncs.push(op.eventIds);
      if (op.type === 'focusResult') focusResults.push(op.result);
      if (op.type === 'publish') {
        publishes++;
        if (dropPublish) {
          socket.destroy();
          continue;
        }
      }
      const result =
        op.type === 'query'
          ? {
              status: 'accepted',
              eventState: queryAbsent ? 'absent' : 'stored'
            }
          : { status: 'accepted' };
      const reply =
        JSON.stringify({
          version: 2,
          type: 'receipt',
          requestId: request.requestId,
          result
        }) + '\n';
      // Exercise incremental decoding, not just one whole frame per data event.
      socket.write(reply.slice(0, 5));
      socket.write(reply.slice(5));
    }
  });
});
await new Promise<void>((resolve) =>
  server.listen(join(directory, 'notifier.sock'), resolve)
);
await fs.chmod(join(directory, 'notifier.sock'), 0o600);
const now = Date.now();
const event: NativeEvent = {
  eventId: 'same',
  workspaceId: 'w',
  canvasId: 'c',
  nodeId: 'n',
  executionGeneration: 'g',
  occurredAt: now,
  expiresAt: now + 60000,
  mergeKey: 'same',
  title: '同名节点',
  body: '等待输入',
  playSound: false
};
const focused: string[] = [];
const make = (name: string) =>
  new NativeNotifierClient({
    workspaceId: 'w',
    runtimeDirectory: directory,
    timeoutMs: 500,
    active: async (targets) => targets.map((t) => t.eventId),
    focus: async () => {
      focused.push(name);
      return 'focused';
    }
  });
const a = make('a'),
  b = make('b');
try {
  assert.equal((await a.publish(event)).status, 'accepted');
  assert.equal((await b.publish(event)).status, 'accepted');
  assert.notEqual(a.sourceInstanceId, b.sourceInstanceId);
  assert.equal(publishes, 2);
  const click = (client: NativeNotifierClient, target = targetOf(event)) =>
    peers.get(client.sourceInstanceId)!.write(
      JSON.stringify({
        version: 2,
        type: 'focus-node',
        focusRequestId: 'focus',
        target
      }) + '\n'
    );
  click(a);
  click(b);
  await delay(40);
  assert.deepEqual([...focused].sort(), ['a', 'b']);
  assert.equal(focusResults.length, 2);
  click(a, { ...targetOf(event), executionGeneration: 'old' });
  await delay(30);
  assert.equal(focused.length, 2);
  assert.equal(focusResults.at(-1), 'stale');
  assert.equal((await a.publish(event)).status, 'accepted');
  assert.equal(publishes, 2, 'dedupe queries without republishing');
  dropPublish = true;
  const lost = { ...event, eventId: 'lost' };
  assert.equal((await a.publish(lost)).status, 'unknown');
  queryAbsent = true;
  assert.equal(
    (await a.publish(lost)).status,
    'unknown',
    'query absent is not a cancellation barrier'
  );
  assert.equal(publishes, 3);
  assert.equal(
    (await a.publish({ ...event, eventId: 'invalid', executionGeneration: '' }))
      .status,
    'rejected'
  );
  // A remote active-state query may resolve after another event was published.
  dropPublish = false;
  queryAbsent = false;
  let releaseActive: ((ids: string[]) => void) | undefined;
  let holdActive = false;
  const racing = new NativeNotifierClient({
    workspaceId: 'w',
    runtimeDirectory: directory,
    timeoutMs: 500,
    focus: async () => 'focused',
    active: (targets) =>
      holdActive
        ? new Promise((resolve) => {
            releaseActive = resolve;
          })
        : Promise.resolve(targets.map((t) => t.eventId))
  });
  try {
    await racing.publish({ ...event, eventId: 'first' });
    holdActive = true;
    const syncing = Reflect.get(racing, 'sync').call(racing) as Promise<void>;
    assert.ok(releaseActive);
    const beforeSyncCount = syncs.length;
    await racing.publish({ ...event, eventId: 'second' });
    releaseActive(['first']);
    await syncing;
    assert.equal(
      syncs.length,
      beforeSyncCount,
      'stale sync snapshot must not withdraw a concurrent publish'
    );
  } finally {
    racing.dispose();
  }
  const stalledIde = new NativeNotifierClient({
    workspaceId: 'w',
    runtimeDirectory: directory,
    timeoutMs: 100,
    focus: async () => 'offline',
    active: () => new Promise(() => {})
  });
  try {
    assert.equal(
      (await stalledIde.publish({ ...event, eventId: 'stalled-ide' })).status,
      'accepted',
      'unresponsive IDE sync must not hang publishing'
    );
  } finally {
    stalledIde.dispose();
  }
  // Invalid server frames drop the connection without executing arbitrary actions.
  peers
    .get(b.sourceInstanceId)!
    .write(
      JSON.stringify({ version: 2, type: 'execute', command: 'anything' }) +
        '\n'
    );
  await delay(30);
  assert.equal(focused.length, 2);
  a.dispose();
  b.dispose();
  const absent = new NativeNotifierClient({
    workspaceId: 'w',
    runtimeDirectory: join(root, 'missing'),
    timeoutMs: 100,
    active: async () => [],
    focus: async () => 'stale'
  });
  assert.equal((await absent.publish(event)).status, 'rejected');
  absent.dispose();
  console.log(
    'Native client: two-source routing, stale target, dedupe, ambiguous receipt, absent query, malformed reply and pre-send failure passed'
  );
} finally {
  a.dispose();
  b.dispose();
  for (const socket of allPeers) socket.destroy();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await fs.rm(root, { recursive: true, force: true });
}
