import { describe, expect, it, vi } from 'vitest';
import type { OperationsSessionResult } from '@tux/application';
import type { ShopId } from '@tux/domain';
import { fenceStaleBrowserSession } from './browserSessionScope';

const A = '10000000-0000-4000-8000-000000000001' as ShopId;
const B = '10000000-0000-4000-8000-000000000002' as ShopId;
const ACTIVE = {
  ok: true,
  value: {
    status: 'ACTIVE',
    shopId: A,
    businessDayId: '20000000-0000-4000-8000-000000000001',
    businessDayStartedAt: '2026-10-23T10:00:00.000Z',
    operator: { id: '30000000-0000-4000-8000-000000000001', displayName: 'Worker A' },
  },
} as OperationsSessionResult;

describe('authenticated browser branch recovery', () => {
  it('keeps a local active session only when the remote cookie matches that shop', async () => {
    const fence = vi.fn();
    const result = await fenceStaleBrowserSession(ACTIVE, async () => A, fence);
    expect(result).toBe(ACTIVE);
    expect(fence).not.toHaveBeenCalled();
  });

  it('closes cached Shop A session when the device cookie belongs to Shop B', async () => {
    const closed = { ok: true, value: { status: 'NO_ACTIVE_DAY', shopId: A } } as OperationsSessionResult;
    const fence = vi.fn().mockResolvedValue(closed);
    const result = await fenceStaleBrowserSession(ACTIVE, async () => B, fence);
    expect(result).toBe(closed);
    expect(fence).toHaveBeenCalledTimes(1);
  });

  it('fails closed without an authorized remote session, including network failures', async () => {
    const closed = { ok: true, value: { status: 'NO_ACTIVE_DAY', shopId: A } } as OperationsSessionResult;
    const close = vi.fn().mockResolvedValue(closed);
    expect(await fenceStaleBrowserSession(ACTIVE, async () => null, close)).toBe(closed);
    expect(await fenceStaleBrowserSession(ACTIVE, async () => { throw new Error('offline'); }, close)).toBe(closed);
    expect(close).toHaveBeenCalledTimes(2);
  });

  it('does not contact the server for signed-out or invalid local sessions', async () => {
    const local = { ok: true, value: { status: 'NO_ACTIVE_DAY', shopId: A } } as OperationsSessionResult;
    const remote = vi.fn();
    const close = vi.fn();
    expect(await fenceStaleBrowserSession(local, remote, close)).toBe(local);
    expect(remote).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
  });
});
