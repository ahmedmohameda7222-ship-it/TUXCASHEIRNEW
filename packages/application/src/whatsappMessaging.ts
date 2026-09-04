import type { WhatsAppMessage, WhatsAppMessagingTarget } from '@tux/domain';
import type { ApplicationError } from './errors';
import { err, ok, type Result } from './result';
import type { WhatsAppSessionStateSource } from './whatsapp';
import { WhatsAppRemoteError, type WhatsAppRemoteGateway } from './whatsappRemote';

function conflict(message: string): ApplicationError {
  return { code: 'CONFLICT_ERROR', message };
}

function mapRemoteError(error: unknown): ApplicationError {
  if (error instanceof WhatsAppRemoteError) {
    if (error.code === 'OPERATOR_NOT_SYNCHRONIZED' || error.code === 'OUTBOUND_INTENT_CONFLICT') {
      return conflict(error.message);
    }
    if (error.code === 'FREE_FORM_WINDOW_CLOSED') {
      return {
        code: 'WHATSAPP_FREE_FORM_WINDOW_CLOSED',
        message: 'The WhatsApp free-form messaging window has closed.',
      };
    }
  }
  return { code: 'REMOTE_SYNC_ERROR', message: 'WhatsApp remote operation failed.', cause: error };
}

export class OperationsWhatsAppMessagingService {
  readonly #remote: WhatsAppRemoteGateway;
  readonly #session: WhatsAppSessionStateSource;

  constructor(remote: WhatsAppRemoteGateway, session: WhatsAppSessionStateSource) {
    this.#remote = remote;
    this.#session = session;
  }

  async resolveMessagingTarget(input: {
    readonly normalizedPhone: string;
    readonly displayPhone: string;
  }): Promise<Result<WhatsAppMessagingTarget, ApplicationError>> {
    try {
      return ok(await this.#remote.resolveMessagingTarget(input));
    } catch (cause) {
      return err(mapRemoteError(cause));
    }
  }

  async sendTemplate(input: {
    readonly normalizedPhone: string;
    readonly displayPhone: string;
    readonly templateId: string;
    readonly outboundIntentKey: string;
  }): Promise<Result<WhatsAppMessage, ApplicationError>> {
    let state;
    try {
      state = await this.#session.getState();
    } catch (cause) {
      return err({
        code: 'LOCAL_PERSISTENCE_ERROR',
        message: 'Could not read the current Operations session.',
        cause,
      });
    }
    if (!state.ok) return state;
    if (state.value.status !== 'ACTIVE') {
      return err(conflict('An active Current Operator is required for this WhatsApp operation.'));
    }
    try {
      return ok(
        await this.#remote.sendTemplate({
          businessDayId: state.value.businessDayId,
          workerId: state.value.operator.id,
          normalizedPhone: input.normalizedPhone,
          displayPhone: input.displayPhone,
          templateId: input.templateId,
          outboundIntentKey: input.outboundIntentKey,
        }),
      );
    } catch (cause) {
      return err(mapRemoteError(cause));
    }
  }
}
