export function AvailabilityStatus({ active, soldOut }: { active: boolean; soldOut: boolean }) {
  if (!active) return <span className="admin-status-pill is-muted">Archived</span>;
  if (soldOut) return <span className="admin-status-pill is-warning">Sold out</span>;
  return <span className="admin-status-pill">Available</span>;
}
