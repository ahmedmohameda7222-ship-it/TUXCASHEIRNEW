import { describe, expect, it } from 'vitest';
import { MENU_REFRESH_INTERVAL_MS, startMenuRefreshLifecycle } from './menuRefreshLifecycle';

describe('published menu refresh lifecycle', () => {
  it('polls only when visible, refreshes on focus/reconnect, and cleans up listeners', () => {
    let visible: DocumentVisibilityState = 'visible';
    let tick: (() => void) | undefined;
    let timerDelay: number | undefined;
    let clearedTimer: number | undefined;
    let refreshCount = 0;
    const windowListeners = new Map<string, () => void>();
    const documentListeners = new Map<string, () => void>();

    const hostWindow = {
      setInterval(callback: () => void, ms: number) {
        tick = callback;
        timerDelay = ms;
        return 42;
      },
      clearInterval(timer: number) {
        clearedTimer = timer;
      },
      addEventListener(type: string, callback: () => void) {
        windowListeners.set(type, callback);
      },
      removeEventListener(type: string) {
        windowListeners.delete(type);
      },
    } as unknown as Parameters<typeof startMenuRefreshLifecycle>[0];

    const hostDocument = {
      get visibilityState() {
        return visible;
      },
      addEventListener(type: string, callback: () => void) {
        documentListeners.set(type, callback);
      },
      removeEventListener(type: string) {
        documentListeners.delete(type);
      },
    } as unknown as Parameters<typeof startMenuRefreshLifecycle>[1];

    const stop = startMenuRefreshLifecycle(hostWindow, hostDocument, () => {
      refreshCount += 1;
    });

    expect(timerDelay).toBe(MENU_REFRESH_INTERVAL_MS);
    tick?.();
    expect(refreshCount).toBe(1);

    visible = 'hidden';
    tick?.();
    windowListeners.get('focus')?.();
    documentListeners.get('visibilitychange')?.();
    expect(refreshCount).toBe(1);

    visible = 'visible';
    documentListeners.get('visibilitychange')?.();
    windowListeners.get('online')?.();
    expect(refreshCount).toBe(3);

    stop();
    expect(clearedTimer).toBe(42);
    expect(windowListeners.size).toBe(0);
    expect(documentListeners.size).toBe(0);
  });
});
