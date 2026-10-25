import { describe, expect, it, vi } from 'vitest';
import { closeBrowserDayAndFlush } from './sessionClient';

describe('browser End Day delivery handoff', () => {
  it('flushes the closed day outbox before returning control to the PIN screen', async () => {
    const order: string[] = [];
    const result = {
      ok: true as const,
      value: {
        businessDayId: '20000000-0000-4000-8000-000000000001',
        closedAt: '2026-10-25T06:10:00.000Z',
        replayed: false,
      },
    };
    const closeDay = vi.fn(async () => {
      order.push('close');
      return result as never;
    });
    const flushShopOutbox = vi.fn(async () => {
      order.push('flush');
    });

    await expect(
      closeBrowserDayAndFlush({
        shopId: '10000000-0000-4000-8000-000000000001' as never,
        input: {} as never,
        closeDay,
        flushShopOutbox,
      }),
    ).resolves.toBe(result);
    expect(order).toEqual(['close', 'flush']);
  });

  it('does not flush when the local End Day commit fails', async () => {
    const result = { ok: false as const, error: { code: 'VALIDATION_ERROR', message: 'blocked' } };
    const flushShopOutbox = vi.fn(async () => undefined);

    await expect(
      closeBrowserDayAndFlush({
        shopId: '10000000-0000-4000-8000-000000000001' as never,
        input: {} as never,
        closeDay: vi.fn(async () => result as never),
        flushShopOutbox,
      }),
    ).resolves.toBe(result);
    expect(flushShopOutbox).not.toHaveBeenCalled();
  });
});
