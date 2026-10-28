import type { ReactNode } from 'react';
import './AdminMetricStrip.css';

export type AdminSummaryMetric = {
  id: string;
  label: string;
  value: ReactNode | null;
  hint?: string;
  tone?: 'default' | 'warning' | 'critical';
};

/**
 * Read-only, accessible metric tiles. Callers must supply complete, authorized
 * values from their own shop-scoped API; null explicitly means unavailable.
 * Never infer an all-shop total from a paginated list in this component.
 */
export function AdminMetricStrip({
  label,
  metrics,
  className,
}: {
  label: string;
  metrics: readonly AdminSummaryMetric[];
  className?: string;
}) {
  return (
    <dl className={['admin-metric-strip', className].filter(Boolean).join(' ')} aria-label={label}>
      {metrics.map((metric) => (
        <div
          className={
            metric.tone && metric.tone !== 'default'
              ? `admin-metric-strip__tile admin-metric-strip--${metric.tone}`
              : 'admin-metric-strip__tile'
          }
          key={metric.id}
        >
          <dt>{metric.label}</dt>
          <dd>{metric.value === null ? 'Unavailable' : metric.value}</dd>
          {metric.hint ? <small>{metric.hint}</small> : null}
        </div>
      ))}
    </dl>
  );
}
