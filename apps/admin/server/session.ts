import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const SESSION_COOKIE = 'tux_admin_session';
const DEFAULT_SESSION_TTL_SECONDS = 12 * 60 * 60;
const CSRF_DERIVATION_CONTEXT = 'tux-admin-csrf-v1';

export type AdminSessionMaterial = {
  token: string;
  tokenHash: string;
  csrfToken: string;
  csrfTokenHash: string;
  expiresAt: Date;
};

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function deriveAdminCsrfToken(sessionToken: string): string {
  if (!/^[0-9a-f]{64}$/.test(sessionToken)) throw new Error('invalid_session_token');
  return createHmac('sha256', Buffer.from(sessionToken, 'hex'))
    .update(CSRF_DERIVATION_CONTEXT)
    .digest('hex');
}

export function createSessionMaterial(
  now = new Date(),
  ttlSeconds = DEFAULT_SESSION_TTL_SECONDS,
): AdminSessionMaterial {
  if (!Number.isSafeInteger(ttlSeconds) || ttlSeconds <= 0) {
    throw new Error('invalid_session_ttl');
  }
  const token = randomBytes(32).toString('hex');
  const csrfToken = deriveAdminCsrfToken(token);
  return {
    token,
    tokenHash: sha256Hex(token),
    csrfToken,
    csrfTokenHash: sha256Hex(csrfToken),
    expiresAt: new Date(now.getTime() + ttlSeconds * 1000),
  };
}

export function adminSessionCookie(
  token: string,
  options: { secure: boolean; maxAgeSeconds: number },
): string {
  if (!/^[0-9a-f]{64}$/.test(token)) throw new Error('invalid_session_token');
  if (!Number.isSafeInteger(options.maxAgeSeconds) || options.maxAgeSeconds <= 0) {
    throw new Error('invalid_session_cookie_age');
  }

  return [
    `${SESSION_COOKIE}=${token}`,
    'Path=/',
    `Max-Age=${options.maxAgeSeconds}`,
    'HttpOnly',
    'SameSite=Lax',
    options.secure ? 'Secure' : null,
  ]
    .filter((part): part is string => part !== null)
    .join('; ');
}

export function clearAdminSessionCookie(secure: boolean): string {
  return [
    `${SESSION_COOKIE}=`,
    'Path=/',
    'Max-Age=0',
    'HttpOnly',
    'SameSite=Lax',
    secure ? 'Secure' : null,
  ]
    .filter((part): part is string => part !== null)
    .join('; ');
}

export function readAdminSessionToken(cookieHeader: string | undefined): string | null {
  if (!cookieHeader) return null;
  for (const segment of cookieHeader.split(';')) {
    const separator = segment.indexOf('=');
    if (separator <= 0) continue;
    const name = segment.slice(0, separator).trim();
    const value = segment.slice(separator + 1).trim();
    if (name === SESSION_COOKIE && /^[0-9a-f]{64}$/.test(value)) return value;
  }
  return null;
}

export function csrfMatches(csrfToken: string, storedHash: string): boolean {
  if (!/^[0-9a-f]{64}$/.test(csrfToken) || !/^[0-9a-f]{64}$/.test(storedHash)) return false;
  const actual = Buffer.from(sha256Hex(csrfToken), 'hex');
  const expected = Buffer.from(storedHash, 'hex');
  return timingSafeEqual(actual, expected);
}

export function requireRecentReauth(
  session: { reauthenticatedAt: Date | null },
  maxAgeSeconds: number,
  now = new Date(),
): void {
  if (!Number.isFinite(maxAgeSeconds) || maxAgeSeconds <= 0) {
    throw new Error('invalid_reauthentication_age');
  }
  const at = session.reauthenticatedAt;
  if (at === null) throw new Error('reauthentication_required');
  const ageMs = now.getTime() - at.getTime();
  if (ageMs < 0 || ageMs > maxAgeSeconds * 1000) {
    throw new Error('reauthentication_required');
  }
}

export const ADMIN_SESSION_COOKIE_NAME = SESSION_COOKIE;
export const ADMIN_SESSION_TTL_SECONDS = DEFAULT_SESSION_TTL_SECONDS;
