import { useShopScope } from '../shops/ShopScopeProvider';
import { useWhatsApp } from './useWhatsApp';
import { WhatsAppFrame } from './WhatsAppPage';
export function WhatsAppHealthPage() {
  const { scope } = useShopScope();
  const shopId = scope.kind === 'shop' ? scope.shopId : undefined;
  const q = useWhatsApp(shopId, 'health');
  const d = q.data?.view === 'health' ? q.data : undefined;
  return (
    <WhatsAppFrame
      title="WhatsApp Health"
      description="Observed provider-channel signals. Unknown never means healthy."
    >
      {d ? (
        <dl className="admin-whatsapp-health">
          <div>
            <dt>Connection</dt>
            <dd>{d.configured ? 'Configured' : 'Not configured'}</dd>
          </div>
          <div>
            <dt>State</dt>
            <dd>{d.state}</dd>
          </div>
          <div>
            <dt>Last webhook</dt>
            <dd>{d.lastWebhookAt ?? 'Unavailable'}</dd>
          </div>
          <div>
            <dt>Last outbound</dt>
            <dd>{d.lastOutboundAt ?? 'Unavailable'}</dd>
          </div>
          <div>
            <dt>Last error</dt>
            <dd>{d.lastErrorCode ?? 'None observed'}</dd>
          </div>
        </dl>
      ) : null}
    </WhatsAppFrame>
  );
}
