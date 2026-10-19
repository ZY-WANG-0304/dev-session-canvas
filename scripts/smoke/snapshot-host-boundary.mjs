import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { waitForHostAbsence } from './host-evidence.mjs';

// Both launches use the same private persisted workspace, but two verified
// Host creation identities. An ordinary page reload cannot satisfy this case.
export async function runSnapshotHostBoundary({ runtime, scenario, launch }) {
  const controlFile = path.join(runtime.artifactsDir, 'snapshot-host-control.json');
  const stateFile = path.join(runtime.artifactsDir, 'snapshot-host-state.json');
  const control = phase => fs.writeFile(controlFile, JSON.stringify({ phase, stateFile }));
  const env = { DEV_SESSION_CANVAS_SNAPSHOT_HOST_CONTROL_FILE: controlFile };
  await control('setup');
  await launch(env);
  const expected = JSON.parse(await fs.readFile(stateFile, 'utf8'));
  assert.equal(expected.caseID, scenario);
  const original = expected.host;
  const host = { pid: original.pid, ...(process.platform === 'linux'
    ? { startTicks: original.start } : { startTime: original.start }) };
  const inherited = Number(process.env.DEV_SESSION_CANVAS_GATE_DEADLINE);
  const deadline = Math.min(Date.now() + 30000, inherited > 0 ? inherited : Infinity);
  const exit = await waitForHostAbsence(host, deadline);
  for (const original of expected.originalProcesses) {
    await waitForHostAbsence({ pid: original.pid, ...(process.platform === 'linux'
      ? { startTicks: original.start } : { startTime: original.start }) }, deadline);
  }
  // Keep the actual post-exit bytes for inspection; never overwrite the saved
  // canvas with test expectations or normalize it before the verify Host.
  const bytes = await fs.readFile(expected.snapshotPath);
  await fs.writeFile(path.join(runtime.artifactsDir, 'snapshot-after-host-exit.json'), bytes, { flag: 'wx' });
  await fs.writeFile(path.join(runtime.artifactsDir, 'snapshot-host-exit.json'), JSON.stringify(exit), { flag: 'wx' });
  await control('verify');
  await launch(env);
}
