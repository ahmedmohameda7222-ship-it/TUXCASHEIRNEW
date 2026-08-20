import { createClient } from '@supabase/supabase-js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

function bearerToken(request: Request): string | null {
  const authorization = request.headers.get('authorization')?.trim() ?? '';
  if (!authorization.toLowerCase().startsWith('bearer ')) return null;
  const token = authorization.slice(7).trim();
  return token.length === 0 ? null : token;
}

Deno.serve(async (request) => {
  if (request.method !== 'GET') return jsonResponse(405, { error: 'method_not_allowed' });

  const token = bearerToken(request);
  const deviceId = request.headers.get('x-tux-device-id')?.trim() ?? '';
  if (token === null || !UUID_PATTERN.test(deviceId)) {
    return jsonResponse(401, { error: 'device_authentication_required' });
  }

  const url = new URL(request.url);
  const shopId = url.searchParams.get('shopId')?.trim() ?? '';
  const requestedVersion = url.searchParams.get('version')?.trim() ?? null;
  if (!UUID_PATTERN.test(shopId)) return jsonResponse(400, { error: 'invalid_shop_id' });

  let version: number | null = null;
  if (requestedVersion !== null) {
    const parsed = Number(requestedVersion);
    if (!Number.isSafeInteger(parsed) || parsed <= 0) {
      return jsonResponse(400, { error: 'invalid_configuration_version' });
    }
    version = parsed;
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const publishableKey = Deno.env.get('SUPABASE_ANON_KEY');
  if (!supabaseUrl || !publishableKey) {
    return jsonResponse(500, { error: 'configuration_endpoint_not_configured' });
  }

  const client = createClient(supabaseUrl, publishableKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userError } = await client.auth.getUser(token);
  if (userError || !userData.user) return jsonResponse(401, { error: 'invalid_access_token' });

  const { data: device, error: deviceError } = await client
    .from('devices')
    .select('id,shop_id')
    .eq('id', deviceId)
    .eq('shop_id', shopId)
    .maybeSingle();
  if (deviceError) {
    console.error('configuration device authorization lookup failed', deviceError);
    return jsonResponse(500, { error: 'device_authorization_lookup_failed' });
  }
  if (!device) return jsonResponse(403, { error: 'device_not_authorized' });

  if (version === null) {
    const { data, error } = await client
      .from('operations_configuration_snapshots')
      .select('version')
      .eq('shop_id', shopId)
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) {
      console.error('configuration version lookup failed', error);
      return jsonResponse(500, { error: 'configuration_lookup_failed' });
    }
    return jsonResponse(200, { version: data?.version ?? null });
  }

  const { data, error } = await client
    .from('operations_configuration_snapshots')
    .select('version,bundle_json')
    .eq('shop_id', shopId)
    .eq('version', version)
    .maybeSingle();
  if (error) {
    console.error('configuration bundle lookup failed', error);
    return jsonResponse(500, { error: 'configuration_lookup_failed' });
  }
  if (!data) return jsonResponse(404, { error: 'configuration_not_found' });

  return jsonResponse(200, { version: data.version, bundle: data.bundle_json });
});
