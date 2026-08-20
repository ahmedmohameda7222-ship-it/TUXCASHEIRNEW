import { ApplicationCommandCoordinator } from '@tux/application';
import {
  instant,
  operationsSyncPayloadJson,
  parseEntityId,
  type BusinessDayId,
  type OutboxEvent,
  type OutboxEventId,
  type ShopId,
  type WorkerId,
} from '@tux/domain';
import type { OperationsDatabase, OperationsTransaction } from '@tux/persistence';
import { describe, expect, it } from 'vitest';
import { HttpOutboxTransport } from './httpTransport';
import { OutboxDeliveryError, OutboxSyncService, type OutboxTransport } from './outboxSync';

const shopId = parseEntityId<ShopId>('11111111-1111-4111-8111-111111111111');
const businessDayId = parseEntityId<BusinessDayId>('22222222-2222-4222-8222-222222222222');
const workerId = parseEntityId<WorkerId>('33333333-3333-4333-8333-333333333333');
const createdAt = instant('2026-08-20T00:00:00.000Z');

function event(value: string): OutboxEvent {
  const eventId = parseEntityId<OutboxEventId>(value);
  const businessDay = {
    id: businessDayId,
    shopId,
    status: 'OPEN' as const,
    startedAt: createdAt,
    endedAt: null,
    startedByWorkerId: workerId,
    endedByWorkerId: null,
    lastAllocatedDisplayOrderNo: 0,
  };
  return {
    id: eventId,
    shopId,
    businessDayId,
    aggregateType: 'BUSINESS_DAY',
    aggregateId: businessDayId,
    aggregateRevision: 0,
    eventType: 'BUSINESS_DAY_STARTED',
    idempotencyKey: `business-day-started:${eventId}`,
    payloadVersion: 1,
    payload: operationsSyncPayloadJson({
      eventType: 'BUSINESS_DAY_STARTED',
      version: 1,
      businessDay,
    }),
    createdAt,
    attemptCount: 0,
    nextAttemptAt: null,
    lastError: null,
    deliveredAt: null,
  };
}

function fakeDatabase(initial: readonly OutboxEvent[]) {
  const pending = [...initial];
  const delivered: string[] = [];
  const quarantined: string[] = [];
  const failures: Array<{ id: string; attemptCount: number; error: string }> = [];
  const outbox = {
    append: async () => undefined,
    listPending: async () =>
      pending.filter(
        (candidate) => !delivered.includes(candidate.id) && !quarantined.includes(candidate.id),
      ),
    markDelivered: async (id: OutboxEventId) => {
      delivered.push(id);
    },
    recordFailure: async (
      id: OutboxEventId,
      attemptCount: number,
      _nextAttemptAt: string,
      lastError: string,
    ) => {
      failures.push({ id, attemptCount, error: lastError });
    },
    quarantine: async (id: OutboxEventId) => {
      quarantined.push(id);
    },
    quarantineDependents: async () => 0,
  };
  const database = {
    transaction: async <Result>(work: (transaction: OperationsTransaction) => Promise<Result>) =>
      work({ outbox } as unknown as OperationsTransaction),
  } satisfies OperationsDatabase;
  return { database, delivered, quarantined, failures };
}

describe('outbox hardening', () => {
  it('does not hold the application business-command coordinator while transport is pending', async () => {
    const first = event('44444444-4444-4444-8444-444444444444');
    const state = fakeDatabase([first]);
    let releaseTransport = (): void => undefined;
    let signalStarted = (): void => undefined;
    const started = new Promise<void>((resolve) => {
      signalStarted = resolve;
    });
    const transport: OutboxTransport = {
      deliver: async () => {
        signalStarted();
        await new Promise<void>((resolve) => {
          releaseTransport = resolve;
        });
      },
    };
    const service = new OutboxSyncService(state.database, transport, { now: () => createdAt });
    const coordinator = new ApplicationCommandCoordinator();

    const syncing = service.syncOnce();
    await started;
    const localCommand = await coordinator.runExclusive(async () => 'local-command-complete');
    expect(localCommand).toBe('local-command-complete');
    expect(state.delivered).toEqual([]);

    releaseTransport();
    await syncing;
    expect(state.delivered).toEqual([first.id]);
  });

  it('turns an HTTP timeout into retry metadata instead of hanging forever', async () => {
    const first = event('55555555-5555-4555-8555-555555555555');
    const state = fakeDatabase([first]);
    const fetcher: typeof fetch = (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          'abort',
          () => reject(new DOMException('Aborted', 'AbortError')),
          { once: true },
        );
      });
    const transport = new HttpOutboxTransport({
      endpoint: 'http://127.0.0.1:54321/functions/v1/operations-ingest',
      timeoutMs: 5,
      fetcher,
    });
    const service = new OutboxSyncService(state.database, transport, { now: () => createdAt });

    const summary = await service.syncOnce();
    expect(summary.failed).toBe(1);
    expect(summary.lastError).toMatch(/timed out/i);
    expect(state.failures).toHaveLength(1);
    expect(state.failures[0]).toMatchObject({ id: first.id, attemptCount: 1 });
    expect(state.delivered).toEqual([]);
  });

  it('quarantines a permanent protocol failure and continues with later events', async () => {
    const first = event('66666666-6666-4666-8666-666666666666');
    const second = event('77777777-7777-4777-8777-777777777777');
    const state = fakeDatabase([first, second]);
    const transport: OutboxTransport = {
      deliver: async (candidate) => {
        if (candidate.id === first.id) {
          throw new OutboxDeliveryError('Unsupported payload version.', 'PERMANENT', 422);
        }
      },
    };
    const service = new OutboxSyncService(state.database, transport, { now: () => createdAt });

    const summary = await service.syncOnce();
    expect(summary).toMatchObject({ attempted: 2, delivered: 1, failed: 0, quarantined: 1 });
    expect(state.quarantined).toEqual([first.id]);
    expect(state.delivered).toEqual([second.id]);
  });
});
