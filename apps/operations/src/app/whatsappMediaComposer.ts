import type { WhatsAppOutboundBinary } from '@tux/application';
import type {
  WhatsAppLocationPayload,
  WhatsAppShopMessagingConfig,
} from '@tux/domain';

export type WhatsAppMediaComposerState =
  | { readonly kind: 'IDLE' }
  | {
      readonly kind: 'FILE_READY';
      readonly mediaKind: WhatsAppOutboundBinary['kind'];
      readonly fileName: string;
      readonly mimeType: string;
      readonly bytes: Uint8Array;
      readonly previewUrl: string | null;
    }
  | { readonly kind: 'RECORDING'; readonly startedAtMs: number }
  | {
      readonly kind: 'AUDIO_READY';
      readonly bytes: Uint8Array;
      readonly mimeType: string;
      readonly previewUrl: string;
    }
  | { readonly kind: 'ERROR'; readonly message: string };

export interface WhatsAppAudioRecording {
  stop(): Promise<{ readonly bytes: Uint8Array; readonly mimeType: string }>;
  cancel(): void;
}

export interface WhatsAppMediaComposerEnvironment {
  readonly nowMs: () => number;
  readonly createObjectUrl: (input: {
    readonly bytes: Uint8Array;
    readonly mimeType: string;
  }) => string;
  readonly revokeObjectUrl: (url: string) => void;
  readonly startAudioRecording: () => Promise<WhatsAppAudioRecording>;
  readonly getCurrentLocation: () => Promise<WhatsAppLocationPayload>;
}

interface MediaPolicy {
  readonly kind: WhatsAppOutboundBinary['kind'];
  readonly maxBytes: number;
  readonly preview: boolean;
}

const IMAGE_MAX_BYTES = 5 * 1024 * 1024;
const AUDIO_MAX_BYTES = 16 * 1024 * 1024;
const DOCUMENT_MAX_BYTES = 100 * 1024 * 1024;

const MEDIA_POLICY = new Map<string, MediaPolicy>([
  ['image/jpeg', { kind: 'IMAGE', maxBytes: IMAGE_MAX_BYTES, preview: true }],
  ['image/png', { kind: 'IMAGE', maxBytes: IMAGE_MAX_BYTES, preview: true }],
  ['audio/aac', { kind: 'AUDIO', maxBytes: AUDIO_MAX_BYTES, preview: true }],
  ['audio/amr', { kind: 'AUDIO', maxBytes: AUDIO_MAX_BYTES, preview: true }],
  ['audio/mpeg', { kind: 'AUDIO', maxBytes: AUDIO_MAX_BYTES, preview: true }],
  ['audio/mp4', { kind: 'AUDIO', maxBytes: AUDIO_MAX_BYTES, preview: true }],
  ['audio/ogg', { kind: 'AUDIO', maxBytes: AUDIO_MAX_BYTES, preview: true }],
  ['text/plain', { kind: 'DOCUMENT', maxBytes: DOCUMENT_MAX_BYTES, preview: false }],
  ['application/pdf', { kind: 'DOCUMENT', maxBytes: DOCUMENT_MAX_BYTES, preview: false }],
  ['application/msword', { kind: 'DOCUMENT', maxBytes: DOCUMENT_MAX_BYTES, preview: false }],
  [
    'application/vnd.ms-excel',
    { kind: 'DOCUMENT', maxBytes: DOCUMENT_MAX_BYTES, preview: false },
  ],
  [
    'application/vnd.ms-powerpoint',
    { kind: 'DOCUMENT', maxBytes: DOCUMENT_MAX_BYTES, preview: false },
  ],
  [
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    { kind: 'DOCUMENT', maxBytes: DOCUMENT_MAX_BYTES, preview: false },
  ],
  [
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    { kind: 'DOCUMENT', maxBytes: DOCUMENT_MAX_BYTES, preview: false },
  ],
  [
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    { kind: 'DOCUMENT', maxBytes: DOCUMENT_MAX_BYTES, preview: false },
  ],
]);

export type WhatsAppStoreLocationAction =
  | {
      readonly enabled: true;
      readonly location: WhatsAppLocationPayload;
      readonly message: null;
    }
  | {
      readonly enabled: false;
      readonly location: null;
      readonly message: string;
    };

export type WhatsAppCurrentLocationResult =
  | { readonly ok: true; readonly location: WhatsAppLocationPayload }
  | { readonly ok: false; readonly message: string };

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

export class WhatsAppMediaComposer {
  readonly #environment: WhatsAppMediaComposerEnvironment;
  #state: WhatsAppMediaComposerState = { kind: 'IDLE' };
  #recording: WhatsAppAudioRecording | null = null;

  constructor(environment: WhatsAppMediaComposerEnvironment) {
    this.#environment = environment;
  }

  getState(): WhatsAppMediaComposerState {
    return this.#state;
  }

  getReadyMedia(): WhatsAppOutboundBinary | null {
    if (this.#state.kind === 'FILE_READY') {
      return {
        kind: this.#state.mediaKind,
        bytes: this.#state.bytes,
        mimeType: this.#state.mimeType,
        fileName: this.#state.fileName,
      };
    }
    if (this.#state.kind === 'AUDIO_READY') {
      return {
        kind: 'AUDIO',
        bytes: this.#state.bytes,
        mimeType: this.#state.mimeType,
        fileName: null,
      };
    }
    return null;
  }

  selectFile(input: {
    readonly bytes: Uint8Array;
    readonly mimeType: string;
    readonly fileName: string;
  }): void {
    this.#clearTransientState();
    const policy = MEDIA_POLICY.get(input.mimeType.toLowerCase());
    if (policy === undefined) {
      this.#state = {
        kind: 'ERROR',
        message: 'This file type is not supported for WhatsApp.',
      };
      return;
    }
    if (input.bytes.byteLength > policy.maxBytes) {
      this.#state = { kind: 'ERROR', message: 'This file is too large for WhatsApp.' };
      return;
    }

    const previewUrl = policy.preview
      ? this.#environment.createObjectUrl({ bytes: input.bytes, mimeType: input.mimeType })
      : null;
    this.#state = {
      kind: 'FILE_READY',
      mediaKind: policy.kind,
      fileName: input.fileName,
      mimeType: input.mimeType,
      bytes: input.bytes,
      previewUrl,
    };
  }

  async startRecording(): Promise<void> {
    this.#clearTransientState();
    try {
      this.#recording = await this.#environment.startAudioRecording();
      this.#state = { kind: 'RECORDING', startedAtMs: this.#environment.nowMs() };
    } catch {
      this.#recording = null;
      this.#state = { kind: 'ERROR', message: 'Microphone access is unavailable.' };
    }
  }

  async stopRecording(): Promise<void> {
    const recording = this.#recording;
    if (this.#state.kind !== 'RECORDING' || recording === null) return;
    this.#recording = null;

    try {
      const captured = await recording.stop();
      const policy = MEDIA_POLICY.get(captured.mimeType.toLowerCase());
      if (policy?.kind !== 'AUDIO') {
        this.#state = {
          kind: 'ERROR',
          message: 'This audio format is not supported for WhatsApp.',
        };
        return;
      }
      if (captured.bytes.byteLength > policy.maxBytes) {
        this.#state = { kind: 'ERROR', message: 'This audio is too large for WhatsApp.' };
        return;
      }
      const previewUrl = this.#environment.createObjectUrl(captured);
      this.#state = {
        kind: 'AUDIO_READY',
        bytes: captured.bytes,
        mimeType: captured.mimeType,
        previewUrl,
      };
    } catch {
      this.#state = { kind: 'ERROR', message: 'Voice recording could not be completed.' };
    }
  }

  cancel(): void {
    this.#clearTransientState();
    this.#state = { kind: 'IDLE' };
  }

  dispose(): void {
    this.cancel();
  }

  resolveStoreLocation(
    storeLocation: WhatsAppShopMessagingConfig['storeLocation'],
  ): WhatsAppStoreLocationAction {
    if (storeLocation === null) {
      return {
        enabled: false,
        location: null,
        message: 'Store location is not configured.',
      };
    }
    const location: WhatsAppLocationPayload = {
      latitude: storeLocation.latitude,
      longitude: storeLocation.longitude,
      name: storeLocation.label,
      address: storeLocation.address,
    };
    if (!validLocation(location)) {
      return {
        enabled: false,
        location: null,
        message: 'Store location is not configured.',
      };
    }
    return { enabled: true, location, message: null };
  }

  async requestCurrentLocation(): Promise<WhatsAppCurrentLocationResult> {
    try {
      const location = await this.#environment.getCurrentLocation();
      if (!validLocation(location)) {
        return { ok: false, message: 'Current location is unavailable.' };
      }
      return { ok: true, location };
    } catch {
      return { ok: false, message: 'Current location is unavailable.' };
    }
  }

  #clearTransientState(): void {
    if (this.#recording !== null) {
      this.#recording.cancel();
      this.#recording = null;
    }
    const previewUrl =
      this.#state.kind === 'FILE_READY' || this.#state.kind === 'AUDIO_READY'
        ? this.#state.previewUrl
        : null;
    if (previewUrl !== null) this.#environment.revokeObjectUrl(previewUrl);
  }
}
