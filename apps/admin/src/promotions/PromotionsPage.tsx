import type {
  AdminPromotion,
  AdminPromotionUpsertInput,
  CatalogWorkspace,
} from '@tux/admin-contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';

import { useAdminSession } from '../auth/useAdminSession';
import { adminFetch } from '../lib/adminApi';
import { createRetainedCommandIds } from '../lib/retainedCommandIds';
import { requireSuccessfulCrmMutation } from '../customers/crmMutationGuard';
import { PromotionEditor } from './PromotionEditor';
import './promotions.css';

function csrfToken(session: ReturnType<typeof useAdminSession>): string {
  if (session.state.status !== 'authenticated') {
    throw new Error('session_required');
  }
  return session.state.session.csrfToken;
}

function moneyMinor(minor: number): string {
  if (!Number.isSafeInteger(minor)) return 'Unavailable';
  const value = BigInt(minor);
  const absolute = value < 0n ? -value : value;
  const whole = absolute / 100n;
  const fraction = String(absolute % 100n).padStart(2, '0');
  return `${value < 0n ? '-' : ''}${whole}.${fraction}`;
}

function promotionType(promotion: AdminPromotion): string {
  if (promotion.kind === 'PERCENT') return 'Percentage discount';
  if (promotion.kind === 'FIXED') return 'Fixed amount discount';
  return 'Free item';
}

function promotionDiscount(promotion: AdminPromotion): string {
  if (promotion.kind === 'PERCENT') return `${(promotion.percentBasisPoints ?? 0) / 100}%`;
  if (promotion.kind === 'FIXED') return `EGP ${moneyMinor(promotion.fixedDiscountMinor ?? 0)}`;
  return 'Free item';
}

function promotionChannel(promotion: AdminPromotion): string {
  if (promotion.channel === 'POS') return 'In-store';
  if (promotion.channel === 'ONLINE') return 'Online';
  return 'Both channels';
}

export function PromotionsPage({ shopId }: { shopId: string }) {
  const session = useAdminSession();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<AdminPromotion | null>(null);
  const [creating, setCreating] = useState(false);
  const namespace =
    session.state.status === 'authenticated'
      ? `${session.state.session.principal.businessId}:${session.state.session.principal.employeeId}`
      : 'unauthenticated';
  const commandIds = useMemo(() => createRetainedCommandIds(namespace), [namespace]);

  const promotionsQuery = useQuery({
    queryKey: ['admin', 'customers', shopId, 'promotions'],
    queryFn: () =>
      adminFetch<{ promotions: AdminPromotion[] }>(
        `/api/admin/customers?shopId=${encodeURIComponent(shopId)}&view=promotions`,
      ),
  });

  const catalogQuery = useQuery({
    queryKey: ['admin', 'catalog', shopId, 'promotion-options'],
    queryFn: () =>
      adminFetch<CatalogWorkspace>(`/api/admin/catalog?shopId=${encodeURIComponent(shopId)}`),
  });

  const savePromotion = useMutation({
    mutationFn: async (promotion: AdminPromotionUpsertInput) => {
      const intent = { shopId, promotion };
      const commandId = commandIds.forIntent('promotion.upsert', intent);
      const result = await adminFetch<{
        ok: boolean;
        code?: string;
        promotionId?: string;
      }>(
        '/api/admin/customers?surface=crm',
        {
          method: 'POST',
          body: JSON.stringify({
            type: 'promotion.upsert',
            shopId,
            promotion,
            commandId,
          }),
        },
        csrfToken(session),
      );
      const accepted = requireSuccessfulCrmMutation(result);
      commandIds.complete('promotion.upsert', intent);
      return accepted;
    },
    onSuccess: async () => {
      setCreating(false);
      setEditing(null);
      await queryClient.invalidateQueries({
        queryKey: ['admin', 'customers', shopId, 'promotions'],
      });
    },
  });

  const promotions = promotionsQuery.data?.promotions ?? [];

  return (
    <section aria-label="Promotions">
      <header>
        <p className="admin-entry__eyebrow">CRM</p>
        <h2>Promotions</h2>
        <p>Create customer offers while checkout keeps final eligibility and stacking authority.</p>
      </header>

      <button
        className="admin-primary-button"
        type="button"
        onClick={() => {
          setEditing(null);
          setCreating(true);
        }}
      >
        New promotion
      </button>

      {promotionsQuery.isLoading ? <p>Loading promotions…</p> : null}
      {promotionsQuery.isError ? <p role="alert">Promotions could not be loaded.</p> : null}

      {promotions.length === 0 && !promotionsQuery.isLoading && !promotionsQuery.isError ? (
        <p>No promotions configured.</p>
      ) : (
        <table className="admin-crm-promotions-table" aria-label="Promotions list">
          <thead>
            <tr>
              <th scope="col">Promotion</th>
              <th scope="col">Discount</th>
              <th scope="col">Status</th>
              <th scope="col">Action</th>
            </tr>
          </thead>
          <tbody>
            {promotions.map((promotion) => (
              <tr key={promotion.id}>
                <td>
                  <strong>{promotion.name}</strong>
                  <small>
                    {promotionType(promotion)} · {promotionChannel(promotion)}
                  </small>
                </td>
                <td className="admin-crm-promotions-table__discount">
                  {promotionDiscount(promotion)}
                </td>
                <td>
                  <span className="admin-crm-promotions-table__status">
                    {promotion.active ? 'Active' : 'Inactive'}
                  </span>
                </td>
                <td>
                  <button
                    className="admin-secondary-button"
                    type="button"
                    aria-label={`Edit ${promotion.name}`}
                    onClick={() => {
                      setCreating(false);
                      setEditing(promotion);
                    }}
                  >
                    Edit
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {creating || editing ? (
        <PromotionEditor
          shopId={shopId}
          promotion={editing}
          products={catalogQuery.data?.products ?? []}
          categories={catalogQuery.data?.categories ?? []}
          saving={savePromotion.isPending}
          error={savePromotion.isError}
          onCancel={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSave={(input) => savePromotion.mutate(input)}
        />
      ) : null}
    </section>
  );
}
