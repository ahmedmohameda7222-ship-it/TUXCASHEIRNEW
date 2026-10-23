import { useShopScope } from '../shops/ShopScopeProvider';
import { useWhatsApp } from './useWhatsApp';
import { WhatsAppFrame } from './WhatsAppPage';
export function AnalyticsPage() {
  const { scope } = useShopScope();
  const shopId = scope.kind === 'shop' ? scope.shopId : undefined;
  const q = useWhatsApp(shopId, 'analytics');
  const d = q.data?.view === 'analytics' ? q.data : undefined;
  return (
    <WhatsAppFrame
      title="Analytics"
      description="Aggregates from canonical messages and intents; unavailable metrics are never estimated."
    >
      {d && !d.available ? (
        <p className="admin-whatsapp-banner">
          Analytics unavailable until canonical activity exists.
        </p>
      ) : null}
      <div className="admin-whatsapp-grid">
        {d
          ? Object.entries({
              Sent: d.sent,
              Delivered: d.delivered,
              Read: d.read,
              Failed: d.failed,
              Uncertain: d.uncertain,
              'Response time': d.responseTimeMinutes,
            }).map(([k, v]) => (
              <article key={k}>
                <span>{k}</span>
                <strong>{v ?? 'Unavailable'}</strong>
              </article>
            ))
          : null}
      </div>
    </WhatsAppFrame>
  );
}
