from pathlib import Path
import re


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected one exact match, found {count}")
    p.write_text(text.replace(old, new, 1))


def regex_once(path: str, pattern: str, replacement: str) -> None:
    p = Path(path)
    text = p.read_text()
    new, count = re.subn(pattern, replacement, text, count=1, flags=re.S)
    if count != 1:
        raise SystemExit(f"{path}: expected one regex match, found {count}")
    p.write_text(new)


# Preserve PaymentDraft reference + acknowledgement evidence across durable local draft decoding.
path = "packages/domain/src/orderDraftParser.ts"
replace_once(
    path,
    """function nullableString(value: unknown, path: string): string | null {
  if (value === null) return null;
  return stringValue(value, path);
}
""",
    """function nullableString(value: unknown, path: string): string | null {
  if (value === null) return null;
  return stringValue(value, path);
}

function optionalNullableString(value: unknown, path: string): string | null | undefined {
  if (value === undefined) return undefined;
  return nullableString(value, path);
}

function optionalBoolean(value: unknown, path: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'boolean') {
    throw new InvalidOrderDraftError(`${path} must be boolean.`);
  }
  return value;
}
""",
)
regex_once(
    path,
    r"function parsePayment\(value: unknown\): PaymentDraft \{.*?\n\}\n\nexport function parseOrderDraft",
    """function parsePayment(value: unknown): PaymentDraft {
  const payment = record(value, 'OrderDraft.payment');
  const mode = stringValue(payment['mode'], 'OrderDraft.payment.mode', false);
  if (mode === 'NONE') return { mode: 'NONE' };
  if (mode === 'SINGLE') {
    const reference = optionalNullableString(payment['reference'], 'OrderDraft.payment.reference');
    const manuallyConfirmed = optionalBoolean(
      payment['manuallyConfirmed'],
      'OrderDraft.payment.manuallyConfirmed',
    );
    return {
      mode: 'SINGLE',
      methodId: entityId<PaymentMethodId>(payment['methodId'], 'OrderDraft.payment.methodId'),
      cashReceivedMinor: nullableMoney(
        payment['cashReceivedMinor'],
        'OrderDraft.payment.cashReceivedMinor',
      ),
      ...(reference === undefined ? {} : { reference }),
      ...(manuallyConfirmed === undefined ? {} : { manuallyConfirmed }),
    };
  }
  if (mode === 'SPLIT') {
    const referenceA = optionalNullableString(payment['referenceA'], 'OrderDraft.payment.referenceA');
    const referenceB = optionalNullableString(payment['referenceB'], 'OrderDraft.payment.referenceB');
    const manuallyConfirmedA = optionalBoolean(
      payment['manuallyConfirmedA'],
      'OrderDraft.payment.manuallyConfirmedA',
    );
    const manuallyConfirmedB = optionalBoolean(
      payment['manuallyConfirmedB'],
      'OrderDraft.payment.manuallyConfirmedB',
    );
    return {
      mode: 'SPLIT',
      methodAId: entityId<PaymentMethodId>(payment['methodAId'], 'OrderDraft.payment.methodAId'),
      amountAMinor: moneyMinor(
        safeInteger(payment['amountAMinor'], 'OrderDraft.payment.amountAMinor'),
      ),
      methodBId: entityId<PaymentMethodId>(payment['methodBId'], 'OrderDraft.payment.methodBId'),
      ...(referenceA === undefined ? {} : { referenceA }),
      ...(referenceB === undefined ? {} : { referenceB }),
      ...(manuallyConfirmedA === undefined ? {} : { manuallyConfirmedA }),
      ...(manuallyConfirmedB === undefined ? {} : { manuallyConfirmedB }),
    };
  }
  throw new InvalidOrderDraftError('OrderDraft.payment.mode is unsupported.');
}

export function parseOrderDraft""",
)

# Persist validated non-delivery phone + manual-confirmation evidence into immutable order snapshots.
path = "packages/application/src/orders.ts"
regex_once(
    path,
    r"(if \(orderType\.behavior !== 'DELIVERY'\) \{\s+return \{\s+orderTypeId: orderType\.id,\s+orderTypeLabel: orderType\.name,\s+behavior: orderType\.behavior,)(\s+delivery: null,)",
    "\\1\n        customerPhone: normalizedDeliveryPhone ?? '',\\2",
)
regex_once(
    path,
    r"(reference: part\.reference,)(\s+\};\s+\}\s+return \{)",
    "\\1\n          manuallyConfirmed: part.manuallyConfirmed,\\2",
)
regex_once(
    path,
    r"(changeMinor: null,\s+reference: part\.reference,)(\s+\};)",
    "\\1\n        manuallyConfirmed: part.manuallyConfirmed,\\2",
)

# Preserve rollout-compatible new fields through operations sync decoding.
path = "packages/domain/src/syncContract.ts"
replace_once(
    path,
    """  OrderLifecycleSnapshot,
  OrderSnapshot,
""",
    """  OrderLifecycleSnapshot,
  OrderReasonCodeSnapshot,
  OrderSnapshot,
""",
)
regex_once(
    path,
    r"function parseLifecycle\(value: unknown\): OrderLifecycleSnapshot \{.*?\n\}\n\nfunction parseFulfillment",
    """function parseReasonCode(
  value: unknown,
  label: string,
  family: 'CANCELLATION' | 'REFUND_RETURN',
): OrderReasonCodeSnapshot {
  const source = record(value, label);
  if (source['family'] !== family) {
    throw new TypeError(`Operations sync ${label} must belong to ${family}.`);
  }
  const scope = source['scope'];
  if (scope !== 'BUSINESS' && scope !== 'SHOP') {
    throw new TypeError(`Operations sync ${label} scope is unsupported.`);
  }
  return {
    id: fieldString(source, 'id'),
    key: fieldString(source, 'key'),
    family,
    label: fieldString(source, 'label'),
    version: safeInteger(source['version'], `${label} version`, 1),
    scope,
  };
}

function parseLifecycle(value: unknown): OrderLifecycleSnapshot {
  const source = record(value, 'order lifecycle');
  const cancellationValue = source['cancellation'];
  const returnedValue = source['returned'];
  const cancellation =
    cancellationValue === null
      ? null
      : (() => {
          const cancellationSource = record(cancellationValue, 'order cancellation');
          const reasonCode =
            cancellationSource['reasonCode'] === undefined
              ? undefined
              : parseReasonCode(
                  cancellationSource['reasonCode'],
                  'order cancellation reasonCode',
                  'CANCELLATION',
                );
          const note =
            cancellationSource['note'] === undefined
              ? undefined
              : stringValue(cancellationSource['note'], 'order cancellation note', true);
          return {
            at: timestamp(cancellationSource['at'], 'order cancellation at'),
            workerId: entityId<WorkerId>(
              cancellationSource['workerId'],
              'order cancellation workerId',
            ),
            workerName: fieldString(cancellationSource, 'workerName'),
            foodPrepared: booleanValue(
              cancellationSource['foodPrepared'],
              'order cancellation foodPrepared',
            ),
            stockRestored: booleanValue(
              cancellationSource['stockRestored'],
              'order cancellation stockRestored',
            ),
            reason: fieldString(cancellationSource, 'reason'),
            ...(reasonCode === undefined ? {} : { reasonCode }),
            ...(note === undefined ? {} : { note }),
          };
        })();
  const returned =
    returnedValue === null
      ? null
      : (() => {
          const returnedSource = record(returnedValue, 'order return');
          const reasonCode =
            returnedSource['reasonCode'] === undefined
              ? undefined
              : parseReasonCode(
                  returnedSource['reasonCode'],
                  'order return reasonCode',
                  'REFUND_RETURN',
                );
          const note =
            returnedSource['note'] === undefined
              ? undefined
              : stringValue(returnedSource['note'], 'order return note', true);
          return {
            at: timestamp(returnedSource['at'], 'order return at'),
            workerId: entityId<WorkerId>(returnedSource['workerId'], 'order return workerId'),
            workerName: fieldString(returnedSource, 'workerName'),
            reason: fieldString(returnedSource, 'reason'),
            ...(reasonCode === undefined ? {} : { reasonCode }),
            ...(note === undefined ? {} : { note }),
          };
        })();
  return {
    revision: safeInteger(source['revision'], 'order lifecycle revision', 0),
    doneAt: nullableTimestamp(source['doneAt'], 'order lifecycle doneAt'),
    cancellation,
    returned,
  };
}

function parseFulfillment""",
)
replace_once(
    path,
    """    return { orderTypeId, orderTypeLabel, behavior, delivery: null };
""",
    """    const customerPhone =
      source['customerPhone'] === undefined
        ? undefined
        : stringValue(source['customerPhone'], 'order fulfillment customerPhone', true);
    return {
      orderTypeId,
      orderTypeLabel,
      behavior,
      ...(customerPhone === undefined ? {} : { customerPhone }),
      delivery: null,
    };
""",
)
replace_once(
    path,
    """  const reference =
    source['reference'] === undefined
      ? undefined
      : nullableString(source['reference'], 'payment reference');
  const identity = {
""",
    """  const reference =
    source['reference'] === undefined
      ? undefined
      : nullableString(source['reference'], 'payment reference');
  const manuallyConfirmed = optionalBoolean(
    source['manuallyConfirmed'],
    'payment manuallyConfirmed',
  );
  const identity = {
""",
)
replace_once(
    path,
    """    allocatedMinor: money(source['allocatedMinor'], 'payment allocatedMinor'),
    ...(reference === undefined ? {} : { reference }),
  };
""",
    """    allocatedMinor: money(source['allocatedMinor'], 'payment allocatedMinor'),
    ...(reference === undefined ? {} : { reference }),
    ...(manuallyConfirmed === undefined ? {} : { manuallyConfirmed }),
  };
""",
)

# POS collects acknowledgement evidence independently for single/split payment legs.
path = "apps/operations/src/app/OrdersCart.tsx"
replace_once(
    path,
    """        cashReceivedMinor: null,
        reference: null,
      },
""",
    """        cashReceivedMinor: null,
        reference: null,
        manuallyConfirmed: false,
      },
""",
)
replace_once(
    path,
    """        referenceA: null,
        referenceB: null,
      },
""",
    """        referenceA: null,
        referenceB: null,
        manuallyConfirmedA: false,
        manuallyConfirmedB: false,
      },
""",
)
text = Path(path).read_text()
old = """                              referenceA: null,
                              referenceB: null,
"""
if text.count(old) != 2:
    raise SystemExit(f"{path}: expected two split-method reset matches, found {text.count(old)}")
text = text.replace(
    old,
    """                              referenceA: null,
                              referenceB: null,
                              manuallyConfirmedA: false,
                              manuallyConfirmedB: false,
""",
)
Path(path).write_text(text)
replace_once(
    path,
    """                    {methodById(methods, draft.payment.methodId)?.requiresReference ? (
                      <DraftTextField
                        id={controlId('single-payment-reference')}
                        label="Payment reference"
                        value={draft.payment.reference ?? ''}
                        disabled={busy}
                        onCommit={(reference) =>
                          onMutate((current) =>
                            current.payment.mode === 'SINGLE'
                              ? { ...current, payment: { ...current.payment, reference } }
                              : current,
                          )
                        }
                      />
                    ) : null}
""",
    """                    {methodById(methods, draft.payment.methodId)?.requiresReference ? (
                      <DraftTextField
                        id={controlId('single-payment-reference')}
                        label="Payment reference"
                        value={draft.payment.reference ?? ''}
                        disabled={busy}
                        onCommit={(reference) =>
                          onMutate((current) =>
                            current.payment.mode === 'SINGLE'
                              ? { ...current, payment: { ...current.payment, reference } }
                              : current,
                          )
                        }
                      />
                    ) : null}
                    {methodById(methods, draft.payment.methodId)?.manualConfirmationRequired ? (
                      <label className="payment-confirmation">
                        <input
                          type="checkbox"
                          checked={draft.payment.manuallyConfirmed ?? false}
                          disabled={busy}
                          onChange={(event) => {
                            const manuallyConfirmed = event.currentTarget.checked;
                            onMutate((current) =>
                              current.payment.mode === 'SINGLE'
                                ? { ...current, payment: { ...current.payment, manuallyConfirmed } }
                                : current,
                            );
                          }}
                        />
                        <span>Payment manually confirmed</span>
                      </label>
                    ) : null}
""",
)
replace_once(
    path,
    """                  {methodById(methods, draft.payment.methodAId)?.requiresReference ? (
                    <DraftTextField
                      id={controlId('split-reference-a')}
                      label="Payment reference A"
                      value={draft.payment.referenceA ?? ''}
                      disabled={busy}
                      onCommit={(referenceA) =>
                        onMutate((current) =>
                          current.payment.mode === 'SPLIT'
                            ? { ...current, payment: { ...current.payment, referenceA } }
                            : current,
                        )
                      }
                    />
                  ) : null}
""",
    """                  {methodById(methods, draft.payment.methodAId)?.requiresReference ? (
                    <DraftTextField
                      id={controlId('split-reference-a')}
                      label="Payment reference A"
                      value={draft.payment.referenceA ?? ''}
                      disabled={busy}
                      onCommit={(referenceA) =>
                        onMutate((current) =>
                          current.payment.mode === 'SPLIT'
                            ? { ...current, payment: { ...current.payment, referenceA } }
                            : current,
                        )
                      }
                    />
                  ) : null}
                  {methodById(methods, draft.payment.methodAId)?.manualConfirmationRequired ? (
                    <label className="payment-confirmation">
                      <input
                        type="checkbox"
                        checked={draft.payment.manuallyConfirmedA ?? false}
                        disabled={busy}
                        onChange={(event) => {
                          const manuallyConfirmedA = event.currentTarget.checked;
                          onMutate((current) =>
                            current.payment.mode === 'SPLIT'
                              ? { ...current, payment: { ...current.payment, manuallyConfirmedA } }
                              : current,
                          );
                        }}
                      />
                      <span>Method A manually confirmed</span>
                    </label>
                  ) : null}
""",
)
replace_once(
    path,
    """                  {methodById(methods, draft.payment.methodBId)?.requiresReference ? (
                    <DraftTextField
                      id={controlId('split-reference-b')}
                      label="Payment reference B"
                      value={draft.payment.referenceB ?? ''}
                      disabled={busy}
                      onCommit={(referenceB) =>
                        onMutate((current) =>
                          current.payment.mode === 'SPLIT'
                            ? { ...current, payment: { ...current.payment, referenceB } }
                            : current,
                        )
                      }
                    />
                  ) : null}
""",
    """                  {methodById(methods, draft.payment.methodBId)?.requiresReference ? (
                    <DraftTextField
                      id={controlId('split-reference-b')}
                      label="Payment reference B"
                      value={draft.payment.referenceB ?? ''}
                      disabled={busy}
                      onCommit={(referenceB) =>
                        onMutate((current) =>
                          current.payment.mode === 'SPLIT'
                            ? { ...current, payment: { ...current.payment, referenceB } }
                            : current,
                        )
                      }
                    />
                  ) : null}
                  {methodById(methods, draft.payment.methodBId)?.manualConfirmationRequired ? (
                    <label className="payment-confirmation">
                      <input
                        type="checkbox"
                        checked={draft.payment.manuallyConfirmedB ?? false}
                        disabled={busy}
                        onChange={(event) => {
                          const manuallyConfirmedB = event.currentTarget.checked;
                          onMutate((current) =>
                            current.payment.mode === 'SPLIT'
                              ? { ...current, payment: { ...current.payment, manuallyConfirmedB } }
                              : current,
                          );
                        }}
                      />
                      <span>Method B manually confirmed</span>
                    </label>
                  ) : null}
""",
)

# Online acceptance collects the same trusted single-payment acknowledgement evidence.
path = "apps/operations/src/app/OnlineOrderInboxPanel.tsx"
replace_once(
    path,
    """  const [cashReceived, setCashReceived] = useState('');
  const [paymentReference, setPaymentReference] = useState('');
""",
    """  const [cashReceived, setCashReceived] = useState('');
  const [paymentReference, setPaymentReference] = useState('');
  const [manuallyConfirmed, setManuallyConfirmed] = useState(false);
""",
)
replace_once(
    path,
    """  const paymentReady =
    selectedPayment !== null &&
    (selectedPayment.logicType !== 'CASH' || cashReceivedMinor !== null) &&
    (!selectedPayment.requiresReference || paymentReference.trim().length > 0);
""",
    """  const paymentReady =
    selectedPayment !== null &&
    (selectedPayment.logicType !== 'CASH' || cashReceivedMinor !== null) &&
    (!selectedPayment.requiresReference || paymentReference.trim().length > 0) &&
    (!selectedPayment.manualConfirmationRequired || manuallyConfirmed);
""",
)
replace_once(
    path,
    """        reference: selectedPayment.requiresReference ? paymentReference : null,
      },
""",
    """        reference: selectedPayment.requiresReference ? paymentReference : null,
        manuallyConfirmed: selectedPayment.manualConfirmationRequired ? manuallyConfirmed : false,
      },
""",
)
replace_once(
    path,
    """              setCashReceived('');
              setPaymentReference('');
""",
    """              setCashReceived('');
              setPaymentReference('');
              setManuallyConfirmed(false);
""",
)
replace_once(
    path,
    """        {selectedPayment?.requiresReference ? (
          <label>
            Payment reference
            <input
              type="text"
              maxLength={200}
              placeholder="Transaction or provider reference"
              value={paymentReference}
              onChange={(event) => setPaymentReference(event.target.value)}
            />
          </label>
        ) : null}
""",
    """        {selectedPayment?.requiresReference ? (
          <label>
            Payment reference
            <input
              type="text"
              maxLength={200}
              placeholder="Transaction or provider reference"
              value={paymentReference}
              onChange={(event) => setPaymentReference(event.target.value)}
            />
          </label>
        ) : null}
        {selectedPayment?.manualConfirmationRequired ? (
          <label className="payment-confirmation">
            <input
              type="checkbox"
              checked={manuallyConfirmed}
              onChange={(event) => setManuallyConfirmed(event.currentTarget.checked)}
            />
            <span>Payment manually confirmed</span>
          </label>
        ) : null}
""",
)

# Mirror cancellation authority for published REFUND_RETURN reasons at application boundary.
path = "packages/application/src/ordersBoard.ts"
replace_once(
    path,
    """  readonly cancellationReasonMode: 'CONFIGURED' | 'LEGACY_FREE_TEXT';
  readonly cancellationReasons: readonly CancellationReasonOption[];
""",
    """  readonly cancellationReasonMode: 'CONFIGURED' | 'LEGACY_FREE_TEXT';
  readonly cancellationReasons: readonly CancellationReasonOption[];
  readonly returnReasonMode: 'CONFIGURED' | 'LEGACY_FREE_TEXT';
  readonly returnReasons: readonly CancellationReasonOption[];
""",
)
replace_once(
    path,
    """export interface ReturnDeliveryInput {
  readonly orderId: OrderId;
  readonly reason: string;
}
""",
    """export interface ReturnDeliveryInput {
  readonly orderId: OrderId;
  /** Legacy free-text fallback for genuinely pre-feature configuration snapshots only. */
  readonly reason: string;
  /** Stable published reason identity required once REFUND_RETURN configuration exists. */
  readonly reasonCodeId?: string;
  /** Operator context only; never the canonical reason authority. */
  readonly note?: string;
}
""",
)
replace_once(
    path,
    """          const configuredReasonAuthority = cancellationReasons.length > 0;
          return {
            shopId: shop.id,
            businessDayId: day.id,
            loadedAt: this.#runtime.now(),
            orders,
            cancellationReasonMode: configuredReasonAuthority ? 'CONFIGURED' : 'LEGACY_FREE_TEXT',
            cancellationReasons,
          } satisfies OrdersBoardSnapshot;
""",
    """          const returnReasons: CancellationReasonOption[] = reasonCodes
            .filter((reason) => reason.active && reason.family === 'REFUND_RETURN')
            .map((reason) => ({
              id: reason.id,
              key: reason.key,
              label: reason.label,
              version: reason.version,
              scope: reason.scope,
            }));
          const configuredReasonAuthority = cancellationReasons.length > 0;
          const configuredReturnReasonAuthority = returnReasons.length > 0;
          return {
            shopId: shop.id,
            businessDayId: day.id,
            loadedAt: this.#runtime.now(),
            orders,
            cancellationReasonMode: configuredReasonAuthority ? 'CONFIGURED' : 'LEGACY_FREE_TEXT',
            cancellationReasons,
            returnReasonMode: configuredReturnReasonAuthority ? 'CONFIGURED' : 'LEGACY_FREE_TEXT',
            returnReasons,
          } satisfies OrdersBoardSnapshot;
""",
)
regex_once(
    path,
    r"  async returnDelivery\(input: ReturnDeliveryInput\): Promise<OrderTransitionResult> \{.*?\n  \}\n\n  async #mutate",
    """  async returnDelivery(input: ReturnDeliveryInput): Promise<OrderTransitionResult> {
    return this.#mutate(async (transaction, context, now) => {
      const order = await this.#currentOrder(transaction, context, input.orderId);
      const configuration = await transaction.configuration.getForShop(context.shopId);
      const reasonCodes = configuration?.reasonCodes ?? [];
      const configuredReturnReasons = reasonCodes.filter(
        (candidate) => candidate.active && candidate.family === 'REFUND_RETURN',
      );
      const configuredReasonAuthority = configuredReturnReasons.length > 0;

      if (configuredReasonAuthority && input.reasonCodeId === undefined) {
        throw new DomainInvariantError(
          'A published refund/return reason is required for this configuration.',
        );
      }

      let reasonCode: OrderReasonCodeSnapshot | undefined;
      if (input.reasonCodeId !== undefined) {
        const configured = configuredReturnReasons.find(
          (candidate) => candidate.id === input.reasonCodeId,
        );
        if (configured === undefined) {
          throw new DomainInvariantError(
            'The selected refund/return reason is not active in the published configuration.',
          );
        }
        reasonCode = {
          id: configured.id,
          key: configured.key,
          family: configured.family,
          label: configured.label,
          version: configured.version,
          scope: configured.scope,
        };
      }

      const updated = returnFailedDelivery(order, {
        at: now,
        workerId: context.operator.id,
        workerName: context.operator.displayName,
        reason: reasonCode?.label ?? input.reason,
        ...(reasonCode !== undefined ? { reasonCode } : {}),
        ...(input.note !== undefined ? { note: input.note } : {}),
      });
      const returned = orderLifecycle(updated).returned;
      if (returned === null) throw new Error('Returned Delivery is missing return metadata.');

      const expense: Extract<Expense, { kind: 'DELIVERY_FAILED' }> = {
        id: this.#id<ExpenseId>(),
        shopId: order.shopId,
        businessDayId: order.businessDayId,
        kind: 'DELIVERY_FAILED',
        description: `Delivery Failed — Order #${order.displayOrderNo}: ${itemSummary(order)}`,
        amountMinor: null,
        paidFrom: null,
        note: returned.reason,
        orderId: order.id,
        createdByWorkerId: context.operator.id,
        createdAt: now,
      };

      await transaction.orders.updateOperationalState(updated);
      await transaction.expenses.put(expense);
      const transition = this.#transition(
        'DELIVERY_RETURNED',
        order,
        updated,
        context.operator,
        now,
        { reason: returned.reason },
      );
      await transaction.audit.append(
        this.#audit(updated, context.operator, now, 'DELIVERY_RETURNED', {
          reason: returned.reason,
          ...(returned.reasonCode === undefined
            ? {}
            : {
                reasonCodeId: returned.reasonCode.id,
                reasonCodeKey: returned.reasonCode.key,
                reasonCodeVersion: returned.reasonCode.version,
              }),
          historicalOrderTotalMinor: order.totalMinor,
          recognizedRevenueMinor: ZERO_MONEY,
          collectedPaymentMinor: ZERO_MONEY,
          excludedFromExpectedReconciliation: true,
          inventoryRestored: false,
          expenseId: expense.id,
          operationalRevision: transition.revision,
        }),
      );
      await transaction.outbox.append(
        this.#outbox(updated, now, 'DELIVERY_RETURNED', transition, [], expense),
      );
      return updated;
    });
  }

  async #mutate""",
)

# Expose published REFUND_RETURN authority in rendered Orders Board UI.
path = "apps/operations/src/app/OrdersBoardWorkspace.tsx"
replace_once(
    path,
    """type CancellationSubmission = {
  readonly foodPrepared: boolean;
  readonly reason: string;
  readonly reasonCodeId?: string;
  readonly note?: string;
};
""",
    """type CancellationSubmission = {
  readonly foodPrepared: boolean;
  readonly reason: string;
  readonly reasonCodeId?: string;
  readonly note?: string;
};
type ReturnSubmission = {
  readonly reason: string;
  readonly reasonCodeId?: string;
  readonly note?: string;
};
""",
)
regex_once(
    path,
    r"function ReturnDialog\(\{.*?\n\}\n\nexport function OrdersBoardWorkspace",
    """function ReturnDialog({
  order,
  busy,
  reasonMode,
  reasons,
  onClose,
  onConfirm,
}: {
  readonly order: OrderSnapshot;
  readonly busy: boolean;
  readonly reasonMode: CancellationReasonMode;
  readonly reasons: readonly CancellationReasonOption[];
  readonly onClose: () => void;
  readonly onConfirm: (submission: ReturnSubmission) => Promise<void>;
}) {
  const [selectedReasonId, setSelectedReasonId] = useState('');
  const [legacyReason, setLegacyReason] = useState('');
  const [note, setNote] = useState('');
  const selectedReason = reasons.find((reason) => reason.id === selectedReasonId);
  const configured = reasonMode === 'CONFIGURED';
  const validReason = configured ? selectedReason !== undefined : legacyReason.trim().length > 0;
  return (
    <div className="modal-backdrop">
      <section
        className="board-confirm-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="return-order-title"
      >
        <header>
          <div>
            <p className="eyebrow">Delivery Failed</p>
            <h2 id="return-order-title">Order #{order.displayOrderNo}</h2>
          </div>
          <button className="board-quiet-button" type="button" onClick={onClose}>
            Close
          </button>
        </header>
        <p>
          This records no collected payment, no recognized revenue, no inventory restoration,
          and creates the locked Delivery Failed expense event.
        </p>
        {configured ? (
          <>
            <label>
              Reason
              <select value={selectedReasonId} onChange={(event) => setSelectedReasonId(event.target.value)}>
                <option value="">Select a published refund/return reason</option>
                {reasons.map((reason) => (
                  <option key={reason.id} value={reason.id}>
                    {reason.label}
                  </option>
                ))}
              </select>
            </label>
            {reasons.length === 0 ? (
              <p className="board-inline-error" role="alert">
                No active refund/return reasons are published. Delivery Failed is locked until Admin
                publishes one.
              </p>
            ) : null}
            <label>
              Note (optional)
              <textarea value={note} onChange={(event) => setNote(event.target.value)} maxLength={240} />
            </label>
          </>
        ) : (
          <label>
            Reason
            <textarea
              value={legacyReason}
              onChange={(event) => setLegacyReason(event.target.value)}
              maxLength={240}
            />
          </label>
        )}
        <button
          className="board-danger-button"
          type="button"
          disabled={busy || !validReason}
          onClick={() => {
            if (configured) {
              if (selectedReason === undefined) return;
              void onConfirm({
                reason: selectedReason.label,
                reasonCodeId: selectedReason.id,
                ...(note.trim().length > 0 ? { note: note.trim() } : {}),
              });
              return;
            }
            void onConfirm({ reason: legacyReason.trim() });
          }}
        >
          Confirm Delivery Failed
        </button>
      </section>
    </div>
  );
}

export function OrdersBoardWorkspace""",
)
regex_once(
    path,
    r"(const \[cancellationReasons, setCancellationReasons\] = useState<\s*readonly CancellationReasonOption\[\]\s*>\(\[\]\);)(\s*const \[tab, setTab\] = useState<BoardTab>\('ACTIVE'\);)",
    """\\1
  const [returnReasonMode, setReturnReasonMode] =
    useState<CancellationReasonMode>('LEGACY_FREE_TEXT');
  const [returnReasons, setReturnReasons] = useState<readonly CancellationReasonOption[]>([]);\\2""",
)
regex_once(
    path,
    r"(setCancellationReasonMode\(result\.value\.cancellationReasonMode\);\s*setCancellationReasons\(result\.value\.cancellationReasons\);)(\s*setError\(null\);)",
    """\\1
    setReturnReasonMode(result.value.returnReasonMode);
    setReturnReasons(result.value.returnReasons);\\2""",
)
regex_once(
    path,
    r"<ReturnDialog\s+order=\{returnTarget\}\s+busy=\{busy\}\s+onClose=\{\(\) => setReturnTarget\(null\)\}\s+onConfirm=\{async \(reason\) => \{\s+const changed = await mutate\(\s+\(\) => client\.returnDelivery\(\{ orderId: returnTarget\.id, reason \}\),\s+`Order #\$\{returnTarget\.displayOrderNo\} marked Delivery Failed\.`,\s+\);",
    """<ReturnDialog
        order={returnTarget}
        busy={busy}
        reasonMode={returnReasonMode}
        reasons={returnReasons}
        onClose={() => setReturnTarget(null)}
        onConfirm={async (submission) => {
          const changed = await mutate(
            () => client.returnDelivery({ orderId: returnTarget.id, ...submission }),
            `Order #${returnTarget.displayOrderNo} marked Delivery Failed.`,
          );""",
)

# Update source regression to assert rollout-compatible immutable phone field.
path = "packages/application/src/nonDeliveryPhonePersistence.test.ts"
replace_once(
    path,
    """    expect(modelsSource).toContain('readonly customerPhone:');
    expect(ordersSource).toContain('customerPhone:');
    expect(ordersSource).toContain('normalizedPhone: input.normalizedDeliveryPhone');
""",
    """    expect(modelsSource).toContain('readonly customerPhone?: string;');
    expect(ordersSource).toContain('customerPhone: normalizedDeliveryPhone');
""",
)

# Existing command-builder tests now provide the form-captured CAS tokens explicitly.
path = "apps/admin/src/settings/useSettings.test.ts"
text = Path(path).read_text()
replacements = [
    (
        """        active: false,
        sortOrder: 20,
""",
        """        active: false,
        sortOrder: 20,
        expectedSettingsVersion: 7,
        expectedEditVersion: 3,
""",
    ),
    (
        """      refundAllowed: false,
      logicType: 'CARD',
""",
        """      refundAllowed: false,
      expectedSettingsVersion: 7,
      expectedEditVersion: 5,
      logicType: 'CARD',
""",
    ),
    (
        """        active: true,
        sortOrder: 0,
      }),
""",
        """        active: true,
        sortOrder: 0,
        expectedSettingsVersion: 7,
        expectedEditVersion: 0,
      }),
""",
    ),
    (
        """        manualConfirmationRequired: false,
        refundAllowed: false,
      }),
""",
        """        manualConfirmationRequired: false,
        refundAllowed: false,
        expectedSettingsVersion: 7,
        expectedEditVersion: 0,
      }),
""",
    ),
]
for old, new in replacements:
    if text.count(old) != 1:
        raise SystemExit(f"{path}: expected one CAS test match, found {text.count(old)}")
    text = text.replace(old, new, 1)
text = text.replace(
    "derives order type CAS versions from the latest loaded workspace",
    "uses form-captured order type CAS versions",
)
text = text.replace(
    "derives payment CAS versions while dropping protected operational semantics",
    "uses form-captured payment CAS versions while dropping protected operational semantics",
)
Path(path).write_text(text)

# Trusted catalog money must remain safe across PostgreSQL -> JSON -> JavaScript.
migration = Path("supabase/migrations/20260910121300_admin_plan2_safe_price_hardening.sql")
if migration.exists():
    raise SystemExit(f"{migration}: already exists")
migration.write_text(
    """-- TUX Admin Plan 2 JavaScript-safe catalog price hardening.
-- Catalog money crosses PostgreSQL -> JSON -> JavaScript, so trusted draft writes must stay
-- within Number.MAX_SAFE_INTEGER even though PostgreSQL bigint/numeric can represent more.

create or replace function private.validate_admin_catalog_safe_prices_v1(
  p_shop_id uuid,
  p_bundle jsonb
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_item jsonb;
  v_price numeric;
begin
  if p_shop_id is null
     or jsonb_typeof(p_bundle) <> 'object'
     or jsonb_typeof(p_bundle #> '{snapshot,products}') <> 'array'
     or jsonb_typeof(p_bundle #> '{snapshot,modifiers}') <> 'array' then
    raise exception 'TUX_ADMIN_CATALOG_BUNDLE_INVALID';
  end if;

  for v_item in
    select value from jsonb_array_elements(p_bundle #> '{snapshot,products}')
    union all
    select value from jsonb_array_elements(p_bundle #> '{snapshot,modifiers}')
  loop
    if jsonb_typeof(v_item -> 'priceMinor') <> 'number' then
      raise exception 'TUX_ADMIN_CATALOG_PRICE_INVALID';
    end if;
    begin
      v_price := (v_item ->> 'priceMinor')::numeric;
    exception
      when numeric_value_out_of_range or invalid_text_representation then
        raise exception 'TUX_ADMIN_CATALOG_PRICE_INVALID';
    end;
    if v_price <> trunc(v_price)
       or v_price < 0
       or v_price > 9007199254740991 then
      raise exception 'TUX_ADMIN_CATALOG_PRICE_OUT_OF_SAFE_RANGE';
    end if;
  end loop;
end;
$$;

revoke all on function private.validate_admin_catalog_safe_prices_v1(uuid, jsonb)
  from public, anon, authenticated;

create or replace function private.merge_catalog_owned_draft_bundle_v1(
  p_shop_id uuid,
  p_candidate_bundle jsonb,
  p_operations_version integer,
  p_updated_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_trusted jsonb;
  v_merged jsonb;
begin
  if p_shop_id is null
     or p_operations_version is null
     or p_operations_version < 0
     or p_updated_at is null
     or jsonb_typeof(p_candidate_bundle) <> 'object'
     or jsonb_typeof(p_candidate_bundle -> 'snapshot') <> 'object' then
    raise exception 'TUX_ADMIN_CATALOG_BUNDLE_INVALID';
  end if;

  v_trusted := private.build_admin_catalog_bundle_v1(
    p_shop_id,
    p_operations_version,
    p_updated_at
  );
  v_merged := v_trusted;

  v_merged := jsonb_set(v_merged, '{snapshot,categories}', p_candidate_bundle #> '{snapshot,categories}', false);
  v_merged := jsonb_set(v_merged, '{snapshot,products}', p_candidate_bundle #> '{snapshot,products}', false);
  v_merged := jsonb_set(v_merged, '{snapshot,modifiers}', p_candidate_bundle #> '{snapshot,modifiers}', false);
  v_merged := jsonb_set(v_merged, '{snapshot,productModifierLinks}', p_candidate_bundle #> '{snapshot,productModifierLinks}', false);
  v_merged := jsonb_set(v_merged, '{snapshot,comboBeverageOptions}', p_candidate_bundle #> '{snapshot,comboBeverageOptions}', false);
  v_merged := jsonb_set(v_merged, '{snapshot,recipeLines}', p_candidate_bundle #> '{snapshot,recipeLines}', false);

  perform private.validate_admin_catalog_bundle_v1(p_shop_id, v_merged);
  perform private.validate_admin_catalog_safe_prices_v1(p_shop_id, v_merged);
  perform private.validate_admin_catalog_changed_image_keys_v1(p_shop_id, v_merged);
  return v_merged;
end;
$$;

revoke all on function private.merge_catalog_owned_draft_bundle_v1(uuid, jsonb, integer, timestamptz)
  from public, anon, authenticated;
"""
)

# Permanent boundary suite covers both migration source and a live unsafe-price rejection.
path = "scripts/test-admin-plan2-second-review-hardening.mjs"
replace_once(
    path,
    """const sql = fs.readFileSync(migrationPath, 'utf8').toLowerCase();
for (const fragment of [
""",
    """const sql = fs.readFileSync(migrationPath, 'utf8').toLowerCase();
const safePriceMigrationPath =
  'supabase/migrations/20260910121300_admin_plan2_safe_price_hardening.sql';
if (!fs.existsSync(safePriceMigrationPath)) {
  throw new Error(`Plan 2 safe-price hardening migration is missing: ${safePriceMigrationPath}`);
}
const safePriceSql = fs.readFileSync(safePriceMigrationPath, 'utf8').toLowerCase();
for (const fragment of ['validate_admin_catalog_safe_prices_v1', '9007199254740991']) {
  if (!safePriceSql.includes(fragment)) {
    throw new Error(`Plan 2 safe-price hardening missing ${fragment}`);
  }
}
for (const fragment of [
""",
)
replace_once(
    path,
    """  v_restore_denied boolean := false;
  v_name text;
""",
    """  v_restore_denied boolean := false;
  v_unsafe_price_denied boolean := false;
  v_name text;
""",
)
replace_once(
    path,
    """  v_draft_id := (v_create ->> 'draftId')::uuid;
  v_bundle := v_create -> 'bundleJson';
  v_bundle := jsonb_set(v_bundle, '{snapshot,modifiers,0,priceMinor}', '250'::jsonb, false);
""",
    """  v_draft_id := (v_create ->> 'draftId')::uuid;
  v_bundle := v_create -> 'bundleJson';

  begin
    perform public.apply_catalog_draft_change_v1(
      '${ownerId}',
      v_draft_id,
      1,
      jsonb_build_object(
        'bundleJson',
        jsonb_set(
          v_bundle,
          '{snapshot,modifiers,0,priceMinor}',
          '9007199254740992'::jsonb,
          false
        )
      )
    );
  exception when others then
    if sqlerrm like '%TUX_ADMIN_CATALOG_PRICE_OUT_OF_SAFE_RANGE%' then
      v_unsafe_price_denied := true;
    else
      raise;
    end if;
  end;
  if not v_unsafe_price_denied then
    raise exception 'catalog draft accepted a modifier price above Number.MAX_SAFE_INTEGER';
  end if;

  v_bundle := jsonb_set(v_bundle, '{snapshot,modifiers,0,priceMinor}', '250'::jsonb, false);
""",
)

print("Exact Plan 2 GREEN patch applied.")
