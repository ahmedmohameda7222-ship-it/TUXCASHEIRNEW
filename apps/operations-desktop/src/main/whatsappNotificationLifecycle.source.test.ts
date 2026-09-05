import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const mainSource = readFileSync(
  resolve(process.cwd(), 'apps/operations-desktop/src/main/index.ts'),
  'utf8',
);
const preloadSource = readFileSync(
  resolve(process.cwd(), 'apps/operations-desktop/src/preload/index.ts'),
  'utf8',
);
const contractSource = readFileSync(
  resolve(process.cwd(), 'packages/platform-contracts/index.d.ts'),
  'utf8',
);
const appSource = readFileSync(resolve(process.cwd(), 'apps/operations/src/app/App.tsx'), 'utf8');

function handlerBody(channel: string): string {
  const start = mainSource.indexOf(`ipcMain.handle(${channel}`);
  if (start < 0) throw new Error(`Missing IPC handler ${channel}.`);
  const next = mainSource.indexOf('ipcMain.handle(', start + 1);
  return mainSource.slice(start, next < 0 ? mainSource.length : next);
}

describe('Electron WhatsApp notification lifecycle wiring', () => {
  it('composes the device-authorized feed with native notifications and the independent local privacy context', () => {
    expect(mainSource).toContain('WhatsAppNotificationFeed');
    expect(mainSource).toContain('WhatsAppNotifications');
    expect(mainSource).toContain('loadNotificationFeed(cursor)');
    expect(mainSource).toContain('sessionActive: whatsappNotificationSessionActive');
    expect(mainSource).toContain(
      'focusedConversationId: whatsappNotificationFocusedConversationId',
    );
    expect(mainSource).toContain('windowFocused: window.isFocused()');
    expect(mainSource).toMatch(
      /new Notification\(\{[\s\S]*title: presentation\.title,[\s\S]*body: presentation\.body,[\s\S]*\}\)\.show\(\)/,
    );
  });

  it('tracks authoritative local ACTIVE state and starts/stops the 15-second feed with the app lifecycle', () => {
    expect(mainSource).toContain(
      "whatsappNotificationSessionActive = result.ok && result.value.status === 'ACTIVE';",
    );
    expect(mainSource).toContain('whatsappNotificationFeed.start()');
    expect(mainSource).toContain('whatsappNotificationFeed?.stop()');
  });

  it('accepts only minimal focused-conversation state from the trusted renderer and clears it outside WhatsApp', () => {
    expect(mainSource).toContain(
      "const IPC_WHATSAPP_SET_NOTIFICATION_VIEW_STATE = 'tux:whatsapp:set-notification-view-state';",
    );
    const handler = handlerBody('IPC_WHATSAPP_SET_NOTIFICATION_VIEW_STATE');
    expect(handler).toContain('assertTrustedIpcSender(event, window.webContents.id)');
    expect(handler).toContain('whatsappNotificationFocusedConversationId');
    expect(handler).toContain('focusedConversationId');

    expect(contractSource).toContain('setNotificationViewState');
    expect(preloadSource).toContain('IPC_WHATSAPP_SET_NOTIFICATION_VIEW_STATE');
    expect(preloadSource).toContain('setNotificationViewState');
    expect(appSource).toContain('window.tuxDesktop?.whatsapp.setNotificationViewState');
    expect(appSource).toContain(
      "area === 'WHATSAPP' ? whatsappState.selectedConversationId : null",
    );
  });
});
