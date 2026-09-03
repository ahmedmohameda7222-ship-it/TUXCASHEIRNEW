# TUX Operations WhatsApp Task 5.1 + Corrected Task 6 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the Task 5 package-layer cycle, then expose one production-safe WhatsApp application service through both browser and hardened Electron runtimes while keeping `/api/whatsapp` as the single server-side authority.

**Architecture:** `@tux/persistence` owns neutral local-cache DTOs; `@tux/application` owns WhatsApp behavior and the remote gateway contract. Browser composes `OperationsWhatsAppService + IndexedDbWhatsAppStore + VercelBrowserWhatsAppRemote`; Electron main composes `OperationsWhatsAppService + SqliteWhatsAppStore + DesktopWhatsAppRemote`, then exposes only `TuxWhatsAppApi` through trusted IPC and defensive preload parsing. Both browser cookies and desktop bearer credentials are converted server-side into the same authoritative `{shopId, deviceId}` derived from Supabase Auth + RLS-visible enrolled-device records before any WhatsApp repository/provider logic runs.

**Tech Stack:** TypeScript 6, Vitest 4, React/Vite browser Operations, Electron 43, Node 24, SQLite, IndexedDB, Supabase Auth/PostgREST, existing Vercel `/api/whatsapp` route.

**Spec:** `docs/superpowers/specs/2026-09-03-whatsapp-runtime-transport-boundary-design.md`

## Global Constraints

- Implementation branch: `feat/operations-whatsapp-inbox`.
- Approved implementation baseline before this plan: `66c981af26c4aa6779a414e78f3642c31ef4ee3e`.
- Do not rewrite Tasks 1–5 behavior except the narrow Task 5.1 package-layer cleanup defined here.
- `@tux/persistence` must have zero source imports from `@tux/application`, including `import type`.
- Browser and Windows use one `OperationsWhatsAppService` behavior layer and one `/api/whatsapp` server authority.
- Desktop must not call Meta or WhatsApp Supabase RPCs directly.
- Renderer/preload/application/persistence must never receive Meta credentials, Supabase service-role credentials, or refresh tokens.
- Desktop bearer presentation uses `Authorization: Bearer <access token>` plus `x-tux-device-id`; it does not send `shopId`, refresh token, service-role key, Meta credential, or provider phone number.
- Browser cookie `shopId` is not tenant authority; server must derive shop from the authenticated enrolled device and reject a mismatch.
- If either desktop auth header is present, desktop auth mode is selected and invalid/incomplete desktop credentials must not fall back to cookies.
- Browser POST same-origin protection remains active. Desktop main may omit `Origin`; if `Origin` is present, the same-origin fence still applies.
- `TuxWhatsAppApi` methods: `loadInbox`, `loadConversation`, `sendText`, `markUnread`, `archive`, `setFollowUp`, `linkOrder`, `saveDraft`, `getDraft`.
- `sendMedia` remains absent.
- Only transient `REMOTE_UNAVAILABLE` may trigger cached-inbox fallback. Authoritative device invalidation must use `DEVICE_AUTH_INVALID` and must not masquerade as offline availability.
- Task 6 adds no offline WhatsApp send queue and no automatic reconnect replay.
- No new remote SQL migration is required by this plan.
- Do not reapply the already-production WhatsApp migrations.
- Do not insert/update production `whatsapp_channels`, configure Meta, mutate Vercel production env, or deploy application code while executing this plan.
- `TUX_OPERATIONS_API_ORIGIN` is a non-secret pre-release transport origin only. It must be HTTPS and contain no path/query/fragment/credentials. Durable provisioning remains the later First-run Device Activation task.
- Strict TDD for every task: RED -> verify intended failure -> minimal GREEN -> verify GREEN -> related regression gate -> commit.
- If a documented RED unexpectedly passes or fails for a materially different reason, STOP and report evidence rather than manufacturing a failure.

---

## File Structure Locked by This Plan

### Task 5.1 package boundary

- `scripts/test-whatsapp-package-layering.mjs` — permanent static architecture guard preventing persistence -> application imports.
- `packages/persistence/src/whatsappStore.ts` — persistence-owned cache DTOs and store contract.
- `packages/application/src/whatsappRemote.ts` — application remote snapshot aliases/superset and remote error codes.
- `package.json` — add the architecture guard to a named script.

### Shared WhatsApp wire codec

- `packages/application/src/whatsappWire.ts` — runtime-safe parsing of WhatsApp HTTP response payloads and HTTP error mapping shared by browser and desktop remotes.
- `packages/application/src/whatsappWire.test.ts` — parser/error contract tests.
- `packages/application/src/index.ts` — export shared WhatsApp runtime pieces.
- `apps/operations/src/app/browserWhatsAppRemote.ts` — reduced to browser fetch/credentials mechanics plus shared codec.
- `apps/operations/src/app/browserWhatsAppRemote.test.ts` — browser auth/error behavior.

### Unified server device authority

- `server/operationsDeviceAuthority.ts` — user-scoped Supabase Auth/PostgREST verifier deriving `{shopId, deviceId}`.
- `server/operationsDeviceAuthority.test.ts` — authority derivation/failure tests.
- `server/supabaseGateway.ts` — export `SupabaseServerConfig`; retain browser cookie refresh behavior.
- `server/whatsappOperationsGateway.ts` — deterministic browser-vs-desktop presentation selection and server-derived authority.
- `server/whatsappOperationsGateway.test.ts` — browser/desktop integration, downgrade, CSRF, cross-tenant tests.

### Desktop transport/runtime

- `apps/operations-desktop/src/main/desktopWhatsAppRemote.ts` — HTTPS API origin validation, device-session resolution, bearer remote adapter.
- `apps/operations-desktop/src/main/desktopWhatsAppRemote.test.ts` — transport/session/security tests.
- `apps/operations-desktop/src/main/whatsappIpc.ts` — WhatsApp IPC channels, payload validation, trusted-sender fencing.
- `apps/operations-desktop/src/main/whatsappIpc.test.ts` — IPC validation and complete method bridge tests.
- `apps/operations-desktop/src/main/index.ts` — compose SQLite WhatsApp store/service/remote/runtime; close on quit.
- `apps/operations-desktop/src/preload/whatsappResult.ts` — defensive parser for WhatsApp application results crossing IPC.
- `apps/operations-desktop/src/preload/whatsappResult.test.ts` — malformed result rejection tests.
- `apps/operations-desktop/src/preload/index.ts` — expose `tuxDesktop.whatsapp` only through IPC.
- `packages/platform-contracts/index.d.ts` — `TuxWhatsAppApi` and `TuxDesktopApi.whatsapp`.

### Browser composition

- `apps/operations/src/app/sessionClient.ts` — compose browser WhatsApp service and export `createOperationsWhatsAppClient()`.
- `apps/operations/src/app/sessionClient.whatsapp.test.ts` — browser/desktop selection and public API parity.

---

# Phase 1 — Task 5.1: Remove the Package-Layer Cycle

### Task 1: Make persistence own the local WhatsApp cache DTOs

**Files:**
- Create: `scripts/test-whatsapp-package-layering.mjs`
- Modify: `packages/persistence/src/whatsappStore.ts`
- Modify: `packages/application/src/whatsappRemote.ts`
- Modify: `package.json`
- Test: existing `packages/persistence/src/whatsappStore.test.ts`
- Test: existing `packages/application/src/whatsapp.test.ts`

**Interfaces:**
- Produces `CachedWhatsAppOrderLink` and `CachedWhatsAppInboxSnapshot` from `@tux/persistence`.
- Preserves application exports `WhatsAppInboxOrderLink` and `WhatsAppInboxSnapshot`; application aliases the order-link type and extends the persistence snapshot with `nextCursor`.
- Changes `WhatsAppStore.upsertRemoteSnapshot` to consume `CachedWhatsAppInboxSnapshot`; application remote snapshots remain structurally assignable because they are a strict superset.

- [ ] **Step 1: Write the architecture guard before changing imports**

Create `scripts/test-whatsapp-package-layering.mjs`:

```js
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const persistenceRoot = path.join(root, 'packages', 'persistence', 'src');

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) return sourceFiles(target);
      return entry.isFile() && /\.(?:ts|tsx)$/.test(entry.name) ? [target] : [];
    }),
  );
  return nested.flat();
}

const violations = [];
for (const filename of await sourceFiles(persistenceRoot)) {
  const source = await readFile(filename, 'utf8');
  if (/from\s+['"]@tux\/application(?:['"\/])/.test(source)) {
    violations.push(path.relative(root, filename));
  }
}

assert.deepEqual(
  violations,
  [],
  `Persistence must not import @tux/application. Violations: ${violations.join(', ')}`,
);

console.log('WhatsApp package-layering guard passed.');
```

- [ ] **Step 2: Run RED and verify the existing cycle is detected**

Run:

```bash
node scripts/test-whatsapp-package-layering.mjs
```

Expected RED: assertion failure naming `packages/persistence/src/whatsappStore.ts` as a violation.

- [ ] **Step 3: Move cache DTO ownership into persistence**

Replace the application imports in `packages/persistence/src/whatsappStore.ts` with persistence-owned types:

```ts
import type {
  Instant,
  OrderId,
  ShopId,
  WhatsAppConversation,
  WhatsAppMessage,
  WhatsAppQuickReply,
} from '@tux/domain';

export interface CachedWhatsAppOrderLink {
  readonly conversationId: string;
  readonly orderId: OrderId;
  readonly linkedAt: Instant;
}

export interface WhatsAppDraft {
  readonly shopId: ShopId;
  readonly conversationId: string;
  readonly text: string;
  readonly updatedAt: Instant;
}

export interface CachedWhatsAppInboxSnapshot {
  readonly conversations: readonly WhatsAppConversation[];
  readonly messages: readonly WhatsAppMessage[];
  readonly quickReplies: readonly WhatsAppQuickReply[];
  readonly orderLinks: readonly CachedWhatsAppOrderLink[];
}

export interface WhatsAppStore {
  initialize(): Promise<void>;
  upsertRemoteSnapshot(snapshot: CachedWhatsAppInboxSnapshot): Promise<void>;
  upsertMessage(message: WhatsAppMessage): Promise<void>;
  loadInbox(shopId: ShopId): Promise<CachedWhatsAppInboxSnapshot>;
  listMessages(shopId: ShopId, conversationId: string): Promise<readonly WhatsAppMessage[]>;
  saveDraft(draft: WhatsAppDraft): Promise<void>;
  getDraft(shopId: ShopId, conversationId: string): Promise<WhatsAppDraft | null>;
  close(): Promise<void>;
}

export const whatsappStoreContractVersion = 1 as const;
```

Update the persistence barrel to export `CachedWhatsAppOrderLink` together with the existing WhatsApp store types.

- [ ] **Step 4: Preserve application compatibility without reversing the dependency**

In `packages/application/src/whatsappRemote.ts`, import the persistence cache types and define:

```ts
import type { CachedWhatsAppInboxSnapshot, CachedWhatsAppOrderLink } from '@tux/persistence';

export type WhatsAppInboxOrderLink = CachedWhatsAppOrderLink;

export interface WhatsAppInboxSnapshot extends CachedWhatsAppInboxSnapshot {
  readonly nextCursor: string | null;
}
```

Keep all existing remote method signatures unchanged in this step.

- [ ] **Step 5: Add the permanent architecture command**

In root `package.json`, add:

```json
"test:whatsapp-architecture": "node scripts/test-whatsapp-package-layering.mjs"
```

Do not remove or rename any existing script.

- [ ] **Step 6: Run GREEN and Task 5 regression gates**

Run:

```bash
npm run test:whatsapp-architecture
npm test -- packages/persistence/src/whatsappStore.test.ts packages/application/src/whatsapp.test.ts packages/persistence/src/sqlite/SqliteWhatsAppStore.test.ts packages/persistence/src/browser/IndexedDbWhatsAppStore.test.ts
npm run typecheck -w @tux/persistence
npm run typecheck -w @tux/application
```

Expected: all commands PASS; no local schema behavior changes.

- [ ] **Step 7: Prove this cleanup did not touch local or remote schema definitions**

Run:

```bash
git diff 66c981af26c4aa6779a414e78f3642c31ef4ee3e -- \
  packages/persistence/src/sqlite/migrations.ts \
  packages/persistence/src/browser/indexedDbMigrations.ts \
  supabase/migrations
```

Expected: no schema-content changes. If the repository uses a different IndexedDB migration filename, inspect the existing Task 5 browser migration file and run the same diff against that exact file before committing.

- [ ] **Step 8: Commit Task 5.1 separately**

```bash
git add \
  scripts/test-whatsapp-package-layering.mjs \
  packages/persistence/src/whatsappStore.ts \
  packages/persistence/src/index.ts \
  packages/application/src/whatsappRemote.ts \
  package.json
git commit -m "refactor: remove WhatsApp persistence application dependency"
```

**Task 5.1 reviewer gate:** STOP after this commit and report RED/GREEN evidence plus the commit SHA before starting corrected Task 6 if the Planner/Auditor requested per-task review. Otherwise continue only under the already-approved executing plan.

---

# Phase 2 — Corrected Task 6: Unified Runtime + Desktop Transport

### Task 2: Add shared WhatsApp wire parsing and authoritative device-auth error semantics

**Files:**
- Create: `packages/application/src/whatsappWire.ts`
- Create: `packages/application/src/whatsappWire.test.ts`
- Modify: `packages/application/src/whatsappRemote.ts`
- Modify: `packages/application/src/whatsapp.ts`
- Modify: `packages/application/src/index.ts`
- Modify: `apps/operations/src/app/browserWhatsAppRemote.ts`
- Modify: `apps/operations/src/app/browserWhatsAppRemote.test.ts`

**Interfaces:**
- `WhatsAppRemoteErrorCode` gains `DEVICE_AUTH_INVALID`.
- `parseWhatsAppMessage(value: unknown): WhatsAppMessage`.
- `parseWhatsAppInboxSnapshot(value: unknown): WhatsAppInboxSnapshot`.
- `throwWhatsAppHttpError(status: number, payload: unknown): never` maps server wire errors to provider-agnostic `WhatsAppRemoteError` codes.
- Browser and later desktop remotes share these parsers; transport mechanics remain runtime-specific.

- [ ] **Step 1: Write the compile RED for the new remote error code**

Add this test to `packages/application/src/whatsapp.test.ts`:

```ts
it('does not treat authoritative device invalidation as transient cached-offline availability', async () => {
  vi.mocked(remote.loadInbox).mockRejectedValue(
    new WhatsAppRemoteError('DEVICE_AUTH_INVALID', 'Device session is invalid.'),
  );
  const service = new OperationsWhatsAppService(remote, store, session, () => now);

  const result = await service.loadInbox();

  expect(result).toMatchObject({ ok: false, error: { code: 'REMOTE_SYNC_ERROR' } });
  expect(store.loadInbox).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run compile RED**

```bash
npm run typecheck -w @tux/application
```

Expected RED: TypeScript rejects `'DEVICE_AUTH_INVALID'` because the union does not contain it.

- [ ] **Step 3: Extend the remote error contract minimally**

Update `WhatsAppRemoteErrorCode` in `packages/application/src/whatsappRemote.ts`:

```ts
export type WhatsAppRemoteErrorCode =
  | 'OPERATOR_NOT_SYNCHRONIZED'
  | 'OUTBOUND_INTENT_CONFLICT'
  | 'DELIVERY_UNCERTAIN'
  | 'REMOTE_UNAVAILABLE'
  | 'DEVICE_AUTH_INVALID';
```

Update `remoteCode()` in `packages/application/src/whatsapp.ts` to recognize `DEVICE_AUTH_INVALID`. Do not add it to cached fallback; the existing fallback condition remains exactly `remoteCode(cause) === 'REMOTE_UNAVAILABLE'`.

Add an explicit `DEVICE_AUTH_INVALID` branch in `mapRemoteError()` returning `REMOTE_SYNC_ERROR`, for example:

```ts
if (code === 'DEVICE_AUTH_INVALID') {
  return remoteSync('The enrolled Operations device session is no longer valid.', error);
}
```

- [ ] **Step 4: Run compile/application GREEN**

```bash
npm run typecheck -w @tux/application
npm test -- packages/application/src/whatsapp.test.ts
```

Expected: PASS.

- [ ] **Step 5: Write runtime RED for the shared wire codec**

Create `packages/application/src/whatsappWire.test.ts` with tests that import the not-yet-created module:

```ts
import { describe, expect, it } from 'vitest';
import { WhatsAppRemoteError } from './whatsappRemote';
import {
  parseWhatsAppInboxSnapshot,
  parseWhatsAppMessage,
  throwWhatsAppHttpError,
} from './whatsappWire';

const message = {
  id: 'provider-message-1',
  shopId: '11111111-1111-4111-8111-111111111111',
  conversationId: '22222222-2222-4222-8222-222222222222',
  providerMessageId: 'wamid.1',
  outboundIntentKey: null,
  direction: 'INBOUND',
  kind: 'TEXT',
  text: 'hello',
  mediaRef: null,
  status: 'DELIVERED',
  sentByWorkerId: null,
  initiatedByDeviceId: null,
  initiatedAt: null,
  createdAt: '2026-09-03T12:00:00.000Z',
};

describe('WhatsApp wire codec', () => {
  it('parses durable message and inbox payloads', () => {
    expect(parseWhatsAppMessage(message)).toMatchObject({ id: 'provider-message-1', text: 'hello' });
    expect(
      parseWhatsAppInboxSnapshot({
        conversations: [],
        messages: [message],
        quickReplies: [],
        orderLinks: [],
        nextCursor: null,
      }).messages,
    ).toHaveLength(1);
  });

  it('maps authoritative device-session rejection separately from transient outage', () => {
    expect(() =>
      throwWhatsAppHttpError(401, { error: 'device_session_invalid' }),
    ).toThrowError(WhatsAppRemoteError);
    try {
      throwWhatsAppHttpError(401, { error: 'device_session_invalid' });
    } catch (error) {
      expect(error).toMatchObject({ code: 'DEVICE_AUTH_INVALID' });
    }
  });
});
```

- [ ] **Step 6: Run module-missing RED**

```bash
npm test -- packages/application/src/whatsappWire.test.ts
```

Expected RED: module `./whatsappWire` does not exist.

- [ ] **Step 7: Extract the current browser wire parsing into `whatsappWire.ts`**

Move the existing runtime parsing logic from `apps/operations/src/app/browserWhatsAppRemote.ts` into `packages/application/src/whatsappWire.ts` without weakening validation. The module must export exactly:

```ts
export function parseWhatsAppMessage(value: unknown): WhatsAppMessage;
export function parseWhatsAppInboxSnapshot(value: unknown): WhatsAppInboxSnapshot;
export function throwWhatsAppHttpError(status: number, payload: unknown): never;
```

`throwWhatsAppHttpError` must preserve existing mappings:

```text
409 whatsapp_operator_not_synchronized -> OPERATOR_NOT_SYNCHRONIZED
409 whatsapp_outbound_intent_conflict   -> OUTBOUND_INTENT_CONFLICT
503 whatsapp_delivery_uncertain         -> DELIVERY_UNCERTAIN + messageId
```

and add:

```text
401 device_authentication_required -> DEVICE_AUTH_INVALID
401 device_session_invalid         -> DEVICE_AUTH_INVALID
401 device_authority_invalid       -> DEVICE_AUTH_INVALID
```

Every other non-success HTTP condition remains `REMOTE_UNAVAILABLE` at this boundary.

- [ ] **Step 8: Reduce browser remote to fetch mechanics + shared codec**

`VercelBrowserWhatsAppRemote` must still use:

```ts
fetch(url, {
  method,
  credentials: 'same-origin',
  cache: 'no-store',
  headers: body === undefined
    ? { accept: 'application/json' }
    : { accept: 'application/json', 'content-type': 'application/json' },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});
```

Parse responses with `parseWhatsAppInboxSnapshot`, `parseWhatsAppMessage`, and `throwWhatsAppHttpError`; do not retain a second copy of the domain parsers in the browser file.

- [ ] **Step 9: Run shared/browser GREEN**

```bash
npm test -- packages/application/src/whatsappWire.test.ts apps/operations/src/app/browserWhatsAppRemote.test.ts packages/application/src/whatsapp.test.ts
npm run typecheck -w @tux/application
npm run typecheck -w @tux/operations
```

Expected: PASS.

- [ ] **Step 10: Commit shared transport contract**

```bash
git add \
  packages/application/src/whatsappWire.ts \
  packages/application/src/whatsappWire.test.ts \
  packages/application/src/whatsappRemote.ts \
  packages/application/src/whatsapp.ts \
  packages/application/src/whatsapp.test.ts \
  packages/application/src/index.ts \
  apps/operations/src/app/browserWhatsAppRemote.ts \
  apps/operations/src/app/browserWhatsAppRemote.test.ts
git commit -m "refactor: share WhatsApp wire contract"
```

---

### Task 3: Derive browser and desktop tenant authority from the enrolled device server-side

**Files:**
- Create: `server/operationsDeviceAuthority.ts`
- Create: `server/operationsDeviceAuthority.test.ts`
- Modify: `server/supabaseGateway.ts`
- Modify: `server/whatsappOperationsGateway.ts`
- Modify: `server/whatsappOperationsGateway.test.ts`

**Interfaces:**

```ts
export interface OperationsDeviceAuthority {
  readonly shopId: ShopId;
  readonly deviceId: DeviceId;
}

export type OperationsDeviceAuthorityErrorCode =
  | 'DEVICE_AUTH_INVALID'
  | 'REMOTE_UNAVAILABLE';

export class OperationsDeviceAuthorityError extends Error {
  readonly code: OperationsDeviceAuthorityErrorCode;
}

export async function resolveOperationsDeviceAuthority(input: {
  readonly projectUrl: string;
  readonly publishableKey: string;
  readonly accessToken: string;
  readonly deviceId: DeviceId;
  readonly fetcher?: typeof fetch;
}): Promise<OperationsDeviceAuthority>;
```

- [ ] **Step 1: Write resolver RED**

Create `server/operationsDeviceAuthority.test.ts` importing the missing module. The first tests must prove:

```ts
it('derives shopId from the active RLS-visible device rather than caller shop input', async () => {
  // fetch sequence: auth/v1/user -> devices -> shop_memberships
  // device response returns shop 1111...; no shopId is supplied to the resolver input.
  // expect { shopId: 1111..., deviceId: 2222... }.
});

it('fails authoritatively when the device is not visible/active for the bearer user', async () => {
  // auth user succeeds; devices returns []
  // expect OperationsDeviceAuthorityError code DEVICE_AUTH_INVALID.
});

it('classifies transport failure as REMOTE_UNAVAILABLE', async () => {
  // fetch rejects on auth lookup
  // expect OperationsDeviceAuthorityError code REMOTE_UNAVAILABLE.
});
```

Use concrete valid UUIDs in test fixtures; do not use malformed IDs for these authority semantics tests.

- [ ] **Step 2: Run resolver module-missing RED**

```bash
npm test -- server/operationsDeviceAuthority.test.ts
```

Expected RED: module `./operationsDeviceAuthority` does not exist.

- [ ] **Step 3: Implement user-scoped authority verification**

`resolveOperationsDeviceAuthority` must:

1. Normalize `projectUrl` to HTTPS origin only.
2. Validate the bearer by GET `${projectUrl}/auth/v1/user` with:

```ts
{
  apikey: publishableKey,
  authorization: `Bearer ${accessToken}`,
  accept: 'application/json',
}
```

3. GET the candidate active device through PostgREST user context:

```text
/rest/v1/devices
  ?id=eq.<deviceId>
  &active=eq.true
  &select=id,shop_id
  &limit=2
```

using the same `apikey + authorization` headers.

4. Require exactly one device row. Derive `shopId` from `shop_id`.
5. GET membership through the same user context:

```text
/rest/v1/shop_memberships
  ?shop_id=eq.<derivedShopId>
  &active=eq.true
  &role=eq.OPERATIONS_DEVICE
  &select=shop_id,role
  &limit=2
```

6. Require exactly one matching row.
7. Return only `{shopId, deviceId}`.

Classification rules:

```text
401/403 from Auth or user-scoped authority reads -> DEVICE_AUTH_INVALID
zero/multiple device rows                       -> DEVICE_AUTH_INVALID
zero/multiple OPERATIONS_DEVICE memberships     -> DEVICE_AUTH_INVALID
network/timeout/non-auth upstream 5xx            -> REMOTE_UNAVAILABLE
malformed authority response                    -> REMOTE_UNAVAILABLE
```

The resolver never accepts a caller `shopId`.

- [ ] **Step 4: Export the existing server config type**

Change only the declaration in `server/supabaseGateway.ts`:

```ts
export interface SupabaseServerConfig {
  readonly projectUrl: string;
  readonly publishableKey: string;
}
```

Do not alter cookie names, refresh semantics, 120-second margin, or browser enrollment behavior in this step.

- [ ] **Step 5: Run resolver GREEN**

```bash
npm test -- server/operationsDeviceAuthority.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Add gateway integration REDs before changing gateway auth selection**

Extend `server/whatsappOperationsGateway.test.ts` with these binding cases:

```text
A. Browser valid cookie session + server-derived same shop -> existing GET succeeds.
B. Browser cookie shop differs from device-derived shop -> 401 device_session_invalid; repository not called.
C. Desktop bearer + x-tux-device-id, no cookies -> request succeeds and repository receives server-derived shop/device.
D. Authorization without x-tux-device-id -> 401; no cookie fallback; repository not called.
E. x-tux-device-id without Authorization -> 401; no cookie fallback; repository not called.
F. Invalid desktop bearer while valid browser cookies exist -> 401; no cookie fallback.
G. Desktop POST with no Origin -> allowed after valid bearer authority.
H. Desktop POST with hostile Origin/Host mismatch -> 403 origin_not_allowed.
I. Caller body/query cannot select another shop; forbidden authority field behavior remains.
J. Inactive/wrong device or non-OPERATIONS_DEVICE membership -> 401; repository/provider not called.
```

Inject the authority resolver/fetch boundary so tests do not call production Supabase.

- [ ] **Step 7: Run gateway RED**

```bash
npm test -- server/whatsappOperationsGateway.test.ts server/operationsDeviceAuthority.test.ts
```

Expected RED: desktop bearer presentation and browser server-derived authority cases are not implemented yet.

- [ ] **Step 8: Implement deterministic auth-presentation selection in `whatsappOperationsGateway.ts`**

Before any GET/POST WhatsApp repository call:

```text
if Authorization OR x-tux-device-id is present:
    select DESKTOP_BEARER mode
    require BOTH values
    require `Bearer <non-empty token>`
    parse x-tux-device-id as DeviceId
    resolveOperationsDeviceAuthority(accessToken, deviceId)
    NEVER call requireDeviceSession on failure
else:
    select BROWSER_COOKIE mode
    call existing requireDeviceSession (including refresh)
    parse its deviceId
    resolveOperationsDeviceAuthority(session.accessToken, session.deviceId)
    compare retained session.shopId with authority.shopId
    mismatch -> clear cookies + 401 device_session_invalid
```

Map resolver errors:

```text
DEVICE_AUTH_INVALID -> 401 { error: 'device_authority_invalid' }
REMOTE_UNAVAILABLE  -> 503 { error: 'device_authority_unavailable' }
```

After authority succeeds, use only:

```ts
authority.shopId
authority.deviceId
```

for the existing repository/channel/provider paths.

For every POST, call `requireSameOrigin(request, response)` after authority and before JSON mutation handling. This retains browser CSRF protection and permits desktop Node/Electron requests that omit `Origin` because the existing helper treats missing Origin as allowed. A present hostile Origin remains rejected.

- [ ] **Step 9: Run server GREEN + legacy session regression**

```bash
npm test -- \
  server/operationsDeviceAuthority.test.ts \
  server/whatsappOperationsGateway.test.ts \
  server/supabaseGateway.test.ts
npm run typecheck
```

If `server/supabaseGateway.test.ts` is not the exact existing filename, run the existing device-session server test file(s) that cover refresh/cookies before committing.

Expected: PASS.

- [ ] **Step 10: Commit unified server authority**

```bash
git add \
  server/operationsDeviceAuthority.ts \
  server/operationsDeviceAuthority.test.ts \
  server/supabaseGateway.ts \
  server/whatsappOperationsGateway.ts \
  server/whatsappOperationsGateway.test.ts
git commit -m "feat: derive WhatsApp device authority server side"
```

---

### Task 4: Build the Electron-main HTTPS WhatsApp remote on the existing device-session manager

**Files:**
- Create: `apps/operations-desktop/src/main/desktopWhatsAppRemote.ts`
- Create: `apps/operations-desktop/src/main/desktopWhatsAppRemote.test.ts`

**Interfaces:**

```ts
export function parseTuxOperationsApiOrigin(raw: string): string;

export class DesktopWhatsAppRemote implements WhatsAppRemoteGateway {
  constructor(input: {
    readonly apiOrigin: string;
    readonly sessionManager: SupabaseDeviceSessionManager;
    readonly fetcher?: typeof fetch;
    readonly timeoutMs?: number;
  });
}
```

- [ ] **Step 1: Write module-missing RED**

Create tests with these concrete assertions:

```ts
it('accepts only an HTTPS origin with no path/query/fragment/credentials', () => {
  expect(parseTuxOperationsApiOrigin('https://operations.example.com')).toBe(
    'https://operations.example.com',
  );
  expect(() => parseTuxOperationsApiOrigin('http://operations.example.com')).toThrow();
  expect(() => parseTuxOperationsApiOrigin('https://operations.example.com/api')).toThrow();
  expect(() => parseTuxOperationsApiOrigin('https://user:pass@operations.example.com')).toThrow();
});

it('uses resolved short-lived access token and device ID only for server authority', async () => {
  // manager.resolveSession() -> VALID session
  // fetch POST https://operations.example.com/api/whatsapp
  // assert Authorization Bearer access token + x-tux-device-id
  // assert no apikey, refresh token, shopId, service-role or Meta credential header/body.
});

it('maps session TRANSPORT_UNAVAILABLE to WhatsApp REMOTE_UNAVAILABLE', async () => {});
it('maps NOT_ENROLLED and AUTHORITATIVELY_INVALID to DEVICE_AUTH_INVALID', async () => {});
it('does not classify PROTOCOL_ERROR or LOCAL_PERSISTENCE_ERROR as REMOTE_UNAVAILABLE', async () => {});
it('preserves whatsapp_delivery_uncertain without retrying the HTTP send', async () => {});
```

- [ ] **Step 2: Run RED**

```bash
npm test -- apps/operations-desktop/src/main/desktopWhatsAppRemote.test.ts
```

Expected RED: module `./desktopWhatsAppRemote` does not exist.

- [ ] **Step 3: Implement origin validation**

`parseTuxOperationsApiOrigin` must:

```ts
const url = new URL(raw.trim());
if (url.protocol !== 'https:') throw new TypeError('TUX Operations API origin must use HTTPS.');
if (url.username !== '' || url.password !== '') throw new TypeError('TUX Operations API origin must not contain credentials.');
if (url.pathname !== '/' || url.search !== '' || url.hash !== '') {
  throw new TypeError('TUX Operations API origin must not contain path, query, or fragment.');
}
return url.origin;
```

No hard-coded production fallback.

- [ ] **Step 4: Implement one session-resolution boundary per request**

Before each HTTP request call:

```ts
const resolution = await sessionManager.resolveSession();
```

Map:

```text
VALID                    -> use resolution.session.accessToken + deviceId
TRANSPORT_UNAVAILABLE    -> WhatsAppRemoteError('REMOTE_UNAVAILABLE', ...)
NOT_ENROLLED             -> WhatsAppRemoteError('DEVICE_AUTH_INVALID', ...)
AUTHORITATIVELY_INVALID  -> WhatsAppRemoteError('DEVICE_AUTH_INVALID', ...)
PROTOCOL_ERROR           -> plain Error (fail closed; no cached-offline classification)
LOCAL_PERSISTENCE_ERROR  -> plain Error with cause (fail closed; no cached-offline classification)
```

Do not call `requiredSession()` and then infer error types from strings; use `resolveSession()` explicitly so the classification remains stable.

- [ ] **Step 5: Implement desktop request headers and methods**

For GET:

```ts
{
  authorization: `Bearer ${session.accessToken}`,
  'x-tux-device-id': session.deviceId,
  accept: 'application/json',
}
```

For POST add only:

```ts
'content-type': 'application/json'
```

Do not send `apikey` to the TUX API. Do not send `Origin`. Do not send `shopId`, refresh token, service-role key, Meta access/app secret, or provider phone ID.

Use `AbortSignal.timeout(timeoutMs)` with default `10_000` ms.

Implement all `WhatsAppRemoteGateway` methods against `${apiOrigin}/api/whatsapp`, using the exact Task 4 request bodies and the shared `parseWhatsAppInboxSnapshot`, `parseWhatsAppMessage`, and `throwWhatsAppHttpError` functions.

Do not add `sendMedia`.

- [ ] **Step 6: Run desktop remote GREEN**

```bash
npm test -- apps/operations-desktop/src/main/desktopWhatsAppRemote.test.ts packages/application/src/whatsappWire.test.ts
npm run typecheck -w @tux/operations-desktop
```

Expected: PASS.

- [ ] **Step 7: Commit desktop remote**

```bash
git add \
  apps/operations-desktop/src/main/desktopWhatsAppRemote.ts \
  apps/operations-desktop/src/main/desktopWhatsAppRemote.test.ts
git commit -m "feat: add desktop WhatsApp remote transport"
```

---

### Task 5: Define the public `TuxWhatsAppApi` and bridge Electron main through trusted IPC

**Files:**
- Modify: `packages/platform-contracts/index.d.ts`
- Create: `apps/operations-desktop/src/main/whatsappIpc.ts`
- Create: `apps/operations-desktop/src/main/whatsappIpc.test.ts`
- Modify: `apps/operations-desktop/src/main/index.ts`
- Modify: `apps/operations-desktop/package.json` only if an existing workspace dependency required by the new imports is genuinely absent.

**Interfaces:**

```ts
export type TuxWhatsAppApi = Pick<
  OperationsWhatsAppService,
  | 'loadInbox'
  | 'loadConversation'
  | 'sendText'
  | 'markUnread'
  | 'archive'
  | 'setFollowUp'
  | 'linkOrder'
  | 'saveDraft'
  | 'getDraft'
>;
```

`TuxDesktopApi` gains:

```ts
readonly whatsapp: TuxWhatsAppApi;
```

IPC channels are exactly:

```text
tux:whatsapp:load-inbox
tux:whatsapp:load-conversation
tux:whatsapp:send-text
tux:whatsapp:mark-unread
tux:whatsapp:archive
tux:whatsapp:set-follow-up
tux:whatsapp:link-order
tux:whatsapp:save-draft
tux:whatsapp:get-draft
```

- [ ] **Step 1: Write compile RED for the platform contract**

Update `packages/platform-contracts/index.d.ts` imports to include `OperationsWhatsAppService`, define `TuxWhatsAppApi` as the exact `Pick` above, and add `readonly whatsapp: TuxWhatsAppApi` to `TuxDesktopApi`.

Do not modify preload/main yet.

- [ ] **Step 2: Run compile RED**

```bash
npm run typecheck -w @tux/operations-desktop
```

Expected RED: current preload `api: TuxDesktopApi` is missing required `whatsapp`.

- [ ] **Step 3: Write IPC runtime tests before the runtime module**

Create `apps/operations-desktop/src/main/whatsappIpc.test.ts`. Follow the existing Electron IPC test mocking pattern used by `workerUiPreferencesIpc.test.ts`. Tests must prove:

```text
- all nine channels are registered;
- every handler calls trusted-sender verification before invoking the service;
- loadConversation rejects non-string/malformed conversation ID;
- sendText rejects non-object, invalid conversationId, blank text, blank outboundIntentKey;
- archive/setFollowUp reject non-boolean flags;
- linkOrder rejects malformed conversation/order IDs;
- saveDraft requires string conversationId + string text but permits an empty draft string;
- getDraft validates conversationId;
- invalid payload never invokes the application service.
```

- [ ] **Step 4: Run IPC module-missing RED**

```bash
npm test -- apps/operations-desktop/src/main/whatsappIpc.test.ts
```

Expected RED: module `./whatsappIpc` does not exist.

- [ ] **Step 5: Implement `WhatsAppIpcRuntime`**

The class must receive a `TuxWhatsAppApi` service and expose:

```ts
export class WhatsAppIpcRuntime {
  constructor(input: { readonly service: TuxWhatsAppApi });
  register(window: BrowserWindow): void;
  close(): void;
}
```

Every handler begins with:

```ts
assertTrustedIpcSender(event, window.webContents.id);
```

Main-process parsing rules:

```text
conversationId: UUID string validated with parseEntityId
orderId: OrderId via parseEntityId<OrderId>
outboundIntentKey: trimmed non-empty string
send text: trimmed non-empty string
archive/followUp/linked: boolean when present
saveDraft text: string, including empty string
cursor: undefined or string
```

The runtime forwards parsed inputs to the application service; it does not contain Business Day, worker, tenant, provider, or HTTP logic.

- [ ] **Step 6: Compose desktop WhatsApp service in Electron main**

In `apps/operations-desktop/src/main/index.ts`:

1. Import `OperationsWhatsAppService`, `WhatsAppRemoteError`, `SqliteWhatsAppStore`, `DesktopWhatsAppRemote`, `WhatsAppIpcRuntime`.
2. Add module state:

```ts
let whatsappStore: SqliteWhatsAppStore | null = null;
let whatsappIpcRuntime: WhatsAppIpcRuntime | null = null;
```

3. Reuse the existing `databasePath`, existing `sessionService`, and the same `remoteSessionManager` created earlier in `initializeOperationsServices()`.
4. Initialize:

```ts
whatsappStore = new SqliteWhatsAppStore(databasePath);
await whatsappStore.initialize();
```

5. Build the remote without making app startup depend on WhatsApp availability:

```ts
function unavailableWhatsAppRemote(): WhatsAppRemoteGateway {
  const unavailable = async (): Promise<never> => {
    throw new WhatsAppRemoteError('REMOTE_UNAVAILABLE', 'WhatsApp remote is not configured.');
  };
  return {
    loadInbox: unavailable,
    sendText: unavailable,
    markUnread: unavailable,
    archive: unavailable,
    setFollowUp: unavailable,
    linkOrder: unavailable,
  };
}
```

Use `DesktopWhatsAppRemote` only when both `remoteSessionManager` and a non-empty `TUX_OPERATIONS_API_ORIGIN` are present. Parse the origin with `parseTuxOperationsApiOrigin`; if it is configured but invalid, log a safe configuration error and use the unavailable remote rather than crashing Orders/POS startup. Do not log secrets/tokens.

6. Create:

```ts
const whatsappService = new OperationsWhatsAppService(
  whatsappRemote,
  whatsappStore,
  { getState: () => sessionService!.getState() },
  runtime.now,
);
whatsappIpcRuntime = new WhatsAppIpcRuntime({ service: whatsappService });
```

7. In `registerIpcHandlers(window)`, require initialized `whatsappIpcRuntime` and call `.register(window)`.
8. On `before-quit`, call `whatsappIpcRuntime?.close()` and `void whatsappStore?.close()`, then null both references.

Do not create another SQLite file.

- [ ] **Step 7: Run main/IPC GREEN**

```bash
npm test -- apps/operations-desktop/src/main/whatsappIpc.test.ts apps/operations-desktop/src/main/security.test.ts
npm run typecheck -w @tux/operations-desktop
```

Expected: PASS.

- [ ] **Step 8: Commit platform contract + Electron main composition**

```bash
git add \
  packages/platform-contracts/index.d.ts \
  apps/operations-desktop/src/main/whatsappIpc.ts \
  apps/operations-desktop/src/main/whatsappIpc.test.ts \
  apps/operations-desktop/src/main/index.ts \
  apps/operations-desktop/package.json
git commit -m "feat: bridge WhatsApp service through Electron main"
```

If `apps/operations-desktop/package.json` did not require a dependency change, do not stage it.

---

### Task 6: Defensively expose `TuxWhatsAppApi` through preload

**Files:**
- Create: `apps/operations-desktop/src/preload/whatsappResult.ts`
- Create: `apps/operations-desktop/src/preload/whatsappResult.test.ts`
- Modify: `apps/operations-desktop/src/preload/index.ts`

**Interfaces:**
- Preload exposes `window.tuxDesktop.whatsapp: TuxWhatsAppApi`.
- Main results remain untrusted until parsed in preload.

- [ ] **Step 1: Write result-parser RED**

Create `apps/operations-desktop/src/preload/whatsappResult.test.ts` importing the missing parser module. Cover all result shapes:

```text
loadInbox           Result<WhatsAppInboxSnapshot, ApplicationError>
loadConversation    Result<readonly WhatsAppMessage[], ApplicationError>
sendText            Result<WhatsAppMessage, ApplicationError>
void mutations      Result<void, ApplicationError>
getDraft             Result<WhatsAppDraft | null, ApplicationError>
```

Tests must reject:

```text
- non-object Result;
- ok:true with malformed message/snapshot/draft;
- ok:false with unknown ApplicationError code;
- ok:false with non-string message;
- forged shop/message/order IDs in nested values.
```

Use the shared domain/application parsers where available rather than accepting unknown objects by type assertion.

- [ ] **Step 2: Run parser module-missing RED**

```bash
npm test -- apps/operations-desktop/src/preload/whatsappResult.test.ts
```

Expected RED: module `./whatsappResult` does not exist.

- [ ] **Step 3: Implement defensive result parsing**

Export these functions:

```ts
export function assertWhatsAppInboxResult(value: unknown): ReturnType<TuxWhatsAppApi['loadInbox']> extends Promise<infer T> ? T : never;
export function assertWhatsAppConversationResult(value: unknown): ReturnType<TuxWhatsAppApi['loadConversation']> extends Promise<infer T> ? T : never;
export function assertWhatsAppMessageResult(value: unknown): ReturnType<TuxWhatsAppApi['sendText']> extends Promise<infer T> ? T : never;
export function assertWhatsAppVoidResult(value: unknown): Awaited<ReturnType<TuxWhatsAppApi['markUnread']>>;
export function assertWhatsAppDraftResult(value: unknown): Awaited<ReturnType<TuxWhatsAppApi['getDraft']>>;
```

Application error codes accepted by the parser are exactly the current `ApplicationErrorCode` union:

```text
VALIDATION_ERROR
INVALID_DRAFT
LOCAL_PERSISTENCE_ERROR
PRINT_ERROR
REMOTE_SYNC_ERROR
PIN_AUTH_ERROR
CONFLICT_ERROR
NOT_FOUND
ALREADY_CLOSED
IDEMPOTENCY_REPLAY
```

Do not expose an untrusted `cause` object to the renderer. If an error result contains `cause`, normalize the exposed error to `{code, message}`.

- [ ] **Step 4: Add all nine preload methods**

In `apps/operations-desktop/src/preload/index.ts`, add the nine WhatsApp channel constants and:

```ts
whatsapp: Object.freeze({
  loadInbox: async (cursor?: string) =>
    assertWhatsAppInboxResult(
      (await ipcRenderer.invoke(IPC_WHATSAPP_LOAD_INBOX, cursor)) as unknown,
    ),
  loadConversation: async (conversationId: string) =>
    assertWhatsAppConversationResult(
      (await ipcRenderer.invoke(IPC_WHATSAPP_LOAD_CONVERSATION, conversationId)) as unknown,
    ),
  sendText: async (input) =>
    assertWhatsAppMessageResult(
      (await ipcRenderer.invoke(IPC_WHATSAPP_SEND_TEXT, input)) as unknown,
    ),
  markUnread: async (conversationId: string) =>
    assertWhatsAppVoidResult(
      (await ipcRenderer.invoke(IPC_WHATSAPP_MARK_UNREAD, conversationId)) as unknown,
    ),
  archive: async (conversationId: string, archived?: boolean) =>
    assertWhatsAppVoidResult(
      (await ipcRenderer.invoke(IPC_WHATSAPP_ARCHIVE, conversationId, archived)) as unknown,
    ),
  setFollowUp: async (conversationId: string, followUp: boolean) =>
    assertWhatsAppVoidResult(
      (await ipcRenderer.invoke(IPC_WHATSAPP_SET_FOLLOW_UP, conversationId, followUp)) as unknown,
    ),
  linkOrder: async (input) =>
    assertWhatsAppVoidResult(
      (await ipcRenderer.invoke(IPC_WHATSAPP_LINK_ORDER, input)) as unknown,
    ),
  saveDraft: async (conversationId: string, text: string) =>
    assertWhatsAppVoidResult(
      (await ipcRenderer.invoke(IPC_WHATSAPP_SAVE_DRAFT, conversationId, text)) as unknown,
    ),
  getDraft: async (conversationId: string) =>
    assertWhatsAppDraftResult(
      (await ipcRenderer.invoke(IPC_WHATSAPP_GET_DRAFT, conversationId)) as unknown,
    ),
}),
```

Do not expose access tokens, refresh tokens, fetch, Node APIs, or a generic IPC method.

- [ ] **Step 5: Run preload GREEN + security compile**

```bash
npm test -- apps/operations-desktop/src/preload/whatsappResult.test.ts
npm run typecheck -w @tux/operations-desktop
```

Expected: PASS and `api: TuxDesktopApi` is structurally complete.

- [ ] **Step 6: Commit preload bridge**

```bash
git add \
  apps/operations-desktop/src/preload/whatsappResult.ts \
  apps/operations-desktop/src/preload/whatsappResult.test.ts \
  apps/operations-desktop/src/preload/index.ts
git commit -m "feat: expose typed WhatsApp desktop API"
```

---

### Task 7: Compose the browser WhatsApp service and select desktop/browser API at runtime

**Files:**
- Modify: `apps/operations/src/app/sessionClient.ts`
- Create: `apps/operations/src/app/sessionClient.whatsapp.test.ts`

**Interfaces:**

```ts
export type OperationsWhatsAppClient = TuxWhatsAppApi;
export function createOperationsWhatsAppClient(): OperationsWhatsAppClient;
```

- [ ] **Step 1: Write browser/runtime selection RED**

Create `apps/operations/src/app/sessionClient.whatsapp.test.ts` covering:

```text
1. when `window.tuxDesktop.whatsapp` exists, createOperationsWhatsAppClient returns/delegates to it;
2. when `window.tuxDesktop` is absent, the client lazily resolves the browser runtime WhatsApp service;
3. the public method set includes all nine required methods including saveDraft/getDraft;
4. no sendMedia member is present;
5. browser service uses one IndexedDbWhatsAppStore and one VercelBrowserWhatsAppRemote per BrowserRuntime construction.
```

Mock browser storage/runtime dependencies using the same test setup already used by sessionClient/browser runtime tests; do not require a real Vercel deployment.

- [ ] **Step 2: Run RED**

```bash
npm test -- apps/operations/src/app/sessionClient.whatsapp.test.ts
```

Expected RED: `createOperationsWhatsAppClient` and browser runtime WhatsApp composition do not exist.

- [ ] **Step 3: Compose browser WhatsApp service in the existing runtime**

Update imports:

```ts
import {
  OperationsWhatsAppService,
  ...existingApplicationImports
} from '@tux/application';
import {
  IndexedDbWhatsAppStore,
  ...existingBrowserPersistenceImports
} from '@tux/persistence/browser';
import type { TuxWhatsAppApi, ...existingContractTypes } from '@tux/platform-contracts';
import { VercelBrowserWhatsAppRemote } from './browserWhatsAppRemote';
```

After `session` is created, initialize once:

```ts
const whatsappStore = new IndexedDbWhatsAppStore();
await whatsappStore.initialize();
const whatsapp = new OperationsWhatsAppService(
  new VercelBrowserWhatsAppRemote(),
  whatsappStore,
  session,
  runtime.now,
);
```

Add `readonly whatsapp: TuxWhatsAppApi` to `BrowserRuntime` and return it.

Do not create another IndexedDB database; `IndexedDbWhatsAppStore` must continue to use `tux-operations-v2` version 5 established by Task 5.

- [ ] **Step 4: Export one runtime-selected client**

Add:

```ts
export type OperationsWhatsAppClient = TuxWhatsAppApi;

export function createOperationsWhatsAppClient(): OperationsWhatsAppClient {
  const desktop = window.tuxDesktop;
  if (desktop !== undefined) return desktop.whatsapp;
  return {
    loadInbox: async (cursor) => (await browserRuntime()).whatsapp.loadInbox(cursor),
    loadConversation: async (conversationId) =>
      (await browserRuntime()).whatsapp.loadConversation(conversationId),
    sendText: async (input) => (await browserRuntime()).whatsapp.sendText(input),
    markUnread: async (conversationId) => (await browserRuntime()).whatsapp.markUnread(conversationId),
    archive: async (conversationId, archived) =>
      (await browserRuntime()).whatsapp.archive(conversationId, archived),
    setFollowUp: async (conversationId, followUp) =>
      (await browserRuntime()).whatsapp.setFollowUp(conversationId, followUp),
    linkOrder: async (input) => (await browserRuntime()).whatsapp.linkOrder(input),
    saveDraft: async (conversationId, text) =>
      (await browserRuntime()).whatsapp.saveDraft(conversationId, text),
    getDraft: async (conversationId) => (await browserRuntime()).whatsapp.getDraft(conversationId),
  };
}
```

This function is the Task 7 UI entry point later; do not add the WhatsApp navigation/UI in this task.

- [ ] **Step 5: Run browser GREEN**

```bash
npm test -- \
  apps/operations/src/app/sessionClient.whatsapp.test.ts \
  apps/operations/src/app/browserWhatsAppRemote.test.ts \
  packages/application/src/whatsapp.test.ts \
  packages/persistence/src/browser/IndexedDbWhatsAppStore.test.ts
npm run typecheck -w @tux/operations
```

Expected: PASS.

- [ ] **Step 6: Commit browser runtime wiring**

```bash
git add \
  apps/operations/src/app/sessionClient.ts \
  apps/operations/src/app/sessionClient.whatsapp.test.ts
git commit -m "feat: wire WhatsApp browser runtime"
```

---

### Task 8: Full security/regression verification for Task 5.1 + Task 6

**Files:** no production files unless a failing gate reveals a real defect. Do not weaken tests/gates to manufacture completion.

- [ ] **Step 1: Run focused WhatsApp/runtime suites fresh**

```bash
npm test -- \
  packages/persistence/src/whatsappStore.test.ts \
  packages/persistence/src/sqlite/SqliteWhatsAppStore.test.ts \
  packages/persistence/src/browser/IndexedDbWhatsAppStore.test.ts \
  packages/application/src/whatsapp.test.ts \
  packages/application/src/whatsappWire.test.ts \
  apps/operations/src/app/browserWhatsAppRemote.test.ts \
  apps/operations/src/app/sessionClient.whatsapp.test.ts \
  server/operationsDeviceAuthority.test.ts \
  server/whatsappOperationsGateway.test.ts \
  apps/operations-desktop/src/main/desktopWhatsAppRemote.test.ts \
  apps/operations-desktop/src/main/whatsappIpc.test.ts \
  apps/operations-desktop/src/preload/whatsappResult.test.ts
```

Expected: all PASS, zero failures.

- [ ] **Step 2: Run full static/build-quality gates**

```bash
npm run test:whatsapp-architecture
npm run typecheck
npm run lint
npm run format:check
npm run test:migrations
```

Expected: PASS.

- [ ] **Step 3: Prove completed remote WhatsApp SQL stayed immutable**

```bash
test -z "$(git diff 66c981af26c4aa6779a414e78f3642c31ef4ee3e..HEAD -- \
  supabase/migrations/20260902220000_whatsapp_inbox.sql \
  supabase/migrations/20260902223000_whatsapp_channels.sql \
  supabase/migrations/20260902224500_whatsapp_current_worker_authority.sql)"
```

Expected: exit 0 / no diff.

- [ ] **Step 4: Prove no persistence -> application dependency remains**

```bash
if git grep -n "@tux/application" -- packages/persistence/src; then
  echo "Forbidden persistence -> application dependency remains." >&2
  exit 1
fi
```

Expected: no matches.

- [ ] **Step 5: Prove secret fencing**

Run:

```bash
if git grep -n \
  "TUX_WHATSAPP_ACCESS_TOKEN\|TUX_WHATSAPP_APP_SECRET\|TUX_SUPABASE_SERVICE_ROLE_KEY\|SUPABASE_SERVICE_ROLE_KEY\|TUX_WHATSAPP_WEBHOOK_VERIFY_TOKEN" -- \
  packages/application \
  packages/persistence \
  packages/platform-contracts \
  apps/operations \
  apps/operations-desktop/src/preload \
  apps/operations-desktop/src/main/desktopWhatsAppRemote.ts \
  apps/operations-desktop/src/main/whatsappIpc.ts; then
  echo "Server/provider secret reference found in client/runtime WhatsApp layers." >&2
  exit 1
fi
```

Expected: no matches.

- [ ] **Step 6: Prove refresh token never enters the desktop WhatsApp request implementation**

```bash
if git grep -n "refreshToken" -- apps/operations-desktop/src/main/desktopWhatsAppRemote.ts; then
  echo "Desktop WhatsApp remote must not transmit or inspect refresh tokens." >&2
  exit 1
fi
```

Expected: no matches.

- [ ] **Step 7: Prove no premature media send and no direct Desktop -> Meta path**

```bash
if git grep -n "sendMedia" -- \
  packages/application/src/whatsapp.ts \
  packages/application/src/whatsappRemote.ts \
  packages/platform-contracts/index.d.ts \
  apps/operations-desktop/src/main/desktopWhatsAppRemote.ts; then
  echo "Outbound media was added before the media task." >&2
  exit 1
fi

if git grep -n "graph.facebook.com" -- \
  apps/operations-desktop \
  apps/operations \
  packages/application \
  packages/persistence; then
  echo "Direct client/Desktop Meta transport is forbidden." >&2
  exit 1
fi
```

Expected: no matches.

- [ ] **Step 8: Prove desktop does not send client-selected tenant authority**

Inspect `desktopWhatsAppRemote.ts` and run:

```bash
if git grep -n "shopId\|providerPhoneNumberId\|sentByWorkerId" -- \
  apps/operations-desktop/src/main/desktopWhatsAppRemote.ts; then
  echo "Review each match: no authority field may be transmitted by the desktop remote." >&2
  exit 1
fi
```

Expected: no matches in transport request construction. If a type-only/parser match is genuinely required by a shared return type, replace this raw grep with a narrow source test that inspects request headers/body and proves those keys are absent; do not delete legitimate parsing merely to satisfy grep.

- [ ] **Step 9: Run Electron hardening regression tests**

```bash
npm test -- \
  apps/operations-desktop/src/main/security.test.ts \
  apps/operations-desktop/src/main/session.integration.test.ts \
  apps/operations-desktop/src/preload/sessionResult.test.ts
```

Expected: PASS; no contextIsolation/sandbox/navigation hardening regression.

- [ ] **Step 10: Confirm working tree and exact diff**

```bash
git status --short
git diff --stat 66c981af26c4aa6779a414e78f3642c31ef4ee3e..HEAD
git log --oneline --decorate 66c981af26c4aa6779a414e78f3642c31ef4ee3e..HEAD
```

Expected: clean working tree and only Task 5.1/Task 6 files/commits.

- [ ] **Step 11: Do not deploy**

Record explicitly in the completion report:

```text
Production Supabase migration applied: NO
Production Vercel deployment: NO
Production Vercel environment changed: NO
Production whatsapp_channels row inserted/updated: NO
Meta webhook/app/phone configuration changed: NO
Real Meta credential added: NO
```

Task 6 only introduces the **environment variable name** `TUX_OPERATIONS_API_ORIGIN`; do not set its production value in this task.

- [ ] **Step 12: Final report and STOP**

Report exactly:

```text
TASK 5.1 + TASK 6 COMPLETE

Task 5.1:
- architecture RED command/result
- GREEN command/result
- commit SHA
- persistence -> application imports absent YES/NO
- local/remote schema unchanged YES/NO

Task 6 shared contract:
- DEVICE_AUTH_INVALID compile RED/GREEN
- wire codec RED/GREEN
- commit SHA

Task 6 server authority:
- resolver RED/GREEN
- browser cookie authority tests
- desktop bearer authority tests
- invalid-header no-fallback tests
- cookie-shop mismatch test
- CSRF/origin tests
- cross-tenant/inactive membership tests
- commit SHA

Task 6 desktop remote:
- origin validation tests
- session classification tests
- header/secret fencing tests
- delivery uncertainty/no-retry test
- commit SHA

Task 6 IPC/preload:
- platform-contract compile RED/GREEN
- all 9 IPC methods bridged
- trusted sender tests
- malformed payload tests
- malformed main result tests
- commit SHAs

Task 6 browser runtime:
- desktop selection test
- browser fallback selection test
- IndexedDB/Vercel composition test
- commit SHA

Final gates:
- focused test count
- full typecheck
- lint
- format:check
- test:migrations
- Task 1-4 remote WhatsApp migrations unchanged YES/NO
- persistence -> application guard PASS/FAIL
- secret fencing PASS/FAIL
- refresh-token fencing PASS/FAIL
- sendMedia absent YES/NO
- direct Desktop -> Meta absent YES/NO
- final branch
- final HEAD SHA
- exact changed files
- working tree clean YES/NO
- production mutations all NO
```

Then **STOP. DO NOT START TASK 7**. Return the report to the Planner/Auditor for independent review.

---

## Self-Review Checklist Applied to This Plan

### Spec coverage

- Package cycle removal: Task 1.
- Persistence-owned cache DTOs and remote-snapshot superset: Task 1.
- `DEVICE_AUTH_INVALID` vs `REMOTE_UNAVAILABLE`: Task 2 and Task 4.
- Shared browser/desktop response validation: Task 2.
- Server-derived enrolled-device authority for browser and desktop: Task 3.
- Browser cookie shop mismatch fencing: Task 3.
- No desktop downgrade to cookies: Task 3.
- Browser CSRF + desktop no-Origin bearer behavior: Task 3.
- HTTPS-only `TUX_OPERATIONS_API_ORIGIN`: Task 4.
- Existing `SupabaseDeviceSessionManager` reuse: Task 4.
- No refresh token/shop/provider secrets in desktop request: Task 4 + final gates.
- Public nine-method `TuxWhatsAppApi`: Task 5.
- Electron main `OperationsWhatsAppService + SQLite + DesktopWhatsAppRemote`: Task 5.
- Trusted IPC sender and payload validation: Task 5.
- Defensive preload result parsing: Task 6.
- Browser `OperationsWhatsAppService + IndexedDB + Vercel remote`: Task 7.
- Desktop/browser runtime selection: Task 7.
- POS independence when WhatsApp is unconfigured: Task 5 unavailable remote.
- No offline send queue or blind replay: no task adds one; final tests/gates preserve Task 5/4 behavior.
- No new remote migration or production mutation: Global Constraints + Task 8.
- No media send: Global Constraints + Task 8.
- Electron hardening preserved: Tasks 5/6 + Task 8 regression.

### Placeholder scan

No `TBD`, `TODO`, generic “add error handling”, or undefined neighboring interfaces are intentionally left in this plan. Where an existing repository test filename may vary, the plan requires the implementer to select the already-existing device-session regression file only after confirming the exact path; this does not authorize changing architecture or behavior.

### Type consistency

- Persistence cache link: `CachedWhatsAppOrderLink`.
- Application compatibility alias: `WhatsAppInboxOrderLink = CachedWhatsAppOrderLink`.
- Remote snapshot: `WhatsAppInboxSnapshot extends CachedWhatsAppInboxSnapshot` + `nextCursor`.
- Device authority: `{shopId: ShopId, deviceId: DeviceId}`.
- Desktop remote implements the existing `WhatsAppRemoteGateway` method names/signatures.
- Public runtime contract is `Pick<OperationsWhatsAppService, nine exact method names>`.
- `TuxDesktopApi.whatsapp`, `WhatsAppIpcRuntime`, preload API, browser client, and desktop service all consume that same `TuxWhatsAppApi` surface.
