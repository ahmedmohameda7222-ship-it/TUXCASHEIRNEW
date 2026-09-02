import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  instant,
  parseEntityId,
  type AuditEvent,
  type ShopId,
  type Worker,
  type WorkerId,
} from '@tux/domain';
import type { OperationsDatabase } from '@tux/persistence';
import { SqliteOperationsDatabase, SqliteOperatorSessionReadModel } from '@tux/persistence/sqlite';
import { OperationsSessionService, type PinVerifier } from './session';
import {
  OperationsWorkerAuthenticationService,
  type AuthoritativeWorkerAuthenticationResult,
  type AuthoritativeWorkerAuthenticator,
  type WorkerCredentialStore,
} from './workerAuthentication';

const SHOP_ID = parseEntityId<ShopId>('10000000-0000-4000-8000-000000000001');
const OTHER_SHOP_ID = parseEntityId<ShopId>('10000000-0000-4000-8000-000000000002');
const WORKER_A = parseEntityId<WorkerId>('20000000-0000-4000-8000-000000000001');
const WORKER_B = parseEntityId<WorkerId>('20000000-0000-4000-8000-000000000002');
const resources: Array<{
  database: SqliteOperationsDatabase;
  readModel: SqliteOperatorSessionReadModel;
  directory: string;
}> = [];

class FixturePinVerifier implements PinVerifier {
  async verify(pin: string, storedHash: string): Promise<boolean> {
    return storedHash === `fixture:${pin}`;
  }
}

class FixedAuthenticator implements AuthoritativeWorkerAuthenticator {
  constructor(readonly result: AuthoritativeWorkerAuthenticationResult) {}

  async authenticate() {
    return this.result;
  }
}

class DatabaseWorkerStore implements WorkerCredentialStore {
  constructor(protected readonly database: OperationsDatabase) {}

  async put(worker: Worker) {
    await this.database.transaction((transaction) => transaction.workers.put(worker));
  }

  async fenceMatchingPin(pin: string) {
    await this.database.transaction(async (transaction) => {
      for (const workerId of [WORKER_A, WORKER_B]) {
        const worker = await transaction.workers.getById(workerId);
        if (worker?.active && worker.pinHash === `fixture:${pin}`) {
          await transaction.workers.put({ ...worker, active: false });
        }
      }
    });
  }
}

function authoritativeWorker(id = WORKER_B, shopId = SHOP_ID, pinHash = 'fixture:1234'): Worker {
  return {
    id,
    shopId,
    displayName: id === WORKER_A ? 'Alpha Worker' : 'Beta Worker',
    pinHash,
    active: true,
  };
}

async function fixture(input: { readonly bothCachedMatch?: boolean } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'tux-authoritative-worker-'));
  const databasePath = join(directory, 'operations.sqlite3');
  const base = new SqliteOperationsDatabase(databasePath);
  await base.initialize();
  await base.transaction(async (transaction) => {
    await transaction.shops.put({ id: SHOP_ID, name: 'Primary Shop', active: true });
    await transaction.shops.put({ id: OTHER_SHOP_ID, name: 'Other Shop', active: false });
    await transaction.configuration.put({
      shopId: SHOP_ID,
      version: 1,
      updatedAt: instant('2026-09-01T10:00:00.000Z'),
      categories: [],
      products: [],
      modifiers: [],
      productModifierLinks: [],
      comboBeverageOptions: [],
      recipeLines: [],
      orderTypes: [],
      paymentMethods: [],
      deliveryZones: [],
    });
    await transaction.workers.put(authoritativeWorker(WORKER_A, SHOP_ID, 'fixture:1234'));
    await transaction.workers.put(
      authoritativeWorker(
        WORKER_B,
        SHOP_ID,
        input.bothCachedMatch ? 'fixture:1234' : 'fixture:9999',
      ),
    );
  });

  const audits: AuditEvent[] = [];
  const recordingDatabase: OperationsDatabase = {
    transaction: (work) =>
      base.transaction((transaction) =>
        work({
          ...transaction,
          audit: {
            async append(event) {
              audits.push(event);
              await transaction.audit.append(event);
            },
          },
        }),
      ),
  };
  const readModel = new SqliteOperatorSessionReadModel(databasePath);
  const session = new OperationsSessionService(
    recordingDatabase,
    readModel,
    new FixturePinVerifier(),
    {
      now: () => instant('2026-09-01T12:00:00.000Z'),
      createUuid: () => randomUUID(),
    },
  );
  resources.push({ database: base, readModel, directory });
  return { base, recordingDatabase, readModel, session, audits };
}

afterEach(async () => {
  for (const resource of resources.splice(0)) {
    await resource.readModel.close();
    await resource.database.close();
    await rm(resource.directory, { recursive: true });
  }
});

function service(
  session: OperationsSessionService,
  database: OperationsDatabase,
  remoteWorker: Worker,
  store: WorkerCredentialStore = new DatabaseWorkerStore(database),
) {
  return new OperationsWorkerAuthenticationService(
    session,
    new FixedAuthenticator({ status: 'AUTHENTICATED', worker: remoteWorker }),
    store,
  );
}

describe('authoritative worker identity transition', () => {
  it('attributes a PIN moved from Worker A to Worker B to exact authoritative Worker B', async () => {
    const { base, recordingDatabase, session, audits } = await fixture();
    const result = await service(
      session,
      recordingDatabase,
      authoritativeWorker(WORKER_B),
    ).submitPin('1234');

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('Expected authoritative authentication to succeed.');
    expect(result.value.status).toBe('ACTIVE');
    if (result.value.status !== 'ACTIVE') throw new Error('Expected active worker session.');
    expect(result.value.operator.id).toBe(WORKER_B);
    expect(audits.every((event) => event.workerId === WORKER_B)).toBe(true);

    const day = await base.transaction((transaction) =>
      transaction.businessDays.getOpenForShop(SHOP_ID),
    );
    expect(day?.status === 'OPEN' ? day.startedByWorkerId : null).toBe(WORKER_B);
  });

  it('uses authoritative identity when two cached workers accidentally share one PIN', async () => {
    const { recordingDatabase, session } = await fixture({ bothCachedMatch: true });
    const result = await service(
      session,
      recordingDatabase,
      authoritativeWorker(WORKER_B),
    ).submitPin('1234');

    expect(result.ok).toBe(true);
    if (!result.ok || result.value.status !== 'ACTIVE') {
      throw new Error('Expected active authoritative worker session.');
    }
    expect(result.value.operator.id).toBe(WORKER_B);
  });

  it('keeps the authoritative reassignment as the sole offline PIN match after an outage', async () => {
    const { recordingDatabase, session } = await fixture({ bothCachedMatch: true });
    const store = new DatabaseWorkerStore(recordingDatabase);
    const online = await service(
      session,
      recordingDatabase,
      authoritativeWorker(WORKER_B),
      store,
    ).submitPin('1234');
    expect(online.ok && online.value.status === 'ACTIVE' && online.value.operator.id).toBe(
      WORKER_B,
    );

    const offline = await new OperationsWorkerAuthenticationService(
      session,
      new FixedAuthenticator({ status: 'UNAVAILABLE', message: 'offline' }),
      store,
    ).submitPin('1234');
    expect(offline.ok).toBe(true);
    if (!offline.ok || offline.value.status !== 'ACTIVE') {
      throw new Error('Expected offline cached worker authentication.');
    }
    expect(offline.value.operator.id).toBe(WORKER_B);
  });

  it('records the exact previous and new worker when switching an open Business Day', async () => {
    const { base, recordingDatabase, session, audits } = await fixture({ bothCachedMatch: true });
    const initial = await session.submitPin('1234');
    expect(initial.ok && initial.value.status === 'ACTIVE' && initial.value.operator.id).toBe(
      WORKER_A,
    );
    audits.length = 0;

    const result = await service(
      session,
      recordingDatabase,
      authoritativeWorker(WORKER_B),
    ).submitPin('1234');
    expect(result.ok).toBe(true);
    if (!result.ok || result.value.status !== 'ACTIVE') throw new Error('Expected worker switch.');
    expect(result.value.operator.id).toBe(WORKER_B);

    const switchedAudit = audits.find((event) => event.eventType === 'WORKER_SWITCHED');
    expect(switchedAudit?.workerId).toBe(WORKER_B);
    const switchedDetails = switchedAudit?.details as
      { previousWorkerId?: unknown } | null | undefined;
    expect(switchedDetails?.previousWorkerId).toBe(WORKER_A);

    const pending = await base.transaction((transaction) =>
      transaction.outbox.listPending(instant('2026-09-01T13:00:00.000Z'), 100),
    );
    const switchedOutbox = pending.find((event) => event.eventType === 'WORKER_SWITCHED');
    const payload = switchedOutbox?.payload as
      { session?: { workerId?: unknown }; previousSession?: { workerId?: unknown } } | undefined;
    expect(payload?.session?.workerId).toBe(WORKER_B);
    expect(payload?.previousSession?.workerId).toBe(WORKER_A);
  });

  it('rolls back competing credential fencing when authoritative session persistence fails', async () => {
    const { base, recordingDatabase, readModel } = await fixture({ bothCachedMatch: true });
    const failingDatabase: OperationsDatabase = {
      transaction: (work) =>
        recordingDatabase.transaction((transaction) =>
          work({
            ...transaction,
            workerSessions: {
              async put() {
                throw new Error('fixture worker session persistence failed');
              },
            },
          }),
        ),
    };
    const failingSession = new OperationsSessionService(
      failingDatabase,
      readModel,
      new FixturePinVerifier(),
      {
        now: () => instant('2026-09-01T12:00:00.000Z'),
        createUuid: () => randomUUID(),
      },
    );

    const result = await service(
      failingSession,
      failingDatabase,
      authoritativeWorker(WORKER_B),
    ).submitPin('1234');
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('Expected local persistence failure.');
    expect(result.error.code).toBe('LOCAL_PERSISTENCE_ERROR');

    const cached = await base.transaction(async (transaction) => ({
      workerA: await transaction.workers.getById(WORKER_A),
      workerB: await transaction.workers.getById(WORKER_B),
      day: await transaction.businessDays.getOpenForShop(SHOP_ID),
    }));
    expect(cached.workerA?.active).toBe(true);
    expect(cached.workerB?.active).toBe(true);
    expect(cached.day).toBeNull();
  });

  it('rejects a cross-shop authoritative worker instead of selecting a local PIN match', async () => {
    const { recordingDatabase, session } = await fixture();
    const result = await service(
      session,
      recordingDatabase,
      authoritativeWorker(WORKER_B, OTHER_SHOP_ID),
    ).submitPin('1234');
    expect(result.ok).toBe(false);
  });

  it('keeps local cached PIN scanning for the explicit offline fallback path', async () => {
    const { recordingDatabase, session } = await fixture();
    const result = await new OperationsWorkerAuthenticationService(
      session,
      new FixedAuthenticator({ status: 'UNAVAILABLE', message: 'offline' }),
      new DatabaseWorkerStore(recordingDatabase),
    ).submitPin('1234');
    expect(result.ok).toBe(true);
    if (!result.ok || result.value.status !== 'ACTIVE') {
      throw new Error('Expected offline cached worker authentication.');
    }
    expect(result.value.operator.id).toBe(WORKER_A);
  });
});
