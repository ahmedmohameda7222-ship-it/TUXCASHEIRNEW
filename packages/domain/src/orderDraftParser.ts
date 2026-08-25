import { DomainInvariantError } from './errors';
import {
  parseEntityId,
  type BusinessDayId,
  type DeliveryZoneId,
  type DraftLineId,
  type EntityId,
  type ModifierId,
  type OrderTypeId,
  type PaymentMethodId,
  type ProductId,
  type ShopId,
} from './ids';
import { moneyMinor } from './money';
import type { DraftOrderLine, OrderDraft, PaymentDraft } from './orderDraft';
import { instant } from './time';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class InvalidOrderDraftError extends TypeError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'InvalidOrderDraftError';
  }
}

type UnknownRecord = Record<string, unknown>;

function record(value: unknown, path: string): UnknownRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new InvalidOrderDraftError(`${path} must be an object.`);
  }
  return value as UnknownRecord;
}

function stringValue(value: unknown, path: string, allowEmpty = true): string {
  if (typeof value !== 'string' || (!allowEmpty && value.trim().length === 0)) {
    throw new InvalidOrderDraftError(
      `${path} must be ${allowEmpty ? 'a string' : 'a non-empty string'}.`,
    );
  }
  return value;
}

function nullableString(value: unknown, path: string): string | null {
  if (value === null) return null;
  return stringValue(value, path);
}

function safeInteger(value: unknown, path: string, minimum?: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new InvalidOrderDraftError(`${path} must be a safe integer.`);
  }
  if (minimum !== undefined && value < minimum) {
    throw new InvalidOrderDraftError(`${path} must be at least ${minimum}.`);
  }
  return value;
}

function uuid(value: unknown, path: string): string {
  const text = stringValue(value, path, false);
  if (!UUID_PATTERN.test(text)) throw new InvalidOrderDraftError(`${path} must be a UUID.`);
  return text;
}

function entityId<Id extends EntityId>(value: unknown, path: string): Id {
  const text = uuid(value, path);
  try {
    return parseEntityId<Id>(text);
  } catch (cause) {
    throw new InvalidOrderDraftError(`${path} must be a valid entity ID.`, { cause });
  }
}

function parseModifiers(value: unknown, path: string): DraftOrderLine['modifiers'] {
  if (!Array.isArray(value)) throw new InvalidOrderDraftError(`${path} must be an array.`);
  return value.map((entry, index) => {
    const item = record(entry, `${path}[${index}]`);
    return {
      modifierId: entityId<ModifierId>(item['modifierId'], `${path}[${index}].modifierId`),
      label: stringValue(item['label'], `${path}[${index}].label`, false),
      unitPriceMinor: moneyMinor(
        safeInteger(item['unitPriceMinor'], `${path}[${index}].unitPriceMinor`),
      ),
      quantity: safeInteger(item['quantity'], `${path}[${index}].quantity`, 1),
    };
  });
}

function parseComboBeverages(value: unknown, path: string): DraftOrderLine['comboBeverages'] {
  if (!Array.isArray(value)) throw new InvalidOrderDraftError(`${path} must be an array.`);
  return value.map((entry, index) => {
    const item = record(entry, `${path}[${index}]`);
    return {
      productId: entityId<ProductId>(item['productId'], `${path}[${index}].productId`),
      label: stringValue(item['label'], `${path}[${index}].label`, false),
    };
  });
}

function parseLines(value: unknown): readonly DraftOrderLine[] {
  if (!Array.isArray(value)) throw new InvalidOrderDraftError('OrderDraft.lines must be an array.');
  return value.map((entry, index) => {
    const line = record(entry, `OrderDraft.lines[${index}]`);
    return {
      id: entityId<DraftLineId>(line['id'], `OrderDraft.lines[${index}].id`),
      productId: entityId<ProductId>(line['productId'], `OrderDraft.lines[${index}].productId`),
      productName: stringValue(
        line['productName'],
        `OrderDraft.lines[${index}].productName`,
        false,
      ),
      unitPriceMinor: moneyMinor(
        safeInteger(line['unitPriceMinor'], `OrderDraft.lines[${index}].unitPriceMinor`),
      ),
      quantity: safeInteger(line['quantity'], `OrderDraft.lines[${index}].quantity`, 1),
      modifiers: parseModifiers(line['modifiers'], `OrderDraft.lines[${index}].modifiers`),
      comboBeverages: parseComboBeverages(
        line['comboBeverages'],
        `OrderDraft.lines[${index}].comboBeverages`,
      ),
      itemNote: nullableString(line['itemNote'], `OrderDraft.lines[${index}].itemNote`),
      addedSequence: safeInteger(
        line['addedSequence'],
        `OrderDraft.lines[${index}].addedSequence`,
        0,
      ),
    };
  });
}

function nullableMoney(value: unknown, path: string) {
  if (value === null) return null;
  return moneyMinor(safeInteger(value, path));
}

function parsePayment(value: unknown): PaymentDraft {
  const payment = record(value, 'OrderDraft.payment');
  const mode = stringValue(payment['mode'], 'OrderDraft.payment.mode', false);
  if (mode === 'NONE') return { mode: 'NONE' };
  if (mode === 'SINGLE') {
    return {
      mode: 'SINGLE',
      methodId: entityId<PaymentMethodId>(payment['methodId'], 'OrderDraft.payment.methodId'),
      cashReceivedMinor: nullableMoney(
        payment['cashReceivedMinor'],
        'OrderDraft.payment.cashReceivedMinor',
      ),
    };
  }
  if (mode === 'SPLIT') {
    return {
      mode: 'SPLIT',
      methodAId: entityId<PaymentMethodId>(payment['methodAId'], 'OrderDraft.payment.methodAId'),
      amountAMinor: moneyMinor(
        safeInteger(payment['amountAMinor'], 'OrderDraft.payment.amountAMinor'),
      ),
      methodBId: entityId<PaymentMethodId>(payment['methodBId'], 'OrderDraft.payment.methodBId'),
    };
  }
  throw new InvalidOrderDraftError('OrderDraft.payment.mode is unsupported.');
}

export function parseOrderDraft(value: unknown): OrderDraft {
  try {
    const draft = record(value, 'OrderDraft');
    const delivery = record(draft['delivery'], 'OrderDraft.delivery');
    const zoneId = delivery['zoneId'];
    const orderTypeId = draft['orderTypeId'];
    return {
      shopId: entityId<ShopId>(draft['shopId'], 'OrderDraft.shopId'),
      businessDayId: entityId<BusinessDayId>(draft['businessDayId'], 'OrderDraft.businessDayId'),
      draftScopeId: stringValue(draft['draftScopeId'], 'OrderDraft.draftScopeId', false),
      revision: safeInteger(draft['revision'], 'OrderDraft.revision', 0),
      updatedAt: instant(stringValue(draft['updatedAt'], 'OrderDraft.updatedAt', false)),
      checkoutIntentKey: uuid(draft['checkoutIntentKey'], 'OrderDraft.checkoutIntentKey'),
      orderTypeId:
        orderTypeId === null ? null : entityId<OrderTypeId>(orderTypeId, 'OrderDraft.orderTypeId'),
      lines: parseLines(draft['lines']),
      orderNote: nullableString(draft['orderNote'], 'OrderDraft.orderNote'),
      discountMinor: moneyMinor(safeInteger(draft['discountMinor'], 'OrderDraft.discountMinor')),
      delivery: {
        displayPhone: stringValue(delivery['displayPhone'], 'OrderDraft.delivery.displayPhone'),
        normalizedPhone: stringValue(
          delivery['normalizedPhone'],
          'OrderDraft.delivery.normalizedPhone',
        ),
        customerName: stringValue(delivery['customerName'], 'OrderDraft.delivery.customerName'),
        address: stringValue(delivery['address'], 'OrderDraft.delivery.address'),
        zoneId:
          zoneId === null ? null : entityId<DeliveryZoneId>(zoneId, 'OrderDraft.delivery.zoneId'),
        zoneLabel: stringValue(delivery['zoneLabel'], 'OrderDraft.delivery.zoneLabel'),
        configuredFeeMinor: moneyMinor(
          safeInteger(delivery['configuredFeeMinor'], 'OrderDraft.delivery.configuredFeeMinor'),
        ),
        finalFeeMinor: moneyMinor(
          safeInteger(delivery['finalFeeMinor'], 'OrderDraft.delivery.finalFeeMinor'),
        ),
      },
      payment: parsePayment(draft['payment']),
    };
  } catch (cause) {
    if (cause instanceof InvalidOrderDraftError) throw cause;
    if (cause instanceof DomainInvariantError) {
      throw new InvalidOrderDraftError(cause.message, { cause });
    }
    throw new InvalidOrderDraftError('OrderDraft payload is invalid.', { cause });
  }
}
