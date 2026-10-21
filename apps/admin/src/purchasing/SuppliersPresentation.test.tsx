import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { SuppliersPage } from './SuppliersPage';

describe('premium supplier presentation', () => {
  it('separates supplier identity, contact, lifecycle and actions', () => {
    const html = renderToStaticMarkup(
      <SuppliersPage
        suppliers={[
          {
            id: 'supplier-1',
            businessId: 'shop-1',
            name: 'Delta Produce',
            contactName: 'Dana',
            phone: '01000000000',
            email: 'dana@example.test',
            active: true,
            version: 3,
          },
        ]}
        canManage
        canManageLifecycle
        pending={false}
        onCreate={() => undefined}
        onManage={() => undefined}
      />,
    );
    expect(html).toContain('admin-supplier-card__identity');
    expect(html).toContain('admin-supplier-card__facts');
    expect(html).toContain('admin-supplier-card__actions');
    expect(html).toContain('aria-label="Actions for Delta Produce"');
  });
});
