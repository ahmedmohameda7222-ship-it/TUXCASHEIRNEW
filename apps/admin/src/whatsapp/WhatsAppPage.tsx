import type { ReactNode } from 'react';

import { EmptyState, ErrorState, LoadingState } from '../components/feedback/AdminStates';
import { PageScaffold } from '../components/layout/PageScaffold';
import { useShopScope } from '../shops/ShopScopeProvider';
import { useWhatsApp } from './useWhatsApp';
import './whatsapp.css';

const NAV = [
  ['Overview', '/whatsapp'], ['Conversations', '/whatsapp/conversations'], ['Templates', '/whatsapp/templates'],
  ['Quick Replies', '/whatsapp/quick-replies'], ['Automatic Messages', '/whatsapp/automatic-messages'],
  ['Analytics', '/whatsapp/analytics'], ['Channels', '/whatsapp/channels'], ['Health', '/whatsapp/health'],
] as const;

export function WhatsAppFrame({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return <PageScaffold eyebrow="Messaging control" title={title} description={description}>
    <nav className="admin-whatsapp-nav" aria-label="WhatsApp administration">{NAV.map(([label, href]) => <a href={href} key={href}>{label}</a>)}</nav>
    {children}
  </PageScaffold>;
}

export function WhatsAppPage() {
  const { scope } = useShopScope();
  const shopId = scope.kind === 'shop' ? scope.shopId : undefined;
  const query = useWhatsApp(shopId, 'overview');
  const data = query.data?.view === 'overview' ? query.data : undefined;
  return <WhatsAppFrame title="WhatsApp" description="Canonical messaging health, activity and configuration for the selected shop.">
    {!shopId ? <EmptyState title="Select a shop" description="WhatsApp administration requires one authorized shop." /> : null}
    {query.isLoading ? <LoadingState title="Loading WhatsApp control center" /> : null}
    {query.isError ? <ErrorState title="WhatsApp data unavailable" description="No connection or activity state is inferred while sources are unavailable." /> : null}
    {data ? <div className="admin-whatsapp-grid" data-testid="whatsapp-overview">
      <article><span>Channel</span><strong>{data.configured ? 'Configured' : 'Not configured'}</strong></article>
      <article><span>Health</span><strong>{data.health.charAt(0) + data.health.slice(1).toLowerCase()}</strong></article>
      <article><span>Automation</span><strong>{data.automationEnabled ? 'On' : 'Off'}</strong></article>
      <article><span>Conversations</span><strong>{data.totals.conversations}</strong></article>
      <article><span>Failed</span><strong>{data.totals.failed}</strong></article>
      <article><span>Uncertain</span><strong>{data.totals.uncertain}</strong></article>
      <article><span>Approved templates</span><strong>{data.totals.approvedTemplates}</strong></article>
      <article><span>Recent activity</span><strong>{data.recentActivityAt ? new Date(data.recentActivityAt).toLocaleString() : 'Unavailable'}</strong></article>
    </div> : null}
  </WhatsAppFrame>;
}
