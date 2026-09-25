import type {
  AdminCustomerDetail,
  AdminCustomerMergeResult,
  AdminCustomerSummary,
  AdminLoyaltyProgram,
} from '@tux/admin-contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState, type FormEvent } from 'react';

import { useAdminSession } from '../auth/useAdminSession';
import { PageScaffold } from '../components/layout/PageScaffold';
import { adminFetch } from '../lib/adminApi';
import { createRetainedCommandIds } from '../lib/retainedCommandIds';
import { PromotionsPage } from '../promotions/PromotionsPage';
import { useShopScope } from '../shops/ShopScopeProvider';
import { CustomerDetailPage } from './CustomerDetailPage';
import { LoyaltyPanel, type LoyaltyAdjustmentInput } from './LoyaltyPanel';

function csrfToken(session: ReturnType<typeof useAdminSession>): string {
  if (session.state.status !== 'authenticated') {
    throw new Error('session_required');
  }
  return session.state.session.csrfToken;
}

export function CustomersPage() {
  const { scope, principal } = useShopScope();
  const session = useAdminSession();
  const queryClient = useQueryClient();
  const shopId = scope.kind === 'shop' ? scope.shopId : undefined;
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mergeTargetId, setMergeTargetId] = useState('');
  const [mergeConfirmed, setMergeConfirmed] = useState(false);
  const [programDraft, setProgramDraft] = useState({
    enabled: true,
    earnPointsPer100Minor: '1',
    redemptionMinorPerPoint: '10',
    minimumRedemptionPoints: '50',
    pointExpiryDays: '',
  });
  const namespace =
    session.state.status === 'authenticated'
      ? `${session.state.session.principal.businessId}:${session.state.session.principal.employeeId}`
      : 'unauthenticated';
  const commandIds = useMemo(() => createRetainedCommandIds(namespace), [namespace]);

  const customersQuery = useQuery({
    queryKey: ['admin', 'customers', shopId, 'list', query],
    enabled: Boolean(shopId),
    queryFn: () =>
      adminFetch<{ customers: AdminCustomerSummary[] }>(
        `/api/admin/customers?shopId=${encodeURIComponent(
          shopId!,
        )}&view=customers&q=${encodeURIComponent(query)}`,
      ),
  });

  const customers = customersQuery.data?.customers ?? [];
  const activeCustomerId =
    selectedId && customers.some((customer) => customer.id === selectedId)
      ? selectedId
      : (customers[0]?.id ?? null);

  const detailQuery = useQuery({
    queryKey: ['admin', 'customers', shopId, 'detail', activeCustomerId],
    enabled: Boolean(shopId && activeCustomerId),
    queryFn: () =>
      adminFetch<{ customer: AdminCustomerDetail }>(
        `/api/admin/customers?shopId=${encodeURIComponent(
          shopId!,
        )}&view=customer&customerId=${encodeURIComponent(activeCustomerId!)}`,
      ).then((result) => result.customer),
  });

  const programQuery = useQuery({
    queryKey: ['admin', 'customers', shopId, 'loyalty-program'],
    enabled: Boolean(shopId),
    queryFn: () =>
      adminFetch<{ program: AdminLoyaltyProgram | null }>(
        `/api/admin/customers?shopId=${encodeURIComponent(shopId!)}&view=loyalty-program`,
      ).then((result) => result.program),
  });

  useEffect(() => {
    const program = programQuery.data;
    if (!program) return;
    setProgramDraft({
      enabled: program.enabled,
      earnPointsPer100Minor: String(program.earnPointsPer100Minor),
      redemptionMinorPerPoint: String(program.redemptionMinorPerPoint),
      minimumRedemptionPoints: String(program.minimumRedemptionPoints),
      pointExpiryDays:
        program.pointExpiryDays === null ? '' : String(program.pointExpiryDays),
    });
  }, [programQuery.data]);

  const adjustLoyalty = useMutation({
    mutationFn: async (input: LoyaltyAdjustmentInput) => {
      if (!shopId || !activeCustomerId) throw new Error('customer_required');
      const intent = { shopId, customerId: activeCustomerId, ...input };
      const commandId = commandIds.forIntent('loyalty.adjust', intent);
      const result = await adminFetch<{ ok: boolean; code?: string }>(
        '/api/admin/customers?surface=crm',
        {
          method: 'POST',
          body: JSON.stringify({
            type: 'loyalty.adjust',
            shopId,
            customerId: activeCustomerId,
            ...input,
            commandId,
          }),
        },
        csrfToken(session),
      );
      commandIds.complete('loyalty.adjust', intent);
      return result;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ['admin', 'customers', shopId],
      });
    },
  });

  const mergeCustomer = useMutation({
    mutationFn: async () => {
      if (!activeCustomerId || !mergeTargetId.trim()) {
        throw new Error('merge_customer_required');
      }
      const intent = {
        survivorCustomerId: activeCustomerId,
        mergedCustomerId: mergeTargetId.trim(),
        confirmed: mergeConfirmed,
      };
      const commandId = commandIds.forIntent('customer.merge', intent);
      const result = await adminFetch<AdminCustomerMergeResult>(
        '/api/admin/customers',
        {
          method: 'POST',
          body: JSON.stringify({
            type: 'customer.merge',
            ...intent,
            commandId,
          }),
        },
        csrfToken(session),
      );
      commandIds.complete('customer.merge', intent);
      return result;
    },
    onSuccess: async () => {
      setMergeTargetId('');
      setMergeConfirmed(false);
      setSelectedId(null);
      await queryClient.invalidateQueries({
        queryKey: ['admin', 'customers', shopId],
      });
    },
  });

  const saveProgram = useMutation({
    mutationFn: async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!shopId) throw new Error('concrete_shop_required');
      const existing = programQuery.data;
      return adminFetch<{ ok: boolean; code?: string }>(
        '/api/admin/customers?surface=crm',
        {
          method: 'POST',
          body: JSON.stringify({
            type: 'loyalty.program.upsert',
            shopId,
            enabled: programDraft.enabled,
            earnPointsPer100Minor: Number(programDraft.earnPointsPer100Minor),
            redemptionMinorPerPoint: Number(programDraft.redemptionMinorPerPoint),
            minimumRedemptionPoints: Number(programDraft.minimumRedemptionPoints),
            pointExpiryDays: programDraft.pointExpiryDays.trim()
              ? Number(programDraft.pointExpiryDays)
              : null,
            shopIds: existing?.shopIds ?? [shopId],
            expectedVersion: existing?.version ?? null,
          }),
        },
        csrfToken(session),
      );
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ['admin', 'customers', shopId, 'loyalty-program'],
      });
    },
  });

  if (!shopId) {
    return (
      <PageScaffold
        eyebrow="Customers"
        title="Customers"
        description="Select a concrete shop to manage canonical customer CRM."
      />
    );
  }

  const detail = detailQuery.data;
  const canMerge = principal.permissions.includes('customers.merge');
  const canManageLoyalty = principal.permissions.includes('loyalty.manage');
  const canManagePromotions = principal.permissions.includes('promotions.manage');

  return (
    <PageScaffold
      eyebrow="Customer CRM"
      title="Customers"
      description="Canonical phone identity, order history, loyalty, automatic segments and controlled merge."
    >
      <label className="admin-field">
        <span>Search customers</span>
        <input
          value={query}
          placeholder="Name or normalized phone"
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>

      <div className="admin-inventory-layout">
        <section className="admin-inventory-list" aria-label="Customers">
          {customersQuery.isLoading ? <p>Loading customers…</p> : null}
          {customersQuery.isError ? <p role="alert">Customers could not be loaded.</p> : null}
          {customers.map((customer) => (
            <button
              className={
                customer.id === activeCustomerId
                  ? 'admin-inventory-row is-selected'
                  : 'admin-inventory-row'
              }
              key={customer.id}
              type="button"
              onClick={() => setSelectedId(customer.id)}
            >
              <span>
                <strong>{customer.displayName ?? 'Unnamed customer'}</strong>
                <small>{customer.normalizedPhone}</small>
              </span>
              <span>{customer.orderCount} orders</span>
            </button>
          ))}
        </section>

        <section className="admin-inventory-inspector">
          {detailQuery.isLoading ? <p>Loading customer…</p> : null}
          {detail ? (
            <>
              <CustomerDetailPage
                customer={detail}
                canMerge={canMerge}
                onMerge={() => setMergeConfirmed(false)}
              />
              <LoyaltyPanel
                customer={detail}
                program={programQuery.data ?? null}
                canManage={canManageLoyalty}
                saving={adjustLoyalty.isPending}
                onAdjust={(input) => adjustLoyalty.mutate(input)}
              />
              {canMerge ? (
                <section aria-label="Merge customer">
                  <h3>Merge workflow</h3>
                  <label className="admin-field">
                    <span>Customer ID to merge into this survivor</span>
                    <input
                      value={mergeTargetId}
                      onChange={(event) => setMergeTargetId(event.target.value)}
                    />
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={mergeConfirmed}
                      onChange={(event) => setMergeConfirmed(event.target.checked)}
                    />
                    Confirm canonical merge
                  </label>
                  <button
                    className="admin-secondary-button"
                    type="button"
                    disabled={mergeCustomer.isPending || !mergeConfirmed || !mergeTargetId.trim()}
                    onClick={() => mergeCustomer.mutate()}
                  >
                    {mergeCustomer.isPending ? 'Merging…' : 'Merge customer'}
                  </button>
                </section>
              ) : null}
            </>
          ) : (
            <p>Select a customer.</p>
          )}
        </section>
      </div>

      {canManageLoyalty ? (
        <form onSubmit={(event) => saveProgram.mutate(event)}>
          <h2>Loyalty configuration</h2>
          <label>
            <input
              type="checkbox"
              checked={programDraft.enabled}
              onChange={(event) =>
                setProgramDraft((current) => ({
                  ...current,
                  enabled: event.target.checked,
                }))
              }
            />
            Enabled
          </label>
          <label className="admin-field">
            <span>Earn points per 1 EGP</span>
            <input
              inputMode="numeric"
              value={programDraft.earnPointsPer100Minor}
              onChange={(event) =>
                setProgramDraft((current) => ({
                  ...current,
                  earnPointsPer100Minor: event.target.value,
                }))
              }
            />
          </label>
          <label className="admin-field">
            <span>Redemption minor per point</span>
            <input
              inputMode="numeric"
              value={programDraft.redemptionMinorPerPoint}
              onChange={(event) =>
                setProgramDraft((current) => ({
                  ...current,
                  redemptionMinorPerPoint: event.target.value,
                }))
              }
            />
          </label>
          <label className="admin-field">
            <span>Minimum redemption points</span>
            <input
              inputMode="numeric"
              value={programDraft.minimumRedemptionPoints}
              onChange={(event) =>
                setProgramDraft((current) => ({
                  ...current,
                  minimumRedemptionPoints: event.target.value,
                }))
              }
            />
          </label>
          <label className="admin-field">
            <span>Point expiry days</span>
            <input
              inputMode="numeric"
              value={programDraft.pointExpiryDays}
              onChange={(event) =>
                setProgramDraft((current) => ({
                  ...current,
                  pointExpiryDays: event.target.value,
                }))
              }
            />
          </label>
          <button className="admin-primary-button" type="submit" disabled={saveProgram.isPending}>
            {saveProgram.isPending ? 'Saving…' : 'Save loyalty program'}
          </button>
        </form>
      ) : null}

      {canManagePromotions ? <PromotionsPage shopId={shopId} /> : null}

      {adjustLoyalty.isError || mergeCustomer.isError || saveProgram.isError ? (
        <p role="alert">Customer CRM action failed.</p>
      ) : null}
    </PageScaffold>
  );
}
