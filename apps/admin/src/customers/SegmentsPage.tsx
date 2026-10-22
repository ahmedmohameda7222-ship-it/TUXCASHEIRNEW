import type { AdminCustomerSegment } from '@tux/admin-contracts';

export function SegmentsPage({ segments }: { segments: readonly AdminCustomerSegment[] }) {
  return (
    <section className="admin-customer-segments" aria-label="Automatic customer segments">
      <h3>Automatic segments</h3>
      {segments.length === 0 ? (
        <p>No automatic segments yet.</p>
      ) : (
        <div className="admin-customer-segments__list">
          {segments.map((segment) => (
            <span className="admin-customer-segments__tag" key={segment}>
              {segment}
            </span>
          ))}
        </div>
      )}
    </section>
  );
}
