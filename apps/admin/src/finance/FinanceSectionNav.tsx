import { Link } from 'wouter';

export type FinanceSection =
  | 'accounts'
  | 'expenses'
  | 'reconciliation'
  | 'settlements'
  | 'end-day';

const sections = [
  { id: 'accounts', href: '/finance', label: 'Money' },
  { id: 'expenses', href: '/finance/expenses', label: 'Expenses' },
  { id: 'reconciliation', href: '/finance/reconciliation', label: 'Reconciliation' },
] as const;

/**
 * Exactly three approved primary sections. The existing settlement and
 * financial-Z routes are retained separately for users with reconcile authority.
 * Actual mutation permissions are enforced again by the authenticated API.
 */
export function FinanceSectionNav({
  active,
  canReconcile = false,
}: {
  active: FinanceSection;
  canReconcile?: boolean;
}) {
  return (
    <div className="tux-finance-navigation">
      <nav className="tux-finance-toolbar tux-finance-section-nav" aria-label="Finance sections">
        {sections.map((section) => (
          <Link
            key={section.id}
            href={section.href}
            aria-current={active === section.id ? 'page' : undefined}
            className="admin-secondary-button"
          >
            {section.label}
          </Link>
        ))}
      </nav>
      {canReconcile ? (
        <details className="tux-finance-advanced">
          <summary>Advanced finance</summary>
          <nav aria-label="Advanced finance actions">
            <Link
              href="/finance/settlements"
              aria-current={active === 'settlements' ? 'page' : undefined}
            >
              Settlements
            </Link>
            <Link
              href="/finance/end-day"
              aria-current={active === 'end-day' ? 'page' : undefined}
            >
              Financial End Day
            </Link>
          </nav>
        </details>
      ) : null}
    </div>
  );
}
