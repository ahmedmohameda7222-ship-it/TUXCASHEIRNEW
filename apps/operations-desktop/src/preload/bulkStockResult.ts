import type { BulkStockBoardResult, BulkStockMutationResult } from '@tux/application';

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

export function assertBulkStockBoardResult(value: unknown): BulkStockBoardResult {
  assertResult(value, 'Bulk Stock board result');
  if (value['ok']) {
    assertObject(value['value'], 'Bulk Stock board value');
    if (!Array.isArray(value['value']['items'])) {
      throw new TypeError('Bulk Stock board items must be an array.');
    }
    for (const item of value['value']['items']) {
      assertObject(item, 'Bulk Stock item');
      if (
        typeof item['id'] !== 'string' ||
        typeof item['name'] !== 'string' ||
        typeof item['unitLabel'] !== 'string' ||
        typeof item['balanceMicros'] !== 'number' ||
        typeof item['currentWholeUnits'] !== 'number'
      ) {
        throw new TypeError('Bulk Stock item is invalid.');
      }
    }
  }
  return value as unknown as BulkStockBoardResult;
}

export function assertBulkStockMutationResult(value: unknown): BulkStockMutationResult {
  assertResult(value, 'Bulk Stock mutation result');
  if (value['ok']) {
    assertObject(value['value'], 'Bulk Stock mutation value');
    assertObject(value['value']['movement'], 'Bulk Stock movement');
    if (
      typeof value['value']['movement']['id'] !== 'string' ||
      typeof value['value']['movement']['itemId'] !== 'string' ||
      typeof value['value']['movement']['movementType'] !== 'string' ||
      typeof value['value']['movement']['quantityDeltaMicros'] !== 'number' ||
      (value['value']['undoUntil'] !== null && typeof value['value']['undoUntil'] !== 'string')
    ) {
      throw new TypeError('Bulk Stock mutation value is invalid.');
    }
  }
  return value as unknown as BulkStockMutationResult;
}
