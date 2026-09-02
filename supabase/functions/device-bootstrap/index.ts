import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RATE_KEY_PATTERN = /^[0-9a-f]{64}$/i;
const SIGNATURE_PATTERN = /^[0-9a-f]{64}$/i;
const HASH_PREFIX = 'pbkdf2-sha256';
const DERIVED_KEY_BYTES = 32;
const MAX_ATTEMPTS = 8;
const WINDOW_SECONDS = 15 * 60;
const BOOTSTRAP_PROVENANCE_VERSION = 'tux-device-bootstrap:v1';
const BOOTSTRAP_PROVENANCE_MAX_SKEW_SECONDS = 5 * 60;
const MIN_BOOTSTRAP_HMAC_SECRET_BYTES = 32;

interface TrustedBootstrapBody {
  readonly pin: string;
  readonly deviceId: string;
  readonly deviceLabel: string;
  readonly rateLimitKey: string;
}

function jsonResponse(status: number, body: unknown, retryAfter?: number): Response {
  const headers = new Headers({
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  if (retryAfter !== undefined) headers.set('retry-after', String(retryAfter));
  return new Response(JSON.stringify(body), { status, headers });
}

function randomSecret(bytes = 32): string {
  const value = crypto.getRandomValues(new Uint8Array(bytes));
  return Array.from(value, (byte) => byte.toString(16).padStart(2, '0')).join('');
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

function canonicalBootstrapRequest(
  body: TrustedBootstrapBody,
  timestamp: number,
  nonce: string,
): string {
  return JSON.stringify([
    BOOTSTRAP_PROVENANCE_VERSION,
    timestamp,
    nonce,
    body.rateLimitKey.toLowerCase(),
    body.deviceId.toLowerCase(),
    body.deviceLabel,
    body.pin,
  ]);
}

async function verifiedProvenanceNonce(
  request: Request,
  body: TrustedBootstrapBody,
  secret: string,
): Promise<string | null> {
  const rawTimestamp = request.headers.get('x-tux-bootstrap-timestamp')?.trim() ?? '';
  const rawNonce = request.headers.get('x-tux-bootstrap-nonce')?.trim() ?? '';
  const rawSignature = request.headers.get('x-tux-bootstrap-signature')?.trim() ?? '';
  const timestamp = Number(rawTimestamp);
  if (
    !Number.isSafeInteger(timestamp) ||
    timestamp <= 0 ||
    !UUID_PATTERN.test(rawNonce) ||
    !SIGNATURE_PATTERN.test(rawSignature)
  ) {
    return null;
  }

  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestamp) > BOOTSTRAP_PROVENANCE_MAX_SKEW_SECONDS) return null;

  const nonce = rawNonce.toLowerCase();
  const supplied = hexToBytes(rawSignature);
  if (supplied === null) return null;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const expected = new Uint8Array(
    await crypto.subtle.sign(
      'HMAC',
      key,
      new TextEncoder().encode(canonicalBootstrapRequest(body, timestamp, nonce)),
    ),
  );
  return constantTimeEqual(supplied, expected) ? nonce : null;
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

async function clearRateLimit(service: SupabaseClient, rateKey: string): Promise<void> {
  const { error } = await service.rpc('clear_tux_worker_pin_bootstrap_attempts', {
    p_rate_key: rateKey,
  });
  if (error) console.error('worker PIN bootstrap rate-limit clear failed', error);
}

async function deleteNewIdentity(
  service: SupabaseClient,
  shopId: string,
  authUserId: string,
): Promise<void> {
  await service
    .from('shop_memberships')
    .delete()
    .eq('shop_id', shopId)
    .eq('auth_user_id', authUserId);
  const { error } = await service.auth.admin.deleteUser(authUserId);
  if (error) console.error('worker PIN bootstrap auth cleanup failed', error);
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return jsonResponse(405, { error: 'method_not_allowed' });

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const publishableKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const hmacSecret = Deno.env.get('TUX_BOOTSTRAP_HMAC_SECRET')?.trim() ?? '';
  if (
    !supabaseUrl ||
    !publishableKey ||
    !serviceRoleKey ||
    new TextEncoder().encode(hmacSecret).length < MIN_BOOTSTRAP_HMAC_SECRET_BYTES
  ) {
    return jsonResponse(500, { error: 'bootstrap_not_configured' });
  }

  let body: Record<string, unknown>;
  try {
    const parsed = await request.json();
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error();
    body = parsed as Record<string, unknown>;
  } catch {
    return jsonResponse(400, { error: 'invalid_json' });
  }

  const pin = typeof body['pin'] === 'string' ? body['pin'].trim() : '';
  const deviceId = typeof body['deviceId'] === 'string' ? body['deviceId'].trim() : '';
  const requestedLabel =
    typeof body['deviceLabel'] === 'string' ? body['deviceLabel'].trim().slice(0, 120) : '';
  const rateKey = typeof body['rateLimitKey'] === 'string' ? body['rateLimitKey'].trim() : '';
  if (
    !/^\d{4,12}$/.test(pin) ||
    !UUID_PATTERN.test(deviceId) ||
    !RATE_KEY_PATTERN.test(rateKey)
  ) {
    return jsonResponse(400, { error: 'invalid_bootstrap_request' });
  }

  const trustedBody: TrustedBootstrapBody = {
    pin,
    deviceId,
    deviceLabel: requestedLabel,
    rateLimitKey: rateKey.toLowerCase(),
  };
  const provenanceNonce = await verifiedProvenanceNonce(request, trustedBody, hmacSecret);
  if (provenanceNonce === null) {
    return jsonResponse(401, { error: 'invalid_bootstrap_provenance' });
  }

  const service = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: nonceClaimed, error: nonceError } = await service.rpc(
    'claim_tux_bootstrap_request_nonce',
    { p_nonce: provenanceNonce },
  );
  if (nonceError || typeof nonceClaimed !== 'boolean') {
    console.error('worker PIN bootstrap nonce claim failed', nonceError);
    return jsonResponse(503, { error: 'bootstrap_nonce_guard_unavailable' });
  }
  if (!nonceClaimed) {
    return jsonResponse(409, { error: 'bootstrap_request_replayed' });
  }

  const { data: attempts, error: rateError } = await service.rpc(
    'claim_tux_worker_pin_bootstrap_attempt',
    {
      p_rate_key: trustedBody.rateLimitKey,
      p_max_attempts: MAX_ATTEMPTS,
      p_window_seconds: WINDOW_SECONDS,
    },
  );
  if (rateError || !Array.isArray(attempts) || attempts.length !== 1) {
    console.error('worker PIN bootstrap rate-limit check failed', rateError);
    return jsonResponse(503, { error: 'bootstrap_rate_limit_unavailable' });
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

  const { data: shops, error: shopError } = await service
    .from('shops')
    .select('id,name,active')
    .eq('active', true)
    .limit(2);
  if (shopError) {
    console.error('worker PIN bootstrap shop lookup failed', shopError);
    return jsonResponse(500, { error: 'shop_lookup_failed' });
  }
  if (!Array.isArray(shops) || shops.length !== 1) {
    return jsonResponse(503, { error: 'single_active_shop_required' });
  }
  const shop = shops[0] as { id: string; name: string; active: boolean };

  const { data: workers, error: workerError } = await service
    .from('workers')
    .select('id,shop_id,display_name,pin_hash,active')
    .eq('shop_id', shop.id)
    .eq('active', true)
    .order('created_at', { ascending: true });
  if (workerError) {
    console.error('worker PIN bootstrap worker lookup failed', workerError);
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
    const matches = await verifyPin(pin, worker.pin_hash);
    if (matches && matchedWorker === null) matchedWorker = worker;
  }
  if (matchedWorker === null) return jsonResponse(401, { error: 'invalid_pin' });

  await clearRateLimit(service, trustedBody.rateLimitKey);

  const deviceLabel = requestedLabel || 'TUX Operations Web';
  const password = randomSecret(32);
  let authUserId: string;
  let email: string;
  let createdNewIdentity = false;

  const { data: existingDevice, error: deviceLookupError } = await service
    .from('devices')
    .select('id,shop_id,auth_user_id')
    .eq('id', deviceId)
    .maybeSingle();
  if (deviceLookupError) {
    console.error('worker PIN bootstrap device lookup failed', deviceLookupError);
    return jsonResponse(500, { error: 'device_lookup_failed' });
  }

  if (existingDevice) {
    if (existingDevice.shop_id !== shop.id || typeof existingDevice.auth_user_id !== 'string') {
      return jsonResponse(409, { error: 'device_identity_conflict' });
    }
    authUserId = existingDevice.auth_user_id;
    const { data: authUser, error: authLookupError } = await service.auth.admin.getUserById(authUserId);
    email = authUser.user?.email ?? '';
    if (authLookupError || email.length === 0) {
      console.error('worker PIN bootstrap existing auth lookup failed', authLookupError);
      return jsonResponse(500, { error: 'device_identity_lookup_failed' });
    }

    const { error: updateAuthError } = await service.auth.admin.updateUserById(authUserId, {
      password,
      app_metadata: { tux_identity: 'OPERATIONS_DEVICE' },
    });
    if (updateAuthError) {
      console.error('worker PIN bootstrap auth refresh failed', updateAuthError);
      return jsonResponse(500, { error: 'device_identity_refresh_failed' });
    }

    const { error: membershipError } = await service
      .from('shop_memberships')
      .update({ role: 'OPERATIONS_DEVICE', active: true })
      .eq('shop_id', shop.id)
      .eq('auth_user_id', authUserId);
    if (membershipError) {
      console.error('worker PIN bootstrap membership refresh failed', membershipError);
      return jsonResponse(500, { error: 'device_membership_refresh_failed' });
    }
    const { error: deviceRefreshError } = await service
      .from('devices')
      .update({ label: deviceLabel, active: true })
      .eq('id', deviceId)
      .eq('shop_id', shop.id);
    if (deviceRefreshError) {
      console.error('worker PIN bootstrap device refresh failed', deviceRefreshError);
      return jsonResponse(500, { error: 'device_refresh_failed' });
    }
  } else {
    email = `device-${deviceId}-${randomSecret(6)}@operations.tux.invalid`;
    const { data: created, error: createError } = await service.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      app_metadata: { tux_identity: 'OPERATIONS_DEVICE' },
    });
    if (createError || !created.user) {
      console.error('worker PIN bootstrap auth user creation failed', createError);
      return jsonResponse(500, { error: 'device_identity_creation_failed' });
    }
    authUserId = created.user.id;
    createdNewIdentity = true;

    const { error: membershipError } = await service.from('shop_memberships').insert({
      id: crypto.randomUUID(),
      shop_id: shop.id,
      auth_user_id: authUserId,
      role: 'OPERATIONS_DEVICE',
      active: true,
    });
    if (membershipError) {
      await deleteNewIdentity(service, shop.id, authUserId);
      console.error('worker PIN bootstrap membership creation failed', membershipError);
      return jsonResponse(500, { error: 'device_membership_creation_failed' });
    }

    const { error: deviceError } = await service.from('devices').insert({
      id: deviceId,
      shop_id: shop.id,
      label: deviceLabel,
      active: true,
      auth_user_id: authUserId,
    });
    if (deviceError) {
      await deleteNewIdentity(service, shop.id, authUserId);
      console.error('worker PIN bootstrap device creation failed', deviceError);
      return jsonResponse(500, { error: 'device_creation_failed' });
    }
  }

  const publicClient = createClient(supabaseUrl, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: signedIn, error: signInError } = await publicClient.auth.signInWithPassword({
    email,
    password,
  });
  if (signInError || !signedIn.session) {
    if (createdNewIdentity) {
      await service.from('devices').delete().eq('id', deviceId);
      await deleteNewIdentity(service, shop.id, authUserId);
    }
    console.error('worker PIN bootstrap device session creation failed', signInError);
    return jsonResponse(500, { error: 'device_session_creation_failed' });
  }

  return jsonResponse(200, {
    shopId: shop.id,
    deviceId,
    accessToken: signedIn.session.access_token,
    refreshToken: signedIn.session.refresh_token,
    expiresAt: signedIn.session.expires_at ?? null,
    shop: { id: shop.id, name: shop.name, active: true },
    worker: {
      id: matchedWorker.id,
      shopId: matchedWorker.shop_id,
      displayName: matchedWorker.display_name,
      pinHash: matchedWorker.pin_hash,
      active: true,
    },
  });
});
