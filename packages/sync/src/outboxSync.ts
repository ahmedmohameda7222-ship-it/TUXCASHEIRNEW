import type { Instant, OutboxEvent } from '@tux/domain';
import type { OperationsDatabase } from '@tux/persistence';

export interface OutboxTransport {
  deliver(event: OutboxEvent): Promise<void>;
}

export interface OutboxSyncRuntime {
  now(): Instant;
}

export interface OutboxSyncCoordinator {
  runExclusive<Result>(work: () => Promise<Result>): Promise<Result>;
}

export interface OutboxSyncSummary {
  readonly attempted: number;
  readonly delivered: number;
  readonly failed: number;
  readonly blockedUntil: Instant | null;
  readonly lastError: string | null;
}

const DEFAULT_BATCH_SIZE = 50;
const BASE_RETRY_MS = 2_000;
const MAX_RETRY_MS = 5 * 60_000;

export function outboxRetryDelayMs(attemptCount: number): number {
  if (!Number.isSafeInteger(attemptCount) || attemptCount <= 0) {
    throw new RangeError('Outbox retry attempt count must be a positive safe integer.');
  }
  const exponent = Math.min(attemptCount - 1, 30);
  return Math.min(BASE_RETRY_MS * 2 ** exponent, MAX_RETRY_MS);
}

export function nextOutboxRetryAt(now: Instant, attemptCount: number): Instant {
  const timestamp = Date.parse(now);
  if (!Number.isFinite(timestamp)) throw new RangeError('Outbox retry time must be valid.');
  return new Date(timestamp + outboxRetryDelayMs(attemptCount)).toISOString() as Instant;
}

function normalizedError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.trim().slice(0, 1_000) || 'Remote outbox delivery failed.';
}

export class OutboxSyncService {
  readonly #database: OperationsDatabase;
  readonly #transport: OutboxTransport;
  readonly #runtime: OutboxSyncRuntime;
  readonly #coordinator: OutboxSyncCoordinator;

  constructor(
    database: OperationsDatabase,
    transport: OutboxTransport,
    runtime: OutboxSyncRuntime,
    coordinator: OutboxSyncCoordinator,
  ) {
    this.#database = database;
    this.#transport = transport;
    this.#runtime = runtime;
    this.#coordinator = coordinator;
  }

  async syncOnce(limit = DEFAULT_BATCH_SIZE): Promise<OutboxSyncSummary> {
    if (!Number.isSafeInteger(limit) || limit <= 0 || limit > 500) {
      throw new RangeError('Outbox sync batch size must be between 1 and 500.');
    }

    return this.#coordinator.runExclusive(async () => {
      const now = this.#runtime.now();
      const pending = await this.#database.transaction((transaction) =>
        transaction.outbox.listPending(now, limit),
      );
      let delivered = 0;

      for (const event of pending) {
        try {
          await this.#transport.deliver(event);
          const deliveredAt = this.#runtime.now();
          await this.#database.transaction((transaction) =>
            transaction.outbox.markDelivered(event.id, deliveredAt),
          );
          delivered += 1;
        } catch (error) {
          const attemptCount = event.attemptCount + 1;
          const failedAt = this.#runtime.now();
          const nextAttemptAt = nextOutboxRetryAt(failedAt, attemptCount);
          const lastError = normalizedError(error);
          await this.#database.transaction((transaction) =>
            transaction.outbox.recordFailure(
              event.id,
              attemptCount,
              nextAttemptAt,
              lastError,
            ),
          );
          return {
            attempted: delivered + 1,
            delivered,
            failed: 1,
            blockedUntil: nextAttemptAt,
            lastError,
          };
        }
      }

      return {
        attempted: pending.length,
        delivered,
        failed: 0,
        blockedUntil: null,
        lastError: null,
      };
    });
  }
}
