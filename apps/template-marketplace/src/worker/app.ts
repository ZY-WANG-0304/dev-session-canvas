import { Hono, type Context, type MiddlewareHandler } from 'hono';

import {
  makeMarketplaceApiError,
  MARKETPLACE_API_VERSION,
  MARKETPLACE_DEFAULT_MIN_SUPPORTED_EXTENSION_VERSION,
  MARKETPLACE_DEFAULT_RECOMMENDED_EXTENSION_VERSION,
  MARKETPLACE_REPORT_REASON_VALUES,
  MARKETPLACE_SERVICE_CAPABILITIES,
  MARKETPLACE_SLUG_PATTERN,
  MARKETPLACE_SORT_VALUES,
  MARKETPLACE_TEMPLATE_STATUS_VALUES,
  normalizeMarketplaceSlug,
  type MarketplaceAdminReportActionRequest,
  type MarketplaceAdminTemplateStatusRequest,
  type MarketplaceAdminUserBanRequest,
  type MarketplaceListTemplatesRequest,
  type MarketplaceMetaResponse,
  type MarketplaceReportReason,
  type MarketplaceServiceCapability,
  type MarketplaceTemplateDetail,
  type MarketplaceTemplateVersion
} from '@dev-session-canvas/marketplace-shared';

import {
  buildGithubOAuthStartResponse,
  buildMarketplaceLogoutResponse,
  exchangeVSCodeGithubToken,
  exchangeGithubOAuthCallback,
  getMarketplaceAuthentication,
  getMarketplaceAuthenticatedUser,
  getMarketplaceCsrfCookie,
  MARKETPLACE_CSRF_HEADER_NAME,
  type MarketplaceAuthenticatedUser,
  type MarketplaceAuthEnv
} from './auth';
import {
  buildR2TemplateDownloadResponse,
  buildR2TemplatePackageDownloadResponse,
  buildR2TemplatePackageFromJsonResponse,
  buildR2TemplateThumbnailResponse
} from './download';
import { MarketplaceRepositoryWriteError, buildMarketplaceUserId, createProductionTemplateRepository, createTemplateRepository } from './repository';
import {
  MarketplacePublishValidationError,
  prepareMarketplacePublishTemplate,
  prepareMarketplacePublishTemplatePackage,
  prepareMarketplacePublishTemplateVersion,
  resolveMarketplaceMaxPackageBytes,
  resolveMarketplaceMaxTemplateBytes,
  writeMarketplaceTemplateObjects
} from './publish';

const PUBLIC_READ_CORS_ROUTES = [
  '/api/v1/health',
  '/api/v1/meta',
  '/api/v1/templates',
  '/api/v1/templates/slug-availability',
  '/api/v1/templates/:id',
  '/api/v1/templates/:id/download',
  '/api/v1/templates/:id/package',
  '/api/v1/templates/:id/template.json',
  '/api/v1/templates/:id/thumbnail'
] as const;

export interface MarketplaceWorkerEnv extends MarketplaceAuthEnv {
  ASSETS?: Fetcher;
  MARKETPLACE_DB?: D1Database;
  TEMPLATE_BUCKET?: R2Bucket;
  VERSION_METADATA?: WorkerVersionMetadata;
  MARKETPLACE_SERVICE_BUILD?: string;
  MARKETPLACE_GIT_SHA?: string;
  MARKETPLACE_MIN_SUPPORTED_EXTENSION_VERSION?: string;
  MARKETPLACE_RECOMMENDED_EXTENSION_VERSION?: string;
  MARKETPLACE_MAX_TEMPLATE_BYTES?: string;
  MARKETPLACE_MAX_PACKAGE_BYTES?: string;
  MARKETPLACE_ADMIN_GITHUB_IDS?: string;
  MARKETPLACE_ADMIN_GITHUB_LOGINS?: string;
  MARKETPLACE_ALLOWED_WRITE_ORIGINS?: string;
  MARKETPLACE_ENABLE_SEED_TEMPLATES?: string;
}

const PUBLIC_READ_CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, OPTIONS',
  'access-control-allow-headers': 'accept, content-type',
  'access-control-expose-headers': [
    'content-disposition',
    'x-marketplace-storage-mode',
    'x-marketplace-catalog-storage-mode',
    'x-marketplace-template-id',
    'x-marketplace-version-id',
    'x-marketplace-sha256'
  ].join(', '),
  'access-control-max-age': '600'
} as const;

function createPublicReadCorsMiddleware(): MiddlewareHandler<{ Bindings: MarketplaceWorkerEnv }> {
  return async (context, next) => {
    const method = context.req.method.toUpperCase();
    if (method === 'OPTIONS') {
      const requestedMethod = context.req.header('access-control-request-method')?.toUpperCase();
      if (requestedMethod && requestedMethod !== 'GET') {
        await next();
        return;
      }
      return new Response(null, {
        status: 204,
        headers: PUBLIC_READ_CORS_HEADERS
      });
    }

    await next();
    if (method === 'GET' || method === 'HEAD') {
      for (const [name, value] of Object.entries(PUBLIC_READ_CORS_HEADERS)) {
        context.res.headers.set(name, value);
      }
    }
  };
}

export function createMarketplaceWorkerApp(): Hono<{ Bindings: MarketplaceWorkerEnv }> {
  const app = new Hono<{ Bindings: MarketplaceWorkerEnv }>();

  const publicReadCors = createPublicReadCorsMiddleware();

  for (const route of PUBLIC_READ_CORS_ROUTES) {
    app.use(route, publicReadCors);
  }

  app.get('/api/v1/health', (context) =>
    context.json({
      ok: true,
      service: 'template-marketplace',
      storageMode: createMarketplaceRepository(context.env).storageMode
    })
  );

  app.get('/api/v1/meta', (context) => context.json(buildMarketplaceMetaResponse(context.env)));

  app.get('/api/v1/auth/github/start', (context) => buildGithubOAuthStartResponse(context.req.raw, context.env));

  app.post('/api/v1/auth/logout', (context) => {
    const guardResponse = validateLogoutCsrfRequest(context.req.raw);
    return guardResponse ?? buildMarketplaceLogoutResponse(context.req.raw);
  });

  app.get('/api/v1/auth/github/callback', async (context) => {
    const result = await exchangeGithubOAuthCallback(context.req.raw, context.env);
    if (result instanceof Response) {
      return result;
    }
    const repository = createMarketplaceRepository(context.env);
    try {
      await repository.upsertUser(result.user, new Date().toISOString(), parseAdminBootstrapAllowlist(context.env));
    } catch {
      // Session creation already verified GitHub identity; persistence failures surface in write APIs.
    }
    return new Response(null, {
      status: 302,
      headers: [
        ['location', result.redirectTo],
        ['set-cookie', result.sessionCookie],
        ['set-cookie', result.csrfCookie],
        ['set-cookie', result.clearStateCookie]
      ]
    });
  });

  app.get('/api/v1/auth/me', async (context) => {
    const user = await getMarketplaceAuthenticatedUser(context.req.raw, context.env);
    if (!user) {
      return context.json(makeMarketplaceApiError('auth_required', 'Authentication is required.'), 401);
    }
    return context.json({ user });
  });

  app.get('/api/v1/me/templates', async (context) => {
    const user = await getMarketplaceAuthenticatedUser(context.req.raw, context.env);
    if (!user) {
      return context.json(makeMarketplaceApiError('auth_required', 'Authentication is required.'), 401);
    }
    const repository = createMarketplaceRepository(context.env);
    return context.json(await repository.listTemplatesByPublisher(user));
  });

  app.get('/api/v1/me/likes', async (context) => {
    const user = await getMarketplaceAuthenticatedUser(context.req.raw, context.env);
    if (!user) {
      return context.json(makeMarketplaceApiError('auth_required', 'Authentication is required.'), 401);
    }
    const repository = createMarketplaceRepository(context.env);
    return context.json(await repository.listLikedTemplates(user));
  });

  app.get('/api/v1/me/stats', async (context) => {
    const user = await getMarketplaceAuthenticatedUser(context.req.raw, context.env);
    if (!user) {
      return context.json(makeMarketplaceApiError('auth_required', 'Authentication is required.'), 401);
    }
    const repository = createMarketplaceRepository(context.env);
    return context.json(await repository.getPublisherStats(user));
  });

  app.get('/api/v1/templates/:id/like', async (context) => {
    const user = await getMarketplaceAuthenticatedUser(context.req.raw, context.env);
    if (!user) {
      return context.json(makeMarketplaceApiError('auth_required', 'Authentication is required to read template like state.'), 401);
    }

    const repository = createMarketplaceRepository(context.env);
    const result = await repository.getTemplateLikeState(context.req.param('id'), user);
    if (!result) {
      return context.json(makeMarketplaceApiError('template_not_found', 'Template was not found.'), 404);
    }
    return context.json(result);
  });

  app.post('/api/v1/auth/vscode/exchange', async (context) => {
    const result = await exchangeVSCodeGithubToken(context.req.raw, context.env);
    if (result instanceof Response) {
      return result;
    }
    const repository = createMarketplaceRepository(context.env);
    try {
      await repository.upsertUser(result.user, new Date().toISOString(), parseAdminBootstrapAllowlist(context.env));
    } catch {
      // The token remains valid for write attempts; persistence failures surface in write APIs.
    }
    return context.json(result);
  });

  app.get('/api/v1/templates', async (context) => {
    const query = parseListTemplatesQuery(new URL(context.req.url));
    const repository = createMarketplaceRepository(context.env);
    return context.json(await repository.listTemplates(query));
  });

  app.get('/api/v1/templates/slug-availability', async (context) => {
    const slug = normalizeMarketplaceSlug(context.req.query('slug') ?? '');
    if (!slug || !MARKETPLACE_SLUG_PATTERN.test(slug)) {
      return context.json(makeMarketplaceApiError('template_slug_invalid', 'Slug must use lowercase words separated by hyphens.'), 400);
    }
    const repository = createMarketplaceRepository(context.env);
    return context.json({
      slug,
      available: await repository.isTemplateSlugAvailable(slug),
      storageMode: repository.storageMode
    });
  });

  app.get('/api/v1/templates/:id', async (context) => {
    const repository = createMarketplaceRepository(context.env);
    const detail = await repository.getTemplateDetail(context.req.param('id'));
    if (!detail) {
      return context.json(makeMarketplaceApiError('template_not_found', 'Template was not found.'), 404);
    }
    return context.json(detail);
  });

  app.post('/api/v1/templates/:id/like', async (context) => {
    const auth = await requireMarketplaceWriteUser(context, 'Authentication is required to like templates.');
    if (auth.response) {
      return auth.response;
    }
    if (!context.env?.MARKETPLACE_DB) {
      return context.json(makeMarketplaceApiError('marketplace_writes_unavailable', 'Template likes require D1 storage.'), 503);
    }
    const repository = createMarketplaceRepository(context.env);
    if (await repository.isUserBanned(auth.user)) {
      return context.json(makeMarketplaceApiError('user_banned', 'Banned users cannot like templates.'), 403);
    }

    const requestedLike = await readOptionalLikeTarget(context.req.raw);
    if (requestedLike.response) {
      return requestedLike.response;
    }

    try {
      const result = await repository.setTemplateLike(context.req.param('id'), auth.user, requestedLike.liked);
      if (!result) {
        return context.json(makeMarketplaceApiError('template_not_found', 'Template was not found.'), 404);
      }
      return context.json(result);
    } catch (error) {
      if (error instanceof MarketplaceRepositoryWriteError) {
        return context.json(makeMarketplaceApiError(error.code, error.message), error.status as 400 | 401 | 409 | 413 | 503);
      }
      throw error;
    }
  });

  app.post('/api/v1/templates/:id/report', async (context) => {
    const auth = await requireMarketplaceWriteUser(context, 'Authentication is required to report templates.');
    if (auth.response) {
      return auth.response;
    }
    if (!context.env?.MARKETPLACE_DB) {
      return context.json(makeMarketplaceApiError('marketplace_writes_unavailable', 'Template reports require D1 storage.'), 503);
    }

    const repository = createMarketplaceRepository(context.env);
    if (await repository.isUserBanned(auth.user)) {
      return context.json(makeMarketplaceApiError('user_banned', 'Banned users cannot report templates.'), 403);
    }

    const reportRequest = await readTemplateReportRequest(context.req.raw);
    if (reportRequest.response) {
      return reportRequest.response;
    }

    try {
      const result = await repository.createTemplateReport(context.req.param('id'), auth.user, reportRequest.reason);
      if (!result) {
        return context.json(makeMarketplaceApiError('template_not_found', 'Template was not found.'), 404);
      }
      return context.json(result, 201);
    } catch (error) {
      if (error instanceof MarketplaceRepositoryWriteError) {
        return context.json(makeMarketplaceApiError(error.code, error.message), error.status as 400 | 401 | 403 | 409 | 413 | 503);
      }
      throw error;
    }
  });

  app.get('/api/v1/templates/:id/download', async (context) => handleTemplatePackageDownload(context));

  app.get('/api/v1/templates/:id/package', async (context) => handleTemplatePackageDownload(context));

  app.get('/api/v1/templates/:id/template.json', async (context) => {
    const repository = createMarketplaceRepository(context.env);
    const response = await repository.buildDownloadResponse(context.req.param('id'), context.req.query('version'));
    if (!response) {
      return context.json(makeMarketplaceApiError('template_or_version_not_found', 'Template version was not found.'), 404);
    }
    if (context.env?.TEMPLATE_BUCKET) {
      const objectResponse = await buildR2TemplateDownloadResponse(context.env.TEMPLATE_BUCKET, response);
      if (!objectResponse) {
        return context.json(makeMarketplaceApiError('template_object_not_found', 'Template object was not found in R2.'), 404);
      }
      await repository.recordDownload(response.templateId, response.versionId);
      return objectResponse;
    }
    return context.json(response);
  });

  app.get('/api/v1/templates/:id/thumbnail', async (context) => {
    const repository = createMarketplaceRepository(context.env);
    const detail = await repository.getTemplateDetail(context.req.param('id'));
    if (!detail) {
      return context.json(makeMarketplaceApiError('template_not_found', 'Template was not found.'), 404);
    }

    const version = selectTemplateVersion(detail.template, context.req.query('version'));
    if (!version) {
      return context.json(makeMarketplaceApiError('template_version_not_found', 'Template version was not found.'), 404);
    }

    if (context.env?.TEMPLATE_BUCKET) {
      const objectResponse = await buildR2TemplateThumbnailResponse(context.env.TEMPLATE_BUCKET, version.thumbnailKey);
      if (!objectResponse) {
        return context.json(makeMarketplaceApiError('thumbnail_object_not_found', 'Template thumbnail was not found in R2.'), 404);
      }
      return objectResponse;
    }

    return buildSeedTemplateThumbnailResponse(detail.template, version);
  });

  app.post('/api/v1/templates', async (context) => {
    const auth = await requireMarketplaceWriteUser(context, 'Authentication is required to publish templates.');
    if (auth.response) {
      return auth.response;
    }
    if (!context.env?.MARKETPLACE_DB || !context.env?.TEMPLATE_BUCKET) {
      return context.json(makeMarketplaceApiError('marketplace_writes_unavailable', 'Template publishing requires D1 and R2 bindings.'), 503);
    }

    const repository = createMarketplaceRepository(context.env);
    if (await repository.isUserBanned(auth.user)) {
      return context.json(makeMarketplaceApiError('user_banned', 'Banned users cannot publish templates.'), 403);
    }

    let body: unknown;
    try {
      body = await context.req.json();
    } catch {
      return context.json(makeMarketplaceApiError('publish_request_invalid', 'Publish request must be valid JSON.'), 400);
    }

    try {
      const prepared = await prepareMarketplacePublishTemplate(body, auth.user, {
        maxTemplateBytes: resolveMarketplaceMaxTemplateBytes(context.env.MARKETPLACE_MAX_TEMPLATE_BYTES)
      });
      if (!(await repository.isTemplateSlugAvailable(prepared.record.slug))) {
        return context.json(makeMarketplaceApiError('template_slug_conflict', 'A template with this slug already exists.'), 409);
      }
      await writeMarketplaceTemplateObjects(context.env.TEMPLATE_BUCKET, prepared);
      const result = await repository.publishTemplate(prepared.record, parseAdminBootstrapAllowlist(context.env));
      return context.json(result, 201);
    } catch (error) {
      if (error instanceof MarketplacePublishValidationError || error instanceof MarketplaceRepositoryWriteError) {
        return context.json(makeMarketplaceApiError(error.code, error.message), error.status as 400 | 401 | 409 | 413 | 503);
      }
      throw error;
    }
  });

  app.post('/api/v1/templates/package', async (context) => {
    const auth = await requireMarketplaceWriteUser(context, 'Authentication is required to publish templates.');
    if (auth.response) {
      return auth.response;
    }
    if (!context.env?.MARKETPLACE_DB || !context.env?.TEMPLATE_BUCKET) {
      return context.json(makeMarketplaceApiError('marketplace_writes_unavailable', 'Template publishing requires D1 and R2 bindings.'), 503);
    }

    const repository = createMarketplaceRepository(context.env);
    if (await repository.isUserBanned(auth.user)) {
      return context.json(makeMarketplaceApiError('user_banned', 'Banned users cannot publish templates.'), 403);
    }

    const packageUpload = await readPackageZipUpload(context.req.raw);
    if (packageUpload.response) {
      return packageUpload.response;
    }

    try {
      const prepared = await prepareMarketplacePublishTemplatePackage(packageUpload.bytes, auth.user, {
        maxTemplateBytes: resolveMarketplaceMaxTemplateBytes(context.env.MARKETPLACE_MAX_TEMPLATE_BYTES),
        maxPackageBytes: resolveMarketplaceMaxPackageBytes(context.env.MARKETPLACE_MAX_PACKAGE_BYTES)
      });
      if (!(await repository.isTemplateSlugAvailable(prepared.record.slug))) {
        return context.json(makeMarketplaceApiError('template_slug_conflict', 'A template with this slug already exists.'), 409);
      }
      await writeMarketplaceTemplateObjects(context.env.TEMPLATE_BUCKET, prepared);
      const result = await repository.publishTemplate(prepared.record, parseAdminBootstrapAllowlist(context.env));
      return context.json(result, 201);
    } catch (error) {
      if (error instanceof MarketplacePublishValidationError || error instanceof MarketplaceRepositoryWriteError) {
        return context.json(makeMarketplaceApiError(error.code, error.message), error.status as 400 | 401 | 409 | 413 | 503);
      }
      throw error;
    }
  });

  app.post('/api/v1/templates/:id/versions', async (context) => {
    const auth = await requireMarketplaceWriteUser(context, 'Authentication is required to publish template versions.');
    if (auth.response) {
      return auth.response;
    }
    if (!context.env?.MARKETPLACE_DB || !context.env?.TEMPLATE_BUCKET) {
      return context.json(makeMarketplaceApiError('marketplace_writes_unavailable', 'Template publishing requires D1 and R2 bindings.'), 503);
    }

    const repository = createMarketplaceRepository(context.env);
    if (await repository.isUserBanned(auth.user)) {
      return context.json(makeMarketplaceApiError('user_banned', 'Banned users cannot publish template versions.'), 403);
    }
    const detail = await repository.getTemplateDetail(context.req.param('id'));
    if (!detail) {
      return context.json(makeMarketplaceApiError('template_not_found', 'Template was not found.'), 404);
    }
    if (detail.template.publisher.id !== buildMarketplaceUserId(auth.user.githubUserId)) {
      return context.json(makeMarketplaceApiError('template_author_required', 'Only the template publisher can publish new versions.'), 403);
    }

    let body: unknown;
    try {
      body = await context.req.json();
    } catch {
      return context.json(makeMarketplaceApiError('publish_request_invalid', 'Publish request must be valid JSON.'), 400);
    }

    try {
      const nextVersionNumber = Math.max(...detail.template.versions.map((version) => version.versionNumber), 0) + 1;
      const prepared = await prepareMarketplacePublishTemplateVersion(body, detail.template, nextVersionNumber, {
        maxTemplateBytes: resolveMarketplaceMaxTemplateBytes(context.env.MARKETPLACE_MAX_TEMPLATE_BYTES)
      });
      await writeMarketplaceTemplateObjects(context.env.TEMPLATE_BUCKET, prepared);
      const result = await repository.publishTemplateVersion(detail.template, prepared.record);
      return context.json(result, 201);
    } catch (error) {
      if (error instanceof MarketplacePublishValidationError || error instanceof MarketplaceRepositoryWriteError) {
        return context.json(makeMarketplaceApiError(error.code, error.message), error.status as 400 | 401 | 409 | 413 | 503);
      }
      throw error;
    }
  });

  app.get('/api/v1/admin/reports', async (context) => {
    const admin = await requireMarketplaceAdmin(context);
    if (admin.response) {
      return admin.response;
    }
    const status = readOptionalReportStatus(context.req.query('status'));
    if (status.response) {
      return status.response;
    }
    return context.json(await admin.repository.listAdminReports(status.status));
  });

  app.get('/api/v1/admin/stats', async (context) => {
    const admin = await requireMarketplaceAdmin(context);
    if (admin.response) {
      return admin.response;
    }
    return context.json(await admin.repository.getAdminStats());
  });

  app.patch('/api/v1/admin/reports/:id', async (context) => {
    const admin = await requireMarketplaceAdmin(context, { write: true });
    if (admin.response) {
      return admin.response;
    }
    const action = await readAdminReportActionRequest(context.req.raw);
    if (action.response) {
      return action.response;
    }
    const result = await admin.repository.resolveAdminReport(context.req.param('id'), admin.user, action.request);
    if (!result) {
      return context.json(makeMarketplaceApiError('report_not_found', 'Report was not found.'), 404);
    }
    return context.json(result);
  });

  app.patch('/api/v1/admin/templates/:id', async (context) => {
    const admin = await requireMarketplaceAdmin(context, { write: true });
    if (admin.response) {
      return admin.response;
    }
    const request = await readAdminTemplateStatusRequest(context.req.raw);
    if (request.response) {
      return request.response;
    }
    const result = await admin.repository.setAdminTemplateStatus(context.req.param('id'), admin.user, request.request);
    if (!result) {
      return context.json(makeMarketplaceApiError('template_not_found', 'Template was not found.'), 404);
    }
    return context.json(result);
  });

  app.patch('/api/v1/admin/users/:id', async (context) => {
    const admin = await requireMarketplaceAdmin(context, { write: true });
    if (admin.response) {
      return admin.response;
    }
    const request = await readAdminUserBanRequest(context.req.raw);
    if (request.response) {
      return request.response;
    }
    const result = await admin.repository.setAdminUserBan(context.req.param('id'), admin.user, request.request);
    if (!result) {
      return context.json(makeMarketplaceApiError('user_not_found', 'User was not found.'), 404);
    }
    return context.json(result);
  });

  app.notFound((context) => context.json(makeMarketplaceApiError('not_found', 'Route was not found.'), 404));

  return app;
}

async function requireMarketplaceWriteUser(
  context: Context<{ Bindings: MarketplaceWorkerEnv }>,
  authRequiredMessage: string
): Promise<{ user: MarketplaceAuthenticatedUser; response?: never } | { user?: never; response: Response }> {
  const auth = await getMarketplaceAuthentication(context.req.raw, context.env);
  if (!auth) {
    return { response: context.json(makeMarketplaceApiError('auth_required', authRequiredMessage), 401) };
  }
  if (auth.source !== 'cookie') {
    return { user: auth.user };
  }

  const guardResponse = validateCookieWriteRequest(context.req.raw, context.env, auth.csrfToken);
  if (guardResponse) {
    return { response: guardResponse };
  }
  return { user: auth.user };
}

function validateCookieWriteRequest(request: Request, env: MarketplaceWorkerEnv | undefined, sessionCsrfToken: string | undefined): Response | undefined {
  const origin = request.headers.get('origin')?.trim();
  const originMode = origin ? resolveCookieWriteOrigin(origin, request, env) : undefined;
  if (!originMode) {
    return Response.json(makeMarketplaceApiError('write_origin_forbidden', 'Cookie-authenticated write requests must come from an allowed marketplace origin.'), {
      status: 403
    });
  }

  const secFetchSite = request.headers.get('sec-fetch-site')?.trim().toLowerCase();
  if (secFetchSite === 'cross-site' && originMode !== 'allowlist') {
    return Response.json(makeMarketplaceApiError('write_origin_forbidden', 'Cross-site cookie-authenticated write requests are not allowed.'), {
      status: 403
    });
  }

  const headerCsrfToken = request.headers.get(MARKETPLACE_CSRF_HEADER_NAME)?.trim();
  const cookieCsrfToken = getMarketplaceCsrfCookie(request);
  if (!sessionCsrfToken || !headerCsrfToken || !cookieCsrfToken || headerCsrfToken !== sessionCsrfToken || cookieCsrfToken !== sessionCsrfToken) {
    return Response.json(makeMarketplaceApiError('write_csrf_required', 'Cookie-authenticated write requests require a valid CSRF token.'), {
      status: 403
    });
  }

  return undefined;
}

function validateLogoutCsrfRequest(request: Request): Response | undefined {
  const cookieCsrfToken = getMarketplaceCsrfCookie(request);
  if (!cookieCsrfToken) {
    return undefined;
  }
  const urlCsrfToken = new URL(request.url).searchParams.get('csrf')?.trim();
  const headerCsrfToken = request.headers.get(MARKETPLACE_CSRF_HEADER_NAME)?.trim();
  if (urlCsrfToken === cookieCsrfToken || headerCsrfToken === cookieCsrfToken) {
    return undefined;
  }
  return Response.json(makeMarketplaceApiError('write_csrf_required', 'Sign out requires a valid CSRF token.'), { status: 403 });
}

function resolveCookieWriteOrigin(origin: string, request: Request, env: MarketplaceWorkerEnv | undefined): 'same-origin' | 'loopback' | 'allowlist' | undefined {
  const normalizedOrigin = normalizeOrigin(origin);
  if (!normalizedOrigin) {
    return undefined;
  }

  const requestOrigin = normalizeOrigin(new URL(request.url).origin);
  if (normalizedOrigin === requestOrigin) {
    return 'same-origin';
  }

  if (requestOrigin && isLoopbackOrigin(normalizedOrigin) && isLoopbackOrigin(requestOrigin)) {
    return 'loopback';
  }

  return parseCsvEnv(env?.MARKETPLACE_ALLOWED_WRITE_ORIGINS).some((allowedOrigin) => normalizeOrigin(allowedOrigin) === normalizedOrigin)
    ? 'allowlist'
    : undefined;
}

function normalizeOrigin(origin: string): string | undefined {
  try {
    const url = new URL(origin);
    return url.origin;
  } catch {
    return undefined;
  }
}

function isLoopbackOrigin(origin: string): boolean {
  const hostname = new URL(origin).hostname;
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}

async function requireMarketplaceAdmin(context: Context<{ Bindings: MarketplaceWorkerEnv }>, options: { write?: boolean } = {}) {
  const auth = options.write
    ? await requireMarketplaceWriteUser(context, 'Authentication is required for marketplace admin.')
    : { user: await getMarketplaceAuthenticatedUser(context.req.raw, context.env) };
  if ('response' in auth && auth.response) {
    return { response: auth.response };
  }
  const user = auth.user;
  if (!user) {
    return { response: context.json(makeMarketplaceApiError('auth_required', 'Authentication is required for marketplace admin.'), 401) };
  }
  if (!context.env?.MARKETPLACE_DB) {
    return { response: context.json(makeMarketplaceApiError('marketplace_writes_unavailable', 'Marketplace admin requires D1 storage.'), 503) };
  }
  const repository = createMarketplaceRepository(context.env);
  const isAdmin = await repository.isAdminUser(user, parseAdminBootstrapAllowlist(context.env));
  if (!isAdmin) {
    return { response: context.json(makeMarketplaceApiError('admin_required', 'Marketplace admin permission is required.'), 403) };
  }
  return { user, repository };
}

async function readOptionalLikeTarget(request: Request): Promise<{ liked?: boolean; response?: never } | { liked?: never; response: Response }> {
  const contentType = request.headers.get('content-type') ?? '';
  const hasBody = contentType.toLowerCase().includes('application/json');
  if (!hasBody) {
    return {};
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return {
      response: Response.json(makeMarketplaceApiError('like_request_invalid', 'Like request must be valid JSON.'), { status: 400 })
    };
  }
  if (body === null || (typeof body === 'object' && !Array.isArray(body) && !('liked' in body))) {
    return {};
  }
  if (!body || typeof body !== 'object' || Array.isArray(body) || typeof (body as { liked?: unknown }).liked !== 'boolean') {
    return {
      response: Response.json(makeMarketplaceApiError('like_request_invalid', 'Like request liked field must be a boolean.'), { status: 400 })
    };
  }
  return { liked: (body as { liked: boolean }).liked };
}

async function readTemplateReportRequest(request: Request): Promise<{ reason: MarketplaceReportReason; response?: never } | { reason?: never; response: Response }> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return {
      response: Response.json(makeMarketplaceApiError('report_request_invalid', 'Report request must be valid JSON.'), { status: 400 })
    };
  }
  const reason = body && typeof body === 'object' && !Array.isArray(body) ? (body as { reason?: unknown }).reason : undefined;
  if (typeof reason !== 'string' || !MARKETPLACE_REPORT_REASON_VALUES.includes(reason as MarketplaceReportReason)) {
    return {
      response: Response.json(makeMarketplaceApiError('report_reason_invalid', 'Report reason is invalid.'), { status: 400 })
    };
  }
  return { reason: reason as MarketplaceReportReason };
}

function readOptionalReportStatus(value: string | undefined): { status?: 'open' | 'resolved' | 'rejected'; response?: never } | { status?: never; response: Response } {
  if (!value) {
    return {};
  }
  if (value === 'open' || value === 'resolved' || value === 'rejected') {
    return { status: value };
  }
  return {
    response: Response.json(makeMarketplaceApiError('report_status_invalid', 'Report status filter is invalid.'), { status: 400 })
  };
}

async function readAdminReportActionRequest(
  request: Request
): Promise<{ request: MarketplaceAdminReportActionRequest; response?: never } | { request?: never; response: Response }> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return {
      response: Response.json(makeMarketplaceApiError('admin_report_action_invalid', 'Report action request must be valid JSON.'), { status: 400 })
    };
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return {
      response: Response.json(makeMarketplaceApiError('admin_report_action_invalid', 'Report action request must be an object.'), { status: 400 })
    };
  }
  const candidate = body as { status?: unknown; resolution?: unknown; delistTemplate?: unknown };
  if (candidate.status !== 'resolved' && candidate.status !== 'rejected') {
    return {
      response: Response.json(makeMarketplaceApiError('admin_report_status_invalid', 'Report action status must be resolved or rejected.'), { status: 400 })
    };
  }
  if (candidate.resolution !== undefined && typeof candidate.resolution !== 'string') {
    return {
      response: Response.json(makeMarketplaceApiError('admin_report_resolution_invalid', 'Report resolution must be a string.'), { status: 400 })
    };
  }
  if (candidate.delistTemplate !== undefined && typeof candidate.delistTemplate !== 'boolean') {
    return {
      response: Response.json(makeMarketplaceApiError('admin_report_delist_invalid', 'Report delistTemplate must be a boolean.'), { status: 400 })
    };
  }
  return {
    request: {
      status: candidate.status,
      resolution: candidate.resolution,
      delistTemplate: candidate.delistTemplate
    }
  };
}

async function readAdminTemplateStatusRequest(
  request: Request
): Promise<{ request: MarketplaceAdminTemplateStatusRequest; response?: never } | { request?: never; response: Response }> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return {
      response: Response.json(makeMarketplaceApiError('admin_template_status_invalid', 'Template status request must be valid JSON.'), { status: 400 })
    };
  }
  const status = body && typeof body === 'object' && !Array.isArray(body) ? (body as { status?: unknown }).status : undefined;
  if (typeof status !== 'string' || !MARKETPLACE_TEMPLATE_STATUS_VALUES.includes(status as MarketplaceAdminTemplateStatusRequest['status'])) {
    return {
      response: Response.json(makeMarketplaceApiError('admin_template_status_invalid', 'Template status is invalid.'), { status: 400 })
    };
  }
  return { request: { status: status as MarketplaceAdminTemplateStatusRequest['status'] } };
}

async function readAdminUserBanRequest(
  request: Request
): Promise<{ request: MarketplaceAdminUserBanRequest; response?: never } | { request?: never; response: Response }> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return {
      response: Response.json(makeMarketplaceApiError('admin_user_ban_invalid', 'User ban request must be valid JSON.'), { status: 400 })
    };
  }
  const banned = body && typeof body === 'object' && !Array.isArray(body) ? (body as { banned?: unknown }).banned : undefined;
  if (typeof banned !== 'boolean') {
    return {
      response: Response.json(makeMarketplaceApiError('admin_user_ban_invalid', 'User ban request banned field must be a boolean.'), { status: 400 })
    };
  }
  return { request: { banned } };
}

function selectTemplateVersion(template: MarketplaceTemplateDetail, versionId?: string): MarketplaceTemplateVersion | undefined {
  if (!versionId) {
    return template.latestVersion;
  }
  return template.versions.find((version) => version.id === versionId);
}

function buildSeedTemplateThumbnailResponse(template: MarketplaceTemplateDetail, version: MarketplaceTemplateVersion): Response {
  const escapedName = escapeSvgText(template.name);
  const escapedVersion = escapeSvgText(`v${version.versionNumber}`);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360" role="img" aria-label="${escapedName} thumbnail">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#365346"/>
      <stop offset="1" stop-color="#d8bf96"/>
    </linearGradient>
    <radialGradient id="glow" cx="24%" cy="18%" r="58%">
      <stop offset="0" stop-color="#fff4d8" stop-opacity="0.8"/>
      <stop offset="1" stop-color="#fff4d8" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="640" height="360" fill="url(#bg)"/>
  <rect width="640" height="360" fill="url(#glow)"/>
  <g fill="#fff8e8" fill-opacity="0.92" stroke="#fff" stroke-opacity="0.62" stroke-width="4">
    <rect x="82" y="62" width="190" height="78" rx="24"/>
    <rect x="82" y="178" width="190" height="98" rx="24"/>
    <rect x="330" y="178" width="190" height="98" rx="24"/>
  </g>
  <path d="M178 140v87h152" fill="none" stroke="#fff8e8" stroke-opacity="0.56" stroke-width="8" stroke-linecap="round"/>
  <text x="82" y="314" fill="#fff" font-family="ui-sans-serif, system-ui, sans-serif" font-size="34" font-weight="700">${escapedName}</text>
  <text x="558" y="70" fill="#fff" fill-opacity="0.78" text-anchor="end" font-family="ui-sans-serif, system-ui, sans-serif" font-size="18" font-weight="700">${escapedVersion}</text>
</svg>`;
  return new Response(svg, {
    headers: {
      'content-type': 'image/svg+xml; charset=utf-8',
      'cache-control': 'public, max-age=300',
      'x-marketplace-storage-mode': 'seed'
    }
  });
}

function escapeSvgText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}


async function handleTemplatePackageDownload(context: Context<{ Bindings: MarketplaceWorkerEnv }>): Promise<Response> {
  const repository = createMarketplaceRepository(context.env);
  const templateIdOrSlug = context.req.param('id') ?? '';
  const versionId = context.req.query('version');
  const response = await repository.buildPackageDownloadResponse(templateIdOrSlug, versionId);
  if (!response) {
    return context.json(makeMarketplaceApiError('template_or_version_not_found', 'Template version was not found.'), 404);
  }
  if (context.env?.TEMPLATE_BUCKET) {
    const objectResponse = await buildR2TemplatePackageDownloadResponse(context.env.TEMPLATE_BUCKET, response);
    if (objectResponse) {
      await repository.recordDownload(response.templateId, response.versionId);
      return objectResponse;
    }
    const detail = await repository.getTemplateDetail(templateIdOrSlug);
    const version = detail ? selectTemplateVersion(detail.template, versionId) : undefined;
    const generatedResponse =
      detail && version ? await buildR2TemplatePackageFromJsonResponse(context.env.TEMPLATE_BUCKET, response, detail.template, version) : undefined;
    if (generatedResponse) {
      await repository.recordDownload(response.templateId, response.versionId);
      return generatedResponse;
    }
    return context.json(makeMarketplaceApiError('template_package_object_not_found', 'Template package was not found in R2.'), 404);
  }
  return context.json(response);
}

function parseListTemplatesQuery(url: URL): MarketplaceListTemplatesRequest {
  const sort = url.searchParams.get('sort');
  const page = Number.parseInt(url.searchParams.get('page') ?? '', 10);
  const pageSize = Number.parseInt(url.searchParams.get('pageSize') ?? '', 10);
  const tags = url.searchParams
    .getAll('tag')
    .flatMap((value) => value.split(','))
    .map((value) => value.trim())
    .filter(Boolean);
  const parsedSort = MARKETPLACE_SORT_VALUES.find((value) => value === sort);

  return {
    q: url.searchParams.get('q') ?? undefined,
    tags: tags.length > 0 ? tags : undefined,
    sort: parsedSort,
    page: Number.isFinite(page) ? page : undefined,
    pageSize: Number.isFinite(pageSize) ? pageSize : undefined
  };
}

function parseAdminBootstrapAllowlist(env: Pick<MarketplaceWorkerEnv, 'MARKETPLACE_ADMIN_GITHUB_IDS' | 'MARKETPLACE_ADMIN_GITHUB_LOGINS'> | undefined) {
  return {
    githubUserIds: parseCsvEnv(env?.MARKETPLACE_ADMIN_GITHUB_IDS),
    githubLogins: parseCsvEnv(env?.MARKETPLACE_ADMIN_GITHUB_LOGINS)
  };
}

function parseCsvEnv(value: string | undefined): string[] {
  return value
    ?.split(',')
    .map((entry) => entry.trim())
    .filter(Boolean) ?? [];
}

function createMarketplaceRepository(env: MarketplaceWorkerEnv | undefined) {
  if (env?.MARKETPLACE_ENABLE_SEED_TEMPLATES === 'true') {
    return createTemplateRepository(env.MARKETPLACE_DB);
  }
  return createProductionTemplateRepository(env?.MARKETPLACE_DB);
}

function buildMarketplaceMetaResponse(env: MarketplaceWorkerEnv | undefined): MarketplaceMetaResponse {
  const repository = createMarketplaceRepository(env);
  return {
    service: 'template-marketplace',
    serviceBuild: resolveMarketplaceServiceBuild(env),
    gitSha: resolveMarketplaceGitSha(env),
    apiVersion: MARKETPLACE_API_VERSION,
    minSupportedExtensionVersion: resolveNonEmptyEnv(
      env?.MARKETPLACE_MIN_SUPPORTED_EXTENSION_VERSION,
      MARKETPLACE_DEFAULT_MIN_SUPPORTED_EXTENSION_VERSION
    ),
    recommendedExtensionVersion: resolveNonEmptyEnv(
      env?.MARKETPLACE_RECOMMENDED_EXTENSION_VERSION,
      MARKETPLACE_DEFAULT_RECOMMENDED_EXTENSION_VERSION
    ),
    capabilities: buildMarketplaceServiceCapabilities(env),
    storageMode: repository.storageMode,
    runtime: {
      d1Configured: Boolean(env?.MARKETPLACE_DB),
      r2Configured: Boolean(env?.TEMPLATE_BUCKET),
      githubOAuthConfigured: Boolean(env?.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET && env.MARKETPLACE_SESSION_SECRET),
      vscodeAuthExchangeConfigured: Boolean(env?.MARKETPLACE_TOKEN_SECRET),
      seedTemplatesEnabled: env?.MARKETPLACE_ENABLE_SEED_TEMPLATES === 'true',
      testAuthEnabled: env?.MARKETPLACE_ALLOW_TEST_AUTH === 'true'
    }
  };
}

function buildMarketplaceServiceCapabilities(env: MarketplaceWorkerEnv | undefined): MarketplaceServiceCapability[] {
  const d1Configured = Boolean(env?.MARKETPLACE_DB);
  const r2Configured = Boolean(env?.TEMPLATE_BUCKET);
  const githubOAuthConfigured = Boolean(env?.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET && env.MARKETPLACE_SESSION_SECRET);
  const vscodeAuthExchangeConfigured = Boolean(env?.MARKETPLACE_TOKEN_SECRET);
  const testAuthEnabled = env?.MARKETPLACE_ALLOW_TEST_AUTH === 'true';
  const writeAuthConfigured = githubOAuthConfigured || vscodeAuthExchangeConfigured || testAuthEnabled;
  const capabilities = new Set<MarketplaceServiceCapability>([
    'templates.read',
    'templates.download-package',
    'templates.export-template-json'
  ]);

  if (d1Configured && r2Configured && writeAuthConfigured) {
    capabilities.add('templates.publish-json');
    capabilities.add('templates.publish-package');
    capabilities.add('templates.publish-version');
  }
  if (d1Configured && writeAuthConfigured) {
    capabilities.add('templates.like');
    capabilities.add('templates.report');
    capabilities.add('admin.reports');
    capabilities.add('admin.stats');
  }
  if (githubOAuthConfigured) {
    capabilities.add('auth.github-oauth');
  }
  if (vscodeAuthExchangeConfigured) {
    capabilities.add('auth.vscode-exchange');
  }

  return MARKETPLACE_SERVICE_CAPABILITIES.filter((capability) => capabilities.has(capability));
}

function resolveMarketplaceServiceBuild(env: MarketplaceWorkerEnv | undefined): string {
  const configured = normalizeMetadataValue(env?.MARKETPLACE_SERVICE_BUILD);
  if (configured) {
    return configured;
  }
  return normalizeMetadataValue(env?.VERSION_METADATA?.id) ?? 'local';
}

function resolveMarketplaceGitSha(env: MarketplaceWorkerEnv | undefined): string {
  const configured = normalizeMetadataValue(env?.MARKETPLACE_GIT_SHA);
  if (configured) {
    return configured;
  }
  const tag = normalizeMetadataValue(env?.VERSION_METADATA?.tag);
  if (tag && /^[0-9a-f]{7,40}$/iu.test(tag)) {
    return tag;
  }
  return 'unknown';
}

function resolveNonEmptyEnv(value: string | undefined, fallback: string): string {
  return normalizeMetadataValue(value) ?? fallback;
}

function normalizeMetadataValue(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

async function readPackageZipUpload(request: Request): Promise<{ bytes: Uint8Array; response?: never } | { bytes?: never; response: Response }> {
  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().includes('multipart/form-data')) {
    return {
      response: Response.json(makeMarketplaceApiError('package_upload_invalid', 'Package upload must use multipart/form-data.'), { status: 400 })
    };
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return {
      response: Response.json(makeMarketplaceApiError('package_upload_invalid', 'Package upload form data could not be parsed.'), { status: 400 })
    };
  }
  const file = formData.get('package') ?? formData.get('file');
  if (!isUploadedFile(file)) {
    return {
      response: Response.json(makeMarketplaceApiError('package_upload_missing', 'Upload package.zip in the package form field.'), { status: 400 })
    };
  }
  if (!file.name.toLowerCase().endsWith('.zip')) {
    return {
      response: Response.json(makeMarketplaceApiError('package_upload_invalid', 'Template package file must use the .zip extension.'), { status: 400 })
    };
  }
  return { bytes: new Uint8Array(await file.arrayBuffer()) };
}

function isUploadedFile(value: unknown): value is File {
  return Boolean(
    value &&
      typeof value === 'object' &&
      'name' in value &&
      typeof value.name === 'string' &&
      'arrayBuffer' in value &&
      typeof value.arrayBuffer === 'function'
  );
}
