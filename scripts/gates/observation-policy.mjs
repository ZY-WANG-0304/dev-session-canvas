import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { jobDependencies, taskKey } from './catalog.mjs';
export const observationPolicy = JSON.parse(readFileSync(new URL('./observation-policy.json', import.meta.url), 'utf8'));
export function validateObservationPolicy(policy, all) {
  assert.equal(policy.version, 1); const keys = new Set(), ids = new Set();
  for (const entry of policy.entries) {
    assert(/^[a-z][a-z0-9-]+$/.test(entry.id) && !ids.has(entry.id)); ids.add(entry.id);
    for (const field of ['suite', 'variant', 'owner', 'reason', 'tracking', 'reviewAfter', 'evidence']) assert(entry[field]?.length);
    assert(['source-host', 'packaged-host'].includes(entry.job), 'Only isolated Host cases may be observations');
    const matches = all.filter(task => task.job === entry.job && task.suite === entry.suite && task.variant === entry.variant);
    assert.equal(matches.length, 1, `Observation must identify one actual case: ${entry.id}`);
    assert(!keys.has(taskKey(matches[0]))); keys.add(taskKey(matches[0]));
    assert(entry.failurePatterns.length); entry.failurePatterns.forEach(pattern => new RegExp(pattern, 'i'));
  }
  return keys;
}
export function splitObservations(tasks, all, policy = observationPolicy) {
  const keys = validateObservationPolicy(policy, all);
  const observed = tasks.filter(task => keys.has(taskKey(task)));
  const needed = new Set(observed.map(taskKey));
  let changed;
  do {
    changed = false;
    for (const task of all.filter(item => needed.has(taskKey(item)))) for (const dependency of jobDependencies[task.job] ?? []) {
      for (const producer of all.filter(item => item.job === dependency)) if (!needed.has(taskKey(producer))) {
        needed.add(taskKey(producer)); changed = true;
      }
    }
  } while (changed);
  return { required: tasks.filter(task => !keys.has(taskKey(task))),
    observationTasks: all.filter(task => needed.has(taskKey(task))),
    observations: observed.map(task => ({ key: taskKey(task), ...policy.entries.find(entry => entry.job === task.job && entry.variant === task.variant && entry.suite === task.suite) })) };
}
