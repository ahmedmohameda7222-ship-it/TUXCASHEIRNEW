import { describe, expect, it } from 'vitest';
import {
  instant,
  moneyMinor,
  parseEntityId,
  type BusinessDayId,
  type OpenBusinessDay,
  type OperationsConfigurationSnapshot,
  type OrderDraft,
  type ParkedOrderDraft,
  type ShopId,
  type WorkerId,
  type WorkerSessionId,
} from '@tux/domain';
import type {
  ExpenseLedgerStore,
  OperationsDatabase,
  OperationsTransaction,
  OperatorSessionReadModel,
  OrderDraftStore,
} from '@tux/persistence';
import { OperationsEndDayService } from './endDay';

const shopId = parseEntityId<ShopId>('11111111-1111-4111-8111-111111111111');
const dayId = parseEntityId<BusinessDayId>('22222222-2222-4222-8222-222222222222');
const workerId = parseEntityId<WorkerId>('33333333-3333-4333-8333-333333333333');
const at = instant('2026-09-04T07:20:00.000Z');

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
  orderTypes: [],
  paymentMethods: [],
  deliveryZones: [],
};

const emptyDraft: OrderDraft = {
  shopId,
  businessDayId: dayId,
  draftScopeId: 'orders-main',
  revision: 0,
  updatedAt: at,
  checkoutIntentKey: '44444444-4444-4444-8444-444444444444',
  orderTypeId: null,
  lines: [],
  orderNote: null,
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

const parked: ParkedOrderDraft = {
  id: 'parked-1',
  shopId,
  businessDayId: dayId,
  draftScopeId: 'orders-main',
  draft: { ...emptyDraft, orderNote: 'preserve me' },
  parkedAt: at,
  parkedByWorkerId: workerId,
  state: 'PARKED',
  resolvedAt: null,
  resolvedByWorkerId: null,
};

function fixture(parkedDrafts: readonly ParkedOrderDraft[]) {
  let expenseReads = 0;
  let dayWrites = 0;
  const transaction = {
    businessDays: {
      getById: async () => day,
      getOpenForShop: async () => day,
      put: async () => {
        dayWrites += 1;
      },
    },
    configuration: { getForShop: async () => configuration, put: async () => undefined },
    workers: {
      getById: async () => ({
        id: workerId,
        shopId,
        displayName: 'Worker',
        pinHash: 'hash',
        active: true,
      }),
      put: async () => undefined,
    },
    orders: {
      getById: async () => null,
      getByIdempotencyKey: async () => null,
      listByBusinessDay: async () => [],
      insert: async () => undefined,
      updateOperationalState: async () => undefined,
    },
  } as unknown as OperationsTransaction;
  const database = {
    transaction: async <Result>(work: (value: OperationsTransaction) => Promise<Result>) =>
      work(transaction),
  } as OperationsDatabase;
  const readModel = {
    listActiveShops: async () => [{ id: shopId, name: 'TUX', active: true }],
    getOpenWorkerSession: async () => ({
      id: parseEntityId<WorkerSessionId>('55555555-5555-4555-8555-555555555555'),
      shopId,
      businessDayId: dayId,
      workerId,
      startedAt: at,
      endedAt: null,
    }),
  } as unknown as OperatorSessionReadModel;
  const draftStore = {
    get: async () => emptyDraft,
    listParked: async () => parkedDrafts,
    delete: async () => undefined,
  } as unknown as OrderDraftStore;
  const expenseStore = {
    listByBusinessDay: async () => {
      expenseReads += 1;
      return [];
    },
  } as unknown as ExpenseLedgerStore;
  const service = new OperationsEndDayService(database, readModel, draftStore, expenseStore, {
    now: () => at,
    createUuid: () => '66666666-6666-4666-8666-666666666666',
  });
  return {
    service,
    stats: () => ({ expenseReads, dayWrites }),
  };
}

describe('End Day parked draft authority', () => {
  it('beginEndDay reports PARKED_DRAFTS_BLOCKED while any active parked draft exists', async () => {
    const { service } = fixture([parked]);
    const result = await service.beginEndDay('orders-main');
    expect(result).toEqual({
      ok: true,
      value: { kind: 'PARKED_DRAFTS_BLOCKED', businessDayId: dayId, parkedDraftCount: 1 },
    });
  });

  it('previewReconciliation rejects before expense/reporting work while parked drafts exist', async () => {
    const { service, stats } = fixture([parked]);
    const result = await service.previewReconciliation({
      businessDayId: dayId,
      draftScopeId: 'orders-main',
      actualPayments: [],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('CONFLICT_ERROR');
    expect(result.error.message).toMatch(/parked/i);
    expect(stats().expenseReads).toBe(0);
  });

  it('closeDay rejects before any close mutation while parked drafts exist', async () => {
    const { service, stats } = fixture([parked]);
    const result = await service.closeDay({
      businessDayId: dayId,
      draftScopeId: 'orders-main',
      actualPayments: [],
      varianceReasons: [],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('CONFLICT_ERROR');
    expect(result.error.message).toMatch(/parked/i);
    expect(stats().dayWrites).toBe(0);
  });

  it('READY is restored after parked history is explicitly resolved', async () => {
    const { service } = fixture([]);
    const result = await service.beginEndDay('orders-main');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.kind).toBe('READY');
  });
});
