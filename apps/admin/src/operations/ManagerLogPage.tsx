import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ManagerLogPage as ManagerLogData } from '@tux/admin-contracts';
import { useState } from 'react';

import { useAdminSession } from '../auth/useAdminSession';
import { EmptyState, ErrorState, LoadingState } from '../components/feedback/AdminStates';
import { PageScaffold } from '../components/layout/PageScaffold';
import { adminFetch } from '../lib/adminApi';
import { useShopScope, useUnsavedShopDraft } from '../shops/ShopScopeProvider';
import './operations.css';

type LogResponse = { view: 'manager-log'; page: ManagerLogData };

export function ManagerLogPage() {
  const { scope, principal } = useShopScope();
  const session = useAdminSession();
  const client = useQueryClient();
  const shopId = scope.kind === 'shop' ? scope.shopId : undefined;
  const [note, setNote] = useState('');
  useUnsavedShopDraft(note.trim().length > 0);
  const canManage = principal.permissions.includes('devices.manage');
  const query = useQuery({ queryKey: ['admin', 'operations-health', shopId ?? 'no-shop', 'manager-log'], enabled: Boolean(shopId), queryFn: () => adminFetch<LogResponse>(`/api/admin/operations-health?${new URLSearchParams({ view: 'manager-log', shopId: shopId!, limit: '25' })}`) });
  const append = useMutation({ mutationFn: async () => { const csrf = session.state.status === 'authenticated' ? session.state.session.csrfToken : undefined; return adminFetch<{ ok: true }>('/api/admin/operations-health', { method: 'POST', body: JSON.stringify({ type: 'daily.manager-note.append', shopId, note, correctionOfId: null, commandId: crypto.randomUUID() }) }, csrf); }, onSuccess: async () => { setNote(''); await client.invalidateQueries({ queryKey: ['admin', 'operations-health', shopId, 'manager-log'] }); } });
  const rows = query.data?.page.rows ?? [];
  return (
    <PageScaffold eyebrow="Daily operations" title="Manager log" description="Append-only operational notes for the selected shop. Corrections create a new linked entry." primaryAction={<a className="admin-secondary-button" href="/devices">Health overview</a>}>
      {!shopId ? <EmptyState title="Select a shop" description="Manager notes require one authorized shop." /> : <div className="admin-operations-workspace"><form className="admin-manager-note" onSubmit={(event) => { event.preventDefault(); void append.mutate(); }}><label className="admin-field"><span>New note</span><textarea value={note} maxLength={2000} rows={5} disabled={!canManage} onChange={(event) => setNote(event.currentTarget.value)} placeholder={canManage ? 'Record an operational handoff or exception' : 'Read-only access'} /></label><div><span>{note.length} / 2,000</span><button className="admin-primary-button" type="submit" disabled={!canManage || !note.trim() || /[\u0000-\u001f\u007f<>]/u.test(note) || append.isPending}>{append.isPending ? 'Saving…' : 'Append note'}</button></div>{append.isError ? <p className="admin-checklist-warning" role="alert">Note was not appended. Review the text and retry.</p> : null}</form>{query.isLoading ? <LoadingState title="Loading manager log" /> : null}{query.isError ? <ErrorState title="Manager log unavailable" description="No notes are shown while the source is unavailable." /> : null}{!query.isLoading && !query.isError && rows.length === 0 ? <EmptyState title="No manager notes" description="The append-only log has no entries for this shop." /> : null}<div className="admin-manager-log">{rows.map((entry) => <article key={entry.id}><p>{entry.note}</p><footer><time dateTime={entry.createdAt}>{new Date(entry.createdAt).toLocaleString()}</time><span>Author {entry.authorEmployeeId}</span>{entry.correctionOfId ? <span>Correction of {entry.correctionOfId}</span> : null}</footer></article>)}</div></div>}
    </PageScaffold>
  );
}
