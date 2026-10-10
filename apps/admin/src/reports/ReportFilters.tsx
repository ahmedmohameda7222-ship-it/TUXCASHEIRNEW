import type { AdminReportArea } from '@tux/admin-contracts';

import type { ReportContext, ReportFilters as ReportQueryFilters } from './useReports';

export const REPORT_LABELS: Readonly<Record<AdminReportArea, string>> = {
  sales: 'Sales',
  profit: 'Estimated profit and COGS',
  products: 'Product performance',
  'inventory-consumption': 'Inventory consumption',
  waste: 'Waste',
  'theoretical-variance': 'Inventory variance events',
  'margin-variance': 'Recorded cost movements',
  purchasing: 'Purchasing',
  customers: 'Customers',
  payments: 'Payments',
  expenses: 'Expenses',
  staff: 'Staff and attendance',
  delivery: 'Delivery',
  refunds: 'Refunds and returns',
  tax: 'Tax and service charges',
  'end-day': 'Financial Z history',
  'bank-cash': 'Bank and cash movements',
  'shop-comparison': 'Shop comparison',
  loyalty: 'Customer loyalty activity',
  promotions: 'Promotion usage',
  segments: 'Customer segments',
  attendance: 'Staff attendance',
};
export function ReportFilters({
  value,
  onChange,
  canCompareShops,
  allShopIds,
  options,
  onExpand,
}: {
  value: ReportQueryFilters;
  onChange(next: ReportQueryFilters): void;
  canCompareShops: boolean;
  allShopIds: readonly string[];
  options: Readonly<Record<string, readonly { id: string; label: string }[]>>;
  onExpand(): void;
}) {
  const set = <K extends keyof ReportQueryFilters>(key: K, next: ReportQueryFilters[K]) =>
    onChange({ ...value, [key]: next, offset: 0 });
  const setContext = (key: keyof ReportContext, id: string) =>
    onChange({
      ...value,
      context: { ...value.context, [key]: id || undefined },
      offset: 0,
    });
  const isOrderReport = [
    'sales',
    'payments',
    'products',
    'customers',
    'delivery',
    'tax',
    'refunds',
    'shop-comparison',
    'loyalty',
    'promotions',
  ].includes(value.area);
  const extraFields: Array<{ key: keyof ReportContext; label: string; optionsKey: string }> =
    value.area === 'purchasing'
      ? [{ key: 'supplierId', label: 'Supplier', optionsKey: 'suppliers' }]
      : value.area === 'segments'
        ? [{ key: 'customerId', label: 'Customer', optionsKey: 'customers' }]
        : value.area === 'staff' || value.area === 'attendance'
          ? [
              { key: 'workerId', label: 'Cashier / worker', optionsKey: 'workers' },
              { key: 'employeeId', label: 'Employee', optionsKey: 'employees' },
            ]
          : isOrderReport
            ? [
                { key: 'orderTypeId', label: 'Order type', optionsKey: 'orderTypes' },
                { key: 'paymentMethodId', label: 'Payment method', optionsKey: 'paymentMethods' },
                { key: 'workerId', label: 'Cashier / worker', optionsKey: 'workers' },
                { key: 'customerId', label: 'Customer', optionsKey: 'customers' },
                { key: 'productId', label: 'Product', optionsKey: 'products' },
                { key: 'categoryId', label: 'Product category', optionsKey: 'categories' },
                { key: 'promotionId', label: 'Promotion', optionsKey: 'promotions' },
                { key: 'deliveryZoneId', label: 'Delivery zone', optionsKey: 'deliveryZones' },
              ]
            : [];
  const statuses =
    value.area === 'purchasing'
      ? [
          ['DRAFT', 'Draft'],
          ['ORDERED', 'Ordered'],
          ['PARTIALLY_RECEIVED', 'Partially received'],
          ['RECEIVED', 'Received'],
          ['CANCELLED', 'Cancelled'],
        ]
      : value.area === 'staff' || value.area === 'attendance'
        ? [
            ['SESSION_START', 'Clock in'],
            ['SESSION_END', 'Clock out'],
          ]
        : isOrderReport
          ? [
              ['ACTIVE', 'Active'],
              ['DONE', 'Completed'],
              ['CANCELLED', 'Cancelled'],
              ['RETURNED', 'Returned'],
            ]
          : [];
  return (
    <section className="tux-report-filters" aria-label="Report filters">
      <label>
        Report
        <select
          value={value.area}
          onChange={(event) => set('area', event.target.value as AdminReportArea)}
        >
          {Object.entries(REPORT_LABELS).map(([area, label]) => (
            <option key={area} value={area}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label>
        From
        <input
          type="date"
          value={value.fromDate}
          onChange={(event) => set('fromDate', event.target.value)}
        />
      </label>
      <label>
        To
        <input
          type="date"
          value={value.toDate}
          onChange={(event) => set('toDate', event.target.value)}
        />
      </label>
      <label>
        Order source
        <select
          value={value.source ?? 'ALL'}
          onChange={(event) =>
            set(
              'source',
              event.target.value === 'ALL' ? null : (event.target.value as 'POS' | 'ONLINE'),
            )
          }
        >
          <option value="ALL">All sources</option>
          <option value="POS">POS</option>
          <option value="ONLINE">Online</option>
        </select>
      </label>
      {canCompareShops && allShopIds.length > 1 ? (
        <label>
          Shops
          <select
            value={value.shopIds.length === allShopIds.length ? 'ALL' : 'SELECTED'}
            onChange={(event) =>
              set('shopIds', event.target.value === 'ALL' ? allShopIds : [allShopIds[0]!])
            }
          >
            <option value="ALL">All authorized shops</option>
            <option value="SELECTED">First shop</option>
          </select>
        </label>
      ) : null}
      <label className="tux-report-filters__check">
        <input
          type="checkbox"
          checked={value.comparePrevious}
          onChange={(event) => set('comparePrevious', event.target.checked)}
        />
        Compare previous period
      </label>
      {value.comparePrevious ? (
        <label>
          Comparison range
          <select
            value={value.comparisonRange ?? 'previous'}
            onChange={(event) =>
              set('comparisonRange', event.target.value as 'previous' | 'week' | 'month' | 'year')
            }
          >
            <option value="previous">Previous equivalent period</option>
            <option value="week">Previous week</option>
            <option value="month">Previous calendar month</option>
            <option value="year">Previous calendar year</option>
          </select>
        </label>
      ) : null}
      {extraFields.length > 0 || statuses.length > 0 ? (
        <details className="tux-report-context" onToggle={(event) => { if (event.currentTarget.open) onExpand(); }}>
          <summary>More filters</summary>
          <div className="tux-report-context__fields">
            {extraFields
              .filter((field) => (options[field.optionsKey] ?? []).length > 0)
              .map((field) => (
                <label key={field.key}>
                  {field.label}
                  <select
                    value={value.context?.[field.key] ?? ''}
                    onChange={(event) => setContext(field.key, event.target.value)}
                  >
                    <option value="">All {field.label.toLowerCase()}s</option>
                    {(options[field.optionsKey] ?? []).map((entry) => (
                      <option key={entry.id} value={entry.id}>
                        {entry.label}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            {statuses.length > 0 ? (
              <label>
                Status
                <select
                  value={value.context?.status ?? ''}
                  onChange={(event) => setContext('status', event.target.value)}
                >
                  <option value="">All statuses</option>
                  {statuses.map(([code, label]) => (
                    <option key={code} value={code}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </div>
        </details>
      ) : null}
    </section>
  );
}
