export type CatalogScheduledChangeKind = 'CATALOG_PUBLISH' | 'PRODUCT_AVAILABILITY';

export type CatalogScheduledChange = {
  id: string;
  businessId: string;
  shopId: string;
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
  markApplied(input: {
    id: string;
    idempotencyKey: string;
    result: unknown;
  }): Promise<void>;
  markFailed(input: {
    id: string;
    idempotencyKey: string;
    error: string;
  }): Promise<void>;
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

function schedulerErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message.slice(0, 512);
  return 'catalog_scheduler_execution_failed';
}

function assertSuccessfulExecution(result: unknown): void {
  if (
    typeof result === 'object' &&
    result !== null &&
    'ok' in result &&
    (result as { ok?: unknown }).ok === false
  ) {
    throw new Error('catalog_scheduler_command_rejected');
  }
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
