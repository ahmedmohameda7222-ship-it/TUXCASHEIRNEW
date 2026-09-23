import { createClient } from '@supabase/supabase-js';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type UnknownRecord = Record<string, unknown>;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

function object(value: unknown): UnknownRecord | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function nullableString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return typeof value === 'string' ? value.trim() : null;
}

function bearerToken(request: Request): string | null {
  const authorization = request.headers.get('authorization')?.trim() ?? '';
  if (!authorization.toLowerCase().startsWith('bearer ')) return null;
  const token = authorization.slice(7).trim();
  return token.length === 0 ? null : token;
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return jsonResponse(405, { error: 'method_not_allowed' });

  const token = bearerToken(request);
  const deviceId = request.headers.get('x-tux-device-id')?.trim() ?? '';
  if (token === null || !UUID_PATTERN.test(deviceId)) {
    return jsonResponse(401, { error: 'device_authentication_required' });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const publishableKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !publishableKey || !serviceRoleKey) {
    return jsonResponse(500, { error: 'receiver_not_configured' });
  }

  const userClient = createClient(supabaseUrl, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userError } = await userClient.auth.getUser(token);
  if (userError || !userData.user) {
    return jsonResponse(401, { error: 'invalid_access_token' });
  }

  let body: UnknownRecord | null = null;
  try {
    body = object(await request.json());
  } catch {
    return jsonResponse(400, { error: 'invalid_json' });
  }
  if (body === null) return jsonResponse(400, { error: 'invalid_reward_request' });

  const action = body['action'];
  const shopId = stringValue(body['shopId']);
  if (shopId === null || !UUID_PATTERN.test(shopId)) {
    return jsonResponse(400, { error: 'invalid_shop_id' });
  }

  const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let rpcName: string;
  let parameters: Record<string, unknown>;

  if (action === 'RESERVE') {
    const checkoutIntentId = stringValue(body['checkoutIntentId']);
    const promotionId = nullableString(body['promotionId']);
    const channel = body['channel'];
    const loyaltyPointsToRedeem = body['loyaltyPointsToRedeem'];
    const items = body['items'];

    if (
      checkoutIntentId === null ||
      checkoutIntentId.length > 200 ||
      (promotionId !== null && !UUID_PATTERN.test(promotionId)) ||
      (channel !== 'POS' && channel !== 'ONLINE') ||
      typeof loyaltyPointsToRedeem !== 'number' ||
      !Number.isSafeInteger(loyaltyPointsToRedeem) ||
      loyaltyPointsToRedeem < 0 ||
      !Array.isArray(items) ||
      items.length < 1 ||
      items.length > 200
    ) {
      return jsonResponse(400, { error: 'invalid_reward_request' });
    }

    rpcName = 'reserve_operations_order_rewards_v1';
    parameters = {
      p_auth_user_id: userData.user.id,
      p_device_id: deviceId,
      p_shop_id: shopId,
      p_checkout_intent_id: checkoutIntentId,
      p_customer_phone: nullableString(body['customerPhone']),
      p_promotion_id: promotionId,
      p_loyalty_points: loyaltyPointsToRedeem,
      p_channel: channel,
      p_items: items,
      p_now: new Date().toISOString(),
    };
  } else if (action === 'RELEASE') {
    const reservationId = stringValue(body['reservationId']);
    if (reservationId === null || !UUID_PATTERN.test(reservationId)) {
      return jsonResponse(400, { error: 'invalid_reward_release' });
    }
    rpcName = 'release_operations_order_reward_reservation_v1';
    parameters = {
      p_auth_user_id: userData.user.id,
      p_device_id: deviceId,
      p_shop_id: shopId,
      p_reservation_id: reservationId,
      p_now: new Date().toISOString(),
    };
  } else {
    return jsonResponse(400, { error: 'invalid_reward_action' });
  }

  const { data, error } = await serviceClient.rpc(rpcName, parameters);
  if (error) {
    const message = error.message ?? '';
    if (message.includes('TUX_DEVICE_NOT_AUTHORIZED')) {
      return jsonResponse(403, { error: 'device_not_authorized' });
    }
    console.error('operations-order-rewards RPC failed', error);
    return jsonResponse(500, { error: 'reward_authority_failed' });
  }
  if (object(data) === null) {
    return jsonResponse(502, { error: 'invalid_reward_authority_response' });
  }
  return jsonResponse(200, data);
});
