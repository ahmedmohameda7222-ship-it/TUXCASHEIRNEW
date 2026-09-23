import type { AdminPromotion, AdminPromotionUpsertInput } from '@tux/admin-contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';

import { useAdminSession } from '../auth/useAdminSession';
import { adminFetch } from '../lib/adminApi';
import { createRetainedCommandIds } from '../lib/retainedCommandIds';
import { PromotionEditor } from './PromotionEditor';

function csrfToken(session: ReturnType<typeof useAdminSession>): string {
  if (session.state.status !== 'authenticated') {
    throw new Error('session_required');
  }
  return session.state.session.csrfToken;
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
      commandIds.complete('promotion.upsert', intent);
      return result;
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
        <p>Server-validated promotion rules with immutable historical order snapshots.</p>
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

      {promotions.length === 0 && !promotionsQuery.isLoading ? (
        <p>No promotions configured.</p>
      ) : (
        <ul>
          {promotions.map((promotion) => (
            <li key={promotion.id}>
              <button
                className="admin-secondary-button"
                type="button"
                onClick={() => {
                  setCreating(false);
                  setEditing(promotion);
                }}
              >
                {promotion.name} · {promotion.kind} · {promotion.active ? 'Active' : 'Inactive'}
              </button>
            </li>
          ))}
        </ul>
      )}

      {creating || editing ? (
        <PromotionEditor
          shopId={shopId}
          promotion={editing}
          saving={savePromotion.isPending}
          onCancel={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSave={(input) => savePromotion.mutate(input)}
        />
      ) : null}

      {savePromotion.isError ? <p role="alert">Promotion could not be saved.</p> : null}
    </section>
  );
}
