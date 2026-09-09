import {
  parseOnlineOrderIntakeSuccessV1,
  parseOnlineOrderRequestV1,
  type OnlineOrderIntakeSuccessV1,
  type OnlineOrderRequestV1,
} from '@tux/order-intake-contracts';

const orderIntakeUrl = (): string => {
  const explicit = import.meta.env.VITE_ORDER_INTAKE_URL?.trim();
  if (explicit) return explicit;

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim();
  if (!supabaseUrl) {
    throw new Error('order_intake_not_configured');
  }
  return `${supabaseUrl.replace(/\/$/, '')}/functions/v1/order-intake`;
};

export const configuredOrderShopId = (): string => {
  const shopId = import.meta.env.VITE_TUX_SHOP_ID?.trim();
  if (!shopId) throw new Error('order_intake_shop_not_configured');
  return shopId;
};

export async function submitOnlineOrder(
  request: OnlineOrderRequestV1,
  signal?: AbortSignal,
): Promise<OnlineOrderIntakeSuccessV1> {
  const validated = parseOnlineOrderRequestV1(request);
  const response = await fetch(orderIntakeUrl(), {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(validated),
    signal,
  });

  if (!response.ok) {
    throw new Error('order_intake_unavailable');
  }

  return parseOnlineOrderIntakeSuccessV1(await response.json());
}
