import { type OperationsSessionState } from '@tux/application';
import { parseSystemAccentColor, type SystemAccentColor } from '@tux/domain';
import { type FormEvent, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { BulkStockWorkspace } from './BulkStockWorkspace';
import { EndDayFlow } from './EndDayFlow';
import { ExpensesWorkspace } from './ExpensesWorkspace';
import { OrdersBoardWorkspace } from './OrdersBoardWorkspace';
import { OrdersWorkspace } from './OrdersWorkspace';
import {
  createOperationsBulkStockClient,
  createOperationsEndDayClient,
  createOperationsExpensesClient,
  createOperationsOrdersBoardClient,
  createOperationsOrdersClient,
  createOperationsSessionClient,
  createWorkerUiPreferencesClient,
  type OperationsBulkStockClient,
  type OperationsEndDayClient,
  type OperationsExpensesClient,
  type OperationsOrdersBoardClient,
  type OperationsOrdersClient,
} from './sessionClient';
import { connectDesktopSyncStatus } from './syncStatus';
import { UserIcon } from './icons';
import { SyncStatusIndicator } from './SyncStatusIndicator';
import { SystemColorPickerDialog } from './SystemColorPickerDialog';
import {
  applySystemAccentPalette,
  clearSystemAccentPalette,
  deriveSystemAccentPalette,
  type EffectiveTheme,
} from './systemAccentTheme';
import { chooseWelcomeCopy, greetingForLocalHour, type WelcomeCopy } from './welcomeCopy';

type ScreenState =
  | { readonly kind: 'LOADING' }
  | { readonly kind: 'SESSION'; readonly session: OperationsSessionState }
  | {
      readonly kind: 'GREETING';
      readonly session: Extract<OperationsSessionState, { status: 'ACTIVE' }>;
      readonly copy: WelcomeCopy;
    };

type ThemePreference = 'system' | 'light' | 'dark';
type OperationsArea = 'ORDERS' | 'ORDERS_BOARD' | 'EXPENSES' | 'BULK_STOCK';
const THEME_STORAGE_KEY = 'tux.operations.theme';
const DEFAULT_SYSTEM_ACCENT = parseSystemAccentColor('#1F6B52');

function initialTheme(): ThemePreference {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    return stored === 'light' || stored === 'dark' || stored === 'system' ? stored : 'system';
  } catch {
    return 'system';
  }
}

function Brand() {
  return <img className="tux-brand" src="/favicon.svg" alt="TUX" />;
}

function PinForm({
  purpose,
  busy,
  error,
  onSubmit,
}: {
  readonly purpose: 'START_DAY' | 'SIGN_IN';
  readonly busy: boolean;
  readonly error: string | null;
  readonly onSubmit: (pin: string) => Promise<void>;
}) {
  const [pin, setPin] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    await onSubmit(pin);
    setPin('');
  }

  const label = purpose === 'START_DAY' ? 'Enter PIN to Start Day' : 'Enter PIN to Sign In';
  return (
    <form className="pin-form" onSubmit={submit}>
      <label htmlFor="worker-pin">{label}</label>
      <input
        id="worker-pin"
        name="worker-pin"
        type="password"
        inputMode="numeric"
        autoComplete="off"
        value={pin}
        onChange={(event) => setPin(event.target.value.replace(/\D/g, ''))}
        disabled={busy}
        autoFocus
        aria-describedby={error === null ? undefined : 'pin-error'}
      />
      {error === null ? null : (
        <p className="form-error" id="pin-error" role="alert">
          {error}
        </p>
      )}
      <button className="primary-action" type="submit" disabled={busy || pin.length === 0}>
        {busy ? 'Checking…' : purpose === 'START_DAY' ? 'Start Day' : 'Sign In'}
      </button>
    </form>
  );
}

function DeviceSetupScreen({
  message,
  busy,
  error,
  canEnroll,
  onEnroll,
}: {
  readonly message: string;
  readonly busy: boolean;
  readonly error: string | null;
  readonly canEnroll: boolean;
  readonly onEnroll: (enrollmentCode: string) => Promise<void>;
}) {
  const [enrollmentCode, setEnrollmentCode] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !canEnroll) return;
    await onEnroll(enrollmentCode);
  }

  return (
    <main className="entry-shell">
      <section className="entry-card" aria-labelledby="configuration-title">
        <Brand />
        <h1 id="configuration-title">TUX Operations</h1>
        <p className="entry-state">Device setup required</p>
        <p className="configuration-note">{message}</p>
        {canEnroll ? (
          <form className="pin-form" onSubmit={submit}>
            <label htmlFor="device-enrollment-code">Device enrollment code</label>
            <input
              id="device-enrollment-code"
              name="device-enrollment-code"
              type="password"
              autoComplete="off"
              value={enrollmentCode}
              onChange={(event) => setEnrollmentCode(event.target.value.trim())}
              disabled={busy}
              autoFocus
              aria-describedby={error === null ? undefined : 'device-enrollment-error'}
            />
            {error === null ? null : (
              <p className="form-error" id="device-enrollment-error" role="alert">
                {error}
              </p>
            )}
            <button
              className="primary-action"
              type="submit"
              disabled={busy || enrollmentCode.length === 0}
            >
              {busy ? 'Connecting…' : 'Enroll Device'}
            </button>
          </form>
        ) : error === null ? null : (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </section>
    </main>
  );
}

function EntryScreen({
  session,
  busy,
  error,
  onPin,
}: {
  readonly session: Extract<
    OperationsSessionState,
    { status: 'NO_ACTIVE_DAY' | 'SIGN_IN_REQUIRED' }
  >;
  readonly busy: boolean;
  readonly error: string | null;
  readonly onPin: (pin: string) => Promise<void>;
}) {
  const starting = session.status === 'NO_ACTIVE_DAY';
  return (
    <main className="entry-shell">
      <section className="entry-card" aria-labelledby="entry-title">
        <Brand />
        <h1 id="entry-title">TUX Operations</h1>
        <p className="entry-state">
          {starting ? 'No active Business Day' : 'Business Day active — operator sign-in required'}
        </p>
        <PinForm
          purpose={starting ? 'START_DAY' : 'SIGN_IN'}
          busy={busy}
          error={error}
          onSubmit={onPin}
        />
      </section>
    </main>
  );
}

function GreetingScreen({
  session,
  copy,
  onContinue,
}: {
  readonly session: Extract<OperationsSessionState, { status: 'ACTIVE' }>;
  readonly copy: WelcomeCopy;
  readonly onContinue: () => void;
}) {
  return (
    <main className="greeting-shell" aria-live="polite">
      <div className="greeting-content">
        <Brand />
        <h1>{greetingForLocalHour(new Date().getHours(), session.operator.displayName)}</h1>
        <p>Glad you made it in safely.</p>
        <p className="welcome-motivation">{copy.line}</p>
        <button className="primary-action welcome-action" type="button" onClick={onContinue}>
          {copy.button}
        </button>
      </div>
    </main>
  );
}

function formatShiftTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(
    new Date(value),
  );
}

function ActiveShell({
  session,
  ordersClient,
  ordersBoardClient,
  expensesClient,
  bulkStockClient,
  endDayClient,
  busy,
  error,
  onSwitch,
  onSignOut,
  onBusinessDayClosed,
}: {
  readonly session: Extract<OperationsSessionState, { status: 'ACTIVE' }>;
  readonly ordersClient: OperationsOrdersClient;
  readonly ordersBoardClient: OperationsOrdersBoardClient;
  readonly expensesClient: OperationsExpensesClient;
  readonly bulkStockClient: OperationsBulkStockClient;
  readonly endDayClient: OperationsEndDayClient;
  readonly busy: boolean;
  readonly error: string | null;
  readonly onSwitch: (pin: string) => Promise<boolean>;
  readonly onSignOut: () => Promise<void>;
  readonly onBusinessDayClosed: () => Promise<void>;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [switchOpen, setSwitchOpen] = useState(false);
  const [endDayOpen, setEndDayOpen] = useState(false);
  const [theme, setTheme] = useState<ThemePreference>(initialTheme);
  const [area, setArea] = useState<OperationsArea>('ORDERS');
  const preferencesClient = useMemo(() => createWorkerUiPreferencesClient(), []);
  const [systemDark, setSystemDark] = useState(
    () => window.matchMedia('(prefers-color-scheme: dark)').matches,
  );
  const [savedAccentColor, setSavedAccentColor] = useState<SystemAccentColor | null>(null);
  const [previewAccentColor, setPreviewAccentColor] = useState<SystemAccentColor | null>(null);
  const [accentHydrated, setAccentHydrated] = useState(false);
  const [systemColorOpen, setSystemColorOpen] = useState(false);
  const systemColorOpenRef = useRef(false);
  const activeSystemColorWorkerRef = useRef(session.operator.id);
  const [systemColorSaving, setSystemColorSaving] = useState(false);
  const [systemColorSaveError, setSystemColorSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (theme === 'system') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.dataset['theme'] = theme;
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // Theme preference is non-critical UI state.
    }
  }, [theme]);

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const update = (): void => setSystemDark(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  const effectiveTheme: EffectiveTheme =
    theme === 'dark' || (theme === 'system' && systemDark) ? 'dark' : 'light';

  useEffect(() => {
    activeSystemColorWorkerRef.current = session.operator.id;
    systemColorOpenRef.current = false;
    setSystemColorOpen(false);
    setSystemColorSaving(false);
    setSystemColorSaveError(null);
  }, [session.operator.id]);

  useLayoutEffect(() => {
    let cancelled = false;
    let livePreferenceObserved = false;
    setAccentHydrated(false);
    setSavedAccentColor(null);
    setPreviewAccentColor(null);
    clearSystemAccentPalette(document.documentElement);

    const unsubscribe = preferencesClient.subscribe((preferences) => {
      if (preferences.workerId !== session.operator.id) return;
      livePreferenceObserved = true;
      setSavedAccentColor(preferences.accentColor);
      setAccentHydrated(true);
      if (!systemColorOpenRef.current) {
        setPreviewAccentColor(preferences.accentColor);
      }
    });

    void preferencesClient
      .load()
      .then((preference) => {
        if (cancelled || livePreferenceObserved) return;
        const accentColor = preference?.accentColor ?? null;
        setSavedAccentColor(accentColor);
        setPreviewAccentColor(accentColor);
        setAccentHydrated(true);
      })
      .catch(() => {
        if (cancelled || livePreferenceObserved) return;
        setSavedAccentColor(null);
        setPreviewAccentColor(null);
        setAccentHydrated(true);
      });

    return () => {
      cancelled = true;
      unsubscribe();
      clearSystemAccentPalette(document.documentElement);
    };
  }, [preferencesClient, session.operator.id]);

  useLayoutEffect(() => {
    if (!accentHydrated) return;
    if (previewAccentColor === null) {
      clearSystemAccentPalette(document.documentElement);
      return;
    }
    applySystemAccentPalette(
      document.documentElement,
      deriveSystemAccentPalette(previewAccentColor, effectiveTheme),
    );
  }, [accentHydrated, effectiveTheme, previewAccentColor]);

  async function saveSystemColor(accentColor: SystemAccentColor | null): Promise<void> {
    if (systemColorSaving) return;
    const savingWorkerId = session.operator.id;
    setSystemColorSaving(true);
    setSystemColorSaveError(null);
    try {
      const saved = await preferencesClient.updateAccentColor(accentColor);
      if (activeSystemColorWorkerRef.current !== savingWorkerId) return;
      setSavedAccentColor(saved.accentColor);
      setPreviewAccentColor(saved.accentColor);
      systemColorOpenRef.current = false;
      setSystemColorOpen(false);
    } catch {
      if (activeSystemColorWorkerRef.current !== savingWorkerId) return;
      setSystemColorSaveError('Could not save system color. Try again.');
    } finally {
      if (activeSystemColorWorkerRef.current === savingWorkerId) {
        setSystemColorSaving(false);
      }
    }
  }

  if (!accentHydrated) {
    return (
      <main
        className="operations-accent-loading"
        aria-busy="true"
        aria-label="Loading worker preferences"
      />
    );
  }

  return (
    <div className="operations-shell">
      <header className="operations-header">
        <div className="operations-brand-slot">
          <Brand />
        </div>
        <nav className="operations-nav" aria-label="Operations">
          <button
            type="button"
            className={area === 'ORDERS' ? 'nav-item nav-item-active' : 'nav-item'}
            onClick={() => setArea('ORDERS')}
          >
            Orders
          </button>
          <button
            type="button"
            className={area === 'ORDERS_BOARD' ? 'nav-item nav-item-active' : 'nav-item'}
            onClick={() => setArea('ORDERS_BOARD')}
          >
            Orders Board
          </button>
          <button
            type="button"
            className={area === 'EXPENSES' ? 'nav-item nav-item-active' : 'nav-item'}
            onClick={() => setArea('EXPENSES')}
          >
            Expenses
          </button>
          <button
            type="button"
            className={area === 'BULK_STOCK' ? 'nav-item nav-item-active' : 'nav-item'}
            onClick={() => setArea('BULK_STOCK')}
          >
            Bulk Stock
          </button>
        </nav>
        <div className="header-actions">
          <SyncStatusIndicator />
          <div className="operator-menu-wrap">
            <button
              className="operator-trigger"
              type="button"
              aria-expanded={menuOpen}
              aria-haspopup="menu"
              onClick={() => setMenuOpen((open) => !open)}
            >
              <UserIcon className="operator-user-icon" />
              <span>{session.operator.displayName}</span>
              <span aria-hidden="true">▾</span>
            </button>
            {menuOpen ? (
              <div className="operator-menu" role="menu">
                <div className="operator-menu-summary">
                  <strong>{session.operator.displayName}</strong>
                  <span>Shift started: {formatShiftTime(session.businessDayStartedAt)}</span>
                </div>
                <div className="appearance-section">
                  <span className="appearance-label">Appearance</span>
                  <div className="appearance-options" role="group" aria-label="Appearance">
                    {(['system', 'light', 'dark'] as const).map((option) => (
                      <button
                        key={option}
                        type="button"
                        className={
                          theme === option
                            ? 'appearance-option appearance-option-active'
                            : 'appearance-option'
                        }
                        aria-pressed={theme === option}
                        onClick={() => setTheme(option)}
                      >
                        {option === 'system' ? 'System' : option === 'light' ? 'Light' : 'Dark'}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="system-color-profile-section">
                  <span className="appearance-label">System color</span>
                  <button
                    type="button"
                    className="system-color-profile-action"
                    onClick={() => {
                      setSystemColorSaveError(null);
                      setPreviewAccentColor(savedAccentColor);
                      setMenuOpen(false);
                      systemColorOpenRef.current = true;
                      setSystemColorOpen(true);
                    }}
                  >
                    <span
                      className="system-color-profile-swatch"
                      style={{ backgroundColor: savedAccentColor ?? DEFAULT_SYSTEM_ACCENT }}
                      aria-hidden="true"
                    />
                    <span>Choose system color</span>
                  </button>
                </div>
                <div className="menu-divider" />
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setSwitchOpen(true);
                    setMenuOpen(false);
                  }}
                >
                  Switch / Sign in worker
                </button>
                <button
                  type="button"
                  role="menuitem"
                  disabled={busy}
                  onClick={() => void onSignOut()}
                >
                  Sign out
                </button>
                <div className="menu-divider" />
                <button
                  type="button"
                  role="menuitem"
                  disabled={busy}
                  onClick={() => {
                    setMenuOpen(false);
                    setEndDayOpen(true);
                  }}
                >
                  End Day
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </header>

      {area === 'ORDERS' ? (
        <OrdersWorkspace session={session} client={ordersClient} />
      ) : area === 'ORDERS_BOARD' ? (
        <OrdersBoardWorkspace client={ordersBoardClient} ordersClient={ordersClient} />
      ) : area === 'EXPENSES' ? (
        <ExpensesWorkspace client={expensesClient} />
      ) : (
        <BulkStockWorkspace client={bulkStockClient} />
      )}

      {error === null ? null : (
        <div className="global-error" role="alert">
          {error}
        </div>
      )}

      {endDayOpen ? (
        <EndDayFlow
          client={endDayClient}
          onCancel={() => setEndDayOpen(false)}
          onReturnToOrders={() => {
            setArea('ORDERS');
            setEndDayOpen(false);
          }}
          onReturnToBoard={() => {
            setArea('ORDERS_BOARD');
            setEndDayOpen(false);
          }}
          onClosed={async () => {
            setEndDayOpen(false);
            await onBusinessDayClosed();
          }}
        />
      ) : null}

      {systemColorOpen ? (
        <SystemColorPickerDialog
          savedAccentColor={savedAccentColor}
          defaultPreviewColor={DEFAULT_SYSTEM_ACCENT}
          saving={systemColorSaving}
          saveError={systemColorSaveError}
          onPreview={setPreviewAccentColor}
          onSave={saveSystemColor}
          onCancel={() => {
            systemColorOpenRef.current = false;
            setSystemColorOpen(false);
          }}
        />
      ) : null}

      {switchOpen ? (
        <div className="modal-backdrop" role="presentation">
          <section
            className="switch-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="switch-title"
          >
            <div className="dialog-heading">
              <div>
                <p className="eyebrow">Current operator</p>
                <h2 id="switch-title">Switch worker</h2>
              </div>
              <button type="button" className="quiet-action" onClick={() => setSwitchOpen(false)}>
                Cancel
              </button>
            </div>
            <PinForm
              purpose="SIGN_IN"
              busy={busy}
              error={error}
              onSubmit={async (pin) => {
                const switched = await onSwitch(pin);
                if (switched) setSwitchOpen(false);
              }}
            />
          </section>
        </div>
      ) : null}
    </div>
  );
}

export function App() {
  const client = useMemo(() => createOperationsSessionClient(), []);
  const ordersClient = useMemo(() => createOperationsOrdersClient(), []);
  const ordersBoardClient = useMemo(() => createOperationsOrdersBoardClient(), []);
  const expensesClient = useMemo(() => createOperationsExpensesClient(), []);
  const bulkStockClient = useMemo(() => createOperationsBulkStockClient(), []);
  const endDayClient = useMemo(() => createOperationsEndDayClient(), []);
  const previousWelcomeCopy = useRef<WelcomeCopy | null>(null);
  const [screen, setScreen] = useState<ScreenState>({ kind: 'LOADING' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const desktopSync = window.tuxDesktop?.sync;
    if (desktopSync === undefined) return;
    return connectDesktopSyncStatus(desktopSync);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void client.getState().then((result) => {
      if (cancelled) return;
      if (result.ok) setScreen({ kind: 'SESSION', session: result.value });
      else setError(result.error.message);
    });
    return () => {
      cancelled = true;
    };
  }, [client]);

  async function applyPin(pin: string): Promise<boolean> {
    setBusy(true);
    setError(null);
    const result = await client.submitPin(pin);
    setBusy(false);
    if (!result.ok) {
      setError(result.error.message);
      return false;
    }
    if (result.value.status === 'ACTIVE') {
      const active = result.value;
      const copy = chooseWelcomeCopy({
        previousLine: previousWelcomeCopy.current?.line ?? null,
        previousButton: previousWelcomeCopy.current?.button ?? null,
      });
      previousWelcomeCopy.current = copy;
      setScreen({ kind: 'GREETING', session: active, copy });
      return true;
    }
    setScreen({ kind: 'SESSION', session: result.value });
    return true;
  }

  async function enrollDevice(enrollmentCode: string): Promise<void> {
    if (client.enrollDevice === undefined) return;
    setBusy(true);
    setError(null);
    const result = await client.enrollDevice(enrollmentCode);
    setBusy(false);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    setScreen({ kind: 'SESSION', session: result.value });
  }

  async function signOut(): Promise<void> {
    setBusy(true);
    setError(null);
    const result = await client.signOut();
    setBusy(false);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    setScreen({ kind: 'SESSION', session: result.value });
  }

  async function refreshAfterEndDay(): Promise<void> {
    setBusy(true);
    setError(null);
    const result = await client.getState();
    setBusy(false);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    setScreen({ kind: 'SESSION', session: result.value });
  }

  if (screen.kind === 'LOADING')
    return <main className="loading-shell" aria-label="Loading TUX Operations" />;
  if (screen.kind === 'GREETING') {
    const active = screen.session;
    return (
      <GreetingScreen
        session={active}
        copy={screen.copy}
        onContinue={() => setScreen({ kind: 'SESSION', session: active })}
      />
    );
  }
  if (screen.session.status === 'CONFIGURATION_REQUIRED') {
    return (
      <DeviceSetupScreen
        message={screen.session.message}
        busy={busy}
        error={error}
        canEnroll={client.enrollDevice !== undefined}
        onEnroll={enrollDevice}
      />
    );
  }
  if (screen.session.status === 'NO_ACTIVE_DAY' || screen.session.status === 'SIGN_IN_REQUIRED') {
    return (
      <EntryScreen
        session={screen.session}
        busy={busy}
        error={error}
        onPin={async (pin) => {
          void (await applyPin(pin));
        }}
      />
    );
  }
  return (
    <ActiveShell
      session={screen.session}
      ordersClient={ordersClient}
      ordersBoardClient={ordersBoardClient}
      expensesClient={expensesClient}
      bulkStockClient={bulkStockClient}
      endDayClient={endDayClient}
      busy={busy}
      error={error}
      onSwitch={applyPin}
      onSignOut={signOut}
      onBusinessDayClosed={refreshAfterEndDay}
    />
  );
}
