import type { TuxDesktopApi } from '@tux/platform-contracts';

declare global {
  interface Window {
    tuxDesktop?: TuxDesktopApi;
  }
}

export {};
