# TUX Operations Security Closeout Implementation Plan

> **Required workflow:** execute with `superpowers:systematic-debugging`, `superpowers:test-driven-development`, and `superpowers:verification-before-completion`. Do not change production behavior before the corresponding regression test has been observed RED.

**Goal:** Close the three approved Operations authentication findings without weakening offline-first transaction semantics: caller-controlled PIN rate-limit identity, partial first-use bootstrap trust, and stale online worker credentials.

**Starting authority:** current `main` at `bb133b3e339711e86d29cfb59b25430b0849a3fc` (2026-09-01). Work is isolated on `fix/operations-security-closeout`. No production deployment, remote Supabase mutation, or historical migration rewrite is permitted.

**Architecture:** Keep the existing local-first Operations database and configuration snapshot as the durable runtime substrate. Treat a local installation as activated only when active local identity and a validated durable configuration snapshot coexist. Add an explicit worker-authentication authority boundary so reachable-server authentication is authoritative while genuine transport/backend unavailability can fall back only to an already activated local installation. Bootstrap rate limiting uses deployment-trusted request-source information rather than request-body/device/User-Agent identities. Browser and Electron use the same application security semantics while adapting their different authenticated transports.

**Technology:** TypeScript, Vitest, IndexedDB/SQLite repositories, Vercel server routes, Supabase Edge Functions/PostgreSQL, Playwright, Electron packaging.

## Task 1 — P1-1: reproduce caller-controlled rate-limit bypass

**Files:**
- Add `server/workerPinBootstrap.test.ts`
- Extend migration/Edge-function tests only where behavioral coverage requires it

**Steps:**
1. Add behavioral tests exercising the server route's actual rate-limit identity derivation.
2. Prove the same trusted request source cannot obtain fresh buckets by rotating `deviceId`, device label, User-Agent, or other caller-controlled input.
3. Cover attempt ceiling persistence, legitimate window expiry, and documented successful-auth reset behavior at the PostgreSQL function boundary.
4. Commit the tests and observe the permanent branch CI fail for the expected identity-bypass assertion before production changes.

## Task 2 — P1-1: harden PIN abuse identity

**Files:**
- Modify `server/workerPinBootstrap.ts`
- Add append-only migration only if the existing rate-limit function cannot express the required policy
- Update security documentation with the trusted-proxy threat model

**Steps:**
1. Derive the primary bootstrap abuse bucket only from deployment-trusted request-source information supplied by the Vercel boundary; never from request body, User-Agent, or browser-generated UUID.
2. Fail conservatively when a trusted source identity is unavailable instead of accepting a spoofable fallback.
3. Preserve the existing finite attempt/window/reset policy unless tests prove a database change is necessary.
4. Run focused tests and observe GREEN before continuing.

## Task 3 — P1-2: reproduce partial bootstrap activation

**Files:**
- Add application/persistence integration coverage for durable activation
- Add browser bootstrap orchestration coverage at an injectable production boundary

**Steps:**
1. Prove identity-only local persistence followed by configuration `REMOTE_UNAVAILABLE` cannot become an active session after reload.
2. Repeat for invalid remote configuration and local configuration persistence failure.
3. Exercise crash/reload boundaries around identity and configuration installation.
4. Prove an existing last-known-good activated installation remains usable when a later refresh fails.
5. Observe RED against the current session readiness behavior before fixing it.

## Task 4 — P1-2: make activation durable and atomic in meaning

**Files:**
- Modify `packages/application/src/session.ts` and/or a focused activation service
- Modify `apps/operations/src/app/sessionClient.ts`
- Modify persistence only if a separate durable activation marker is necessary

**Steps:**
1. Make trusted readiness depend on durable validated configuration, not a UI flag or remote cookie.
2. Stage first-use remote identity until configuration validation/persistence succeeds; do not leave a first-use worker cache that can authenticate independently.
3. Keep previously valid last-known-good configuration intact on later failures.
4. Run the P1-2 focused suite GREEN.

## Task 5 — P1-3: reproduce stale online worker authentication

**Files:**
- Add shared application worker-authentication integration tests
- Add browser remote gateway tests
- Extend Electron/session tests for parity

**Steps:**
1. Cover cached worker deactivation and PIN rotation with the backend reachable.
2. Prove authoritative invalid/deactivated and 429 responses never fall back to cached success.
3. Prove new authoritative PIN refreshes the local worker representation.
4. Prove genuine remote unavailability permits fallback only for a fully activated installation.
5. Prove fresh/unprovisioned offline clients are rejected, device identity is stable, and worker switching remains correct.
6. Cover 400, 401/403, 429, 5xx, network timeout, invalid remote response, configuration validation failure, and local persistence failure as distinct security outcomes.
7. Observe RED before implementing authoritative online authentication.

## Task 6 — P1-3: introduce authenticated worker revalidation

**Files:**
- Add a shared application worker-authentication authority/service
- Add browser authenticated gateway method/route
- Add Supabase authenticated worker-auth Edge Function
- Add desktop Supabase worker-auth gateway using the existing device session
- Wire browser and Electron session entry points to the shared semantics

**Steps:**
1. Add a revalidation endpoint that requires an already authenticated device session and never registers or rotates device identity.
2. Resolve shop/device authority server-side from the authenticated device session.
3. Treat 401/403 as authoritative rejection, 429 as throttling, malformed/invalid responses as non-fallback errors, and only genuine transport/backend unavailability as offline-fallback eligible.
4. On authoritative success, update the local worker cache to the current active worker/PIN hash before local session creation.
5. On authoritative rejection, fence any matching obsolete cached credential so it cannot win on the next attempt.
6. Preserve offline authentication only for an activated last-known-good installation.
7. Run browser and Electron focused suites GREEN.

## Task 7 — integrated security semantics and documentation

**Files:**
- Add/update focused integration tests
- Update `docs/ARCHITECTURE.md` and/or `docs/OFFLINE_AND_SYNC.md`
- Add a narrowly scoped authentication ADR if needed

**Steps:**
1. Document trusted vs untrusted bootstrap state, online authority vs offline fallback, source-IP bootstrap rate limiting, worker PIN rotation/deactivation, and the prohibition on caller-controlled security identities.
2. Re-run focused P1-1/P1-2/P1-3 suites together.
3. Independently inspect the diff for scope creep, historical migration edits, secret exposure, Admin work, and Delivery/End Day semantics changes.

## Task 8 — final repository verification and handoff

From the exact final branch head run/obtain fresh evidence for:

```bash
npm ci
npm run format:check
npm run lint
npm run test
npm run typecheck
npm run build
npm run test:migrations
npm run test:e2e
npm run package:win -- --publish never
```

Also run every focused security suite introduced above. Push the exact final branch, open a PR against current `main`, and verify the permanent `TUX V2 CI / Required quality gate` on that exact PR head. Do not merge. Hand off to Planner/Auditor with exact RED/GREEN evidence, commit SHAs, CI run ID, file list, migration status, and any remaining in-scope finding.
