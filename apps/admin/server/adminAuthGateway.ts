import {
  AdminAuthError,
  loadAdminSession,
  loginAdmin,
  requireSessionCsrf,
  rotateSessionCsrf,
} from './adminAuthService';
import { getAdminServerEnv } from './env';
import {
  clientFingerprint,
  firstHeader,
  readJsonObject,
  requireSameOrigin,
  sendJson,
  shouldUseSecureCookie,
  type AdminRequest,
  type AdminResponse,
} from './http';
import { AdminRateLimitError } from './loginRateLimit';
import { reauthenticateAdminSession } from './reauth';
import {
  ADMIN_SESSION_TTL_SECONDS,
  adminSessionCookie,
  clearAdminSessionCookie,
  readAdminSessionToken,
} from './session';
import { AdminSupabaseClient, AdminSupabaseError } from './supabaseAdmin';

const PIN_PATTERN = /^\d{4,12}$/;

function serverContext(): { env: ReturnType<typeof getAdminServerEnv>; client: AdminSupabaseClient } {
  const env = getAdminServerEnv();
  return { env, client: new AdminSupabaseClient(env) };
}

function handleFailure(response: AdminResponse, error: unknown): void {
  if (error instanceof AdminRateLimitError) {
    response.setHeader('retry-after', String(error.retryAfterSeconds));
    sendJson(response, 429, { error: error.code });
    return;
  }
  if (error instanceof AdminAuthError) {
    sendJson(response, error.status, { error: error.code });
    return;
  }
  if (error instanceof AdminSupabaseError) {
    console.error('Admin backend database request failed', { status: error.status });
    sendJson(response, 502, { error: 'admin_backend_unavailable' });
    return;
  }
  const message = error instanceof Error ? error.message : 'unknown_error';
  if (message.includes('missing') || message.includes('too_short') || message.includes('invalid')) {
    console.error('Admin server configuration or request validation failed', { code: message });
  } else {
    console.error('Admin request failed');
  }
  sendJson(response, 500, { error: 'admin_request_failed' });
}

function requireMethod(
  request: AdminRequest,
  response: AdminResponse,
  expected: 'GET' | 'POST',
): boolean {
  if (request.method === expected) return true;
  response.setHeader('allow', expected);
  sendJson(response, 405, { error: 'method_not_allowed' });
  return false;
}

async function loadRequestSession(request: AdminRequest, client: AdminSupabaseClient) {
  const token = readAdminSessionToken(firstHeader(request.headers.cookie));
  if (!token) throw new AdminAuthError('session_required', 401);
  return { token, context: await loadAdminSession(token, client) };
}

export async function handleAdminLogin(
  request: AdminRequest,
  response: AdminResponse,
): Promise<void> {
  if (!requireMethod(request, response, 'POST') || !requireSameOrigin(request, response)) return;
  try {
    const body = await readJsonObject(request);
    const pin = typeof body['pin'] === 'string' ? body['pin'].trim() : '';
    if (!PIN_PATTERN.test(pin)) {
      sendJson(response, 400, { error: 'invalid_login_request' });
      return;
    }
    const { env, client } = serverContext();
    const result = await loginAdmin(pin, clientFingerprint(request), client, env);
    response.setHeader(
      'set-cookie',
      adminSessionCookie(result.material.token, {
        secure: shouldUseSecureCookie(request),
        maxAgeSeconds: env.sessionTtlSeconds,
      }),
    );
    sendJson(response, 200, {
      principal: result.principal,
      csrfToken: result.material.csrfToken,
    });
  } catch (error) {
    handleFailure(response, error);
  }
}

export async function handleAdminSession(
  request: AdminRequest,
  response: AdminResponse,
): Promise<void> {
  if (!requireMethod(request, response, 'GET')) return;
  try {
    const { client } = serverContext();
    const { context } = await loadRequestSession(request, client);
    const csrfToken = await rotateSessionCsrf(context, client);
    sendJson(response, 200, { principal: context.principal, csrfToken });
  } catch (error) {
    handleFailure(response, error);
  }
}

export async function handleAdminLogout(
  request: AdminRequest,
  response: AdminResponse,
): Promise<void> {
  if (!requireMethod(request, response, 'POST') || !requireSameOrigin(request, response)) return;
  try {
    const { client } = serverContext();
    const { context } = await loadRequestSession(request, client);
    requireSessionCsrf(context, firstHeader(request.headers['x-tux-admin-csrf']).trim());
    await client.update<unknown>(
      'admin_sessions',
      new URLSearchParams({ id: `eq.${context.session.id}`, revoked_at: 'is.null' }),
      { revoked_at: new Date().toISOString() },
    );
    response.setHeader('set-cookie', clearAdminSessionCookie(shouldUseSecureCookie(request)));
    sendJson(response, 200, { ok: true });
  } catch (error) {
    handleFailure(response, error);
  }
}

export async function handleAdminReauth(
  request: AdminRequest,
  response: AdminResponse,
): Promise<void> {
  if (!requireMethod(request, response, 'POST') || !requireSameOrigin(request, response)) return;
  try {
    const body = await readJsonObject(request);
    const pin = typeof body['pin'] === 'string' ? body['pin'].trim() : '';
    if (!PIN_PATTERN.test(pin)) {
      sendJson(response, 400, { error: 'invalid_reauth_request' });
      return;
    }
    const { client } = serverContext();
    const { context } = await loadRequestSession(request, client);
    requireSessionCsrf(context, firstHeader(request.headers['x-tux-admin-csrf']).trim());
    if (!context.employee.pin_hash) throw new AdminAuthError('employee_inactive', 403);
    const at = await reauthenticateAdminSession(
      {
        sessionId: context.session.id,
        employeeId: context.employee.id,
        pinHash: context.employee.pin_hash,
      },
      pin,
      {
        now: () => new Date(),
        async markReauthenticated(sessionId, timestamp) {
          await client.update<unknown>(
            'admin_sessions',
            new URLSearchParams({ id: `eq.${sessionId}`, revoked_at: 'is.null' }),
            { reauthenticated_at: timestamp.toISOString(), last_seen_at: timestamp.toISOString() },
          );
        },
      },
    );
    sendJson(response, 200, { ok: true, reauthenticatedAt: at.toISOString() });
  } catch (error) {
    handleFailure(response, error);
  }
}

export const ADMIN_DEFAULT_SESSION_TTL_SECONDS = ADMIN_SESSION_TTL_SECONDS;
