import {
  DomainInvariantError,
  buildEndDayReconciliationProjection,
  calculateEndDayFinancialProjection,
  closeBusinessDay,
  endDayReconciliationMethods,
  normalizeEndDayVarianceReason,
  parseEntityId,
  type AuditEvent,
  type AuditEventId,
  type BusinessDay,
  type BusinessDayId,
  type EndDayActualPayment,
  type EntityId,
  type Instant,
  type JsonValue,
  type MoneyMinor,
  type OpenBusinessDay,
  type OperationsConfigurationSnapshot,
  type OrderDraft,
  type OutboxEvent,
  type OutboxEventId,
  type PaymentLogicType,
  type PaymentMethodId,
  type Reconciliation,
  type ReconciliationId,
  type ReconciliationLine,
  type ShopId,
  type Worker,
  type WorkerSession,
} from '@tux/domain';
import type {
  ExpenseLedgerStore,
  OperationsDatabase,
  OperatorSessionReadModel,
  OrderDraftStore,
} from '@tux/persistence';
import { ApplicationCommandCoordinator } from './commandCoordinator';
import type { ApplicationError } from './errors';
import { err, ok, type Result } from './result';

export interface EndDayRuntime {
  now(): Instant;
  createUuid(): string;
}

export interface EndDayPaymentMethod {
  readonly id: PaymentMethodId;
  readonly label: string;
  readonly logicType: PaymentLogicType;
}

export type EndDayGate =
  | {
      readonly kind: 'ACTIVE_ORDERS_BLOCKED';
      readonly businessDayId: BusinessDayId;
      readonly activeOrderNos: readonly number[];
    }
  | {
      readonly kind: 'UNFINISHED_DRAFT';
      readonly businessDayId: BusinessDayId;
    }
  | {
      readonly kind: 'READY';
      readonly businessDayId: BusinessDayId;
      readonly paymentMethods: readonly EndDayPaymentMethod[];
    };

export interface EndDayVarianceInput {
  readonly paymentMethodId: PaymentMethodId;
  readonly reason: string | null;
}

export interface EndDayPreviewLine {
  readonly paymentMethod: EndDayPaymentMethod;
  readonly expectedMinor: MoneyMinor;
  readonly actualMinor: MoneyMinor;
  readonly differenceMinor: MoneyMinor;
  readonly varianceReason: string | null;
}

export interface EndDayPreview {
  readonly businessDayId: BusinessDayId;
  readonly recognizedSalesMinor: MoneyMinor;
  readonly totalExpensesMinor: MoneyMinor;
  readonly cashExpensesMinor: MoneyMinor;
  readonly lines: readonly EndDayPreviewLine[];
}

export interface EndDayCloseResultValue {
  readonly businessDayId: BusinessDayId;
  readonly closedAt: Instant;
  readonly reconciliation: Reconciliation;
  readonly replayed: boolean;
}

export type EndDayGateResult = Result<EndDayGate, ApplicationError>;
export type EndDayPreviewResult = Result<EndDayPreview, ApplicationError>;
export type EndDayCloseResult = Result<EndDayCloseResultValue, ApplicationError>;

interface EndDayContext {
  readonly shopId: ShopId;
  readonly day: OpenBusinessDay;
  readonly configuration: OperationsConfigurationSnapshot;
  readonly operator: Worker;
  readonly session: Extract<WorkerSession, { endedAt: null }>;
}

function persistenceError(message: string, cause: unknown): ApplicationError {
  return { code: 'LOCAL_PERSISTENCE_ERROR', message, cause };
}

function normalizedDraftScopeId(value: string): string {
  const scope = value.trim();
  if (scope.length === 0 || scope.length > 200) {
    throw new DomainInvariantError('Orders draft scope is invalid for End Day.');
  }
  return scope;
}

function hasMeaningfulDraft(draft: OrderDraft | null): boolean {
  if (draft === null) return false;
  return (
    draft.lines.length > 0 ||
    (draft.orderNote?.trim().length ?? 0) > 0 ||
    draft.discountMinor !== 0 ||
    draft.payment.mode !== 'NONE' ||
    draft.delivery.displayPhone.trim().length > 0 ||
    draft.delivery.customerName.trim().length > 0 ||
    draft.delivery.address.trim().length > 0 ||
    draft.delivery.zoneId !== null ||
    draft.delivery.finalFeeMinor !== 0
  );
}

export class OperationsEndDayService {
  readonly #database: OperationsDatabase;
  readonly #readModel: OperatorSessionReadModel;
  readonly #draftStore: OrderDraftStore;
  readonly #expenseStore: ExpenseLedgerStore;
  readonly #runtime: EndDayRuntime;
  readonly #coordinator: ApplicationCommandCoordinator;

  constructor(
    database: OperationsDatabase,
    readModel: OperatorSessionReadModel,
    draftStore: OrderDraftStore,
    expenseStore: ExpenseLedgerStore,
    runtime: EndDayRuntime,
    coordinator = new ApplicationCommandCoordinator(),
  ) {
    this.#database = database;
    this.#readModel = readModel;
    this.#draftStore = draftStore;
    this.#expenseStore = expenseStore;
    this.#runtime = runtime;
    this.#coordinator = coordinator;
  }

  async beginEndDay(draftScopeId: string): Promise<EndDayGateResult> {
    return this.#coordinator.runExclusive(async () => {
      try {
        const scope = normalizedDraftScopeId(draftScopeId);
        const context = await this.#resolveCurrentContext();
        if (!context.ok) return context;
        return ok(await this.#gate(context.value, scope));
      } catch (cause) {
        if (cause instanceof DomainInvariantError) {
          return err({ code: 'VALIDATION_ERROR', message: cause.message, cause });
        }
        return err(persistenceError('Could not start the local End Day workflow.', cause));
      }
    });
  }

  async discardDraft(draftScopeId: string): Promise<Result<true, ApplicationError>> {
    return this.#coordinator.runExclusive(async () => {
      try {
        const scope = normalizedDraftScopeId(draftScopeId);
        const context = await this.#resolveCurrentContext();
        if (!context.ok) return context;
        await this.#draftStore.delete({
          shopId: context.value.shopId,
          businessDayId: context.value.day.id,
          draftScopeId: scope,
        });
        return ok(true as const);
      } catch (cause) {
        if (cause instanceof DomainInvariantError) {
          return err({ code: 'VALIDATION_ERROR', message: cause.message, cause });
        }
        return err(persistenceError('The unfinished draft could not be discarded locally.', cause));
      }
    });
  }

  async previewReconciliation(input: {
    readonly businessDayId: BusinessDayId;
    readonly draftScopeId: string;
    readonly actualPayments: readonly EndDayActualPayment[];
  }): Promise<EndDayPreviewResult> {
    return this.#coordinator.runExclusive(async () => {
      try {
        const contextResult = await this.#resolveExpectedOpenContext(input.businessDayId);
        if (!contextResult.ok) return contextResult;
        const context = contextResult.value;
        const gate = await this.#gate(context, normalizedDraftScopeId(input.draftScopeId));
        if (gate.kind !== 'READY') return err(this.#gateError(gate));
        return ok(await this.#preview(context, input.actualPayments, [], false));
      } catch (cause) {
        if (cause instanceof DomainInvariantError) {
          return err({ code: 'VALIDATION_ERROR', message: cause.message, cause });
        }
        return err(persistenceError('Could not calculate local End Day reconciliation.', cause));
      }
    });
  }

  async closeDay(input: {
    readonly businessDayId: BusinessDayId;
    readonly draftScopeId: string;
    readonly actualPayments: readonly EndDayActualPayment[];
    readonly varianceReasons: readonly EndDayVarianceInput[];
  }): Promise<EndDayCloseResult> {
    return this.#coordinator.runExclusive(async () => {
      try {
        const existingDay = await this.#database.transaction((transaction) =>
          transaction.businessDays.getById(input.businessDayId),
        );
        if (existingDay?.status === 'CLOSED') {
          const reconciliation = await this.#database.transaction((transaction) =>
            transaction.reconciliations.getByBusinessDay(input.businessDayId),
          );
          if (reconciliation === null) {
            return err({
              code: 'LOCAL_PERSISTENCE_ERROR',
              message: 'The Business Day is closed but its reconciliation could not be recovered.',
            });
          }
          return ok({
            businessDayId: existingDay.id,
            closedAt: existingDay.endedAt,
            reconciliation,
            replayed: true,
          });
        }

        const contextResult = await this.#resolveExpectedOpenContext(input.businessDayId);
        if (!contextResult.ok) return contextResult;
        const context = contextResult.value;
        const draftScopeId = normalizedDraftScopeId(input.draftScopeId);
        const gate = await this.#gate(context, draftScopeId);
        if (gate.kind !== 'READY') return err(this.#gateError(gate));

        const preview = await this.#preview(
          context,
          input.actualPayments,
          input.varianceReasons,
          true,
        );
        const closedAt = this.#runtime.now();
        const reconciliation: Reconciliation = {
          id: this.#id<ReconciliationId>(),
          shopId: context.shopId,
          businessDayId: context.day.id,
          createdByWorkerId: context.operator.id,
          createdAt: closedAt,
          lines: preview.lines.map(
            (line): ReconciliationLine => ({
              paymentMethod: {
                id: line.paymentMethod.id,
                label: line.paymentMethod.label,
                logicType: line.paymentMethod.logicType,
              },
              expectedMinor: line.expectedMinor,
              actualMinor: line.actualMinor,
              differenceMinor: line.differenceMinor,
              varianceReason: line.varianceReason,
            }),
          ),
        };
        const closedDay = closeBusinessDay(context.day, closedAt, context.operator.id);
        const closedSession: WorkerSession = { ...context.session, endedAt: closedAt };
        const auditEvents = this.#auditEvents(context, reconciliation, preview, closedAt);
        const outboxEvents = this.#outboxEvents(context, reconciliation, preview, closedAt);

        await this.#database.transaction(async (transaction) => {
          const currentDay = await transaction.businessDays.getById(context.day.id);
          if (
            currentDay === null ||
            currentDay.status !== 'OPEN' ||
            currentDay.shopId !== context.shopId
          ) {
            throw new Error('The Business Day changed before End Day could commit.');
          }
          const currentOpen = await transaction.businessDays.getOpenForShop(context.shopId);
          if (currentOpen === null || currentOpen.id !== context.day.id) {
            throw new Error('The open Business Day changed before End Day could commit.');
          }
          if (
            (await transaction.orders.listByBusinessDay(context.day.id)).some(
              (order) => order.status === 'ACTIVE',
            )
          ) {
            throw new Error('An Active order appeared before End Day could commit.');
          }
          if ((await transaction.reconciliations.getByBusinessDay(context.day.id)) !== null) {
            throw new Error('The Business Day already has a reconciliation.');
          }

          await transaction.reconciliations.put(reconciliation);
          await transaction.workerSessions.put(closedSession);
          await transaction.businessDays.put(closedDay);
          for (const audit of auditEvents) await transaction.audit.append(audit);
          for (const event of outboxEvents) await transaction.outbox.append(event);
        });

        try {
          await this.#draftStore.delete({
            shopId: context.shopId,
            businessDayId: context.day.id,
            draftScopeId,
          });
        } catch {
          // The Business Day is already durably closed. A stale closed-day draft is harmless and cannot
          // become a placed order because checkout requires an OPEN Business Day.
        }

        return ok({
          businessDayId: context.day.id,
          closedAt,
          reconciliation,
          replayed: false,
        });
      } catch (cause) {
        if (cause instanceof DomainInvariantError) {
          return err({ code: 'VALIDATION_ERROR', message: cause.message, cause });
        }
        return err({
          code: 'LOCAL_PERSISTENCE_ERROR',
          message: 'The Business Day remains open because the local End Day commit failed.',
          cause,
        });
      }
    });
  }

  async #gate(context: EndDayContext, draftScopeId: string): Promise<EndDayGate> {
    const orders = await this.#database.transaction((transaction) =>
      transaction.orders.listByBusinessDay(context.day.id),
    );
    const activeOrderNos = orders
      .filter((order) => order.status === 'ACTIVE')
      .map((order) => order.displayOrderNo)
      .sort((left, right) => left - right);
    if (activeOrderNos.length > 0) {
      return {
        kind: 'ACTIVE_ORDERS_BLOCKED',
        businessDayId: context.day.id,
        activeOrderNos,
      };
    }

    const draft = await this.#draftStore.get({
      shopId: context.shopId,
      businessDayId: context.day.id,
      draftScopeId,
    });
    if (hasMeaningfulDraft(draft)) {
      return { kind: 'UNFINISHED_DRAFT', businessDayId: context.day.id };
    }

    return {
      kind: 'READY',
      businessDayId: context.day.id,
      paymentMethods: endDayReconciliationMethods(context.configuration).map((method) => ({
        id: method.id,
        label: method.displayName,
        logicType: method.logicType,
      })),
    };
  }

  async #preview(
    context: EndDayContext,
    actualPayments: readonly EndDayActualPayment[],
    varianceReasons: readonly EndDayVarianceInput[],
    requireReasons: boolean,
  ): Promise<EndDayPreview> {
    const [orders, expenses] = await Promise.all([
      this.#database.transaction((transaction) => transaction.orders.listByBusinessDay(context.day.id)),
      this.#expenseStore.listByBusinessDay(context.day.id),
    ]);
    if (orders.some((order) => order.status === 'ACTIVE')) {
      throw new DomainInvariantError('Active orders must be resolved before End Day.');
    }
    const financial = calculateEndDayFinancialProjection({
      orders,
      expenses,
      configuration: context.configuration,
    });
    const projected = buildEndDayReconciliationProjection(
      financial.expectedPayments,
      actualPayments,
    );
    const reasonByMethod = new Map(
      varianceReasons.map((reason) => [reason.paymentMethodId, reason.reason] as const),
    );
    return {
      businessDayId: context.day.id,
      recognizedSalesMinor: financial.recognizedSalesMinor,
      totalExpensesMinor: financial.totalExpensesMinor,
      cashExpensesMinor: financial.cashExpensesMinor,
      lines: projected.map((line) => ({
        paymentMethod: {
          id: line.paymentMethodId,
          label: line.label,
          logicType: line.logicType,
        },
        expectedMinor: line.expectedMinor,
        actualMinor: line.actualMinor,
        differenceMinor: line.differenceMinor,
        varianceReason: requireReasons
          ? normalizeEndDayVarianceReason(
              line.differenceMinor,
              reasonByMethod.get(line.paymentMethodId),
            )
          : null,
      })),
    };
  }

  #gateError(gate: Exclude<EndDayGate, { kind: 'READY' }>): ApplicationError {
    if (gate.kind === 'ACTIVE_ORDERS_BLOCKED') {
      return {
        code: 'CONFLICT_ERROR',
        message: `End Day is blocked by Active orders: ${gate.activeOrderNos.map((number) => `#${number}`).join(', ')}.`,
      };
    }
    return {
      code: 'CONFLICT_ERROR',
      message: 'End Day is blocked by an unfinished order draft.',
    };
  }

  async #resolveCurrentContext(): Promise<Result<EndDayContext, ApplicationError>> {
    try {
      const shops = await this.#readModel.listActiveShops();
      const shop = shops.length === 1 ? shops[0] : undefined;
      if (shop === undefined) {
        return err({
          code: 'CONFLICT_ERROR',
          message: 'This device is not assigned to exactly one active shop.',
        });
      }
      const day = await this.#database.transaction((transaction) =>
        transaction.businessDays.getOpenForShop(shop.id),
      );
      if (day === null || day.status !== 'OPEN') {
        return err({ code: 'CONFLICT_ERROR', message: 'No active Business Day.' });
      }
      return this.#contextForOpenDay(day);
    } catch (cause) {
      return err(persistenceError('Could not resolve the current End Day session.', cause));
    }
  }

  async #resolveExpectedOpenContext(
    businessDayId: BusinessDayId,
  ): Promise<Result<EndDayContext, ApplicationError>> {
    try {
      const day = await this.#database.transaction((transaction) =>
        transaction.businessDays.getById(businessDayId),
      );
      if (day === null) {
        return err({ code: 'NOT_FOUND', message: 'The Business Day was not found.' });
      }
      if (day.status !== 'OPEN') {
        return err({ code: 'ALREADY_CLOSED', message: 'The Business Day is already closed.' });
      }
      const open = await this.#database.transaction((transaction) =>
        transaction.businessDays.getOpenForShop(day.shopId),
      );
      if (open === null || open.id !== day.id) {
        return err({ code: 'CONFLICT_ERROR', message: 'The active Business Day changed.' });
      }
      return this.#contextForOpenDay(day);
    } catch (cause) {
      return err(persistenceError('Could not resolve the requested End Day session.', cause));
    }
  }

  async #contextForOpenDay(
    day: OpenBusinessDay,
  ): Promise<Result<EndDayContext, ApplicationError>> {
    const [configuration, session] = await Promise.all([
      this.#database.transaction((transaction) => transaction.configuration.getForShop(day.shopId)),
      this.#readModel.getOpenWorkerSession(day.id),
    ]);
    if (configuration === null) {
      return err({ code: 'CONFLICT_ERROR', message: 'Local Operations configuration is unavailable.' });
    }
    if (session === null || session.endedAt !== null) {
      return err({ code: 'CONFLICT_ERROR', message: 'A Current Operator is required.' });
    }
    const worker = await this.#database.transaction((transaction) =>
      transaction.workers.getById(session.workerId),
    );
    if (worker === null || !worker.active || worker.shopId !== day.shopId) {
      return err({ code: 'CONFLICT_ERROR', message: 'The Current Operator is unavailable.' });
    }
    return ok({
      shopId: day.shopId,
      day,
      configuration,
      operator: worker,
      session: session as Extract<WorkerSession, { endedAt: null }>,
    });
  }

  #auditEvents(
    context: EndDayContext,
    reconciliation: Reconciliation,
    preview: EndDayPreview,
    createdAt: Instant,
  ): readonly AuditEvent[] {
    return [
      {
        id: this.#id<AuditEventId>(),
        shopId: context.shopId,
        businessDayId: context.day.id,
        aggregateType: 'RECONCILIATION',
        aggregateId: reconciliation.id,
        eventType: 'RECONCILIATION_RECORDED',
        workerId: context.operator.id,
        createdAt,
        details: this.#reconciliationPayload(reconciliation, preview),
      },
      {
        id: this.#id<AuditEventId>(),
        shopId: context.shopId,
        businessDayId: context.day.id,
        aggregateType: 'BUSINESS_DAY',
        aggregateId: context.day.id,
        eventType: 'BUSINESS_DAY_CLOSED',
        workerId: context.operator.id,
        createdAt,
        details: {
          recognizedSalesMinor: preview.recognizedSalesMinor,
          totalExpensesMinor: preview.totalExpensesMinor,
        },
      },
      {
        id: this.#id<AuditEventId>(),
        shopId: context.shopId,
        businessDayId: context.day.id,
        aggregateType: 'WORKER_SESSION',
        aggregateId: context.session.id,
        eventType: 'WORKER_SIGNED_OUT',
        workerId: context.operator.id,
        createdAt,
        details: { reason: 'END_DAY' },
      },
    ];
  }

  #outboxEvents(
    context: EndDayContext,
    reconciliation: Reconciliation,
    preview: EndDayPreview,
    createdAt: Instant,
  ): readonly OutboxEvent[] {
    return [
      this.#outbox({
        context,
        aggregateType: 'RECONCILIATION',
        aggregateId: reconciliation.id,
        eventType: 'RECONCILIATION_RECORDED',
        idempotencyKey: `reconciliation-recorded:${context.day.id}`,
        payload: this.#reconciliationPayload(reconciliation, preview),
        createdAt,
      }),
      this.#outbox({
        context,
        aggregateType: 'BUSINESS_DAY',
        aggregateId: context.day.id,
        eventType: 'BUSINESS_DAY_CLOSED',
        idempotencyKey: `business-day-closed:${context.day.id}`,
        payload: {
          businessDayId: context.day.id,
          endedByWorkerId: context.operator.id,
          endedAt: createdAt,
          recognizedSalesMinor: preview.recognizedSalesMinor,
          totalExpensesMinor: preview.totalExpensesMinor,
        },
        createdAt,
      }),
      this.#outbox({
        context,
        aggregateType: 'WORKER_SESSION',
        aggregateId: context.session.id,
        eventType: 'WORKER_SIGNED_OUT',
        idempotencyKey: `worker-session-end-day:${context.session.id}`,
        payload: {
          workerSessionId: context.session.id,
          workerId: context.operator.id,
          endedAt: createdAt,
        },
        createdAt,
      }),
    ];
  }

  #outbox(input: {
    readonly context: EndDayContext;
    readonly aggregateType: string;
    readonly aggregateId: string;
    readonly eventType: string;
    readonly idempotencyKey: string;
    readonly payload: JsonValue;
    readonly createdAt: Instant;
  }): OutboxEvent {
    return {
      id: this.#id<OutboxEventId>(),
      shopId: input.context.shopId,
      businessDayId: input.context.day.id,
      aggregateType: input.aggregateType,
      aggregateId: input.aggregateId,
      eventType: input.eventType,
      idempotencyKey: input.idempotencyKey,
      payloadVersion: 1,
      payload: input.payload,
      createdAt: input.createdAt,
      attemptCount: 0,
      nextAttemptAt: null,
      lastError: null,
      deliveredAt: null,
    };
  }

  #reconciliationPayload(reconciliation: Reconciliation, preview: EndDayPreview): JsonValue {
    return {
      reconciliationId: reconciliation.id,
      businessDayId: reconciliation.businessDayId,
      recognizedSalesMinor: preview.recognizedSalesMinor,
      totalExpensesMinor: preview.totalExpensesMinor,
      cashExpensesMinor: preview.cashExpensesMinor,
      lines: reconciliation.lines.map((line) => ({
        paymentMethodId: line.paymentMethod.id,
        expectedMinor: line.expectedMinor,
        actualMinor: line.actualMinor,
        differenceMinor: line.differenceMinor,
        varianceReason: line.varianceReason,
      })),
    };
  }

  #id<Id extends EntityId>(): Id {
    return parseEntityId<Id>(this.#runtime.createUuid());
  }
}
