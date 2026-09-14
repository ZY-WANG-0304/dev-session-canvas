import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

import esbuild from 'esbuild';

const tempDir = await mkdtemp(path.join(os.tmpdir(), 'dsc-execution-input-queue-'));

try {
  const outfile = path.join(tempDir, 'executionInputQueue.cjs');
  const clientOutfile = path.join(tempDir, 'runtimeSupervisorClient.cjs');
  await Promise.all([
    esbuild.build({
      entryPoints: [path.resolve('extensions/vscode/dev-session-canvas/src/common/executionInputQueue.ts')],
      bundle: true,
      format: 'cjs',
      outfile,
      platform: 'node',
      target: 'node18'
    }),
    esbuild.build({
      entryPoints: [path.resolve('extensions/vscode/dev-session-canvas/src/panel/runtimeSupervisorClient.ts')],
      bundle: true,
      format: 'cjs',
      outfile: clientOutfile,
      platform: 'node',
      target: 'node18'
    })
  ]);

  const require = createRequire(import.meta.url);
  const { ExecutionInputQueue } = require(outfile);
  const { RuntimeSupervisorClient } = require(clientOutfile);
  const queue = new ExecutionInputQueue();
  const writes = Array.from({ length: 128 }, (_value, index) => `input-${String(index).padStart(3, '0')}`);
  const completedWrites = [];
  let maxInFlight = 0;
  let maxPending = 0;

  const results = await Promise.all(writes.map((write, index) => queue.enqueue(async (state) => {
    maxInFlight = Math.max(maxInFlight, state.inFlightCount);
    maxPending = Math.max(maxPending, state.pendingCount);
    await delay(index % 3);
    completedWrites.push(write);
    return write;
  })));
  assert.deepEqual(results, writes, 'each caller should receive its own ordered write result.');
  assert.deepEqual(completedWrites, writes, 'rapid input must reach the PTY in exact submission order.');
  assert.equal(maxInFlight, 1, 'a session must have at most one in-flight input write.');
  assert.ok(maxPending > 1, 'the test must exercise queued input rather than serial submission.');
  assert.equal(queue.getPendingCount(), 0);
  assert.equal(queue.getInFlightCount(), 0);

  const recoveryQueue = new ExecutionInputQueue();
  const recoveryOrder = [];
  const rejected = recoveryQueue.enqueue(() => {
    throw new Error('intentional input write failure');
  });
  const next = recoveryQueue.enqueue(() => {
    recoveryOrder.push('next-input');
    return 'next-input';
  });
  await assert.rejects(rejected, /intentional input write failure/u);
  assert.equal(await next, 'next-input', 'a failed input must not block the next queued control byte.');
  assert.deepEqual(recoveryOrder, ['next-input']);
  assert.equal(recoveryQueue.getPendingCount(), 0);
  assert.equal(recoveryQueue.getInFlightCount(), 0);

  const admissionQueue = new ExecutionInputQueue();
  const admitted = [];
  let releaseFirstResponse;
  const firstResponse = new Promise((resolve) => {
    releaseFirstResponse = resolve;
  });
  let firstCompleted = false;
  const first = admissionQueue.enqueue(async (_state, release) => {
    admitted.push('first');
    release();
    await firstResponse;
    firstCompleted = true;
    return 'first';
  });
  const second = admissionQueue.enqueue((_state, release) => {
    admitted.push('second');
    release();
    return 'second';
  });
  assert.equal(await second, 'second');
  assert.deepEqual(admitted, ['first', 'second'], 'input dispatch must remain FIFO.');
  assert.equal(
    firstCompleted,
    false,
    'a later input must dispatch without waiting for the previous RPC response.'
  );
  releaseFirstResponse();
  assert.equal(await first, 'first');
  assert.equal(admissionQueue.getPendingCount(), 0);
  assert.equal(admissionQueue.getInFlightCount(), 0);

  await assertRuntimeSupervisorInputDispatchDoesNotWaitForResponse(RuntimeSupervisorClient, tempDir);
  await assertSupervisorInputPrecedesProjection();
  await assertHostDoesNotAdvanceSupervisorLifecycleBeforePtyWrite();
} finally {
  await rm(tempDir, { recursive: true, force: true });
}

function delay(durationMs) {
  return new Promise((resolve) => setTimeout(resolve, durationMs));
}

async function assertRuntimeSupervisorInputDispatchDoesNotWaitForResponse(RuntimeSupervisorClient, tempDir) {
  const socketPath =
    process.platform === 'win32'
      ? `\\\\.\\pipe\\dsc-input-dispatch-${process.pid}-${Date.now()}`
      : path.join(tempDir, 'input-dispatch.sock');
  const sockets = new Set();
  const inputRequests = [];
  const inputWaiters = [];
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.setEncoding('utf8');
    socket.on('close', () => sockets.delete(socket));
    let buffer = '';
    socket.on('data', (chunk) => {
      buffer += chunk;
      while (true) {
        const newlineIndex = buffer.indexOf('\n');
        if (newlineIndex < 0) {
          return;
        }
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        if (!line) {
          continue;
        }
        const message = JSON.parse(line);
        if (message.type !== 'request') {
          continue;
        }
        if (message.method === 'hello') {
          socket.write(`${JSON.stringify({
            type: 'response',
            id: message.id,
            ok: true,
            result: {
              serverVersion: 1,
              pid: process.pid,
              runtimeBackend: 'legacy-detached',
              runtimeGuarantee: 'best-effort',
              capabilities: {}
            }
          })}\n`);
          continue;
        }
        if (message.method === 'writeInput') {
          inputRequests.push({ socket, message });
          inputWaiters.splice(0).forEach((resolve) => resolve());
        }
      }
    });
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(socketPath, resolve);
  });
  const client = new RuntimeSupervisorClient({
    backend: {
      kind: 'legacy-detached',
      guarantee: 'best-effort',
      label: 'Input Dispatch Test Supervisor',
      paths: {
        storageDir: tempDir,
        socketPath,
        registryPath: path.join(tempDir, 'input-dispatch-registry.json'),
        socketLocation: process.platform === 'win32' ? 'named-pipe' : 'storage'
      },
      startSupervisor: async () => assert.fail('The connected test client must not restart the Supervisor.')
    },
    supervisorScriptPath: '/unused/runtimeSupervisorMain.js',
    supervisorLauncherScriptPath: '/unused/runtimeSupervisorLauncher.js'
  });

  try {
    const first = await client.dispatchInput({ sessionId: 'session-1', data: 'a' });
    await waitForInputRequest(inputRequests, inputWaiters, 1);
    let firstResponseSettled = false;
    void first.response.finally(() => {
      firstResponseSettled = true;
    });

    const second = await client.dispatchInput({ sessionId: 'session-1', data: 'b' });
    await waitForInputRequest(inputRequests, inputWaiters, 2);
    assert.deepEqual(
      inputRequests.map(({ message }) => message.params.data),
      ['a', 'b'],
      'connected input requests must be written to the socket in dispatch order.'
    );
    assert.equal(
      firstResponseSettled,
      false,
      'dispatchInput must expose admission before the Supervisor response arrives.'
    );

    for (const { socket, message } of inputRequests) {
      socket.write(`${JSON.stringify({
        type: 'response',
        id: message.id,
        ok: true,
        result: { ok: true }
      })}\n`);
    }
    await Promise.all([first.response, second.response]);
  } finally {
    client.dispose();
    for (const socket of sockets) {
      socket.destroy();
    }
    await new Promise((resolve) => server.close(resolve));
  }
}

async function waitForInputRequest(inputRequests, inputWaiters, count) {
  const deadline = Date.now() + 2000;
  while (inputRequests.length < count) {
    const remainingMs = deadline - Date.now();
    assert.ok(remainingMs > 0, `Timed out waiting for ${count} input request(s).`);
    await Promise.race([
      new Promise((resolve) => inputWaiters.push(resolve)),
      delay(Math.min(remainingMs, 25))
    ]);
  }
}

async function assertSupervisorInputPrecedesProjection() {
  const source = await readFile(
    path.resolve('extensions/vscode/dev-session-canvas/src/supervisor/runtimeSupervisorMain.ts'),
    'utf8'
  );
  const writeInputStart = source.indexOf('  private writeInput(');
  const writeInputEnd = source.indexOf('  private async resizeSession(', writeInputStart);
  assert.ok(writeInputStart >= 0 && writeInputEnd > writeInputStart, 'writeInput source must be discoverable.');
  const writeInputSource = source.slice(writeInputStart, writeInputEnd);
  const admissionIndex = writeInputSource.indexOf('this.assertTerminalMutationAdmissionOpen(session);');
  const ptyWriteIndex = writeInputSource.indexOf('session.process?.write(params.data);');
  const lifecycleMutationIndex = writeInputSource.indexOf("session.lifecycle = 'running';");
  const lifecycleReturnIndex = writeInputSource.indexOf('return session;', lifecycleMutationIndex);
  assert.ok(admissionIndex >= 0 && admissionIndex < ptyWriteIndex, 'writeInput must fail closed before PTY admission.');
  assert.ok(ptyWriteIndex >= 0, 'writeInput must admit data to the PTY.');
  assert.ok(
    lifecycleMutationIndex > ptyWriteIndex && lifecycleReturnIndex > lifecycleMutationIndex,
    'PTY admission must happen before lifecycle mutation is returned for projection.'
  );
  assert.doesNotMatch(
    writeInputSource,
    /emitSessionState/u,
    'writeInput must return lifecycle work to the request handler instead of emitting before the response.'
  );
  assert.doesNotMatch(
    writeInputSource.slice(0, ptyWriteIndex),
    /emitSessionState|toSnapshot|getEventsAfter|terminalJournal/u,
    'the pre-write path must not construct or inspect terminal projection history.'
  );

  const writeInputHandlerStart = source.indexOf("        case 'writeInput': {");
  const writeInputHandlerEnd = source.indexOf("        case 'resizeSession':", writeInputHandlerStart);
  const writeInputHandlerSource = source.slice(writeInputHandlerStart, writeInputHandlerEnd);
  const handlerWriteIndex = writeInputHandlerSource.indexOf('this.writeInput(request.params);');
  const responseWriteIndex = writeInputHandlerSource.indexOf('this.writeOkResponse(socket, request.id);');
  const lifecycleEmitIndex = writeInputHandlerSource.indexOf('this.emitSessionState(lifecycleSession);');
  assert.ok(
    handlerWriteIndex >= 0 && responseWriteIndex > handlerWriteIndex && lifecycleEmitIndex > responseWriteIndex,
    'writeInput must place its response on the control socket before publishing the triggered lifecycle.'
  );

  const emitStateStart = source.indexOf('  private emitSessionState(');
  const emitStateEnd = source.indexOf('  private async emitFreshSessionState(', emitStateStart);
  assert.ok(emitStateStart >= 0 && emitStateEnd > emitStateStart, 'emitSessionState source must be discoverable.');
  assert.match(
    source.slice(emitStateStart, emitStateEnd),
    /payload: this\.toSnapshot\(session, undefined, false\)/u,
    'ordinary lifecycle events must explicitly omit checkpoint and journal projection payloads.'
  );
}

async function assertHostDoesNotAdvanceSupervisorLifecycleBeforePtyWrite() {
  const source = await readFile(
    path.resolve('extensions/vscode/dev-session-canvas/src/panel/CanvasPanelManager.ts'),
    'utf8'
  );
  const writeInputStart = source.indexOf('  private async writeExecutionInputNow(');
  const writeInputEnd = source.indexOf('  private async copyExecutionSelection(', writeInputStart);
  assert.ok(writeInputStart >= 0 && writeInputEnd > writeInputStart, 'Host input source must be discoverable.');
  const writeInputSource = source.slice(writeInputStart, writeInputEnd);
  assert.match(
    writeInputSource,
    /if \(session\.owner === 'local' && kind === 'agent'\)[\s\S]*session\.lifecycleStatus = 'running';/u,
    'only a local PTY may be advanced optimistically after its synchronous write.'
  );
  assert.doesNotMatch(
    writeInputSource,
    /session\.owner === 'supervisor'[\s\S]*session\.lifecycleStatus = 'running';/u,
    'Supervisor-owned lifecycle must wait for the post-PTY-write Supervisor event.'
  );
}
