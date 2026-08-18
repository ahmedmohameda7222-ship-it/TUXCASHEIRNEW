import type { ExpenseMutationResult, ExpensesLedgerResult } from '@tux/application';

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

export function assertExpensesLedgerResult(value: unknown): ExpensesLedgerResult {
  assertResult(value, 'Expenses ledger result');
  if (value['ok']) {
    assertObject(value['value'], 'Expenses ledger value');
    if (!Array.isArray(value['value']['expenses'])) {
      throw new TypeError('Expenses ledger value.expenses must be an array.');
    }
    if (
      typeof value['value']['totalExpensesMinor'] !== 'number' ||
      typeof value['value']['cashExpensesMinor'] !== 'number'
    ) {
      throw new TypeError('Expenses ledger totals are invalid.');
    }
  }
  return value as unknown as ExpensesLedgerResult;
}

export function assertExpenseMutationResult(value: unknown): ExpenseMutationResult {
  assertResult(value, 'Expense mutation result');
  if (value['ok']) {
    assertObject(value['value'], 'Expense mutation value');
    if (typeof value['value']['id'] !== 'string' || value['value']['kind'] !== 'MANUAL') {
      throw new TypeError('Expense mutation value is invalid.');
    }
  }
  return value as unknown as ExpenseMutationResult;
}
