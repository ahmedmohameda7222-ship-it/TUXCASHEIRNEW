from pathlib import Path


def replace(path: str, old: str, new: str) -> None:
    file = Path(path)
    source = file.read_text()
    count = source.count(old)
    if count != 1:
        raise SystemExit(f'{path}: expected exactly one match, found {count}: {old[:160]!r}')
    file.write_text(source.replace(old, new, 1))


# Persist the operator/provider reference on immutable payment snapshots while keeping legacy
# snapshots (which predate the field) readable.
replace(
    'packages/domain/src/models.ts',
    """export type CashPaymentPart = {
  readonly id: PaymentId;
  readonly method: PaymentMethodSnapshot & { readonly logicType: 'CASH' };
  readonly allocatedMinor: MoneyMinor;
  readonly receivedMinor: MoneyMinor;
  readonly changeMinor: MoneyMinor;
};

export type NonCashPaymentPart = {
  readonly id: PaymentId;
  readonly method: PaymentMethodSnapshot & {
    readonly logicType: Exclude<PaymentLogicType, 'CASH'>;
  };
  readonly allocatedMinor: MoneyMinor;
  readonly receivedMinor: null;
  readonly changeMinor: null;
};
""",
    """export type CashPaymentPart = {
  readonly id: PaymentId;
  readonly method: PaymentMethodSnapshot & { readonly logicType: 'CASH' };
  readonly allocatedMinor: MoneyMinor;
  readonly receivedMinor: MoneyMinor;
  readonly changeMinor: MoneyMinor;
  /** Present on new payments; omitted by legacy persisted snapshots. */
  readonly reference?: string | null;
};

export type NonCashPaymentPart = {
  readonly id: PaymentId;
  readonly method: PaymentMethodSnapshot & {
    readonly logicType: Exclude<PaymentLogicType, 'CASH'>;
  };
  readonly allocatedMinor: MoneyMinor;
  readonly receivedMinor: null;
  readonly changeMinor: null;
  /** Present on new payments; omitted by legacy persisted snapshots. */
  readonly reference?: string | null;
};
""",
)

# Sync contract: preserve the optional immutable reference exactly when present.
replace(
    'packages/domain/src/syncContract.ts',
    """  const refundAllowed = optionalBoolean(method['refundAllowed'], 'payment method refundAllowed');
  const identity = {
""",
    """  const refundAllowed = optionalBoolean(method['refundAllowed'], 'payment method refundAllowed');
  const reference =
    source['reference'] === undefined
      ? undefined
      : nullableString(source['reference'], 'payment reference');
  const identity = {
""",
)
replace(
    'packages/domain/src/syncContract.ts',
    """    },
    allocatedMinor: money(source['allocatedMinor'], 'payment allocatedMinor'),
  };
""",
    """    },
    allocatedMinor: money(source['allocatedMinor'], 'payment allocatedMinor'),
    ...(reference === undefined ? {} : { reference }),
  };
""",
)

# Integrity: legacy snapshots may omit reference. New snapshots that carry the field must be
# internally consistent with their immutable method rule snapshot.
replace(
    'packages/domain/src/order.ts',
    """  for (const payment of order.payments) {
    assertNonNegativeMoney(payment.allocatedMinor, 'Payment allocation');

    if (payment.method.logicType === 'CASH') {
""",
    """  for (const payment of order.payments) {
    assertNonNegativeMoney(payment.allocatedMinor, 'Payment allocation');

    if (payment.reference !== undefined) {
      if (payment.reference !== null) {
        if (payment.reference.trim().length === 0) {
          throw new DomainInvariantError('Payment reference cannot be blank when present.');
        }
        if (payment.reference.length > 200) {
          throw new DomainInvariantError('Payment reference cannot exceed 200 characters.');
        }
      }
      if ((payment.method.requiresReference ?? false) && payment.reference === null) {
        throw new DomainInvariantError('Required payment reference is missing from the snapshot.');
      }
    }

    if (payment.method.logicType === 'CASH') {
""",
)

# Application placement: copy the trusted normalized reference into the immutable order payment.
replace(
    'packages/application/src/orders.ts',
    """          allocatedMinor: part.allocatedMinor,
          receivedMinor: part.receivedMinor,
          changeMinor: part.changeMinor,
        };
""",
    """          allocatedMinor: part.allocatedMinor,
          receivedMinor: part.receivedMinor,
          changeMinor: part.changeMinor,
          reference: part.reference,
        };
""",
)
replace(
    'packages/application/src/orders.ts',
    """        allocatedMinor: part.allocatedMinor,
        receivedMinor: null,
        changeMinor: null,
      };
""",
    """        allocatedMinor: part.allocatedMinor,
        receivedMinor: null,
        changeMinor: null,
        reference: part.reference,
      };
""",
)

# POS draft initialization.
replace(
    'apps/operations/src/app/OrdersCart.tsx',
    """      payment: {
        mode: 'SINGLE',
        methodId: method.id,
        cashReceivedMinor: null,
      },
""",
    """      payment: {
        mode: 'SINGLE',
        methodId: method.id,
        cashReceivedMinor: null,
        reference: null,
      },
""",
)
replace(
    'apps/operations/src/app/OrdersCart.tsx',
    """      payment: {
        mode: 'SPLIT',
        methodAId: methodA.id,
        amountAMinor: ZERO_MONEY,
        methodBId: methodB.id,
      },
""",
    """      payment: {
        mode: 'SPLIT',
        methodAId: methodA.id,
        amountAMinor: ZERO_MONEY,
        methodBId: methodB.id,
        referenceA: null,
        referenceB: null,
      },
""",
)

# POS single-payment reference editor lives alongside cash received and is driven only by the
# selected payment method snapshot.
replace(
    'apps/operations/src/app/OrdersCart.tsx',
    """                {draft.payment.mode === 'SINGLE' && pricing !== null ? (
                  methodById(methods, draft.payment.methodId)?.logicType === 'CASH' ? (
                    <CashEditor
                      idPrefix={controlId('single')}
                      label="Cash received"
                      allocatedMinor={pricing.totalMinor}
                      receivedMinor={draft.payment.cashReceivedMinor}
                      busy={busy}
                      onCommit={(cashReceivedMinor) =>
                        onMutate((current) =>
                          current.payment.mode === 'SINGLE'
                            ? {
                                ...current,
                                payment: { ...current.payment, cashReceivedMinor },
                              }
                            : current,
                        )
                      }
                    />
                  ) : null
                ) : null}
""",
    """                {draft.payment.mode === 'SINGLE' && pricing !== null ? (
                  <>
                    {methodById(methods, draft.payment.methodId)?.logicType === 'CASH' ? (
                      <CashEditor
                        idPrefix={controlId('single')}
                        label="Cash received"
                        allocatedMinor={pricing.totalMinor}
                        receivedMinor={draft.payment.cashReceivedMinor}
                        busy={busy}
                        onCommit={(cashReceivedMinor) =>
                          onMutate((current) =>
                            current.payment.mode === 'SINGLE'
                              ? {
                                  ...current,
                                  payment: { ...current.payment, cashReceivedMinor },
                                }
                              : current,
                          )
                        }
                      />
                    ) : null}
                    {methodById(methods, draft.payment.methodId)?.requiresReference ? (
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
                  </>
                ) : null}
""",
)

# Changing split methods invalidates any captured references so a provider reference can never
# silently follow a different payment method.
replace(
    'apps/operations/src/app/OrdersCart.tsx',
    """                              methodAId,
                              methodBId:
                                current.payment.methodBId === methodAId && fallbackB !== undefined
                                  ? fallbackB.id
                                  : current.payment.methodBId,
""",
    """                              methodAId,
                              methodBId:
                                current.payment.methodBId === methodAId && fallbackB !== undefined
                                  ? fallbackB.id
                                  : current.payment.methodBId,
                              referenceA: null,
                              referenceB: null,
""",
)
replace(
    'apps/operations/src/app/OrdersCart.tsx',
    """                              methodBId,
                              methodAId:
                                current.payment.methodAId === methodBId && fallbackA !== undefined
                                  ? fallbackA.id
                                  : current.payment.methodAId,
""",
    """                              methodBId,
                              methodAId:
                                current.payment.methodAId === methodBId && fallbackA !== undefined
                                  ? fallbackA.id
                                  : current.payment.methodAId,
                              referenceA: null,
                              referenceB: null,
""",
)

# Split leg A reference input.
replace(
    'apps/operations/src/app/OrdersCart.tsx',
    """                  <MoneyInput
                    id={controlId('split-amount-a')}
                    label="Amount A"
                    value={draft.payment.amountAMinor}
                    disabled={busy}
                    onCommit={(amountAMinor) =>
                      onMutate((current) =>
                        current.payment.mode === 'SPLIT'
                          ? { ...current, payment: { ...current.payment, amountAMinor } }
                          : current,
                      )
                    }
                  />
""",
    """                  <MoneyInput
                    id={controlId('split-amount-a')}
                    label="Amount A"
                    value={draft.payment.amountAMinor}
                    disabled={busy}
                    onCommit={(amountAMinor) =>
                      onMutate((current) =>
                        current.payment.mode === 'SPLIT'
                          ? { ...current, payment: { ...current.payment, amountAMinor } }
                          : current,
                      )
                    }
                  />
                  {methodById(methods, draft.payment.methodAId)?.requiresReference ? (
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
)

# Split leg B reference input.
replace(
    'apps/operations/src/app/OrdersCart.tsx',
    """                  <div className="split-remainder">
                    <span>Amount B</span>
                    <strong>
                      {draft.payment.amountAMinor <= pricing.totalMinor
                        ? formatMoneyMinor(
                            subtractMoney(pricing.totalMinor, draft.payment.amountAMinor),
                          )
                        : '—'}
                    </strong>
                  </div>
""",
    """                  <div className="split-remainder">
                    <span>Amount B</span>
                    <strong>
                      {draft.payment.amountAMinor <= pricing.totalMinor
                        ? formatMoneyMinor(
                            subtractMoney(pricing.totalMinor, draft.payment.amountAMinor),
                          )
                        : '—'}
                    </strong>
                  </div>
                  {methodById(methods, draft.payment.methodBId)?.requiresReference ? (
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
)

# Online worker-confirmed acceptance: collect the authoritative provider/reference value before the
# same trusted preparePaymentParts boundary revalidates the order.
replace(
    'apps/operations/src/app/OnlineOrderInboxPanel.tsx',
    """  const [paymentMethodId, setPaymentMethodId] = useState('');
  const [cashReceived, setCashReceived] = useState('');
""",
    """  const [paymentMethodId, setPaymentMethodId] = useState('');
  const [cashReceived, setCashReceived] = useState('');
  const [paymentReference, setPaymentReference] = useState('');
""",
)
replace(
    'apps/operations/src/app/OnlineOrderInboxPanel.tsx',
    """  const paymentReady =
    selectedPayment !== null &&
    (selectedPayment.logicType !== 'CASH' || cashReceivedMinor !== null);
""",
    """  const paymentReady =
    selectedPayment !== null &&
    (selectedPayment.logicType !== 'CASH' || cashReceivedMinor !== null) &&
    (!selectedPayment.requiresReference || paymentReference.trim().length > 0);
""",
)
replace(
    'apps/operations/src/app/OnlineOrderInboxPanel.tsx',
    """        methodId: selectedPayment.id,
        cashReceivedMinor: selectedPayment.logicType === 'CASH' ? cashReceivedMinor : null,
      },
""",
    """        methodId: selectedPayment.id,
        cashReceivedMinor: selectedPayment.logicType === 'CASH' ? cashReceivedMinor : null,
        reference: selectedPayment.requiresReference ? paymentReference : null,
      },
""",
)
replace(
    'apps/operations/src/app/OnlineOrderInboxPanel.tsx',
    """              setPaymentMethodId(event.target.value);
              setCashReceived('');
""",
    """              setPaymentMethodId(event.target.value);
              setCashReceived('');
              setPaymentReference('');
""",
)
replace(
    'apps/operations/src/app/OnlineOrderInboxPanel.tsx',
    """        {selectedPayment?.logicType === 'CASH' ? (
          <label>
            Cash received
            <input
              inputMode="decimal"
              placeholder="EGP received"
              value={cashReceived}
              onChange={(event) => setCashReceived(event.target.value)}
            />
          </label>
        ) : null}
""",
    """        {selectedPayment?.logicType === 'CASH' ? (
          <label>
            Cash received
            <input
              inputMode="decimal"
              placeholder="EGP received"
              value={cashReceived}
              onChange={(event) => setCashReceived(event.target.value)}
            />
          </label>
        ) : null}
        {selectedPayment?.requiresReference ? (
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
)
