import type {
  BusinessDayId,
  WhatsAppLocationPayload,
  WhatsAppMessage,
  WhatsAppMessagingTarget,
  WorkerId,
} from '@tux/domain';
import type { ApplicationError } from './errors';
import { err, ok, type Result } from './result';
import type { WhatsAppSessionStateSource } from './whatsapp';
import {
  WhatsAppRemoteError,
  type WhatsAppMediaAccess,
  type WhatsAppOutboundBinary,
  type WhatsAppRemoteGateway,
} from './whatsappRemote';

interface ActiveMessagingClaims {
  readonly businessDayId: BusinessDayId;
  readonly workerId: WorkerId;
}

function conflict(message: string): ApplicationError {
  return { code: 'CONFLICT_ERROR', message };
}

function validation(message: string): ApplicationError {
  return { code: 'VALIDATION_ERROR', message };
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

function validLocation(location: WhatsAppLocationPayload): boolean {
  return (
    Number.isFinite(location.latitude) &&
    location.latitude >= -90 &&
    location.latitude <= 90 &&
    Number.isFinite(location.longitude) &&
    location.longitude >= -180 &&
    location.longitude <= 180
  );
}

export class OperationsWhatsAppMessagingService {
  readonly #remote: WhatsAppRemoteGateway;
  readonly #session: WhatsAppSessionStateSource;

  constructor(remote: WhatsAppRemoteGateway, session: WhatsAppSessionStateSource) {
    this.#remote = remote;
    this.#session = session;
  }

  async #activeClaims(): Promise<Result<ActiveMessagingClaims, ApplicationError>> {
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
    return ok({
      businessDayId: state.value.businessDayId,
      workerId: state.value.operator.id,
    });
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

  async sendMedia(input: {
    readonly conversationId: string;
    readonly outboundIntentKey: string;
    readonly media: WhatsAppOutboundBinary;
  }): Promise<Result<WhatsAppMessage, ApplicationError>> {
    const claims = await this.#activeClaims();
    if (!claims.ok) return claims;
    try {
      return ok(
        await this.#remote.sendMedia({
          ...claims.value,
          conversationId: input.conversationId,
          outboundIntentKey: input.outboundIntentKey,
          media: input.media,
        }),
      );
    } catch (cause) {
      return err(mapRemoteError(cause));
    }
  }

  async sendLocation(input: {
    readonly conversationId: string;
    readonly outboundIntentKey: string;
    readonly location: WhatsAppLocationPayload;
  }): Promise<Result<WhatsAppMessage, ApplicationError>> {
    if (!validLocation(input.location)) {
      return err(validation('WhatsApp location coordinates are invalid.'));
    }
    const claims = await this.#activeClaims();
    if (!claims.ok) return claims;
    try {
      return ok(
        await this.#remote.sendLocation({
          ...claims.value,
          conversationId: input.conversationId,
          outboundIntentKey: input.outboundIntentKey,
          location: input.location,
        }),
      );
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
    const claims = await this.#activeClaims();
    if (!claims.ok) return claims;
    try {
      return ok(
        await this.#remote.sendTemplate({
          ...claims.value,
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

  async retryFailedMessage(input: {
    readonly messageId: string;
    readonly outboundIntentKey: string;
  }): Promise<Result<WhatsAppMessage, ApplicationError>> {
    const claims = await this.#activeClaims();
    if (!claims.ok) return claims;
    try {
      return ok(
        await this.#remote.retryFailedMessage({
          ...claims.value,
          messageId: input.messageId,
          outboundIntentKey: input.outboundIntentKey,
        }),
      );
    } catch (cause) {
      return err(mapRemoteError(cause));
    }
  }

  async getMediaAccess(
    messageId: string,
  ): Promise<Result<WhatsAppMediaAccess, ApplicationError>> {
    try {
      return ok(await this.#remote.getMediaAccess(messageId));
    } catch (cause) {
      return err(mapRemoteError(cause));
    }
  }
}
