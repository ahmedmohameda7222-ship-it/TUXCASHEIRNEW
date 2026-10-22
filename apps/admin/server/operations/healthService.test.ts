import type { AdminSessionPrincipal } from '@tux/admin-contracts';
import { describe, expect, it } from 'vitest';

import { AdminAuthorizationError } from '../authorization.js';
import { createOperationsHealthService, type OperationsHealthDependencies } from './healthService.js';

const SHOP_A = '11111111-1111-4111-8111-111111111111';
const SHOP_B = '22222222-2222-4222-8222-222222222222';
const DEVICE_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const DEVICE_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const NOW = new Date('2026-10-22T12:00:00.000Z');

const principal: AdminSessionPrincipal = {
  employeeId: '33333333-3333-4333-8333-333333333333',
  businessId: '44444444-4444-4444-8444-444444444444',
  role: 'ADMIN',
  permissions: ['devices.view'],
  shopIds: [SHOP_A],
};

function dependencies(overrides: Partial<OperationsHealthDependencies> = {}): OperationsHealthDependencies {
  return {
    now: () => NOW,
    loadShop: async (_principal, shopId) => ({
      id: shopId,
      name: shopId === SHOP_A ? 'Downtown' : 'Other',
      temporaryClosed: false,
      onlineOrdersPaused: false,
    }),
    loadDevices: async (_principal, shopId) => [
      {
        id: shopId === SHOP_A ? DEVICE_A : DEVICE_B,
        shopId,
        label: 'Front counter tablet',
        active: true,
        membershipActive: true,
        lastSeenAt: null,
        configVersion: 7,
      },
    ],
    loadBusinessDay: async () => ({ status: 'OPEN', observedAt: '2026-10-22T08:00:00.000Z' }),
    loadWhatsAppConfigured: async () => false,
    ...overrides,
  };
}

describe('operations health service', () => {
  it('uses UNKNOWN when an active device has no legitimate heartbeat', async () => {
    const result = await createOperationsHealthService(dependencies()).summary(SHOP_A, principal);
    expect(result.components.find((item) => item.key === 'DEVICES')).toMatchObject({
      state: 'UNKNOWN',
      observedAt: null,
    });
    expect(result.overall).toBe('UNKNOWN');
  });

  it('uses STALE after five minutes from an actual device heartbeat', async () => {
    const result = await createOperationsHealthService(
      dependencies({
        loadDevices: async () => [
          {
            id: DEVICE_A,
            shopId: SHOP_A,
            label: 'Register',
            active: true,
            membershipActive: true,
            lastSeenAt: '2026-10-22T11:54:59.999Z',
            configVersion: null,
          },
        ],
      }),
    ).summary(SHOP_A, principal);
    expect(result.components.find((item) => item.key === 'DEVICES')?.state).toBe('STALE');
    expect(result.overall).toBe('ATTENTION');
  });

  it('never represents revoked or expired sessions as connected', async () => {
    const service = createOperationsHealthService(
      dependencies({
        loadDevices: async () => [
          { id: DEVICE_A, shopId: SHOP_A, label: 'Revoked', active: false, membershipActive: true, lastSeenAt: NOW.toISOString(), configVersion: 2 },
          { id: DEVICE_B, shopId: SHOP_A, label: 'Expired', active: true, membershipActive: false, lastSeenAt: NOW.toISOString(), configVersion: 2 },
        ],
      }),
    );
    const devices = await service.devices(SHOP_A, principal);
    expect(devices.map((device) => device.sessionState).sort()).toEqual(['EXPIRED', 'REVOKED']);
    expect(devices.every((device) => device.observedAt === null)).toBe(true);
    expect(
      devices.every((device) =>
        Object.values(device.capabilities).every((value) => value === false),
      ),
    ).toBe(true);
  });

  it('is deterministic across process timezones and ignores optional WhatsApp absence', async () => {
    const health = await createOperationsHealthService(
      dependencies({
        loadDevices: async () => [{ id: DEVICE_A, shopId: SHOP_A, label: 'Register', active: true, membershipActive: true, lastSeenAt: '2026-10-22T11:59:00.000Z', configVersion: 8 }],
      }),
    ).summary(SHOP_A, principal);
    expect(health.asOf).toBe('2026-10-22T12:00:00.000Z');
    expect(health.components.find((item) => item.key === 'WHATSAPP')?.state).toBe('NOT_CONFIGURED');
    expect(health.components.find((item) => item.key === 'SYNC')?.state).toBe('UNKNOWN');
    expect(health.overall).toBe('UNKNOWN');
  });

  it('denies Shop B and never calls data loaders for a denied shop', async () => {
    let called = false;
    const service = createOperationsHealthService(dependencies({ loadShop: async () => { called = true; throw new Error('leak'); } }));
    await expect(service.summary(SHOP_B, principal)).rejects.toBeInstanceOf(AdminAuthorizationError);
    expect(called).toBe(false);
  });

  it('does not return a cross-shop device detail even when a dependency drifts', async () => {
    const service = createOperationsHealthService(
      dependencies({
        loadDevices: async () => [{ id: DEVICE_B, shopId: SHOP_B, label: 'Other shop', active: true, membershipActive: true, lastSeenAt: NOW.toISOString(), configVersion: 1 }],
      }),
    );
    await expect(service.device(SHOP_A, DEVICE_B, principal)).rejects.toThrow('device_not_found');
  });

  it('degrades health only from canonical evidence and never leaks denied counts', async () => {
    const health = await createOperationsHealthService(
      dependencies({
        loadDevices: async () => [],
        loadBusinessDay: async () => null,
      }),
    ).summary(SHOP_A, principal);
    expect(health.components.find((item) => item.key === 'DEVICES')?.state).toBe('ATTENTION');
    expect(health.components.find((item) => item.key === 'BUSINESS_DAY')?.state).toBe('ATTENTION');
    expect(JSON.stringify(health)).not.toContain(SHOP_B);
  });
});
