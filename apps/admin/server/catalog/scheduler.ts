export type CatalogScheduledChangeKind = 'CATALOG_PUBLISH' | 'PRODUCT_AVAILABILITY';

export type CatalogScheduledChange = {
  id: string;
  businessId: string;
  shopId: string;
  createdByEmployeeId: string;
  changeKind: CatalogScheduledChangeKind;
  payload: Readonly<Record<string, unknown>>;
  scheduledFor: string;
  targetBasePublishVersion: number | null;
  idempotencyKey: string;
  attemptCount: number;
};

export interface CatalogSchedulerStore {
  /**
   * Atomically claims due rows for this worker. Implementations must not return a row that
   * another worker can concurrently execute; persistent claim state is the idempotency fence.
   */
  claimDue(input: { now: string; limit: number }): Promise<CatalogScheduledChange[]>;
  markApplied(input: { id: string; idempotencyKey: string; result: unknown }): Promise<void>;
  markFailed(input: { id: string; idempotencyKey: string; error: string }): Promise<void>;
}

export interface CatalogSchedulerRpcClient {
  rpc<T>(name: string, payload: Readonly<Record<string, unknown>>): Promise<T>;
}

export type CatalogSchedulerDependencies = {
  store: CatalogSchedulerStore;
  publish(change: CatalogScheduledChange): Promise<unknown>;
  setAvailability(change: CatalogScheduledChange): Promise<unknown>;
  now?: () => Date;
  batchSize?: number;
};

export type CatalogSchedulerRunResult = {
  claimed: number;
  applied: number;
  failed: number;
};

export type CatalogSchedulerHttpResult = {
  statusCode: number;
  headers?: Readonly<Record<string, string>>;
  body: Readonly<Record<string, unknown>>;
};

type UnknownRecord = Readonly<Record<string, unknown>>;

type SchedulerClaimRow = {
  id?: unknown;
  business_id?: unknown;
  shop_id?: unknown;
  created_by_employee_id?: unknown;
  change_kind?: unknown;
  payload_json?: unknown;
  scheduled_for?: unknown;
  target_base_publish_version?: unknown;
  idempotency_key?: unknown;
  attempt_count?: unknown;
};

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requiredString(
  value: unknown,
  code = 'catalog_scheduler_backend_contract_invalid',
): string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(code);
  return value.trim();
}

function requiredInteger(value: unknown, minimum: number): number {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(numeric) || numeric < minimum) {
    throw new Error('catalog_scheduler_backend_contract_invalid');
  }
  return numeric;
}

function optionalNonnegativeInteger(value: unknown): number | null {
  return value === null || value === undefined ? null : requiredInteger(value, 0);
}

function readChangeKind(value: unknown): CatalogScheduledChangeKind {
  if (value === 'CATALOG_PUBLISH' || value === 'PRODUCT_AVAILABILITY') return value;
  throw new Error('catalog_scheduler_backend_contract_invalid');
}

function readPayload(value: unknown): UnknownRecord {
  if (!isRecord(value)) throw new Error('catalog_scheduler_backend_contract_invalid');
  return value;
}

function mapClaimRow(value: unknown): CatalogScheduledChange {
  if (!isRecord(value)) throw new Error('catalog_scheduler_backend_contract_invalid');
  const row = value as SchedulerClaimRow;
  return {
    id: requiredString(row.id),
    businessId: requiredString(row.business_id),
    shopId: requiredString(row.shop_id),
    createdByEmployeeId: requiredString(row.created_by_employee_id),
    changeKind: readChangeKind(row.change_kind),
    payload: readPayload(row.payload_json),
    scheduledFor: requiredString(row.scheduled_for),
    targetBasePublishVersion: optionalNonnegativeInteger(row.target_base_publish_version),
    idempotencyKey: requiredString(row.idempotency_key),
    attemptCount: requiredInteger(row.attempt_count, 1),
  };
}

function schedulerErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message.slice(0, 512);
  return 'catalog_scheduler_execution_failed';
}

function assertSuccessfulExecution(result: unknown): void {
  if (isRecord(result) && result['ok'] === false) {
    const code = typeof result['code'] === 'string' ? result['code'] : 'command_rejected';
    throw new Error(`catalog_scheduler_${code}`);
  }
}

function requireRpcTransition(result: unknown): void {
  if (result !== true) throw new Error('catalog_scheduler_transition_rejected');
}

export function createSupabaseCatalogSchedulerStore(
  client: CatalogSchedulerRpcClient,
): CatalogSchedulerStore {
  return {
    async claimDue(input) {
      const result = await client.rpc<unknown>('claim_due_admin_config_changes_v1', {
        p_now: input.now,
        p_limit: input.limit,
        p_lease_seconds: 300,
      });
      if (!Array.isArray(result)) throw new Error('catalog_scheduler_backend_contract_invalid');
      return result.map(mapClaimRow);
    },

    async markApplied(input) {
      const result = await client.rpc<unknown>('mark_admin_config_change_applied_v1', {
        p_id: input.id,
        p_idempotency_key: input.idempotencyKey,
        p_result: input.result,
      });
      requireRpcTransition(result);
    },

    async markFailed(input) {
      const result = await client.rpc<unknown>('mark_admin_config_change_failed_v1', {
        p_id: input.id,
        p_idempotency_key: input.idempotencyKey,
        p_error: input.error,
      });
      requireRpcTransition(result);
    },
  };
}

function positiveIntegerFromPayload(payload: UnknownRecord, key: string): number {
  return requiredInteger(payload[key], 1);
}

export function createSupabaseCatalogSchedulerExecutors(client: CatalogSchedulerRpcClient) {
  return {
    async publish(change: CatalogScheduledChange): Promise<unknown> {
      if (change.changeKind !== 'CATALOG_PUBLISH') {
        throw new Error('catalog_scheduler_change_kind_mismatch');
      }
      const draftId = requiredString(
        change.payload['draftId'],
        'catalog_scheduler_payload_invalid',
      );
      const expectedDraftRevision = positiveIntegerFromPayload(
        change.payload,
        'expectedDraftRevision',
      );
      if (change.targetBasePublishVersion === null) {
        throw new Error('catalog_scheduler_publish_version_required');
      }
      return client.rpc<unknown>('publish_catalog_draft_v1', {
        p_employee_id: change.createdByEmployeeId,
        p_draft_id: draftId,
        p_expected_draft_revision: expectedDraftRevision,
        p_expected_base_publish_version: change.targetBasePublishVersion,
      });
    },

    async setAvailability(change: CatalogScheduledChange): Promise<unknown> {
      if (change.changeKind !== 'PRODUCT_AVAILABILITY') {
        throw new Error('catalog_scheduler_change_kind_mismatch');
      }
      const productId = requiredString(
        change.payload['productId'],
        'catalog_scheduler_payload_invalid',
      );
      const soldOut = change.payload['soldOut'];
      if (typeof soldOut !== 'boolean') throw new Error('catalog_scheduler_payload_invalid');
      return client.rpc<unknown>('set_immediate_product_availability_v1', {
        p_employee_id: change.createdByEmployeeId,
        p_shop_id: change.shopId,
        p_product_id: productId,
        p_sold_out: soldOut,
      });
    },
  };
}

export async function runCatalogScheduler(
  dependencies: CatalogSchedulerDependencies,
): Promise<CatalogSchedulerRunResult> {
  const now = (dependencies.now ?? (() => new Date()))();
  if (!Number.isFinite(now.getTime())) throw new Error('catalog_scheduler_invalid_clock');

  const batchSize = dependencies.batchSize ?? 25;
  if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 100) {
    throw new Error('catalog_scheduler_invalid_batch_size');
  }

  const claimed = await dependencies.store.claimDue({
    now: now.toISOString(),
    limit: batchSize,
  });

  let applied = 0;
  let failed = 0;

  for (const change of claimed) {
    try {
      const scheduledAt = new Date(change.scheduledFor);
      if (!Number.isFinite(scheduledAt.getTime()) || scheduledAt.getTime() > now.getTime()) {
        throw new Error('catalog_scheduler_claimed_change_not_due');
      }

      const result =
        change.changeKind === 'CATALOG_PUBLISH'
          ? await dependencies.publish(change)
          : await dependencies.setAvailability(change);
      assertSuccessfulExecution(result);

      await dependencies.store.markApplied({
        id: change.id,
        idempotencyKey: change.idempotencyKey,
        result,
      });
      applied += 1;
    } catch (error) {
      await dependencies.store.markFailed({
        id: change.id,
        idempotencyKey: change.idempotencyKey,
        error: schedulerErrorMessage(error),
      });
      failed += 1;
    }
  }

  return { claimed: claimed.length, applied, failed };
}

export async function handleCatalogSchedulerRequest(input: {
  method: string | undefined;
  authorization: string | undefined;
  cronSecret: string | undefined;
  runScheduler: () => Promise<CatalogSchedulerRunResult>;
}): Promise<CatalogSchedulerHttpResult> {
  if (input.method !== 'GET') {
    return {
      statusCode: 405,
      headers: { Allow: 'GET' },
      body: { error: 'method_not_allowed' },
    };
  }

  const secret = input.cronSecret?.trim() ?? '';
  if (secret === '') {
    return { statusCode: 503, body: { error: 'cron_secret_not_configured' } };
  }
  if (input.authorization !== `Bearer ${secret}`) {
    return { statusCode: 401, body: { error: 'unauthorized' } };
  }

  try {
    return { statusCode: 200, body: await input.runScheduler() };
  } catch {
    return { statusCode: 503, body: { error: 'catalog_scheduler_unavailable' } };
  }
}
