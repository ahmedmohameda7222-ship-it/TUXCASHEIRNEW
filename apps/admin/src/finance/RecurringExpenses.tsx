import type { FinanceAccountBalance } from '@tux/admin-contracts';
import { useState } from 'react';

import { ErrorState, InlineError, LoadingState } from '../components/feedback/AdminStates';
import { AdminDialog } from '../components/overlay/AdminDialog';
import { formatEgp, parseEgpMinor } from './money';
import { useFinanceOperations } from './useFinanceOperations';

export function RecurringExpenses({
  shopId,
  accounts,
  openBusinessDayId,
  categories,
  canManage,
}: {
  shopId: string;
  accounts: readonly FinanceAccountBalance[];
  openBusinessDayId: string | null;
  categories: readonly { id: string; name: string }[];
  canManage: boolean;
}) {
  const finance = useFinanceOperations(shopId, undefined, ['recurring']);
  const rules = finance.recurringQuery.data?.rules ?? [];
  const due = finance.recurringQuery.data?.due ?? [];
  const [ruleOpen, setRuleOpen] = useState(false);
  const [selectedRuleId, setSelectedRuleId] = useState<string | null>(null);
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [cadence, setCadence] = useState<'DAILY' | 'WEEKLY' | 'MONTHLY'>('MONTHLY');
  const [nextDue, setNextDue] = useState('');
  const [categoryId, setCategoryId] = useState('uncategorized');
  const [active, setActive] = useState(true);
  const [postingDue, setPostingDue] = useState<string | null>(null);
  const [paidAccount, setPaidAccount] = useState('unpaid');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const selected = rules.find((rule) => rule.id === selectedRuleId);

  function edit(ruleId: string | null) {
    const rule = rules.find((entry) => entry.id === ruleId);
    setSelectedRuleId(rule?.id ?? null);
    setDescription(rule?.description ?? '');
    setAmount(rule ? String(rule.amountMinor / 100) : '');
    setCadence(rule?.cadence ?? 'MONTHLY');
    setNextDue(rule?.nextDueDate ?? '');
    setCategoryId(rule?.categoryId ?? 'uncategorized');
    setActive(rule?.active ?? true);
    setRuleOpen(true);
    setError(null);
  }
  function saveRule() {
    try {
      const amountMinor = parseEgpMinor(amount);
      if (amountMinor <= 0 || !description.trim() || !nextDue) {
        throw new Error('Description, next due date and positive amount are required.');
      }
      finance.command.mutate(
        {
          draft: {
            type: 'finance.recurring.rule',
            shopId,
            ruleId: selectedRuleId,
            expectedVersion: selected?.version ?? 0,
            categoryId: categoryId === 'uncategorized' ? null : categoryId,
            description: description.trim(),
            amountMinor,
            cadence,
            nextDueDate: nextDue,
            active,
          },
        },
        {
          onSuccess: () => {
            setRuleOpen(false);
            setError(null);
          },
        },
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Invalid recurring expense');
    }
  }
  function recordDue() {
    if (!postingDue || !openBusinessDayId) return;
    if (!reason.trim()) {
      setError('Reason is required.');
      return;
    }
    finance.command.mutate(
      {
        draft: {
          type: 'finance.recurring.post',
          shopId,
          occurrenceId: postingDue,
          businessDayId: openBusinessDayId,
          accountId: paidAccount === 'unpaid' ? null : paidAccount,
          reason: reason.trim(),
        },
      },
      {
        onSuccess: () => {
          setPostingDue(null);
          setReason('');
          setPaidAccount('unpaid');
          setError(null);
        },
      },
    );
  }
  return (
    <section className="tux-finance-recurring" aria-label="Recurring expense definitions">
      <div className="tux-finance-toolbar">
        <h2>Recurring expenses</h2>
        {canManage ? (
          <>
            <button
              type="button"
              className="admin-secondary-button"
              disabled={finance.command.isPending}
              onClick={() =>
                finance.command.mutate({
                  draft: {
                    type: 'finance.recurring.process',
                    shopId,
                  },
                })
              }
            >
              Process due recurring expenses
            </button>
            <button type="button" className="admin-secondary-button" onClick={() => edit(null)}>
              Add recurring rule
            </button>
          </>
        ) : null}
      </div>
      {finance.recurringQuery.isLoading ? <LoadingState title="Loading recurring expenses" /> : null}
      {finance.recurringQuery.isError ? (
        <ErrorState
          title="Recurring expenses unavailable"
          action={
            <button type="button" className="admin-secondary-button" onClick={() => void finance.recurringQuery.refetch()}>
              Retry
            </button>
          }
        />
      ) : null}
      {finance.recurringQuery.data ? (
        <>
      {rules.length === 0 ? (
        <p>No recurring expense rules have been configured.</p>
      ) : (
        <ul className="tux-finance-ledger-list">
          {rules.map((rule) => (
            <li key={rule.id}>
              <div>
                <strong>{rule.description}</strong>
                <small>
                  {rule.cadence.toLowerCase()} · Next due {rule.nextDueDate}
                  {' · '}
                  {rule.active ? 'Active' : 'Paused'}
                </small>
              </div>
              <strong>{formatEgp(rule.amountMinor)}</strong>
              {canManage ? (
                <button
                  className="admin-secondary-button"
                  type="button"
                  onClick={() => edit(rule.id)}
                >
                  Edit
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      <h3>Due reminders</h3>
      {due.length === 0 ? (
        <p>No outstanding generated due expenses.</p>
      ) : (
        <ul className="tux-finance-ledger-list">
          {due.map((entry) => (
            <li key={entry.id}>
              <div>
                <strong>{entry.description}</strong>
                <small>Due {entry.dueOn}</small>
              </div>
              <strong>{formatEgp(entry.amountMinor)}</strong>
              {canManage ? (
                <button
                  className="admin-secondary-button"
                  type="button"
                  disabled={!openBusinessDayId}
                  onClick={() => setPostingDue(entry.id)}
                >
                  Record expense
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      <p className="tux-finance-muted">
        Due reminders do not debit accounts. Money and operating expense are posted only after
        confirmation.
      </p>
        </>
      ) : null}
      <AdminDialog
        open={ruleOpen}
        onOpenChange={setRuleOpen}
        variant="sheet"
        title={selected ? 'Edit recurring expense' : 'New recurring expense'}
        description="Changes apply prospectively; previously recorded expenses cannot be rewritten."
        footer={
          <>
            <button
              className="admin-secondary-button"
              type="button"
              onClick={() => setRuleOpen(false)}
            >
              Cancel
            </button>
            <button
              className="admin-primary-button"
              type="button"
              disabled={finance.command.isPending}
              onClick={saveRule}
            >
              Save rule
            </button>
          </>
        }
      >
        <div className="tux-finance-form">
          <label>
            Description{' '}
            <input
              value={description}
              maxLength={500}
              onChange={(e) => setDescription(e.target.value)}
            />
          </label>
          <label>
            Amount (EGP){' '}
            <input value={amount} inputMode="decimal" onChange={(e) => setAmount(e.target.value)} />
          </label>
          <label>
            Cadence
            <select
              value={cadence}
              onChange={(e) => setCadence(e.target.value as 'DAILY' | 'WEEKLY' | 'MONTHLY')}
            >
              <option value="DAILY">Daily</option>
              <option value="WEEKLY">Weekly</option>
              <option value="MONTHLY">Monthly</option>
            </select>
          </label>
          <label>
            Next due date{' '}
            <input type="date" value={nextDue} onChange={(e) => setNextDue(e.target.value)} />
          </label>
          <label>
            Category
            <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="uncategorized">Uncategorized</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Active{' '}
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
          </label>
          {error ? <InlineError>{error}</InlineError> : null}
        </div>
      </AdminDialog>
      <AdminDialog
        open={postingDue !== null}
        onOpenChange={(open) => {
          if (!open) setPostingDue(null);
        }}
        title="Record due recurring expense"
        variant="sheet"
        description="Confirm the expense once against an OPEN Operations Business Day."
        footer={
          <>
            <button
              className="admin-secondary-button"
              type="button"
              onClick={() => setPostingDue(null)}
            >
              Cancel
            </button>
            <button
              className="admin-primary-button"
              type="button"
              disabled={!openBusinessDayId || finance.command.isPending}
              onClick={recordDue}
            >
              Record expense
            </button>
          </>
        }
      >
        <div className="tux-finance-form">
          <label>
            Pay from tracked account
            <select value={paidAccount} onChange={(e) => setPaidAccount(e.target.value)}>
              <option value="unpaid">Not paid from a tracked account</option>
              {accounts
                .filter((a) => a.active)
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
            </select>
          </label>
          <label>
            Reason
            <textarea maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
          </label>
          {error ? <InlineError>{error}</InlineError> : null}
        </div>
      </AdminDialog>
    </section>
  );
}
