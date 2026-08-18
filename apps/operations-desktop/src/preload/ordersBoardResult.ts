import type { OrderTransitionResult, OrdersBoardResult } from '@tux/application';

function assertObject(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
}

function assertResultShape(
  value: unknown,
  label: string,
): asserts value is Record<string, unknown> {
  assertObject(value, label);
  if (typeof value['ok'] !== 'boolean') {
    throw new TypeError(`${label}.ok must be boolean.`);
  }
  if (value['ok']) {
    if (!('value' in value)) throw new TypeError(`${label} success is missing value.`);
  } else {
    assertObject(value['error'], `${label}.error`);
    if (
      typeof value['error']['code'] !== 'string' ||
      typeof value['error']['message'] !== 'string'
    ) {
      throw new TypeError(`${label}.error is invalid.`);
    }
  }
}

export function assertOrdersBoardResult(value: unknown): OrdersBoardResult {
  assertResultShape(value, 'Orders Board result');
  if (value['ok']) {
    assertObject(value['value'], 'Orders Board value');
    if (!Array.isArray(value['value']['orders'])) {
      throw new TypeError('Orders Board value.orders must be an array.');
    }
  }
  return value as unknown as OrdersBoardResult;
}

export function assertOrderTransitionResult(value: unknown): OrderTransitionResult {
  assertResultShape(value, 'Order transition result');
  if (value['ok']) {
    assertObject(value['value'], 'Order transition value');
    if (typeof value['value']['id'] !== 'string' || typeof value['value']['status'] !== 'string') {
      throw new TypeError('Order transition value is invalid.');
    }
  }
  return value as unknown as OrderTransitionResult;
}
