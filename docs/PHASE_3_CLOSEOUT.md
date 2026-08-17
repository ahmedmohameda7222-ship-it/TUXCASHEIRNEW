# Phase 3 Closeout — Business Day + Operator

## Scope implemented

Phase 3 implements the approved worker-entry/session slice only:

- local active-shop resolution without hard-coded production shop identity;
- PIN verification abstraction backed by versioned PBKDF2-SHA256 hashes;
- no-active-Business-Day PIN entry;
- valid PIN creates a Business Day only when none is open;
- valid PIN joins the already-open Business Day rather than creating another;
- Current Operator persistence through durable worker sessions;
- intentional PIN-based worker switching;
- operator sign-out without Business Day close;
- approved time-aware greeting copy and 1.25-second transition;
- narrow Electron preload/session IPC and equivalent browser IndexedDB client;
- worker-session audit/outbox facts;
- SQLite migration v2 enforcing one open worker session per Business Day.

Full Orders checkout, Orders Board, Expenses, Bulk Stock, End Day and Admin behavior remain outside Phase 3.

## Security and provisioning boundary

Production source contains no usable plaintext worker PIN and no hard-coded production shop UUID.

Worker records contain only a versioned hash string. The implemented verifier accepts the format:

```text
pbkdf2-sha256$<iterations>$<salt-hex>$<digest-hex>
```

with SHA-256, a 32-byte derived key and at least 100,000 iterations. Desktop comparison uses Node `timingSafeEqual`; browser fallback derives with WebCrypto and performs a constant-time byte comparison.

A usable device still requires provisioned local shop/worker data. Phase 3 deliberately does not invent bootstrap credentials.

Electron exposes only `session.getState`, `session.submitPin` and `session.signOut` through the typed preload contract. The preload validates the complete session result shape before returning it to React.

## Persistence invariants

SQLite migration v2 adds:

```sql
CREATE UNIQUE INDEX ux_worker_sessions_one_open_per_business_day
ON worker_sessions(business_day_id)
WHERE ended_at IS NULL;
```

This supplements the existing one-open-Business-Day-per-shop constraint. Phase 3 application commands are serialized in-process and all Business Day/session writes remain inside the shared durable transaction boundary.

Browser fallback uses the same application service over IndexedDB. The browser path does not claim an equivalent cross-tab database uniqueness constraint yet.

## Validation evidence

GitHub Actions run `32068287692` on branch head `46f8eb3bc1968a1842414fdb92ce702dfae3e332` passed:

- locked dependency install (`npm ci`) with 0 reported vulnerabilities;
- Prettier check;
- ESLint;
- strict TypeScript source typecheck;
- Vitest unit/integration tests;
- Operations browser production build;
- bundled Electron main/preload production builds.

The tests cover invalid PIN no-mutation behavior, Business Day start/recovery, same-day worker switch, sign-out preserving the open day, database rejection of a second open worker session, greeting salutation boundaries, Node PBKDF2 verification, and preload response validation.

## Known non-claim

The canonical product plan calls for the TUX logo on the locked screen. No approved graphic logo asset exists in the current V2 repository, so Phase 3 uses a typographic `TUX` brand fallback. The corresponding visual requirement must not be marked fully compliant until the approved asset is supplied and validated.

The greeting timer is explicitly 1,250 ms in the renderer, within the approved 1–1.5 second range. There is no browser/Electron end-to-end timing assertion yet; final E2E remains Phase 10 work.
