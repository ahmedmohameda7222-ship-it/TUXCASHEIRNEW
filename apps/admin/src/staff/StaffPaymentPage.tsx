import type { EmployeeDetail, StaffFinanceAccountChoice } from '@tux/admin-contracts';
import { useState } from 'react';

import type { StaffCommandDraft } from './SchedulePage';

export function StaffPaymentPage({
  employee,
  shopId,
  accounts,
  financeAccounts,
  canPay,
  onCommand,
  onSensitiveCommand,
}: {
  employee: EmployeeDetail;
  shopId: string;
  accounts?: readonly StaffFinanceAccountChoice[];
  financeAccounts?: readonly StaffFinanceAccountChoice[];
  canPay: boolean;
  onCommand(command: StaffCommandDraft): void;
  onSensitiveCommand?(command: StaffCommandDraft, pin: string): void;
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
  const [approvalPin, setApprovalPin] = useState('');

  return (
    <section aria-label="Pay">
      <h3>Pay</h3>
      {employee.payments.map((payment) => (
        <article className="admin-inventory-row" key={payment.id}>
          <span>
            <strong>{(payment.paidAmountMinor / 100).toFixed(2)} EGP</strong>
            <small>{payment.payPeriodStart} → {payment.payPeriodEnd}</small>
          </span>
          <span>{payment.paymentDate}</span>
        </article>
      ))}
      {!canPay ? <p>Staff payment access is not included in your permissions.</p> : null}
      {canPay && available.length === 0 ? (
        <div className="admin-empty-state"><strong>No active payment account</strong><span>Create or activate a scoped finance account before recording staff payment.</span></div>
      ) : null}
      {canPay && available.length > 0 ? (
        <section className="admin-catalog-editor__section is-compact">
          <label className="admin-field"><span>Payment account</span><select value={accountId} onChange={(event) => setAccountId(event.target.value)}>{available.map((account) => <option key={account.id} value={account.id}>{account.name} · {account.accountType}</option>)}</select></label>
          <label className="admin-field"><span>Pay period start</span><input type="date" value={periodStart} onChange={(event) => setPeriodStart(event.target.value)} /></label>
          <label className="admin-field"><span>Pay period end</span><input type="date" value={periodEnd} onChange={(event) => setPeriodEnd(event.target.value)} /></label>
          <label className="admin-field"><span>Expected amount (EGP)</span><input inputMode="decimal" value={expected} onChange={(event) => setExpected(event.target.value)} /></label>
          <label className="admin-field"><span>Paid amount (EGP)</span><input inputMode="decimal" value={paid} onChange={(event) => setPaid(event.target.value)} /></label>
          <label className="admin-field"><span>Payment date</span><input type="date" value={paymentDate} onChange={(event) => setPaymentDate(event.target.value)} /></label>
          <label className="admin-field"><span>Admin PIN for approval policy</span><input aria-label="Admin PIN for staff payment approval" inputMode="numeric" type="password" value={approvalPin} onChange={(event) => setApprovalPin(event.target.value)} /></label>
          <button className="admin-primary-button" type="button" disabled={!accountId || !periodStart || !periodEnd || !paid || !paymentDate} onClick={() => {
            const command: StaffCommandDraft = { type: 'payment.record', employeeId: employee.id, shopId, payPeriodStart: periodStart, payPeriodEnd: periodEnd, expectedAmountMinor: Math.round(Number(expected || paid) * 100), paidAmountMinor: Math.round(Number(paid) * 100), financeAccountId: accountId, paymentDate, note: null, reference: null };
            if (approvalPin && onSensitiveCommand) { onSensitiveCommand(command, approvalPin); setApprovalPin(''); } else { onCommand(command); }
          }}>Record payment</button>
        </section>
      ) : null}
    </section>
  );
}
