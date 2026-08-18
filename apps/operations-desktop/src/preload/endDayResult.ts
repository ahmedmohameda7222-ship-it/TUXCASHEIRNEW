import type {
  ApplicationError,
  EndDayCloseResult,
  EndDayGateResult,
  EndDayPreviewResult,
  Result,
} from '@tux/application';

function assertObject(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
}

function assertResult(value: unknown, label: string): asserts value is Record<string, unknown> {
  assertObject(value, label);
  if (typeof value['ok'] !== 'boolean') throw new TypeError(`${label}.ok must be boolean.`);
  if (!value['ok']) {
    assertObject(value['error'], `${label}.error`);
    if (
      typeof value['error']['code'] !== 'string' ||
      typeof value['error']['message'] !== 'string'
    ) {
      throw new TypeError(`${label}.error is invalid.`);
    }
  }
}

export function assertEndDayGateResult(value: unknown): EndDayGateResult {
  assertResult(value, 'End Day gate result');
  if (value['ok']) {
    assertObject(value['value'], 'End Day gate');
    const kind = value['value']['kind'];
    if (
      typeof kind !== 'string' ||
      typeof value['value']['businessDayId'] !== 'string' ||
      !['ACTIVE_ORDERS_BLOCKED', 'UNFINISHED_DRAFT', 'READY'].includes(kind)
    ) {
      throw new TypeError('End Day gate is invalid.');
    }
    if (kind === 'ACTIVE_ORDERS_BLOCKED' && !Array.isArray(value['value']['activeOrderNos'])) {
      throw new TypeError('End Day Active Orders gate is invalid.');
    }
    if (kind === 'READY' && !Array.isArray(value['value']['paymentMethods'])) {
      throw new TypeError('End Day READY gate is invalid.');
    }
  }
  return value as unknown as EndDayGateResult;
}

export function assertEndDayPreviewResult(value: unknown): EndDayPreviewResult {
  assertResult(value, 'End Day preview result');
  if (value['ok']) {
    assertObject(value['value'], 'End Day preview');
    if (
      typeof value['value']['businessDayId'] !== 'string' ||
      typeof value['value']['recognizedSalesMinor'] !== 'number' ||
      typeof value['value']['totalExpensesMinor'] !== 'number' ||
      typeof value['value']['cashExpensesMinor'] !== 'number' ||
      !Array.isArray(value['value']['lines'])
    ) {
      throw new TypeError('End Day preview is invalid.');
    }
  }
  return value as unknown as EndDayPreviewResult;
}

export function assertEndDayCloseResult(value: unknown): EndDayCloseResult {
  assertResult(value, 'End Day close result');
  if (value['ok']) {
    assertObject(value['value'], 'End Day close value');
    if (
      typeof value['value']['businessDayId'] !== 'string' ||
      typeof value['value']['closedAt'] !== 'string' ||
      typeof value['value']['replayed'] !== 'boolean'
    ) {
      throw new TypeError('End Day close value is invalid.');
    }
  }
  return value as unknown as EndDayCloseResult;
}

export function assertEndDayDiscardResult(
  value: unknown,
): Result<true, ApplicationError> {
  assertResult(value, 'End Day discard result');
  if (value['ok'] && value['value'] !== true) {
    throw new TypeError('End Day discard result value must be true.');
  }
  return value as unknown as Result<true, ApplicationError>;
}
