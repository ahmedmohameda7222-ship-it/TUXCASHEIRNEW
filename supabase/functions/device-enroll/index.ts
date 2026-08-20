import { createClient } from '@supabase/supabase-js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function jsonResponse(status: number, body: Readonly<Record<string, unknown>>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

function randomSecret(bytes = 32): string {
  const value = crypto.getRandomValues(new Uint8Array(bytes));
  return Array.from(value, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return jsonResponse(405, { error: 'method_not_allowed' });

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const publishableKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !publishableKey || !serviceRoleKey) {
    return jsonResponse(500, { error: 'enrollment_not_configured' });
  }

  let body: Record<string, unknown>;
  try {
    const parsed = await request.json();
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error();
    body = parsed as Record<string, unknown>;
  } catch {
    return jsonResponse(400, { error: 'invalid_json' });
  }

  const enrollmentCode = typeof body['enrollmentCode'] === 'string' ? body['enrollmentCode'].trim() : '';
  const deviceId = typeof body['deviceId'] === 'string' ? body['deviceId'].trim() : '';
  const requestedLabel = typeof body['deviceLabel'] === 'string' ? body['deviceLabel'].trim() : '';
  if (enrollmentCode.length < 32 || !UUID_PATTERN.test(deviceId) || requestedLabel.length > 120) {
    return jsonResponse(400, { error: 'invalid_enrollment_request' });
  }

  const service = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: claims, error: claimError } = await service.rpc('claim_tux_device_enrollment', {
    p_enrollment_code: enrollmentCode,
  });
  if (claimError || !Array.isArray(claims) || claims.length !== 1) {
    return jsonResponse(401, { error: 'enrollment_code_unavailable' });
  }

  const claim = claims[0] as { enrollment_id?: string; shop_id?: string; device_label?: string };
  if (!claim.enrollment_id || !claim.shop_id) {
    return jsonResponse(500, { error: 'invalid_enrollment_claim' });
  }

  const email = `device-${deviceId}@operations.tux.invalid`;
  const password = randomSecret(32);
  const { data: created, error: createError } = await service.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    app_metadata: { tux_identity: 'OPERATIONS_DEVICE' },
  });
  if (createError || !created.user) {
    console.error('device auth user creation failed', createError);
    return jsonResponse(500, { error: 'device_identity_creation_failed' });
  }

  const authUserId = created.user.id;
  const label = requestedLabel || claim.device_label || 'TUX Operations Device';
  const { error: completeError } = await service.rpc('complete_tux_device_enrollment', {
    p_enrollment_id: claim.enrollment_id,
    p_auth_user_id: authUserId,
    p_device_id: deviceId,
    p_device_label: label,
  });
  if (completeError) {
    await service.auth.admin.deleteUser(authUserId).catch(() => undefined);
    console.error('device enrollment completion failed', completeError);
    return jsonResponse(500, { error: 'device_enrollment_failed' });
  }

  const publicClient = createClient(supabaseUrl, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: signedIn, error: signInError } = await publicClient.auth.signInWithPassword({
    email,
    password,
  });
  if (signInError || !signedIn.session) {
    console.error('device session creation failed', signInError);
    return jsonResponse(500, { error: 'device_session_creation_failed' });
  }

  return jsonResponse(200, {
    shopId: claim.shop_id,
    deviceId,
    accessToken: signedIn.session.access_token,
    refreshToken: signedIn.session.refresh_token,
    expiresAt: signedIn.session.expires_at ?? null,
  });
});
