import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

// runner.temp is unavailable in a job-level env expression. Resolve the actual
// runner directory after setup-node so this also works in PowerShell jobs.
assert(process.env.GITHUB_ENV, 'This setup step requires a GitHub Actions job');
assert(path.isAbsolute(process.env.RUNNER_TEMP ?? ''), 'RUNNER_TEMP must be absolute');
// actions/cache includes the path in its cache version. A run-id in this
// path would prevent reuse across runs even when the explicit key matches.
// Hosted jobs already have separate runner filesystems; profiles stay private.
const root = path.join(process.env.RUNNER_TEMP, 'dsc-gate-tools');
const values = {
  PLAYWRIGHT_BROWSERS_PATH: path.join(root, 'playwright-browsers'),
  DEV_SESSION_CANVAS_VSCODE_TEST_CACHE_PATH: path.join(root, 'vscode-cache')
};
for (const value of Object.values(values)) assert(!/[\r\n]/u.test(value));
await fs.appendFile(process.env.GITHUB_ENV,
  Object.entries(values).map(([key, value]) => `${key}=${value}\n`).join(''));
