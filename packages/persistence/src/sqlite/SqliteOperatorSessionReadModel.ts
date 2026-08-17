import { DatabaseSync } from 'node:sqlite';
import type { BusinessDayId, Shop, ShopId, Worker, WorkerSession } from '@tux/domain';
import type { OperatorSessionReadModel } from '../operatorSessionReadModel';

function parsePayload<Value>(row: unknown): Value {
  if (typeof row !== 'object' || row === null || !('payload_json' in row)) {
    throw new Error('SQLite read-model row is missing payload_json.');
  }
  const payload = (row as { payload_json: unknown }).payload_json;
  if (typeof payload !== 'string') {
    throw new Error('SQLite read-model payload_json must be text.');
  }
  return JSON.parse(payload) as Value;
}

export class SqliteOperatorSessionReadModel implements OperatorSessionReadModel {
  readonly #database: DatabaseSync;

  constructor(path: string) {
    this.#database = new DatabaseSync(path, { readOnly: true, timeout: 5_000 });
  }

  async listActiveShops(): Promise<readonly Shop[]> {
    return this.#database
      .prepare('SELECT payload_json FROM shops WHERE active = 1 ORDER BY id LIMIT 2')
      .all()
      .map((row) => parsePayload<Shop>(row));
  }

  async listActiveWorkers(shopId: ShopId): Promise<readonly Worker[]> {
    return this.#database
      .prepare(
        'SELECT payload_json FROM workers WHERE shop_id = ? AND active = 1 ORDER BY display_name, id',
      )
      .all(shopId)
      .map((row) => parsePayload<Worker>(row));
  }

  async getOpenWorkerSession(businessDayId: BusinessDayId): Promise<WorkerSession | null> {
    const row = this.#database
      .prepare(
        `SELECT payload_json FROM worker_sessions
         WHERE business_day_id = ? AND ended_at IS NULL
         ORDER BY started_at DESC LIMIT 1`,
      )
      .get(businessDayId);
    return row === undefined ? null : parsePayload<WorkerSession>(row);
  }

  async close(): Promise<void> {
    this.#database.close();
  }
}
