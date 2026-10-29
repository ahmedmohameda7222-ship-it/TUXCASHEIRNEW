import type { AdminReportArea } from '@tux/admin-contracts';

import { chooseReportArea } from './reportAreaTransition';
import { cairoReportToday, reportDatePreset } from './reportDateRange';
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
export const REPORT_TOPICS = [
  {
    label: 'Sales & customers',
    areas: [
      'sales',
      'products',
      'customers',
      'payments',
      'refunds',
      'tax',
      'loyalty',
      'promotions',
      'segments',
    ],
  },
  {
    label: 'Stock & purchasing',
    areas: [
      'inventory-consumption',
      'waste',
      'theoretical-variance',
      'margin-variance',
      'purchasing',
    ],
  },
  {
    label: 'Staff & operations',
    areas: ['staff', 'attendance', 'delivery', 'shop-comparison'],
  },
  {
    label: 'Finance & performance',
    areas: ['profit', 'expenses', 'end-day', 'bank-cash'],
  },
] as const satisfies readonly { label: string; areas: readonly AdminReportArea[] }[];

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
  const quickReports = [
    'sales',
    'products',
    'inventory-consumption',
    'customers',
    'expenses',
  ] as const satisfies readonly AdminReportArea[];
  function applyPreset(days: 1 | 7 | 30) {
    onChange({
      ...value,
      ...reportDatePreset(cairoReportToday(), days),
      offset: 0,
    });
  }
  return (
    <section className="tux-report-selector" aria-label="Choose a report">
      <header className="tux-report-selector__header">
        <h2>Choose a report</h2>
        <span>22 available</span>
      </header>
      <nav className="tux-report-quick" aria-label="Quick reports">
        {quickReports.map((area) => (
          <button
            key={area}
            type="button"
            className={area === value.area ? 'tux-report-quick__active' : ''}
            aria-pressed={area === value.area}
            onClick={() => onChange(chooseReportArea(value, area))}
          >
            {area === 'inventory-consumption' ? 'Inventory' : REPORT_LABELS[area]}
          </button>
        ))}
        <label className="tux-report-all">
          <span>All reports</span>
          <select
            aria-label="All reports"
            value={value.area}
            onChange={(event) =>
              onChange(chooseReportArea(value, event.target.value as AdminReportArea))
            }
          >
            {REPORT_TOPICS.map((topic) => (
              <optgroup label={topic.label} key={topic.label}>
                {topic.areas.map((area) => (
                  <option key={area} value={area}>
                    {REPORT_LABELS[area]}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
      </nav>
      <div className="tux-report-filters" aria-label="Report filters">
        <div className="tux-report-presets" role="group" aria-label="Date presets">
          {([1, 7, 30] as const).map((days) => (
            <button
              key={days}
              type="button"
              className="admin-secondary-button"
              onClick={() => applyPreset(days)}
            >
              {days === 1 ? 'Today' : `${days} days`}
            </button>
          ))}
        </div>
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
        <details
          className="tux-report-context"
          onToggle={(event) => {
            if (event.currentTarget.open) onExpand();
          }}
        >
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
        <button
          type="button"
          className="admin-secondary-button tux-report-reset"
          onClick={() => onChange({
            ...value,
            ...reportDatePreset(cairoReportToday(), 7),
            source: null,
            comparePrevious: false,
            comparisonRange: 'previous',
            context: {},
            offset: 0,
          })}
        >
          Reset
        </button>
      </div>
    </section>
  );
}
