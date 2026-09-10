export type AdminServerEnv = {
  supabaseUrl: string;
  serviceRoleKey: string;
  pinLookupSecret: string;
  rateLimitSecret: string;
  sessionTtlSeconds: number;
};

function requiredSecret(value: string | undefined, name: string): string {
  const secret = value?.trim() ?? '';
  if (secret.length < 16) throw new Error(`${name}_missing_or_too_short`);
  return secret;
}

function parseProjectUrl(raw: string | undefined): string {
  const value = raw?.trim() ?? '';
  if (!value) throw new Error('admin_supabase_url_missing');
  const url = new URL(value);
  const local = new Set(['localhost', '127.0.0.1', '::1']).has(url.hostname);
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) {
    throw new Error('admin_supabase_url_invalid');
  }
  return url.origin;
}

function parseSessionTtl(raw: string | undefined): number {
  if (!raw?.trim()) return 12 * 60 * 60;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 900 || value > 7 * 24 * 60 * 60) {
    throw new Error('admin_session_ttl_invalid');
  }
  return value;
}

export function getAdminServerEnv(source: NodeJS.ProcessEnv = process.env): AdminServerEnv {
  return {
    supabaseUrl: parseProjectUrl(source['TUX_SUPABASE_URL'] ?? source['SUPABASE_URL']),
    serviceRoleKey: requiredSecret(
      source['TUX_SUPABASE_SERVICE_ROLE_KEY'] ?? source['SUPABASE_SERVICE_ROLE_KEY'],
      'admin_service_role_key',
    ),
    pinLookupSecret: requiredSecret(
      source['TUX_ADMIN_PIN_LOOKUP_SECRET'],
      'admin_pin_lookup_secret',
    ),
    rateLimitSecret: requiredSecret(
      source['TUX_ADMIN_RATE_LIMIT_SECRET'],
      'admin_rate_limit_secret',
    ),
    sessionTtlSeconds: parseSessionTtl(source['TUX_ADMIN_SESSION_TTL_SECONDS']),
  };
}
