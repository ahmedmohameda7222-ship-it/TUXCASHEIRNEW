from pathlib import Path

path = Path('apps/operations/src/app/OrdersWorkspace.tsx')
text = path.read_text()
start = "  const menuEditKeyboardCoordinateGetter = useCallback<typeof sortableKeyboardCoordinates>(\n"
end = "  const menuEditSensors = useSensors(\n"
start_index = text.find(start)
if start_index < 0:
    raise SystemExit('missing keyboard coordinate getter start')
end_index = text.find(end, start_index)
if end_index < 0:
    raise SystemExit('missing menuEditSensors start')

replacement = """  const menuEditKeyboardCoordinateGetter = useCallback<typeof sortableKeyboardCoordinates>(
    (event, args) => {
      const direction = event.code;
      if (
        direction !== 'ArrowLeft' &&
        direction !== 'ArrowRight' &&
        direction !== 'ArrowUp' &&
        direction !== 'ArrowDown'
      ) {
        pendingKeyboardDragTargetRef.current = null;
        return sortableKeyboardCoordinates(event, args);
      }

      event.preventDefault();
      const active = args.context.active;
      const collisionRect = args.context.collisionRect;
      if (active === null || collisionRect === null) {
        pendingKeyboardDragTargetRef.current = null;
        return args.currentCoordinates;
      }

      const activeRect = args.context.droppableRects.get(active.id) ?? collisionRect;
      const activeCenterX = activeRect.left + activeRect.width / 2;
      const activeCenterY = activeRect.top + activeRect.height / 2;
      const horizontal = direction === 'ArrowLeft' || direction === 'ArrowRight';
      const candidates = args.context.droppableContainers
        .getEnabled()
        .flatMap((container) => {
          if (container.id === active.id) return [];
          const rect = args.context.droppableRects.get(container.id);
          if (rect === undefined) return [];
          const centerX = rect.left + rect.width / 2;
          const centerY = rect.top + rect.height / 2;

          if (horizontal) {
            const rowTolerance = Math.max(activeRect.height, rect.height) / 2;
            if (Math.abs(centerY - activeCenterY) > rowTolerance) return [];
            if (direction === 'ArrowLeft' && centerX >= activeCenterX - 1) return [];
            if (direction === 'ArrowRight' && centerX <= activeCenterX + 1) return [];
            return [
              {
                container,
                rect,
                primaryDistance: Math.abs(centerX - activeCenterX),
                crossDistance: Math.abs(centerY - activeCenterY),
              },
            ];
          }

          if (direction === 'ArrowUp' && centerY >= activeCenterY - 1) return [];
          if (direction === 'ArrowDown' && centerY <= activeCenterY + 1) return [];
          return [
            {
              container,
              rect,
              primaryDistance: Math.abs(centerY - activeCenterY),
              crossDistance: Math.abs(centerX - activeCenterX),
            },
          ];
        })
        .sort(
          (left, right) =>
            left.primaryDistance - right.primaryDistance ||
            left.crossDistance - right.crossDistance,
        );
      const target = candidates[0];
      if (target === undefined) {
        pendingKeyboardDragTargetRef.current = null;
        return args.currentCoordinates;
      }

      pendingKeyboardDragTargetRef.current = String(target.container.id);
      target.container.node.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      return { x: target.rect.left, y: target.rect.top };
    },
    [],
  );
"""

path.write_text(text[:start_index] + replacement + text[end_index:])
