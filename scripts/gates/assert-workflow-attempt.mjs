import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function assertWorkflowAttempt(producerAttempt, currentAttempt) {
  assert(/^[1-9]\d*$/.test(producerAttempt ?? '') && producerAttempt === currentAttempt,
    'Validation inputs were not produced in this attempt. Use Re-run all jobs, not Re-run failed jobs; ' +
    'a complete workflow rerun must rebuild the plan, control files and producers together.');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assertWorkflowAttempt(process.env.GATE_PRODUCER_ATTEMPT, process.env.GITHUB_RUN_ATTEMPT);
}
