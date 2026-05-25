import { spawnSync } from 'child_process';
import { existsSync } from 'fs';
import { promises as fs } from 'fs';
import path from 'path';

export const projectRoot = process.cwd();
export const browserCacheDir = path.join(projectRoot, '.playwright-browsers');
export const runtimeRoot = path.join(projectRoot, '.debug', 'playwright');
export const homeDir = path.join(runtimeRoot, 'home');
export const configDir = path.join(runtimeRoot, 'config');
export const cacheDir = path.join(runtimeRoot, 'cache');
export const appDataDir = path.join(runtimeRoot, 'appdata');
export const localAppDataDir = path.join(runtimeRoot, 'local-appdata');
export const runtimeDir = path.join(runtimeRoot, 'runtime');
export const tmpDir = path.join(runtimeRoot, 'tmp');
export const playwrightCliScript = path.join(projectRoot, 'node_modules', 'playwright', 'cli.js');

export async function preparePlaywrightRuntime() {
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
}

export function buildPlaywrightEnv() {
  return {
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
  };
}

export function runPlaywrightCli(args) {
  const result = spawnSync(process.execPath, [playwrightCliScript, ...args], {
    cwd: projectRoot,
    stdio: 'inherit',
    env: buildPlaywrightEnv()
  });

  assertSuccessfulResult(result, `Playwright ${args.join(' ')}`);
}

export function assertSuccessfulResult(result, label) {
  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    console.error(`Playwright failure artifacts are available under ${path.join(runtimeRoot, '..', 'playwright', 'results')}`);
    process.exit(result.status ?? 1);
  }

  if (result.signal) {
    throw new Error(`${label} terminated with signal ${result.signal}.`);
  }
}
