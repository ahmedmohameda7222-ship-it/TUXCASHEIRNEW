import { EmptyState, ErrorState, LoadingState } from '../components/feedback/AdminStates';
import { useShopScope } from '../shops/ShopScopeProvider';
import { useWhatsApp } from './useWhatsApp';
import { WhatsAppFrame } from './WhatsAppPage';

export function ConversationsPage() {
  const { scope } = useShopScope();
  const shopId = scope.kind === 'shop' ? scope.shopId : undefined;
  const query = useWhatsApp(shopId, 'conversations');
  const data = query.data?.view === 'conversations' ? query.data : undefined;
  return (
    <WhatsAppFrame
      title="Conversations"
      description="Read-only canonical WhatsApp history. Replying remains an Operations responsibility."
    >
      {query.isLoading ? <LoadingState title="Loading conversations" /> : null}
      {query.isError ? (
        <ErrorState
          title="Conversations unavailable"
          description="Try again when the canonical source is available."
        />
      ) : null}
      {data?.rows.length === 0 ? (
        <EmptyState
          title="No conversations"
          description="No canonical conversations exist for this shop."
        />
      ) : null}
      <div className="admin-whatsapp-list">
        {data?.rows.map((row) => (
          <a href={`/whatsapp/conversations/${row.id}`} key={row.id}>
            <strong>{row.displayName}</strong>
            <span>{row.maskedPhone}</span>
            <span>{row.unreadCount} unread</span>
          </a>
        ))}
      </div>
    </WhatsAppFrame>
  );
}
