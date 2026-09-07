import { parseEntityId, type DeviceId, type ShopId } from '@tux/domain';

export interface OperationsDeviceAuthority {
  readonly shopId: ShopId;
  readonly deviceId: DeviceId;
}

export type OperationsDeviceAuthorityErrorCode = 'DEVICE_AUTH_INVALID' | 'REMOTE_UNAVAILABLE';

export class OperationsDeviceAuthorityError extends Error {
  constructor(
    readonly code: OperationsDeviceAuthorityErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'OperationsDeviceAuthorityError';
  }
}

function invalid(message: string): never {
  throw new OperationsDeviceAuthorityError('DEVICE_AUTH_INVALID', message);
}

function unavailable(message: string): never {
  throw new OperationsDeviceAuthorityError('REMOTE_UNAVAILABLE', message);
}

function projectOrigin(raw: string): string {
  try {
    const url = new URL(raw.trim());
    if (url.protocol !== 'https:' || url.username !== '' || url.password !== '') {
      unavailable('Invalid Supabase project URL.');
    }
    return url.origin;
  } catch (error) {
    if (error instanceof OperationsDeviceAuthorityError) throw error;
    return unavailable('Invalid Supabase project URL.');
  }
}

async function readJson(
  fetcher: typeof fetch,
  url: string,
  headers: Readonly<Record<string, string>>,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetcher(url, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return unavailable('Device authority backend is unavailable.');
  }
  if (response.status === 401 || response.status === 403) {
    invalid('Device authority is invalid.');
  }
  if (!response.ok) unavailable('Device authority backend rejected the request.');
  try {
    return await response.json();
  } catch {
    return unavailable('Device authority backend returned invalid JSON.');
  }
}

export async function resolveOperationsDeviceAuthority(input: {
  readonly projectUrl: string;
  readonly publishableKey: string;
  readonly accessToken: string;
  readonly deviceId: DeviceId;
  readonly fetcher?: typeof fetch;
}): Promise<OperationsDeviceAuthority> {
  const origin = projectOrigin(input.projectUrl);
  const fetcher = input.fetcher ?? fetch;
  const headers = {
    apikey: input.publishableKey,
    authorization: `Bearer ${input.accessToken}`,
    accept: 'application/json',
  };

  const user = await readJson(fetcher, `${origin}/auth/v1/user`, headers);
  if (
    typeof user !== 'object' ||
    user === null ||
    Array.isArray(user) ||
    typeof (user as Record<string, unknown>)['id'] !== 'string' ||
    (user as Record<string, unknown>)['id'] === ''
  ) {
    unavailable('Invalid authenticated user response.');
  }

  const devices = await readJson(
    fetcher,
    `${origin}/rest/v1/devices?id=eq.${encodeURIComponent(input.deviceId)}&active=eq.true&select=id,shop_id&limit=2`,
    headers,
  );
  if (!Array.isArray(devices)) unavailable('Invalid device authority response.');
  if (devices.length !== 1) invalid('Active device authority is missing or ambiguous.');
  const device = devices[0];
  if (typeof device !== 'object' || device === null || Array.isArray(device)) {
    unavailable('Invalid device authority row.');
  }
  const deviceRow = device as Record<string, unknown>;
  if (deviceRow['id'] !== input.deviceId || typeof deviceRow['shop_id'] !== 'string') {
    invalid('Device authority does not match the enrolled device.');
  }

  let shopId: ShopId;
  try {
    shopId = parseEntityId<ShopId>(deviceRow['shop_id']);
  } catch {
    return unavailable('Invalid device shop identity.');
  }

  const memberships = await readJson(
    fetcher,
    `${origin}/rest/v1/shop_memberships?shop_id=eq.${encodeURIComponent(shopId)}&active=eq.true&role=eq.OPERATIONS_DEVICE&select=shop_id,role&limit=2`,
    headers,
  );
  if (!Array.isArray(memberships)) unavailable('Invalid membership authority response.');
  if (memberships.length !== 1) invalid('OPERATIONS_DEVICE membership is missing or ambiguous.');
  const membership = memberships[0];
  if (typeof membership !== 'object' || membership === null || Array.isArray(membership)) {
    unavailable('Invalid membership authority row.');
  }
  const membershipRow = membership as Record<string, unknown>;
  if (membershipRow['shop_id'] !== shopId || membershipRow['role'] !== 'OPERATIONS_DEVICE') {
    invalid('OPERATIONS_DEVICE membership is invalid.');
  }
  return { shopId, deviceId: input.deviceId };
}
