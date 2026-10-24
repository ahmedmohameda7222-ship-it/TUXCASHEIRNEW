import { describe, expect, it, vi } from 'vitest';
import { instant, type BusinessDayId, type OpenBusinessDay, type ShopId } from '@tux/domain';
import { reconcileCanonicalBusinessDay } from './businessDayPreflight';

const SHOP = '12000000-0000-4000-8000-000000000001' as ShopId;
const OLD = '22000000-0000-4000-8000-000000000001' as BusinessDayId;
const NEW = '22000000-0000-4000-8000-000000000002' as BusinessDayId;
const WORKER = '32000000-0000-4000-8000-000000000001' as OpenBusinessDay['startedByWorkerId'];
function day(id: BusinessDayId, shopId = SHOP): OpenBusinessDay {
  return {
    id,
    shopId,
    status: 'OPEN',
    startedAt: instant('2026-10-10T08:00:00Z'),
    startedByWorkerId: WORKER,
    endedAt: null,
    endedByWorkerId: null,
    lastAllocatedDisplayOrderNo: 12,
  };
}

describe('canonical Business Day reconciliation before PIN transition', () => {
  it('drains locally completed End Day before reading the canonical day', async () => {
    const calls: string[] = [];
    await reconcileCanonicalBusinessDay({
      shopId: SHOP,
      drainLocalOutbox: async () => {
        calls.push('drain');
      },
      getLocalOpenDay: async () => {
        calls.push('local');
        return null;
      },
      getCanonicalState: async () => {
        calls.push('remote');
        return { day: null, openWorkerCount: 0 };
      },
      adoptCanonicalDay: async () => {
        calls.push('adopt');
      },
    });
    expect(calls[0]).toBe('drain');
    expect(calls).not.toContain('adopt');
  });

  it('resumes the existing canonical OPEN day on a fresh browser instead of creating a second day', async () => {
    const adopt = vi.fn(async () => undefined);
    const count = await reconcileCanonicalBusinessDay({
      shopId: SHOP,
      drainLocalOutbox: async () => undefined,
      getLocalOpenDay: async () => null,
      getCanonicalState: async () => ({ day: day(OLD), openWorkerCount: 2 }),
      adoptCanonicalDay: adopt,
    });
    expect(adopt).toHaveBeenCalledWith(day(OLD), null);
    expect(count).toBe(2);
  });

  it('reconciles a mismatched local mock day by explicitly archiving it and adopting canonical identity', async () => {
    const adopt = vi.fn(async () => undefined);
    await reconcileCanonicalBusinessDay({
      shopId: SHOP,
      drainLocalOutbox: async () => undefined,
      getLocalOpenDay: async () => day(NEW),
      getCanonicalState: async () => ({ day: day(OLD), openWorkerCount: 0 }),
      adoptCanonicalDay: adopt,
    });
    expect(adopt).toHaveBeenCalledWith(day(OLD), day(NEW));
  });

  it('does not discard a locally OPEN offline day when the server has no OPEN day yet', async () => {
    const adopt = vi.fn(async () => undefined);
    await reconcileCanonicalBusinessDay({
      shopId: SHOP,
      drainLocalOutbox: async () => undefined,
      getLocalOpenDay: async () => day(NEW),
      getCanonicalState: async () => ({ day: null, openWorkerCount: 0 }),
      adoptCanonicalDay: adopt,
    });
    expect(adopt).not.toHaveBeenCalled();
  });

  it('keeps a matching canonical Business Day without remapping its ID', async () => {
    const adopt = vi.fn(async () => undefined);
    await reconcileCanonicalBusinessDay({
      shopId: SHOP,
      drainLocalOutbox: async () => undefined,
      getLocalOpenDay: async () => day(OLD),
      getCanonicalState: async () => ({ day: day(OLD), openWorkerCount: 1 }),
      adoptCanonicalDay: adopt,
    });
    expect(adopt).not.toHaveBeenCalled();
  });

  it('refuses a canonical response from the wrong branch', async () => {
    await expect(
      reconcileCanonicalBusinessDay({
        shopId: SHOP,
        drainLocalOutbox: async () => undefined,
        getLocalOpenDay: async () => null,
        getCanonicalState: async () => ({
          day: day(OLD, '12000000-0000-4000-8000-000000000002' as ShopId),
          openWorkerCount: 1,
        }),
        adoptCanonicalDay: async () => undefined,
      }),
    ).rejects.toThrow('different shop');
  });

  it('fails closed when the authenticated canonical read is unavailable', async () => {
    await expect(
      reconcileCanonicalBusinessDay({
        shopId: SHOP,
        drainLocalOutbox: async () => undefined,
        getLocalOpenDay: async () => null,
        getCanonicalState: async () => {
          throw new Error('device_not_authorized');
        },
        adoptCanonicalDay: async () => undefined,
      }),
    ).rejects.toThrow('device_not_authorized');
  });
});
