import { describe, expect, it, vi } from 'vitest';
import {
  CART_WIDTH_DEFAULT,
  CART_WIDTH_MAX_PX,
  CART_WIDTH_MIN,
  CART_WIDTH_STORAGE_KEY,
  clampCartWidth,
  readCartWidth,
  writeCartWidth,
} from './cartWidthPreference';

describe('cart width preference', () => {
  it('uses the approved constants', () => {
    expect(CART_WIDTH_STORAGE_KEY).toBe('tux.operations.currentOrderWidth');
    expect(CART_WIDTH_MIN).toBe(360);
    expect(CART_WIDTH_DEFAULT).toBe(432);
    expect(CART_WIDTH_MAX_PX).toBe(600);
  });

  it('clamps to the minimum, hard maximum, and viewport maximum', () => {
    expect(clampCartWidth(300, 1440)).toBe(360);
    expect(clampCartWidth(700, 1440)).toBe(600);
    expect(clampCartWidth(580, 1000)).toBe(450);
    expect(clampCartWidth(432, 1440)).toBe(432);
  });

  it('falls back safely for missing or invalid stored values', () => {
    expect(readCartWidth({ getItem: () => null }, 1440)).toBe(432);
    expect(readCartWidth({ getItem: () => 'not-a-number' }, 1440)).toBe(432);
    expect(readCartWidth({ getItem: () => 'Infinity' }, 1440)).toBe(432);
  });

  it('clamps a stored width to the current viewport', () => {
    expect(readCartWidth({ getItem: () => '300' }, 1440)).toBe(360);
    expect(readCartWidth({ getItem: () => '580' }, 1000)).toBe(450);
  });

  it('writes the device-local width under the approved key', () => {
    const setItem = vi.fn();
    writeCartWidth({ setItem }, 478);
    expect(setItem).toHaveBeenCalledWith(CART_WIDTH_STORAGE_KEY, '478');
  });
});
