import { describe, expect, it, vi } from 'vitest';

import type { AdminApprovalExecutionClaim } from '@tux/admin-contracts';
import {
  ORDER_REFUND_APPROVAL_ACTION,
  ORDER_RETURN_APPROVAL_ACTION,
  createOrderApprovalExecutionEntries,
} from './orderApproval.js';

const refundClaim: AdminApprovalExecutionClaim = {
  approvalRequestId: '11111111-1111-4111-8111-111111111111',
  businessId: '22222222-2222-4222-8222-222222222222',
  shopId: '33333333-3333-4333-8333-333333333333',
  requesterEmployeeId: '44444444-4444-4444-8444-444444444444',
  approverEmployeeId: '55555555-5555-4555-8555-555555555555',
  actionType: ORDER_REFUND_APPROVAL_ACTION,
  commandId: '66666666-6666-4666-8666-666666666666',
  commandPayload: {
    orderId: '77777777-7777-4777-8777-777777777777',
    paymentId: '88888888-8888-4888-8888-888888888888',
    amountMinor: 5000,
    reasonCodeId: '99999999-9999-4999-8999-999999999999',
    note: 'Approved refund',
    orderCommandId: 'refund-business-command-1',
  },
  claimToken: 'claim-token',
  attemptCount: 1,
  leaseExpiresAt: '2026-09-23T10:00:00.000Z',
};

describe('Plan 5 order approval execution registry', () => {
  it('executes an approved refund through the trusted order posting boundary', async () => {
    const executeRefund = vi.fn(async () => ({
      ok: true as const,
      orderId: String(refundClaim.commandPayload.orderId),
      refundId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      state: 'POSTED' as const,
      replayed: false,
    }));
    const entries = createOrderApprovalExecutionEntries({
      executeRefund,
      executeReturn: vi.fn(),
    });
    const entry = entries.find(
      (candidate) => candidate.actionType === ORDER_REFUND_APPROVAL_ACTION,
    );
    expect(entry).toBeDefined();

    const result = await entry!.execute({
      commandId: refundClaim.commandId,
      payload: refundClaim.commandPayload,
      claim: refundClaim,
    });

    expect(executeRefund).toHaveBeenCalledWith({
      approvalRequestId: refundClaim.approvalRequestId,
      businessId: refundClaim.businessId,
      shopId: refundClaim.shopId,
      requesterEmployeeId: refundClaim.requesterEmployeeId,
      approverEmployeeId: refundClaim.approverEmployeeId,
      orderId: refundClaim.commandPayload.orderId,
      paymentId: refundClaim.commandPayload.paymentId,
      amountMinor: 5000,
      reasonCodeId: refundClaim.commandPayload.reasonCodeId,
      note: 'Approved refund',
      orderCommandId: 'refund-business-command-1',
    });
    expect(result).toMatchObject({ idempotentReplay: false });
  });

  it('executes an approved return through the trusted order posting boundary', async () => {
    const executeReturn = vi.fn(async () => ({
      ok: true as const,
      orderId: '77777777-7777-4777-8777-777777777777',
      returnId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      state: 'POSTED' as const,
      replayed: true,
    }));
    const entries = createOrderApprovalExecutionEntries({
      executeRefund: vi.fn(),
      executeReturn,
    });
    const entry = entries.find(
      (candidate) => candidate.actionType === ORDER_RETURN_APPROVAL_ACTION,
    );
    expect(entry).toBeDefined();

    const payload = {
      orderId: '77777777-7777-4777-8777-777777777777',
      items: [{ orderItemId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', quantity: 2 }],
      reasonCodeId: '99999999-9999-4999-8999-999999999999',
      note: null,
      orderCommandId: 'return-business-command-1',
    };
    const claim = {
      ...refundClaim,
      actionType: ORDER_RETURN_APPROVAL_ACTION,
      commandPayload: payload,
    };

    const result = await entry!.execute({
      commandId: claim.commandId,
      payload,
      claim,
    });

    expect(executeReturn).toHaveBeenCalledWith({
      approvalRequestId: claim.approvalRequestId,
      businessId: claim.businessId,
      shopId: claim.shopId,
      requesterEmployeeId: claim.requesterEmployeeId,
      approverEmployeeId: claim.approverEmployeeId,
      orderId: payload.orderId,
      items: payload.items,
      reasonCodeId: payload.reasonCodeId,
      note: null,
      orderCommandId: payload.orderCommandId,
    });
    expect(result).toMatchObject({ idempotentReplay: true });
  });

  it('fails closed when an approved command payload is incomplete', async () => {
    const entries = createOrderApprovalExecutionEntries({
      executeRefund: vi.fn(),
      executeReturn: vi.fn(),
    });
    const entry = entries.find(
      (candidate) => candidate.actionType === ORDER_REFUND_APPROVAL_ACTION,
    );

    await expect(
      entry!.execute({
        commandId: refundClaim.commandId,
        payload: { orderId: refundClaim.commandPayload.orderId },
        claim: refundClaim,
      }),
    ).rejects.toMatchObject({ code: 'approval_order_payload_invalid' });
  });
});
