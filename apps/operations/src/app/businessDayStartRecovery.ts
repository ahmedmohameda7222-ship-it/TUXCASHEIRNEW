import {
  operationsSyncPayloadJson,
  parseEntityId,
  type BusinessDayId,
  type OpenBusinessDay,
  type OutboxEventId,
  type ShopId,
} from '@tux/domain';
import type { OperationsDatabase } from '@tux/persistence';

export async function recoverMissingBusinessDayStart(input: {
  readonly database: OperationsDatabase;
  readonly businessDayId: BusinessDayId;
  readonly shopId: ShopId;
  readonly createUuid: () => string;
}): Promise<'RECOVERED' | 'PRESENT' | 'RECONSTRUCTED'> {
  return input.database.transaction(async (transaction) => {
    const recovery = await transaction.outbox.recoverMissingBusinessDayStart(input.businessDayId);
    if (recovery !== 'MISSING') return recovery;

    const localDay = await transaction.businessDays.getById(input.businessDayId);
    if (localDay === null || localDay.shopId !== input.shopId) {
      throw new Error('The missing canonical Business Day has no matching local authority.');
    }
    const startedDay: OpenBusinessDay =
      localDay.status === 'OPEN'
        ? localDay
        : {
            ...localDay,
            status: 'OPEN',
            endedAt: null,
            endedByWorkerId: null,
          };
    await transaction.outbox.append({
      id: parseEntityId<OutboxEventId>(input.createUuid()),
      shopId: input.shopId,
      businessDayId: input.businessDayId,
      aggregateType: 'BUSINESS_DAY',
      aggregateId: input.businessDayId,
      aggregateRevision: 0,
      eventType: 'BUSINESS_DAY_STARTED',
      idempotencyKey: `business_day_started:${input.businessDayId}`,
      payloadVersion: 1,
      payload: operationsSyncPayloadJson({
        eventType: 'BUSINESS_DAY_STARTED',
        version: 1,
        businessDay: startedDay,
      }),
      createdAt: startedDay.startedAt,
      attemptCount: 0,
      nextAttemptAt: null,
      lastError: null,
      deliveredAt: null,
    });
    return 'RECONSTRUCTED';
  });
}
