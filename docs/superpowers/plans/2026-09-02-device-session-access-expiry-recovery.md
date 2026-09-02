# Device Session Access Expiry Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow an already-enrolled browser whose short-lived `tux_ops_access` cookie has naturally expired/disappeared to recover the device session from the still-valid durable refresh/shop/device cookies, without changing device authorization or worker-PIN security semantics.

**Architecture:** Keep the correction centralized in `server/supabaseGateway.ts`. Represent the stored browser device identity as either a fully usable session (access + refresh + shop + device), a refreshable session (refresh + shop + device but no access token), or not enrolled. `resolveDeviceSession()` must immediately refresh a refreshable session, preserve the existing near-expiry refresh path for a present access token, and preserve existing authoritative-invalid, transport-unavailable, and protocol-error classifications.

**Tech Stack:** TypeScript 6, Node HTTP gateway, Vitest 4, Supabase Auth refresh-token endpoint, GitHub Actions TUX V2 CI.

**Spec:** User-provided Production incident and recovery contract from 2026-09-02.

## Global Constraints

- NO production code before an independently demonstrated RED regression.
- Do not clear/re-enroll the Production browser as a workaround.
- Do not modify Supabase migrations or Edge Functions.
- Do not modify HMAC/bootstrap provenance or `worker-auth` behavior.
- Do not change worker PIN semantics, Business Day semantics, or offline fallback classification.
- Do not weaken device authorization or treat invalid/revoked refresh tokens as offline availability.
- Do not extend access-cookie lifetime, add retries, add delays, or move the fix outside the Vercel device-session resolution boundary.
- Open a narrow PR and DO NOT MERGE.

---

### Task 1: Reproduce the Missing-Access-Cookie Failure

**Files:**
- Modify: `server/workerAuthenticationGateway.refresh.test.ts`

**Interfaces:**
- Consumes: `proxyWorkerAuthentication(request, response)` and the existing cookie/session gateway behavior.
- Produces: a permanent regression demonstrating that `tux_ops_refresh` + `tux_ops_shop` + `tux_ops_device` without `tux_ops_access` must refresh and continue to worker authentication.

- [ ] **Step 1: Extend the test request helper for the Production cookie state**

Add a request path that emits these cookies only:

```text
tux_ops_refresh=refresh-token
tux_ops_shop=<valid UUID>
tux_ops_device=<valid UUID>
```

with no `tux_ops_access` cookie.

- [ ] **Step 2: Add the failing behavior test**

Mock `fetch` in order:

1. Supabase `/auth/v1/token?grant_type=refresh_token` returns a valid refreshed `access_token`, `refresh_token`, and expiry.
2. Supabase `/functions/v1/worker-auth` returns HTTP 200 with a valid authenticated worker payload.

Assert:

```text
refresh endpoint called with refresh-token
set-cookie contains refreshed access and refresh cookies
worker-auth called with Bearer <refreshed access token>
proxy returns the worker-auth HTTP 200 payload
```

- [ ] **Step 3: Run only the regression and verify RED**

Run:

```bash
npm test -- server/workerAuthenticationGateway.refresh.test.ts -t "refreshes when the access cookie has naturally expired"
```

Expected failure on the unmodified production code: response is HTTP 401 with `{ error: 'device_authentication_required' }`; the refresh endpoint is never reached because the missing access cookie is currently classified as `NOT_ENROLLED`.

- [ ] **Step 4: Commit RED evidence**

Commit only the test change with a message such as:

```text
test: reproduce missing access-cookie session recovery
```

Record the exact commit SHA, GitHub Actions run ID, and assertion failure before any production change.

---

### Task 2: Make Durable Device Identity Refreshable Without an Access Cookie

**Files:**
- Modify: `server/supabaseGateway.ts`
- Test: `server/workerAuthenticationGateway.refresh.test.ts`

**Interfaces:**
- Consumes: durable cookie state `{ shopId, deviceId, refreshToken }` and optional access token.
- Produces: `resolveDeviceSession()` behavior that distinguishes fully usable, refreshable, and not-enrolled stored sessions while still returning the existing public `DeviceSessionResolution` statuses.

- [ ] **Step 1: Introduce an internal stored-session distinction**

Use an internal representation equivalent to:

```ts
type StoredDeviceSession =
  | {
      readonly status: 'USABLE';
      readonly session: DeviceSessionSecrets;
    }
  | {
      readonly status: 'REFRESHABLE';
      readonly shopId: string;
      readonly deviceId: string;
      readonly refreshToken: string;
    }
  | { readonly status: 'NOT_ENROLLED' };
```

The exact names may follow the existing file style, but the semantics must be explicit.

- [ ] **Step 2: Parse durable identity independently from the access cookie**

`readDeviceSession()` (or its replacement) must require valid `shopId`, valid `deviceId`, and non-empty `refreshToken` for enrollment. A missing access token must produce the refreshable state rather than `null`/`NOT_ENROLLED`. Invalid/missing durable shop/device/refresh identity remains `NOT_ENROLLED`.

- [ ] **Step 3: Allow the refresh function to consume refreshable state**

Refactor `refreshDeviceSession()` so it receives the durable `shopId`, `deviceId`, and `refreshToken` rather than requiring a pre-existing access token. On a successful Supabase refresh response, construct a full `DeviceSessionSecrets`, persist refreshed access/refresh cookies with the existing expiry logic, and return `VALID`.

- [ ] **Step 4: Update `resolveDeviceSession()` minimally**

Required state machine:

```text
no durable shop/device/refresh identity -> NOT_ENROLLED
refreshable identity, no access token -> refresh immediately
usable identity, access exp > 120s -> VALID
usable identity, access exp <= 120s -> refresh
malformed access JWT -> PROTOCOL_ERROR (unchanged)
refresh 400/401/403 -> AUTHORITATIVELY_INVALID (unchanged)
refresh transport failure -> TRANSPORT_UNAVAILABLE (unchanged)
malformed/non-2xx refresh response -> PROTOCOL_ERROR (unchanged)
```

- [ ] **Step 5: Run the focused regression and verify GREEN**

Run:

```bash
npm test -- server/workerAuthenticationGateway.refresh.test.ts -t "refreshes when the access cookie has naturally expired"
```

Expected: PASS.

- [ ] **Step 6: Run the complete refresh-classification suite**

Run:

```bash
npm test -- server/workerAuthenticationGateway.refresh.test.ts
```

Expected: all tests PASS, including transport outage, timeout, authoritative refresh rejection, malformed refresh protocol response, invalid worker PIN, and device-not-authorized behavior.

---

### Task 3: Verify Related Device-Session Boundaries

**Files:**
- Modify only if a failing related test proves an existing fixture needs alignment; production scope remains `server/supabaseGateway.ts`.
- Test: existing `server/*device*`, `server/*workerAuthentication*`, and gateway tests selected by Vitest.

**Interfaces:**
- Consumes: the new internal stored-session parsing semantics.
- Produces: evidence that no unrelated session/security classification regressed.

- [ ] **Step 1: Run related server/device-session tests**

Run focused Vitest for matching server tests, including the full worker-authentication refresh suite and any server gateway tests that exercise enrollment/session cookies.

- [ ] **Step 2: Verify cookie-security invariants**

Confirm from tests/code that:

```text
invalid/revoked refresh -> clears durable cookies + device_session_invalid
transport outage -> no cookie clearing + device_session_unavailable
protocol error -> no offline conversion
worker PIN response semantics unchanged
```

- [ ] **Step 3: Commit the minimal production fix**

Commit the gateway production change plus any necessary test fixture alignment with a narrow message such as:

```text
fix: recover device session after access-cookie expiry
```

---

### Task 4: Permanent Verification and PR

**Files:**
- No additional source files unless a permanent gate exposes a concrete defect.

**Interfaces:**
- Produces: exact-head evidence and an open, unmerged bugfix PR.

- [ ] **Step 1: Run formatting and lint gates**

```bash
npm run format:check
npm run lint
```

- [ ] **Step 2: Run the full unit/integration suite**

```bash
npm test
```

- [ ] **Step 3: Run typecheck and production builds**

```bash
npm run typecheck
npm run build
```

- [ ] **Step 4: Run the repository's permanent full CI through GitHub Actions**

The PR-triggered TUX V2 CI must pass every permanent job, including quality, local migration-chain smoke, Supabase function auth deployment contract, Edge checks, rendered browser E2E, Windows packaging, and the aggregate Required quality gate.

- [ ] **Step 5: Audit scope before handoff**

Compare the branch to starting `main` and verify there are no changes to:

```text
supabase/migrations/**
supabase/functions/**
HMAC/bootstrap provenance
worker-auth implementation
Business Day logic
offline fallback/security semantics
```

- [ ] **Step 6: Open the narrow PR and do not merge**

PR title should identify access-expiry device-session recovery. Include RED evidence, root cause, exact GREEN head/run, and explicit scope exclusions.

## Self-Review

- Spec coverage: RED-before-production, exact missing-cookie state, immediate refresh, persisted refreshed cookies, continued worker-auth, reload/security classifications, focused verification, full CI, narrow PR, and no merge are all covered.
- Placeholder scan: no TBD/TODO/implicit implementation steps remain.
- Type consistency: public `DeviceSessionResolution` and `DeviceSessionSecrets` remain unchanged; only the internal stored-session representation is broadened to model a refreshable state.
