import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

// The inventory is generated from actual suite/helper call sites. Its bounds
// are conservative sums, not measured service levels. Product waits keep their
// own original limits; the outer ceiling does not reset any of those limits.
const root = fileURLToPath(new URL('../../', import.meta.url));
const inventory = JSON.parse(fs.readFileSync(path.join(root, 'scripts/smoke/smoke-budget-inventory.json'), 'utf8'));
export const smokeBudgetInventory = inventory;
export const smokeBudgets = Object.freeze(Object.fromEntries(Object.entries(inventory.suites)
  .map(([id, entry]) => [id, entry.timeoutMs])));
export function verifySmokeBudgetSources() {
  for (const [file, expected] of Object.entries(inventory.sourceHashes)) {
    const actual = createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex');
    if (actual !== expected) throw new Error(`Smoke budget source changed: ${file}; regenerate and review the bounded wait inventory`);
  }
}
