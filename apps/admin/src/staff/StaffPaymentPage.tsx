import type { EmployeeDetail, StaffFinanceAccountChoice } from '@tux/admin-contracts';
import { useState } from 'react';

import type { StaffCommandDraft } from './SchedulePage';
import { formatStaffMoney, parseStaffMoneyMinor } from './staffMoney';

export function StaffPaymentPage({
  employee,
  shopId,
  accounts,
  financeAccounts,
  canPay,
  onSensitiveCommand,
}: {
  employee: EmployeeDetail;
  shopId: string;
  accounts?: readonly StaffFinanceAccountChoice[];
  financeAccounts?: readonly StaffFinanceAccountChoice[];
  canPay: boolean;
  onSensitiveCommand(command: StaffCommandDraft, pin: string): void;
}) {
  const available = (accounts ?? financeAccounts ?? []).filter(
    (account) => account.shopId === null || account.shopId === shopId,
  );
  const [accountId, setAccountId] = useState(available[0]?.id ?? '');
  const [periodStart, setPeriodStart] = useState('');
  const [periodEnd, setPeriodEnd] = useState('');
  const [expected, setExpected] = useState('');
  const [paid, setPaid] = useState('');
  const [paymentDate, setPaymentDate] = useState('');
  const [actorPin, setActorPin] = useState('');
  const expectedAmountMinor = parseStaffMoneyMinor(expected.trim() || paid);
  const paidAmountMinor = parseStaffMoneyMinor(paid);
  const accountTypeLabel = (type: string) =>
    type === 'BANK'
      ? 'Bank account'
      : type === 'WALLET'
        ? 'Wallet'
        : type === 'CASH'
          ? 'Cash'
          : 'Settlement account';

  return (
    <section aria-label="Pay">
      <h3>Pay</h3>
      {employee.payments.map((payment) => (
        <article className="admin-staff-record-row" key={payment.id}>
          <span>
            <strong>{formatStaffMoney(payment.paidAmountMinor)} EGP</strong>
            <small>
              {payment.payPeriodStart} → {payment.payPeriodEnd}
            </small>
          </span>
          <span>{payment.paymentDate}</span>
        </article>
      ))}
      {!canPay ? <p>Staff payment access is not included in your permissions.</p> : null}
      {canPay && available.length === 0 ? (
        <div className="admin-staff-readiness-state">
          <strong>No active payment account</strong>
          <span>Create or activate a scoped finance account before recording staff payment.</span>
        </div>
      ) : null}
      {canPay && available.length > 0 ? (
        <section className="admin-staff-section is-compact">
          <label className="admin-field">
            <span>Payment account</span>
            <select value={accountId} onChange={(event) => setAccountId(event.target.value)}>
              {available.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name} · {accountTypeLabel(account.accountType)}
                </option>
              ))}
            </select>
          </label>
          <label className="admin-field">
            <span>Pay period start</span>
            <input
              type="date"
              value={periodStart}
              onChange={(event) => setPeriodStart(event.target.value)}
            />
          </label>
          <label className="admin-field">
            <span>Pay period end</span>
            <input
              type="date"
              value={periodEnd}
              onChange={(event) => setPeriodEnd(event.target.value)}
            />
          </label>
          <label className="admin-field">
            <span>Expected amount (EGP)</span>
            <input
              inputMode="decimal"
              value={expected}
              onChange={(event) => setExpected(event.target.value)}
            />
          </label>
          <label className="admin-field">
            <span>Paid amount (EGP)</span>
            <input
              inputMode="decimal"
              value={paid}
              onChange={(event) => setPaid(event.target.value)}
            />
          </label>
          <label className="admin-field">
            <span>Payment date</span>
            <input
              type="date"
              value={paymentDate}
              onChange={(event) => setPaymentDate(event.target.value)}
            />
          </label>
          <label className="admin-field">
            <span>Admin PIN for staff payment</span>
            <input
              type="password"
              inputMode="numeric"
              autoComplete="off"
              value={actorPin}
              onChange={(event) => setActorPin(event.target.value)}
            />
          </label>
          <p>Payment posting requires Admin PIN reauthentication. Any configured second-person approval remains enforced by the server.</p>
          <button
            className="admin-primary-button"
            type="button"
            disabled={
              !accountId ||
              !periodStart ||
              !periodEnd ||
              paidAmountMinor === null ||
              expectedAmountMinor === null ||
              !/^\d{4,12}$/.test(actorPin) ||
              !paymentDate
            }
            onClick={() => {
              if (expectedAmountMinor === null || paidAmountMinor === null) return;
              const command: StaffCommandDraft = {
                type: 'payment.record',
                employeeId: employee.id,
                shopId,
                payPeriodStart: periodStart,
                payPeriodEnd: periodEnd,
                expectedAmountMinor,
                paidAmountMinor,
                financeAccountId: accountId,
                paymentDate,
                note: null,
                reference: null,
              };
              onSensitiveCommand(command, actorPin);
              setActorPin('');
            }}
          >
            Record payment
          </button>
        </section>
      ) : null}
    </section>
  );
}
