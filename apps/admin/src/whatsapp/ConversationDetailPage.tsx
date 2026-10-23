import { ErrorState, LoadingState } from '../components/feedback/AdminStates';
import { useShopScope } from '../shops/ShopScopeProvider';
import { useWhatsApp } from './useWhatsApp';
import { WhatsAppFrame } from './WhatsAppPage';

export function ConversationDetailPage({ conversationId }: { conversationId: string }) {
  const { scope } = useShopScope();
  const shopId = scope.kind === 'shop' ? scope.shopId : undefined;
  const query = useWhatsApp(shopId, 'conversation', conversationId);
  const data = query.data?.view === 'conversation' ? query.data : undefined;
  return (
    <WhatsAppFrame
      title={data?.conversation.displayName ?? 'Conversation'}
      description="Read-only message history with immutable worker and system attribution."
    >
      {query.isLoading ? <LoadingState title="Loading message history" /> : null}
      {query.isError ? (
        <ErrorState
          title="Conversation unavailable"
          description="This conversation may be outside the selected shop."
        />
      ) : null}
      {data ? (
        <>
          <header className="admin-whatsapp-contact">
            <strong>{data.conversation.maskedPhone}</strong>
            {data.customerId ? <a href={`/customers/${data.customerId}`}>Customer</a> : null}
            {data.orderIds.map((id) => (
              <a href={`/orders/${id}`} key={id}>
                Order
              </a>
            ))}
          </header>
          <div className="admin-whatsapp-messages" aria-label="Message history">
            {data.messages.map((message) => (
              <article key={message.id}>
                <header>
                  <strong>{message.author}</strong>
                  <span>
                    {message.kind} · {message.status}
                  </span>
                </header>
                <p>{message.text ?? `${message.kind} message`}</p>
                {message.failureCode ? <small>Failure: {message.failureCode}</small> : null}
              </article>
            ))}
          </div>
        </>
      ) : null}
    </WhatsAppFrame>
  );
}
