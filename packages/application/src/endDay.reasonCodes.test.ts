import { describe, expect, it } from 'vitest';
import {
  instant,
  moneyMinor,
  parseEntityId,
  type BusinessDayId,
  type OpenBusinessDay,
  type OperationsConfigurationSnapshot,
  type OrderDraft,
  type PaymentMethodId,
  type Reconciliation,
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
const cashMethodId = parseEntityId<PaymentMethodId>('77777777-7777-4777-8777-777777777777');
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
  version: 9,
  updatedAt: at,
  categories: [],
  products: [],
  modifiers: [],
  productModifierLinks: [],
  comboBeverageOptions: [],
  recipeLines: [],
  orderTypes: [],
  paymentMethods: [
    {
      id: cashMethodId,
      shopId,
      displayName: 'Cash',
      logicType: 'CASH',
      requiresReconciliation: true,
      active: true,
      sortOrder: 0,
    },
  ],
  deliveryZones: [],
  reasonCodes: [
    {
      id: 'cash-short',
      key: 'CASH_SHORT',
      family: 'CASH_VARIANCE',
      label: 'Cash short',
      active: true,
      version: 3,
      scope: 'SHOP',
    },
  ],
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

function fixture() {
  let reconciliation: Reconciliation | null = null;
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
    reconciliations: {
      put: async (value: Reconciliation) => {
        reconciliation = value;
      },
    },
    workerSessions: { put: async () => undefined },
    audit: { append: async () => undefined },
    outbox: { append: async () => undefined },
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
    listParked: async () => [],
    delete: async () => undefined,
  } as unknown as OrderDraftStore;
  const expenseStore = {
    listByBusinessDay: async () => [],
  } as unknown as ExpenseLedgerStore;
  const service = new OperationsEndDayService(database, readModel, draftStore, expenseStore, {
    now: () => at,
    createUuid: () => '66666666-6666-4666-8666-666666666666',
  });
  return {
    service,
    reconciliation: () => reconciliation,
    dayWrites: () => dayWrites,
  };
}

const actualPayments = [{ paymentMethodId: cashMethodId, actualMinor: moneyMinor(100) }];

describe('End Day configured cash-variance reasons', () => {
  it('rejects free-text-only authority once CASH_VARIANCE reason codes are published', async () => {
    const test = fixture();
    const result = await test.service.closeDay({
      businessDayId: dayId,
      draftScopeId: 'orders-main',
      actualPayments,
      varianceReasons: [{ paymentMethodId: cashMethodId, reason: 'Drawer was short' }],
    });

    expect(result.ok).toBe(false);
    expect(test.dayWrites()).toBe(0);
  });

  it('accepts a published CASH_VARIANCE reason identity and snapshots it immutably', async () => {
    const test = fixture();
    const result = await test.service.closeDay({
      businessDayId: dayId,
      draftScopeId: 'orders-main',
      actualPayments,
      varianceReasons: [
        {
          paymentMethodId: cashMethodId,
          reason: null,
          reasonCodeId: 'cash-short',
        } as never,
      ],
    });

    expect(result.ok).toBe(true);
    const reconciliation = test.reconciliation();
    expect(reconciliation).not.toBeNull();
    const line = reconciliation?.lines[0] as
      | (Reconciliation['lines'][number] & {
          varianceReasonCode?: {
            id: string;
            key: string;
            family: string;
            label: string;
            version: number;
            scope: string;
          };
        })
      | undefined;
    expect(line?.varianceReason).toBe('Cash short');
    expect(line?.varianceReasonCode).toEqual({
      id: 'cash-short',
      key: 'CASH_SHORT',
      family: 'CASH_VARIANCE',
      label: 'Cash short',
      version: 3,
      scope: 'SHOP',
    });
  });
});
