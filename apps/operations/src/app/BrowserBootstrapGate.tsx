import { type OperationsSessionState } from '@tux/application';
import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { App } from './App';
import { createOperationsSessionClient } from './sessionClient';

type ActiveSession = Extract<OperationsSessionState, { status: 'ACTIVE' }>;
type GateState = 'LOADING' | 'PIN_REQUIRED' | 'READY';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function Brand() {
  return <img className="tux-brand" src="/favicon.svg" alt="TUX" />;
}

export function BrowserBootstrapGate() {
  const client = useMemo(() => createOperationsSessionClient(), []);
  const [state, setState] = useState<GateState>(
    window.tuxDesktop === undefined ? 'LOADING' : 'READY',
  );
  const [freshAuthenticatedSession, setFreshAuthenticatedSession] = useState<ActiveSession>();
  const [pin, setPin] = useState('');
  const [shopId, setShopId] = useState(() =>
    new URLSearchParams(window.location?.search ?? '').get('shopId')?.trim() ?? '',
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (window.tuxDesktop !== undefined) return;
    let cancelled = false;
    void client.getState().then((result) => {
      if (cancelled) return;
      if (result.ok && result.value.status === 'CONFIGURATION_REQUIRED') {
        setState('PIN_REQUIRED');
      } else {
        setState('READY');
      }
    });
    return () => {
      cancelled = true;
    };
  }, [client]);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (busy || pin.length === 0) return;
    if (!UUID_PATTERN.test(shopId.trim())) {
      setError('Enter the Shop ID provided by your manager.');
      return;
    }
    setBusy(true);
    setError(null);
    const result = await client.submitPin(pin, shopId.trim());
    setBusy(false);
    if (!result.ok) {
      setError(result.error.message);
      setPin('');
      return;
    }
    if (result.value.status === 'CONFIGURATION_REQUIRED') {
      setError('Could not load the Operations configuration.');
      setPin('');
      return;
    }
    if (result.value.status === 'ACTIVE') {
      setFreshAuthenticatedSession(result.value);
    }
    setState('READY');
  }

  if (state === 'READY') {
    return freshAuthenticatedSession === undefined ? (
      <App />
    ) : (
      <App initialAuthenticatedSession={freshAuthenticatedSession} />
    );
  }
  if (state === 'LOADING') {
    return <main className="loading-shell" aria-label="Loading TUX Operations" />;
  }

  return (
    <main className="entry-shell">
      <section className="entry-card" aria-labelledby="worker-sign-in-title">
        <Brand />
        <h1 id="worker-sign-in-title">TUX Operations</h1>
        <p className="entry-state">Worker sign in</p>
        <form className="pin-form" onSubmit={submit}>
          <label htmlFor="bootstrap-shop-id">Shop ID (from TUX Admin)</label>
          <input
            id="bootstrap-shop-id"
            name="bootstrap-shop-id"
            type="text"
            autoComplete="off"
            spellCheck={false}
            value={shopId}
            onChange={(event) => setShopId(event.target.value.trim())}
            disabled={busy}
            placeholder="Paste the Shop ID from your manager"
            aria-describedby="bootstrap-shop-help"
          />
          <p id="bootstrap-shop-help" className="entry-state">
            Required only for first-time browser connection. Your Shop ID is available in TUX Admin → Devices.
          </p>
          <label htmlFor="bootstrap-worker-pin">Enter PIN to Sign In</label>
          <input
            id="bootstrap-worker-pin"
            name="bootstrap-worker-pin"
            type="password"
            inputMode="numeric"
            autoComplete="off"
            value={pin}
            onChange={(event) => setPin(event.target.value.replace(/\D/g, ''))}
            disabled={busy}
            autoFocus={shopId.length > 0}
            aria-describedby={error === null ? undefined : 'bootstrap-pin-error'}
          />
          {error === null ? null : (
            <p className="form-error" id="bootstrap-pin-error" role="alert">
              {error}
            </p>
          )}
          <button className="primary-action" type="submit" disabled={busy || pin.length === 0}>
            {busy ? 'Checking…' : 'Sign In'}
          </button>
        </form>
      </section>
    </main>
  );
}
