import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { randomUUID } from 'node:crypto';
import { githubClient, collectReleaseFacts } from './release-github.mjs';
import { readJSON, objectDigest, writeJSON } from '../gates/receipts.mjs';
import { findUniqueFile } from '../gates/check-acceptance.mjs';
import { releaseJobName, validateReleaseContext } from './release-completion.mjs';
import { resolveRelease, resolveIncompleteReleaseRecovery, verifyRecoveredRelease, collectNewReleaseInput,
  prepareRelease, finalizeRelease } from './release-delivery.mjs';

export async function runReleaseCLI(args = process.argv.slice(2)) {
  const { values } = parseArgs({ args, options: { phase: { type: 'string' }, context: { type: 'string' },
    'trigger-tag': { type: 'string' }, target: { type: 'string', default: 'all' }, output: { type: 'string' },
    input: { type: 'string' }, 'run-head': { type: 'string' },
    'recovery-source-run-id': { type: 'string' }, help: { type: 'boolean' } } });
  if (values.help) { console.log('release:publish-tag -- --phase resolve|verify-recovery|prepare|finalize --context <file> --output <dir>\n新发布只消费最终 SHA 已验收双包；历史 tag 请运行其原 workflow。\n初始 prepare 失败且渠道未运行时，可在 main 的 workflow_dispatch 中传入 --recovery-source-run-id。'); return; }
  assert(values.output && ['resolve', 'verify-recovery', 'prepare', 'finalize'].includes(values.phase),
    'Specify an explicit release phase and output; packaging is not a delivery operation');
  const output = path.resolve(values.output); await fs.mkdir(output, { recursive: true });
  const client = githubClient();
  const run = { id: process.env.GITHUB_RUN_ID ?? `local-${randomUUID()}`,
    attempt: Number(process.env.GITHUB_RUN_ATTEMPT ?? 1), headSHA: values['run-head'] ?? process.env.GITHUB_SHA };
  let context;
  try {
    if (values.phase === 'resolve') {
      if (values['recovery-source-run-id']) {
        assert.equal(process.env.GITHUB_EVENT_NAME, 'workflow_dispatch',
          'Incomplete recovery is only allowed from workflow_dispatch');
        assert.equal(process.env.GITHUB_REF, 'refs/heads/main',
          'Incomplete recovery must be dispatched from main');
        assert.equal(values.target, 'all', 'Incomplete recovery must select all delivery targets');
        context = await resolveIncompleteReleaseRecovery({ triggerTag: values['trigger-tag'],
          recoverySourceRunID: values['recovery-source-run-id'], run, client });
      } else context = await resolveRelease({ triggerTag: values['trigger-tag'], selection: values.target, run, client });
      await writeJSON(path.join(output, 'release-context.json'), context);
      if (process.env.GITHUB_OUTPUT) await fs.appendFile(process.env.GITHUB_OUTPUT,
        `input_sha=${context.releaseSHA}\nbase_sha=${context.baseSHA}\nversion=${context.version}\nmode=${context.mode}\ntrigger_tag=${context.triggerTag}\n`);
      return;
    }
    assert(values.context, 'Consumer phases require a frozen release context');
    context = validateReleaseContext(await readJSON(values.context));
    assert.equal(context.repository, client.repository); assert.equal(context.run.id, run.id);
    assert.equal(context.run.attempt, run.attempt);
    if (run.headSHA) assert.equal(context.run.headSHA, run.headSHA);
    if (values.phase === 'verify-recovery') {
      const result = await verifyRecoveredRelease({ context, output, client });
      if (process.env.GITHUB_OUTPUT) await fs.appendFile(process.env.GITHUB_OUTPUT, `accepted=${result.status === 'passed'}\n`);
    } else if (values.phase === 'prepare') {
      let input;
      if (['release-tag', 'incomplete-release-recovery'].includes(context.mode)) {
        input = await collectNewReleaseInput({ context, output, client });
      } else {
        const artifactName = `recovered-release-${context.run.id}-${context.run.attempt}`;
        const facts = await collectReleaseFacts(context, { client, output: path.join(output, 'verified-recovery'),
          allowedNames: [artifactName], namesForJobs: () => releaseJobName('verify-recovery') });
        const artifact = facts.artifacts[0]; const job = facts.jobs.find(job => job.id === artifact.jobID);
        assert.equal(job?.conclusion, 'success');
        input = path.dirname(await findUniqueFile(path.join(output, 'verified-recovery', artifactName), 'recovery-verification.json'));
        const receipt = await readJSON(path.join(input, 'recovery-verification.json'));
        assert(artifact.receiptDigests.includes(objectDigest(receipt)));
      }
      await prepareRelease({ context, input, output: path.join(output, 'prepared'), client });
    } else {
      assert(values.input, 'Finalize requires the exact prepared input');
      const result = await finalizeRelease({ context, prepared: values.input, output, client });
      if (result.completion.status !== 'complete' || result.cleanup.status !== 'passed') process.exitCode = 1;
    }
  } catch (error) {
    await writeJSON(path.join(output, 'release-failure.json'), { schemaVersion: 1, phase: values.phase,
      releaseSHA: context?.releaseSHA ?? null, run, status: 'failed', reason: error.message,
      occurredAt: new Date().toISOString() });
    throw error;
  }
}
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  await runReleaseCLI().catch(error => { console.error(error.message); process.exitCode = 1; });
}
