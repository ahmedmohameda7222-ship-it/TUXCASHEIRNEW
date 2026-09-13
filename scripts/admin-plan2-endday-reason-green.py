from pathlib import Path


def replace(path: str, old: str, new: str) -> None:
    file = Path(path)
    source = file.read_text()
    count = source.count(old)
    if count != 1:
        raise SystemExit(f'{path}: expected exactly one match, found {count}: {old[:140]!r}')
    file.write_text(source.replace(old, new, 1))


# Domain: promote the existing order reason snapshot to a reusable immutable reason snapshot.
replace(
    'packages/domain/src/models.ts',
    """export interface OrderReasonCodeSnapshot {
  readonly id: string;
  readonly key: string;
  readonly family: ConfiguredReasonFamily;
  readonly label: string;
  readonly version: number;
  readonly scope: 'BUSINESS' | 'SHOP';
}
""",
    """export interface ReasonCodeSnapshot {
  readonly id: string;
  readonly key: string;
  readonly family: ConfiguredReasonFamily;
  readonly label: string;
  readonly version: number;
  readonly scope: 'BUSINESS' | 'SHOP';
}

/** Backwards-compatible order-specific name retained for existing consumers. */
export type OrderReasonCodeSnapshot = ReasonCodeSnapshot;
""",
)
replace(
    'packages/domain/src/models.ts',
    """export interface ReconciliationLine {
  readonly paymentMethod: PaymentMethodSnapshot;
  readonly expectedMinor: MoneyMinor;
  readonly actualMinor: MoneyMinor;
  readonly differenceMinor: MoneyMinor;
  readonly varianceReason: string | null;
}
""",
    """export interface ReconciliationLine {
  readonly paymentMethod: PaymentMethodSnapshot;
  readonly expectedMinor: MoneyMinor;
  readonly actualMinor: MoneyMinor;
  readonly differenceMinor: MoneyMinor;
  readonly varianceReason: string | null;
  /** Present when a published CASH_VARIANCE reason code was authoritative. */
  readonly varianceReasonCode?: ReasonCodeSnapshot;
}
""",
)

# Domain sync: preserve and validate the immutable CASH_VARIANCE reason snapshot.
replace(
    'packages/domain/src/syncContract.ts',
    """      return {
        paymentMethod: {
          id: entityId<PaymentMethodId>(paymentMethod['id'], 'reconciliation payment method id'),
          label: fieldString(paymentMethod, 'label'),
          logicType,
        },
        expectedMinor,
        actualMinor,
        differenceMinor,
        varianceReason: nullableString(line['varianceReason'], 'reconciliation varianceReason'),
      };
""",
    """      const varianceReasonCodeValue = line['varianceReasonCode'];
      const varianceReasonCode =
        varianceReasonCodeValue === undefined
          ? undefined
          : (() => {
              const reason = record(varianceReasonCodeValue, 'reconciliation variance reason code');
              if (reason['family'] !== 'CASH_VARIANCE') {
                throw new TypeError(
                  'Operations sync reconciliation variance reason family must be CASH_VARIANCE.',
                );
              }
              if (reason['scope'] !== 'SHOP' && reason['scope'] !== 'BUSINESS') {
                throw new TypeError('Operations sync reconciliation variance reason scope is invalid.');
              }
              return {
                id: stringValue(reason['id'], 'reconciliation variance reason id'),
                key: stringValue(reason['key'], 'reconciliation variance reason key'),
                family: 'CASH_VARIANCE' as const,
                label: stringValue(reason['label'], 'reconciliation variance reason label'),
                version: safeInteger(
                  reason['version'],
                  'reconciliation variance reason version',
                  1,
                ),
                scope: reason['scope'],
              };
            })();
      return {
        paymentMethod: {
          id: entityId<PaymentMethodId>(paymentMethod['id'], 'reconciliation payment method id'),
          label: fieldString(paymentMethod, 'label'),
          logicType,
        },
        expectedMinor,
        actualMinor,
        differenceMinor,
        varianceReason: nullableString(line['varianceReason'], 'reconciliation varianceReason'),
        ...(varianceReasonCode === undefined ? {} : { varianceReasonCode }),
      };
""",
)

# Application End Day contract and trusted authority.
replace(
    'packages/application/src/endDay.ts',
    "  type ReconciliationLine,\n  type ShopId,",
    "  type ReconciliationLine,\n  type ReasonCodeSnapshot,\n  type ShopId,",
)
replace(
    'packages/application/src/endDay.ts',
    """export interface EndDayVarianceInput {
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
""",
    """export interface EndDayVarianceInput {
  readonly paymentMethodId: PaymentMethodId;
  readonly reason: string | null;
  readonly reasonCodeId?: string;
}

export type EndDayCashVarianceReason = ReasonCodeSnapshot & {
  readonly family: 'CASH_VARIANCE';
};

export interface EndDayPreviewLine {
  readonly paymentMethod: EndDayPaymentMethod;
  readonly expectedMinor: MoneyMinor;
  readonly actualMinor: MoneyMinor;
  readonly differenceMinor: MoneyMinor;
  readonly varianceReason: string | null;
  readonly varianceReasonCode?: EndDayCashVarianceReason;
}

export interface EndDayPreview {
""",
)
replace(
    'packages/application/src/endDay.ts',
    """  readonly cashExpensesMinor: MoneyMinor;
  readonly lines: readonly EndDayPreviewLine[];
}
""",
    """  readonly cashExpensesMinor: MoneyMinor;
  readonly cashVarianceReasons: readonly EndDayCashVarianceReason[];
  readonly lines: readonly EndDayPreviewLine[];
}
""",
)
replace(
    'packages/application/src/endDay.ts',
    """function persistenceError(message: string, cause: unknown): ApplicationError {
  return { code: 'LOCAL_PERSISTENCE_ERROR', message, cause };
}

function normalizedDraftScopeId(value: string): string {
""",
    """function persistenceError(message: string, cause: unknown): ApplicationError {
  return { code: 'LOCAL_PERSISTENCE_ERROR', message, cause };
}

function cashVarianceReasons(
  configuration: OperationsConfigurationSnapshot,
): readonly EndDayCashVarianceReason[] {
  return (configuration.reasonCodes ?? [])
    .filter((reason) => reason.active && reason.family === 'CASH_VARIANCE')
    .map((reason) => ({
      id: reason.id,
      key: reason.key,
      family: 'CASH_VARIANCE',
      label: reason.label,
      version: reason.version,
      scope: reason.scope,
    }));
}

function normalizedDraftScopeId(value: string): string {
""",
)
replace(
    'packages/application/src/endDay.ts',
    """    const reasonByMethod = new Map(
      varianceReasons.map((entry) => [entry.paymentMethodId, entry.reason] as const),
    );
    return {
      businessDayId: context.day.id,
      completedCount: orders.filter((order) => order.status === 'DONE').length,
      cancelledCount: orders.filter((order) => order.status === 'CANCELLED').length,
      returnedCount: orders.filter((order) => order.status === 'RETURNED').length,
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
""",
    """    const varianceByMethod = new Map(
      varianceReasons.map((entry) => [entry.paymentMethodId, entry] as const),
    );
    const configuredCashVarianceReasons = cashVarianceReasons(context.configuration);
    return {
      businessDayId: context.day.id,
      completedCount: orders.filter((order) => order.status === 'DONE').length,
      cancelledCount: orders.filter((order) => order.status === 'CANCELLED').length,
      returnedCount: orders.filter((order) => order.status === 'RETURNED').length,
      recognizedSalesMinor: financial.recognizedSalesMinor,
      totalExpensesMinor: financial.totalExpensesMinor,
      cashExpensesMinor: financial.cashExpensesMinor,
      cashVarianceReasons: configuredCashVarianceReasons,
      lines: projected.map((line): EndDayPreviewLine => {
        const paymentMethod = {
          id: line.paymentMethodId,
          label: line.label,
          logicType: line.logicType,
        };
        const base = {
          paymentMethod,
          expectedMinor: line.expectedMinor,
          actualMinor: line.actualMinor,
          differenceMinor: line.differenceMinor,
        };
        if (!requireReasons || line.differenceMinor === 0) {
          return { ...base, varianceReason: null };
        }
        const varianceInput = varianceByMethod.get(line.paymentMethodId);
        if (configuredCashVarianceReasons.length > 0) {
          const selected = configuredCashVarianceReasons.find(
            (reason) => reason.id === varianceInput?.reasonCodeId,
          );
          if (selected === undefined) {
            throw new DomainInvariantError('A configured End Day variance reason is required.');
          }
          return {
            ...base,
            varianceReason: selected.label,
            varianceReasonCode: selected,
          };
        }
        return {
          ...base,
          varianceReason: normalizeEndDayVarianceReason(
            line.differenceMinor,
            varianceInput?.reason,
          ),
        };
      }),
    };
""",
)
replace(
    'packages/application/src/endDay.ts',
    """        differenceMinor: line.differenceMinor,
        varianceReason: line.varianceReason,
      })),
""",
    """        differenceMinor: line.differenceMinor,
        varianceReason: line.varianceReason,
        ...(line.varianceReasonCode === undefined
          ? {}
          : { varianceReasonCode: line.varianceReasonCode }),
      })),
""",
)
replace(
    'packages/application/src/index.ts',
    "  EndDayCloseResultValue,\n  EndDayGate,",
    "  EndDayCloseResultValue,\n  EndDayCashVarianceReason,\n  EndDayGate,",
)

# Operations UI: configured select mode, legacy textarea fallback.
replace(
    'apps/operations/src/app/EndDayFlow.tsx',
    """  const [actuals, setActuals] = useState<ReadonlyMap<PaymentMethodId, MoneyMinor>>(new Map());
  const [reasons, setReasons] = useState<ReadonlyMap<PaymentMethodId, string>>(new Map());
  const [busy, setBusy] = useState(false);
""",
    """  const [actuals, setActuals] = useState<ReadonlyMap<PaymentMethodId, MoneyMinor>>(new Map());
  const [reasons, setReasons] = useState<ReadonlyMap<PaymentMethodId, string>>(new Map());
  const [reasonCodeIds, setReasonCodeIds] = useState<ReadonlyMap<PaymentMethodId, string>>(
    new Map(),
  );
  const [busy, setBusy] = useState(false);
""",
)
replace(
    'apps/operations/src/app/EndDayFlow.tsx',
    """    setReasons(
      new Map(
        result.value.lines
          .filter((line) => line.differenceMinor !== ZERO_MONEY)
          .map((line) => [line.paymentMethod.id, '']),
      ),
    );
    setStage({ kind: 'SUMMARY', preview: result.value });
""",
    """    setReasons(
      new Map(
        result.value.lines
          .filter((line) => line.differenceMinor !== ZERO_MONEY)
          .map((line) => [line.paymentMethod.id, '']),
      ),
    );
    setReasonCodeIds(
      new Map(
        result.value.lines
          .filter((line) => line.differenceMinor !== ZERO_MONEY)
          .map((line) => [line.paymentMethod.id, '']),
      ),
    );
    setStage({ kind: 'SUMMARY', preview: result.value });
""",
)
replace(
    'apps/operations/src/app/EndDayFlow.tsx',
    """  async function closeBusinessDay(preview: EndDayPreview): Promise<void> {
    const varianceReasons: EndDayVarianceInput[] = preview.lines.map((line) => ({
      paymentMethodId: line.paymentMethod.id,
      reason:
        line.differenceMinor === ZERO_MONEY ? null : (reasons.get(line.paymentMethod.id) ?? ''),
    }));
""",
    """  async function closeBusinessDay(preview: EndDayPreview): Promise<void> {
    const configuredReasonAuthority = preview.cashVarianceReasons.length > 0;
    const varianceReasons: EndDayVarianceInput[] = preview.lines.map((line) => ({
      paymentMethodId: line.paymentMethod.id,
      reason:
        line.differenceMinor === ZERO_MONEY || configuredReasonAuthority
          ? null
          : (reasons.get(line.paymentMethod.id) ?? ''),
      ...(line.differenceMinor !== ZERO_MONEY && configuredReasonAuthority
        ? { reasonCodeId: reasonCodeIds.get(line.paymentMethod.id) ?? '' }
        : {}),
    }));
""",
)
replace(
    'apps/operations/src/app/EndDayFlow.tsx',
    """                    {line.differenceMinor === ZERO_MONEY ? null : (
                      <label htmlFor={`end-day-reason-${line.paymentMethod.id}`}>
                        Variance reason
                        <textarea
                          id={`end-day-reason-${line.paymentMethod.id}`}
                          rows={2}
                          maxLength={500}
                          value={reasons.get(line.paymentMethod.id) ?? ''}
                          disabled={busy}
                          onChange={(event) => {
                            const value = event.target.value;
                            setReasons((current) => {
                              const next = new Map(current);
                              next.set(line.paymentMethod.id, value);
                              return next;
                            });
                          }}
                        />
                      </label>
                    )}
""",
    """                    {line.differenceMinor === ZERO_MONEY ? null :
                    stage.preview.cashVarianceReasons.length > 0 ? (
                      <label htmlFor={`end-day-reason-${line.paymentMethod.id}`}>
                        Variance reason
                        <select
                          id={`end-day-reason-${line.paymentMethod.id}`}
                          value={reasonCodeIds.get(line.paymentMethod.id) ?? ''}
                          disabled={busy}
                          onChange={(event) => {
                            const value = event.target.value;
                            setReasonCodeIds((current) => {
                              const next = new Map(current);
                              next.set(line.paymentMethod.id, value);
                              return next;
                            });
                          }}
                        >
                          <option value="">Select reason</option>
                          {stage.preview.cashVarianceReasons.map((reason) => (
                            <option key={reason.id} value={reason.id}>
                              {reason.label}
                            </option>
                          ))}
                        </select>
                      </label>
                    ) : (
                      <label htmlFor={`end-day-reason-${line.paymentMethod.id}`}>
                        Variance reason
                        <textarea
                          id={`end-day-reason-${line.paymentMethod.id}`}
                          rows={2}
                          maxLength={500}
                          value={reasons.get(line.paymentMethod.id) ?? ''}
                          disabled={busy}
                          onChange={(event) => {
                            const value = event.target.value;
                            setReasons((current) => {
                              const next = new Map(current);
                              next.set(line.paymentMethod.id, value);
                              return next;
                            });
                          }}
                        />
                      </label>
                    )}
""",
)
replace(
    'apps/operations/src/app/EndDayFlow.tsx',
    """                  stage.preview.lines.some(
                    (line) =>
                      line.differenceMinor !== ZERO_MONEY &&
                      (reasons.get(line.paymentMethod.id)?.trim().length ?? 0) === 0,
                  )
""",
    """                  stage.preview.lines.some((line) => {
                    if (line.differenceMinor === ZERO_MONEY) return false;
                    if (stage.preview.cashVarianceReasons.length > 0) {
                      return (reasonCodeIds.get(line.paymentMethod.id)?.trim().length ?? 0) === 0;
                    }
                    return (reasons.get(line.paymentMethod.id)?.trim().length ?? 0) === 0;
                  })
""",
)
