import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  launchPreparedVSCodeScenario,
  prepareMainSmokeHostExtension,
  prepareRuntime,
  resolveStagedSmokeTestPath,
  runInsideXvfb,
  shouldReRunInsideXvfb
} from './vscode-smoke-runner.mjs';

const DEFAULT_PREVIEW_MARKETPLACE_SOURCE_URL = 'https://dscanvas-template-marketplace.wzy0304.workers.dev/templates';
const projectRoot = process.cwd();
const currentScriptPath = fileURLToPath(import.meta.url);
const debugRoot = path.join(projectRoot, '.debug', 'template-marketplace-vscode-preview-e2e');
const hostTmpRoot = path.join(projectRoot, '.debug', 'template-marketplace-vscode-preview-e2e-host-tmp');
const smokeFixturesDir = path.join(projectRoot, 'tests', 'vscode-smoke', 'fixtures');
const fakeAgentProviderPath = path.join(smokeFixturesDir, 'fake-agent-provider');
const missingAgentProviderPath = path.join(smokeFixturesDir, 'missing-agent-provider');
const smokeFixturesPath = `${smokeFixturesDir}${path.delimiter}${process.env.PATH ?? ''}`;
const MARKETPLACE_PREFLIGHT_TIMEOUT_MS = 10000;

process.env.TMPDIR = hostTmpRoot;
process.env.TMP = process.env.TMPDIR;
process.env.TEMP = process.env.TMPDIR;
fs.mkdirSync(process.env.TMPDIR, { recursive: true });

async function main() {
  if (shouldReRunInsideXvfb()) {
    process.exit(runInsideXvfb(currentScriptPath, projectRoot));
  }

  const marketplaceSourceUrl = normalizeMarketplaceSourceUrl(
    process.env.DEV_SESSION_CANVAS_TEMPLATE_MARKETPLACE_SOURCE_URL ||
      process.env.DEV_SESSION_CANVAS_TEMPLATE_MARKETPLACE_PREVIEW_SOURCE_URL ||
      DEFAULT_PREVIEW_MARKETPLACE_SOURCE_URL
  );
  await warnIfMarketplaceSourcePreflightFails(marketplaceSourceUrl);

  const extensionTestsEnv = {
    DEV_SESSION_CANVAS_SMOKE_SCENARIO: 'template-marketplace-preview',
    DEV_SESSION_CANVAS_SMOKE_TEST_MODE: '1',
    DEV_SESSION_CANVAS_TEMPLATE_MARKETPLACE_SOURCE_URL: marketplaceSourceUrl,
    DEV_SESSION_CANVAS_TEST_CODEX_COMMAND: fakeAgentProviderPath,
    DEV_SESSION_CANVAS_TEST_CLAUDE_COMMAND: missingAgentProviderPath,
    PATH: smokeFixturesPath
  };

  const runtime = await prepareRuntime({
    projectRoot,
    debugRoot,
    runtimeDirName: 'dsc-template-marketplace-vscode-preview-e2e-runtime',
    extensionTestsEnv,
    userSettings: {
      'security.workspace.trust.enabled': false,
      'workbench.browser.openLocalhostLinks': false
    }
  });
  const smokeHostRoot = await prepareMainSmokeHostExtension({
    projectRoot,
    targetRoot: path.join(runtime.debugRoot, 'smoke-host')
  });

  await launchPreparedVSCodeScenario({
    projectRoot,
    runtime,
    workspacePath: projectRoot,
    extensionDevelopmentPath: smokeHostRoot,
    extensionTestsPath: resolveStagedSmokeTestPath(smokeHostRoot, 'template-marketplace-preview-tests.cjs'),
    disableExtensions: false,
    disableWorkspaceTrust: true,
    extensionTestsEnv
  });

  console.log(`Template marketplace VS Code preview E2E passed against ${marketplaceSourceUrl}.`);
}

function normalizeMarketplaceSourceUrl(value) {
  const url = new URL(value);
  if (url.pathname === '/' || url.pathname === '') {
    url.pathname = '/templates';
  }
  if (url.pathname !== '/templates') {
    throw new Error(`Preview marketplace source URL must point to /templates. Received: ${url.toString()}`);
  }
  url.search = '';
  url.hash = '';
  return url.toString();
}

async function warnIfMarketplaceSourcePreflightFails(marketplaceSourceUrl) {
  try {
    await preflightMarketplaceSource(marketplaceSourceUrl);
  } catch (error) {
    console.warn(formatPreflightWarning(error));
  }
}

async function preflightMarketplaceSource(marketplaceSourceUrl) {
  const source = new URL(marketplaceSourceUrl);
  const apiUrl = new URL('/api/v1/templates?sort=newest', source.origin);
  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), MARKETPLACE_PREFLIGHT_TIMEOUT_MS);
  try {
    const response = await fetch(apiUrl, {
      headers: { accept: 'application/json' },
      signal: abortController.signal
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const body = await response.json();
    const templates = Array.isArray(body?.items) ? body.items : [];
    if (templates.length === 0) {
      throw new Error('preview API returned 0 templates');
    }
  } catch (error) {
    throw new Error(
      `Preview marketplace API preflight failed for ${apiUrl.toString()}: ${formatPreflightError(error)}`
    );
  } finally {
    clearTimeout(timeout);
  }
}

function formatPreflightWarning(error) {
  const message = error instanceof Error ? error.message : String(error);
  return `Preview marketplace API preflight warning: ${message}. Continuing with the VS Code Webview E2E because Electron may use a different network path.`;
}

function formatPreflightError(error) {
  if (error && typeof error === 'object' && 'name' in error && error.name === 'AbortError') {
    return `timed out after ${MARKETPLACE_PREFLIGHT_TIMEOUT_MS}ms`;
  }
  if (error instanceof Error) {
    const cause = error.cause instanceof Error ? `: ${formatErrorDetail(error.cause)}` : '';
    return `${error.message}${cause}`;
  }
  return String(error);
}

function formatErrorDetail(error) {
  const parts = [
    readErrorField(error, 'code'),
    error.message,
    formatAggregateErrorReasons(error)
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(' ') : error.name;
}

function formatAggregateErrorReasons(error) {
  if (!(error instanceof AggregateError)) {
    return '';
  }
  return error.errors
    .map((entry) => entry instanceof Error ? formatErrorDetail(entry) : String(entry))
    .filter(Boolean)
    .join('; ');
}

function readErrorField(error, key) {
  if (!Object.prototype.hasOwnProperty.call(error, key)) {
    return '';
  }
  const value = error[key];
  return typeof value === 'string' && value.length > 0 ? value : '';
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
