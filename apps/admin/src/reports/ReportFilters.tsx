import type { AdminReportArea } from '@tux/admin-contracts';

import type { ReportFilters as ReportQueryFilters } from './useReports';

export const REPORT_LABELS: Readonly<Record<AdminReportArea,string>> = {
  sales:'Sales',
  profit:'Estimated profit and COGS',
  products:'Product performance',
  'inventory-consumption':'Inventory consumption',
  waste:'Waste',
  'theoretical-variance':'Inventory variance events',
  'margin-variance':'Recorded cost movements',
  purchasing:'Purchasing',
  customers:'Customers',
  payments:'Payments',
  expenses:'Expenses',
  staff:'Staff payments',
  delivery:'Delivery',
  refunds:'Posted refunds',
  tax:'Tax and service charges',
  'end-day':'Financial Z history',
  'bank-cash':'Bank and cash movements',
  'shop-comparison':'Shop comparison',
};
export function ReportFilters({
  value,onChange,canCompareShops,allShopIds,
}:{
  value:ReportQueryFilters;
  onChange(next:ReportQueryFilters):void;
  canCompareShops:boolean;
  allShopIds:readonly string[];
}) {
  const set=<K extends keyof ReportQueryFilters>(
    key:K,next:ReportQueryFilters[K],
  )=>onChange({...value,[key]:next,offset:0});
  return (
    <section className="tux-report-filters" aria-label="Report filters">
      <label>
        Report
        <select value={value.area} onChange={(event)=>
          set('area',event.target.value as AdminReportArea)}>
          {Object.entries(REPORT_LABELS).map(([area,label])=>
            <option key={area} value={area}>{label}</option>)}
        </select>
      </label>
      <label>
        From
        <input type="date" value={value.fromDate}
          onChange={(event)=>set('fromDate',event.target.value)} />
      </label>
      <label>
        To
        <input type="date" value={value.toDate}
          onChange={(event)=>set('toDate',event.target.value)} />
      </label>
      <label>
        Order source
        <select value={value.source??'ALL'} onChange={(event)=>
          set('source',event.target.value==='ALL'?null:event.target.value as 'POS'|'ONLINE')}>
          <option value="ALL">All sources</option>
          <option value="POS">POS</option>
          <option value="ONLINE">Online</option>
        </select>
      </label>
      {canCompareShops&&allShopIds.length>1 ? (
        <label>
          Shops
          <select
            value={value.shopIds.length===allShopIds.length?'ALL':'SELECTED'}
            onChange={(event)=>set('shopIds',
              event.target.value==='ALL'?allShopIds:[allShopIds[0]!])}>
            <option value="ALL">All authorized shops</option>
            <option value="SELECTED">First shop</option>
          </select>
        </label>
      ):null}
      <label className="tux-report-filters__check">
        <input type="checkbox" checked={value.comparePrevious}
          onChange={(event)=>set('comparePrevious',event.target.checked)} />
        Compare previous period
      </label>
    </section>
  );
}
