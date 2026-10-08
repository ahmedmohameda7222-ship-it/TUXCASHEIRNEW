import type {
  FinanceAccountBalance,
  FinanceAccountType,
  FinancePaymentMethod,
  ProfitSummary,
} from '@tux/admin-contracts';
import { useState } from 'react';
import { Link, useLocation } from 'wouter';

import {
  EmptyState,
  ErrorState,
  InlineError,
  LoadingState,
} from '../components/feedback/AdminStates';
import { PageScaffold } from '../components/layout/PageScaffold';
import { ResponsiveMasterDetail } from '../components/layout/ResponsiveMasterDetail';
import { detailIdFromPath, detailPath } from '../components/layout/detailRoute';
import { AdminDialog, ConfirmationDialog } from '../components/overlay/AdminDialog';
import { useShopScope } from '../shops/ShopScopeProvider';
import { formatEgp, parseEgpMinor } from './money';
import { useFinance } from './useFinance';
import { MoneyMovementSheet } from './MoneyMovementSheet';
import './finance.css';

const accountTypeLabels: Record<FinanceAccountType, string> = {
  CASH: 'Cash',
  BANK: 'Bank',
  WALLET: 'Wallet',
  PENDING_SETTLEMENT: 'Pending settlement',
};

function readableError(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message.replaceAll('_', ' ').replaceAll('-', ' ');
  }
  return 'Unable to complete this action.';
}

function AccountDetail({
  account,
  canManage,
  history,
  loading,
  onDeactivate,
}: {
  account: FinanceAccountBalance;
  canManage: boolean;
  history: readonly {
    id: string;
    label: string;
    amountMinor: number;
    occurredAt: string;
  }[];
  loading: boolean;
  onDeactivate(): void;
}) {
  return (
    <section className="tux-finance-detail" aria-label="Account details">
      <div className="tux-finance-detail__heading">
        <div>
          <p className="tux-finance-muted">{accountTypeLabels[account.accountType]}</p>
          <h2>{account.name}</h2>
          <p className="tux-finance-muted">
            {account.shopId ? 'Shop account' : 'Business account'} ·{' '}
            {account.active ? 'Active' : 'Inactive'}
          </p>
        </div>
        <strong>{formatEgp(account.balanceMinor)}</strong>
      </div>
      {canManage && account.active ? (
        <button className="admin-secondary-button" type="button" onClick={onDeactivate}>
          Deactivate account
        </button>
      ) : null}
      <h3>Activity</h3>
      {loading ? <LoadingState title="Loading account activity" /> : null}
      {!loading && history.length === 0 ? (
        <EmptyState
          title="No transactions yet"
          description="Transactions will appear here once they are recorded."
        />
      ) : null}
      <ol className="tux-finance-activity">
        {history.map((movement) => (
          <li key={movement.id}>
            <div>
              <strong>{movement.label}</strong>
              <small>{new Date(movement.occurredAt).toLocaleString('en-EG')}</small>
            </div>
            <span>{formatEgp(movement.amountMinor)}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

function FinancePosition({
  position,
}: {
  position: {
    totalTrackedMoneyMinor: number;
    cashMinor: number;
    bankMinor: number;
    walletMinor: number;
    pendingSettlementMinor: number;
  };
}) {
  const categories = [
    ['Cash', position.cashMinor],
    ['Bank', position.bankMinor],
    ['Wallet', position.walletMinor],
    ['Pending settlement', position.pendingSettlementMinor],
  ] as const;
  return (
    <section className="tux-finance-position" aria-labelledby="finance-money-title">
      <p id="finance-money-title" className="tux-finance-muted">
        Total tracked money
      </p>
      <strong className="tux-finance-position__total">
        {formatEgp(position.totalTrackedMoneyMinor)}
      </strong>
      <dl className="tux-finance-position__breakdown">
        {categories.map(([label, amount]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{formatEgp(amount)}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function FinanceProfitSummary({ summary }: { summary: ProfitSummary | null }) {
  return (
    <section className="tux-finance-position" aria-labelledby="finance-profit-title">
      <p id="finance-profit-title" className="tux-finance-muted">
        Estimated Operating Profit
      </p>
      {summary ? (
        <>
          <strong className="tux-finance-position__total">
            {formatEgp(summary.estimatedOperatingProfitMinor)}
          </strong>
          <dl className="tux-finance-position__breakdown">
            <div>
              <dt>Net sales</dt>
              <dd>{formatEgp(summary.netSalesMinor)}</dd>
            </div>
            <div>
              <dt>COGS</dt>
              <dd>{formatEgp(summary.cogsMinor)}</dd>
            </div>
            <div>
              <dt>Expenses</dt>
              <dd>{formatEgp(summary.expensesMinor)}</dd>
            </div>
          </dl>
        </>
      ) : (
        <p>Not available until the supporting financial costs are verified.</p>
      )}
      <p className="tux-finance-muted">
        Operating profit is not cash received and does not increase any tracked account balance.
      </p>
    </section>
  );
}

export function FinancePage() {
  const { scope, principal } = useShopScope();
  const shopId = scope.kind === 'shop' ? scope.shopId : undefined;
  const [location, navigate] = useLocation();
  const selectedAccountId = detailIdFromPath(location, '/finance');
  const finance = useFinance(shopId, selectedAccountId);
  const workspace = finance.workspaceQuery.data;
  const accounts = workspace?.accounts ?? [];
  const paymentMethods = workspace?.paymentMethods ?? [];
  const selectedAccount = accounts.find((account) => account.id === selectedAccountId);
  const canManage = principal.permissions.includes('finance.manage_accounts');
  const canAdjust = principal.permissions.includes('finance.adjust');

  const [accountFormOpen, setAccountFormOpen] = useState(false);
  const [moneyMovementOpen, setMoneyMovementOpen] = useState(false);
  const [mappingFormOpen, setMappingFormOpen] = useState(false);
  const [deactivateAccount, setDeactivateAccount] = useState<FinanceAccountBalance | null>(null);
  const [accountName, setAccountName] = useState('');
  const [accountType, setAccountType] = useState<FinanceAccountType>('CASH');
  const [accountScope, setAccountScope] = useState<'SHOP' | 'BUSINESS'>('SHOP');
  const [openingEgp, setOpeningEgp] = useState('0.00');
  const [methodId, setMethodId] = useState('');
  const [mappedAccountId, setMappedAccountId] = useState('unmapped');
  const [validationError, setValidationError] = useState<string | null>(null);

  function submitAccount() {
    if (!shopId) return;
    try {
      const openingBalanceMinor = parseEgpMinor(openingEgp);
      if (!accountName.trim()) throw new Error('Account name is required.');
      setValidationError(null);
      finance.command.mutate(
        {
          type: 'finance.account.create',
          shopId,
          name: accountName.trim(),
          accountType,
          scope: accountScope,
          openingBalanceMinor,
        },
        {
          onSuccess: () => {
            setAccountFormOpen(false);
            setAccountName('');
            setOpeningEgp('0.00');
          },
        },
      );
    } catch (error) {
      setValidationError(readableError(error));
    }
  }

  function submitMapping() {
    if (!shopId) return;
    const method = paymentMethods.find((value) => value.id === methodId);
    if (!method) return;
    finance.command.mutate(
      {
        type: 'finance.mapping.set',
        shopId,
        paymentMethodId: method.id,
        financeAccountId: mappedAccountId === 'unmapped' ? null : mappedAccountId,
        expectedVersion: method.mappingVersion,
      },
      { onSuccess: () => setMappingFormOpen(false) },
    );
  }

  function openMethodMapping(method: FinancePaymentMethod) {
    setMethodId(method.id);
    setMappedAccountId(method.financeAccountId ?? 'unmapped');
    setMappingFormOpen(true);
  }

  if (!shopId) {
    return (
      <PageScaffold
        eyebrow="Finance"
        title="Bank & Cash"
        description="Choose a shop to see its financial position and account setup."
      />
    );
  }

  const actionError = finance.command.error ? readableError(finance.command.error) : null;

  return (
    <PageScaffold
      eyebrow="Finance"
      title="Bank & Cash"
      description="Accounts and payment method links for this shop."
      primaryAction={
        canManage || canAdjust ? (
          <div className="tux-finance-toolbar">
            {canManage ? (
              <button
                type="button"
                className="admin-primary-button"
                onClick={() => setAccountFormOpen(true)}
              >
                Add account
              </button>
            ) : null}
            {canAdjust ? (
              <button
                type="button"
                className="admin-secondary-button"
                onClick={() => setMoneyMovementOpen(true)}
              >
                Money movement
              </button>
            ) : null}
          </div>
        ) : undefined
      }
    >
      <nav className="tux-finance-toolbar" aria-label="Finance sections">
        <Link className="admin-secondary-button" href="/finance">
          Bank & Cash
        </Link>
        <Link className="admin-secondary-button" href="/finance/expenses">
          Expenses
        </Link>
        <Link className="admin-secondary-button" href="/finance/settlements">
          Settlements
        </Link>
        <Link className="admin-secondary-button" href="/finance/end-day">
          End Day
        </Link>
      </nav>
      {actionError ? <InlineError>{actionError}</InlineError> : null}
      {finance.workspaceQuery.isLoading ? <LoadingState title="Loading finance" /> : null}
      {finance.workspaceQuery.isError ? (
        <ErrorState
          title="Finance is unavailable"
          action={
            <button
              type="button"
              className="admin-secondary-button"
              onClick={() => void finance.workspaceQuery.refetch()}
            >
              Retry
            </button>
          }
        />
      ) : null}
      {workspace?.setupState === 'SETUP_REQUIRED' ? (
        <EmptyState
          title="Finance setup required"
          description="Add your first real cash, bank or wallet account, then link your payment methods."
          action={
            canManage ? (
              <button
                type="button"
                className="admin-primary-button"
                onClick={() => setAccountFormOpen(true)}
              >
                Create account
              </button>
            ) : undefined
          }
        />
      ) : null}
      {workspace?.moneyPosition ? <FinancePosition position={workspace.moneyPosition} /> : null}
      {workspace ? <FinanceProfitSummary summary={workspace.profitSummary} /> : null}
      {workspace && workspace.unmappedPaymentMethodCount > 0 ? (
        <p className="tux-finance-attention" role="status">
          {workspace.unmappedPaymentMethodCount} payment{' '}
          {workspace.unmappedPaymentMethodCount === 1 ? 'method needs' : 'methods need'} an account
          link. Existing payments are not assigned to an account automatically.
        </p>
      ) : null}
      {workspace && accounts.length > 0 ? (
        <section aria-label="Financial accounts">
          <h2>Accounts</h2>
          <ResponsiveMasterDetail
            listLabel="Accounts"
            detailLabel="Account activity"
            detailActive={selectedAccountId !== null}
            backHref="/finance"
            list={
              <div className="admin-inventory-list">
                {accounts.map((account) => (
                  <button
                    type="button"
                    key={account.id}
                    className={
                      selectedAccountId === account.id
                        ? 'admin-inventory-row is-selected'
                        : 'admin-inventory-row'
                    }
                    onClick={() => navigate(detailPath('/finance', account.id))}
                  >
                    <span>
                      <strong>{account.name}</strong>
                      <small>
                        {accountTypeLabels[account.accountType]} ·{' '}
                        {account.shopId ? 'Shop' : 'Business'}
                        {account.active ? '' : ' · Inactive'}
                      </small>
                    </span>
                    <span>{formatEgp(account.balanceMinor)}</span>
                  </button>
                ))}
              </div>
            }
            detail={
              selectedAccount ? (
                <AccountDetail
                  account={selectedAccount}
                  canManage={canManage}
                  history={finance.historyQuery.data ?? []}
                  loading={finance.historyQuery.isLoading}
                  onDeactivate={() => setDeactivateAccount(selectedAccount)}
                />
              ) : (
                <EmptyState
                  title="Choose an account"
                  description="Review movements and account details."
                />
              )
            }
          />
        </section>
      ) : null}
      {workspace ? (
        <section aria-label="Payment method links" className="tux-finance-mappings">
          <h2>Payment methods</h2>
          {paymentMethods.length === 0 ? (
            <EmptyState
              title="No active payment methods"
              description="Configure your operational payment methods before linking accounts."
            />
          ) : (
            <ul>
              {paymentMethods.map((method) => {
                const mapped = accounts.find((value) => value.id === method.financeAccountId);
                return (
                  <li key={method.id}>
                    <div>
                      <strong>{method.displayName}</strong>
                      <small>{mapped ? mapped.name : 'Not linked'}</small>
                    </div>
                    {canManage ? (
                      <button
                        type="button"
                        className="admin-secondary-button"
                        onClick={() => openMethodMapping(method)}
                      >
                        Change link
                      </button>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      ) : null}

      <AdminDialog
        open={accountFormOpen}
        title="Create finance account"
        description="Your opening balance is recorded once. Later corrections are separate adjustments."
        variant="sheet"
        onOpenChange={setAccountFormOpen}
        footer={
          <>
            <button
              type="button"
              className="admin-secondary-button"
              onClick={() => setAccountFormOpen(false)}
              disabled={finance.command.isPending}
            >
              Cancel
            </button>
            <button
              type="button"
              className="admin-primary-button"
              onClick={submitAccount}
              disabled={finance.command.isPending}
            >
              {finance.command.isPending ? 'Saving…' : 'Create account'}
            </button>
          </>
        }
      >
        <div className="tux-finance-form">
          <label>
            Name
            <input
              value={accountName}
              onChange={(event) => setAccountName(event.target.value)}
              maxLength={160}
              placeholder="e.g. Shop Cash"
            />
          </label>
          <label>
            Account type
            <select
              value={accountType}
              onChange={(event) => setAccountType(event.target.value as FinanceAccountType)}
            >
              {Object.entries(accountTypeLabels).map(([type, label]) => (
                <option key={type} value={type}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Scope
            <select
              value={accountScope}
              onChange={(event) => setAccountScope(event.target.value as 'SHOP' | 'BUSINESS')}
            >
              <option value="SHOP">This shop</option>
              {principal.role === 'OWNER' || principal.role === 'ADMIN' ? (
                <option value="BUSINESS">Business-wide</option>
              ) : null}
            </select>
          </label>
          <label>
            Opening balance (EGP)
            <input
              inputMode="decimal"
              value={openingEgp}
              onChange={(event) => setOpeningEgp(event.target.value)}
              aria-describedby="opening-balance-help"
            />
            <small id="opening-balance-help">
              Use EGP, for example 1,250.00 without the comma.
            </small>
          </label>
          {validationError ? <InlineError>{validationError}</InlineError> : null}
        </div>
      </AdminDialog>

      <AdminDialog
        open={mappingFormOpen}
        title="Link payment method"
        description="Only payments after this link takes effect will receive the account attribution."
        variant="sheet"
        onOpenChange={setMappingFormOpen}
        footer={
          <>
            <button
              type="button"
              className="admin-secondary-button"
              disabled={finance.command.isPending}
              onClick={() => setMappingFormOpen(false)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="admin-primary-button"
              disabled={finance.command.isPending}
              onClick={submitMapping}
            >
              {finance.command.isPending ? 'Saving…' : 'Save link'}
            </button>
          </>
        }
      >
        <div className="tux-finance-form">
          <p>{paymentMethods.find((method) => method.id === methodId)?.displayName}</p>
          <label>
            Finance account
            <select
              value={mappedAccountId}
              onChange={(event) => setMappedAccountId(event.target.value)}
            >
              <option value="unmapped">Not linked</option>
              {accounts
                .filter((account) => account.active)
                .map((account) => (
                  <option value={account.id} key={account.id}>
                    {account.name} · {accountTypeLabels[account.accountType]}
                  </option>
                ))}
            </select>
          </label>
        </div>
      </AdminDialog>

      <MoneyMovementSheet
        shopId={shopId}
        accounts={accounts}
        open={moneyMovementOpen}
        onClose={() => setMoneyMovementOpen(false)}
      />
      <ConfirmationDialog
        open={deactivateAccount !== null}
        title="Deactivate account?"
        description="Existing transactions and balances are preserved. Remove active payment links first."
        confirmLabel="Deactivate"
        destructive
        pending={finance.command.isPending}
        onOpenChange={(open) => {
          if (!open) setDeactivateAccount(null);
        }}
        onConfirm={() => {
          if (!deactivateAccount) return;
          finance.command.mutate(
            {
              type: 'finance.account.active',
              shopId,
              accountId: deactivateAccount.id,
              expectedVersion: deactivateAccount.version,
              active: false,
            },
            { onSuccess: () => setDeactivateAccount(null) },
          );
        }}
      />
    </PageScaffold>
  );
}
