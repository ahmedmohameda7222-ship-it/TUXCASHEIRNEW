import { describe, expect, it, vi } from 'vitest';
import type { BusinessDayId, ShopId } from '@tux/domain';
import { assertCanonicalBusinessDayReady } from './businessDayPreflight';

const SHOP = '12000000-0000-4000-8000-000000000001' as ShopId;
const OLD = '22000000-0000-4000-8000-000000000001' as BusinessDayId;
const NEW = '22000000-0000-4000-8000-000000000002' as BusinessDayId;

describe('canonical Business Day preflight', () => {
  it('drains locally completed End Day before admitting a new session', async () => {
    let remoteDay: BusinessDayId | null = OLD;
    const drain = vi.fn(async () => {
      remoteDay = null;
    });
    await assertCanonicalBusinessDayReady({
      shopId: SHOP,
      drainLocalOutbox: drain,
      getLocalOpenDayId: async () => null,
      getCanonicalOpenDayId: async () => remoteDay,
    });
    expect(drain).toHaveBeenCalledTimes(1);
  });

  it('blocks an Incognito session while another browser owns the open day', async () => {
    await expect(
      assertCanonicalBusinessDayReady({
        shopId: SHOP,
        drainLocalOutbox: async () => undefined,
        getLocalOpenDayId: async () => null,
        getCanonicalOpenDayId: async () => OLD,
      }),
    ).rejects.toThrow('still OPEN in Supabase');
  });

  it('keeps mismatched local day identities rather than silently remapping', async () => {
    await expect(
      assertCanonicalBusinessDayReady({
        shopId: SHOP,
        drainLocalOutbox: async () => undefined,
        getLocalOpenDayId: async () => NEW,
        getCanonicalOpenDayId: async () => OLD,
      }),
    ).rejects.toThrow(OLD);
  });

  it('rejects a locally OPEN day when its canonical OPEN identity is absent', async () => {
    await expect(
      assertCanonicalBusinessDayReady({
        shopId: SHOP,
        drainLocalOutbox: async () => undefined,
        getLocalOpenDayId: async () => OLD,
        getCanonicalOpenDayId: async () => null,
      }),
    ).rejects.toThrow('has no matching OPEN day');
  });

  it('accepts a matching authenticated day after reconnection', async () => {
    await expect(
      assertCanonicalBusinessDayReady({
        shopId: SHOP,
        drainLocalOutbox: async () => undefined,
        getLocalOpenDayId: async () => OLD,
        getCanonicalOpenDayId: async (shop) => {
          expect(shop).toBe(SHOP);
          return OLD;
        },
      }),
    ).resolves.toBeUndefined();
  });

  it('fails closed on canonical read errors after worker auth rather than inventing a day', async () => {
    await expect(
      assertCanonicalBusinessDayReady({
        shopId: SHOP,
        drainLocalOutbox: async () => undefined,
        getLocalOpenDayId: async () => null,
        getCanonicalOpenDayId: async () => {
          throw new Error('device_not_authorized');
        },
      }),
    ).rejects.toThrow('device_not_authorized');
  });
});
