import type { AdminSettingsWorkspace } from '@tux/admin-contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { PaymentsPage } from './PaymentsPage';

describe('payment-method refund permission trust boundary', () => {
  it('describes that refund policy changes affect new payments, not historical transactions', () => {
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
      <PaymentsPage workspace={workspace} updating={false} onCreate={vi.fn()} onUpdate={vi.fn()} />,
    );
    expect(html).toContain('Changes affect future payments only');
    expect(html).toContain('Refunds allowed for new payments');
  });
});
