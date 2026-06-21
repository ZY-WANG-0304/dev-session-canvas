import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';

const runnerPath = 'scripts/smoke/run-template-marketplace-vscode-preview-e2e.mjs';

await withFixtureServer(
  (_request, response) => {
    writeJson(response, 500, { error: { code: 'fixture_failure' } });
  },
  async (sourceUrl) => {
    const result = await runPreviewRunner(sourceUrl);
    assert.notStrictEqual(result.status, 0, 'reachable HTTP 500 preflight must fail instead of skip');
    assert.match(result.output, /HTTP 500/u);
    assert.doesNotMatch(result.output, /Template marketplace VS Code preview E2E skipped/u);
  }
);

await withFixtureServer(
  (_request, response) => {
    response.writeHead(200, {
      'content-type': 'application/json'
    });
    response.end('{ not json');
  },
  async (sourceUrl) => {
    const result = await runPreviewRunner(sourceUrl);
    assert.notStrictEqual(result.status, 0, 'reachable invalid JSON preflight must fail instead of skip');
    assert.match(result.output, /invalid JSON response/u);
    assert.doesNotMatch(result.output, /Template marketplace VS Code preview E2E skipped/u);
  }
);

await withFixtureServer(
  (_request, response) => {
    writeJson(response, 200, { items: [], pagination: { page: 1, pageSize: 12, total: 0, hasMore: false } });
  },
  async (sourceUrl) => {
    const result = await runPreviewRunner(sourceUrl);
    assert.notStrictEqual(result.status, 0, 'reachable empty preview API preflight must fail instead of skip');
    assert.match(result.output, /preview API returned 0 templates/u);
    assert.doesNotMatch(result.output, /Template marketplace VS Code preview E2E skipped/u);
  }
);

const unreachableSourceUrl = `http://127.0.0.1:${await findClosedPort()}/templates`;
const defaultTransportResult = await runPreviewRunner(unreachableSourceUrl);
assert.strictEqual(defaultTransportResult.status, 0, 'transport preflight failure should skip by default');
assert.match(defaultTransportResult.output, /Template marketplace VS Code preview E2E skipped/u);

const strictTransportResult = await runPreviewRunner(unreachableSourceUrl, {
  MARKETPLACE_PREVIEW_E2E_REQUIRE_NETWORK: '1'
});
assert.notStrictEqual(strictTransportResult.status, 0, 'strict transport preflight failure must fail');
assert.match(strictTransportResult.output, /Strict preview network validation is enabled/u);

console.log('template marketplace preview preflight classification passed');

function runPreviewRunner(sourceUrl, envOverrides = {}) {
  const env = {
    ...process.env,
    DEV_SESSION_CANVAS_XVFB: '1',
    DEV_SESSION_CANVAS_TEMPLATE_MARKETPLACE_SOURCE_URL: '',
    DEV_SESSION_CANVAS_TEMPLATE_MARKETPLACE_PREVIEW_SOURCE_URL: sourceUrl,
    DEV_SESSION_CANVAS_TEMPLATE_MARKETPLACE_PREVIEW_REQUIRE_NETWORK: '',
    MARKETPLACE_PREVIEW_E2E_REQUIRE_NETWORK: '',
    ...envOverrides
  };
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [runnerPath], {
      cwd: process.cwd(),
      env,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    const chunks = [];
    child.stdout.on('data', (chunk) => chunks.push(chunk));
    child.stderr.on('data', (chunk) => chunks.push(chunk));
    child.on('error', reject);
    child.on('close', (status) => {
      resolve({
        status,
        output: Buffer.concat(chunks).toString('utf8')
      });
    });
  });
}

async function withFixtureServer(handler, run) {
  const server = http.createServer((request, response) => {
    if (request.url?.startsWith('/api/v1/templates')) {
      handler(request, response);
      return;
    }
    writeJson(response, 404, { error: { code: 'not_found' } });
  });
  const port = await listen(server);
  try {
    await run(`http://127.0.0.1:${port}/templates`);
  } finally {
    await close(server);
  }
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Unable to allocate fixture port.'));
        return;
      }
      resolve(address.port);
    });
  });
}

async function findClosedPort() {
  const server = http.createServer();
  const port = await listen(server);
  await close(server);
  return port;
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function writeJson(response, statusCode, body) {
  response.writeHead(statusCode, {
    'content-type': 'application/json'
  });
  response.end(JSON.stringify(body));
}
