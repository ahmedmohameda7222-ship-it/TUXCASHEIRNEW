import { randomUUID } from 'node:crypto';
import { WhatsAppProviderError, type WhatsAppProviderGateway } from './whatsappProviderGateway.js';
import type { WhatsAppDataServerConfig } from './whatsappServerConfig.js';

export interface WhatsAppEventLease {
  readonly intentId: string;
  readonly leaseToken: string;
}

export interface PreparedWhatsAppEventMessage {
  readonly intentId: string;
  readonly messageId: string;
  readonly shopId: string;
  readonly providerPhoneNumberId: string;
  readonly recipientNormalizedPhone: string;
  readonly providerTemplateName: string;
  readonly languageCode: string;
  readonly variables: readonly string[];
}

export interface WhatsAppEventMessagingRepository {
  leasePending(input: {
    readonly workerId: string;
    readonly leaseToken: string;
    readonly limit: number;
    readonly leaseSeconds: number;
  }): Promise<readonly WhatsAppEventLease[]>;
  beginProviderAttempt(input: WhatsAppEventLease): Promise<PreparedWhatsAppEventMessage | null>;
  completeProviderAttempt(
    input: WhatsAppEventLease & {
      readonly outcome: 'SENT' | 'FAILED' | 'UNCERTAIN';
      readonly providerMessageId: string | null;
      readonly errorCode: string | null;
    },
  ): Promise<void>;
}

export interface WhatsAppEventMessagingDependencies {
  readonly repository: WhatsAppEventMessagingRepository;
  readonly provider: Pick<WhatsAppProviderGateway, 'sendMessage'>;
  readonly workerId: string;
  readonly leaseToken?: () => string;
}

export interface WhatsAppEventDispatchSummary {
  readonly claimed: number;
  readonly sent: number;
  readonly failed: number;
  readonly uncertain: number;
  readonly skipped: number;
}

export async function dispatchPendingWhatsAppEventMessages(
  dependencies: WhatsAppEventMessagingDependencies,
): Promise<WhatsAppEventDispatchSummary> {
  const leaseToken = dependencies.leaseToken?.() ?? randomUUID();
  const leases = await dependencies.repository.leasePending({
    workerId: dependencies.workerId,
    leaseToken,
    limit: 25,
    leaseSeconds: 60,
  });
  let sent = 0;
  let failed = 0;
  let uncertain = 0;
  let skipped = 0;

  for (const lease of leases) {
    const prepared = await dependencies.repository.beginProviderAttempt(lease);
    if (prepared === null) {
      skipped += 1;
      continue;
    }
    try {
      const result = await dependencies.provider.sendMessage({
        providerPhoneNumberId: prepared.providerPhoneNumberId,
        to: prepared.recipientNormalizedPhone,
        kind: 'TEMPLATE',
        providerTemplateName: prepared.providerTemplateName,
        languageCode: prepared.languageCode,
        variables: prepared.variables,
      });
      await dependencies.repository.completeProviderAttempt({
        ...lease,
        outcome: 'SENT',
        providerMessageId: result.providerMessageId,
        errorCode: null,
      });
      sent += 1;
    } catch (error) {
      const deterministic =
        error instanceof WhatsAppProviderError &&
        error.httpStatus !== null &&
        error.httpStatus >= 400 &&
        error.httpStatus < 500;
      const outcome = deterministic ? ('FAILED' as const) : ('UNCERTAIN' as const);
      const errorCode = deterministic
        ? error.providerCode === null
          ? `HTTP_${error.httpStatus}`
          : String(error.providerCode)
        : 'PROVIDER_OUTCOME_UNKNOWN';
      try {
        await dependencies.repository.completeProviderAttempt({
          ...lease,
          outcome,
          providerMessageId: null,
          errorCode,
        });
      } catch {
        // The durable provider-attempt marker prevents a blind retry even when
        // completion persistence is temporarily unavailable.
      }
      if (deterministic) failed += 1;
      else uncertain += 1;
    }
  }
  return { claimed: leases.length, sent, failed, uncertain, skipped };
}

type JsonRecord = Readonly<Record<string, unknown>>;

function record(value: unknown): JsonRecord | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

function requiredString(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '')
    throw new Error('invalid_whatsapp_event_dispatch_response');
  return value.trim();
}

export class SupabaseWhatsAppEventMessagingRepository implements WhatsAppEventMessagingRepository {
  constructor(
    private readonly config: WhatsAppDataServerConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async #rpc(name: string, payload: JsonRecord): Promise<unknown> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.config.projectUrl}/rest/v1/rpc/${name}`, {
        method: 'POST',
        headers: {
          apikey: this.config.serviceRoleKey,
          authorization: `Bearer ${this.config.serviceRoleKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(payload),
      });
    } catch {
      throw new Error('whatsapp_event_repository_unavailable');
    }
    const text = await response.text();
    if (!response.ok) throw new Error('whatsapp_event_repository_rejected');
    return text === '' ? null : (JSON.parse(text) as unknown);
  }

  async leasePending(input: {
    readonly workerId: string;
    readonly leaseToken: string;
    readonly limit: number;
    readonly leaseSeconds: number;
  }): Promise<readonly WhatsAppEventLease[]> {
    const result = await this.#rpc('lease_whatsapp_event_send_intents_v2', {
      p_lease_owner: input.workerId,
      p_lease_token: input.leaseToken,
      p_limit: input.limit,
      p_lease_seconds: input.leaseSeconds,
    });
    if (!Array.isArray(result)) throw new Error('invalid_whatsapp_event_dispatch_response');
    return result.map((value) => {
      const row = record(value);
      if (row === null) throw new Error('invalid_whatsapp_event_dispatch_response');
      return {
        intentId: requiredString(row['intent_id']),
        leaseToken: requiredString(row['lease_token']),
      };
    });
  }

  async beginProviderAttempt(
    input: WhatsAppEventLease,
  ): Promise<PreparedWhatsAppEventMessage | null> {
    const result = await this.#rpc('begin_whatsapp_event_provider_attempt_v1', {
      p_intent_id: input.intentId,
      p_lease_token: input.leaseToken,
    });
    if (!Array.isArray(result) || result.length === 0) return null;
    if (result.length !== 1) throw new Error('invalid_whatsapp_event_dispatch_response');
    const row = record(result[0]);
    if (row === null || !Array.isArray(row['variables']))
      throw new Error('invalid_whatsapp_event_dispatch_response');
    return {
      intentId: requiredString(row['intent_id']),
      messageId: requiredString(row['message_id']),
      shopId: requiredString(row['shop_id']),
      providerPhoneNumberId: requiredString(row['provider_phone_number_id']),
      recipientNormalizedPhone: requiredString(row['recipient_normalized_phone']),
      providerTemplateName: requiredString(row['provider_template_name']),
      languageCode: requiredString(row['language_code']),
      variables: row['variables'].map(requiredString),
    };
  }

  async completeProviderAttempt(
    input: WhatsAppEventLease & {
      readonly outcome: 'SENT' | 'FAILED' | 'UNCERTAIN';
      readonly providerMessageId: string | null;
      readonly errorCode: string | null;
    },
  ): Promise<void> {
    await this.#rpc('complete_whatsapp_event_provider_attempt_v1', {
      p_intent_id: input.intentId,
      p_lease_token: input.leaseToken,
      p_outcome: input.outcome,
      p_provider_message_id: input.providerMessageId,
      p_error_code: input.errorCode,
    });
  }
}
