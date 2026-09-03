from pathlib import Path

resolver = r'''import { parseEntityId, type DeviceId, type ShopId } from '@tux/domain';

export interface OperationsDeviceAuthority {
  readonly shopId: ShopId;
  readonly deviceId: DeviceId;
}

export type OperationsDeviceAuthorityErrorCode = 'DEVICE_AUTH_INVALID' | 'REMOTE_UNAVAILABLE';

export class OperationsDeviceAuthorityError extends Error {
  constructor(readonly code: OperationsDeviceAuthorityErrorCode, message: string) {
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
'''
Path('server/operationsDeviceAuthority.ts').write_text(resolver)

resolver_test = r'''import { parseEntityId, type DeviceId, type ShopId } from '@tux/domain';
import { describe, expect, it, vi } from 'vitest';
import { resolveOperationsDeviceAuthority } from './operationsDeviceAuthority';

const shopId = parseEntityId<ShopId>('11111111-1111-4111-8111-111111111111');
const deviceId = parseEntityId<DeviceId>('22222222-2222-4222-8222-222222222222');

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function input(fetcher: typeof fetch) {
  return {
    projectUrl: 'https://example.supabase.co',
    publishableKey: 'publishable',
    accessToken: 'access-token',
    deviceId,
    fetcher,
  } as const;
}

describe('resolveOperationsDeviceAuthority', () => {
  it('derives shopId from the active RLS-visible device and active OPERATIONS_DEVICE membership', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json(200, { id: 'user-1' }))
      .mockResolvedValueOnce(json(200, [{ id: deviceId, shop_id: shopId }]))
      .mockResolvedValueOnce(json(200, [{ shop_id: shopId, role: 'OPERATIONS_DEVICE' }]));
    await expect(resolveOperationsDeviceAuthority(input(fetcher))).resolves.toEqual({ shopId, deviceId });
    expect(String(fetcher.mock.calls[1]?.[0])).toContain(`/rest/v1/devices?id=eq.${deviceId}`);
    expect(String(fetcher.mock.calls[2]?.[0])).toContain(`shop_id=eq.${shopId}`);
    for (const [, init] of fetcher.mock.calls) {
      expect(init?.headers).toMatchObject({
        apikey: 'publishable',
        authorization: 'Bearer access-token',
        accept: 'application/json',
      });
    }
  });

  it.each([401, 403])('treats authenticated-user HTTP %s as DEVICE_AUTH_INVALID', async (status) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(json(status, { error: 'invalid' }));
    await expect(resolveOperationsDeviceAuthority(input(fetcher))).rejects.toMatchObject({ code: 'DEVICE_AUTH_INVALID' });
  });

  it('rejects zero or multiple active device rows authoritatively', async () => {
    for (const rows of [[], [{ id: deviceId, shop_id: shopId }, { id: deviceId, shop_id: shopId }]]) {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(json(200, { id: 'user-1' })).mockResolvedValueOnce(json(200, rows));
      await expect(resolveOperationsDeviceAuthority(input(fetcher))).rejects.toMatchObject({ code: 'DEVICE_AUTH_INVALID' });
    }
  });

  it('rejects inactive/wrong membership authority', async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(json(200, { id: 'user-1' }))
      .mockResolvedValueOnce(json(200, [{ id: deviceId, shop_id: shopId }]))
      .mockResolvedValueOnce(json(200, []));
    await expect(resolveOperationsDeviceAuthority(input(fetcher))).rejects.toMatchObject({ code: 'DEVICE_AUTH_INVALID' });
  });

  it('classifies transport and upstream 5xx failures as REMOTE_UNAVAILABLE', async () => {
    await expect(resolveOperationsDeviceAuthority(input(vi.fn<typeof fetch>().mockRejectedValueOnce(new Error('offline'))))).rejects.toMatchObject({ code: 'REMOTE_UNAVAILABLE' });
    await expect(resolveOperationsDeviceAuthority(input(vi.fn<typeof fetch>().mockResolvedValueOnce(json(503, {}))))).rejects.toMatchObject({ code: 'REMOTE_UNAVAILABLE' });
  });

  it('classifies malformed authority responses as REMOTE_UNAVAILABLE', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(json(200, {}));
    await expect(resolveOperationsDeviceAuthority(input(fetcher))).rejects.toMatchObject({ code: 'REMOTE_UNAVAILABLE' });
  });
});
'''
Path('server/operationsDeviceAuthority.test.ts').write_text(resolver_test)

p = Path('server/supabaseGateway.ts')
s = p.read_text()
s = s.replace('interface SupabaseServerConfig {', 'export interface SupabaseServerConfig {', 1)
old = '''export function requireSameOrigin(request: GatewayRequest, response: GatewayResponse): boolean {
  const origin = firstHeader(request.headers.origin);
  if (origin.length === 0) return true;

  const forwardedHost = firstHeader(request.headers['x-forwarded-host']);
  const host = (forwardedHost || firstHeader(request.headers.host)).split(',')[0]?.trim() ?? '';
  if (host.length === 0) {
    sendJson(response, 403, { error: 'origin_not_allowed' });
    return false;
  }

  try {
    if (new URL(origin).host !== host) {
      sendJson(response, 403, { error: 'origin_not_allowed' });
      return false;
    }
    return true;
  } catch {
    sendJson(response, 403, { error: 'origin_not_allowed' });
    return false;
  }
}
'''
new = '''export function requireSameOrigin(request: GatewayRequest, response: GatewayResponse): boolean {
  const origin = firstHeader(request.headers.origin);
  if (origin.length === 0) return true;

  const forwardedHost = firstHeader(request.headers['x-forwarded-host']);
  const host = (forwardedHost || firstHeader(request.headers.host)).split(',')[0]?.trim() ?? '';
  if (host.length === 0) {
    sendJson(response, 403, { error: 'origin_not_allowed' });
    return false;
  }

  try {
    const originUrl = new URL(origin);
    if (originUrl.host !== host) {
      sendJson(response, 403, { error: 'origin_not_allowed' });
      return false;
    }
    const forwardedProto = firstHeader(request.headers['x-forwarded-proto'])
      .split(',')[0]
      ?.trim()
      .toLowerCase() ?? '';
    if (forwardedProto.length > 0 && originUrl.protocol !== `${forwardedProto}:`) {
      sendJson(response, 403, { error: 'origin_not_allowed' });
      return false;
    }
    return true;
  } catch {
    sendJson(response, 403, { error: 'origin_not_allowed' });
    return false;
  }
}
'''
assert old in s
p.write_text(s.replace(old, new, 1))

p = Path('server/whatsappOperationsGateway.ts')
s = p.read_text()
s = s.replace("  readJsonBody,\n", "  clearDeviceSession,\n  readJsonBody,\n", 1)
anchor = "import { loadWhatsAppDataServerConfig, loadWhatsAppServerConfig } from './whatsappServerConfig';\n"
addition = "import {\n  OperationsDeviceAuthorityError,\n  resolveOperationsDeviceAuthority,\n  type OperationsDeviceAuthority,\n} from './operationsDeviceAuthority';\n"
assert anchor in s
s = s.replace(anchor, anchor + addition, 1)
old = '''export interface WhatsAppOperationsDependencyFactory {
  createRepository(): WhatsAppOperationsRepository;
  createChannelResolver(): WhatsAppChannelResolver;
  createProviderGateway(): WhatsAppProviderGateway;
  now(): Date;
}
'''
new = '''export interface WhatsAppOperationsDependencyFactory {
  createRepository(): WhatsAppOperationsRepository;
  createChannelResolver(): WhatsAppChannelResolver;
  createProviderGateway(): WhatsAppProviderGateway;
  resolveDeviceAuthority(input: {
    readonly projectUrl: string;
    readonly publishableKey: string;
    readonly accessToken: string;
    readonly deviceId: DeviceId;
  }): Promise<OperationsDeviceAuthority>;
  now(): Date;
}
'''
assert old in s
s = s.replace(old, new, 1)
old = '''  createProviderGateway() {
    const config = loadWhatsAppServerConfig();
    return createWhatsAppProviderGateway({
      graphVersion: config.graphVersion,
      accessToken: config.accessToken,
    });
  },
  now() {
'''
new = '''  createProviderGateway() {
    const config = loadWhatsAppServerConfig();
    return createWhatsAppProviderGateway({
      graphVersion: config.graphVersion,
      accessToken: config.accessToken,
    });
  },
  resolveDeviceAuthority(input) {
    return resolveOperationsDeviceAuthority(input);
  },
  now() {
'''
assert old in s
s = s.replace(old, new, 1)
marker = '''export async function handleWhatsAppOperations(
'''
helper = r'''function headerValue(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? '') : (value ?? '');
}

function sendAuthorityError(response: GatewayResponse, error: unknown): void {
  if (error instanceof OperationsDeviceAuthorityError && error.code === 'DEVICE_AUTH_INVALID') {
    sendJson(response, 401, { error: 'device_authority_invalid' });
    return;
  }
  sendJson(response, 503, { error: 'device_authority_unavailable' });
}

async function requestAuthority(
  request: GatewayRequest,
  response: GatewayResponse,
  serverConfig: { readonly projectUrl: string; readonly publishableKey: string },
  dependencies: WhatsAppOperationsDependencyFactory,
): Promise<OperationsDeviceAuthority | null> {
  const hasAuthorization = request.headers.authorization !== undefined;
  const hasDeviceHeader = request.headers['x-tux-device-id'] !== undefined;
  if (hasAuthorization || hasDeviceHeader) {
    const authorization = headerValue(request.headers.authorization).trim();
    const rawDeviceId = headerValue(request.headers['x-tux-device-id']).trim();
    const bearer = /^Bearer\s+(\S+)$/i.exec(authorization)?.[1] ?? null;
    const deviceId = parsedId<DeviceId>(rawDeviceId);
    if (bearer === null || deviceId === null) {
      sendJson(response, 401, { error: 'device_authentication_required' });
      return null;
    }
    try {
      return await dependencies.resolveDeviceAuthority({
        projectUrl: serverConfig.projectUrl,
        publishableKey: serverConfig.publishableKey,
        accessToken: bearer,
        deviceId,
      });
    } catch (error) {
      sendAuthorityError(response, error);
      return null;
    }
  }

  const session = await requireDeviceSession(request, response, serverConfig);
  if (session === null) return null;
  const deviceId = parsedId<DeviceId>(session.deviceId);
  const cookieShopId = parsedId<ShopId>(session.shopId);
  if (deviceId === null || cookieShopId === null) {
    clearDeviceSession(response);
    sendJson(response, 401, { error: 'device_session_invalid' });
    return null;
  }

  let authority: OperationsDeviceAuthority;
  try {
    authority = await dependencies.resolveDeviceAuthority({
      projectUrl: serverConfig.projectUrl,
      publishableKey: serverConfig.publishableKey,
      accessToken: session.accessToken,
      deviceId,
    });
  } catch (error) {
    sendAuthorityError(response, error);
    return null;
  }
  if (authority.shopId !== cookieShopId || authority.deviceId !== deviceId) {
    clearDeviceSession(response);
    sendJson(response, 401, { error: 'device_session_invalid' });
    return null;
  }
  return authority;
}

'''
assert marker in s
s = s.replace(marker, helper + marker, 1)
old = '''  const serverConfig = requireServerConfig(response);
  if (serverConfig === null) return;
  const session = await requireDeviceSession(request, response, serverConfig);
  if (session === null) return;

  let shopId: ShopId;
  let deviceId: DeviceId;
  try {
    shopId = parseEntityId<ShopId>(session.shopId);
    deviceId = parseEntityId<DeviceId>(session.deviceId);
  } catch {
    sendJson(response, 401, { error: 'device_session_invalid' });
    return;
  }

  if (request.method === 'GET') {
    await handleGet(request, response, shopId, dependencies);
    return;
  }
'''
new = '''  const serverConfig = requireServerConfig(response);
  if (serverConfig === null) return;
  const authority = await requestAuthority(request, response, serverConfig, dependencies);
  if (authority === null) return;
  const { shopId, deviceId } = authority;

  if (request.method === 'GET') {
    await handleGet(request, response, shopId, dependencies);
    return;
  }
'''
assert old in s
p.write_text(s.replace(old, new, 1))

p = Path('server/whatsappOperationsGateway.test.ts')
s = p.read_text()
# Add authority resolver error import.
anchor = "import { WhatsAppProviderError } from './whatsappProviderGateway';\n"
addition = "import { OperationsDeviceAuthorityError } from './operationsDeviceAuthority';\n"
assert anchor in s
s = s.replace(anchor, anchor + addition, 1)
# Add default authority mock to existing factory.
old = '''  const providerGateway = {
    sendMessage: vi.fn(async () => ({ providerMessageId: 'wamid.1' })),
  };
  const factory: WhatsAppOperationsDependencyFactory = {
    createRepository: vi.fn(() => repository as unknown as WhatsAppOperationsRepository),
    createChannelResolver: vi.fn(() => channelResolver),
    createProviderGateway: vi.fn(() => providerGateway),
    now: vi.fn(() => new Date('2026-09-02T20:00:00.000Z')),
  };
  return { factory, repository, channelResolver, providerGateway };
'''
new = '''  const providerGateway = {
    sendMessage: vi.fn(async () => ({ providerMessageId: 'wamid.1' })),
  };
  const resolveDeviceAuthority = vi.fn(async () => ({ shopId, deviceId }));
  const factory: WhatsAppOperationsDependencyFactory = {
    createRepository: vi.fn(() => repository as unknown as WhatsAppOperationsRepository),
    createChannelResolver: vi.fn(() => channelResolver),
    createProviderGateway: vi.fn(() => providerGateway),
    resolveDeviceAuthority,
    now: vi.fn(() => new Date('2026-09-02T20:00:00.000Z')),
  };
  return { factory, repository, channelResolver, providerGateway, resolveDeviceAuthority };
'''
assert old in s
s = s.replace(old, new, 1)
append = r'''

describe('unified WhatsApp device authority selection', () => {
  const otherShopId = parseEntityId<ShopId>('00000000-0000-4000-8000-000000000099');

  function desktop(
    req: GatewayRequest,
    authorization: string | null = 'Bearer desktop-access',
    headerDeviceId: string | null = deviceId,
  ): GatewayRequest {
    if (authorization !== null) req.headers.authorization = authorization;
    if (headerDeviceId !== null) req.headers['x-tux-device-id'] = headerDeviceId;
    return req;
  }

  it('A: browser cookie plus derived same shop uses server authority for GET', async () => {
    const deps = createDependencies();
    const result = await execute(request({ method: 'GET', origin: null }), deps.factory);
    expect(result.status()).toBe(200);
    expect(deps.resolveDeviceAuthority).toHaveBeenCalledWith(expect.objectContaining({ deviceId }));
    expect(deps.repository.loadInbox).toHaveBeenCalledWith({ shopId, after: null });
  });

  it('B: browser cookie shop mismatch with derived shop clears/rejects before repository access', async () => {
    const deps = createDependencies();
    deps.resolveDeviceAuthority.mockResolvedValueOnce({ shopId: otherShopId, deviceId });
    const result = await execute(request({ method: 'GET', origin: null }), deps.factory);
    expect(result.status()).toBe(401);
    expect(result.json()).toEqual({ error: 'device_session_invalid' });
    expect(deps.repository.loadInbox).not.toHaveBeenCalled();
  });

  it('C: desktop bearer plus device header works without cookies and uses derived tenant authority', async () => {
    const deps = createDependencies();
    const result = await execute(
      desktop(request({ method: 'GET', origin: null, cookie: null })),
      deps.factory,
    );
    expect(result.status()).toBe(200);
    expect(deps.resolveDeviceAuthority).toHaveBeenCalledWith(
      expect.objectContaining({ accessToken: 'desktop-access', deviceId }),
    );
    expect(deps.repository.loadInbox).toHaveBeenCalledWith({ shopId, after: null });
  });

  it('D: Authorization without device header is 401 and never falls back to valid cookies', async () => {
    const deps = createDependencies();
    const result = await execute(
      desktop(request({ method: 'GET', origin: null }), 'Bearer desktop-access', null),
      deps.factory,
    );
    expect(result.status()).toBe(401);
    expect(deps.repository.loadInbox).not.toHaveBeenCalled();
    expect(deps.resolveDeviceAuthority).not.toHaveBeenCalled();
  });

  it('E: device header without Authorization is 401 and never falls back to valid cookies', async () => {
    const deps = createDependencies();
    const result = await execute(
      desktop(request({ method: 'GET', origin: null }), null, deviceId),
      deps.factory,
    );
    expect(result.status()).toBe(401);
    expect(deps.repository.loadInbox).not.toHaveBeenCalled();
  });

  it('F: malformed desktop bearer with valid cookies is 401 with no browser fallback', async () => {
    const deps = createDependencies();
    const result = await execute(
      desktop(request({ method: 'GET', origin: null }), 'Basic nope', deviceId),
      deps.factory,
    );
    expect(result.status()).toBe(401);
    expect(deps.repository.loadInbox).not.toHaveBeenCalled();
  });

  it('G: valid Electron bearer POST may omit Origin', async () => {
    const deps = createDependencies();
    const result = await execute(
      desktop(
        request({
          body: { action: 'MARK_UNREAD', conversationId },
          origin: null,
          cookie: null,
        }),
      ),
      deps.factory,
    );
    expect(result.status()).toBe(200);
    expect(deps.repository.setConversationState).toHaveBeenCalled();
  });

  it('H: desktop POST still rejects hostile Origin host', async () => {
    const deps = createDependencies();
    const result = await execute(
      desktop(
        request({
          body: { action: 'MARK_UNREAD', conversationId },
          origin: 'https://evil.example',
          cookie: null,
        }),
      ),
      deps.factory,
    );
    expect(result.status()).toBe(403);
    expect(result.json()).toEqual({ error: 'origin_not_allowed' });
  });

  it('I: caller cannot select another tenant after authority resolution', async () => {
    const deps = createDependencies();
    const result = await execute(
      desktop(request({ body: sendBody({ shopId: otherShopId }), cookie: null })),
      deps.factory,
    );
    expect(result.status()).toBe(400);
    expect(deps.resolveDeviceAuthority).toHaveBeenCalledTimes(1);
    expect(deps.repository.resolveCurrentOperator).not.toHaveBeenCalled();
  });

  it('J: authoritative invalidation wins over otherwise valid browser cookies in desktop mode', async () => {
    const deps = createDependencies();
    deps.resolveDeviceAuthority.mockRejectedValueOnce(
      new OperationsDeviceAuthorityError('DEVICE_AUTH_INVALID', 'invalid'),
    );
    const result = await execute(desktop(request({ method: 'GET', origin: null })), deps.factory);
    expect(result.status()).toBe(401);
    expect(result.json()).toEqual({ error: 'device_authority_invalid' });
    expect(deps.repository.loadInbox).not.toHaveBeenCalled();
    expect(deps.factory.createProviderGateway).not.toHaveBeenCalled();
  });

  it('rejects same-host HTTP Origin when forwarded scheme is HTTPS', async () => {
    const deps = createDependencies();
    const req = request({
      body: { action: 'MARK_UNREAD', conversationId },
      origin: 'http://ops.example',
    });
    req.headers['x-forwarded-proto'] = 'https';
    const result = await execute(req, deps.factory);
    expect(result.status()).toBe(403);
  });

  it('allows same-host HTTPS Origin when forwarded scheme is HTTPS', async () => {
    const deps = createDependencies();
    const req = request({
      body: { action: 'MARK_UNREAD', conversationId },
      origin: 'https://ops.example',
    });
    req.headers['x-forwarded-proto'] = 'https';
    const result = await execute(req, deps.factory);
    expect(result.status()).toBe(200);
  });
});
'''
p.write_text(s + append)
