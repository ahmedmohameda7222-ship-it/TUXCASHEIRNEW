import type { Instant, OutboxEvent } from '@tux/domain';
import type { OperationsDatabase } from '@tux/persistence';

export type OutboxFailureKind = 'TRANSIENT' | 'PERMANENT';

export class OutboxDeliveryError extends Error {
  readonly kind: OutboxFailureKind;
  readonly status: number | null;

  constructor(
    message: string,
    kind: OutboxFailureKind,
    status: number | null = null,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'OutboxDeliveryError';
    this.kind = kind;
    this.status = status;
  }
}

export interface OutboxTransport {
  deliver(event: OutboxEvent): Promise<void>;
}

export interface OutboxSyncRuntime {
  now(): Instant;
}

export interface OutboxSyncSummary {
  readonly attempted: number;
  readonly delivered: number;
  readonly failed: number;
  readonly quarantined: number;
  readonly dependencyBlocked: number;
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

function failureKind(error: unknown): OutboxFailureKind {
  return error instanceof OutboxDeliveryError ? error.kind : 'TRANSIENT';
}

export class OutboxSyncService {
  readonly #database: OperationsDatabase;
  readonly #transport: OutboxTransport;
  readonly #runtime: OutboxSyncRuntime;
  #tail: Promise<void> = Promise.resolve();

  constructor(
    database: OperationsDatabase,
    transport: OutboxTransport,
    runtime: OutboxSyncRuntime,
  ) {
    this.#database = database;
    this.#transport = transport;
    this.#runtime = runtime;
  }

  async syncOnce(limit = DEFAULT_BATCH_SIZE): Promise<OutboxSyncSummary> {
    if (!Number.isSafeInteger(limit) || limit <= 0 || limit > 500) {
      throw new RangeError('Outbox sync batch size must be between 1 and 500.');
    }
    return this.#exclusive(() => this.#syncUnlocked(limit));
  }

  async #syncUnlocked(limit: number): Promise<OutboxSyncSummary> {
    const now = this.#runtime.now();
    const pending = await this.#database.transaction((transaction) =>
      transaction.outbox.listPending(now, limit),
    );
    let delivered = 0;
    let quarantined = 0;
    let dependencyBlocked = 0;
    let attempted = 0;
    let lastPermanentError: string | null = null;
    const blockedAggregateRevisions = new Map<string, number>();

    for (const event of pending) {
      const aggregateKey = `${event.shopId}:${event.aggregateType}:${event.aggregateId}`;
      const blockedAfterRevision = blockedAggregateRevisions.get(aggregateKey);
      if (
        blockedAfterRevision !== undefined &&
        event.aggregateRevision !== null &&
        event.aggregateRevision > blockedAfterRevision
      ) {
        continue;
      }
      attempted += 1;
      try {
        // Network I/O deliberately happens outside every local transaction and outside the
        // application business-command coordinator. Local POS commands remain independent.
        await this.#transport.deliver(event);
        const deliveredAt = this.#runtime.now();
        await this.#database.transaction((transaction) =>
          transaction.outbox.markDelivered(event.id, deliveredAt),
        );
        delivered += 1;
      } catch (error) {
        const lastError = normalizedError(error);
        const failedAt = this.#runtime.now();
        if (failureKind(error) === 'PERMANENT') {
          dependencyBlocked += await this.#database.transaction(async (transaction) => {
            await transaction.outbox.quarantine(event.id, failedAt, lastError);
            return transaction.outbox.quarantineDependents(event, failedAt, lastError);
          });
          if (event.aggregateRevision !== null) {
            blockedAggregateRevisions.set(aggregateKey, event.aggregateRevision);
          }
          quarantined += 1;
          lastPermanentError = lastError;
          continue;
        }

        const attemptCount = event.attemptCount + 1;
        const nextAttemptAt = nextOutboxRetryAt(failedAt, attemptCount);
        await this.#database.transaction((transaction) =>
          transaction.outbox.recordFailure(event.id, attemptCount, nextAttemptAt, lastError),
        );
        return {
          attempted,
          delivered,
          failed: 1,
          quarantined,
          dependencyBlocked,
          blockedUntil: nextAttemptAt,
          lastError,
        };
      }
    }

    return {
      attempted,
      delivered,
      failed: 0,
      quarantined,
      dependencyBlocked,
      blockedUntil: null,
      lastError: lastPermanentError,
    };
  }

  async #exclusive<Result>(work: () => Promise<Result>): Promise<Result> {
    const previous = this.#tail;
    let release = (): void => undefined;
    this.#tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await work();
    } finally {
      release();
    }
  }
}
