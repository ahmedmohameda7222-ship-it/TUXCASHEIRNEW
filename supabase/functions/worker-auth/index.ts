import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH_PREFIX = 'pbkdf2-sha256';
const DERIVED_KEY_BYTES = 32;
const MAX_ATTEMPTS = 8;
const WINDOW_SECONDS = 15 * 60;

function jsonResponse(status: number, body: unknown, retryAfter?: number): Response {
  const headers = new Headers({
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  if (retryAfter !== undefined) headers.set('retry-after', String(retryAfter));
  return new Response(JSON.stringify(body), { status, headers });
}

function bearerToken(request: Request): string | null {
  const authorization = request.headers.get('authorization')?.trim() ?? '';
  if (!authorization.toLowerCase().startsWith('bearer ')) return null;
  const token = authorization.slice(7).trim();
  return token.length === 0 ? null : token;
}

function hexToBytes(hex: string): Uint8Array | null {
  if (!/^[0-9a-f]+$/i.test(hex) || hex.length % 2 !== 0) return null;
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    const parsed = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
    if (!Number.isFinite(parsed)) return null;
    bytes[index] = parsed;
  }
  return bytes;
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return difference === 0;
}

async function verifyPin(pin: string, storedHash: string): Promise<boolean> {
  const [prefix, iterationsText, saltHex, digestHex, ...rest] = storedHash.split('$');
  if (
    prefix !== HASH_PREFIX ||
    iterationsText === undefined ||
    saltHex === undefined ||
    digestHex === undefined ||
    rest.length !== 0
  ) {
    return false;
  }
  const iterations = Number(iterationsText);
  const salt = hexToBytes(saltHex);
  const expected = hexToBytes(digestHex);
  if (
    !Number.isSafeInteger(iterations) ||
    iterations < 100_000 ||
    salt === null ||
    expected === null ||
    expected.length !== DERIVED_KEY_BYTES
  ) {
    return false;
  }

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(pin),
    { name: 'PBKDF2' },
    false,
    ['deriveBits'],
  );
  const derived = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: 'PBKDF2', hash: 'SHA-256', iterations, salt },
      key,
      DERIVED_KEY_BYTES * 8,
    ),
  );
  return constantTimeEqual(derived, expected);
}

async function rateKeyFor(userId: string, deviceId: string, shopId: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`worker-auth:${userId}:${deviceId}:${shopId}`),
  );
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function clearRateLimit(service: SupabaseClient, rateKey: string): Promise<void> {
  const { error } = await service.rpc('clear_tux_worker_pin_bootstrap_attempts', {
    p_rate_key: rateKey,
  });
  if (error) console.error('worker authentication rate-limit clear failed', error);
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return jsonResponse(405, { error: 'method_not_allowed' });

  const token = bearerToken(request);
  const deviceId = request.headers.get('x-tux-device-id')?.trim() ?? '';
  if (token === null || !UUID_PATTERN.test(deviceId)) {
    return jsonResponse(401, { error: 'device_authentication_required' });
  }

  let body: Record<string, unknown>;
  try {
    const parsed = await request.json();
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error();
    body = parsed as Record<string, unknown>;
  } catch {
    return jsonResponse(400, { error: 'invalid_worker_auth_request' });
  }
  const pin = typeof body['pin'] === 'string' ? body['pin'].trim() : '';
  if (!/^\d{4,12}$/.test(pin)) {
    return jsonResponse(400, { error: 'invalid_worker_auth_request' });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const publishableKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !publishableKey || !serviceRoleKey) {
    return jsonResponse(500, { error: 'worker_auth_not_configured' });
  }

  const publicClient = createClient(supabaseUrl, publishableKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userError } = await publicClient.auth.getUser(token);
  if (userError || !userData.user) return jsonResponse(401, { error: 'invalid_access_token' });

  const service = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: device, error: deviceError } = await service
    .from('devices')
    .select('id,shop_id,auth_user_id,active')
    .eq('id', deviceId)
    .eq('auth_user_id', userData.user.id)
    .eq('active', true)
    .maybeSingle();
  if (deviceError) {
    console.error('worker authentication device lookup failed', deviceError);
    return jsonResponse(500, { error: 'device_authorization_lookup_failed' });
  }
  if (!device || !UUID_PATTERN.test(device.shop_id)) {
    return jsonResponse(403, { error: 'device_not_authorized' });
  }

  const { data: membership, error: membershipError } = await service
    .from('shop_memberships')
    .select('role,active')
    .eq('shop_id', device.shop_id)
    .eq('auth_user_id', userData.user.id)
    .eq('role', 'OPERATIONS_DEVICE')
    .eq('active', true)
    .maybeSingle();
  if (membershipError) {
    console.error('worker authentication membership lookup failed', membershipError);
    return jsonResponse(500, { error: 'device_authorization_lookup_failed' });
  }
  if (!membership) return jsonResponse(403, { error: 'device_not_authorized' });

  const rateKey = await rateKeyFor(userData.user.id, device.id, device.shop_id);
  const { data: attempts, error: rateError } = await service.rpc(
    'claim_tux_worker_pin_bootstrap_attempt',
    {
      p_rate_key: rateKey,
      p_max_attempts: MAX_ATTEMPTS,
      p_window_seconds: WINDOW_SECONDS,
    },
  );
  if (rateError || !Array.isArray(attempts) || attempts.length !== 1) {
    console.error('worker authentication rate-limit check failed', rateError);
    return jsonResponse(500, { error: 'worker_auth_rate_limit_failed' });
  }
  const attempt = attempts[0] as { allowed?: boolean; retry_after_seconds?: number };
  if (attempt.allowed !== true) {
    const retryAfter =
      typeof attempt.retry_after_seconds === 'number' &&
      Number.isSafeInteger(attempt.retry_after_seconds) &&
      attempt.retry_after_seconds > 0
        ? attempt.retry_after_seconds
        : WINDOW_SECONDS;
    return jsonResponse(429, { error: 'too_many_pin_attempts' }, retryAfter);
  }

  const { data: workers, error: workerError } = await service
    .from('workers')
    .select('id,shop_id,display_name,pin_hash,active')
    .eq('shop_id', device.shop_id)
    .eq('active', true)
    .order('created_at', { ascending: true });
  if (workerError) {
    console.error('worker authentication worker lookup failed', workerError);
    return jsonResponse(500, { error: 'worker_lookup_failed' });
  }

  let matchedWorker:
    | { id: string; shop_id: string; display_name: string; pin_hash: string; active: boolean }
    | null = null;
  for (const candidate of workers ?? []) {
    const worker = candidate as {
      id: string;
      shop_id: string;
      display_name: string;
      pin_hash: string;
      active: boolean;
    };
    if ((await verifyPin(pin, worker.pin_hash)) && matchedWorker === null) matchedWorker = worker;
  }
  if (matchedWorker === null) return jsonResponse(401, { error: 'invalid_pin' });

  await clearRateLimit(service, rateKey);
  return jsonResponse(200, {
    worker: {
      id: matchedWorker.id,
      shopId: matchedWorker.shop_id,
      displayName: matchedWorker.display_name,
      pinHash: matchedWorker.pin_hash,
      active: true,
    },
  });
});
