import type { OperationsSessionResult } from '@tux/application';

export interface TuxDesktopApi {
  readonly app: {
    readonly getVersion: () => Promise<string>;
  };
  readonly session: {
    readonly getState: () => Promise<OperationsSessionResult>;
    readonly submitPin: (pin: string) => Promise<OperationsSessionResult>;
    readonly signOut: () => Promise<OperationsSessionResult>;
  };
}
