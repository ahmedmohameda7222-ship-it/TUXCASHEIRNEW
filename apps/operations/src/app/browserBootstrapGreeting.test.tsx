import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { OperationsSessionState } from '@tux/application';
import { App } from './App';

const activeSession = {
  status: 'ACTIVE',
  shopId: '10000000-0000-4000-8000-000000000001',
  businessDayId: '20000000-0000-4000-8000-000000000001',
  businessDayStartedAt: '2026-09-02T10:00:00.000Z',
  operator: {
    id: '30000000-0000-4000-8000-000000000001',
    displayName: 'Fresh Browser Worker',
  },
} as unknown as Extract<OperationsSessionState, { status: 'ACTIVE' }>;

const gateSource = readFileSync(new URL('./BrowserBootstrapGate.tsx', import.meta.url), 'utf8');
const appSource = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8');
const previousWindow = globalThis.window;

beforeAll(() => {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { tuxDesktop: undefined },
  });
});

afterAll(() => {
  if (previousWindow === undefined) {
    Reflect.deleteProperty(globalThis, 'window');
    return;
  }
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: previousWindow,
  });
});

describe('fresh browser bootstrap greeting handoff', () => {
  it('renders GreetingScreen when App receives a fresh authenticated ACTIVE transition', () => {
    const html = renderToStaticMarkup(<App initialAuthenticatedSession={activeSession} />);

    expect(html).toContain('greeting-shell');
    expect(html).toContain('Glad you made it in safely.');
    expect(html).not.toContain('aria-label="Operations"');
  });

  it(
    'requires BrowserBootstrapGate to preserve the ACTIVE authentication transition for App',
    () => {
      expect(gateSource).toContain('setFreshAuthenticatedSession(result.value)');
      expect(gateSource).toContain(
        '<App initialAuthenticatedSession={freshAuthenticatedSession} />',
      );
    },
  );

  it(
    'keeps recovered ACTIVE state direct while normal PIN and worker-switch transitions keep Greeting',
    () => {
      expect(appSource).toContain(
        "if (result.ok) setScreen({ kind: 'SESSION', session: result.value });",
      );
      expect(appSource).toContain("setScreen({ kind: 'GREETING', session: active, copy });");
      expect(appSource).toContain('onSwitch={applyPin}');
    },
  );
});
