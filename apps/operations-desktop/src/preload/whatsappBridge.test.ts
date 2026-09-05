import type { TuxDesktopApi } from '@tux/platform-contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => ({
  exposed: null as unknown,
  invoke: vi.fn(),
  on: vi.fn(),
  removeListener: vi.fn(),
}));

vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: (_name: string, api: unknown) => {
      harness.exposed = api;
    },
  },
  ipcRenderer: {
    invoke: harness.invoke,
    on: harness.on,
    removeListener: harness.removeListener,
  },
}));

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.stubGlobal('window', { addEventListener: vi.fn() });
  harness.exposed = null;
  await import('./index');
});

afterEach(() => vi.unstubAllGlobals());

function whatsapp(): TuxDesktopApi['whatsapp'] {
  return (harness.exposed as TuxDesktopApi).whatsapp;
}

describe('desktop WhatsApp preload policy bridge', () => {
  it('exposes resolveMessagingTarget through a dedicated channel and validates the response', async () => {
    harness.invoke.mockResolvedValue({
      ok: true,
      value: {
        mode: 'FREE_FORM',
        conversationId: '22222222-2222-4222-8222-222222222222',
        freeFormUntil: '2026-09-05T10:00:00.000Z',
        config: { storefrontUrl: 'https://tux.example/menu', storeLocation: null },
      },
    });

    await expect(
      whatsapp().resolveMessagingTarget({
        normalizedPhone: '+201012345678',
        displayPhone: '010 1234 5678',
      }),
    ).resolves.toMatchObject({ ok: true, value: { mode: 'FREE_FORM' } });
    expect(harness.invoke).toHaveBeenCalledWith('tux:whatsapp:resolve-messaging-target', {
      normalizedPhone: '+201012345678',
      displayPhone: '010 1234 5678',
    });

    harness.invoke.mockResolvedValueOnce({
      ok: true,
      value: {
        mode: 'BLOCKED',
        conversationId: null,
        reason: 'NO_APPROVED_TEMPLATE',
        config: {
          storefrontUrl: 'https://tux.example/menu',
          storeLocation: null,
          providerSecret: 'must-not-cross-preload',
        },
      },
    });
    await expect(
      whatsapp().resolveMessagingTarget({
        normalizedPhone: '+201012345678',
        displayPhone: '010 1234 5678',
      }),
    ).rejects.toThrow(TypeError);
  });

  it('exposes sendTemplate using only the public template intent payload', async () => {
    harness.invoke.mockResolvedValue({
      ok: false,
      error: { code: 'REMOTE_SYNC_ERROR', message: 'offline' },
    });

    await expect(
      whatsapp().sendTemplate({
        normalizedPhone: '+201012345678',
        displayPhone: '010 1234 5678',
        templateId: 'starter-1',
        outboundIntentKey: 'intent-1',
      }),
    ).resolves.toMatchObject({ ok: false });
    expect(harness.invoke).toHaveBeenCalledWith('tux:whatsapp:send-template', {
      normalizedPhone: '+201012345678',
      displayPhone: '010 1234 5678',
      templateId: 'starter-1',
      outboundIntentKey: 'intent-1',
    });
  });
});
