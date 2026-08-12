import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

import esbuild from 'esbuild';

const tempDir = await mkdtemp(path.join(os.tmpdir(), 'dsc-terminal-projection-assembler-'));

try {
  const bundlePath = path.join(tempDir, 'terminalProjectionAssembler.cjs');
  await esbuild.build({
    entryPoints: [
      path.resolve('extensions/vscode/dev-session-canvas/src/common/terminalProjectionAssembler.ts')
    ],
    bundle: true,
    format: 'cjs',
    outfile: bundlePath,
    platform: 'node',
    target: 'node18'
  });

  const require = createRequire(import.meta.url);
  const {
    assembleTerminalProjection,
    checksumTerminalProjectionChunk,
    createTerminalProjectionAssembler,
    TerminalProjectionAssemblyError
  } = require(bundlePath);

  const options = createOptions();
  const results = createCompleteResults(options, checksumTerminalProjectionChunk);
  const payload = assembleTerminalProjection(options, results);
  assert.equal(payload.sessionId, options.sessionId);
  assert.equal(payload.authorityId, options.authorityId);
  assert.equal(payload.revision, options.targetRevision);
  assert.equal(payload.checkpoint.revision, 1);
  assert.equal(payload.checkpoint.serializedState.data, 'screen-state');
  assert.equal(payload.checkpoint.serializedState.outputSequence, 1);
  assert.deepEqual(payload.events, [
    {
      type: 'output',
      revision: 2,
      createdAtMs: 200,
      data: 'hello'
    },
    {
      type: 'resize',
      revision: 3,
      createdAtMs: 300,
      cols: 100,
      rows: 30
    },
    {
      type: 'output',
      revision: 4,
      createdAtMs: 400,
      data: 'final🙂'
    }
  ]);

  const incremental = createTerminalProjectionAssembler(options);
  for (const result of results) {
    incremental.append(result);
  }
  assert.equal(incremental.done, true);
  assert.deepEqual(incremental.finish(), payload);
  assert.deepEqual(incremental.finish(), payload, 'finish should be idempotent after a valid stream.');

  assertAssemblyError(
    () => assembleTerminalProjection(options, results.map((result) => ({ ...result, projectionId: 'other' }))),
    TerminalProjectionAssemblyError,
    'identity-mismatch'
  );

  assertAssemblyError(
    () => assembleTerminalProjection(options, results.map((result, index) => (
      index === 1 ? { ...result, chunkChecksum: '0'.repeat(64) } : result
    ))),
    TerminalProjectionAssemblyError,
    'invalid-checksum'
  );

  assertAssemblyError(
    () => assembleTerminalProjection(options, results.map((result, index) => (
      index === 0 ? { ...result, payloadBytes: result.payloadBytes + 1 } : result
    ))),
    TerminalProjectionAssemblyError,
    'invalid-payload-size'
  );

  const offsetResults = createCompleteResults(options, checksumTerminalProjectionChunk);
  offsetResults[1] = {
    ...offsetResults[1],
    chunk: { ...offsetResults[1].chunk, dataOffset: 1 },
    chunkChecksum: checksumTerminalProjectionChunk({ ...offsetResults[1].chunk, dataOffset: 1 })
  };
  assertAssemblyError(
    () => assembleTerminalProjection(options, offsetResults),
    TerminalProjectionAssemblyError,
    'chunk-order'
  );

  const gapResults = createCompleteResults(options, checksumTerminalProjectionChunk);
  gapResults[2] = {
    ...gapResults[2],
    chunk: { ...gapResults[2].chunk, revision: 4 },
    chunkChecksum: checksumTerminalProjectionChunk({ ...gapResults[2].chunk, revision: 4 })
  };
  assertAssemblyError(
    () => assembleTerminalProjection(options, gapResults),
    TerminalProjectionAssemblyError,
    'chunk-order'
  );

  const splitResults = createCompleteResults(options, checksumTerminalProjectionChunk);
  splitResults[1] = {
    ...splitResults[1],
    chunk: { ...splitResults[1].chunk, data: 'state\ud83d', complete: false },
    payloadBytes: Buffer.byteLength(JSON.stringify({
      ...splitResults[1].chunk,
      data: 'state\ud83d',
      complete: false
    }), 'utf8'),
    chunkChecksum: checksumTerminalProjectionChunk({
      ...splitResults[1].chunk,
      data: 'state\ud83d',
      complete: false
    })
  };
  splitResults.splice(2, 0, createResult(options, {
    kind: 'output',
    revision: 2,
    createdAtMs: 200,
    dataOffset: 0,
    data: 'hello',
    complete: true
  }, false, checksumTerminalProjectionChunk));
  assertAssemblyError(
    () => assembleTerminalProjection(options, splitResults),
    TerminalProjectionAssemblyError,
    'chunk-order'
  );

  const surrogateResults = createCompleteResults(options, checksumTerminalProjectionChunk).slice(0, 2);
  surrogateResults.push(createResult(options, {
    kind: 'output',
    revision: 2,
    createdAtMs: 200,
    dataOffset: 0,
    data: '\ud83d',
    complete: false
  }, false, checksumTerminalProjectionChunk));
  surrogateResults.push(createResult(options, {
    kind: 'output',
    revision: 2,
    createdAtMs: 200,
    dataOffset: 1,
    data: '\ude42',
    complete: true
  }, false, checksumTerminalProjectionChunk));
  assertAssemblyError(
    () => assembleTerminalProjection(options, surrogateResults),
    TerminalProjectionAssemblyError,
    'chunk-order'
  );

  const liveResult = createCompleteResults(options, checksumTerminalProjectionChunk).at(-1);
  assert.ok(liveResult);
  assertAssemblyError(
    () => assembleTerminalProjection(options, [
      ...results.slice(0, -1),
      { ...liveResult, live: true }
    ]),
    TerminalProjectionAssemblyError,
    'invalid-response'
  );

  const earlyDone = createCompleteResults(options, checksumTerminalProjectionChunk);
  earlyDone[1] = { ...earlyDone[1], done: true };
  assertAssemblyError(
    () => assembleTerminalProjection(options, earlyDone),
    TerminalProjectionAssemblyError,
    'incomplete'
  );

  const noDone = createCompleteResults(options, checksumTerminalProjectionChunk).slice(0, -1);
  assertAssemblyError(
    () => assembleTerminalProjection(options, noDone),
    TerminalProjectionAssemblyError,
    'incomplete'
  );

  const emptyFinalOptions = {
    ...options,
    targetRevision: 1,
    checkpoint: {
      ...options.checkpoint,
      revision: 1
    }
  };
  const emptyFinalChunk = {
    kind: 'checkpoint',
    dataOffset: 0,
    data: '',
    complete: true
  };
  const emptyPayload = assembleTerminalProjection(emptyFinalOptions, [
    createResult(emptyFinalOptions, emptyFinalChunk, true, checksumTerminalProjectionChunk)
  ]);
  assert.deepEqual(emptyPayload.events, []);

  const largeOutputOptions = {
    ...options,
    targetRevision: 2
  };
  const largeOutputChunk = 'x'.repeat(4 * 1024);
  const largeOutputChunkCount = 512;
  const largeOutputResults = [
    createResult(largeOutputOptions, {
      kind: 'checkpoint',
      dataOffset: 0,
      data: '',
      complete: true
    }, false, checksumTerminalProjectionChunk)
  ];
  for (let index = 0; index < largeOutputChunkCount; index += 1) {
    largeOutputResults.push(createResult(largeOutputOptions, {
      kind: 'output',
      revision: 2,
      createdAtMs: 200,
      dataOffset: index * largeOutputChunk.length,
      data: largeOutputChunk,
      complete: index === largeOutputChunkCount - 1
    }, index === largeOutputChunkCount - 1, checksumTerminalProjectionChunk));
  }
  const largeOutputPayload = assembleTerminalProjection(
    largeOutputOptions,
    largeOutputResults
  );
  assert.equal(largeOutputPayload.events.length, 1);
  assert.equal(
    largeOutputPayload.events[0].data.length,
    largeOutputChunk.length * largeOutputChunkCount,
    'Chunked multi-megabyte output should be materialized exactly once at its completion boundary.'
  );

  console.log('terminal projection assembler tests passed');
} finally {
  await rm(tempDir, { recursive: true, force: true });
}

function createOptions() {
  return {
    sessionId: 'session-a',
    authorityId: 'authority-a',
    projectionId: 'projection-a',
    supervisorInstanceId: 'supervisor-a',
    targetRevision: 4,
    checkpoint: {
      version: 1,
      sessionId: 'session-a',
      authorityId: 'authority-a',
      revision: 1,
      cols: 80,
      rows: 24,
      scrollback: 1000,
      createdAtMs: 100,
      serializedState: {
        format: 'xterm-serialize-v1'
      }
    }
  };
}

function createCompleteResults(options, checksum) {
  return [
    createResult(options, {
      kind: 'checkpoint',
      dataOffset: 0,
      data: 'screen-',
      complete: false
    }, false, checksum),
    createResult(options, {
      kind: 'checkpoint',
      dataOffset: 7,
      data: 'state',
      complete: true
    }, false, checksum),
    createResult(options, {
      kind: 'output',
      revision: 2,
      createdAtMs: 200,
      dataOffset: 0,
      data: 'hel',
      complete: false
    }, false, checksum),
    createResult(options, {
      kind: 'output',
      revision: 2,
      createdAtMs: 200,
      dataOffset: 3,
      data: 'lo',
      complete: true
    }, false, checksum),
    createResult(options, {
      kind: 'resize',
      revision: 3,
      createdAtMs: 300,
      cols: 100,
      rows: 30,
      complete: true
    }, false, checksum),
    createResult(options, {
      kind: 'output',
      revision: 4,
      createdAtMs: 400,
      dataOffset: 0,
      data: 'final🙂',
      complete: true
    }, true, checksum)
  ];
}

function createResult(options, chunk, done, checksum) {
  const serializedChunk = JSON.stringify(chunk);
  return {
    supervisorInstanceId: options.supervisorInstanceId,
    projectionId: options.projectionId,
    sessionId: options.sessionId,
    authorityId: options.authorityId,
    targetRevision: options.targetRevision,
    payloadBytes: Buffer.byteLength(serializedChunk, 'utf8'),
    chunkChecksum: checksum(chunk),
    chunk,
    done
  };
}

function assertAssemblyError(callback, ErrorType, code) {
  assert.throws(callback, (error) => {
    assert.ok(error instanceof ErrorType);
    assert.equal(error.code, code);
    return true;
  });
}
