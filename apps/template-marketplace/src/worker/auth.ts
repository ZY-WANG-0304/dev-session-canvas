import { makeMarketplaceApiError } from '@dev-session-canvas/marketplace-shared';

const SESSION_COOKIE_NAME = 'dsc_marketplace_session';
const OAUTH_STATE_COOKIE_NAME = 'dsc_marketplace_oauth_state';
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 14;
const OAUTH_STATE_MAX_AGE_SECONDS = 60 * 10;
const GITHUB_AUTHORIZE_URL = 'https://github.com/login/oauth/authorize';
const GITHUB_TOKEN_URL = 'https://github.com/login/oauth/access_token';
const GITHUB_USER_URL = 'https://api.github.com/user';

export interface MarketplaceAuthEnv {
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
  MARKETPLACE_SESSION_SECRET?: string;
  MARKETPLACE_TOKEN_SECRET?: string;
  MARKETPLACE_ALLOW_TEST_AUTH?: string;
}

export interface MarketplaceAuthenticatedUser {
  githubUserId: string;
  githubLogin: string;
  displayName: string;
  avatarUrl: string;
}

interface MarketplaceSessionPayload extends MarketplaceAuthenticatedUser {
  exp: number;
}

interface MarketplaceOAuthStatePayload {
  state: string;
  codeVerifier: string;
  returnTo: string;
  exp: number;
}

export interface MarketplaceVSCodeTokenResponse {
  token: string;
  expiresAt: string;
  user: MarketplaceAuthenticatedUser;
}

interface GithubUserResponse {
  id: number;
  login: string;
  name?: string | null;
  avatar_url?: string | null;
}

export async function getMarketplaceAuthenticatedUser(
  request: Request,
  env: MarketplaceAuthEnv = {}
): Promise<MarketplaceAuthenticatedUser | undefined> {
  const testUser = getTestAuthenticatedUser(request, env);
  if (testUser) {
    return testUser;
  }

  const bearerUser = await getBearerAuthenticatedUser(request, env);
  if (bearerUser) {
    return bearerUser;
  }

  const sessionSecret = env.MARKETPLACE_SESSION_SECRET;
  if (!sessionSecret) {
    return undefined;
  }
  const cookieValue = parseCookies(request.headers.get('cookie'))[SESSION_COOKIE_NAME];
  if (!cookieValue) {
    return undefined;
  }
  const payload = await verifySignedJson<MarketplaceSessionPayload>(cookieValue, sessionSecret);
  if (!payload || payload.exp < Math.floor(Date.now() / 1000)) {
    return undefined;
  }
  return {
    githubUserId: payload.githubUserId,
    githubLogin: payload.githubLogin,
    displayName: payload.displayName,
    avatarUrl: payload.avatarUrl
  };
}

export async function exchangeVSCodeGithubToken(request: Request, env: MarketplaceAuthEnv = {}): Promise<MarketplaceVSCodeTokenResponse | Response> {
  if (!env.MARKETPLACE_TOKEN_SECRET) {
    return Response.json(makeMarketplaceApiError('auth_not_configured', 'VSCode marketplace token exchange is not configured.'), { status: 503 });
  }

  const testUser = getTestAuthenticatedUser(request, env);
  if (testUser) {
    return buildVSCodeTokenResponse(testUser, env.MARKETPLACE_TOKEN_SECRET);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(makeMarketplaceApiError('auth_exchange_invalid', 'VSCode auth exchange request must be valid JSON.'), { status: 400 });
  }
  if (!isRecord(body) || typeof body.accessToken !== 'string' || body.accessToken.trim().length === 0) {
    return Response.json(makeMarketplaceApiError('auth_exchange_invalid', 'VSCode auth exchange request is missing accessToken.'), { status: 400 });
  }

  const userResponse = await fetch(GITHUB_USER_URL, {
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${body.accessToken.trim()}`,
      'user-agent': 'dev-session-canvas-template-marketplace'
    }
  });
  if (!userResponse.ok) {
    return Response.json(makeMarketplaceApiError('auth_user_fetch_failed', 'Failed to load GitHub user profile.'), { status: 502 });
  }
  return buildVSCodeTokenResponse(mapGithubUser((await userResponse.json()) as GithubUserResponse), env.MARKETPLACE_TOKEN_SECRET);
}

export async function buildGithubOAuthStartResponse(request: Request, env: MarketplaceAuthEnv = {}): Promise<Response> {
  if (!env.GITHUB_CLIENT_ID || !env.MARKETPLACE_SESSION_SECRET) {
    return Response.json(makeMarketplaceApiError('auth_not_configured', 'GitHub OAuth is not configured.'), { status: 503 });
  }

  const state = createRandomToken();
  const codeVerifier = createRandomVerifier();
  const returnTo = normalizeOAuthReturnTo(new URL(request.url).searchParams.get('return_to'));
  const signedState = await signJson(
    { state, codeVerifier, returnTo, exp: Math.floor(Date.now() / 1000) + OAUTH_STATE_MAX_AGE_SECONDS },
    env.MARKETPLACE_SESSION_SECRET
  );
  const codeChallenge = await sha256Base64Url(codeVerifier);
  const callbackUrl = new URL('/api/v1/auth/github/callback', request.url).toString();
  const authorizeUrl = new URL(GITHUB_AUTHORIZE_URL);
  authorizeUrl.searchParams.set('client_id', env.GITHUB_CLIENT_ID);
  authorizeUrl.searchParams.set('redirect_uri', callbackUrl);
  authorizeUrl.searchParams.set('scope', 'read:user');
  authorizeUrl.searchParams.set('state', state);
  authorizeUrl.searchParams.set('code_challenge', codeChallenge);
  authorizeUrl.searchParams.set('code_challenge_method', 'S256');

  return new Response(null, {
    status: 302,
    headers: {
      location: authorizeUrl.toString(),
      'set-cookie': serializeCookie(OAUTH_STATE_COOKIE_NAME, signedState, {
        maxAge: OAUTH_STATE_MAX_AGE_SECONDS,
        httpOnly: true,
        secure: isHttpsRequest(request),
        sameSite: 'Lax',
        path: '/api/v1/auth/github/callback'
      })
    }
  });
}

export function buildMarketplaceLogoutResponse(request: Request): Response {
  return new Response(null, {
    status: 302,
    headers: {
      location: new URL(normalizeOAuthReturnTo(new URL(request.url).searchParams.get('return_to')), request.url).toString(),
      'set-cookie': serializeCookie(SESSION_COOKIE_NAME, '', {
        maxAge: 0,
        httpOnly: true,
        secure: isHttpsRequest(request),
        sameSite: 'Lax',
        path: '/'
      })
    }
  });
}

export async function exchangeGithubOAuthCallback(
  request: Request,
  env: MarketplaceAuthEnv = {}
): Promise<
  | {
      user: MarketplaceAuthenticatedUser;
      sessionCookie: string;
      clearStateCookie: string;
      redirectTo: string;
    }
  | Response
> {
  if (!env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET || !env.MARKETPLACE_SESSION_SECRET) {
    return Response.json(makeMarketplaceApiError('auth_not_configured', 'GitHub OAuth is not configured.'), { status: 503 });
  }

  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  if (!code || !state) {
    return Response.json(makeMarketplaceApiError('auth_callback_invalid', 'GitHub OAuth callback is missing code or state.'), { status: 400 });
  }

  const cookieState = parseCookies(request.headers.get('cookie'))[OAUTH_STATE_COOKIE_NAME];
  const parsedState = cookieState
    ? await verifySignedJson<MarketplaceOAuthStatePayload>(cookieState, env.MARKETPLACE_SESSION_SECRET)
    : undefined;
  if (!parsedState || parsedState.exp < Math.floor(Date.now() / 1000) || parsedState.state !== state) {
    return Response.json(makeMarketplaceApiError('auth_state_invalid', 'GitHub OAuth state is invalid or expired.'), { status: 400 });
  }

  const tokenResponse = await fetch(GITHUB_TOKEN_URL, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({
      client_id: env.GITHUB_CLIENT_ID,
      client_secret: env.GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: new URL('/api/v1/auth/github/callback', request.url).toString(),
      code_verifier: parsedState.codeVerifier
    })
  });
  const tokenBody = (await tokenResponse.json()) as { access_token?: string; error?: string };
  if (!tokenResponse.ok || !tokenBody.access_token) {
    return Response.json(makeMarketplaceApiError('auth_code_exchange_failed', tokenBody.error ?? 'GitHub OAuth code exchange failed.'), {
      status: 502
    });
  }

  const userResponse = await fetch(GITHUB_USER_URL, {
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${tokenBody.access_token}`,
      'user-agent': 'dev-session-canvas-template-marketplace'
    }
  });
  if (!userResponse.ok) {
    return Response.json(makeMarketplaceApiError('auth_user_fetch_failed', 'Failed to load GitHub user profile.'), { status: 502 });
  }
  const githubUser = (await userResponse.json()) as GithubUserResponse;
  const user = mapGithubUser(githubUser);
  const sessionCookie = await buildMarketplaceSessionCookie(request, env, user);
  return {
    user,
    sessionCookie,
    clearStateCookie: serializeCookie(OAUTH_STATE_COOKIE_NAME, '', {
      maxAge: 0,
      httpOnly: true,
      secure: isHttpsRequest(request),
      sameSite: 'Lax',
      path: '/api/v1/auth/github/callback'
    }),
    redirectTo: new URL(normalizeOAuthReturnTo(parsedState.returnTo), request.url).toString()
  };
}

export async function buildMarketplaceSessionCookie(
  request: Request,
  env: MarketplaceAuthEnv,
  user: MarketplaceAuthenticatedUser
): Promise<string> {
  if (!env.MARKETPLACE_SESSION_SECRET) {
    throw new Error('MARKETPLACE_SESSION_SECRET is required to create a marketplace session.');
  }
  const signedSession = await signJson<MarketplaceSessionPayload>(
    {
      ...user,
      exp: Math.floor(Date.now() / 1000) + SESSION_MAX_AGE_SECONDS
    },
    env.MARKETPLACE_SESSION_SECRET
  );
  return serializeCookie(SESSION_COOKIE_NAME, signedSession, {
    maxAge: SESSION_MAX_AGE_SECONDS,
    httpOnly: true,
    secure: isHttpsRequest(request),
    sameSite: 'Lax',
    path: '/'
  });
}

async function getBearerAuthenticatedUser(request: Request, env: MarketplaceAuthEnv): Promise<MarketplaceAuthenticatedUser | undefined> {
  const tokenSecret = env.MARKETPLACE_TOKEN_SECRET;
  if (!tokenSecret) {
    return undefined;
  }
  const authorization = request.headers.get('authorization')?.trim();
  const match = authorization?.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return undefined;
  }
  const payload = await verifySignedJson<MarketplaceSessionPayload>(match[1], tokenSecret);
  if (!payload || payload.exp < Math.floor(Date.now() / 1000)) {
    return undefined;
  }
  return {
    githubUserId: payload.githubUserId,
    githubLogin: payload.githubLogin,
    displayName: payload.displayName,
    avatarUrl: payload.avatarUrl
  };
}

async function buildVSCodeTokenResponse(user: MarketplaceAuthenticatedUser, secret: string): Promise<MarketplaceVSCodeTokenResponse> {
  const exp = Math.floor(Date.now() / 1000) + SESSION_MAX_AGE_SECONDS;
  return {
    token: await signJson<MarketplaceSessionPayload>({ ...user, exp }, secret),
    expiresAt: new Date(exp * 1000).toISOString(),
    user
  };
}

function getTestAuthenticatedUser(request: Request, env: MarketplaceAuthEnv): MarketplaceAuthenticatedUser | undefined {
  if (env.MARKETPLACE_ALLOW_TEST_AUTH !== 'true') {
    return undefined;
  }
  const githubLogin = request.headers.get('x-marketplace-test-github-login')?.trim();
  if (!githubLogin || !/^[A-Za-z0-9-]{1,39}$/.test(githubLogin)) {
    return undefined;
  }
  return {
    githubUserId: `test-${githubLogin.toLowerCase()}`,
    githubLogin,
    displayName: githubLogin,
    avatarUrl: `https://github.com/${encodeURIComponent(githubLogin)}.png`
  };
}

function mapGithubUser(user: GithubUserResponse): MarketplaceAuthenticatedUser {
  return {
    githubUserId: String(user.id),
    githubLogin: user.login,
    displayName: user.name?.trim() || user.login,
    avatarUrl: user.avatar_url ?? `https://github.com/${encodeURIComponent(user.login)}.png`
  };
}

function normalizeOAuthReturnTo(value: unknown): string {
  if (typeof value !== 'string') {
    return '/templates';
  }
  const trimmed = value.trim();
  if (
    !trimmed.startsWith('/templates') ||
    trimmed.startsWith('//') ||
    trimmed.includes('\\') ||
    /[\u0000-\u001f\u007f]/u.test(trimmed)
  ) {
    return '/templates';
  }
  return trimmed;
}

async function signJson<T extends object>(payload: T, secret: string): Promise<string> {
  const encodedPayload = base64UrlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const signature = await signText(encodedPayload, secret);
  return `${encodedPayload}.${signature}`;
}

async function verifySignedJson<T extends object>(value: string, secret: string): Promise<T | undefined> {
  const [payload, signature] = value.split('.');
  if (!payload || !signature) {
    return undefined;
  }
  const expectedSignature = await signText(payload, secret);
  if (!constantTimeStringEqual(signature, expectedSignature)) {
    return undefined;
  }
  try {
    return JSON.parse(new TextDecoder().decode(base64UrlDecode(payload))) as T;
  } catch {
    return undefined;
  }
}

async function signText(value: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value));
  return base64UrlEncode(new Uint8Array(signature));
}

async function sha256Base64Url(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return base64UrlEncode(new Uint8Array(digest));
}

function createRandomToken(): string {
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

function createRandomVerifier(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

function parseCookies(cookieHeader: string | null): Record<string, string> {
  const cookies: Record<string, string> = {};
  for (const part of cookieHeader?.split(';') ?? []) {
    const separatorIndex = part.indexOf('=');
    if (separatorIndex < 0) {
      continue;
    }
    const name = part.slice(0, separatorIndex).trim();
    const value = part.slice(separatorIndex + 1).trim();
    if (name) {
      cookies[name] = decodeURIComponent(value);
    }
  }
  return cookies;
}

function serializeCookie(
  name: string,
  value: string,
  options: {
    maxAge: number;
    httpOnly: boolean;
    secure: boolean;
    sameSite: 'Lax' | 'Strict' | 'None';
    path: string;
  }
): string {
  const parts = [`${name}=${encodeURIComponent(value)}`, `Max-Age=${options.maxAge}`, `Path=${options.path}`, `SameSite=${options.sameSite}`];
  if (options.httpOnly) {
    parts.push('HttpOnly');
  }
  if (options.secure) {
    parts.push('Secure');
  }
  return parts.join('; ');
}

function isHttpsRequest(request: Request): boolean {
  const url = new URL(request.url);
  return url.protocol === 'https:' || request.headers.get('x-forwarded-proto') === 'https';
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlDecode(value: string): Uint8Array {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function constantTimeStringEqual(left: string, right: string): boolean {
  let diff = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    diff |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return diff === 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
