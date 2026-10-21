import { Link } from 'wouter';

export type FinanceSection = 'accounts' | 'expenses' | 'settlements' | 'end-day';

const sections: readonly { id: FinanceSection; href: string; label: string }[] = [
  { id: 'accounts', href: '/finance', label: 'Bank & Cash' },
  { id: 'expenses', href: '/finance/expenses', label: 'Expenses' },
  { id: 'settlements', href: '/finance/settlements', label: 'Settlements' },
  { id: 'end-day', href: '/finance/end-day', label: 'End Day' },
];

export function FinanceSectionNav({ active }: { active: FinanceSection }) {
  return (
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
  );
}
