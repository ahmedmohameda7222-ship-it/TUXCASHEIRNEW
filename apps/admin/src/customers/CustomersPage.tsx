import type {
  AdminCustomerDetail,
  AdminCustomerMergeResult,
  AdminCustomerSummary,
  AdminLoyaltyProgram,
  AdminReasonCodeConfiguration,
} from '@tux/admin-contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { useLocation } from 'wouter';

import { useAdminSession } from '../auth/useAdminSession';
import { EmptyState, ErrorState, LoadingState } from '../components/feedback/AdminStates';
import { PageScaffold } from '../components/layout/PageScaffold';
import { ResponsiveMasterDetail } from '../components/layout/ResponsiveMasterDetail';
import { detailIdFromPath, detailPath } from '../components/layout/detailRoute';
import { AdminTabs } from '../components/navigation/AdminTabs';
import { adminFetch } from '../lib/adminApi';
import { createRetainedCommandIds } from '../lib/retainedCommandIds';
import { PromotionsPage } from '../promotions/PromotionsPage';
import { useShopScope } from '../shops/ShopScopeProvider';
import { CustomerDirectory } from './CustomerDirectory';
import { CustomerDetailPage } from './CustomerDetailPage';
import { CustomerMergeDialog } from './CustomerMergeDialog';
import { requireSuccessfulCrmMutation } from './crmMutationGuard';
import { LoyaltyPanel, type LoyaltyAdjustmentInput } from './LoyaltyPanel';
import './customers.css';

type CrmSection = 'customers' | 'settings';

const EMPTY_PROGRAM_DRAFT = {
  enabled: true,
  earnPointsPer100Minor: '1',
  pointValueEgp: '0.10',
  minimumRedemptionPoints: '50',
  pointExpiryDays: '',
};

function csrfToken(session: ReturnType<typeof useAdminSession>): string {
  if (session.state.status !== 'authenticated') throw new Error('session_required');
  return session.state.session.csrfToken;
}

export function CustomersPage() {
  const { scope, principal } = useShopScope();
  const session = useAdminSession();
  const queryClient = useQueryClient();
  const shopId = scope.kind === 'shop' ? scope.shopId : undefined;
  const [location, navigate] = useLocation();
  const section: CrmSection = location === '/customers/settings' ? 'settings' : 'customers';
  const selectedId = section === 'settings' ? null : detailIdFromPath(location, '/customers');
  const [query, setQuery] = useState('');
  const [mergeOpen, setMergeOpen] = useState(false);
  const [mergeSearch, setMergeSearch] = useState('');
  const [programDraft, setProgramDraft] = useState({ ...EMPTY_PROGRAM_DRAFT });
  const programDraftOwnerShop = useRef(shopId);
  const programDraftEdited = useRef(false);

  function editProgramDraft(update: (current: typeof programDraft) => typeof programDraft) {
    programDraftEdited.current = true;
    setProgramDraft(update);
  }
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
        `/api/admin/customers?shopId=${encodeURIComponent(shopId!)}&view=customers&q=${encodeURIComponent(query)}`,
      ),
  });

  const detailQuery = useQuery({
    queryKey: ['admin', 'customers', shopId, 'detail', selectedId],
    enabled: Boolean(shopId && selectedId),
    queryFn: () =>
      adminFetch<{ customer: AdminCustomerDetail }>(
        `/api/admin/customers?shopId=${encodeURIComponent(shopId!)}&view=customer&customerId=${encodeURIComponent(selectedId!)}`,
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

  const adjustmentReasonsQuery = useQuery({
    queryKey: ['admin', 'customers', shopId, 'adjustment-reasons'],
    enabled: Boolean(shopId && principal.permissions.includes('loyalty.manage')),
    queryFn: () =>
      adminFetch<{ reasons: AdminReasonCodeConfiguration[] }>(
        `/api/admin/customers?shopId=${encodeURIComponent(shopId!)}&view=adjustment-reasons`,
      ).then((result) => result.reasons),
  });

  const mergeCandidatesQuery = useQuery({
    queryKey: ['admin', 'customers', shopId, 'merge-candidates', mergeSearch],
    enabled: Boolean(shopId && selectedId && mergeOpen),
    queryFn: () =>
      adminFetch<{ customers: AdminCustomerSummary[] }>(
        `/api/admin/customers?shopId=${encodeURIComponent(shopId!)}&view=customers&q=${encodeURIComponent(mergeSearch)}`,
      ),
  });

  useEffect(() => {
    if (programDraftOwnerShop.current !== shopId) {
      programDraftOwnerShop.current = shopId;
      programDraftEdited.current = false;
      setProgramDraft({ ...EMPTY_PROGRAM_DRAFT });
    }
    const program = programQuery.data;
    if (!program || programDraftEdited.current) return;
    setProgramDraft({
      enabled: program.enabled,
      earnPointsPer100Minor: String(program.earnPointsPer100Minor),
      pointValueEgp: (program.redemptionMinorPerPoint / 100).toFixed(2),
      minimumRedemptionPoints: String(program.minimumRedemptionPoints),
      pointExpiryDays: program.pointExpiryDays === null ? '' : String(program.pointExpiryDays),
    });
  }, [programQuery.data, shopId]);

  const adjustLoyalty = useMutation({
    mutationFn: async (input: LoyaltyAdjustmentInput) => {
      if (!shopId || !selectedId) throw new Error('customer_required');
      const intent = { shopId, customerId: selectedId, ...input };
      const commandId = commandIds.forIntent('loyalty.adjust', intent);
      const result = await adminFetch<{ ok: boolean; code?: string }>(
        '/api/admin/customers?surface=crm',
        {
          method: 'POST',
          body: JSON.stringify({
            type: 'loyalty.adjust',
            shopId,
            customerId: selectedId,
            ...input,
            commandId,
          }),
        },
        csrfToken(session),
      );
      commandIds.complete('loyalty.adjust', intent);
      return requireSuccessfulCrmMutation(result);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['admin', 'customers', shopId] });
      toast.success('Loyalty balance updated');
    },
    onError: () => toast.error('Loyalty update failed'),
  });

  const mergeCustomer = useMutation({
    mutationFn: async (candidate: AdminCustomerSummary) => {
      if (!selectedId) throw new Error('merge_customer_required');
      const intent = {
        survivorCustomerId: selectedId,
        mergedCustomerId: candidate.id,
        confirmed: true,
      };
      const commandId = commandIds.forIntent('customer.merge', intent);
      const result = await adminFetch<AdminCustomerMergeResult>(
        '/api/admin/customers',
        { method: 'POST', body: JSON.stringify({ type: 'customer.merge', ...intent, commandId }) },
        csrfToken(session),
      );
      if (!result.ok) throw new Error(result.code);
      commandIds.complete('customer.merge', intent);
      return result;
    },
    onSuccess: async () => {
      setMergeOpen(false);
      setMergeSearch('');
      await queryClient.invalidateQueries({ queryKey: ['admin', 'customers', shopId] });
      toast.success('Customer profiles merged');
    },
    onError: () => toast.error('Customer merge failed'),
  });

  const saveProgram = useMutation({
    mutationFn: async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!shopId) throw new Error('concrete_shop_required');
      const existing = programQuery.data;
      return requireSuccessfulCrmMutation(
        await adminFetch<{ ok: boolean; code?: string }>(
          '/api/admin/customers?surface=crm',
          {
            method: 'POST',
            body: JSON.stringify({
              type: 'loyalty.program.upsert',
              shopId,
              enabled: programDraft.enabled,
              earnPointsPer100Minor: Number(programDraft.earnPointsPer100Minor),
              redemptionMinorPerPoint: Math.round(Number(programDraft.pointValueEgp) * 100),
              minimumRedemptionPoints: Number(programDraft.minimumRedemptionPoints),
              pointExpiryDays: programDraft.pointExpiryDays.trim()
                ? Number(programDraft.pointExpiryDays)
                : null,
              shopIds: existing?.shopIds ?? [shopId],
              expectedVersion: existing?.version ?? null,
            }),
          },
          csrfToken(session),
        ),
      );
    },
    onSuccess: async () => {
      programDraftEdited.current = false;
      await queryClient.invalidateQueries({
        queryKey: ['admin', 'customers', shopId, 'loyalty-program'],
      });
      toast.success('Loyalty settings saved');
    },
    onError: () => toast.error('Loyalty settings could not be saved'),
  });

  // Only auto-open the first real customer on wide desktop. Phones and tablets
  // remain list-first; never select another shop's cached/customer detail.
  useEffect(() => {
    if (
      !shopId ||
      section !== 'customers' ||
      location !== '/customers' ||
      !customersQuery.isSuccess ||
      window.innerWidth < 1100
    ) {
      return;
    }
    const first = customersQuery.data?.customers[0];
    if (first) navigate(detailPath('/customers', first.id), { replace: true });
  }, [shopId, section, location, navigate, customersQuery.isSuccess, customersQuery.data]);

  if (!shopId) {
    return (
      <PageScaffold
        eyebrow="Customers"
        title="Customers"
        description="Select a shop to manage customer profiles and history."
      />
    );
  }

  const customers = customersQuery.data?.customers ?? [];
  const detail = detailQuery.data;
  const canMerge = principal.permissions.includes('customers.merge');
  const canManageLoyalty = principal.permissions.includes('loyalty.manage');
  const canManagePromotions = principal.permissions.includes('promotions.manage');
  const mergeCandidates = (mergeCandidatesQuery.data?.customers ?? []).filter(
    (customer) => customer.id !== selectedId,
  );

  return (
    <PageScaffold
      eyebrow="Customer CRM"
      title="Customers"
      description="Customer profiles, contact history, orders, loyalty and business CRM settings."
    >
      <AdminTabs<CrmSection>
        label="Customer workspace"
        value={section}
        onChange={(nextSection) => {
          navigate(nextSection === 'settings' ? '/customers/settings' : '/customers');
        }}
        tabs={[
          {
            id: 'customers',
            label: 'Customers',
            content: (
              <>
                <ResponsiveMasterDetail
                  className="admin-customers-master-detail"
                  listLabel="Customers"
                  detailLabel="Customer detail"
                  detailActive={selectedId !== null}
                  backHref="/customers"
                  list={
                    <CustomerDirectory
                      key={shopId}
                      customers={customers}
                      selectedId={selectedId}
                      query={query}
                      onQueryChange={(nextQuery) => {
                        setQuery(nextQuery);
                        if (selectedId !== null) navigate('/customers', { replace: true });
                      }}
                      onSelect={(id) => navigate(detailPath('/customers', id))}
                      loading={customersQuery.isLoading}
                      fetching={customersQuery.isFetching}
                      error={customersQuery.isError}
                      onRetry={() => void customersQuery.refetch()}
                    />
                  }
                  detail={
                    detailQuery.isLoading ? (
                      <LoadingState title="Loading customer" />
                    ) : detailQuery.isError ? (
                      <ErrorState
                        title="Customer unavailable"
                        description="This customer may not exist or may not be available in your current shop scope."
                      />
                    ) : detail ? (
                      <>
                        <CustomerDetailPage
                          customer={detail}
                          loyalty={
                            <LoyaltyPanel
                              customer={detail}
                              program={programQuery.data ?? null}
                              reasons={adjustmentReasonsQuery.data ?? []}
                              canManage={canManageLoyalty}
                              saving={adjustLoyalty.isPending}
                              onAdjust={(input) => adjustLoyalty.mutate(input)}
                            />
                          }
                          canMerge={canMerge}
                          onMerge={() => {
                            setMergeSearch('');
                            setMergeOpen(true);
                          }}
                        />
                      </>
                    ) : (
                      <EmptyState
                        title="Customer unavailable"
                        description="Choose another customer from the list."
                      />
                    )
                  }
                  emptyDetail={
                    <EmptyState
                      title="Select a customer"
                      description="Review contact information, order history, addresses and loyalty."
                    />
                  }
                />
              </>
            ),
          },
          {
            id: 'settings',
            label: 'CRM settings',
            content: (
              <div className="admin-card-grid">
                {canManageLoyalty ? (
                  <form
                    className="admin-card admin-crm-loyalty-form"
                    onSubmit={(event) => saveProgram.mutate(event)}
                  >
                    <h2>Loyalty program</h2>
                    <p>
                      Changes below are editable settings, not the currently saved values. Save to
                      apply a change to this shop through the server.
                    </p>
                    <section
                      className="admin-crm-saved-policy"
                      aria-label="Current saved loyalty settings"
                    >
                      <h3>Current saved settings</h3>
                      <button
                        className="admin-secondary-button"
                        type="button"
                        onClick={() => void programQuery.refetch()}
                        disabled={programQuery.isFetching}
                      >
                        {programQuery.isFetching
                          ? 'Refreshing saved settings…'
                          : 'Refresh saved loyalty settings'}
                      </button>
                      {programQuery.isLoading ? (
                        <p role="status">Loading current loyalty settings…</p>
                      ) : null}
                      {programQuery.isError ? (
                        <p role="alert">
                          Current loyalty settings are unavailable. Retry before changing this
                          policy.
                        </p>
                      ) : null}
                      {programQuery.isSuccess && !programQuery.data ? (
                        <p>No loyalty policy has been saved for this shop.</p>
                      ) : null}
                      {programQuery.data ? (
                        <dl>
                          <div>
                            <dt>Status</dt>
                            <dd>{programQuery.data.enabled ? 'Enabled' : 'Disabled'}</dd>
                          </div>
                          <div>
                            <dt>Earn rate</dt>
                            <dd>{programQuery.data.earnPointsPer100Minor} points per EGP</dd>
                          </div>
                          <div>
                            <dt>Redemption value</dt>
                            <dd>
                              EGP {(programQuery.data.redemptionMinorPerPoint / 100).toFixed(2)} per
                              point
                            </dd>
                          </div>
                          <div>
                            <dt>Minimum redemption</dt>
                            <dd>{programQuery.data.minimumRedemptionPoints} points</dd>
                          </div>
                          <div>
                            <dt>Expiry</dt>
                            <dd>
                              {programQuery.data.pointExpiryDays === null
                                ? 'No expiry'
                                : `${programQuery.data.pointExpiryDays} days`}
                            </dd>
                          </div>
                        </dl>
                      ) : null}
                    </section>
                    <fieldset className="admin-crm-loyalty-fields">
                      <legend>Activation</legend>
                      <label>
                        <input
                          type="checkbox"
                          checked={programDraft.enabled}
                          onChange={(event) =>
                            editProgramDraft((current) => ({
                              ...current,
                              enabled: event.target.checked,
                            }))
                          }
                        />{' '}
                        Enabled
                      </label>
                    </fieldset>
                    <fieldset className="admin-crm-loyalty-fields">
                      <legend>Earning and redemption</legend>
                      <label className="admin-field">
                        <span>Points earned per 1 EGP</span>
                        <input
                          inputMode="numeric"
                          value={programDraft.earnPointsPer100Minor}
                          onChange={(event) =>
                            editProgramDraft((current) => ({
                              ...current,
                              earnPointsPer100Minor: event.target.value,
                            }))
                          }
                        />
                      </label>
                      <label className="admin-field">
                        <span>Point value (EGP)</span>
                        <input
                          inputMode="decimal"
                          value={programDraft.pointValueEgp}
                          onChange={(event) =>
                            editProgramDraft((current) => ({
                              ...current,
                              pointValueEgp: event.target.value,
                            }))
                          }
                        />
                      </label>
                      <p>1 point = EGP {Number(programDraft.pointValueEgp || 0).toFixed(2)}</p>
                      <label className="admin-field">
                        <span>Minimum points to redeem</span>
                        <input
                          inputMode="numeric"
                          value={programDraft.minimumRedemptionPoints}
                          onChange={(event) =>
                            editProgramDraft((current) => ({
                              ...current,
                              minimumRedemptionPoints: event.target.value,
                            }))
                          }
                        />
                      </label>
                    </fieldset>
                    <fieldset className="admin-crm-loyalty-fields">
                      <legend>Validity</legend>
                      <label className="admin-field">
                        <span>Point expiry (days)</span>
                        <input
                          inputMode="numeric"
                          value={programDraft.pointExpiryDays}
                          onChange={(event) =>
                            editProgramDraft((current) => ({
                              ...current,
                              pointExpiryDays: event.target.value,
                            }))
                          }
                        />
                      </label>
                    </fieldset>
                    <button
                      className="admin-primary-button"
                      type="submit"
                      disabled={
                        saveProgram.isPending || programQuery.isLoading || programQuery.isError
                      }
                    >
                      {saveProgram.isPending ? 'Saving…' : 'Save loyalty program'}
                    </button>
                  </form>
                ) : null}
                {canManagePromotions ? <PromotionsPage shopId={shopId} /> : null}
                {!canManageLoyalty && !canManagePromotions ? (
                  <EmptyState
                    title="No CRM settings available"
                    description="Your role does not manage loyalty or promotions."
                  />
                ) : null}
              </div>
            ),
          },
        ]}
      />

      {detail && canMerge ? (
        <CustomerMergeDialog
          open={mergeOpen}
          survivor={detail}
          candidates={mergeCandidates}
          search={mergeSearch}
          loading={mergeCandidatesQuery.isLoading || mergeCandidatesQuery.isFetching}
          error={mergeCandidatesQuery.isError || mergeCustomer.isError}
          pending={mergeCustomer.isPending}
          onSearchChange={setMergeSearch}
          onClose={() => setMergeOpen(false)}
          onConfirm={(candidate) => mergeCustomer.mutate(candidate)}
        />
      ) : null}
    </PageScaffold>
  );
}
