export const CART_WIDTH_STORAGE_KEY = 'tux.operations.currentOrderWidth';
export const CART_WIDTH_MIN = 360;
export const CART_WIDTH_DEFAULT = 432;
export const CART_WIDTH_MAX_PX = 600;

export function clampCartWidth(width: number, viewportWidth: number): number {
  const maximum = Math.min(CART_WIDTH_MAX_PX, viewportWidth * 0.45);
  return Math.min(maximum, Math.max(CART_WIDTH_MIN, width));
}

export function readCartWidth(
  storage: Pick<Storage, 'getItem'>,
  viewportWidth: number,
): number {
  const stored = storage.getItem(CART_WIDTH_STORAGE_KEY);
  if (stored === null) return clampCartWidth(CART_WIDTH_DEFAULT, viewportWidth);
  const width = Number(stored);
  if (!Number.isFinite(width)) return clampCartWidth(CART_WIDTH_DEFAULT, viewportWidth);
  return clampCartWidth(width, viewportWidth);
}

export function writeCartWidth(storage: Pick<Storage, 'setItem'>, width: number): void {
  storage.setItem(CART_WIDTH_STORAGE_KEY, String(width));
}
