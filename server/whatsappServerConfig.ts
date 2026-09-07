export const WHATSAPP_MEDIA_BUCKET = 'tux-whatsapp-media';
export const WHATSAPP_MEDIA_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

export interface WhatsAppDataServerConfig {
  readonly projectUrl: string;
  readonly serviceRoleKey: string;
}

export interface WhatsAppServerConfig extends WhatsAppDataServerConfig {
  readonly graphVersion: string;
  readonly accessToken: string;
  readonly webhookVerifyToken: string;
  readonly appSecret: string;
}

type Environment = Readonly<Record<string, string | undefined>>;

function firstConfigured(environment: Environment, names: readonly string[]): string | null {
  for (const name of names) {
    const value = environment[name]?.trim();
    if (value) return value;
  }
  return null;
}

export function loadWhatsAppDataServerConfig(
  environment: Environment = process.env,
): WhatsAppDataServerConfig {
  const rawProjectUrl = firstConfigured(environment, ['TUX_SUPABASE_URL', 'SUPABASE_URL']);
  const serviceRoleKey = firstConfigured(environment, [
    'TUX_SUPABASE_SERVICE_ROLE_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
  ]);

  if (rawProjectUrl === null || serviceRoleKey === null) {
    throw new Error('WhatsApp server configuration is incomplete.');
  }

  let projectUrl: string;
  try {
    const url = new URL(rawProjectUrl);
    if (url.protocol !== 'https:') {
      throw new Error('invalid protocol');
    }
    projectUrl = url.origin;
  } catch {
    throw new Error('WhatsApp server configuration is incomplete.');
  }

  return { projectUrl, serviceRoleKey };
}

export function loadWhatsAppServerConfig(
  environment: Environment = process.env,
): WhatsAppServerConfig {
  const dataConfig = loadWhatsAppDataServerConfig(environment);
  const graphVersion = firstConfigured(environment, ['TUX_WHATSAPP_GRAPH_VERSION']);
  const accessToken = firstConfigured(environment, ['TUX_WHATSAPP_ACCESS_TOKEN']);
  const webhookVerifyToken = firstConfigured(environment, ['TUX_WHATSAPP_WEBHOOK_VERIFY_TOKEN']);
  const appSecret = firstConfigured(environment, ['TUX_WHATSAPP_APP_SECRET']);

  if (
    graphVersion === null ||
    accessToken === null ||
    webhookVerifyToken === null ||
    appSecret === null
  ) {
    throw new Error('WhatsApp server configuration is incomplete.');
  }

  return {
    ...dataConfig,
    graphVersion,
    accessToken,
    webhookVerifyToken,
    appSecret,
  };
}
