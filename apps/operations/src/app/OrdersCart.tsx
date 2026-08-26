import {
  ZERO_MONEY,
  addMoney,
  applyDeliveryZone,
  calculateDraftLineTotal,
  calculateOrderPricing,
  parseEntityId,
  preparePaymentParts,
  subtractMoney,
  suggestCashTenders,
  type DraftLineId,
  type MoneyMinor,
  type OperationsConfigurationSnapshot,
  type OrderDraft,
  type OrderTypeId,
  type OrderValidationIssue,
  type PaymentMethod,
  type PaymentMethodId,
} from '@tux/domain';
import { useEffect, useId, useMemo, useState } from 'react';
import { EditPencilIcon, PlusCircleIcon } from './icons';
import { MoneyInput, OptionalMoneyInput } from './MoneyInput';
import { formatMoneyMinor } from './ordersView';

export type DraftMutation = (draft: OrderDraft) => OrderDraft;

function DraftTextField({
  id,
  label,
  value,
  multiline = false,
  placeholder,
  disabled,
  onCommit,
}: {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly multiline?: boolean;
  readonly placeholder?: string;
  readonly disabled: boolean;
  readonly onCommit: (value: string) => void;
}) {
  const [raw, setRaw] = useState(value);

  useEffect(() => {
    setRaw(value);
  }, [value]);

  const common = {
    id,
    value: raw,
    placeholder,
    disabled,
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setRaw(event.target.value),
    onBlur: () => onCommit(raw),
  };

  return (
    <label className="field-stack" htmlFor={id}>
      <span>{label}</span>
      {multiline ? <textarea {...common} rows={3} /> : <input {...common} type="text" />}
    </label>
  );
}

function SectionIssues({
  issues,
  paths,
}: {
  readonly issues: readonly OrderValidationIssue[];
  readonly paths: readonly string[];
}) {
  const matching = issues.filter((issue) => paths.some((path) => issue.path === path));
  if (matching.length === 0) return null;
  return (
    <div className="section-errors" role="alert">
      {matching.map((issue) => (
        <p key={`${issue.path}:${issue.code}`}>{issue.message}</p>
      ))}
    </div>
  );
}

function activePaymentMethods(
  configuration: OperationsConfigurationSnapshot,
): readonly PaymentMethod[] {
  return configuration.paymentMethods
    .filter((method) => method.active && method.logicType !== 'CARD')
    .sort((left, right) => left.sortOrder - right.sortOrder);
}

function methodById(
  methods: readonly PaymentMethod[],
  methodId: PaymentMethodId,
): PaymentMethod | null {
  return methods.find((method) => method.id === methodId) ?? null;
}

function CashEditor({
  idPrefix,
  label,
  allocatedMinor,
  receivedMinor,
  busy,
  onCommit,
}: {
  readonly idPrefix: string;
  readonly label: string;
  readonly allocatedMinor: MoneyMinor;
  readonly receivedMinor: MoneyMinor | null;
  readonly busy: boolean;
  readonly onCommit: (value: MoneyMinor | null) => void;
}) {
  const suggestions = useMemo(() => suggestCashTenders(allocatedMinor), [allocatedMinor]);
  const changeMinor =
    receivedMinor !== null && receivedMinor >= allocatedMinor
      ? subtractMoney(receivedMinor, allocatedMinor)
      : null;

  return (
    <div className="cash-editor">
      <OptionalMoneyInput
        id={`${idPrefix}-cash-received`}
        label={label}
        value={receivedMinor}
        disabled={busy}
        compact
        onCommit={onCommit}
      />
      {suggestions.length > 0 ? (
        <div className="tender-suggestions" aria-label="Smart Cash tenders">
          {suggestions.map((suggestion) => (
            <button
              type="button"
              key={suggestion.totalMinor}
              disabled={busy}
              onClick={() => onCommit(suggestion.totalMinor)}
              title={suggestion.notesMinor.map(formatMoneyMinor).join(' + ')}
            >
              {formatMoneyMinor(suggestion.totalMinor)}
            </button>
          ))}
        </div>
      ) : null}
      {changeMinor === null ? null : (
        <div className="change-row">
          <span>Change</span>
          <strong>{formatMoneyMinor(changeMinor)}</strong>
        </div>
      )}
    </div>
  );
}

export function OrdersCart({
  draft,
  configuration,
  issues,
  busy,
  placing,
  onMutate,
  onEditLine,
  onEditLineExtras,
  onDecrementLine,
  onIncrementLine,
  onClear,
  onDeliveryPhoneCommit,
  onPlace,
}: {
  readonly draft: OrderDraft;
  readonly configuration: OperationsConfigurationSnapshot;
  readonly issues: readonly OrderValidationIssue[];
  readonly busy: boolean;
  readonly placing: boolean;
  readonly onMutate: (mutation: DraftMutation) => void;
  readonly onEditLine: (lineId: DraftLineId) => void;
  readonly onEditLineExtras: (lineId: DraftLineId) => void;
  readonly onDecrementLine: (lineId: DraftLineId) => void;
  readonly onIncrementLine: (lineId: DraftLineId) => void;
  readonly onClear: () => void;
  readonly onDeliveryPhoneCommit: (displayPhone: string) => void;
  readonly onPlace: () => void;
}) {
  const instanceId = useId();
  const controlId = (suffix: string): string => `${instanceId}-${suffix}`;
  const orderTypes = configuration.orderTypes
    .filter((orderType) => orderType.active)
    .sort((left, right) => left.sortOrder - right.sortOrder);
  const selectedOrderType =
    orderTypes.find((orderType) => orderType.id === draft.orderTypeId) ?? null;
  const delivery = selectedOrderType?.behavior === 'DELIVERY';
  const methods = activePaymentMethods(configuration);
  const itemsSubtotalMinor = useMemo(
    () => addMoney(...draft.lines.map(calculateDraftLineTotal)),
    [draft.lines],
  );
  const pricing = useMemo(() => {
    try {
      return calculateOrderPricing({
        lines: draft.lines,
        discountMinor: draft.discountMinor,
        deliveryFeeMinor: delivery ? draft.delivery.finalFeeMinor : ZERO_MONEY,
      });
    } catch {
      return null;
    }
  }, [delivery, draft.delivery.finalFeeMinor, draft.discountMinor, draft.lines]);

  const preparedPayments = useMemo(() => {
    if (pricing === null) return null;
    try {
      return preparePaymentParts(draft.payment, methods, pricing.totalMinor);
    } catch {
      return null;
    }
  }, [draft.payment, methods, pricing]);

  const totalQuantity = draft.lines.reduce((total, line) => total + line.quantity, 0);
  const discountHasIssue = issues.some((issue) => issue.path === 'discount');
  const [noteExpanded, setNoteExpanded] = useState(draft.orderNote !== null);
  const [discountExpanded, setDiscountExpanded] = useState(
    draft.discountMinor > ZERO_MONEY || discountHasIssue,
  );

  useEffect(() => {
    if (draft.orderNote !== null) setNoteExpanded(true);
  }, [draft.orderNote]);

  useEffect(() => {
    if (draft.discountMinor > ZERO_MONEY || discountHasIssue) {
      setDiscountExpanded(true);
    }
  }, [draft.discountMinor, discountHasIssue]);

  function selectOrderType(orderTypeId: OrderTypeId): void {
    onMutate((current) => ({ ...current, orderTypeId }));
  }

  function selectSingleMethod(method: PaymentMethod): void {
    onMutate((current) => ({
      ...current,
      payment: {
        mode: 'SINGLE',
        methodId: method.id,
        cashReceivedMinor: null,
      },
    }));
  }

  function startSplit(): void {
    const methodA = methods[0];
    const methodB = methods.find((method) => method.id !== methodA?.id);
    if (methodA === undefined || methodB === undefined) return;
    onMutate((current) => ({
      ...current,
      payment: {
        mode: 'SPLIT',
        methodAId: methodA.id,
        amountAMinor: ZERO_MONEY,
        methodBId: methodB.id,
      },
    }));
  }

  return (
    <aside className="orders-cart" aria-label="Current order">
      <div className="cart-heading">
        <div>
          <strong className="cart-title">Current Order</strong>
          <span className="cart-count">
            {totalQuantity === 0
              ? 'Empty'
              : `${totalQuantity} item${totalQuantity === 1 ? '' : 's'}`}
          </span>
        </div>
        <button
          type="button"
          className="quiet-action destructive-text"
          disabled={busy || draft.lines.length === 0}
          onClick={onClear}
        >
          Clear
        </button>
      </div>

      <div className="cart-scroll">
        <section
          className="cart-section cart-lines-section"
          aria-labelledby={controlId('cart-items-title')}
        >
          <div className="section-heading-row">
            <h2 id={controlId('cart-items-title')}>Items</h2>
            <span>{formatMoneyMinor(itemsSubtotalMinor)}</span>
          </div>
          {draft.lines.length === 0 ? (
            <div className="cart-empty">
              <p>Your order is empty.</p>
              <span>Choose items from the menu.</span>
            </div>
          ) : (
            <div className="cart-lines">
              {draft.lines.map((line) => {
                const lineIssues = issues.filter((issue) => issue.path === `line:${line.id}`);
                return (
                  <article className="cart-line" key={line.id}>
                    <div className="cart-line-top">
                      <div>
                        <strong>{line.productName}</strong>
                        <span>× {line.quantity}</span>
                      </div>
                      <strong>{formatMoneyMinor(calculateDraftLineTotal(line))}</strong>
                    </div>
                    {line.modifiers.length > 0 ? (
                      <p className="line-meta">
                        {line.modifiers
                          .map((modifier) => `${modifier.quantity}× ${modifier.label}`)
                          .join(' · ')}
                      </p>
                    ) : null}
                    {line.comboBeverages.length > 0 ? (
                      <p className="line-meta">
                        {line.comboBeverages.map((beverage) => beverage.label).join(' · ')}
                      </p>
                    ) : null}
                    {line.itemNote === null ? null : <p className="line-note">“{line.itemNote}”</p>}
                    {lineIssues.map((issue) => (
                      <p className="field-error" key={issue.code}>
                        {issue.message}
                      </p>
                    ))}
                    <div className="line-actions" aria-label={`${line.productName} actions`}>
                      <div
                        className="line-quantity-stepper"
                        aria-label={`${line.productName} quantity`}
                      >
                        <button
                          type="button"
                          aria-label={`Decrease ${line.productName} quantity`}
                          disabled={busy}
                          onClick={() => onDecrementLine(line.id)}
                        >
                          −
                        </button>
                        <output aria-label={`${line.productName} quantity`}>{line.quantity}</output>
                        <button
                          type="button"
                          aria-label={`Increase ${line.productName} quantity`}
                          disabled={busy}
                          onClick={() => onIncrementLine(line.id)}
                        >
                          +
                        </button>
                      </div>
                      <button type="button" disabled={busy} onClick={() => onEditLine(line.id)}>
                        Edit
                      </button>
                      <button
                        type="button"
                        className="line-extra-action"
                        disabled={busy}
                        onClick={() => onEditLineExtras(line.id)}
                      >
                        {line.modifiers.length > 0 ? (
                          <EditPencilIcon data-icon="edit-pencil" />
                        ) : (
                          <PlusCircleIcon data-icon="plus-circle" />
                        )}
                        <span>Extra</span>
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
          <SectionIssues issues={issues} paths={['cart']} />
        </section>

        <section
          className="cart-section order-type-section"
          aria-labelledby={controlId('order-type-title')}
        >
          <h2 id={controlId('order-type-title')}>Order type</h2>
          <div className="segmented-control">
            {orderTypes.map((orderType) => (
              <button
                type="button"
                key={orderType.id}
                className={draft.orderTypeId === orderType.id ? 'selected' : undefined}
                disabled={busy}
                onClick={() => selectOrderType(orderType.id)}
              >
                {orderType.name}
              </button>
            ))}
          </div>
          <SectionIssues issues={issues} paths={['orderType']} />
        </section>

        {delivery ? (
          <section
            className="cart-section delivery-section"
            aria-labelledby={controlId('delivery-title')}
          >
            <h2 id={controlId('delivery-title')}>Delivery</h2>
            <DraftTextField
              id={controlId('delivery-phone')}
              label="Phone"
              value={draft.delivery.displayPhone}
              placeholder="01xxxxxxxxx"
              disabled={busy}
              onCommit={onDeliveryPhoneCommit}
            />
            <DraftTextField
              id={controlId('delivery-name')}
              label="Customer name"
              value={draft.delivery.customerName}
              disabled={busy}
              onCommit={(customerName) =>
                onMutate((current) => ({
                  ...current,
                  delivery: { ...current.delivery, customerName },
                }))
              }
            />
            <label className="field-stack" htmlFor={controlId('delivery-zone')}>
              <span>Zone</span>
              <select
                id={controlId('delivery-zone')}
                value={draft.delivery.zoneId ?? ''}
                disabled={busy}
                onChange={(event) => {
                  if (event.target.value === '') return;
                  const zoneId = parseEntityId<NonNullable<OrderDraft['delivery']['zoneId']>>(
                    event.target.value,
                  );
                  const zone = configuration.deliveryZones.find(
                    (candidate) => candidate.id === zoneId && candidate.active,
                  );
                  if (zone !== undefined) onMutate((current) => applyDeliveryZone(current, zone));
                }}
              >
                <option value="">Choose a zone</option>
                {configuration.deliveryZones
                  .filter((zone) => zone.active)
                  .sort((left, right) => left.sortOrder - right.sortOrder)
                  .map((zone) => (
                    <option key={zone.id} value={zone.id}>
                      {zone.name} — {formatMoneyMinor(zone.feeMinor)}
                    </option>
                  ))}
              </select>
            </label>
            <DraftTextField
              id={controlId('delivery-address')}
              label="Full address"
              value={draft.delivery.address}
              multiline
              disabled={busy}
              onCommit={(address) =>
                onMutate((current) => ({
                  ...current,
                  delivery: { ...current.delivery, address },
                }))
              }
            />
            <SectionIssues
              issues={issues}
              paths={['delivery.phone', 'delivery.name', 'delivery.zone', 'delivery.address']}
            />
          </section>
        ) : null}

        {draft.lines.length > 0 ? (
          <section
            className="cart-section adjustments-section"
            aria-labelledby={controlId('adjustments-title')}
          >
            <h2 id={controlId('adjustments-title')}>Notes & discount</h2>
            <button
              type="button"
              className="adjustment-disclosure"
              aria-expanded={noteExpanded}
              aria-controls={controlId('order-note-editor')}
              disabled={busy}
              onClick={() => setNoteExpanded((expanded) => !expanded)}
            >
              <span>{draft.orderNote === null ? 'Add order note' : 'Order note'}</span>
              {draft.orderNote === null ? null : <strong>Added</strong>}
            </button>
            {noteExpanded ? (
              <div className="adjustment-editor" id={controlId('order-note-editor')}>
                <DraftTextField
                  id={controlId('order-note')}
                  label="Order note"
                  value={draft.orderNote ?? ''}
                  multiline
                  placeholder="For the whole order"
                  disabled={busy}
                  onCommit={(value) => {
                    const nextNote = value.trim().length === 0 ? null : value;
                    onMutate((current) => ({ ...current, orderNote: nextNote }));
                    if (nextNote === null) setNoteExpanded(false);
                  }}
                />
              </div>
            ) : null}
            <button
              type="button"
              className="adjustment-disclosure"
              aria-expanded={discountExpanded}
              aria-controls={controlId('discount-editor')}
              disabled={busy}
              onClick={() => setDiscountExpanded((expanded) => !expanded)}
            >
              <span>Discount · {formatMoneyMinor(draft.discountMinor)}</span>
            </button>
            {discountExpanded ? (
              <div className="adjustment-editor" id={controlId('discount-editor')}>
                <MoneyInput
                  id={controlId('discount')}
                  label="Discount"
                  value={draft.discountMinor}
                  disabled={busy}
                  onCommit={(discountMinor) => {
                    onMutate((current) => ({ ...current, discountMinor }));
                    if (discountMinor === ZERO_MONEY && !discountHasIssue) {
                      setDiscountExpanded(false);
                    }
                  }}
                />
              </div>
            ) : null}
            <SectionIssues issues={issues} paths={['discount']} />
          </section>
        ) : null}

        {draft.lines.length > 0 ? (
          <section
            className="cart-section payment-section"
            aria-labelledby={controlId('payment-title')}
          >
            <div className="section-heading-row">
              <h2 id={controlId('payment-title')}>Payment</h2>
              {draft.payment.mode === 'SPLIT' ? <span>Split 2 ways</span> : null}
            </div>

            {draft.payment.mode !== 'SPLIT' ? (
              <>
                <div className="payment-methods">
                  {methods.map((method) => (
                    <button
                      type="button"
                      key={method.id}
                      className={
                        draft.payment.mode === 'SINGLE' && draft.payment.methodId === method.id
                          ? 'selected'
                          : undefined
                      }
                      disabled={busy}
                      onClick={() => selectSingleMethod(method)}
                    >
                      {method.displayName}
                    </button>
                  ))}
                </div>{' '}
                {draft.payment.mode === 'SINGLE' && pricing !== null ? (
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
                {methods.length >= 2 ? (
                  <button
                    type="button"
                    className="split-payment-action"
                    disabled={busy}
                    onClick={startSplit}
                  >
                    Split payment
                  </button>
                ) : null}
              </>
            ) : pricing === null ? null : (
              <div className="split-editor">
                <div className="split-method-block">
                  <label className="field-stack" htmlFor={controlId('split-method-a')}>
                    <span>Method A</span>
                    <select
                      id={controlId('split-method-a')}
                      value={draft.payment.methodAId}
                      disabled={busy}
                      onChange={(event) => {
                        const methodAId = parseEntityId<PaymentMethodId>(event.target.value);
                        onMutate((current) => {
                          if (current.payment.mode !== 'SPLIT') return current;
                          const fallbackB = methods.find((method) => method.id !== methodAId);
                          return {
                            ...current,
                            payment: {
                              ...current.payment,
                              methodAId,
                              methodBId:
                                current.payment.methodBId === methodAId && fallbackB !== undefined
                                  ? fallbackB.id
                                  : current.payment.methodBId,
                            },
                          };
                        });
                      }}
                    >
                      {methods.map((method) => (
                        <option key={method.id} value={method.id}>
                          {method.displayName}
                        </option>
                      ))}
                    </select>
                  </label>
                  <MoneyInput
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
                </div>

                <div className="split-method-block">
                  <label className="field-stack" htmlFor={controlId('split-method-b')}>
                    <span>Method B</span>
                    <select
                      id={controlId('split-method-b')}
                      value={draft.payment.methodBId}
                      disabled={busy}
                      onChange={(event) => {
                        const methodBId = parseEntityId<PaymentMethodId>(event.target.value);
                        onMutate((current) => {
                          if (current.payment.mode !== 'SPLIT') return current;
                          const fallbackA = methods.find((method) => method.id !== methodBId);
                          return {
                            ...current,
                            payment: {
                              ...current.payment,
                              methodBId,
                              methodAId:
                                current.payment.methodAId === methodBId && fallbackA !== undefined
                                  ? fallbackA.id
                                  : current.payment.methodAId,
                            },
                          };
                        });
                      }}
                    >
                      {methods.map((method) => (
                        <option key={method.id} value={method.id}>
                          {method.displayName}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="split-remainder">
                    <span>Amount B</span>
                    <strong>
                      {draft.payment.amountAMinor <= pricing.totalMinor
                        ? formatMoneyMinor(
                            subtractMoney(pricing.totalMinor, draft.payment.amountAMinor),
                          )
                        : '—'}
                    </strong>
                  </div>
                </div>

                <button
                  type="button"
                  className="split-payment-action"
                  disabled={busy}
                  onClick={() => onMutate((current) => ({ ...current, payment: { mode: 'NONE' } }))}
                >
                  Cancel split
                </button>
              </div>
            )}

            <SectionIssues issues={issues} paths={['payment']} />
          </section>
        ) : null}
      </div>

      <div className="cart-totals">
        <dl>
          <div>
            <dt>Items</dt>
            <dd>{formatMoneyMinor(itemsSubtotalMinor)}</dd>
          </div>
          <div>
            <dt>Discount</dt>
            <dd>
              {draft.discountMinor === ZERO_MONEY
                ? formatMoneyMinor(ZERO_MONEY)
                : `− ${formatMoneyMinor(draft.discountMinor)}`}
            </dd>
          </div>
          {delivery ? (
            <div className="delivery-total-editor">
              <MoneyInput
                id={controlId('delivery-fee')}
                label="Delivery"
                value={draft.delivery.finalFeeMinor}
                disabled={busy}
                compact
                onCommit={(finalFeeMinor) =>
                  onMutate((current) => ({
                    ...current,
                    delivery: { ...current.delivery, finalFeeMinor },
                  }))
                }
              />
              {draft.delivery.zoneId === null ||
              draft.delivery.configuredFeeMinor === draft.delivery.finalFeeMinor ? null : (
                <span className="delivery-zone-reference">
                  Zone reference: {formatMoneyMinor(draft.delivery.configuredFeeMinor)}
                </span>
              )}
            </div>
          ) : null}
          <div className="grand-total">
            <dt>Total</dt>
            <dd>{pricing === null ? '—' : formatMoneyMinor(pricing.totalMinor)}</dd>
          </div>
        </dl>
        {preparedPayments === null ? null : preparedPayments.some(
            (part) => part.changeMinor !== null && part.changeMinor > ZERO_MONEY,
          ) ? (
          <p className="payment-summary">
            Change:{' '}
            {formatMoneyMinor(
              addMoney(...preparedPayments.map((part) => part.changeMinor ?? ZERO_MONEY)),
            )}
          </p>
        ) : null}
        <button
          type="button"
          className="place-order-action"
          aria-label="Place Order"
          disabled={busy || placing || draft.lines.length === 0}
          onClick={onPlace}
        >
          <span>{placing ? 'Saving order…' : 'Place Order'}</span>
          <strong>{pricing === null ? '—' : formatMoneyMinor(pricing.totalMinor)}</strong>
        </button>
      </div>
    </aside>
  );
}
