import type {
  AdminSessionPrincipal,
  ComponentHealth,
  DeviceSummary,
  HealthState,
  ShopHealth,
} from '@tux/admin-contracts';

import { AdminAuthorizationError, requirePermission } from '../authorization.js';
import type { AdminSupabaseClient } from '../supabaseAdmin.js';

export type OperationsShopEvidence = {
  id: string;
  name: string;
  temporaryClosed: boolean;
  onlineOrdersPaused: boolean;
};

export type OperationsDeviceEvidence = {
  id: string;
  shopId: string;
  label: string;
  active: boolean;
  membershipActive: boolean | null;
  lastSeenAt: string | null;
  configVersion: number | null;
};

export type BusinessDayEvidence = { status: 'OPEN' | 'CLOSED'; observedAt: string };

export type OperationsHealthDependencies = {
  now(): Date;
  loadShop(principal: AdminSessionPrincipal, shopId: string): Promise<OperationsShopEvidence>;
  loadDevices(
    principal: AdminSessionPrincipal,
    shopId: string,
  ): Promise<OperationsDeviceEvidence[]>;
  loadBusinessDay(
    principal: AdminSessionPrincipal,
    shopId: string,
  ): Promise<BusinessDayEvidence | null>;
  loadWhatsAppConfigured(principal: AdminSessionPrincipal, shopId: string): Promise<boolean>;
};

function deviceSummary(row: OperationsDeviceEvidence, now: Date): DeviceSummary {
  const revoked = !row.active;
  const sessionState = revoked
    ? 'REVOKED'
    : row.membershipActive === false
      ? 'EXPIRED'
      : row.membershipActive === true
        ? 'ACTIVE'
        : 'UNKNOWN';
  const validHeartbeat =
    sessionState === 'ACTIVE' && row.lastSeenAt !== null && !Number.isNaN(Date.parse(row.lastSeenAt));
  return {
    id: row.id,
    shopId: row.shopId,
    label: row.label,
    revoked,
    lastSeenAt: row.lastSeenAt,
    observedAt: validHeartbeat ? new Date(row.lastSeenAt!).toISOString() : null,
    sessionState,
    configVersion: row.configVersion === null ? null : String(row.configVersion),
    capabilities: {
      canRename: false,
      canRevoke: false,
      canMoveShop: false,
      canEnroll: false,
      canRefreshConfig: false,
      canTestPrint: false,
    },
  };
}

function deviceHealth(devices: readonly DeviceSummary[], now: Date): ComponentHealth {
  if (devices.length === 0) {
    return { key: 'DEVICES', state: 'ATTENTION', observedAt: null, reason: 'No enrolled devices.', href: '/devices' };
  }
  const active = devices.filter((device) => device.sessionState === 'ACTIVE');
  if (active.length === 0) {
    return { key: 'DEVICES', state: 'ATTENTION', observedAt: null, reason: 'No device has an active authority session.', href: '/devices' };
  }
  const observed = active
    .map((device) => device.observedAt)
    .filter((value): value is string => value !== null)
    .sort()
    .at(-1) ?? null;
  if (observed === null) {
    return { key: 'DEVICES', state: 'UNKNOWN', observedAt: null, reason: 'No device heartbeat has been observed.', href: '/devices' };
  }
  const ageMs = now.getTime() - Date.parse(observed);
  if (ageMs > 5 * 60 * 1_000) {
    return { key: 'DEVICES', state: 'STALE', observedAt: observed, reason: 'Latest device heartbeat is older than five minutes.', href: '/devices' };
  }
  return { key: 'DEVICES', state: 'HEALTHY', observedAt: observed, reason: 'A device heartbeat was observed within five minutes.', href: '/devices' };
}

function overallHealth(components: readonly ComponentHealth[]): HealthState {
  const mandatory = components.filter((component) =>
    ['DEVICES', 'SYNC', 'BUSINESS_DAY', 'ONLINE_ORDERS'].includes(component.key),
  );
  if (mandatory.some((component) => component.state === 'CRITICAL')) return 'CRITICAL';
  if (mandatory.some((component) => component.state === 'ATTENTION' || component.state === 'STALE')) return 'ATTENTION';
  if (mandatory.some((component) => component.state === 'UNKNOWN' || component.state === 'NOT_CONFIGURED')) return 'UNKNOWN';
  return 'HEALTHY';
}

export function createOperationsHealthService(deps: OperationsHealthDependencies) {
  async function devices(shopId: string, principal: AdminSessionPrincipal): Promise<DeviceSummary[]> {
    requirePermission(principal, 'devices.view', shopId);
    await deps.loadShop(principal, shopId);
    const now = deps.now();
    return (await deps.loadDevices(principal, shopId))
      .filter((row) => row.shopId === shopId)
      .map((row) => deviceSummary(row, now))
      .sort((left, right) => left.label.localeCompare(right.label) || left.id.localeCompare(right.id));
  }

  return {
    devices,
    async device(shopId: string, deviceId: string, principal: AdminSessionPrincipal): Promise<DeviceSummary> {
      const match = (await devices(shopId, principal)).find((device) => device.id === deviceId);
      if (!match) throw new Error('device_not_found');
      return match;
    },
    async summary(shopId: string, principal: AdminSessionPrincipal): Promise<ShopHealth> {
      requirePermission(principal, 'devices.view', shopId);
      const now = deps.now();
      const shop = await deps.loadShop(principal, shopId);
      const [rawDevices, businessDay, whatsappConfigured] = await Promise.all([
        deps.loadDevices(principal, shopId),
        deps.loadBusinessDay(principal, shopId),
        deps.loadWhatsAppConfigured(principal, shopId),
      ]);
      const scopedDevices = rawDevices
        .filter((row) => row.shopId === shopId)
        .map((row) => deviceSummary(row, now));
      const components: ComponentHealth[] = [
        deviceHealth(scopedDevices, now),
        {
          key: 'SYNC',
          state: 'UNKNOWN',
          observedAt: null,
          reason: 'No server-side sync heartbeat source is configured.',
          href: null,
        },
        businessDay
          ? {
              key: 'BUSINESS_DAY',
              state: businessDay.status === 'OPEN' ? 'HEALTHY' : 'ATTENTION',
              observedAt: new Date(businessDay.observedAt).toISOString(),
              reason: businessDay.status === 'OPEN' ? 'Business day is open.' : 'Latest business day is closed.',
              href: '/finance/end-day',
            }
          : {
              key: 'BUSINESS_DAY',
              state: 'ATTENTION',
              observedAt: null,
              reason: 'No business day is available.',
              href: '/finance/end-day',
            },
        {
          key: 'ONLINE_ORDERS',
          state: shop.temporaryClosed || shop.onlineOrdersPaused ? 'ATTENTION' : 'HEALTHY',
          observedAt: now.toISOString(),
          reason: shop.temporaryClosed
            ? 'Shop is temporarily closed.'
            : shop.onlineOrdersPaused
              ? 'Online orders are paused.'
              : 'Online ordering is enabled in canonical shop settings.',
          href: '/settings',
        },
        {
          key: 'PRINTERS',
          state: 'NOT_CONFIGURED',
          observedAt: null,
          reason: 'Server-side printer telemetry is not configured.',
          href: null,
        },
        {
          key: 'WHATSAPP',
          state: whatsappConfigured ? 'UNKNOWN' : 'NOT_CONFIGURED',
          observedAt: null,
          reason: whatsappConfigured
            ? 'Channel is configured; provider health telemetry is unavailable.'
            : 'WhatsApp is not configured for this shop.',
          href: '/whatsapp',
        },
      ];
      return {
        shopId,
        shopName: shop.name,
        asOf: now.toISOString(),
        overall: overallHealth(components),
        components,
      };
    },
  };
}

async function assertBusinessShop(
  client: AdminSupabaseClient,
  principal: AdminSessionPrincipal,
  shopId: string,
): Promise<void> {
  const rows = await client.select<Array<{ shop_id: string }>>(
    'business_shops',
    new URLSearchParams({
      select: 'shop_id',
      business_id: `eq.${principal.businessId}`,
      shop_id: `eq.${shopId}`,
      limit: '1',
    }),
  );
  if (rows.length !== 1 || rows[0]?.shop_id !== shopId) {
    throw new AdminAuthorizationError('shop_forbidden');
  }
}

export function createSupabaseOperationsHealthDependencies(
  client: AdminSupabaseClient,
  now: () => Date = () => new Date(),
): OperationsHealthDependencies {
  return {
    now,
    async loadShop(principal, shopId) {
      await assertBusinessShop(client, principal, shopId);
      const rows = await client.select<
        Array<{ id: string; name: string; temporary_closed: boolean; online_orders_paused: boolean }>
      >(
        'shops',
        new URLSearchParams({
          select: 'id,name,temporary_closed,online_orders_paused',
          id: `eq.${shopId}`,
          limit: '1',
        }),
      );
      const row = rows[0];
      if (!row || row.id !== shopId) throw new AdminAuthorizationError('shop_forbidden');
      return {
        id: row.id,
        name: row.name,
        temporaryClosed: row.temporary_closed,
        onlineOrdersPaused: row.online_orders_paused,
      };
    },
    async loadDevices(principal, shopId) {
      await assertBusinessShop(client, principal, shopId);
      const [rows, memberships, versions] = await Promise.all([
        client.select<Array<{ id: string; shop_id: string; label: string; active: boolean; auth_user_id: string | null; last_seen_at: string | null }>>(
          'devices',
          new URLSearchParams({
            select: 'id,shop_id,label,active,auth_user_id,last_seen_at',
            shop_id: `eq.${shopId}`,
            order: 'label.asc,id.asc',
          }),
        ),
        client.select<Array<{ auth_user_id: string; active: boolean }>>(
          'shop_memberships',
          new URLSearchParams({
            select: 'auth_user_id,active',
            shop_id: `eq.${shopId}`,
            role: 'eq.OPERATIONS_DEVICE',
          }),
        ),
        client.select<Array<{ version: number }>>(
          'operations_configuration_snapshots',
          new URLSearchParams({ select: 'version', shop_id: `eq.${shopId}`, order: 'version.desc', limit: '1' }),
        ),
      ]);
      const membership = new Map(memberships.map((row) => [row.auth_user_id, row.active]));
      const version = versions[0]?.version ?? null;
      return rows
        .filter((row) => row.shop_id === shopId)
        .map((row) => ({
          id: row.id,
          shopId: row.shop_id,
          label: row.label,
          active: row.active,
          membershipActive: row.auth_user_id === null ? null : (membership.get(row.auth_user_id) ?? false),
          lastSeenAt: row.last_seen_at,
          configVersion: version,
        }));
    },
    async loadBusinessDay(principal, shopId) {
      await assertBusinessShop(client, principal, shopId);
      const rows = await client.select<Array<{ status: 'OPEN' | 'CLOSED'; started_at: string; ended_at: string | null }>>(
        'business_days',
        new URLSearchParams({ select: 'status,started_at,ended_at', shop_id: `eq.${shopId}`, order: 'started_at.desc', limit: '1' }),
      );
      const row = rows[0];
      return row ? { status: row.status, observedAt: row.ended_at ?? row.started_at } : null;
    },
    async loadWhatsAppConfigured(principal, shopId) {
      await assertBusinessShop(client, principal, shopId);
      const rows = await client.select<Array<{ id: string; shop_id: string }>>(
        'whatsapp_channels',
        new URLSearchParams({ select: 'id,shop_id', shop_id: `eq.${shopId}`, active: 'eq.true', limit: '1' }),
      );
      return rows.some((row) => row.shop_id === shopId);
    },
  };
}
