import { afterEach, describe, expect, it, vi } from 'vitest';

import { createRetainedCommandIds } from './retainedCommandIds';

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
  it('survives a hook/page lifetime until an authoritative response clears the intent', () => {
    vi.stubGlobal('localStorage', memoryStorage());
    const ids = ['command-1', 'command-2', 'command-3'];
    const createId = () => ids.shift() ?? 'unexpected-command';

    const firstLifetime = createRetainedCommandIds(createId);
    expect(firstLifetime.forIntent('inventory.adjust', { shopId: 'shop-1', quantity: 3 })).toBe(
      'command-1',
    );

    const reloadedLifetime = createRetainedCommandIds(createId);
    expect(reloadedLifetime.forIntent('inventory.adjust', { quantity: 3, shopId: 'shop-1' })).toBe(
      'command-1',
    );

    reloadedLifetime.complete('inventory.adjust', { shopId: 'shop-1', quantity: 3 });

    const nextIntentLifetime = createRetainedCommandIds(createId);
    expect(
      nextIntentLifetime.forIntent('inventory.adjust', { shopId: 'shop-1', quantity: 3 }),
    ).toBe('command-2');
  });
});
