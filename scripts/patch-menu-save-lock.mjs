import fs from 'node:fs';

const path = 'apps/operations/src/app/OrdersWorkspace.tsx';
let source = fs.readFileSync(path, 'utf8');

function replaceOnce(label, before, after) {
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`${label}: expected source was not found`);
  if (source.indexOf(before, first + before.length) >= 0) {
    throw new Error(`${label}: expected source was not unique`);
  }
  source = `${source.slice(0, first)}${after}${source.slice(first + before.length)}`;
}

replaceOnce(
  'category draggable save lock',
  'draggable={menuEditActive && draggedCategoryId !== category.id}',
  'draggable={menuEditActive && !menuEditSaving && draggedCategoryId !== category.id}',
);
replaceOnce(
  'category drag start save lock',
  `onDragStart={(event) => {\n                          if (!menuEditActive) return;`,
  `onDragStart={(event) => {\n                          if (menuEditSaving) return;\n                          if (!menuEditActive) return;`,
);
replaceOnce(
  'category drag enter save lock',
  `onDragEnter={(event) => {\n                          if (!menuEditActive || draggedCategoryId === null) return;`,
  `onDragEnter={(event) => {\n                          if (menuEditSaving) return;\n                          if (!menuEditActive || draggedCategoryId === null) return;`,
);
replaceOnce(
  'category drag over save lock',
  `onDragOver={(event) => {\n                          if (menuEditActive && draggedCategoryId !== null) event.preventDefault();`,
  `onDragOver={(event) => {\n                          if (menuEditSaving) return;\n                          if (menuEditActive && draggedCategoryId !== null) event.preventDefault();`,
);
replaceOnce(
  'alignment save lock',
  `key={alignment}\n                          aria-pressed={categoryEditAlignment === alignment}`,
  `key={alignment}\n                          disabled={menuEditSaving}\n                          aria-pressed={categoryEditAlignment === alignment}`,
);
replaceOnce(
  'product draggable save lock',
  'draggable={menuEditActive && draggedProductId !== product.id}',
  'draggable={menuEditActive && !menuEditSaving && draggedProductId !== product.id}',
);
replaceOnce(
  'product drag start save lock',
  `onDragStart={(event) => {\n                      setDraggedProductId(product.id);`,
  `onDragStart={(event) => {\n                      if (menuEditSaving) return;\n                      setDraggedProductId(product.id);`,
);
replaceOnce(
  'product drag enter save lock',
  `onDragEnter={(event) => {\n                      if (draggedProductId === null) return;`,
  `onDragEnter={(event) => {\n                      if (menuEditSaving) return;\n                      if (draggedProductId === null) return;`,
);
replaceOnce(
  'product drag over save lock',
  `onDragOver={(event) => {\n                      if (draggedProductId !== null) event.preventDefault();`,
  `onDragOver={(event) => {\n                      if (menuEditSaving) return;\n                      if (draggedProductId !== null) event.preventDefault();`,
);
replaceOnce(
  'clear active reorder state when save starts',
  `setMenuEditSaving(true);\n    setMenuEditError(null);`,
  `setMenuEditSaving(true);\n    setDraggedCategoryId(null);\n    setDraggedProductId(null);\n    setGrabbedCategoryId(null);\n    setGrabbedProductId(null);\n    categoryPickupSnapshotRef.current = null;\n    productPickupSnapshotRef.current = null;\n    setMenuEditError(null);`,
);

fs.writeFileSync(path, source);
