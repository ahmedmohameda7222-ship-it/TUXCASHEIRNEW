import type { PaymentMethod } from './catalog';
import type { CheckoutChannel } from './checkoutPolicy';
import { DomainInvariantError } from './errors';
import type { DeliveryZoneId } from './ids';
import { moneyMinor, subtractMoney, ZERO_MONEY, type MoneyMinor } from './money';
import type { PaymentMethodSnapshot } from './models';
import type { PaymentDraft } from './orderDraft';
import type { PaymentMethodZoneRuleSetting } from './settings';

export interface PreparedPaymentPart {
  readonly method: PaymentMethodSnapshot;
  readonly allocatedMinor: MoneyMinor;
  readonly receivedMinor: MoneyMinor | null;
  readonly changeMinor: MoneyMinor | null;
}

export interface PaymentPreparationContext {
  readonly channel?: CheckoutChannel;
  readonly deliveryZoneId?: DeliveryZoneId | null;
  readonly paymentMethodZoneRules?: readonly PaymentMethodZoneRuleSetting[];
}

function activeMethod(
  methods: readonly PaymentMethod[],
  id: PaymentMethod['id'],
  context: PaymentPreparationContext,
): PaymentMethod {
  const method = methods.find((candidate) => candidate.id === id && candidate.active);
  if (method === undefined) {
    throw new DomainInvariantError('Selected payment method is unavailable.');
  }

  const configuredChannel = method.channel ?? 'BOTH';
  if (
    context.channel !== undefined &&
    configuredChannel !== 'BOTH' &&
    configuredChannel !== context.channel
  ) {
    throw new DomainInvariantError(
      `Selected payment method is unavailable for ${context.channel} checkout.`,
    );
  }

  if (context.deliveryZoneId !== undefined && context.deliveryZoneId !== null) {
    const zoneRule = context.paymentMethodZoneRules?.find(
      (candidate) =>
        candidate.paymentMethodId === method.id &&
        candidate.deliveryZoneId === context.deliveryZoneId,
    );
    if (zoneRule?.allowed === false) {
      throw new DomainInvariantError('Selected payment method is unavailable for this delivery zone.');
    }
  }

  return method;
}

function preparePart(
  method: PaymentMethod,
  allocatedMinor: MoneyMinor,
  cashReceivedMinor: MoneyMinor | null,
): PreparedPaymentPart {
  if (allocatedMinor < 0) {
    throw new DomainInvariantError('Payment allocation cannot be negative.');
  }
  const snapshot: PaymentMethodSnapshot = {
    id: method.id,
    label: method.displayName,
    logicType: method.logicType,
    channel: method.channel ?? 'BOTH',
    requiresReference: method.requiresReference ?? false,
    manualConfirmationRequired: method.manualConfirmationRequired ?? false,
    refundAllowed: method.refundAllowed ?? true,
  };
  if (method.logicType !== 'CASH') {
    return { method: snapshot, allocatedMinor, receivedMinor: null, changeMinor: null };
  }
  const effectiveReceived = cashReceivedMinor ?? allocatedMinor;
  if (effectiveReceived < allocatedMinor) {
    throw new DomainInvariantError('Cash Received cannot be less than the Cash allocation.');
  }
  return {
    method: snapshot,
    allocatedMinor,
    receivedMinor: effectiveReceived,
    changeMinor: subtractMoney(effectiveReceived, allocatedMinor),
  };
}

export function preparePaymentParts(
  draft: PaymentDraft,
  methods: readonly PaymentMethod[],
  totalMinor: MoneyMinor,
  context: PaymentPreparationContext = {},
): readonly PreparedPaymentPart[] {
  if (totalMinor < 0) {
    throw new DomainInvariantError('Order total cannot be negative.');
  }
  if (totalMinor === ZERO_MONEY && draft.mode === 'NONE') {
    return [];
  }
  if (draft.mode === 'NONE') {
    throw new DomainInvariantError('Select a payment method.');
  }
  if (draft.mode === 'SINGLE') {
    const method = activeMethod(methods, draft.methodId, context);
    return [preparePart(method, totalMinor, draft.cashReceivedMinor)];
  }

  if (draft.methodAId === draft.methodBId) {
    throw new DomainInvariantError('Split payment methods must be different.');
  }
  if (draft.amountAMinor < ZERO_MONEY || draft.amountAMinor > totalMinor) {
    throw new DomainInvariantError('Split Amount A must be between zero and the order total.');
  }
  const remainder = subtractMoney(totalMinor, draft.amountAMinor);
  const methodA = activeMethod(methods, draft.methodAId, context);
  const methodB = activeMethod(methods, draft.methodBId, context);
  return [preparePart(methodA, draft.amountAMinor, null), preparePart(methodB, remainder, null)];
}

export function parsePoundsToMinor(raw: string): MoneyMinor | null {
  const trimmed = raw.trim();
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(trimmed);
  if (match === null) return null;

  const poundsPart = match[1];
  if (poundsPart === undefined) return null;
  const fractionPart = (match[2] ?? '').padEnd(2, '0');
  const minor = BigInt(poundsPart) * 100n + BigInt(fractionPart || '0');
  if (minor > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return moneyMinor(Number(minor));
}

export function parseWholePoundsToMinor(raw: string): MoneyMinor | null {
  if (!/^\d+$/.test(raw.trim())) return null;
  return parsePoundsToMinor(raw);
}