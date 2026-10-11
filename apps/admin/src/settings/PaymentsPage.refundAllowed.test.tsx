import type { AdminSettingsWorkspace } from '@tux/admin-contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { PaymentsPage } from './PaymentsPage';

describe('payment-method refund permission', () => {
  it('exposes the approved per-method refund setting instead of an unavailable-policy notice', () => {
    const workspace = {
      settingsVersion: 3,
      paymentMethods: [{
        id: 'payment-cash', displayName: 'Cash', active: true, sortOrder: 1,
        channel: 'POS', requiresReference: false, manualConfirmationRequired: false,
        refundAllowed: true, requiresReconciliation: false, editVersion: 2,
      }],
    } as unknown as AdminSettingsWorkspace;
    const html = renderToStaticMarkup(<PaymentsPage workspace={workspace} updating={false} onUpdate={vi.fn()} />);
    expect(html).toContain('Refunds allowed');
    expect(html).not.toContain('Refund policy editing is not available yet');
  });
});
