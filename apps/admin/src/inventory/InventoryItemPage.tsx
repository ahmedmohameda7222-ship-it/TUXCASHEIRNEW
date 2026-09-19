import { PageScaffold } from '../components/layout/PageScaffold';

export type InventoryItemPageItem = {
  id: string;
  name: string;
  unitLabel: string;
  trackingMode: 'RECIPE_TRACKED' | 'BULK_MANUAL';
  active: boolean;
  onHandMicros: number;
  reservedMicros: number;
  availableMicros: number;
  weightedUnitCostMinor: number;
};

function formatQuantity(micros: number, unitLabel: string): string {
  const value = micros / 1_000_000;
  return `${new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 3,
  }).format(value)} ${unitLabel}`;
}

export function InventoryItemPage({ item }: { item: InventoryItemPageItem }) {
  return (
    <PageScaffold
      eyebrow="Inventory item"
      title={item.name}
      description={item.active ? 'Current stock position' : 'Archived inventory item'}
    >
      <dl className="inventory-balance-grid">
        <div>
          <dt>On Hand</dt>
          <dd>{formatQuantity(item.onHandMicros, item.unitLabel)}</dd>
        </div>
        <div>
          <dt>Reserved</dt>
          <dd>{formatQuantity(item.reservedMicros, item.unitLabel)}</dd>
        </div>
        <div>
          <dt>Available</dt>
          <dd>{formatQuantity(item.availableMicros, item.unitLabel)}</dd>
        </div>
      </dl>
    </PageScaffold>
  );
}
