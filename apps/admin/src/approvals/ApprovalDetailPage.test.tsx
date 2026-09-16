import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import {
  ApprovalDetailView,
  approvalDecisionDialogTitle,
  type ApprovalDetailViewModel,
} from './ApprovalDetailPage';

const pending: ApprovalDetailViewModel = {
  id: 'approval-1',
  requesterName: 'Owner One',
  shopName: 'TUX',
  actionLabel: 'Emergency inventory adjustment',
  amountOrValue: '-3 patties',
  reason: 'Cycle count mismatch',
  consequence: 'Inventory on-hand will be reduced after a second person approves.',
  status: 'PENDING',
  executionLabel: 'Not started',
  createdAtLabel: '16 Sep 2026, 18:30',
};

function render(model: ApprovalDetailViewModel): string {
  return renderToStaticMarkup(
    <ApprovalDetailView
      approval={model}
      deciding={false}
      onApprove={vi.fn()}
      onReject={vi.fn()}
    />,
  );
}

describe('ApprovalDetailPage', () => {
  it('requires an explicit PIN confirmation prompt for approval and rejection', () => {
    expect(approvalDecisionDialogTitle('APPROVE')).toBe('Enter PIN to approve');
    expect(approvalDecisionDialogTitle('REJECT')).toBe('Enter PIN to reject');
  });

  it('renders the consequence context and decision controls for a pending request', () => {
    const html = render(pending);

    expect(html).toContain('Owner One');
    expect(html).toContain('TUX');
    expect(html).toContain('Emergency inventory adjustment');
    expect(html).toContain('Cycle count mismatch');
    expect(html).toContain('Inventory on-hand will be reduced');
    expect(html).toContain('Approve');
    expect(html).toContain('Reject');
  });

  it('does not offer a second decision after approval has entered execution', () => {
    const html = render({
      ...pending,
      status: 'EXECUTING',
      executionLabel: 'Execution in progress',
    });

    expect(html).toContain('Execution in progress');
    expect(html).not.toContain('>Approve<');
    expect(html).not.toContain('>Reject<');
  });

  it('makes terminal execution failure recoverable and human-readable', () => {
    const html = render({
      ...pending,
      status: 'FAILED',
      executionLabel: 'Execution failed',
      failureMessage: 'The approved command could not be completed safely.',
      recoveryMessage:
        'Review the failure and submit a new request if the policy still allows it.',
    });

    expect(html).toContain('Execution failed');
    expect(html).toContain('could not be completed safely');
    expect(html).toContain('submit a new request');
  });
});
