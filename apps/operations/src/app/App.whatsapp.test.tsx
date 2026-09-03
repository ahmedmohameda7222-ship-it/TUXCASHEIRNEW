import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8');
const activeShellStart = source.indexOf('function ActiveShell(');
const appStart = source.indexOf('export function App(');
const activeShellSource = source.slice(activeShellStart, appStart);

function count(text: string, value: string): number {
  return text.split(value).length - 1;
}

function indexOrFail(text: string, value: string): number {
  const index = text.indexOf(value);
  expect(index, `Expected ${value} in App.tsx`).toBeGreaterThanOrEqual(0);
  return index;
}

describe('Operations WhatsApp ACTIVE-shell integration', () => {
  it('adds WHATSAPP to OperationsArea and preserves the exact visual navigation order', () => {
    expect(source).toContain(
      "type OperationsArea = 'ORDERS' | 'ORDERS_BOARD' | 'WHATSAPP' | 'EXPENSES' | 'BULK_STOCK'",
    );

    const labels = ['Orders', 'Orders Board', 'WhatsApp', 'Expenses', 'Bulk Stock'];
    const positions = labels.map((label) =>
      indexOrFail(activeShellSource, `\n            ${label}\n`),
    );
    expect(positions).toEqual([...positions].sort((left, right) => left - right));
  });

  it('routes WhatsApp navigation through the existing protected transition guard', () => {
    const selectionIndex = indexOrFail(activeShellSource, "setArea('WHATSAPP')");
    const surrounding = activeShellSource.slice(
      Math.max(0, selectionIndex - 260),
      selectionIndex + 180,
    );

    expect(surrounding).toContain('requestProtectedTransition');
    expect(surrounding).toContain("setArea('WHATSAPP')");
    expect(source).not.toContain('requestWhatsAppProtectedTransition');
  });

  it('creates exactly one public WhatsApp client and one controller per ACTIVE shell', () => {
    expect(activeShellSource).toContain('createOperationsWhatsAppClient()');
    expect(activeShellSource).toContain('new WhatsAppInboxController(');
    expect(activeShellSource).toContain('createBrowserWhatsAppInboxEnvironment()');
    expect(count(activeShellSource, 'createOperationsWhatsAppClient()')).toBe(1);
    expect(count(activeShellSource, 'new WhatsAppInboxController(')).toBe(1);
    expect(count(activeShellSource, 'createBrowserWhatsAppInboxEnvironment()')).toBe(1);

    const outsideActiveShell = source.slice(0, activeShellStart) + source.slice(appStart);
    expect(outsideActiveShell).not.toContain('createOperationsWhatsAppClient()');
    expect(outsideActiveShell).not.toContain('new WhatsAppInboxController(');
  });

  it('subscribes once, starts for ACTIVE-shell lifetime, and stops on cleanup', () => {
    expect(activeShellSource).toContain('whatsappController.subscribe(setWhatsAppState)');
    expect(activeShellSource).toContain('whatsappController.start()');
    expect(activeShellSource).toContain('whatsappController.stop()');
    expect(count(activeShellSource, 'whatsappController.subscribe(')).toBe(1);
    expect(count(activeShellSource, 'whatsappController.start()')).toBe(1);
    expect(count(activeShellSource, 'whatsappController.stop()')).toBe(1);
  });

  it('calls onAreaSelected from an effect only when WhatsApp becomes selected', () => {
    const effectIndex = indexOrFail(activeShellSource, "if (area === 'WHATSAPP')");
    const effectSource = activeShellSource.slice(Math.max(0, effectIndex - 200), effectIndex + 300);

    expect(effectSource).toContain('useEffect');
    expect(effectSource).toContain('whatsappController.onAreaSelected()');
    expect(count(activeShellSource, 'whatsappController.onAreaSelected()')).toBe(1);
  });

  it('uses shared controller state for the nav unread badge even outside the WhatsApp area', () => {
    expect(activeShellSource).toContain('formatUnreadBadge(whatsappState.totalUnread)');
    expect(activeShellSource).toContain('nav-unread-badge');
    expect(activeShellSource).toContain('whatsappUnreadBadge');
    expect(count(activeShellSource, 'loadInbox(')).toBe(0);
  });

  it('renders WhatsAppWorkspace only for the selected WHATSAPP area', () => {
    expect(activeShellSource).toContain("area === 'WHATSAPP'");
    expect(activeShellSource).toContain('<WhatsAppWorkspace');
    expect(activeShellSource).toContain('controller={whatsappController}');
    expect(activeShellSource).toContain('state={whatsappState}');
  });

  it('keeps WhatsApp entirely inside ACTIVE shell and leaves non-active session rendering independent', () => {
    expect(activeShellStart).toBeGreaterThanOrEqual(0);
    expect(appStart).toBeGreaterThan(activeShellStart);

    const outerAppSource = source.slice(appStart);
    expect(outerAppSource).not.toContain('<WhatsAppWorkspace');
    expect(outerAppSource).not.toContain('WhatsAppInboxController');
    expect(outerAppSource).toContain("screen.session.status === 'CONFIGURATION_REQUIRED'");
    expect(outerAppSource).toContain("screen.session.status === 'NO_ACTIVE_DAY'");
    expect(outerAppSource).toContain("screen.session.status === 'SIGN_IN_REQUIRED'");
    expect(outerAppSource).toContain('<ActiveShell');
  });
});
