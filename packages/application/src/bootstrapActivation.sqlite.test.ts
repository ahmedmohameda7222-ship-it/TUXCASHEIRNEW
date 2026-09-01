import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  instant,
  parseEntityId,
  type ShopId,
  type WorkerId,
} from '@tux/domain';
import type { OperationsDatabase } from '@tux/persistence';
import { SqliteOperationsDatabase, SqliteOperatorSessionReadModel } from '@tux/persistence/sqlite';
import { ApplicationCommandCoordinator } from './commandCoordinator';
import {
  OperationsConfigurationSyncService,
  type InboundConfigurationProvider,
} from './configurationSync';
import { OperationsSessionService, type PinVerifier } from './session';

const SHOP_ID = parseEntityId<ShopId>('11000000-0000-4000-8000-000000000001');
const WORKER_ID = parseEntityId<WorkerId>('22000000-0000-4000-8000-000000000001');
const tempDirectories: string[] = [];

class FixturePinVerifier implements PinVerifier {
  async verify(pin: string, storedHash: string): Promise<boolean> {
    return storedHash === `fixture:${pin}`;
  }
}

afterEach(async () => {
  await Promise.all(
    tempDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
  );
});

function validBundle(version = 1) {
  return {
    snapshot: {
      shopId: SHOP_ID,
      version,
      updatedAt: `2026-09-01T10:0${version}:00.000Z`,
      categories: [],
      products: [],
      modifiers: [],
      productModifierLinks: [],
      comboBeverageOptions: [],
      recipeLines: [],
      orderTypes: [],
      paymentMethods: [],
      deliveryZones: [],
    },
    inventoryItems: [],
  };
}

async function fixture(seedIdentity = true) {
  const directory = await mkdtemp(join(tmpdir(), 'tux-bootstrap-activation-'));
  tempDirectories.push(directory);
  const databasePath = join(directory, 'operations.sqlite3');
  const database = new SqliteOperationsDatabase(databasePath);
  await database.initialize();
  if (seedIdentity) {
    await database.transaction(async (transaction) => {
      await transaction.shops.put({ id: SHOP_ID, name: 'TUX Bootstrap Shop', active: true });
      await transaction.workers.put({
        id: WORKER_ID,
        shopId: SHOP_ID,
        displayName: 'Bootstrap Worker',
        pinHash: 'fixture:1234',
        active: true,
      });
    });
  }
  return { database, databasePath };
}

async function freshSession(database: OperationsDatabase, databasePath: string) {
  const readModel = new SqliteOperatorSessionReadModel(databasePath);
  const service = new OperationsSessionService(database, readModel, new FixturePinVerifier(), {
    now: () => instant('2026-09-01T12:00:00.000Z'),
    createUuid: () => randomUUID(),
  });
  return { readModel, service };
}

async function expectReloadRemainsUnactivated(
  database: SqliteOperationsDatabase,
  databasePath: string,
) {
  const { readModel, service } = await freshSession(database, databasePath);
  const state = await service.getState();
  expect(state.ok && state.value.status).toBe('CONFIGURATION_REQUIRED');
  const submitted = await service.submitPin('1234');
  expect(submitted.ok && submitted.value.status).toBe('CONFIGURATION_REQUIRED');
  const day = await database.transaction((transaction) =>
    transaction.businessDays.getOpenForShop(SHOP_ID),
  );
  expect(day).toBeNull();
  await readModel.close();
}

describe('durable Operations bootstrap activation boundary', () => {
  it('does not activate identity after initial configuration is remotely unavailable', async () => {
    const { database, databasePath } = await fixture();
    const provider: InboundConfigurationProvider = {
      async discoverVersion() {
        throw new Error('network unavailable');
      },
      async fetchCompleteConfiguration() {
        throw new Error('network unavailable');
      },
    };
    const result = await new OperationsConfigurationSyncService(
      database,
      new ApplicationCommandCoordinator(),
      provider,
    ).sync(SHOP_ID);
    expect(result).toEqual({ status: 'REMOTE_UNAVAILABLE', localVersion: null });

    await expectReloadRemainsUnactivated(database, databasePath);
    await database.close();
  });

  it('does not activate identity after invalid initial remote configuration', async () => {
    const { database, databasePath } = await fixture();
    const provider: InboundConfigurationProvider = {
      async discoverVersion() {
        return 1;
      },
      async fetchCompleteConfiguration() {
        return { invalid: true };
      },
    };
    const result = await new OperationsConfigurationSyncService(
      database,
      new ApplicationCommandCoordinator(),
      provider,
    ).sync(SHOP_ID);
    expect(result.status).toBe('INVALID_REMOTE_CONFIGURATION');

    await expectReloadRemainsUnactivated(database, databasePath);
    await database.close();
  });

  it('does not activate identity after initial local configuration persistence fails', async () => {
    const { database, databasePath } = await fixture();
    const failingDatabase: OperationsDatabase = {
      transaction: (work) =>
        database.transaction((transaction) =>
          work({
            ...transaction,
            configuration: {
              ...transaction.configuration,
              async put() {
                throw new Error('injected configuration persistence failure');
              },
            },
          }),
        ),
    };
    const provider: InboundConfigurationProvider = {
      async discoverVersion() {
        return 1;
      },
      async fetchCompleteConfiguration() {
        return validBundle();
      },
    };
    const result = await new OperationsConfigurationSyncService(
      failingDatabase,
      new ApplicationCommandCoordinator(),
      provider,
    ).sync(SHOP_ID);
    expect(result.status).toBe('LOCAL_PERSISTENCE_ERROR');

    await expectReloadRemainsUnactivated(database, databasePath);
    await database.close();
  });

  it('recovers safely across the meaningful durable bootstrap boundaries', async () => {
    const empty = await fixture(false);
    const emptySession = await freshSession(empty.database, empty.databasePath);
    expect((await emptySession.service.getState()).ok).toBe(true);
    expect(
      (await emptySession.service.getState()).ok &&
        (await emptySession.service.getState()).value.status,
    ).toBe('CONFIGURATION_REQUIRED');
    await emptySession.readModel.close();
    await empty.database.close();

    const identityOnly = await fixture(true);
    await expectReloadRemainsUnactivated(identityOnly.database, identityOnly.databasePath);

    const configuration = new OperationsConfigurationSyncService(
      identityOnly.database,
      new ApplicationCommandCoordinator(),
      {
        async discoverVersion() {
          return 1;
        },
        async fetchCompleteConfiguration() {
          return validBundle();
        },
      },
    );
    await expect(configuration.sync(SHOP_ID)).resolves.toEqual({ status: 'APPLIED', version: 1 });

    const activated = await freshSession(identityOnly.database, identityOnly.databasePath);
    const started = await activated.service.submitPin('1234');
    expect(started.ok && started.value.status).toBe('ACTIVE');
    await activated.readModel.close();

    const reloaded = await freshSession(identityOnly.database, identityOnly.databasePath);
    const recovered = await reloaded.service.getState();
    expect(recovered.ok && recovered.value.status).toBe('ACTIVE');
    await reloaded.readModel.close();
    await identityOnly.database.close();
  });

  it('successful first-use installation activates identity and configuration together in runtime meaning', async () => {
    const { database, databasePath } = await fixture();
    const service = new OperationsConfigurationSyncService(
      database,
      new ApplicationCommandCoordinator(),
      {
        async discoverVersion() {
          return 1;
        },
        async fetchCompleteConfiguration() {
          return validBundle();
        },
      },
    );
    await expect(service.sync(SHOP_ID)).resolves.toEqual({ status: 'APPLIED', version: 1 });
    const snapshot = await database.transaction((transaction) =>
      transaction.configuration.getForShop(SHOP_ID),
    );
    expect(snapshot?.version).toBe(1);

    const session = await freshSession(database, databasePath);
    const authenticated = await session.service.submitPin('1234');
    expect(authenticated.ok && authenticated.value.status).toBe('ACTIVE');
    await session.readModel.close();
    await database.close();
  });
});
