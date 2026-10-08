import type { FinanceAccountBalance } from '@tux/admin-contracts';
import { useState } from 'react';

import { InlineError } from '../components/feedback/AdminStates';
import { AdminDialog } from '../components/overlay/AdminDialog';
import { parseEgpMinor } from './money';
import { useFinanceOperations } from './useFinanceOperations';

type MovementAction = 'TRANSFER' | 'BANK_DEPOSIT' | 'OWNER_CONTRIBUTION' | 'OWNER_WITHDRAWAL';
const movementTypes: Readonly<Record<MovementAction, string>> = {
  TRANSFER: 'Transfer between accounts',
  BANK_DEPOSIT: 'Bank deposit',
  OWNER_CONTRIBUTION: 'Owner contribution',
  OWNER_WITHDRAWAL: 'Owner withdrawal',
};
export function MoneyMovementSheet({
  shopId,
  accounts,
  open,
  onClose,
}: {
  shopId: string;
  accounts: readonly FinanceAccountBalance[];
  open: boolean;
  onClose(): void;
}) {
  const [action, setAction] = useState<MovementAction>('TRANSFER');
  const [fromAccountId, setFromAccountId] = useState('');
  const [toAccountId, setToAccountId] = useState('');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const operations = useFinanceOperations(shopId, undefined);
  const active = accounts.filter((account) => account.active);
  function submit() {
    try {
      const amountMinor = parseEgpMinor(amount);
      if (amountMinor <= 0) throw new Error('Enter a positive amount.');
      if (!reason.trim()) throw new Error('A reason is required.');
      if (!fromAccountId) throw new Error('Choose an account.');
      if (
        (action === 'TRANSFER' || action === 'BANK_DEPOSIT') &&
        (!toAccountId || toAccountId === fromAccountId)
      ) {
        throw new Error('Choose two different accounts.');
      }
      if (action === 'OWNER_WITHDRAWAL' && !/^\d{4,12}$/.test(pin)) {
        throw new Error('Re-enter your PIN to authorize an owner withdrawal.');
      }
      const type = {
        TRANSFER: 'finance.transfer',
        BANK_DEPOSIT: 'finance.bank-deposit',
        OWNER_CONTRIBUTION: 'finance.owner-contribution',
        OWNER_WITHDRAWAL: 'finance.owner-withdrawal',
      }[action];
      const draft =
        action === 'TRANSFER' || action === 'BANK_DEPOSIT'
          ? { type, shopId, fromAccountId, toAccountId, amountMinor, reason: reason.trim() }
          : { type, shopId, accountId: fromAccountId, amountMinor, reason: reason.trim() };
      operations.command.mutate(
        {
          draft,
          ...(action === 'OWNER_WITHDRAWAL' ? { reauthPin: pin } : {}),
        },
        {
          onSuccess: () => {
            setError(null);
            setAmount('');
            setReason('');
            setPin('');
            onClose();
          },
        },
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid movement');
    }
  }
  return (
    <AdminDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setPin('');
          onClose();
        }
      }}
      title="Record money movement"
      description="Internal transfers do not create sales or operating profit. Owner capital movements are not operating expenses."
      variant="sheet"
      footer={
        <>
          <button
            type="button"
            className="admin-secondary-button"
            disabled={operations.command.isPending}
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="button"
            className="admin-primary-button"
            disabled={operations.command.isPending}
            onClick={submit}
          >
            {operations.command.isPending ? 'Posting…' : 'Record movement'}
          </button>
        </>
      }
    >
      <div className="tux-finance-form">
        <label>
          Movement type
          <select value={action} onChange={(e) => setAction(e.target.value as MovementAction)}>
            {Object.entries(movementTypes).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          {action === 'OWNER_WITHDRAWAL' || action === 'OWNER_CONTRIBUTION'
            ? 'Account'
            : 'From account'}
          <select value={fromAccountId} onChange={(e) => setFromAccountId(e.target.value)}>
            <option value="">Choose an account</option>
            {active
              .filter((account) => action !== 'BANK_DEPOSIT' || account.accountType === 'CASH')
              .map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
          </select>
        </label>
        {action === 'TRANSFER' || action === 'BANK_DEPOSIT' ? (
          <label>
            To account
            <select value={toAccountId} onChange={(e) => setToAccountId(e.target.value)}>
              <option value="">Choose an account</option>
              {active
                .filter(
                  (account) =>
                    account.id !== fromAccountId &&
                    (action !== 'BANK_DEPOSIT' || account.accountType === 'BANK'),
                )
                .map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name}
                  </option>
                ))}
            </select>
          </label>
        ) : null}
        <label>
          Amount (EGP)
          <input
            value={amount}
            inputMode="decimal"
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
          />
        </label>
        <label>
          Reason
          <textarea
            rows={3}
            maxLength={500}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </label>
        {action === 'OWNER_WITHDRAWAL' ? (
          <label>
            PIN re-authentication
            <input
              type="password"
              inputMode="numeric"
              autoComplete="off"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
            />
          </label>
        ) : null}
        {error ? <InlineError>{error}</InlineError> : null}
        {operations.command.error ? (
          <InlineError>
            {operations.command.error instanceof Error
              ? operations.command.error.message
              : 'Movement failed'}
          </InlineError>
        ) : null}
      </div>
    </AdminDialog>
  );
}
