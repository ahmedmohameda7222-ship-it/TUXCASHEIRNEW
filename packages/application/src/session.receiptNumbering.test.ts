import { describe, expect, it } from 'vitest';
import {
  allocateDisplayOrderNo,
  instant,
  parseEntityId,
  type BusinessDayId,
  type OpenBusinessDay,
  type OperationsConfigurationSnapshot,
  type Shop,
  type ShopId,
  type Worker,
  type WorkerId,
  type WorkerSession,
  type WorkerSessionId,
} from '@tux/domain';
import type {
  OperationsDatabase,
  OperationsTransaction,
  OperatorSessionReadModel,
} from '@tux/persistence';
import { OperationsSessionService } from './session';

const shopId = parseEntityId<ShopId>('11111111-1111-4111-8111-111111111111');
const workerId = parseEntityId<WorkerId>('22222222-2222-4222-8222-222222222222');
const shop: Shop = { id: shopId, name: 'TUX', active: true };
const worker: Worker = {
  id: workerId,
  shopId,
  displayName: 'Ahmed',
  pinHash: 'fixture',
  active: true,
};

function configuration(sequenceStart: number, version: number): OperationsConfigurationSnapshot {
  return {
    shopId,
    version,
    updatedAt: instant(`2026-09-${String(10 + version).padStart(2, '0')}T20:00:00.000Z`),
    categories: [],
    products: [],
    modifiers: [],
    productModifierLinks: [],
    comboBeverageOptions: [],
    recipeLines: [],
    orderTypes: [],
    paymentMethods: [],
    deliveryZones: [],
    settings: {
      version,
      values: {
        'receipt.sequenceStart': sequenceStart,
        'receipt.sequenceResetPolicy': 'BUSINESS_DAY',
      },
      shopIdentity: {
        shopId,
        displayName: 'TUX',
        address: null,
        phone: null,
        latitude: null,
        longitude: null,
        timezone: 'Africa/Cairo',
        lifecycleState: 'ACTIVE',
        temporaryClosed: false,
        onlineOrdersPaused: false,
      },
      weeklyHours: [],
      specialHours: [],
      paymentMethodZoneRules: [],
    },
    reasonCodes: [],
  };
}

function fixture(initialConfiguration = configuration(100, 1)) {
  let currentConfiguration = initialConfiguration;
  let openDay: OpenBusinessDay | null = null;
  let openSession: WorkerSession | null = null;
  let idCounter = 1;

  const transaction = {
    configuration: {
      getForShop: async () => currentConfiguration,
    },
    workers: {
      getById: async () => worker,
      put: async () => undefined,
    },
    businessDays: {
      getOpenForShop: async () => openDay,
      put: async (day: OpenBusinessDay) => {
        openDay = day;
      },
    },
    workerSessions: {
      put: async (session: WorkerSession) => {
        openSession = session;
      },
    },
    audit: { append: async () => undefined },
    outbox: { append: async () => undefined },
  } as unknown as OperationsTransaction;

  const database: OperationsDatabase = {
    transaction: async <Result>(work: (tx: OperationsTransaction) => Promise<Result>) =>
      work(transaction),
  };
  const readModel: OperatorSessionReadModel = {
    listActiveShops: async () => [shop],
    listActiveWorkers: async () => [worker],
    getOpenWorkerSession: async () => openSession,
  };
  const service = new OperationsSessionService(
    database,
    readModel,
    { verify: async () => true },
    {
      now: () => instant('2026-09-11T21:30:00.000Z'),
      createUuid: () => `00000000-0000-4000-8000-${String(idCounter++).padStart(12, '0')}`,
    },
  );

  return {
    service,
    getOpenDay: () => openDay,
    setConfiguration: (next: OperationsConfigurationSnapshot) => {
      currentConfiguration = next;
    },
    allocateOne: () => {
      if (openDay === null) throw new Error('Business Day is not open.');
      openDay = allocateDisplayOrderNo(openDay).businessDay;
    },
    simulateSafeBusinessDayBoundary: () => {
      openDay = null;
      openSession = null;
    },
  };
}

describe('Operations receipt numbering at Business Day boundaries', () => {
  it('applies the published sequence start only when a new Business Day is opened', async () => {
    const state = fixture(configuration(100, 1));

    const opened = await state.service.submitPin('1234');
    expect(opened.ok).toBe(true);
    expect(state.getOpenDay()?.lastAllocatedDisplayOrderNo).toBe(99);

    state.allocateOne();
    state.setConfiguration(configuration(1, 2));
    await state.service.submitPin('1234');
    expect(state.getOpenDay()?.lastAllocatedDisplayOrderNo).toBe(100);

    state.setConfiguration(configuration(200, 3));
    state.simulateSafeBusinessDayBoundary();
    await state.service.submitPin('1234');
    expect(state.getOpenDay()?.lastAllocatedDisplayOrderNo).toBe(199);
  });
});
