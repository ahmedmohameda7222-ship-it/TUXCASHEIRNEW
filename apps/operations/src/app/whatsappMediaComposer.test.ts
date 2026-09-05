import type { WhatsAppLocationPayload } from '@tux/domain';
import { describe, expect, it, vi } from 'vitest';
import {
  WhatsAppMediaComposer,
  type WhatsAppAudioRecording,
  type WhatsAppMediaComposerEnvironment,
} from './whatsappMediaComposer';

function location(
  latitude = 30.0444,
  longitude = 31.2357,
): WhatsAppLocationPayload {
  return {
    latitude,
    longitude,
    name: 'TUX Store',
    address: 'Cairo',
  };
}

class TestEnvironment implements WhatsAppMediaComposerEnvironment {
  now = 1_000;
  objectUrlCounter = 0;
  currentLocation = location();
  currentLocationError: Error | null = null;
  recordingError: Error | null = null;

  readonly createdUrls: string[] = [];
  readonly revokedUrls: string[] = [];
  readonly cancelledRecordings: string[] = [];
  readonly stoppedRecordings: string[] = [];

  nextRecordingBytes = new Uint8Array([0x4f, 0x67, 0x67, 0x53]);
  nextRecordingMimeType = 'audio/ogg';

  readonly nowMs = () => this.now;

  readonly createObjectUrl = (input: {
    readonly bytes: Uint8Array;
    readonly mimeType: string;
  }): string => {
    expect(input.bytes).toBeInstanceOf(Uint8Array);
    expect(input.mimeType.length).toBeGreaterThan(0);
    const url = `blob:tux-${++this.objectUrlCounter}`;
    this.createdUrls.push(url);
    return url;
  };

  readonly revokeObjectUrl = (url: string): void => {
    this.revokedUrls.push(url);
  };

  readonly startAudioRecording = async (): Promise<WhatsAppAudioRecording> => {
    if (this.recordingError !== null) throw this.recordingError;
    const id = `recording-${this.objectUrlCounter + this.stoppedRecordings.length + 1}`;
    return {
      stop: async () => {
        this.stoppedRecordings.push(id);
        return {
          bytes: this.nextRecordingBytes,
          mimeType: this.nextRecordingMimeType,
        };
      },
      cancel: () => {
        this.cancelledRecordings.push(id);
      },
    };
  };

  readonly getCurrentLocation = async (): Promise<WhatsAppLocationPayload> => {
    if (this.currentLocationError !== null) throw this.currentLocationError;
    return this.currentLocation;
  };
}

function mediaInput(overrides: {
  readonly bytes?: Uint8Array;
  readonly mimeType?: string;
  readonly fileName?: string;
} = {}) {
  return {
    bytes: overrides.bytes ?? new Uint8Array([0xff, 0xd8, 0xff]),
    mimeType: overrides.mimeType ?? 'image/jpeg',
    fileName: overrides.fileName ?? 'photo.jpg',
  };
}

describe('WhatsAppMediaComposer transient file state', () => {
  it.each([
    ['image/jpeg', 'photo.jpg', 'IMAGE', true],
    ['application/pdf', 'menu.pdf', 'DOCUMENT', false],
    ['audio/ogg', 'note.ogg', 'AUDIO', true],
  ] as const)(
    'classifies %s as %s media without persisting it',
    (mimeType, fileName, mediaKind, hasPreview) => {
      const environment = new TestEnvironment();
      const composer = new WhatsAppMediaComposer(environment);

      composer.selectFile(mediaInput({ mimeType, fileName }));

      expect(composer.getState()).toMatchObject({
        kind: 'FILE_READY',
        mediaKind,
        fileName,
        mimeType,
        previewUrl: hasPreview ? 'blob:tux-1' : null,
      });
      expect(composer.getReadyMedia()).toMatchObject({ kind: mediaKind, mimeType, fileName });
      expect(composer.getReadyMedia()?.bytes).toBe(mediaInput({ mimeType, fileName }).bytes);
      expect(environment.createdUrls).toHaveLength(hasPreview ? 1 : 0);
    },
  );

  it('rejects unsupported and oversized selections before they become sendable', () => {
    const environment = new TestEnvironment();
    const composer = new WhatsAppMediaComposer(environment);

    composer.selectFile(mediaInput({ mimeType: 'image/webp', fileName: 'unsupported.webp' }));
    expect(composer.getState()).toEqual({
      kind: 'ERROR',
      message: 'This file type is not supported for WhatsApp.',
    });
    expect(composer.getReadyMedia()).toBeNull();

    composer.selectFile(
      mediaInput({
        mimeType: 'image/jpeg',
        fileName: 'too-large.jpg',
        bytes: new Uint8Array(5 * 1024 * 1024 + 1),
      }),
    );
    expect(composer.getState()).toEqual({
      kind: 'ERROR',
      message: 'This file is too large for WhatsApp.',
    });
    expect(environment.createdUrls).toEqual([]);
  });

  it('revokes object URLs when replacing, cancelling, and disposing transient previews', () => {
    const environment = new TestEnvironment();
    const composer = new WhatsAppMediaComposer(environment);

    composer.selectFile(mediaInput());
    expect(environment.createdUrls).toEqual(['blob:tux-1']);

    composer.selectFile(mediaInput({ mimeType: 'audio/mpeg', fileName: 'voice.mp3' }));
    expect(environment.revokedUrls).toEqual(['blob:tux-1']);
    expect(environment.createdUrls).toEqual(['blob:tux-1', 'blob:tux-2']);

    composer.cancel();
    expect(environment.revokedUrls).toEqual(['blob:tux-1', 'blob:tux-2']);
    expect(composer.getState()).toEqual({ kind: 'IDLE' });

    composer.selectFile(mediaInput());
    composer.dispose();
    expect(environment.revokedUrls).toEqual(['blob:tux-1', 'blob:tux-2', 'blob:tux-3']);
    expect(composer.getState()).toEqual({ kind: 'IDLE' });
  });
});

describe('WhatsAppMediaComposer direct voice lifecycle', () => {
  it('keeps voice permission denial non-fatal and exposes a safe retryable composer error', async () => {
    const environment = new TestEnvironment();
    environment.recordingError = new Error('NotAllowedError: microphone details');
    const composer = new WhatsAppMediaComposer(environment);

    await composer.startRecording();

    expect(composer.getState()).toEqual({
      kind: 'ERROR',
      message: 'Microphone access is unavailable.',
    });
    expect(composer.getReadyMedia()).toBeNull();
  });

  it('moves Record to Stop to Preview and returns audio only after Stop', async () => {
    const environment = new TestEnvironment();
    environment.now = 4_200;
    const composer = new WhatsAppMediaComposer(environment);

    await composer.startRecording();
    expect(composer.getState()).toEqual({ kind: 'RECORDING', startedAtMs: 4_200 });
    expect(composer.getReadyMedia()).toBeNull();

    await composer.stopRecording();

    expect(composer.getState()).toMatchObject({
      kind: 'AUDIO_READY',
      mimeType: 'audio/ogg',
      previewUrl: 'blob:tux-1',
    });
    expect(composer.getReadyMedia()).toEqual({
      kind: 'AUDIO',
      bytes: environment.nextRecordingBytes,
      mimeType: 'audio/ogg',
      fileName: null,
    });
    expect(environment.stoppedRecordings).toHaveLength(1);
  });

  it('cancels an in-progress recording without creating a preview', async () => {
    const environment = new TestEnvironment();
    const composer = new WhatsAppMediaComposer(environment);

    await composer.startRecording();
    composer.cancel();

    expect(environment.cancelledRecordings).toHaveLength(1);
    expect(environment.createdUrls).toEqual([]);
    expect(composer.getState()).toEqual({ kind: 'IDLE' });
  });
});

describe('WhatsAppMediaComposer location actions', () => {
  it('maps configured Store Location and disables the action when no store location exists', () => {
    const composer = new WhatsAppMediaComposer(new TestEnvironment());

    expect(composer.resolveStoreLocation(null)).toEqual({
      enabled: false,
      location: null,
      message: 'Store location is not configured.',
    });
    expect(
      composer.resolveStoreLocation({
        latitude: 30.0444,
        longitude: 31.2357,
        label: 'TUX Downtown',
        address: 'Cairo',
      }),
    ).toEqual({
      enabled: true,
      location: {
        latitude: 30.0444,
        longitude: 31.2357,
        name: 'TUX Downtown',
        address: 'Cairo',
      },
      message: null,
    });
  });

  it('returns current location success or a safe non-fatal denial without changing media state', async () => {
    const environment = new TestEnvironment();
    const composer = new WhatsAppMediaComposer(environment);
    composer.selectFile(mediaInput());
    const stateBeforeLocation = composer.getState();

    await expect(composer.requestCurrentLocation()).resolves.toEqual({
      ok: true,
      location: environment.currentLocation,
    });
    expect(composer.getState()).toBe(stateBeforeLocation);

    environment.currentLocationError = new Error('Permission denied with platform details');
    await expect(composer.requestCurrentLocation()).resolves.toEqual({
      ok: false,
      message: 'Current location is unavailable.',
    });
    expect(composer.getState()).toBe(stateBeforeLocation);
  });

  it('starts every new composer instance from IDLE with no restored media state', () => {
    const environment = new TestEnvironment();
    const first = new WhatsAppMediaComposer(environment);
    first.selectFile(mediaInput());

    const restarted = new WhatsAppMediaComposer(environment);

    expect(restarted.getState()).toEqual({ kind: 'IDLE' });
    expect(restarted.getReadyMedia()).toBeNull();
  });
});
