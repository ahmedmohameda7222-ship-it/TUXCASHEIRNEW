import type { ProductId } from '@tux/domain';

export function moveCategoryProductId(
  order: readonly ProductId[],
  sourceId: ProductId,
  targetId: ProductId,
): readonly ProductId[] {
  if (sourceId === targetId) return order;

  const sourceIndex = order.indexOf(sourceId);
  const targetIndex = order.indexOf(targetId);
  if (sourceIndex < 0 || targetIndex < 0) return order;

  const next = order.slice();
  const [moved] = next.splice(sourceIndex, 1);
  if (moved === undefined) return order;
  next.splice(targetIndex, 0, moved);
  return next;
}
