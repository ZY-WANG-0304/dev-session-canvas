import { describe, expect, it } from 'vitest';

import worker from './index';
import { createFakeD1Database } from './testD1Database';

describe('template marketplace worker entry', () => {
  it('keeps API requests on the Hono app with D1 bindings', async () => {
    const response = await worker.fetch(
      new Request('https://preview.example.test/api/v1/templates?q=d1'),
      { MARKETPLACE_DB: createFakeD1Database() },
      createExecutionContext()
    );
    const body = await response.json<{ storageMode: string; items: Array<{ slug: string }> }>();

    expect(response.status).toBe(200);
    expect(body.storageMode).toBe('d1');
    expect(body.items.map((item) => item.slug)).toEqual(['d1-review-loop']);
  });

  it('rewrites /templates asset URLs to the Vite asset directory', async () => {
    const seenPaths: string[] = [];
    const response = await worker.fetch(
      new Request('https://preview.example.test/templates/assets/index.js'),
      { ASSETS: createAssetFetcher(seenPaths) },
      createExecutionContext()
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('/assets/index.js');
    expect(seenPaths).toEqual(['/assets/index.js']);
  });

  it('lets the /templates page fall through to the static asset SPA', async () => {
    const seenPaths: string[] = [];
    const response = await worker.fetch(
      new Request('https://preview.example.test/templates'),
      { ASSETS: createAssetFetcher(seenPaths) },
      createExecutionContext()
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('/');
    expect(seenPaths).toEqual(['/']);
  });

  it('rewrites /templates detail URLs for the static asset SPA fallback', async () => {
    const seenPaths: string[] = [];
    const response = await worker.fetch(
      new Request('https://preview.example.test/templates/review-loop'),
      { ASSETS: createAssetFetcher(seenPaths) },
      createExecutionContext()
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('/review-loop');
    expect(seenPaths).toEqual(['/review-loop']);
  });
});

function createAssetFetcher(seenPaths: string[]): Fetcher {
  return {
    async fetch(request: Request) {
      const url = new URL(request.url);
      seenPaths.push(url.pathname);
      return new Response(url.pathname);
    }
  } as unknown as Fetcher;
}

function createExecutionContext(): ExecutionContext {
  return {
    waitUntil() {},
    passThroughOnException() {},
    props: {}
  } as unknown as ExecutionContext;
}
