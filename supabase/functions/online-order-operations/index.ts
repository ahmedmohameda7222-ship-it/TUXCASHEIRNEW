import { createClient } from '@supabase/supabase-js';
import {
  OnlineOrderOperationsStoreError,
  handleOnlineOrderOperationsRequest,
  type OnlineOrderOperationsStore,
} from './online-order-operations.ts';

function storeError(message: string): OnlineOrderOperationsStoreError {
  if (message.includes('TUX_DEVICE_NOT_AUTHORIZED')) {
    return new OnlineOrderOperationsStoreError('FORBIDDEN');
  }
  if (message.includes('TUX_ONLINE_ORDER_NOT_FOUND')) {
    return new OnlineOrderOperationsStoreError('NOT_FOUND');
  }
  if (
    message.includes('TUX_ONLINE_ORDER_ALREADY_PROCESSING') ||
    message.includes('TUX_ONLINE_ORDER_ALREADY_RESOLVED') ||
    message.includes('TUX_ONLINE_ORDER_CLAIM_MISMATCH') ||
    message.includes('TUX_ONLINE_ORDER_REJECTION_CONFLICT')
  ) {
    return new OnlineOrderOperationsStoreError('CONFLICT');
  }
  if (
    message.includes('TUX_ONLINE_ORDER_LIMIT_INVALID') ||
    message.includes('TUX_ONLINE_ORDER_REJECTION_REASON_INVALID')
  ) {
    return new OnlineOrderOperationsStoreError('INVALID');
  }
  return new OnlineOrderOperationsStoreError('UNAVAILABLE');
}

Deno.serve(async (request) => {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const publishableKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !publishableKey || !serviceRoleKey) {
    return new Response(JSON.stringify({ error: 'receiver_not_configured' }), {
      status: 500,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    });
  }

  const userClient = createClient(supabaseUrl, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const rpc = async (name: string, parameters: Record<string, unknown>): Promise<unknown> => {
    const { data, error } = await serviceClient.rpc(name, parameters);
    if (error) throw storeError(error.message ?? '');
    return data;
  };

  const store: OnlineOrderOperationsStore = {
    list: ({ authUserId, deviceId, limit }) =>
      rpc('list_tux_online_order_requests_v1', {
        p_auth_user_id: authUserId,
        p_device_id: deviceId,
        p_limit: limit,
      }),
    claim: ({ authUserId, deviceId, requestId }) =>
      rpc('claim_tux_online_order_request_v1', {
        p_auth_user_id: authUserId,
        p_device_id: deviceId,
        p_request_id: requestId,
      }),
    release: ({ authUserId, deviceId, requestId, processingOrderId }) =>
      rpc('release_tux_online_order_request_claim_v1', {
        p_auth_user_id: authUserId,
        p_device_id: deviceId,
        p_request_id: requestId,
        p_processing_order_id: processingOrderId,
      }),
    reject: ({ authUserId, deviceId, requestId, processingOrderId, reason }) =>
      rpc('reject_tux_online_order_request_v1', {
        p_auth_user_id: authUserId,
        p_device_id: deviceId,
        p_request_id: requestId,
        p_processing_order_id: processingOrderId,
        p_reason: reason,
      }),
  };

  return handleOnlineOrderOperationsRequest(request, {
    authenticate: async (token) => {
      const { data, error } = await userClient.auth.getUser(token);
      return error || !data.user ? null : data.user.id;
    },
    store,
  });
});
