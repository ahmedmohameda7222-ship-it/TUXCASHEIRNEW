import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import {
  instant,
  moneyMinor,
  parseEntityId,
  type BusinessDayId,
  type OrderDraft,
  type ParkedOrderDraft,
  type ShopId,
  type WorkerId,
} from '@tux/domain';
import { IndexedDbOrderDraftStore } from './IndexedDbOrderDraftStore';

const shopId = parseEntityId<ShopId>('11111111-1111-4111-8111-111111111111');
const otherShopId = parseEntityId<ShopId>('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
const dayId = parseEntityId<BusinessDayId>('22222222-2222-4222-8222-222222222222');
const otherDayId = parseEntityId<BusinessDayId>('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
const workerId = parseEntityId<WorkerId>('33333333-3333-4333-8333-333333333333');
const names = new Set<string>();
function name() {
  const value = `draft-${crypto.randomUUID()}`;
  names.add(value);
  return value;
}
function draft(revision: number, intent: string, note: string | null = null): OrderDraft {
  return {
    shopId,
    businessDayId: dayId,
    draftScopeId: 'orders-main',
    revision,
    updatedAt: instant(`2026-09-04T00:0${revision}:00.000Z`),
    checkoutIntentKey: intent,
    orderTypeId: null,
    lines: [],
    orderNote: note,
    discountMinor: moneyMinor(0),
    delivery: {
      displayPhone: '',
      normalizedPhone: '',
      customerName: '',
      address: '',
      zoneId: null,
      zoneLabel: '',
      configuredFeeMinor: moneyMinor(0),
      finalFeeMinor: moneyMinor(0),
    },
    payment: { mode: 'NONE' },
  };
}
function parked(active: OrderDraft, id = 'parked-1'): ParkedOrderDraft {
  return {
    id,
    shopId,
    businessDayId: dayId,
    draftScopeId: 'orders-main',
    draft: active,
    parkedAt: instant('2026-09-04T00:10:00.000Z'),
    parkedByWorkerId: workerId,
    state: 'PARKED',
    resolvedAt: null,
    resolvedByWorkerId: null,
  };
}
afterEach(async () => {
  for (const dbName of names)
    await new Promise<void>((resolve) => {
      const r = indexedDB.deleteDatabase(dbName);
      r.onsuccess = () => resolve();
      r.onerror = () => resolve();
    });
  names.clear();
});

describe('IndexedDbOrderDraftStore parked drafts', () => {
  it('atomically parks the active draft and replaces it, then survives restart', async () => {
    const dbName = name();
    const store = new IndexedDbOrderDraftStore(dbName);
    await store.initialize();
    const active = draft(2, '44444444-4444-4444-8444-444444444444', 'old');
    const replacement = draft(0, '55555555-5555-4555-8555-555555555555');
    await store.put(active);
    await store.parkAndReplace({
      activeKey: { shopId, businessDayId: dayId, draftScopeId: 'orders-main' },
      expectedActiveRevision: 2,
      parked: parked(active),
      replacement,
    });
    expect(await store.get({ shopId, businessDayId: dayId, draftScopeId: 'orders-main' })).toEqual(
      replacement,
    );
    expect((await store.listParked(shopId, dayId)).map((x) => x.id)).toEqual(['parked-1']);
    await store.close();
    const reopened = new IndexedDbOrderDraftStore(dbName);
    await reopened.initialize();
    expect((await reopened.listParked(shopId, dayId)).map((x) => x.id)).toEqual(['parked-1']);
    await reopened.close();
  });
  it('rejects a stale revision without mutating active or parked data', async () => {
    const store = new IndexedDbOrderDraftStore(name());
    await store.initialize();
    const active = draft(2, '44444444-4444-4444-8444-444444444444');
    await store.put(active);
    await expect(
      store.parkAndReplace({
        activeKey: { shopId, businessDayId: dayId, draftScopeId: 'orders-main' },
        expectedActiveRevision: 1,
        parked: parked(active),
        replacement: draft(0, '55555555-5555-4555-8555-555555555555'),
      }),
    ).rejects.toThrow();
    expect(await store.get({ shopId, businessDayId: dayId, draftScopeId: 'orders-main' })).toEqual(
      active,
    );
    expect(await store.listParked(shopId, dayId)).toEqual([]);
    await store.close();
  });
  it('restores a parked draft and optionally parks the current active draft atomically', async () => {
    const store = new IndexedDbOrderDraftStore(name());
    await store.initialize();
    const original = draft(2, '44444444-4444-4444-8444-444444444444', 'original');
    const current = draft(0, '55555555-5555-4555-8555-555555555555', 'current');
    await store.put(original);
    await store.parkAndReplace({
      activeKey: { shopId, businessDayId: dayId, draftScopeId: 'orders-main' },
      expectedActiveRevision: 2,
      parked: parked(original),
      replacement: current,
    });
    const currentParked = parked(current, 'parked-current');
    const result = await store.restoreParked({
      activeKey: { shopId, businessDayId: dayId, draftScopeId: 'orders-main' },
      expectedActiveRevision: 0,
      parkedId: 'parked-1',
      parkActiveAs: currentParked,
      restoredAt: instant('2026-09-04T00:20:00.000Z'),
      restoredByWorkerId: workerId,
    });
    expect(result.restoredDraft.checkoutIntentKey).toBe(original.checkoutIntentKey);
    expect(result.parkedActive?.id).toBe('parked-current');
    expect((await store.listParked(shopId, dayId)).map((x) => x.id)).toEqual(['parked-current']);
    await store.close();
  });
  it('discards explicitly and excludes resolved history from listParked', async () => {
    const store = new IndexedDbOrderDraftStore(name());
    await store.initialize();
    const active = draft(2, '44444444-4444-4444-8444-444444444444');
    await store.put(active);
    await store.parkAndReplace({
      activeKey: { shopId, businessDayId: dayId, draftScopeId: 'orders-main' },
      expectedActiveRevision: 2,
      parked: parked(active),
      replacement: draft(0, '55555555-5555-4555-8555-555555555555'),
    });
    const discarded = await store.discardParked({
      shopId,
      businessDayId: dayId,
      parkedId: 'parked-1',
      resolvedAt: instant('2026-09-04T00:30:00.000Z'),
      resolvedByWorkerId: workerId,
    });
    expect(discarded.state).toBe('DISCARDED');
    expect(await store.listParked(shopId, dayId)).toEqual([]);
    await store.close();
  });
  it('rejects restore and discard through a different shop or business day', async () => {
    const store = new IndexedDbOrderDraftStore(name());
    await store.initialize();
    const active = draft(2, '44444444-4444-4444-8444-444444444444');
    await store.put(active);
    await store.parkAndReplace({
      activeKey: { shopId, businessDayId: dayId, draftScopeId: 'orders-main' },
      expectedActiveRevision: 2,
      parked: parked(active),
      replacement: draft(0, '55555555-5555-4555-8555-555555555555'),
    });
    await expect(
      store.discardParked({
        shopId: otherShopId,
        businessDayId: dayId,
        parkedId: 'parked-1',
        resolvedAt: instant('2026-09-04T00:30:00.000Z'),
        resolvedByWorkerId: workerId,
      }),
    ).rejects.toThrow();
    await expect(
      store.restoreParked({
        activeKey: { shopId, businessDayId: otherDayId, draftScopeId: 'orders-main' },
        expectedActiveRevision: 0,
        parkedId: 'parked-1',
        parkActiveAs: null,
        restoredAt: instant('2026-09-04T00:30:00.000Z'),
        restoredByWorkerId: workerId,
      }),
    ).rejects.toThrow();
    await store.close();
  });
});
