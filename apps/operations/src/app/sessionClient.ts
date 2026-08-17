import { OperationsSessionService, type OperationsSessionResult } from '@tux/application';
import { instant } from '@tux/domain';
import {
  IndexedDbOperationsDatabase,
  IndexedDbOperatorSessionReadModel,
} from '@tux/persistence/browser';
import { BrowserPbkdf2PinVerifier } from './browserPinVerifier';

export interface OperationsSessionClient {
  getState(): Promise<OperationsSessionResult>;
  submitPin(pin: string): Promise<OperationsSessionResult>;
  signOut(): Promise<OperationsSessionResult>;
}

let browserServicePromise: Promise<OperationsSessionService> | null = null;

async function browserService(): Promise<OperationsSessionService> {
  if (browserServicePromise === null) {
    browserServicePromise = (async () => {
      const database = new IndexedDbOperationsDatabase();
      await database.initialize();
      const readModel = new IndexedDbOperatorSessionReadModel();
      await readModel.initialize();
      return new OperationsSessionService(database, readModel, new BrowserPbkdf2PinVerifier(), {
        now: () => instant(new Date()),
        createUuid: () => crypto.randomUUID(),
      });
    })();
  }
  return browserServicePromise;
}

export function createOperationsSessionClient(): OperationsSessionClient {
  const desktop = window.tuxDesktop;
  if (desktop !== undefined) {
    return desktop.session;
  }
  return {
    getState: async () => (await browserService()).getState(),
    submitPin: async (pin: string) => (await browserService()).submitPin(pin),
    signOut: async () => (await browserService()).signOut(),
  };
}
