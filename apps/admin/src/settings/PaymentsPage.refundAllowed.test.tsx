import type { AdminSettingsWorkspace } from '@tux/admin-contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { PaymentsPage } from './PaymentsPage';

describe('payment-method refund permission trust boundary', () => {
  it('does not let staff edit an unenforced policy flag', () => {
    const workspace = {
      settingsVersion: 3,
      paymentMethods: [
        {
          id: 'payment-cash',
          displayName: 'Cash',
          active: true,
          sortOrder: 1,
          channel: 'POS',
          requiresReference: false,
          manualConfirmationRequired: false,
          refundAllowed: true,
          requiresReconciliation: false,
          editVersion: 2,
        },
      ],
    } as unknown as AdminSettingsWorkspace;
    const html = renderToStaticMarkup(
      <PaymentsPage workspace={workspace} updating={false} onUpdate={vi.fn()} />,
    );
    expect(html).toContain('Refund permissions are read-only');
    expect(html).not.toContain('checked={draft.refundAllowed}');
    expect(html).not.toContain('Refund allowed</span>');
  });
});
