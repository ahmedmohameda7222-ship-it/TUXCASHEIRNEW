import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Router } from 'wouter';

import { ResponsiveMasterDetail } from './layout/ResponsiveMasterDetail';
import { detailIdFromPath, detailPath } from './layout/detailRoute';
import { AdminTabs } from './navigation/AdminTabs';
import { AdminDialog, ConfirmationDialog } from './overlay/AdminDialog';

describe('Admin hardening primitives', () => {
  it('round-trips addressable detail IDs and rejects malformed path encoding', () => {
    const id = 'customer/with spaces';
    const path = detailPath('/customers/', id);

    expect(path).toBe('/customers/customer%2Fwith%20spaces');
    expect(detailIdFromPath(path, '/customers')).toBe(id);
    expect(detailIdFromPath('/customers/%E0%A4%A', '/customers')).toBeNull();
    expect(detailIdFromPath('/orders/example', '/customers')).toBeNull();
  });

  it('renders a focused master/detail state with a natural back link', () => {
    const html = renderToStaticMarkup(
      <Router ssrPath="/orders/order-1">
        <ResponsiveMasterDetail
          list={<p>Order list</p>}
          detail={<p>Order detail</p>}
          listLabel="Orders"
          detailLabel="Order detail"
          detailActive
          backHref="/orders"
          emptyDetail={<p>Select an order</p>}
        />
      </Router>,
    );

    expect(html).toContain('data-detail-active="true"');
    expect(html).toContain('href="/orders"');
    expect(html).toContain('Back to orders');
    expect(html).toContain('Order detail');
    expect(html).not.toContain('Select an order');
  });

  it('renders tabs with the WAI-ARIA tab and tabpanel relationship', () => {
    const html = renderToStaticMarkup(
      <AdminTabs
        label="Purchasing sections"
        value="orders"
        onChange={() => undefined}
        tabs={
          [
            { id: 'orders', label: 'Purchase orders', content: <p>Orders panel</p> },
            { id: 'suppliers', label: 'Suppliers', content: <p>Suppliers panel</p> },
          ] as const
        }
      />,
    );

    expect(html).toContain('role="tablist"');
    expect(html).toContain('aria-label="Purchasing sections"');
    expect(html).toContain('role="tab"');
    expect(html).toContain('aria-selected="true"');
    expect(html).toContain('role="tabpanel"');
    expect(html).toContain('Orders panel');
    expect(html).not.toContain('Suppliers panel');
  });

  it('keeps dialog titles/descriptions connected and destructive confirmation explicit', () => {
    const dialogHtml = renderToStaticMarkup(
      <AdminDialog
        open={false}
        title="Receive purchase order"
        description="Record the quantities received from this supplier."
        onOpenChange={() => undefined}
      >
        <p>Receive form</p>
      </AdminDialog>,
    );
    const confirmationHtml = renderToStaticMarkup(
      <ConfirmationDialog
        open={false}
        title="Archive shop?"
        description="This shop will no longer be available for active operations."
        confirmLabel="Archive shop"
        destructive
        onConfirm={() => undefined}
        onOpenChange={() => undefined}
      />,
    );

    expect(dialogHtml).toContain('role="dialog"');
    expect(dialogHtml).toContain('aria-modal="true"');
    expect(dialogHtml).toContain('aria-labelledby=');
    expect(dialogHtml).toContain('aria-describedby=');
    expect(confirmationHtml).toContain('admin-destructive-button');
    expect(confirmationHtml).toContain('Archive shop');
    expect(confirmationHtml).toContain('Cancel');
  });
});
