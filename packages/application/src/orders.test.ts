import { describe, expect, it } from 'vitest';
import {
  instant,
  moneyMinor,
  parseEntityId,
  type BusinessDayId,
  type DeliveryZoneId,
  type OpenBusinessDay,
  type OperationsConfigurationSnapshot,
  type OrderDraft,
  type ParkedOrderDraft,
  type ShopId,
  type WorkerId,
  type WorkerSessionId,
} from '@tux/domain';
import type {
  OperationsDatabase,
  OperationsTransaction,
  OperatorSessionReadModel,
  OrderDraftKey,
  OrderDraftStore,
  ParkAndReplaceOrderDraftInput,
  ResolveParkedOrderDraftInput,
  RestoreParkedOrderDraftInput,
} from '@tux/persistence';
import { OperationsOrdersService, type OrdersCustomerPrefill } from './orders';

const shopId = parseEntityId<ShopId>('11111111-1111-4111-8111-111111111111');
const dayId = parseEntityId<BusinessDayId>('22222222-2222-4222-8222-222222222222');
const workerId = parseEntityId<WorkerId>('33333333-3333-4333-8333-333333333333');
const zoneId = parseEntityId<DeliveryZoneId>('44444444-4444-4444-8444-444444444444');
const at = instant('2026-09-04T07:00:00.000Z');
const day: OpenBusinessDay = {
  id: dayId,
  shopId,
  status: 'OPEN',
  startedAt: at,
  endedAt: null,
  startedByWorkerId: workerId,
  endedByWorkerId: null,
  lastAllocatedDisplayOrderNo: 0,
};
const configuration: OperationsConfigurationSnapshot = {
  shopId,
  version: 1,
  updatedAt: at,
  categories: [],
  products: [],
  modifiers: [],
  productModifierLinks: [],
  comboBeverageOptions: [],
  recipeLines: [],
  orderTypes: [
    {
      id: '55555555-5555-4555-8555-555555555555' as never,
      shopId,
      name: 'Delivery',
      behavior: 'DELIVERY',
      active: true,
      sortOrder: 1,
    },
  ],
  paymentMethods: [],
  deliveryZones: [
    { id: zoneId, shopId, name: 'Zone A', feeMinor: moneyMinor(2500), active: true, sortOrder: 1 },
  ],
};
const prefill: OrdersCustomerPrefill = {
  normalizedPhone: '01012345678',
  displayPhone: '+20 10 1234 5678',
  customerName: 'Customer One',
  address: '1 Street',
  zoneId,
};

function baseDraft(revision = 0, note: string | null = null): OrderDraft {
  return {
    shopId,
    businessDayId: dayId,
    draftScopeId: 'orders-main',
    revision,
    updatedAt: at,
    checkoutIntentKey: '66666666-6666-4666-8666-666666666666',
    orderTypeId: configuration.orderTypes[0]!.id,
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

class MemoryDraftStore implements OrderDraftStore {
  active: OrderDraft | null = null;
  parked = new Map<string, ParkedOrderDraft>();
  mutations = 0;
  async initialize() {}
  async get(key: OrderDraftKey) {
    void key;
    return this.active;
  }
  async put(draft: OrderDraft) {
    this.active = draft;
    this.mutations += 1;
  }
  async delete(key: OrderDraftKey) {
    void key;
    this.active = null;
    this.mutations += 1;
  }
  async listParked(requestShopId: ShopId, requestDayId: BusinessDayId) {
    return [...this.parked.values()].filter(
      (x) => x.shopId === requestShopId && x.businessDayId === requestDayId && x.state === 'PARKED',
    );
  }
  async parkAndReplace(input: ParkAndReplaceOrderDraftInput) {
    if (this.active?.revision !== input.expectedActiveRevision) throw new Error('revision');
    this.parked.set(input.parked.id, input.parked);
    this.active = input.replacement;
    this.mutations += 1;
    return input.parked;
  }
  async restoreParked(input: RestoreParkedOrderDraftInput) {
    const selected = this.parked.get(input.parkedId);
    if (!selected || this.active?.revision !== input.expectedActiveRevision)
      throw new Error('restore');
    if (input.parkActiveAs) this.parked.set(input.parkActiveAs.id, input.parkActiveAs);
    this.parked.set(selected.id, {
      ...selected,
      state: 'RESTORED',
      resolvedAt: input.restoredAt,
      resolvedByWorkerId: input.restoredByWorkerId,
    });
    this.active = selected.draft;
    this.mutations += 1;
    return { restoredDraft: selected.draft, parkedActive: input.parkActiveAs };
  }
  async discardParked(input: ResolveParkedOrderDraftInput) {
    const selected = this.parked.get(input.parkedId);
    if (!selected) throw new Error('missing');
    const resolved: ParkedOrderDraft = {
      ...selected,
      state: 'DISCARDED',
      resolvedAt: input.resolvedAt,
      resolvedByWorkerId: input.resolvedByWorkerId,
    };
    this.parked.set(selected.id, resolved);
    this.mutations += 1;
    return resolved;
  }
  async close() {}
}

function fixture(active: OrderDraft | null = baseDraft()) {
  const store = new MemoryDraftStore();
  store.active = active;
  const database = {
    transaction: async <Result>(work: (tx: OperationsTransaction) => Promise<Result>) =>
      work({
        businessDays: { getOpenForShop: async () => day },
        configuration: { getForShop: async () => configuration },
        workers: {
          getById: async () => ({
            id: workerId,
            shopId,
            displayName: 'Worker',
            pinHash: 'x',
            active: true,
          }),
        },
        orders: { getByIdempotencyKey: async () => null },
      } as unknown as OperationsTransaction),
  } as OperationsDatabase;
  const readModel = {
    listActiveShops: async () => [{ id: shopId, name: 'TUX', active: true }],
    getOpenWorkerSession: async () => ({
      id: parseEntityId<WorkerSessionId>('77777777-7777-4777-8777-777777777777'),
      shopId,
      businessDayId: dayId,
      workerId,
      startedAt: at,
      endedAt: null,
    }),
  } as unknown as OperatorSessionReadModel;
  let seq = 0;
  const ids = [
    '88888888-8888-4888-8888-888888888881',
    '88888888-8888-4888-8888-888888888882',
    '88888888-8888-4888-8888-888888888883',
  ];
  const service = new OperationsOrdersService(database, readModel, store, {
    now: () => at,
    createUuid: () => ids[seq++] ?? crypto.randomUUID(),
  });
  return { service, store };
}

describe('OperationsOrdersService parked draft handoff', () => {
  it('starts a fresh customer-prefilled draft from an empty active draft without product/payment inference', async () => {
    const { service, store } = fixture();
    const result = await service.startOrderFromCustomerPrefill({
      draftScopeId: 'orders-main',
      prefill,
      parkCurrent: false,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.draft.lines).toEqual([]);
    expect(result.value.draft.payment).toEqual({ mode: 'NONE' });
    expect(result.value.draft.discountMinor).toBe(0);
    expect(result.value.draft.delivery).toMatchObject({
      normalizedPhone: '01012345678',
      customerName: 'Customer One',
      address: '1 Street',
      zoneId,
    });
    expect(store.parked.size).toBe(0);
  });
  it('returns CONFLICT_ERROR with zero storage mutation for meaningful current draft unless park is explicit', async () => {
    const { service, store } = fixture(baseDraft(3, 'keep me'));
    const before = store.mutations;
    const result = await service.startOrderFromCustomerPrefill({
      draftScopeId: 'orders-main',
      prefill,
      parkCurrent: false,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('CONFLICT_ERROR');
    expect(store.mutations).toBe(before);
    expect(store.active?.orderNote).toBe('keep me');
  });
  it('atomically parks a meaningful draft and starts a fresh customer-only draft when explicit', async () => {
    const { service, store } = fixture(baseDraft(3, 'park me'));
    const result = await service.startOrderFromCustomerPrefill({
      draftScopeId: 'orders-main',
      prefill,
      parkCurrent: true,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.parkedDrafts).toHaveLength(1);
    expect(store.mutations).toBe(1);
    expect(store.active?.orderNote).toBeNull();
    expect(store.active?.checkoutIntentKey).not.toBe('66666666-6666-4666-8666-666666666666');
  });
  it('loadWorkspace exposes safe parked summaries rather than raw parked drafts', async () => {
    const { service, store } = fixture();
    const parkedDraft = baseDraft(2, 'hidden body');
    store.parked.set('p1', {
      id: 'p1',
      shopId,
      businessDayId: dayId,
      draftScopeId: 'orders-main',
      draft: {
        ...parkedDraft,
        delivery: { ...parkedDraft.delivery, customerName: 'Alice', displayPhone: '+201000000000' },
      },
      parkedAt: at,
      parkedByWorkerId: workerId,
      state: 'PARKED',
      resolvedAt: null,
      resolvedByWorkerId: null,
    });
    const result = await service.loadWorkspace('orders-main');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.parkedDrafts).toEqual([
      {
        id: 'p1',
        parkedAt: at,
        parkedByWorkerId: workerId,
        lineCount: 0,
        customerName: 'Alice',
        displayPhone: '+201000000000',
        totalQuantity: 0,
      },
    ]);
  });
  it('refuses to overwrite a meaningful active draft during restore unless explicitly parked', async () => {
    const { service, store } = fixture(baseDraft(1, 'current'));
    const old = baseDraft(2, 'old');
    store.parked.set('p1', {
      id: 'p1',
      shopId,
      businessDayId: dayId,
      draftScopeId: 'orders-main',
      draft: old,
      parkedAt: at,
      parkedByWorkerId: workerId,
      state: 'PARKED',
      resolvedAt: null,
      resolvedByWorkerId: null,
    });
    const result = await service.restoreParkedDraft({
      draftScopeId: 'orders-main',
      parkedDraftId: 'p1',
      parkCurrent: false,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('CONFLICT_ERROR');
    expect(store.active?.orderNote).toBe('current');
    expect(store.parked.get('p1')?.state).toBe('PARKED');
  });
  it('restores explicitly while parking a meaningful active draft', async () => {
    const { service, store } = fixture(baseDraft(1, 'current'));
    const old = baseDraft(2, 'old');
    store.parked.set('p1', {
      id: 'p1',
      shopId,
      businessDayId: dayId,
      draftScopeId: 'orders-main',
      draft: old,
      parkedAt: at,
      parkedByWorkerId: workerId,
      state: 'PARKED',
      resolvedAt: null,
      resolvedByWorkerId: null,
    });
    const result = await service.restoreParkedDraft({
      draftScopeId: 'orders-main',
      parkedDraftId: 'p1',
      parkCurrent: true,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.draft.orderNote).toBe('old');
    expect(result.value.parkedDrafts).toHaveLength(1);
    expect(result.value.parkedDrafts[0]?.id).not.toBe('p1');
  });
  it('discards a parked draft explicitly', async () => {
    const { service, store } = fixture();
    const old = baseDraft(2, 'old');
    store.parked.set('p1', {
      id: 'p1',
      shopId,
      businessDayId: dayId,
      draftScopeId: 'orders-main',
      draft: old,
      parkedAt: at,
      parkedByWorkerId: workerId,
      state: 'PARKED',
      resolvedAt: null,
      resolvedByWorkerId: null,
    });
    const result = await service.discardParkedDraft({ parkedDraftId: 'p1' });
    expect(result).toEqual({ ok: true, value: true });
    expect(store.parked.get('p1')?.state).toBe('DISCARDED');
  });
});
