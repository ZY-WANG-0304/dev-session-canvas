import { preparePlaywrightRuntime, runPlaywrightCli } from '../shared/playwright-environment.mjs';

async function main() {
  await preparePlaywrightRuntime();
  runPlaywrightCli(['install', 'chromium']);
  runPlaywrightCli(['test', '--config=playwright.config.mjs', ...process.argv.slice(2)]);
  console.log('Playwright webview tests passed.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
