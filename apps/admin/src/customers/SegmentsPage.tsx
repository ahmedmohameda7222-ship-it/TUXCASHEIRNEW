import type { AdminCustomerSegment } from '@tux/admin-contracts';

export function SegmentsPage({ segments }: { segments: readonly AdminCustomerSegment[] }) {
  return (
    <section aria-label="Automatic customer segments">
      <h3>Automatic segments</h3>
      {segments.length === 0 ? (
        <p>No automatic segments yet.</p>
      ) : (
        <div className="admin-more-grid">
          {segments.map((segment) => (
            <span className="admin-status-badge" key={segment}>
              {segment}
            </span>
          ))}
        </div>
      )}
    </section>
  );
}
