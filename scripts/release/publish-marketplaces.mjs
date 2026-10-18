import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { readJSON, objectDigest, verifyPackageFiles, writeJSON } from '../gates/receipts.mjs';
import { assertFormalEnvironment } from '../gates/resolve-plan.mjs';
import { openVsxClient, visualStudioClient } from './channel-client.mjs';
import { contentPolicyDigest, deliverPackage, deliveryIsComplete, releaseIdentity,
  validateChannelPartial, validateReleaseContext } from './release-completion.mjs';

export async function publishChannel({ context, prepared, target, output, client, deadline = Date.now() + 2400000,
  attempts = 12, intervalMs = 30000 }) {
  validateReleaseContext(context); assert(['open-vsx', 'visual-studio'].includes(target));
  const packageReceipt = await readJSON(path.join(prepared, 'package-receipt.json'));
  const plan = await readJSON(path.join(prepared, 'gate-plan.json'));
  await verifyPackageFiles(packageReceipt, plan, prepared);
  const identity = releaseIdentity({ context, acceptance: await readJSON(path.join(prepared, 'acceptance-receipt.json')), packageReceipt });
  assert.deepEqual(await readJSON(path.join(prepared, 'release-identity.json')), identity);
  const receipt = await readJSON(path.join(prepared, 'prepared-receipt.json'));
  assert.equal(receipt.status, 'passed'); assert.equal(receipt.identityDigest, objectDigest(identity));
  assert.equal(receipt.producer.runID, String(context.run.id)); assert.equal(receipt.producer.attempt, context.run.attempt);
  const history = await readJSON(path.join(prepared, 'validated-channel-history.json'));
  const selected = context.selectedTargets.includes(target);
  assert(selected || context.mode === 'channel-retry');
  const partial = { schemaVersion: 1, releaseSHA: context.releaseSHA, version: context.version,
    target, identityDigest: objectDigest(identity), contentPolicyDigest, packages: [],
    producer: { runID: String(context.run.id), attempt: context.run.attempt, repository: context.repository,
      job: `publish-${target}` }, completedAt: null };
  await fs.mkdir(output, { recursive: true });
  const privateRoot = path.join(output, 'channel-input'); await fs.mkdir(privateRoot);
  for (const pkg of [...identity.packages].sort((left, right) => Number(right.id.endsWith('-notifier')) - Number(left.id.endsWith('-notifier')))) {
    const file = path.join(privateRoot, pkg.path); await fs.copyFile(path.join(prepared, pkg.path), file);
    const previous = history[target]?.partial?.packages.find(entry => entry.extensionID === pkg.id);
    const entry = await deliverPackage({ pkg, query: (pkg, limit) => client.query(pkg, limit),
      submit: (pkg, limit) => client.submit(pkg, limit, file), deadline, selected,
      previous, attempts, intervalMs });
    partial.packages.push(entry); await writeJSON(path.join(output, 'channel-progress.json'), partial);
  }
  partial.completedAt = new Date().toISOString();
  validateChannelPartial(partial, identity, { context });
  await verifyPackageFiles(packageReceipt, plan, privateRoot);
  await verifyPackageFiles(packageReceipt, plan, prepared);
  await writeJSON(path.join(output, 'channel-partial.json'), partial);
  return { partial, complete: partial.packages.every(entry => deliveryIsComplete(entry,
    context.mode === 'channel-retry' && !selected)) };
}

export async function runChannelCLI(args = process.argv.slice(2)) {
  const { values } = parseArgs({ args, options: { context: { type: 'string' }, prepared: { type: 'string' },
    target: { type: 'string' }, output: { type: 'string' }, help: { type: 'boolean' } } });
  if (values.help) { console.log('publish:marketplaces -- --context <file> --prepared <dir> --target open-vsx|visual-studio --output <dir>\n只消费已验收原双包；查询未知不会提交或重新打包。'); return; }
  assertFormalEnvironment();
  assert(values.context && values.prepared && values.target && values.output, 'Explicit accepted pair and channel are required');
  const output = path.resolve(values.output); await fs.mkdir(output, { recursive: true });
  const context = validateReleaseContext(await readJSON(values.context));
  assert.equal(context.run.id, process.env.GITHUB_RUN_ID); assert.equal(context.run.attempt, Number(process.env.GITHUB_RUN_ATTEMPT));
  assert.equal(context.repository, process.env.GITHUB_REPOSITORY);
  const client = values.target === 'open-vsx' ? openVsxClient({ token: process.env.OVSX_PAT })
    : visualStudioClient({ token: process.env.VSCE_PAT, logPath: path.join(output, 'vsce.log') });
  try {
    const result = await publishChannel({ context, prepared: values.prepared, target: values.target, output, client });
    if (process.env.GITHUB_OUTPUT) await fs.appendFile(process.env.GITHUB_OUTPUT, `complete=${result.complete}\n`);
  } catch (error) {
    await writeJSON(path.join(output, 'channel-failure.json'), { schemaVersion: 1, target: values.target,
      status: 'failed', reason: error.message, occurredAt: new Date().toISOString() }); throw error;
  }
}
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  await runChannelCLI().catch(error => { console.error(error.message); process.exitCode = 1; });
}
