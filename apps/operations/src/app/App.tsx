import { greetingForHour, type OperationsSessionState } from '@tux/application';
import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { createOperationsSessionClient } from './sessionClient';

type ScreenState =
  | { readonly kind: 'LOADING' }
  | { readonly kind: 'SESSION'; readonly session: OperationsSessionState }
  | {
      readonly kind: 'GREETING';
      readonly session: Extract<OperationsSessionState, { status: 'ACTIVE' }>;
    };

function Brand() {
  return (
    <div className="tux-brand" aria-label="TUX">
      TUX
    </div>
  );
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
}: {
  readonly session: Extract<OperationsSessionState, { status: 'ACTIVE' }>;
}) {
  return (
    <main className="greeting-shell" aria-live="polite">
      <div className="greeting-content">
        <Brand />
        <h1>{greetingForHour(new Date().getHours(), session.operator.displayName)}</h1>
        <p>Glad you made it in safely.</p>
        <p>Have a great shift.</p>
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
  busy,
  error,
  onSwitch,
  onSignOut,
}: {
  readonly session: Extract<OperationsSessionState, { status: 'ACTIVE' }>;
  readonly busy: boolean;
  readonly error: string | null;
  readonly onSwitch: (pin: string) => Promise<boolean>;
  readonly onSignOut: () => Promise<void>;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [switchOpen, setSwitchOpen] = useState(false);

  return (
    <div className="operations-shell">
      <header className="operations-header">
        <Brand />
        <nav className="operations-nav" aria-label="Operations">
          <button type="button" className="nav-item nav-item-active">
            Orders
          </button>
          <button type="button" className="nav-item" disabled>
            Orders Board
          </button>
          <button type="button" className="nav-item" disabled>
            Expenses
          </button>
          <button type="button" className="nav-item" disabled>
            Bulk Stock
          </button>
        </nav>
        <div className="header-actions">
          <span className="sync-status" aria-label="Local-first status">
            Local
          </span>
          <div className="operator-menu-wrap">
            <button
              className="operator-trigger"
              type="button"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((open) => !open)}
            >
              {session.operator.displayName} <span aria-hidden="true">▾</span>
            </button>
            {menuOpen ? (
              <div className="operator-menu" role="menu">
                <div className="operator-menu-summary">
                  <strong>{session.operator.displayName}</strong>
                  <span>Shift started: {formatShiftTime(session.businessDayStartedAt)}</span>
                </div>
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
                <button type="button" role="menuitem" disabled>
                  End Day
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </header>

      <main className="orders-phase-placeholder" aria-labelledby="orders-title">
        <p className="eyebrow">Current Business Day</p>
        <h1 id="orders-title">Orders</h1>
        <p>
          The worker session is active. The complete Orders workspace is implemented in Phase 4.
        </p>
      </main>

      {error === null ? null : (
        <div className="global-error" role="alert">
          {error}
        </div>
      )}

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
  const [screen, setScreen] = useState<ScreenState>({ kind: 'LOADING' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      setScreen({ kind: 'GREETING', session: active });
      window.setTimeout(() => setScreen({ kind: 'SESSION', session: active }), 1_250);
      return true;
    }
    setScreen({ kind: 'SESSION', session: result.value });
    return true;
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

  if (screen.kind === 'LOADING') {
    return <main className="loading-shell" aria-label="Loading TUX Operations" />;
  }
  if (screen.kind === 'GREETING') {
    return <GreetingScreen session={screen.session} />;
  }
  if (screen.session.status === 'CONFIGURATION_REQUIRED') {
    return (
      <main className="entry-shell">
        <section className="entry-card" aria-labelledby="configuration-title">
          <Brand />
          <h1 id="configuration-title">TUX Operations</h1>
          <p className="entry-state">Device setup required</p>
          <p className="configuration-note">{screen.session.message}</p>
        </section>
      </main>
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
      busy={busy}
      error={error}
      onSwitch={applyPin}
      onSignOut={signOut}
    />
  );
}
