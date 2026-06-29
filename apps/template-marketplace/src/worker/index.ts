import { createMarketplaceWorkerApp, type MarketplaceWorkerEnv } from './app';

const TEMPLATE_BASE_PATH = '/templates';

const app = createMarketplaceWorkerApp();

export default {
  async fetch(request: Request, env: MarketplaceWorkerEnv, executionContext: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      return app.fetch(request, env, executionContext);
    }
    if (env.ASSETS) {
      return env.ASSETS.fetch(rewriteTemplateAssetRequest(request, url));
    }
    return app.fetch(request, env, executionContext);
  }
};

function rewriteTemplateAssetRequest(request: Request, url: URL): Request {
  if (url.pathname === TEMPLATE_BASE_PATH || url.pathname.startsWith(`${TEMPLATE_BASE_PATH}/`)) {
    const rewrittenUrl = new URL(url);
    rewrittenUrl.pathname = url.pathname.slice(TEMPLATE_BASE_PATH.length) || '/';
    return new Request(rewrittenUrl, request);
  }
  return request;
}
