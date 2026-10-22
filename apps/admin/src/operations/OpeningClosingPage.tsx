import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { DailyChecklistKind, DailyChecklistWorkspace } from '@tux/admin-contracts';
import { useEffect, useMemo, useState } from 'react';

import { useAdminSession } from '../auth/useAdminSession';
import { EmptyState, ErrorState, LoadingState } from '../components/feedback/AdminStates';
import { PageScaffold } from '../components/layout/PageScaffold';
import { adminFetch } from '../lib/adminApi';
import { useShopScope, useUnsavedShopDraft } from '../shops/ShopScopeProvider';
import './operations.css';

type ChecklistResponse = { view: 'daily-checklist'; checklist: DailyChecklistWorkspace };

export function OpeningClosingPage() {
  const { scope, principal } = useShopScope();
  const session = useAdminSession();
  const client = useQueryClient();
  const shopId = scope.kind === 'shop' ? scope.shopId : undefined;
  const [kind, setKind] = useState<DailyChecklistKind>('OPEN');
  const [doneIds, setDoneIds] = useState<string[]>([]);
  const query = useQuery({
    queryKey: ['admin', 'operations-health', shopId ?? 'no-shop', 'daily-checklist', kind],
    enabled: Boolean(shopId),
    queryFn: () => adminFetch<ChecklistResponse>(`/api/admin/operations-health?${new URLSearchParams({ view: 'daily-checklist', shopId: shopId!, kind })}`),
  });
  const checklist = query.data?.checklist;
  useEffect(() => { setDoneIds(checklist?.items.filter((item) => item.done).map((item) => item.id) ?? []); }, [checklist]);
  const isDirty = Boolean(checklist && !checklist.completedAt && doneIds.some((id) => !checklist.items.find((item) => item.id === id)?.done));
  useUnsavedShopDraft(isDirty);
  const missingRequired = useMemo(() => checklist?.items.filter((item) => item.required && !doneIds.includes(item.id)) ?? [], [checklist, doneIds]);
  const canManage = principal.permissions.includes('devices.manage');
  const complete = useMutation({
    mutationFn: async () => {
      if (!checklist?.businessDayId || !checklist.templateId || !checklist.templateVersion) throw new Error('checklist_not_ready');
      const csrf = session.state.status === 'authenticated' ? session.state.session.csrfToken : undefined;
      return adminFetch<{ ok: true }>('/api/admin/operations-health', { method: 'POST', body: JSON.stringify({ type: 'daily.checklist.complete', shopId, businessDayId: checklist.businessDayId, kind, templateId: checklist.templateId, expectedVersion: checklist.templateVersion, doneItemIds: doneIds, commandId: crypto.randomUUID() }) }, csrf);
    },
    onSuccess: () => void client.invalidateQueries({ queryKey: ['admin', 'operations-health', shopId, 'daily-checklist', kind] }),
  });
  return (
    <PageScaffold eyebrow="Daily operations" title="Opening & closing" description="Operational checklists document completion; they do not open or close the financial business day." primaryAction={<a className="admin-secondary-button" href="/devices">Health overview</a>}>
      {!shopId ? <EmptyState title="Select a shop" description="Daily checklists require one authorized shop." /> : (
        <div className="admin-operations-workspace">
          <div className="admin-checklist-tabs" role="group" aria-label="Checklist kind"><button type="button" aria-pressed={kind === 'OPEN'} onClick={() => setKind('OPEN')}>Opening</button><button type="button" aria-pressed={kind === 'CLOSE'} onClick={() => setKind('CLOSE')}>Closing</button></div>
          {query.isLoading ? <LoadingState title="Loading checklist" /> : null}
          {query.isError ? <ErrorState title="Checklist unavailable" description="The checklist could not be loaded from the authorized source." /> : null}
          {checklist && !checklist.configured ? <EmptyState title="Not configured" description={`No active ${kind.toLowerCase()} checklist template exists for this shop.`} /> : null}
          {checklist?.configured ? <section className="admin-checklist-panel"><header><div><h2>{checklist.templateTitle}</h2><span>{doneIds.length} of {checklist.items.length} checked</span></div>{checklist.completedAt ? <span className="admin-health-state admin-health-state--healthy">Completed</span> : null}</header>{!checklist.businessDayId ? <p className="admin-checklist-warning" role="alert">No canonical business day is available. Completion is blocked.</p> : null}<div className="admin-checklist-items">{checklist.items.map((item) => <label key={item.id}><input type="checkbox" checked={doneIds.includes(item.id)} disabled={!canManage || Boolean(checklist.completedAt)} onChange={(event) => { const checked = event.currentTarget.checked; setDoneIds((current) => checked ? [...new Set([...current, item.id])] : current.filter((id) => id !== item.id)); }} /><span>{item.label}{item.required ? <small>Required</small> : null}</span></label>)}</div><button className="admin-primary-button" type="button" disabled={!canManage || Boolean(checklist.completedAt) || !checklist.businessDayId || missingRequired.length > 0 || complete.isPending} onClick={() => void complete.mutate()}>{complete.isPending ? 'Completing…' : canManage ? 'Complete checklist' : 'Read-only access'}</button>{complete.isError ? <p className="admin-checklist-warning" role="alert">Completion was not saved. Refresh and try again.</p> : null}</section> : null}
        </div>
      )}
    </PageScaffold>
  );
}
