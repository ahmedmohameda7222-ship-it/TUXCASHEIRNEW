import {
  createOpenBusinessDay,
  parseEntityId,
  type AuditEvent,
  type AuditEventId,
  type BusinessDayId,
  type EntityId,
  type Instant,
  type OpenBusinessDay,
  type OutboxEvent,
  type OutboxEventId,
  type Shop,
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
  | {
      readonly status: 'CONFIGURATION_REQUIRED';
      readonly message: string;
    }
  | {
      readonly status: 'NO_ACTIVE_DAY';
      readonly shopId: Shop['id'];
    }
  | {
      readonly status: 'SIGN_IN_REQUIRED';
      readonly shopId: Shop['id'];
      readonly businessDayId: BusinessDayId;
      readonly businessDayStartedAt: Instant;
    }
  | {
      readonly status: 'ACTIVE';
      readonly shopId: Shop['id'];
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
        const shopResolution = await this.#resolveShop();
        if (shopResolution === null) {
          return ok(configurationState('This device is not assigned to exactly one active shop.'));
        }

        const workers = await this.#readModel.listActiveWorkers(shopResolution.id);
        let authenticatedWorker: Worker | null = null;
        for (const worker of workers) {
          const matches = await this.#pinVerifier.verify(pin, worker.pinHash);
          if (matches && authenticatedWorker === null) {
            authenticatedWorker = worker;
          }
        }
        if (authenticatedWorker === null) {
          return err({ code: 'PIN_AUTH_ERROR', message: 'Invalid PIN.' });
        }

        const initialDay = await this.#database.transaction((transaction) =>
          transaction.businessDays.getOpenForShop(shopResolution.id),
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
            persistedWorker.shopId !== shopResolution.id
          ) {
            throw new Error('Authenticated worker is no longer active for this shop.');
          }

          const currentDay = await transaction.businessDays.getOpenForShop(shopResolution.id);
          const day: OpenBusinessDay =
            currentDay === null
              ? createOpenBusinessDay({
                  id: this.#id<BusinessDayId>(),
                  shopId: shopResolution.id,
                  startedAt: now,
                  startedByWorkerId: worker.id,
                })
              : currentDay.status === 'OPEN'
                ? currentDay
                : (() => {
                    throw new Error('Closed Business Day returned from open-day query.');
                  })();

          const dayWasCreated = currentDay === null;
          if (dayWasCreated) {
            await transaction.businessDays.put(day);
            await transaction.audit.append(
              this.#audit('BUSINESS_DAY_STARTED', day.id, day.id, worker.id, now, {
                startedByWorkerId: worker.id,
              }),
            );
            await transaction.outbox.append(
              this.#outbox('BUSINESS_DAY_STARTED', day.id, day.id, now, {
                businessDayId: day.id,
                startedByWorkerId: worker.id,
              }),
            );
          }

          const sessionBelongsToCurrentDay =
            existingSession !== null && existingSession.businessDayId === day.id;
          if (
            sessionBelongsToCurrentDay &&
            existingSession.endedAt === null &&
            existingSession.workerId === worker.id
          ) {
            return this.#activeState(shopResolution, day, worker);
          }

          if (sessionBelongsToCurrentDay && existingSession.endedAt === null) {
            await transaction.workerSessions.put({ ...existingSession, endedAt: now });
          }

          const newSession: WorkerSession = {
            id: this.#id<WorkerSessionId>(),
            shopId: shopResolution.id,
            businessDayId: day.id,
            workerId: worker.id,
            startedAt: now,
            endedAt: null,
          };
          await transaction.workerSessions.put(newSession);

          const switched = sessionBelongsToCurrentDay && existingSession.workerId !== worker.id;
          const eventType = switched ? 'WORKER_SWITCHED' : 'WORKER_SIGNED_IN';
          await transaction.audit.append(
            this.#audit(eventType, day.id, newSession.id, worker.id, now, {
              workerId: worker.id,
              previousWorkerId: switched ? existingSession.workerId : null,
            }),
          );
          await transaction.outbox.append(
            this.#outbox(eventType, day.id, newSession.id, now, {
              businessDayId: day.id,
              workerId: worker.id,
              previousWorkerId: switched ? existingSession.workerId : null,
            }),
          );

          return this.#activeState(shopResolution, day, worker);
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
        await this.#database.transaction(async (transaction) => {
          await transaction.workerSessions.put({ ...session, endedAt: now });
          await transaction.audit.append(
            this.#audit('WORKER_SIGNED_OUT', day.id, session.id, session.workerId, now, {
              workerId: session.workerId,
            }),
          );
          await transaction.outbox.append(
            this.#outbox('WORKER_SIGNED_OUT', day.id, session.id, now, {
              businessDayId: day.id,
              workerId: session.workerId,
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
    eventType: AuditEvent['eventType'],
    businessDayId: BusinessDayId,
    aggregateId: EntityId,
    workerId: WorkerId,
    createdAt: Instant,
    details: AuditEvent['details'],
  ): AuditEvent {
    return {
      id: this.#id<AuditEventId>(),
      shopId: businessDayId === aggregateId ? undefinedShopIdNever() : undefinedShopIdNever(),
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
    eventType: string,
    businessDayId: BusinessDayId,
    aggregateId: EntityId,
    createdAt: Instant,
    payload: OutboxEvent['payload'],
  ): OutboxEvent {
    return {
      id: this.#id<OutboxEventId>(),
      shopId: undefinedShopIdNever(),
      businessDayId,
      aggregateType: eventType.startsWith('BUSINESS_DAY') ? 'BUSINESS_DAY' : 'WORKER_SESSION',
      aggregateId,
      eventType,
      idempotencyKey: `${eventType.toLowerCase()}:${aggregateId}`,
      payloadVersion: 1,
      payload,
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

function undefinedShopIdNever(): never {
  throw new Error('Internal shopId placeholder must be replaced before runtime.');
}
