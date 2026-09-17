import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { AuditDetailPage } from './AuditDetailPage';

describe('AuditDetailPage', () => {
  it('renders nested before/after leaf values instead of collapsing structured changes', () => {
    const html = renderToStaticMarkup(
      <AuditDetailPage
        event={{
          id: 'audit-1',
          shopName: 'TUX',
          actorLabel: 'Owner One',
          actorRole: 'OWNER',
          actionType: 'SETTINGS_UPDATED',
          entityType: 'SHOP_SETTINGS',
          entityId: 'settings-1',
          beforeValue: {
            checkout: { taxRate: 13.75 },
            items: [{ sku: 'SKU-NESTED-BEFORE', enabled: false }],
          },
          afterValue: {
            checkout: { taxRate: 14.125 },
            items: [{ sku: 'SKU-NESTED-AFTER', enabled: true }],
          },
          reason: 'Configuration update',
          approvalRequestId: null,
          createdAtLabel: '17 Sep 2026, 02:00',
        }}
      />,
    );

    expect(html).toContain('13.75');
    expect(html).toContain('14.125');
    expect(html).toContain('SKU-NESTED-BEFORE');
    expect(html).toContain('SKU-NESTED-AFTER');
    expect(html).not.toContain('Structured value changed');
    expect(html).not.toContain('[object Object]');
  });
});
