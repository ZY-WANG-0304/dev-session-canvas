import { spawnSync } from 'child_process';
import { existsSync } from 'fs';
import { promises as fs } from 'fs';
import path from 'path';

const projectRoot = process.cwd();
const browserCacheDir = path.join(projectRoot, '.playwright-browsers');
const runtimeRoot = path.join(projectRoot, '.debug', 'playwright');
const homeDir = path.join(runtimeRoot, 'home');
const configDir = path.join(runtimeRoot, 'config');
const cacheDir = path.join(runtimeRoot, 'cache');
const appDataDir = path.join(runtimeRoot, 'appdata');
const localAppDataDir = path.join(runtimeRoot, 'local-appdata');
const runtimeDir = path.join(runtimeRoot, 'runtime');
const tmpDir = path.join(runtimeRoot, 'tmp');
const playwrightCliScript = path.join(projectRoot, 'node_modules', 'playwright', 'cli.js');

async function main() {
  if (!existsSync(playwrightCliScript)) {
    throw new Error('缺少本地 Playwright CLI。请先安装 @playwright/test 依赖。');
  }

  await fs.mkdir(browserCacheDir, { recursive: true });
  await fs.mkdir(homeDir, { recursive: true });
  await fs.mkdir(configDir, { recursive: true });
  await fs.mkdir(cacheDir, { recursive: true });
  await fs.mkdir(appDataDir, { recursive: true });
  await fs.mkdir(localAppDataDir, { recursive: true });
  await fs.mkdir(path.join(cacheDir, 'mesa'), { recursive: true });
  await fs.mkdir(runtimeDir, { recursive: true, mode: 0o700 });
  await fs.mkdir(tmpDir, { recursive: true });

  runPlaywrightCli(['install', 'chromium']);
  runPlaywrightCli(['test', '--config=playwright.config.mjs', ...process.argv.slice(2)]);
  console.log('Playwright webview tests passed.');
}

function runPlaywrightCli(args) {
  const result = spawnSync(process.execPath, [playwrightCliScript, ...args], {
    cwd: projectRoot,
    stdio: 'inherit',
    env: {
      ...process.env,
      PLAYWRIGHT_BROWSERS_PATH: browserCacheDir,
      HOME: homeDir,
      USERPROFILE: homeDir,
      APPDATA: appDataDir,
      LOCALAPPDATA: localAppDataDir,
      XDG_CONFIG_HOME: configDir,
      XDG_CACHE_HOME: cacheDir,
      XDG_RUNTIME_DIR: runtimeDir,
      TMPDIR: tmpDir,
      TMP: tmpDir,
      TEMP: tmpDir,
      MESA_SHADER_CACHE_DIR: path.join(cacheDir, 'mesa')
    }
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    console.error(`Playwright failure artifacts are available under ${path.join(runtimeRoot, '..', 'playwright', 'results')}`);
    process.exit(result.status ?? 1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
