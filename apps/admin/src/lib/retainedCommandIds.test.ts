import { afterEach, describe, expect, it, vi } from 'vitest';

import { createRetainedCommandIds, isPendingApprovalResult } from './retainedCommandIds';

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear() {
      values.clear();
    },
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    key(index: number) {
      return [...values.keys()][index] ?? null;
    },
    removeItem(key: string) {
      values.delete(key);
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('retained Admin command IDs', () => {
  it('isolates durable pending intents between authenticated employees', () => {
    vi.stubGlobal('localStorage', memoryStorage());
    const ids = ['command-a', 'command-b', 'command-c'];
    const createId = () => ids.shift() ?? 'unexpected-command';
    const intent = { shopId: 'shop-1', quantity: 3 };

    const employeeA = createRetainedCommandIds('employee-a', createId);
    expect(employeeA.forIntent('inventory.adjust', intent)).toBe('command-a');

    const employeeB = createRetainedCommandIds('employee-b', createId);
    expect(employeeB.forIntent('inventory.adjust', intent)).toBe('command-b');

    const employeeAReload = createRetainedCommandIds('employee-a', createId);
    expect(employeeAReload.forIntent('inventory.adjust', intent)).toBe('command-a');
  });

  it('survives a hook/page lifetime until an authoritative terminal response clears the intent', () => {
    vi.stubGlobal('localStorage', memoryStorage());
    const ids = ['command-1', 'command-2', 'command-3'];
    const createId = () => ids.shift() ?? 'unexpected-command';

    const firstLifetime = createRetainedCommandIds('employee-a', createId);
    expect(firstLifetime.forIntent('inventory.adjust', { shopId: 'shop-1', quantity: 3 })).toBe(
      'command-1',
    );

    const reloadedLifetime = createRetainedCommandIds('employee-a', createId);
    expect(reloadedLifetime.forIntent('inventory.adjust', { quantity: 3, shopId: 'shop-1' })).toBe(
      'command-1',
    );

    reloadedLifetime.complete('inventory.adjust', { shopId: 'shop-1', quantity: 3 });

    const nextIntentLifetime = createRetainedCommandIds('employee-a', createId);
    expect(
      nextIntentLifetime.forIntent('inventory.adjust', { shopId: 'shop-1', quantity: 3 }),
    ).toBe('command-2');
  });

  it('classifies pending approval as non-terminal so retries keep the same command identity', () => {
    vi.stubGlobal('localStorage', memoryStorage());
    const ids = createRetainedCommandIds('employee-a', () => 'command-pending');
    const intent = { shopId: 'shop-1', orderId: 'order-1', amountMinor: 2500 };

    expect(isPendingApprovalResult({ ok: true, state: 'PENDING_APPROVAL' })).toBe(true);
    expect(isPendingApprovalResult({ ok: true, state: 'POSTED' })).toBe(false);
    expect(isPendingApprovalResult({ ok: false, code: 'permission_forbidden' })).toBe(false);

    const first = ids.forIntent('order.refund', intent);
    if (!isPendingApprovalResult({ ok: true, state: 'PENDING_APPROVAL' })) {
      ids.complete('order.refund', intent);
    }
    const retry = createRetainedCommandIds('employee-a', () => 'unexpected-command').forIntent(
      'order.refund',
      intent,
    );

    expect(first).toBe('command-pending');
    expect(retry).toBe('command-pending');
  });
});
