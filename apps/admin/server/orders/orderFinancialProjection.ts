/** Financial projections use immutable order/payment facts and current approval state.
 * The database remains the final authority under transaction locks.
 */
export type StoredFinancialState = 'PENDING_APPROVAL' | 'POSTED' | 'REJECTED' | 'FAILED';
export type ApprovalFinancialStatus =
  'PENDING' | 'APPROVED' | 'EXECUTING' | 'EXECUTED' | 'REJECTED' | 'FAILED';

export type EffectiveFinancialState =
  'PENDING_APPROVAL' | 'APPROVED' | 'EXECUTING' | 'POSTED' | 'REJECTED' | 'FAILED';

export function effectiveFinancialState(
  storedState: StoredFinancialState,
  approvalStatus: ApprovalFinancialStatus | null,
): EffectiveFinancialState {
  if (storedState !== 'PENDING_APPROVAL') return storedState;
  switch (approvalStatus) {
    case 'APPROVED':
      return 'APPROVED';
    case 'EXECUTING':
    case 'EXECUTED':
      // EXECUTED does not prove that the associated financial row was posted.
      return 'EXECUTING';
    case 'REJECTED':
      return 'REJECTED';
    case 'FAILED':
      return 'FAILED';
    default:
      return 'PENDING_APPROVAL';
  }
}

const reservesCapacity = (state: EffectiveFinancialState): boolean =>
  state === 'PENDING_APPROVAL' || state === 'APPROVED' || state === 'EXECUTING';

type Payment = { id: string; allocatedMinor: number; refundAllowedSnapshot: boolean };
type Refund = { paymentId: string; amountMinor: number; state: EffectiveFinancialState };
type OrderItem = { id: string; quantity: number };
type ReturnLine = { orderItemId: string; quantity: number; state: EffectiveFinancialState };

export function projectPaymentRefundBalances(
  payments: readonly Payment[],
  refunds: readonly Refund[],
): Map<
  string,
  {
    postedRefundMinor: number;
    pendingRefundMinor: number;
    remainingRefundableMinor: number;
  }
> {
  return new Map(
    payments.map((payment) => {
      const forPayment = refunds.filter((refund) => refund.paymentId === payment.id);
      const postedRefundMinor = forPayment
        .filter((refund) => refund.state === 'POSTED')
        .reduce((sum, refund) => sum + refund.amountMinor, 0);
      const pendingRefundMinor = forPayment
        .filter((refund) => reservesCapacity(refund.state))
        .reduce((sum, refund) => sum + refund.amountMinor, 0);
      return [
        payment.id,
        {
          postedRefundMinor,
          pendingRefundMinor,
          remainingRefundableMinor: payment.refundAllowedSnapshot
            ? Math.max(0, payment.allocatedMinor - postedRefundMinor - pendingRefundMinor)
            : 0,
        },
      ] as const;
    }),
  );
}

export function projectReturnQuantities(
  items: readonly OrderItem[],
  lines: readonly ReturnLine[],
): Map<
  string,
  {
    postedReturnQuantity: number;
    pendingReturnQuantity: number;
    remainingReturnableQuantity: number;
  }
> {
  return new Map(
    items.map((item) => {
      const forItem = lines.filter((line) => line.orderItemId === item.id);
      const postedReturnQuantity = forItem
        .filter((line) => line.state === 'POSTED')
        .reduce((sum, line) => sum + line.quantity, 0);
      const pendingReturnQuantity = forItem
        .filter((line) => reservesCapacity(line.state))
        .reduce((sum, line) => sum + line.quantity, 0);
      return [
        item.id,
        {
          postedReturnQuantity,
          pendingReturnQuantity,
          remainingReturnableQuantity: Math.max(
            0,
            item.quantity - postedReturnQuantity - pendingReturnQuantity,
          ),
        },
      ] as const;
    }),
  );
}
