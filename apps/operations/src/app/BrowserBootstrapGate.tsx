import { type OperationsSessionState } from '@tux/application';
import { type FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { App } from './App';
import { createOperationsSessionClient } from './sessionClient';

type ActiveSession = Extract<OperationsSessionState, { status: 'ACTIVE' }>;
type GateState = 'LOADING' | 'PIN_REQUIRED' | 'READY';
type Branch = { readonly id: string; readonly name: string };
const LAST_BRANCH_KEY = 'tux.operations.last-branch';

// This fixture-only bypass exists solely in a deliberately named non-production
// Vite build, on loopback. Production and the branch-picker E2E build still
// require the server-authorized Branch + PIN flow.
const LEGACY_BROWSER_E2E =
  import.meta.env.MODE === 'e2e-browser-fallback' &&
  (window.location.hostname === '127.0.0.1' ||
    window.location.hostname === 'localhost' ||
    window.location.hostname.endsWith('.localhost'));

function preferredBranch(): string {
  try {
    return window.localStorage.getItem(LAST_BRANCH_KEY) ?? '';
  } catch {
    return '';
  }
}

async function fetchBranches(): Promise<readonly Branch[]> {
  const response = await fetch('/api/operations-shops', {
    method: 'GET',
    credentials: 'same-origin',
    cache: 'no-store',
  });
  if (!response.ok) throw new Error('Branches are temporarily unavailable. Try again.');
  const data: unknown = await response.json();
  if (!data || typeof data !== 'object' || !('shops' in data)) throw new Error();
  const shops = (data as { shops?: unknown }).shops;
  if (!Array.isArray(shops)) throw new Error();
  if (!shops.every((shop) => typeof shop?.id === 'string' && typeof shop?.name === 'string')) {
    throw new Error();
  }
  return shops as Branch[];
}

function Brand() {
  return <img className="tux-brand" src="/favicon.svg" alt="TUX" />;
}

export function BrowserBootstrapGate() {
  const client = useMemo(() => createOperationsSessionClient(), []);
  const [state, setState] = useState<GateState>(
    window.tuxDesktop !== undefined || LEGACY_BROWSER_E2E ? 'READY' : 'LOADING',
  );
  const [freshAuthenticatedSession, setFreshAuthenticatedSession] = useState<ActiveSession>();
  const [pin, setPin] = useState('');
  const [shops, setShops] = useState<readonly Branch[]>([]);
  const [shopId, setShopId] = useState('');
  const [shopLoading, setShopLoading] = useState(false);
  const [shopError, setShopError] = useState<string | null>(null);
  const [reloadShops, setReloadShops] = useState(0);
  const pinInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (window.tuxDesktop !== undefined || LEGACY_BROWSER_E2E) return;
    let cancelled = false;
    void client.getState().then((result) => {
      if (cancelled) return;
      setState(result.ok && result.value.status === 'ACTIVE' ? 'READY' : 'PIN_REQUIRED');
      if (!result.ok) setError(result.error.message);
    });
    return () => {
      cancelled = true;
    };
  }, [client]);

  useEffect(() => {
    if (state !== 'PIN_REQUIRED') return;
    let cancelled = false;
    setShopLoading(true);
    setShopError(null);
    void fetchBranches()
      .then((loaded) => {
        if (cancelled) return;
        setShops(loaded);
        setShopId((current) => {
          if (loaded.some((shop) => shop.id === current)) return current;
          const saved = preferredBranch();
          if (loaded.some((shop) => shop.id === saved)) return saved;
          return loaded.length === 1 ? loaded[0]!.id : '';
        });
      })
      .catch(() => {
        if (cancelled) return;
        setShops([]);
        setShopId('');
        setShopError('Could not load branches. Check your connection and retry.');
      })
      .finally(() => {
        if (!cancelled) setShopLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [state, reloadShops]);

  useEffect(() => {
    if (state === 'PIN_REQUIRED' && !shopLoading && shopId) pinInput.current?.focus();
  }, [state, shopLoading, shopId]);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (busy || shopLoading || pin.length === 0) return;
    if (!shops.some((shop) => shop.id === shopId)) {
      setError('Choose your branch before entering your PIN.');
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
      try {
        window.localStorage.setItem(LAST_BRANCH_KEY, shopId);
      } catch {
        // Remembering a branch is optional; server authentication is authoritative.
      }
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
          <label htmlFor="bootstrap-branch">Branch</label>
          <select
            id="bootstrap-branch"
            name="branch"
            value={shopId}
            onChange={(event) => {
              setShopId(event.target.value);
              setPin('');
              setError(null);
            }}
            disabled={busy || shopLoading || !!shopError}
            aria-describedby={shopError ? 'bootstrap-branch-error' : undefined}
            required
          >
            <option value="">{shopLoading ? 'Loading branches…' : 'Choose your branch'}</option>
            {shops.map((shop) => (
              <option key={shop.id} value={shop.id}>
                {shop.name}
              </option>
            ))}
          </select>
          {shopError ? (
            <div className="branch-load-error" id="bootstrap-branch-error" role="alert">
              <span>{shopError}</span>
              <button type="button" onClick={() => setReloadShops((value) => value + 1)}>
                Retry
              </button>
            </div>
          ) : null}
          {!shopLoading && !shopError && shops.length === 0 ? (
            <p className="entry-branch-hint" role="status">
              No active branches available. Contact your manager.
            </p>
          ) : null}
          <label htmlFor="bootstrap-worker-pin">Enter PIN to Sign In</label>
          <input
            id="bootstrap-worker-pin"
            name="bootstrap-worker-pin"
            type="password"
            inputMode="numeric"
            autoComplete="off"
            value={pin}
            onChange={(event) => setPin(event.target.value.replace(/\D/g, ''))}
            disabled={busy || shopLoading || !shopId}
            ref={pinInput}
            aria-describedby={error === null ? undefined : 'bootstrap-pin-error'}
          />
          {error === null ? null : (
            <p className="form-error" id="bootstrap-pin-error" role="alert">
              {error}
            </p>
          )}
          <button
            className="primary-action"
            type="submit"
            disabled={busy || shopLoading || !shopId || pin.length === 0}
          >
            {busy ? 'Checking…' : 'Sign In'}
          </button>
        </form>
      </section>
    </main>
  );
}
