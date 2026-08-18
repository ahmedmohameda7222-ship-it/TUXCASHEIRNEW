import { OperationsBulkStockService, type ApplicationCommandCoordinator } from '@tux/application';
import {
  parseEntityId,
  type Instant,
  type InventoryItemId,
  type InventoryMovementId,
} from '@tux/domain';
import type { OperationsDatabase, OperatorSessionReadModel } from '@tux/persistence';
import { SqliteBulkStockStore } from '@tux/persistence/sqlite';
import type { BrowserWindow } from 'electron';
import { ipcMain } from 'electron';
import { assertTrustedIpcSender } from './security';

const IPC_BULK_LOAD = 'tux:bulk-stock:load';
const IPC_BULK_FINISH_ONE = 'tux:bulk-stock:finish-one';
const IPC_BULK_ADD = 'tux:bulk-stock:add';
const IPC_BULK_UNDO = 'tux:bulk-stock:undo';

interface BulkStockIpcRuntimeInput {
  readonly databasePath: string;
  readonly database: OperationsDatabase;
  readonly readModel: OperatorSessionReadModel;
  readonly runtime: {
    now(): Instant;
    createUuid(): string;
  };
  readonly coordinator: ApplicationCommandCoordinator;
}

function assertObjectPayload(
  value: unknown,
  label: string,
): asserts value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} IPC payload must be an object.`);
  }
}

export class BulkStockIpcRuntime {
  readonly #store: SqliteBulkStockStore;
  readonly #service: OperationsBulkStockService;

  private constructor(store: SqliteBulkStockStore, service: OperationsBulkStockService) {
    this.#store = store;
    this.#service = service;
  }

  static async create(input: BulkStockIpcRuntimeInput): Promise<BulkStockIpcRuntime> {
    const store = new SqliteBulkStockStore(input.databasePath);
    await store.initialize();
    return new BulkStockIpcRuntime(
      store,
      new OperationsBulkStockService(
        input.database,
        input.readModel,
        store,
        input.runtime,
        input.coordinator,
      ),
    );
  }

  register(window: BrowserWindow): void {
    for (const channel of [IPC_BULK_LOAD, IPC_BULK_FINISH_ONE, IPC_BULK_ADD, IPC_BULK_UNDO]) {
      ipcMain.removeHandler(channel);
    }

    ipcMain.handle(IPC_BULK_LOAD, async (event) => {
      assertTrustedIpcSender(event, window.webContents.id);
      return this.#service.loadBoard();
    });

    ipcMain.handle(IPC_BULK_FINISH_ONE, async (event, input: unknown) => {
      assertTrustedIpcSender(event, window.webContents.id);
      assertObjectPayload(input, 'Finished 1');
      if (typeof input['itemId'] !== 'string' || typeof input['commandId'] !== 'string') {
        throw new TypeError('Finished 1 IPC payload is invalid.');
      }
      return this.#service.finishOne({
        itemId: parseEntityId<InventoryItemId>(input['itemId']),
        commandId: input['commandId'],
      });
    });

    ipcMain.handle(IPC_BULK_ADD, async (event, input: unknown) => {
      assertTrustedIpcSender(event, window.webContents.id);
      assertObjectPayload(input, 'Add Stock');
      if (
        typeof input['itemId'] !== 'string' ||
        typeof input['commandId'] !== 'string' ||
        typeof input['units'] !== 'number'
      ) {
        throw new TypeError('Add Stock IPC payload is invalid.');
      }
      return this.#service.addStock({
        itemId: parseEntityId<InventoryItemId>(input['itemId']),
        commandId: input['commandId'],
        units: input['units'],
      });
    });

    ipcMain.handle(IPC_BULK_UNDO, async (event, input: unknown) => {
      assertTrustedIpcSender(event, window.webContents.id);
      assertObjectPayload(input, 'Bulk Stock Undo');
      if (typeof input['movementId'] !== 'string' || typeof input['commandId'] !== 'string') {
        throw new TypeError('Bulk Stock Undo IPC payload is invalid.');
      }
      return this.#service.undoMovement({
        movementId: parseEntityId<InventoryMovementId>(input['movementId']),
        commandId: input['commandId'],
      });
    });
  }

  async close(): Promise<void> {
    for (const channel of [IPC_BULK_LOAD, IPC_BULK_FINISH_ONE, IPC_BULK_ADD, IPC_BULK_UNDO]) {
      ipcMain.removeHandler(channel);
    }
    await this.#store.close();
  }
}
