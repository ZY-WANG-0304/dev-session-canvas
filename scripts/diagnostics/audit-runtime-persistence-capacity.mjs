import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import esbuild from 'esbuild';
import ts from 'typescript';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const sourceRoot = path.join(repoRoot, 'extensions/vscode/dev-session-canvas/src');
const supervisorFile = path.join(sourceRoot, 'supervisor/runtimeSupervisorMain.ts');
const supervisorSource = fs.readFileSync(supervisorFile, 'utf8');
const supervisorAst = ts.createSourceFile(supervisorFile, supervisorSource, ts.ScriptTarget.Latest, true);
const mainCalls = supervisorAst.statements.filter((node) =>
  ts.isExpressionStatement(node) && node.getText(supervisorAst).startsWith('void main()')
);
assert.equal(mainCalls.length, 1, 'The diagnostic must disable exactly one Supervisor entry point.');
const mainCall = mainCalls[0];

// Export the actual classes only in the in-memory bundle; never start a daemon or PTY.
const diagnosticSource = supervisorSource.slice(0, mainCall.pos) + supervisorSource.slice(mainCall.end) +
  '\nexport { RuntimeSupervisorServer, TerminalSessionJournal, SerializedTerminalStateTracker };\n';
const bundle = await esbuild.build({
  stdin: {
    contents: diagnosticSource,
    resolveDir: path.dirname(supervisorFile),
    sourcefile: supervisorFile,
    loader: 'ts'
  },
  bundle: true,
  write: false,
  format: 'cjs',
  platform: 'node',
  target: 'node18',
  external: ['node-pty']
});
const bundledModule = { exports: {} };
new Function('module', 'exports', 'require', bundle.outputFiles[0].text)(
  bundledModule,
  bundledModule.exports,
  createRequire(import.meta.url)
);
const { RuntimeSupervisorServer, TerminalSessionJournal, SerializedTerminalStateTracker } = bundledModule.exports;

const hostFile = path.join(sourceRoot, 'panel/CanvasPanelManager.ts');
const hostSource = fs.readFileSync(hostFile, 'utf8');
const hostAst = ts.createSourceFile(hostFile, hostSource, ts.ScriptTarget.Latest, true);
const hostClass = hostAst.statements.find((node) =>
  ts.isClassDeclaration(node) && node.name?.text === 'CanvasPanelManager'
);
const writerMethod = hostClass?.members.find((node) =>
  ts.isMethodDeclaration(node) && node.name.getText(hostAst) === 'writePersistedCanvasSnapshotToDisk'
);
assert.ok(writerMethod, 'The diagnostic must use the current Host snapshot writer.');
const writerSource = ts.transpileModule(`class SnapshotWriter { ${writerMethod.getText(hostAst)} }`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022 }
}).outputText;
const SnapshotWriter = new Function('fs', 'path', `${writerSource}\nreturn SnapshotWriter;`)(fs, path);

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsc-runtime-persistence-capacity-'));
const tracker = new SerializedTerminalStateTracker(80, 24, { scrollback: 1000, initialOutputSequence: 0 });
const oversizedTracker = new SerializedTerminalStateTracker(80, 24, { scrollback: 10000, initialOutputSequence: 0 });
let journal;

try {
  oversizedTracker.write(`${'x'.repeat(78)}\r\n`.repeat(5000), { outputSequence: 1 });
  const largeCheckpoint = await oversizedTracker.flushValidatedCheckpoint();
  assert.deepEqual(largeCheckpoint, { eligible: false, reason: 'serialized-state-too-large' });
  console.log(JSON.stringify({ scenario: 'large-checkpoint', ...largeCheckpoint }));

  journal = await TerminalSessionJournal.create({
    storageDir: tempDir,
    sessionId: 'capacity-audit',
    initialCols: 80,
    initialRows: 24,
    initialScrollback: 1000
  });
  const server = new RuntimeSupervisorServer({
    storageDir: tempDir,
    registryPath: path.join(tempDir, 'registry.json')
  }, 'legacy-detached', 'best-effort');
  const session = {
    sessionId: 'capacity-audit',
    kind: 'terminal',
    live: true,
    lifecycle: 'live',
    runtimeBackend: 'legacy-detached',
    runtimeGuarantee: 'best-effort',
    shellPath: '/bin/sh',
    cwd: tempDir,
    cols: 80,
    rows: 24,
    scrollback: 1000,
    output: '',
    outputSequence: 0,
    terminalAuthorityId: journal.getAuthorityId(),
    terminalJournal: journal,
    terminalStateTracker: tracker,
    terminalOperationChain: Promise.resolve(),
    terminalMutationAdmissionOpen: true,
    terminalCheckpoint: {
      version: 1,
      sessionId: 'capacity-audit',
      authorityId: journal.getAuthorityId(),
      revision: 0,
      cols: 80,
      rows: 24,
      scrollback: 1000,
      createdAtMs: Date.now(),
      serializedState: tracker.getSerializedState()
    }
  };
  server.sessions.set(session.sessionId, session);
  const append = (data) => {
    const event = journal.appendOutput(data);
    tracker.write(data, { outputSequence: event.revision });
    session.outputSequence = event.revision;
  };
  append('\u001b]10;#ff0000\u0007');
  const block = `${'x'.repeat(78)}\r\n`.repeat(128);
  const metrics = [];

  for (let phase = 1; phase <= 3; phase += 1) {
    for (let index = 0; index < 640; index += 1) {
      append(block);
    }
    const snapshot = await server.toFreshSnapshot(session);
    assert.equal(snapshot.terminalStream.checkpoint.revision, 0);
    assert.deepEqual(await tracker.flushValidatedCheckpoint(), { eligible: false, reason: 'color-state' });
    const retained = journal.getEventsAfter(0);
    const metric = {
      scenario: 'live-suffix',
      phase,
      screenStateBytes: Buffer.byteLength(tracker.getSerializedState().data),
      retainedMemoryEvents: retained.length,
      retainedOutputBytes: retained.reduce((sum, event) =>
        sum + (event.type === 'output' ? Buffer.byteLength(event.data) : 0), 0),
      journalDiskBytes: directoryBytes(path.join(tempDir, 'terminal-journals')),
      snapshotBytes: Buffer.byteLength(JSON.stringify(snapshot)),
      checkpointRevision: snapshot.terminalStream.checkpoint.revision,
      compactionDue: journal.shouldCommitCheckpoint(journal.getRevision())
    };
    metrics.push(metric);
    console.log(JSON.stringify(metric));
  }

  const last = metrics.at(-1);
  assert.ok(last.retainedOutputBytes > 16 * 1024 * 1024);
  assert.ok(last.screenStateBytes < 100000);
  assert.equal(last.compactionDue, true);
  const refreshed = await server.toFreshSnapshot(session);
  assert.equal(refreshed.terminalStream.events.length, last.retainedMemoryEvents);

  session.live = false;
  session.lifecycle = 'closed';
  session.terminalMutationAdmissionOpen = false;
  const completed = await server.toFreshSnapshot(session, 'never');
  assert.equal(completed.terminalStream.revision, journal.getRevision());
  assert.equal(completed.terminalStream.events.length, last.retainedMemoryEvents);

  // This minimal canvas measures inline bytes, not the full Host handoff workflow.
  const node = {
    id: 'completed-terminal',
    kind: 'terminal',
    position: { x: 0, y: 0 },
    metadata: { terminal: { terminalStream: completed.terminalStream } }
  };
  const canvas = { version: 1, state: { version: 1, nodes: [node] } };
  const writer = new SnapshotWriter();
  const snapshotPath = path.join(tempDir, 'canvas-state.json');
  const firstWriteBytes = writer.writePersistedCanvasSnapshotToDisk(snapshotPath, canvas);
  node.position.x = 1;
  const moveWriteBytes = writer.writePersistedCanvasSnapshotToDisk(snapshotPath, canvas);
  assert.ok(firstWriteBytes > last.retainedOutputBytes);
  assert.equal(moveWriteBytes, firstWriteBytes);
  console.log(JSON.stringify({
    scenario: 'completed-inline-canvas',
    completedSnapshotBytes: Buffer.byteLength(JSON.stringify(completed)),
    inlineCanvasWriteBytes: firstWriteBytes,
    subsequentPositionOnlyWriteBytes: moveWriteBytes
  }));
  console.log('Current persistence capacity behavior reproduced; no production runtime was started or modified.');
} finally {
  tracker.dispose();
  oversizedTracker.dispose();
  try {
    await journal?.flush();
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function directoryBytes(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).reduce((sum, entry) => {
    const entryPath = path.join(directory, entry.name);
    return sum + (entry.isDirectory() ? directoryBytes(entryPath) : fs.statSync(entryPath).size);
  }, 0);
}
