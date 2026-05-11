import { spawnSync } from 'child_process';

import {
  assertSuccessfulResult,
  buildPlaywrightEnv,
  preparePlaywrightRuntime,
  projectRoot,
  runPlaywrightCli
} from './playwright-environment.mjs';

async function main() {
  const scriptArgs = process.argv.slice(2);
  if (scriptArgs.length === 0) {
    throw new Error('缺少要通过 Playwright runtime 执行的 Node 脚本路径。');
  }

  await preparePlaywrightRuntime();
  runPlaywrightCli(['install', 'chromium']);

  const result = spawnSync(process.execPath, scriptArgs, {
    cwd: projectRoot,
    stdio: 'inherit',
    env: buildPlaywrightEnv()
  });

  assertSuccessfulResult(result, `Node ${scriptArgs.join(' ')}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
