import type { AdminSettingsWorkspace } from '@tux/admin-contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { useAdminSession } from '../auth/useAdminSession';
import { adminFetch } from '../lib/adminApi';

type ZoneRule = {
  paymentMethodId: string;
  deliveryZoneId: string;
  allowed: boolean;
};

type ZoneRuleRead = { rules: ZoneRule[] };

export function PaymentZoneRulesPanel({ workspace }: { workspace: AdminSettingsWorkspace }) {
  const session = useAdminSession();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const shopId = workspace.shop.id;
  const queryKey = ['admin', 'payment-zone-rules', shopId] as const;
  const rules = useQuery({
    queryKey,
    queryFn: () =>
      adminFetch<ZoneRuleRead>(
        `/api/admin/payment-zone-rules?shopId=${encodeURIComponent(shopId)}`,
      ),
  });
  const update = useMutation({
    mutationFn: async (input: {
      paymentMethodId: string;
      deliveryZoneId: string;
      allowed: boolean;
      expectedAllowed: boolean | null;
    }) => {
      if (session.state.status !== 'authenticated') throw new Error('session_required');
      const result = await adminFetch<{ ok: boolean; code?: string }>(
        '/api/admin/payment-zone-rules',
        {
          method: 'POST',
          body: JSON.stringify({
            type: 'payment-zone.upsert',
            shopId,
            ...input,
            expectedSettingsVersion: workspace.settingsVersion,
          }),
        },
        session.state.session.csrfToken,
      );
      if (!result.ok) throw new Error(result.code ?? 'payment_zone_update_failed');
    },
    onSuccess: async () => {
      setError(null);
      await queryClient.invalidateQueries({ queryKey });
    },
    onError: (cause) =>
      setError(cause instanceof Error ? cause.message : 'Unable to update payment policy'),
  });

  const availableRules = rules.data?.rules;

  return (
    <section className="admin-settings-subsection" aria-label="Delivery-zone payment restrictions">
      <h3>Delivery-zone payment restrictions</h3>
      <p className="admin-field__help">
        Restrict supported payment methods separately for each delivery zone. Changes apply to
        future orders only after Publish settings; historical payments are unaffected.
      </p>
      {rules.isLoading ? <p>Loading payment restrictions…</p> : null}
      {rules.isError ? <p role="alert">Unable to load payment restrictions.</p> : null}
      {error ? (
        <p className="admin-field__error" role="alert">
          {error}
        </p>
      ) : null}
      {workspace.deliveryZones.length === 0 || workspace.paymentMethods.length === 0 ? (
        <p className="admin-settings-muted">
          Add delivery zones and payment methods before configuring restrictions.
        </p>
      ) : null}
      {availableRules ? (
        <div className="admin-settings-list">
          {workspace.deliveryZones.map((zone) =>
            workspace.paymentMethods.map((method) => {
              const rule = availableRules.find(
                (candidate) =>
                  candidate.deliveryZoneId === zone.id && candidate.paymentMethodId === method.id,
              );
              const allowed = rule?.allowed !== false;
              return (
                <div className="admin-settings-row" key={`${zone.id}:${method.id}`}>
                  <div>
                    <strong>
                      {zone.name} — {method.displayName}
                    </strong>
                    <span>{allowed ? 'Allowed for this zone' : 'Restricted for this zone'}</span>
                  </div>
                  <button
                    type="button"
                    className="admin-secondary-button"
                    disabled={update.isPending}
                    onClick={() => {
                      setError(null);
                      update.mutate({
                        paymentMethodId: method.id,
                        deliveryZoneId: zone.id,
                        allowed: !allowed,
                        expectedAllowed: rule?.allowed ?? null,
                      });
                    }}
                  >
                    {allowed ? 'Restrict' : 'Allow'}
                  </button>
                </div>
              );
            }),
          )}
        </div>
      ) : null}
    </section>
  );
}
