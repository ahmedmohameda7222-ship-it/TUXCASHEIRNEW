import {
  KeyboardCode,
  closestCorners,
  getFirstCollision,
  getScrollableAncestors,
  type DroppableContainer,
  type KeyboardCoordinateGetter,
} from '@dnd-kit/core';
import { subtract } from '@dnd-kit/utilities';

export type MenuLayoutSortableKind = 'CATEGORY' | 'PRODUCT';

export function menuLayoutSortableKind(id: string | number): MenuLayoutSortableKind | null {
  const value = String(id);
  if (value.startsWith('category:')) return 'CATEGORY';
  if (value.startsWith('product:')) return 'PRODUCT';
  return null;
}

function sortableContainerId(container: DroppableContainer): string | number | null {
  const sortable = container.data.current?.['sortable'];
  if (typeof sortable !== 'object' || sortable === null) return null;
  const containerId = (sortable as { readonly containerId?: string | number }).containerId;
  return containerId ?? null;
}

function isSameSortableContainer(left: DroppableContainer, right: DroppableContainer): boolean {
  const leftId = sortableContainerId(left);
  const rightId = sortableContainerId(right);
  return leftId !== null && rightId !== null && leftId === rightId;
}

function isAfter(left: DroppableContainer, right: DroppableContainer): boolean {
  if (!isSameSortableContainer(left, right)) return false;
  const leftSortable = left.data.current?.['sortable'];
  const rightSortable = right.data.current?.['sortable'];
  if (
    typeof leftSortable !== 'object' ||
    leftSortable === null ||
    typeof rightSortable !== 'object' ||
    rightSortable === null
  ) {
    return false;
  }
  const leftIndex = (leftSortable as { readonly index?: number }).index;
  const rightIndex = (rightSortable as { readonly index?: number }).index;
  return typeof leftIndex === 'number' && typeof rightIndex === 'number' && leftIndex < rightIndex;
}

const directionalCodes = [
  KeyboardCode.Down,
  KeyboardCode.Right,
  KeyboardCode.Up,
  KeyboardCode.Left,
] as const;

export const menuLayoutKeyboardCoordinates: KeyboardCoordinateGetter = (
  event,
  {
    context: {
      active,
      collisionRect,
      droppableRects,
      droppableContainers,
      over,
      scrollableAncestors,
    },
  },
) => {
  if (!directionalCodes.includes(event.code as (typeof directionalCodes)[number])) return undefined;
  event.preventDefault();
  if (!active || !collisionRect) return undefined;

  const activeKind = menuLayoutSortableKind(active.id);
  if (activeKind === null) return undefined;
  const filteredContainers: DroppableContainer[] = [];

  droppableContainers.getEnabled().forEach((entry) => {
    if (!entry || entry.disabled || menuLayoutSortableKind(entry.id) !== activeKind) return;
    const rect = droppableRects.get(entry.id);
    if (!rect) return;

    switch (event.code) {
      case KeyboardCode.Down:
        if (collisionRect.top < rect.top) filteredContainers.push(entry);
        break;
      case KeyboardCode.Up:
        if (collisionRect.top > rect.top) filteredContainers.push(entry);
        break;
      case KeyboardCode.Left:
        if (collisionRect.left > rect.left) filteredContainers.push(entry);
        break;
      case KeyboardCode.Right:
        if (collisionRect.left < rect.left) filteredContainers.push(entry);
        break;
    }
  });

  const collisions = closestCorners({
    active,
    collisionRect,
    droppableRects,
    droppableContainers: filteredContainers,
    pointerCoordinates: null,
  });
  let closestId = getFirstCollision(collisions, 'id');
  if (closestId === over?.id && collisions.length > 1) closestId = collisions[1]?.id ?? null;
  if (closestId == null) return undefined;

  const activeDroppable = droppableContainers.get(active.id);
  const nextDroppable = droppableContainers.get(closestId);
  const nextRect = nextDroppable ? droppableRects.get(nextDroppable.id) : null;
  const nextNode = nextDroppable?.node.current;
  if (!nextNode || !nextRect || !activeDroppable || !nextDroppable) return undefined;

  const newScrollAncestors = getScrollableAncestors(nextNode);
  const hasDifferentScrollAncestors = newScrollAncestors.some(
    (element, index) => scrollableAncestors[index] !== element,
  );
  const sameContainer = isSameSortableContainer(activeDroppable, nextDroppable);
  const afterActive = isAfter(activeDroppable, nextDroppable);
  const offset =
    hasDifferentScrollAncestors || !sameContainer
      ? { x: 0, y: 0 }
      : {
          x: afterActive ? collisionRect.width - nextRect.width : 0,
          y: afterActive ? collisionRect.height - nextRect.height : 0,
        };
  const rectCoordinates = { x: nextRect.left, y: nextRect.top };
  return offset.x && offset.y ? rectCoordinates : subtract(rectCoordinates, offset);
};
