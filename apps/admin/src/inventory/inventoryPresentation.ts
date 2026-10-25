type InventorySummary = {
  id: string;
  name: string;
  active: boolean;
  trackingMode: string;
  availableMicros: number;
  lowStockThresholdMicros: number | null;
};

export type InventoryStatus = 'IN_STOCK' | 'LOW_STOCK' | 'OUT_OF_STOCK' | 'UNCONFIGURED' | 'ARCHIVED';
export type InventoryFilter = 'all' | 'in' | 'low' | 'out';
export type InventorySort = 'name' | 'available-desc' | 'priority';

export function trackingModeLabel(mode: string): string {
  if (mode === 'RECIPE_TRACKED') return 'Recipe tracked';
  if (mode === 'BULK_MANUAL') return 'Bulk / manual';
  return 'Unknown tracking mode';
}

/** Compare signed precise micros, never visually rounded formatted quantities. */
export function inventoryStatus(item: InventorySummary): InventoryStatus {
  if (!item.active) return 'ARCHIVED';
  if (item.availableMicros <= 0) return 'OUT_OF_STOCK';
  if (item.lowStockThresholdMicros === null) return 'UNCONFIGURED';
  return item.availableMicros <= item.lowStockThresholdMicros ? 'LOW_STOCK' : 'IN_STOCK';
}

export function inventoryCounts(items: readonly InventorySummary[]) {
  const counts = { total: items.length, inStock: 0, lowStock: 0, outOfStock: 0, unconfigured: 0, archived: 0 };
  for (const item of items) {
    switch (inventoryStatus(item)) {
      case 'IN_STOCK': counts.inStock++; break;
      case 'LOW_STOCK': counts.lowStock++; break;
      case 'OUT_OF_STOCK': counts.outOfStock++; break;
      case 'UNCONFIGURED': counts.unconfigured++; break;
      case 'ARCHIVED': counts.archived++; break;
    }
  }
  return counts;
}

const priority: Record<InventoryStatus, number> = {
  OUT_OF_STOCK: 0, LOW_STOCK: 1, UNCONFIGURED: 2, IN_STOCK: 3, ARCHIVED: 4,
};

export function inventoryDisplayRows<T extends InventorySummary>(
  items: readonly T[], search: string, filter: InventoryFilter,
  sort: InventorySort, page: number, pageSize = 25,
): { rows: T[]; total: number; page: number; totalPages: number } {
  const needle = search.trim().toLocaleLowerCase();
  const selected = items.filter(item => {
    if (needle && !item.name.toLocaleLowerCase().includes(needle)) return false;
    const status = inventoryStatus(item);
    return filter === 'all' || (filter === 'in' && status === 'IN_STOCK') ||
      (filter === 'low' && status === 'LOW_STOCK') ||
      (filter === 'out' && status === 'OUT_OF_STOCK');
  });
  selected.sort((a, b) => {
    const byName = a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    if (sort === 'available-desc') return b.availableMicros - a.availableMicros || byName;
    if (sort === 'priority') return priority[inventoryStatus(a)] - priority[inventoryStatus(b)] || byName;
    return byName;
  });
  const perPage = Math.max(1, Math.trunc(pageSize));
  const totalPages = Math.max(1, Math.ceil(selected.length / perPage));
  const safePage = Math.max(1, Math.min(Math.trunc(page) || 1, totalPages));
  return { rows: selected.slice((safePage - 1) * perPage, safePage * perPage), total: selected.length, page: safePage, totalPages };
}
