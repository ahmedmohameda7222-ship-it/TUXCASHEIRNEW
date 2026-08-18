import {
  ZERO_MONEY,
  type ExpenseLedgerRecord,
  type ExpensePaidFrom,
  type ManualExpenseRecord,
  type MoneyMinor,
} from '@tux/domain';
import { useEffect, useState, type FormEvent } from 'react';
import { MoneyInput } from './MoneyInput';
import { formatMoneyMinor } from './ordersView';
import type { OperationsExpensesClient } from './sessionClient';

interface ExpenseFormValues {
  readonly description: string;
  readonly amountMinor: MoneyMinor;
  readonly paidFrom: ExpensePaidFrom;
  readonly note: string;
}

const EMPTY_FORM: ExpenseFormValues = {
  description: '',
  amountMinor: ZERO_MONEY,
  paidFrom: 'CASH',
  note: '',
};

function timeLabel(value: string): string {
  return new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(
    new Date(value),
  );
}

function ExpenseFields({
  prefix,
  values,
  disabled,
  onChange,
}: {
  readonly prefix: string;
  readonly values: ExpenseFormValues;
  readonly disabled: boolean;
  readonly onChange: (values: ExpenseFormValues) => void;
}) {
  return (
    <div className="expense-fields">
      <label className="expense-description-field" htmlFor={`${prefix}-description`}>
        Description
        <input
          id={`${prefix}-description`}
          value={values.description}
          disabled={disabled}
          maxLength={160}
          autoComplete="off"
          onChange={(event) => onChange({ ...values, description: event.target.value })}
        />
      </label>
      <MoneyInput
        id={`${prefix}-amount`}
        label="Amount"
        value={values.amountMinor}
        disabled={disabled}
        onCommit={(amountMinor) => onChange({ ...values, amountMinor })}
      />
      <fieldset className="expense-paid-from" disabled={disabled}>
        <legend>Paid From</legend>
        <div className="expense-paid-options">
          <button
            type="button"
            className={values.paidFrom === 'CASH' ? 'expense-choice active' : 'expense-choice'}
            aria-pressed={values.paidFrom === 'CASH'}
            onClick={() => onChange({ ...values, paidFrom: 'CASH' })}
          >
            Cash
          </button>
          <button
            type="button"
            className={values.paidFrom === 'OTHER' ? 'expense-choice active' : 'expense-choice'}
            aria-pressed={values.paidFrom === 'OTHER'}
            onClick={() => onChange({ ...values, paidFrom: 'OTHER' })}
          >
            Other
          </button>
        </div>
      </fieldset>
      <label className="expense-note-field" htmlFor={`${prefix}-note`}>
        Note <span>optional</span>
        <textarea
          id={`${prefix}-note`}
          value={values.note}
          disabled={disabled}
          maxLength={500}
          rows={2}
          onChange={(event) => onChange({ ...values, note: event.target.value })}
        />
      </label>
    </div>
  );
}

function EditExpenseDialog({
  expense,
  busy,
  error,
  onClose,
  onSave,
}: {
  readonly expense: ManualExpenseRecord;
  readonly busy: boolean;
  readonly error: string | null;
  readonly onClose: () => void;
  readonly onSave: (values: ExpenseFormValues) => Promise<void>;
}) {
  const [values, setValues] = useState<ExpenseFormValues>({
    description: expense.description,
    amountMinor: expense.amountMinor,
    paidFrom: expense.paidFrom,
    note: expense.note ?? '',
  });

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!busy) await onSave(values);
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <form
        className="expense-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="edit-expense-title"
        onSubmit={(event) => void submit(event)}
      >
        <header className="expense-dialog-heading">
          <div>
            <p className="eyebrow">Current Business Day</p>
            <h2 id="edit-expense-title">Edit expense</h2>
          </div>
          <button type="button" className="quiet-action" onClick={onClose} disabled={busy}>
            Cancel
          </button>
        </header>
        <ExpenseFields prefix={`edit-${expense.id}`} values={values} disabled={busy} onChange={setValues} />
        {error === null ? null : <p className="form-error" role="alert">{error}</p>}
        <button
          type="submit"
          className="primary-action expense-submit"
          disabled={busy || values.description.trim().length === 0 || values.amountMinor <= ZERO_MONEY}
        >
          {busy ? 'Saving…' : 'Save Changes'}
        </button>
      </form>
    </div>
  );
}

function DeleteExpenseDialog({
  expense,
  busy,
  error,
  onClose,
  onDelete,
}: {
  readonly expense: ManualExpenseRecord;
  readonly busy: boolean;
  readonly error: string | null;
  readonly onClose: () => void;
  readonly onDelete: () => Promise<void>;
}) {
  return (
    <div className="modal-backdrop" role="presentation">
      <section className="expense-dialog" role="dialog" aria-modal="true" aria-labelledby="delete-expense-title">
        <header className="expense-dialog-heading">
          <div>
            <p className="eyebrow">Remove mistaken entry</p>
            <h2 id="delete-expense-title">Delete expense?</h2>
          </div>
          <button type="button" className="quiet-action" onClick={onClose} disabled={busy}>Keep</button>
        </header>
        <p><strong>{expense.description}</strong> · {formatMoneyMinor(expense.amountMinor)}</p>
        <p className="expense-dialog-copy">
          It leaves the current ledger and totals while the audited database history is kept.
        </p>
        {error === null ? null : <p className="form-error" role="alert">{error}</p>}
        <button type="button" className="expense-danger-action" disabled={busy} onClick={() => void onDelete()}>
          {busy ? 'Deleting…' : 'Delete Expense'}
        </button>
      </section>
    </div>
  );
}

function ManualExpenseRow({
  expense,
  onEdit,
  onDelete,
}: {
  readonly expense: ManualExpenseRecord;
  readonly onEdit: (expense: ManualExpenseRecord) => void;
  readonly onDelete: (expense: ManualExpenseRecord) => void;
}) {
  return (
    <article className="expense-row">
      <time dateTime={expense.createdAt}>{timeLabel(expense.createdAt)}</time>
      <div className="expense-row-main">
        <div className="expense-row-title">
          <strong>{expense.description}</strong>
          <span className="expense-paid-badge">{expense.paidFrom === 'CASH' ? 'Cash' : 'Other'}</span>
        </div>
        {expense.note === null ? null : <p>{expense.note}</p>}
      </div>
      <strong className="expense-row-amount">{formatMoneyMinor(expense.amountMinor)}</strong>
      <div className="expense-row-actions">
        <button type="button" className="expense-text-action" onClick={() => onEdit(expense)}>Edit</button>
        <button type="button" className="expense-text-action expense-text-danger" onClick={() => onDelete(expense)}>Delete</button>
      </div>
    </article>
  );
}

function DeliveryFailedRow({
  expense,
}: {
  readonly expense: Extract<ExpenseLedgerRecord, { kind: 'DELIVERY_FAILED' }>;
}) {
  return (
    <article className="expense-row expense-system-row">
      <time dateTime={expense.createdAt}>{timeLabel(expense.createdAt)}</time>
      <div className="expense-row-main">
        <div className="expense-row-title">
          <strong>{expense.description}</strong>
          <span className="expense-system-badge">Locked</span>
        </div>
        <p>{expense.note ?? 'Delivery Failed operational exception'}</p>
      </div>
      <strong className="expense-row-amount expense-nonfinancial">Non-financial</strong>
      <div className="expense-row-actions"><span>System record</span></div>
    </article>
  );
}

export function ExpensesWorkspace({ client }: { readonly client: OperationsExpensesClient }) {
  const [expenses, setExpenses] = useState<readonly ExpenseLedgerRecord[]>([]);
  const [totalExpensesMinor, setTotalExpensesMinor] = useState<MoneyMinor>(ZERO_MONEY);
  const [form, setForm] = useState<ExpenseFormValues>(EMPTY_FORM);
  const [editTarget, setEditTarget] = useState<ManualExpenseRecord | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ManualExpenseRecord | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function refresh(): Promise<void> {
    const result = await client.loadLedger();
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    setExpenses(result.value.expenses);
    setTotalExpensesMinor(result.value.totalExpensesMinor);
    setError(null);
  }

  useEffect(() => {
    void refresh();
  }, [client]);

  async function addExpense(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    const result = await client.createExpense({
      description: form.description,
      amountMinor: form.amountMinor,
      paidFrom: form.paidFrom,
      note: form.note.trim().length === 0 ? null : form.note,
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    setForm(EMPTY_FORM);
    setMessage('Expense saved locally.');
    await refresh();
  }

  return (
    <main className="expenses-workspace">
      <header className="expenses-heading">
        <div>
          <p className="eyebrow">Current Business Day</p>
          <h1>Expenses</h1>
          <p>Shift expenses and locked operational exceptions.</p>
        </div>
        <div className="expenses-total" aria-label="Total Expenses">
          <span>Total Expenses</span>
          <strong>{formatMoneyMinor(totalExpensesMinor)}</strong>
        </div>
      </header>

      <form className="expense-add-card" onSubmit={(event) => void addExpense(event)}>
        <div className="expense-add-heading">
          <div><p className="eyebrow">Manual expense</p><h2>Add Expense</h2></div>
          <p>Cash reduces drawer Expected Cash at End Day; Other does not.</p>
        </div>
        <ExpenseFields prefix="add-expense" values={form} disabled={busy} onChange={setForm} />
        {error === null ? null : <p className="form-error" role="alert">{error}</p>}
        <button
          type="submit"
          className="primary-action expense-submit"
          disabled={busy || form.description.trim().length === 0 || form.amountMinor <= ZERO_MONEY}
        >
          {busy ? 'Saving…' : 'Add Expense'}
        </button>
      </form>

      {message === null ? null : <div className="expense-message" role="status">{message}</div>}

      <section className="expense-ledger" aria-labelledby="expense-ledger-title">
        <div className="expense-ledger-heading">
          <div><p className="eyebrow">Newest first</p><h2 id="expense-ledger-title">Current ledger</h2></div>
          <span>{expenses.length} entries</span>
        </div>
        {expenses.length === 0 ? (
          <div className="expense-empty"><strong>No expenses yet.</strong><span>This Business Day’s ledger is empty.</span></div>
        ) : (
          <div className="expense-list">
            {expenses.map((expense) =>
              expense.kind === 'MANUAL' ? (
                <ManualExpenseRow
                  key={expense.id}
                  expense={expense}
                  onEdit={(target) => { setDialogError(null); setEditTarget(target); }}
                  onDelete={(target) => { setDialogError(null); setDeleteTarget(target); }}
                />
              ) : (
                <DeliveryFailedRow key={expense.id} expense={expense} />
              ),
            )}
          </div>
        )}
      </section>

      {editTarget === null ? null : (
        <EditExpenseDialog
          expense={editTarget}
          busy={busy}
          error={dialogError}
          onClose={() => { if (!busy) setEditTarget(null); }}
          onSave={async (values) => {
            setBusy(true);
            setDialogError(null);
            const result = await client.editExpense({
              expenseId: editTarget.id,
              description: values.description,
              amountMinor: values.amountMinor,
              paidFrom: values.paidFrom,
              note: values.note.trim().length === 0 ? null : values.note,
            });
            setBusy(false);
            if (!result.ok) { setDialogError(result.error.message); return; }
            setEditTarget(null);
            setMessage('Expense changes saved locally.');
            await refresh();
          }}
        />
      )}

      {deleteTarget === null ? null : (
        <DeleteExpenseDialog
          expense={deleteTarget}
          busy={busy}
          error={dialogError}
          onClose={() => { if (!busy) setDeleteTarget(null); }}
          onDelete={async () => {
            setBusy(true);
            setDialogError(null);
            const result = await client.deleteExpense(deleteTarget.id);
            setBusy(false);
            if (!result.ok) { setDialogError(result.error.message); return; }
            setDeleteTarget(null);
            setMessage('Expense removed from the current ledger.');
            await refresh();
          }}
        />
      )}
    </main>
  );
}
