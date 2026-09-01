import {
  createOpenBusinessDay,
  operationsSyncPayloadJson,
  parseEntityId,
  type AuditEvent,
  type AuditEventId,
  type BusinessDayId,
  type EntityId,
  type Instant,
  type OpenBusinessDay,
  type OperationsSyncPayloadV1,
  type OutboxEvent,
  type OutboxEventId,
  type Shop,
  type ShopId,
  type Worker,
  type WorkerId,
  type WorkerSession,
  type WorkerSessionId,
} from '@tux/domain';
import type { OperationsDatabase, OperatorSessionReadModel } from '@tux/persistence';
import type { ApplicationError } from './errors';
import { err, ok, type Result } from './result';

export interface PinVerifier {
  verify(pin: string, storedHash: string): Promise<boolean>;
}

export interface SessionRuntime {
  now(): Instant;
  createUuid(): string;
}

export interface OperatorSummary {
  readonly id: WorkerId;
  readonly displayName: string;
}

export type OperationsSessionState =
  | { readonly status: 'CONFIGURATION_REQUIRED'; readonly message: string }
  | { readonly status: 'NO_ACTIVE_DAY'; readonly shopId: ShopId }
  | {
      readonly status: 'SIGN_IN_REQUIRED';
      readonly shopId: ShopId;
      readonly businessDayId: BusinessDayId;
      readonly businessDayStartedAt: Instant;
    }
  | {
      readonly status: 'ACTIVE';
      readonly shopId: ShopId;
      readonly businessDayId: BusinessDayId;
      readonly businessDayStartedAt: Instant;
      readonly operator: OperatorSummary;
    };

export type OperationsSessionResult = Result<OperationsSessionState, ApplicationError>;

function localPersistenceError(message: string, cause: unknown): ApplicationError {
  return { code: 'LOCAL_PERSISTENCE_ERROR', message, cause };
}

function configurationState(message: string): OperationsSessionState {
  return { status: 'CONFIGURATION_REQUIRED', message };
}

export function greetingForHour(hour: number, workerName: string): string {
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
    throw new RangeError('Greeting hour must be an integer from 0 through 23.');
  }
  const salutation = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  return `${salutation}, ${workerName}.`;
}

export class OperationsSessionService {
  readonly #database: OperationsDatabase;
  readonly #readModel: OperatorSessionReadModel;
  readonly #pinVerifier: PinVerifier;
  readonly #runtime: SessionRuntime;
  #tail: Promise<void> = Promise.resolve();

  constructor(
    database: OperationsDatabase,
    readModel: OperatorSessionReadModel,
    pinVerifier: PinVerifier,
    runtime: SessionRuntime,
  ) {
    this.#database = database;
    this.#readModel = readModel;
    this.#pinVerifier = pinVerifier;
    this.#runtime = runtime;
  }

  async getState(): Promise<OperationsSessionResult> {
    return this.#exclusive(async () => this.#getStateUnlocked());
  }

  async submitPin(pin: string): Promise<OperationsSessionResult> {
    return this.#exclusive(async () => {
      if (pin.length === 0 || !/^\d+$/.test(pin)) {
        return err({ code: 'VALIDATION_ERROR', message: 'Enter a valid PIN.' });
      }

      try {
        const shop = await this.#resolveShop();
        if (shop === null) {
          return ok(configurationState('This device is not assigned to exactly one active shop.'));
        }
        if (!(await this.#hasActivatedConfiguration(shop.id))) {
          return ok(configurationState('This device does not have an activated Operations configuration.'));
        }

        const workers = await this.#readModel.listActiveWorkers(shop.id);
        let authenticatedWorker: Worker | null = null;
        for (const worker of workers) {
          const matches = await this.#pinVerifier.verify(pin, worker.pinHash);
          if (matches && authenticatedWorker === null) authenticatedWorker = worker;
        }
        if (authenticatedWorker === null) {
          return err({ code: 'PIN_AUTH_ERROR', message: 'Invalid PIN.' });
        }

        const initialDay = await this.#database.transaction((transaction) =>
          transaction.businessDays.getOpenForShop(shop.id),
        );
        const existingSession =
          initialDay?.status === 'OPEN'
            ? await this.#readModel.getOpenWorkerSession(initialDay.id)
            : null;

        const now = this.#runtime.now();
        const worker = authenticatedWorker;
        const activeState = await this.#database.transaction(async (transaction) => {
          const persistedWorker = await transaction.workers.getById(worker.id);
          if (
            persistedWorker === null ||
            !persistedWorker.active ||
            persistedWorker.shopId !== shop.id
          ) {
            throw new Error('Authenticated worker is no longer active for this shop.');
          }

          const currentDay = await transaction.businessDays.getOpenForShop(shop.id);
          const day: OpenBusinessDay =
            currentDay === null
              ? createOpenBusinessDay({
                  id: this.#id<BusinessDayId>(),
                  shopId: shop.id,
                  startedAt: now,
                  startedByWorkerId: worker.id,
                })
              : currentDay.status === 'OPEN'
                ? currentDay
                : (() => {
                    throw new Error('Closed Business Day returned from open-day query.');
                  })();

          if (currentDay === null) {
            await transaction.businessDays.put(day);
            await transaction.audit.append(
              this.#audit(shop.id, 'BUSINESS_DAY_STARTED', day.id, day.id, worker.id, now, {
                startedByWorkerId: worker.id,
              }),
            );
            await transaction.outbox.append(
              this.#outbox(shop.id, 'BUSINESS_DAY_STARTED', day.id, day.id, now, {
                eventType: 'BUSINESS_DAY_STARTED',
                version: 1,
                businessDay: day,
              }),
            );
          }

          const openExistingSession =
            existingSession !== null &&
            existingSession.businessDayId === day.id &&
            existingSession.endedAt === null
              ? existingSession
              : null;

          if (openExistingSession?.workerId === worker.id) {
            return this.#activeState(shop, day, worker);
          }

          const closedPreviousSession: WorkerSession | null =
            openExistingSession === null ? null : { ...openExistingSession, endedAt: now };
          if (closedPreviousSession !== null) {
            await transaction.workerSessions.put(closedPreviousSession);
          }

          const newSession: WorkerSession = {
            id: this.#id<WorkerSessionId>(),
            shopId: shop.id,
            businessDayId: day.id,
            workerId: worker.id,
            startedAt: now,
            endedAt: null,
          };
          await transaction.workerSessions.put(newSession);

          const switched =
            openExistingSession !== null && openExistingSession.workerId !== worker.id;
          const eventType = switched ? 'WORKER_SWITCHED' : 'WORKER_SIGNED_IN';
          await transaction.audit.append(
            this.#audit(shop.id, eventType, day.id, newSession.id, worker.id, now, {
              workerId: worker.id,
              previousWorkerId: switched ? openExistingSession.workerId : null,
            }),
          );
          await transaction.outbox.append(
            this.#outbox(shop.id, eventType, day.id, newSession.id, now, {
              eventType,
              version: 1,
              session: newSession,
              previousSession: closedPreviousSession,
            }),
          );

          return this.#activeState(shop, day, worker);
        });

        return ok(activeState);
      } catch (cause) {
        return err(localPersistenceError('Could not update the local operator session.', cause));
      }
    });
  }

  async signOut(): Promise<OperationsSessionResult> {
    return this.#exclusive(async () => {
      try {
        const shop = await this.#resolveShop();
        if (shop === null) {
          return ok(configurationState('This device is not assigned to exactly one active shop.'));
        }
        if (!(await this.#hasActivatedConfiguration(shop.id))) {
          return ok(configurationState('This device does not have an activated Operations configuration.'));
        }
        const day = await this.#database.transaction((transaction) =>
          transaction.businessDays.getOpenForShop(shop.id),
        );
        if (day === null || day.status !== 'OPEN') {
          return ok({ status: 'NO_ACTIVE_DAY', shopId: shop.id });
        }
        const session = await this.#readModel.getOpenWorkerSession(day.id);
        if (session === null || session.endedAt !== null) {
          return ok({
            status: 'SIGN_IN_REQUIRED',
            shopId: shop.id,
            businessDayId: day.id,
            businessDayStartedAt: day.startedAt,
          });
        }

        const now = this.#runtime.now();
        const closedSession: WorkerSession = { ...session, endedAt: now };
        await this.#database.transaction(async (transaction) => {
          await transaction.workerSessions.put(closedSession);
          await transaction.audit.append(
            this.#audit(shop.id, 'WORKER_SIGNED_OUT', day.id, session.id, session.workerId, now, {
              workerId: session.workerId,
            }),
          );
          await transaction.outbox.append(
            this.#outbox(shop.id, 'WORKER_SIGNED_OUT', day.id, session.id, now, {
              eventType: 'WORKER_SIGNED_OUT',
              version: 1,
              session: closedSession,
              previousSession: null,
            }),
          );
        });

        return ok({
          status: 'SIGN_IN_REQUIRED',
          shopId: shop.id,
          businessDayId: day.id,
          businessDayStartedAt: day.startedAt,
        });
      } catch (cause) {
        return err(localPersistenceError('Could not sign out the current operator.', cause));
      }
    });
  }

  async #getStateUnlocked(): Promise<OperationsSessionResult> {
    try {
      const shop = await this.#resolveShop();
      if (shop === null) {
        return ok(configurationState('This device is not assigned to exactly one active shop.'));
      }
      if (!(await this.#hasActivatedConfiguration(shop.id))) {
        return ok(configurationState('This device does not have an activated Operations configuration.'));
      }
      const day = await this.#database.transaction((transaction) =>
        transaction.businessDays.getOpenForShop(shop.id),
      );
      if (day === null || day.status !== 'OPEN') {
        return ok({ status: 'NO_ACTIVE_DAY', shopId: shop.id });
      }
      const session = await this.#readModel.getOpenWorkerSession(day.id);
      if (session === null || session.endedAt !== null) {
        return ok({
          status: 'SIGN_IN_REQUIRED',
          shopId: shop.id,
          businessDayId: day.id,
          businessDayStartedAt: day.startedAt,
        });
      }
      const worker = await this.#database.transaction((transaction) =>
        transaction.workers.getById(session.workerId),
      );
      if (worker === null || !worker.active || worker.shopId !== shop.id) {
        return ok(configurationState('The active worker session cannot be resolved safely.'));
      }
      return ok(this.#activeState(shop, day, worker));
    } catch (cause) {
      return err(localPersistenceError('Could not read the local operator session.', cause));
    }
  }

  async #resolveShop(): Promise<Shop | null> {
    const shops = await this.#readModel.listActiveShops();
    return shops.length === 1 ? (shops[0] ?? null) : null;
  }

  async #hasActivatedConfiguration(shopId: ShopId): Promise<boolean> {
    const snapshot = await this.#database.transaction((transaction) =>
      transaction.configuration.getForShop(shopId),
    );
    return snapshot !== null && snapshot.shopId === shopId && snapshot.version > 0;
  }

  #activeState(shop: Shop, day: OpenBusinessDay, worker: Worker): OperationsSessionState {
    return {
      status: 'ACTIVE',
      shopId: shop.id,
      businessDayId: day.id,
      businessDayStartedAt: day.startedAt,
      operator: { id: worker.id, displayName: worker.displayName },
    };
  }

  #id<Id extends EntityId>(): Id {
    return parseEntityId<Id>(this.#runtime.createUuid());
  }

  #audit(
    shopId: ShopId,
    eventType: AuditEvent['eventType'],
    businessDayId: BusinessDayId,
    aggregateId: EntityId,
    workerId: WorkerId,
    createdAt: Instant,
    details: AuditEvent['details'],
  ): AuditEvent {
    return {
      id: this.#id<AuditEventId>(),
      shopId,
      businessDayId,
      aggregateType: eventType.startsWith('BUSINESS_DAY') ? 'BUSINESS_DAY' : 'WORKER_SESSION',
      aggregateId,
      eventType,
      workerId,
      createdAt,
      details,
    };
  }

  #outbox(
    shopId: ShopId,
    eventType: OperationsSyncPayloadV1['eventType'],
    businessDayId: BusinessDayId,
    aggregateId: EntityId,
    createdAt: Instant,
    payload: OperationsSyncPayloadV1,
  ): OutboxEvent {
    return {
      id: this.#id<OutboxEventId>(),
      shopId,
      businessDayId,
      aggregateType: eventType.startsWith('BUSINESS_DAY') ? 'BUSINESS_DAY' : 'WORKER_SESSION',
      aggregateId,
      aggregateRevision:
        eventType === 'BUSINESS_DAY_STARTED' ||
        eventType === 'WORKER_SIGNED_IN' ||
        eventType === 'WORKER_SWITCHED'
          ? 0
          : 1,
      eventType,
      idempotencyKey: `${eventType.toLowerCase()}:${aggregateId}`,
      payloadVersion: 1,
      payload: operationsSyncPayloadJson(payload),
      createdAt,
      attemptCount: 0,
      nextAttemptAt: null,
      lastError: null,
      deliveredAt: null,
    };
  }

  async #exclusive<ResultValue>(work: () => Promise<ResultValue>): Promise<ResultValue> {
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
