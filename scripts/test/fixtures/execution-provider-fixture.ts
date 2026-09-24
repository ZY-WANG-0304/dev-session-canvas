import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { write } from 'node:fs';
import { StringDecoder } from 'node:string_decoder';

import { createExecutionProviderChannel, type ExecutionProviderCommand } from '../../../extensions/vscode/dev-session-canvas/src/panel/executionProviderChannel';
import type { ProcessResult, ProviderMessage } from '../../../extensions/vscode/dev-session-canvas/src/common/executionLifecycle';

const identity = { executionId: process.argv[2], generation: process.argv[3] };
const mode = process.argv[4];
const modes = new Set(['normal', 'flood', 'partial', 'wrong-identity', 'forged-control', 'ignore-term']);
if (!modes.has(mode)) throw new Error('Unknown controlled fixture mode');

const normalScript = String.raw`
const text = 'head\n' + 'a'.repeat(10000) + '\x1b[2;7H\u4e2d-final\n';
process.stdout.write(text, () => { process.exitCode = 7; });
`;
const floodScript = String.raw`
const text = 'x'.repeat(8192);
let sent = 0;
function pump() {
  while (sent < 128) {
    sent += 1;
    if (!process.stdout.write(text)) {
      process.stdout.once('drain', pump);
      return;
    }
  }
  process.stdout.write('FLOOD_TAIL\n');
}
pump();
`;

let subject: ChildProcessWithoutNullStreams | undefined;
let subjectExited: Promise<ProcessResult> | undefined;
let subjectClosed: Promise<void> | undefined;
let cleanupPromise: Promise<void> | undefined;
let finishing = false;
let failureReported = false;
const keepAlive = setInterval(() => {}, 1000);

const channel = createExecutionProviderChannel(identity, {
  onCommand(command) {
    void handleCommand(command).catch((error: unknown) => fail(error));
  },
  onFault(reason) { fail(new Error(reason)); },
  onOwnerLost() { if (!finishing) void cleanup(0); }
});

function fail(error: unknown): void {
  if (!failureReported && !finishing) {
    failureReported = true;
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  }
  void cleanup(1);
}

function cleanup(code: number): Promise<void> {
  if (cleanupPromise) return cleanupPromise;
  cleanupPromise = (async () => {
    finishing = true;
    if (subject) {
      if (subject.exitCode === null && subject.signalCode === null) subject.kill('SIGTERM');
      await subjectExited;
      // This is abnormal cleanup, not a claim of source EOF or complete output.
      subject.stdout.destroy();
      subject.stderr.destroy();
      subject.stdin.destroy();
      await subjectClosed;
    }
    clearInterval(keepAlive);
    process.exit(code);
  })();
  return cleanupPromise;
}

process.on('SIGTERM', () => {
  if (mode !== 'ignore-term') void cleanup(0);
});

async function sendRawControl(message: ProviderMessage): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    if (!process.send) { reject(new Error('Fixture IPC unavailable')); return; }
    process.send(message, (error: Error | null) => error ? reject(error) : resolve());
  });
}

async function handleCommand(command: ExecutionProviderCommand): Promise<void> {
  if (command.type === 'requestStop') {
    if (subject && subject.exitCode === null && subject.signalCode === null) {
      subject.kill(command.mode === 'force' ? 'SIGKILL' : 'SIGTERM');
    }
    await channel.send({ type: 'operationObservation', identity, operationId: command.operationId, result: { kind: 'accepted' } });
    return;
  }
  if (command.type === 'cancelOutput') {
    await channel.send({ type: 'operationObservation', identity, operationId: command.operationId, result: { kind: 'unsupported', reason: 'Not used by this fixed fixture schedule' } });
    return;
  }
  if (command.spec.file !== process.execPath || command.spec.args.length !== 0) {
    throw new Error('Fixture accepts only its fixed Node subject');
  }
  if (mode === 'ignore-term') return;
  if (mode === 'wrong-identity') {
    await sendRawControl({ type: 'processResult', identity: { ...identity, generation: 'wrong-fixture-binding' }, result: { kind: 'exited', exitCode: 0 } });
    return;
  }
  if (mode === 'forged-control') {
    await sendRawControl({ type: 'resourceResult', identity, resourceId: 'provider-control', operationId: 'forged', result: { kind: 'released' } });
    return;
  }

  subject = spawn(process.execPath, ['-e', mode === 'flood' ? floodScript : normalScript], {
    stdio: ['pipe', 'pipe', 'pipe'], shell: false, detached: false
  });
  const child = subject;
  subjectExited = new Promise<ProcessResult>((resolve) => {
    child.once('exit', (code, signal) => resolve(signal
      ? { kind: 'signaled', signal }
      : { kind: 'exited', exitCode: code ?? -1 }));
    child.once('error', (error) => resolve({ kind: 'unconfirmed', reason: error.message }));
  });
  subjectClosed = new Promise<void>((resolve) => child.once('close', () => resolve()));
  child.stdin.end();
  child.stderr.resume();
  await new Promise<void>((resolve, reject) => {
    child.once('spawn', resolve);
    child.once('error', reject);
  });
  if (!child.pid) throw new Error('Subject spawned without a PID');
  await channel.send({ type: 'operationObservation', identity, operationId: command.operationId, result: { kind: 'started', pid: child.pid } });
  const exitDelivery = subjectExited.then((result) => channel.send({ type: 'processResult', identity, result }));
  void exitDelivery.catch(fail);
  const decoder = new StringDecoder('utf8');
  for await (const chunk of child.stdout) {
    const text = decoder.write(chunk as Buffer);
    for (let offset = 0; offset < text.length; offset += 8192) {
      await channel.write(text.slice(offset, offset + 8192));
    }
  }
  const tail = decoder.end();
  if (tail) await channel.write(tail);
  await subjectClosed;
  await exitDelivery;

  if (mode === 'partial') {
    // The subject is already closed and the normal writer is idle before this malformed suffix.
    await new Promise<void>((resolve, reject) => {
      write(4, Uint8Array.of(0, 0), (error) => error ? reject(error) : resolve());
    });
    await cleanup(0);
    return;
  }
  await channel.end({ kind: 'eof' });
  finishing = true;
  await channel.close();
  clearInterval(keepAlive);
}

void channel.ready().catch(fail);
