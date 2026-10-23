import { useShopScope } from '../shops/ShopScopeProvider';
import { useWhatsApp } from './useWhatsApp';
import { WhatsAppFrame } from './WhatsAppPage';
export function TemplatesPage() {
  const { scope } = useShopScope();
  const shopId = scope.kind === 'shop' ? scope.shopId : undefined;
  const q = useWhatsApp(shopId, 'templates');
  const d = q.data?.view === 'templates' ? q.data : undefined;
  return (
    <WhatsAppFrame
      title="Templates"
      description="Actual provider approval state; only approved active templates can power automation."
    >
      <div className="admin-whatsapp-list">
        {d?.rows.map((t) => (
          <article key={t.id}>
            <strong>{t.label}</strong>
            <span>{t.languageCode}</span>
            <span className={`wa-state wa-state--${t.state.toLowerCase()}`}>{t.state}</span>
          </article>
        ))}
      </div>
    </WhatsAppFrame>
  );
}
