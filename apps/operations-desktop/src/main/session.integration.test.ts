import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { OperationsSessionService, type PinVerifier } from '@tux/application';
import {
  instant,
  parseEntityId,
  type ShopId,
  type WorkerId,
  type WorkerSessionId,
} from '@tux/domain';
import { SqliteOperationsDatabase, SqliteOperatorSessionReadModel } from '@tux/persistence/sqlite';

const SHOP_ID = parseEntityId<ShopId>('10000000-0000-4000-8000-000000000001');
const AHMED_ID = parseEntityId<WorkerId>('20000000-0000-4000-8000-000000000001');
const MAYA_ID = parseEntityId<WorkerId>('20000000-0000-4000-8000-000000000002');
const SECOND_SESSION_ID = parseEntityId<WorkerSessionId>(
  '30000000-0000-4000-8000-000000000002',
);

class FixturePinVerifier implements PinVerifier {
  async verify(pin: string, storedHash: string): Promise<boolean> {
    return storedHash === `fixture:${pin}`;
  }
}

const cleanupDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    cleanupDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
  );
});

async function fixture() {
  const directory = await mkdtemp(path.join(tmpdir(), 'tux-session-'));
  cleanupDirectories.push(directory);
  const databasePath = path.join(directory, 'operations.sqlite3');
  const database = new SqliteOperationsDatabase(databasePath);
  await database.initialize();
  await database.transaction(async (transaction) => {
    await transaction.shops.put({ id: SHOP_ID, name: 'TUX Test Shop', active: true });
    await transaction.workers.put({
      id: AHMED_ID,
      shopId: SHOP_ID,
      displayName: 'Ahmed',
      pinHash: 'fixture:1234',
      active: true,
    });
    await transaction.workers.put({
      id: MAYA_ID,
      shopId: SHOP_ID,
      displayName: 'Maya',
      pinHash: 'fixture:5678',
      active: true,
    });
  });
  const readModel = new SqliteOperatorSessionReadModel(databasePath);
  let now = instant('2026-08-17T13:00:00.000Z');
  const service = new OperationsSessionService(database, readModel, new FixturePinVerifier(), {
    now: () => now,
    createUuid: () => randomUUID(),
  });
  return {
    database,
    readModel,
    service,
    setNow(value: string) {
      now = instant(value);
    },
  };
}

describe('OperationsSessionService with SQLite', () => {
  it('does not create a Business Day for an invalid PIN', async () => {
    const { database, readModel, service } = await fixture();
    const result = await service.submitPin('9999');
    expect(result).toEqual({
      ok: false,
      error: { code: 'PIN_AUTH_ERROR', message: 'Invalid PIN.' },
    });
    const openDay = await database.transaction((transaction) =>
      transaction.businessDays.getOpenForShop(SHOP_ID),
    );
    expect(openDay).toBeNull();
    await readModel.close();
    await database.close();
  });

  it('enforces one open worker session per Business Day at the database boundary', async () => {
    const { database, readModel, service } = await fixture();
    const started = await service.submitPin('1234');
    if (!started.ok || started.value.status !== 'ACTIVE')
      throw new Error('Expected active session.');

    await expect(
      database.transaction(async (transaction) => {
        await transaction.workerSessions.put({
          id: SECOND_SESSION_ID,
          shopId: SHOP_ID,
          businessDayId: started.value.businessDayId,
          workerId: MAYA_ID,
          startedAt: instant('2026-08-17T13:30:00.000Z'),
          endedAt: null,
        });
      }),
    ).rejects.toThrow();

    await readModel.close();
    await database.close();
  });

  it('starts, joins, switches, signs out, and recovers one durable Business Day', async () => {
    const { database, readModel, service, setNow } = await fixture();

    const started = await service.submitPin('1234');
    expect(started.ok).toBe(true);
    if (!started.ok || started.value.status !== 'ACTIVE')
      throw new Error('Expected active session.');
    const businessDayId = started.value.businessDayId;
    expect(started.value.operator.displayName).toBe('Ahmed');

    const recovered = await service.getState();
    expect(recovered.ok && recovered.value.status === 'ACTIVE' && recovered.value.operator.id).toBe(
      AHMED_ID,
    );

    setNow('2026-08-17T14:00:00.000Z');
    const switched = await service.submitPin('5678');
    expect(switched.ok).toBe(true);
    if (!switched.ok || switched.value.status !== 'ACTIVE')
      throw new Error('Expected switched session.');
    expect(switched.value.businessDayId).toBe(businessDayId);
    expect(switched.value.operator.id).toBe(MAYA_ID);

    setNow('2026-08-17T15:00:00.000Z');
    const signedOut = await service.signOut();
    expect(signedOut.ok && signedOut.value.status).toBe('SIGN_IN_REQUIRED');

    const openDay = await database.transaction((transaction) =>
      transaction.businessDays.getOpenForShop(SHOP_ID),
    );
    expect(openDay?.id).toBe(businessDayId);
    expect(openDay?.status).toBe('OPEN');

    const afterSignOut = await service.getState();
    expect(afterSignOut.ok && afterSignOut.value.status).toBe('SIGN_IN_REQUIRED');

    await readModel.close();
    await database.close();
  });
});
