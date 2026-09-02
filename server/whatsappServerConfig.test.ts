import { describe, expect, it } from 'vitest';
import { loadWhatsAppServerConfig } from './whatsappServerConfig';

describe('loadWhatsAppServerConfig', () => {
  it('loads server-only config without a phone-number routing env', () => {
    const config = loadWhatsAppServerConfig({
      TUX_SUPABASE_URL: 'https://example.supabase.co',
      TUX_SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
      TUX_WHATSAPP_GRAPH_VERSION: 'v99.0',
      TUX_WHATSAPP_ACCESS_TOKEN: 'test-meta-token',
      TUX_WHATSAPP_WEBHOOK_VERIFY_TOKEN: 'test-verify-token',
      TUX_WHATSAPP_APP_SECRET: 'test-app-secret',
    });

    expect(config).toMatchObject({
      projectUrl: 'https://example.supabase.co',
      graphVersion: 'v99.0',
    });
    expect('phoneNumberId' in config).toBe(false);
  });

  it('rejects missing trusted Supabase service credentials', () => {
    expect(() =>
      loadWhatsAppServerConfig({
        TUX_SUPABASE_URL: 'https://example.supabase.co',
        TUX_WHATSAPP_GRAPH_VERSION: 'v99.0',
        TUX_WHATSAPP_ACCESS_TOKEN: 'test-meta-token',
        TUX_WHATSAPP_WEBHOOK_VERIFY_TOKEN: 'test-verify-token',
        TUX_WHATSAPP_APP_SECRET: 'test-app-secret',
      }),
    ).toThrow('WhatsApp server configuration is incomplete.');
  });
});
