# TUX Operations WhatsApp Runtime & Transport Boundary

**Date:** 2026-09-03  
**Status:** APPROVED ARCHITECTURE — binding design for the Task 5.1 cleanup and corrected Task 6; implementation planning remains blocked until this written specification is reviewed.  
**Implementation baseline audited:** `feat/operations-whatsapp-inbox` at `66c981af26c4aa6779a414e78f3642c31ef4ee3e`  
**Supersedes:** the runtime/transport portions of Task 6 in `docs/superpowers/plans/2026-09-02-tux-operations-whatsapp-inbox.md` wherever that plan conflicts with this document.  
**Does not rewrite:** completed Tasks 1–5 or their production behavior except for the narrow package-layer cleanup explicitly defined below.

---

## 1. Decision

TUX Operations will have **one WhatsApp application service contract and one server-side WhatsApp authority**, with runtime-specific transport/cache adapters around it.

Browser and Windows/Electron must not grow separate WhatsApp backends.

```text
                              TUX server authority
                       +-----------------------------+
                       |        /api/whatsapp        |
                       | device auth + tenant fence  |
                       | idempotency + provider send |
                       +-------------+---------------+
                                     |
                              Supabase / Meta

Browser Operations                     Windows Operations
------------------                     ------------------
OperationsWhatsAppService              Electron Main
  + IndexedDbWhatsAppStore               OperationsWhatsAppService
  + VercelBrowserWhatsAppRemote           + SqliteWhatsAppStore
            |                              + DesktopWhatsAppRemote
            |                                        |
            +-------------- HTTPS -------------------+
```

The browser continues to use the same-origin `/api/whatsapp` route. The Windows runtime uses the same route through an absolute, validated TUX Operations API origin and authenticates with the existing enrolled-device Supabase session held in Electron `safeStorage`.

No Meta credential, Supabase service-role credential, or equivalent server secret may enter the renderer, application package, persistence package, preload, Electron main configuration, SQLite, IndexedDB, or device activation state.

---

## 2. Why the original Task 6 is no longer sufficient

Task 5 established the actual application and persistence boundaries. Two mismatches are now concrete.

### 2.1 Package-layer cycle

At the audited Task 5 head:

```text
@tux/application -> @tux/persistence
@tux/persistence --type import--> @tux/application
```

`packages/persistence/src/whatsappStore.ts` imports `WhatsAppInboxOrderLink` and `WhatsAppInboxSnapshot` from `@tux/application`, while `@tux/application` already depends on `@tux/persistence`.

This is currently a type-only cycle, not a runtime failure, but it violates the intended package direction and would make later extraction/refactoring brittle.

### 2.2 Desktop transport is undefined

The implemented browser remote uses relative `/api/whatsapp` calls with browser cookies. The installed Electron app uses `SupabaseDeviceSessionManager` plus `ElectronSafeStorageDeviceSessionStore`, not those browser cookies.

The original Task 6 says the desktop runtime should expose the same API through IPC and SQLite but does not define a secure desktop path to the existing WhatsApp server authority. Implementing it literally would force an ad-hoc choice between duplicate backend logic, renderer networking, cookie emulation, or direct Meta/Supabase access. None is acceptable.

---

## 3. Goals

This design must produce all of the following:

1. Acyclic package layering: persistence never imports application.
2. One public renderer contract: `TuxWhatsAppApi`.
3. One application behavior implementation: `OperationsWhatsAppService`.
4. One server authority for browser and desktop: `/api/whatsapp`.
5. Browser local cache in IndexedDB and desktop local cache in SQLite.
6. Desktop remote authentication through the existing enrolled-device session and existing refresh state machine.
7. Server-side derivation of tenant/shop authority; no client-supplied shop chooses the tenant.
8. Electron hardening preserved: renderer cannot directly access Node, device tokens, or the WhatsApp network transport.
9. Offline POS remains independent from WhatsApp.
10. No automatic stale-message replay/outbox is introduced by Task 6.
11. No production deployment, Meta configuration, WhatsApp channel insertion, Vercel environment mutation, or production Supabase mutation during Task 5.1 or Task 6.

---

## 4. Non-goals

This design does **not** decide or implement:

- the worker WhatsApp UI (Task 7),
- media sending,
- templates/provider-window product UX,
- Web Order Requests,
- TUX-MENU integration,
- calls/status/community features,
- AI,
- printer setup,
- first-run Device Activation itself,
- Windows installer/release/update distribution,
- a new offline outbound WhatsApp outbox,
- the unresolved product policy for messaging while the Business Day is closed.

Task 5's current active-operator/business-day behavior is preserved unless a separate approved product decision changes it.

---

## 5. Binding package-layer rule — Task 5.1

### 5.1 Allowed dependency direction

The target direction is:

```text
@tux/domain
   ^      ^
   |      |
persistence   application
      ^       |
      +-------+

platform-contracts -> application
operations/browser -> application + persistence/browser + platform-contracts
operations-desktop -> application + persistence/sqlite + platform-contracts + sync
```

More plainly:

- `@tux/persistence` may depend on `@tux/domain`.
- `@tux/application` may depend on `@tux/domain` and `@tux/persistence`.
- `@tux/persistence` **must not import `@tux/application`, even with `import type`**.
- No new shared package is justified merely to move the two WhatsApp cache DTOs.

### 5.2 Neutral persistence-owned cache types

Persistence owns the local-cache shape because it owns the cache contract. It should define a neutral order-link type, for example:

```ts
export interface CachedWhatsAppOrderLink {
  readonly conversationId: string;
  readonly orderId: OrderId;
  readonly linkedAt: Instant;
}

export interface CachedWhatsAppInboxSnapshot {
  readonly conversations: readonly WhatsAppConversation[];
  readonly messages: readonly WhatsAppMessage[];
  readonly quickReplies: readonly WhatsAppQuickReply[];
  readonly orderLinks: readonly CachedWhatsAppOrderLink[];
}
```

The remote cursor is not persistence state and must remain application/remote state.

Application may preserve its current exported names for compatibility by aliasing/extending the persistence-owned cache types, for example conceptually:

```ts
export type WhatsAppInboxOrderLink = CachedWhatsAppOrderLink;

export interface WhatsAppInboxSnapshot extends CachedWhatsAppInboxSnapshot {
  readonly nextCursor: string | null;
}
```

The exact syntax may vary, but the architectural result is binding: **the persistence package has zero source imports from `@tux/application` and the remote snapshot remains a strict superset of the cache snapshot.**

Task 5.1 is a structural cleanup only. It must not alter SQLite/IndexedDB schemas, remote SQL, message semantics, idempotency, or provider behavior.

---

## 6. Canonical public runtime contract

Task 6 must expose `TuxWhatsAppApi` through `@tux/platform-contracts` and `TuxDesktopApi.whatsapp`.

The contract must track the actual public operations of `OperationsWhatsAppService`, not recreate a parallel DTO vocabulary that can drift.

The required v1 method set is:

```text
loadInbox
loadConversation
sendText
markUnread
archive
setFollowUp
linkOrder
saveDraft
getDraft
```

`saveDraft` and `getDraft` are mandatory. They already exist at the application boundary and are required for equivalent browser/desktop composer behavior; the original Task 6 omission is stale.

`sendMedia` is explicitly absent.

Preferred type rule: `TuxWhatsAppApi` is structurally derived from, or compile-time proven assignable to, the selected `OperationsWhatsAppService` methods. `@tux/platform-contracts` already depends on `@tux/application`, so no new dependency inversion is required.

The browser client and desktop preload must present the **same method signatures and result semantics**.

---

## 7. Browser runtime

The browser composition is:

```text
BrowserRuntime
  |
  +-- CoordinatedOperationsSessionService
  +-- OperationsWhatsAppService
        |
        +-- VercelBrowserWhatsAppRemote
        |      -> same-origin /api/whatsapp
        |
        +-- IndexedDbWhatsAppStore
               -> existing tux-operations-v2 IndexedDB
```

Binding rules:

- Instantiate exactly one WhatsApp service/store/remote per browser runtime instance.
- Reuse the existing browser Operations session object as the `WhatsAppSessionStateSource`.
- Use the Task 5 IndexedDB migration/store; do not create another browser database.
- Keep browser network transport in `VercelBrowserWhatsAppRemote` or a direct successor with the same responsibility.
- Browser requests continue to use same-origin credentials.
- Browser runtime may refresh/load when the inbox is opened; Task 6 does not need a desktop-only realtime primitive.
- Browser failure must not prevent Orders, Board, Expenses, Bulk Stock, or End Day from operating locally.

---

## 8. Desktop runtime

The installed Windows app is authoritative for production Operations, so the WhatsApp service runs in **Electron main**, not the renderer.

```text
Renderer
   |
contextBridge: TuxDesktopApi.whatsapp
   |
Preload defensive result parsing
   |
trusted IPC
   |
Electron Main
   |
OperationsWhatsAppService
   +-- SqliteWhatsAppStore
   +-- DesktopWhatsAppRemote
          |
          +-- existing SupabaseDeviceSessionManager
          +-- HTTPS <TUX_OPERATIONS_API_ORIGIN>/api/whatsapp
```

Binding rules:

1. Renderer code never reads the access token or refresh token.
2. Renderer code never calls the WhatsApp server directly in desktop mode.
3. Preload exposes only the typed `TuxWhatsAppApi` surface.
4. Every WhatsApp IPC handler must call `assertTrustedIpcSender(event, window.webContents.id)` before processing input.
5. Main validates IPC payload primitives/IDs before invoking application logic.
6. Preload defensively validates all untrusted main-process results before returning them to renderer code, following the established `ordersResult.ts` pattern.
7. The local cache is the existing Operations SQLite database and Task 5 WhatsApp local migration; no second SQLite file is created.
8. No Electron security setting is relaxed. `contextIsolation`, sandboxing, Node exposure and navigation/window restrictions remain as currently hardened.

---

## 9. Desktop API origin contract

Task 6 introduces a non-secret runtime configuration value:

```text
TUX_OPERATIONS_API_ORIGIN
```

Rules:

- It is an **origin only**, not a route: scheme + host + optional port.
- Production value must be HTTPS.
- Path, query, fragment, embedded credentials, and non-HTTPS production values are rejected.
- No Meta/Supabase secret is encoded in the origin.
- Task 6 may read this value from environment/config as an **interim pre-release mechanism**.
- There is no hidden hard-coded production fallback.
- Before the Windows release is frozen, the separately planned First-run Device Activation flow must provision/persist the validated API origin as durable device configuration so the shipping product is not permanently environment-variable dependent.

Task 6 therefore makes the transport architecture correct; it does not by itself complete Windows release provisioning.

---

## 10. Desktop device-session use

`DesktopWhatsAppRemote` must reuse the existing `SupabaseDeviceSessionManager`. It must not implement its own refresh-token state machine.

For each remote request it resolves the current session through the manager so the existing rules handle near-expiry refresh and transport failures.

Conceptual behavior:

```text
resolveSession()
  VALID
    -> use accessToken + deviceId for this request
  TRANSPORT_UNAVAILABLE
    -> WhatsApp REMOTE_UNAVAILABLE
  NOT_ENROLLED / AUTHORITATIVELY_INVALID
    -> WhatsApp DEVICE_AUTH_INVALID
  PROTOCOL_ERROR / LOCAL_PERSISTENCE_ERROR
    -> fail closed; do not invent credentials or tenant state
```

A valid desktop request to the TUX server carries only the minimum device credentials needed by the server authority:

```http
Authorization: Bearer <short-lived Supabase access token>
x-tux-device-id: <enrolled device UUID>
Accept: application/json
Content-Type: application/json   # POST only
```

Do not forward a Meta token, Supabase service-role key, refresh token, `shopId`, provider phone-number ID, or worker authority header.

The Supabase publishable key is not needed as a desktop-to-TUX-API authorization header; the TUX server already owns its server-side Supabase public configuration.

---

## 11. Unified server device authority

The existing WhatsApp gateway currently consumes the browser device session. Task 6 must extend this into a **single device-authority resolver** used before all `/api/whatsapp` data or mutation logic.

The resolver supports two credential presentations but produces one authority object:

```ts
interface OperationsDeviceAuthority {
  readonly shopId: ShopId;
  readonly deviceId: DeviceId;
}
```

### 11.1 Browser presentation

Browser mode keeps the current HttpOnly device-session cookies and server-side refresh behavior.

However, the cookie `shopId` is **not tenant authority**. After a usable access token exists, the server must validate the access-token/device binding and derive `shopId` from the authoritative enrolled-device records.

If a retained browser shop cookie conflicts with the server-derived shop, the request fails closed as an invalid device session; the cookie value never changes the selected tenant.

### 11.2 Desktop presentation

Desktop mode is selected when either `Authorization` or `x-tux-device-id` is presented.

- Both headers are required.
- A malformed/incomplete desktop presentation fails; the gateway must not silently fall back to cookie auth.
- The bearer token is validated against Supabase Auth.
- `x-tux-device-id` identifies the candidate device only; it does not assert a shop.
- No `shopId` header/query/body is accepted.

### 11.3 Authoritative server derivation

For either presentation, the same verifier must establish the enrolled Operations-device authority using the authenticated user's own Supabase/RLS context, conceptually:

1. Validate the access token with Supabase Auth (`auth.getUser` or equivalent authoritative verification).
2. Create/use a user-scoped Supabase client with the publishable key + bearer token.
3. Query `public.devices` for the presented `deviceId` and require one active row visible through `devices_self_select`.
4. Derive `shopId` from that row.
5. Require an active self `shop_memberships` row for that derived shop with role `OPERATIONS_DEVICE`.
6. Return `{shopId, deviceId}` only after all checks pass.

This verification path requires no service-role credential. Existing RLS already ties an active device row to its auth user, and membership verification preserves the Operations-device role fence.

Only after this authority object exists may the existing WhatsApp repository/channel/provider logic run.

### 11.4 No client tenant authority

The following must never select the tenant:

- request JSON `shopId`,
- query-string `shopId`,
- custom shop header,
- sender/customer phone,
- conversation lookup across tenants,
- provider phone supplied by the client,
- browser shop cookie by itself,
- desktop local `shopId` by itself.

Existing forbidden-authority request-field checks remain in force.

---

## 12. POST origin / CSRF behavior

Auth-mode behavior is explicit rather than accidental:

- **Browser cookie mode:** keep same-origin enforcement for POST because browser cookies are ambient credentials.
- **Desktop bearer mode:** authorization comes from the explicit bearer header, not ambient browser cookies. An absent `Origin` is acceptable for Electron-main/Node transport. If an `Origin` header is present, it must not be accepted as a cross-origin browser bypass.
- If desktop credential headers are present but invalid, do not fall back to browser cookies.

This preserves browser CSRF protection without requiring Electron main to emulate a browser cookie jar.

---

## 13. One server business/idempotency authority

The existing `/api/whatsapp` gateway remains the only application-facing path for WhatsApp operations.

Both runtimes must continue to rely on the same server implementation for:

- current-worker synchronization checks,
- Business Day/worker claims supplied by the application and authoritatively checked server-side,
- tenant fencing,
- active WhatsApp channel resolution,
- outbound intent claim/idempotency,
- duplicate-safe provider materialization,
- Meta Cloud API invocation,
- delivery-uncertain semantics,
- conversation state mutation,
- order-link authorization.

Desktop must **not** call Meta directly and must **not** call the WhatsApp Supabase repository/RPCs directly. Existing direct Supabase usage for device enrollment/session refresh is outside this rule and remains canonical for device-session lifecycle only.

---

## 14. Remote error semantics

Task 6 must preserve the Task 5 distinctions and add one needed transport distinction:

```text
OPERATOR_NOT_SYNCHRONIZED
OUTBOUND_INTENT_CONFLICT
DELIVERY_UNCERTAIN
REMOTE_UNAVAILABLE
DEVICE_AUTH_INVALID
```

`DEVICE_AUTH_INVALID` represents an authoritative missing/revoked/invalid enrolled-device session, not a transient network outage.

Binding behavior:

- Only `REMOTE_UNAVAILABLE` qualifies `loadInbox()` for cached-offline fallback.
- `DEVICE_AUTH_INVALID` does not masquerade as offline availability; it returns an application remote-sync/auth failure and requires session remediation rather than indefinite silent stale-cache mode.
- A transient inability to refresh a still-enrolled desktop session maps to `REMOTE_UNAVAILABLE` so cached inbox data remains usable.
- Delivery uncertainty remains distinct from a confirmed provider rejection and must never trigger a blind resend.

The exact user-facing message can be decided with the UI task; the semantic distinction is required now.

---

## 15. Offline/local-first behavior

WhatsApp is subordinate to the POS local-first contract.

### Reads

- `loadConversation()` remains local-cache based.
- `loadInbox()` attempts remote refresh first.
- On transient `REMOTE_UNAVAILABLE`, `loadInbox()` returns the last cached snapshot for the locally resolved shop when available.
- Browser cache = IndexedDB; desktop cache = SQLite.

### Drafts

- Composer drafts are local and restart-persistent through Task 5 stores.
- Draft save/read must work without remote availability.

### Mutations and sends

- `sendText`, mark unread, archive, follow-up, and order-link mutations require the remote authority.
- Task 6 does not introduce an offline WhatsApp send queue.
- Do not persist a text while offline and later transmit it automatically merely because connectivity returned.
- `DELIVERY_UNCERTAIN` must not be converted into an automatic retry.

### POS independence

WhatsApp failure must not block Orders, Orders Board, Expenses, Bulk Stock, End Day, local printing, or Business Day persistence.

---

## 16. Browser/desktop equivalence without implementation duplication

Equivalent public behavior does not mean identical transport code.

Allowed runtime-specific adapters:

```text
VercelBrowserWhatsAppRemote
DesktopWhatsAppRemote
IndexedDbWhatsAppStore
SqliteWhatsAppStore
```

Shared semantic layer:

```text
OperationsWhatsAppService
WhatsAppRemoteGateway
WhatsAppStore
TuxWhatsAppApi
/api/whatsapp server authority
```

Business rules must not migrate into preload, IPC handlers, React JSX, or the desktop remote merely to make one runtime pass tests.

---

## 17. Security invariants

Task 5.1/6 are not complete unless all of these remain true:

1. No Meta access token or app secret outside server-only files/config.
2. No Supabase service-role key in Operations renderer/application/persistence/preload/Electron transport.
3. Refresh token remains in the device-session store and is never sent to `/api/whatsapp`.
4. Renderer cannot read access/refresh tokens.
5. Renderer cannot choose `shopId`, `deviceId`, provider channel, destination phone, or `sentByWorkerId` as server authority.
6. Server derives `shopId` from authenticated enrolled-device records.
7. Desktop bearer mode cannot downgrade to cookie mode after malformed credentials.
8. Browser POST retains CSRF/same-origin enforcement.
9. Every Electron WhatsApp IPC handler verifies the trusted sender.
10. Preload validates return structures before exposing them to renderer code.
11. No `sendMedia` appears at the application/platform boundary in Task 6.
12. No second WhatsApp backend or direct Desktop→Meta path exists.

---

## 18. Data/migration invariants

Task 5.1 and Task 6 require **no new remote WhatsApp database schema merely for runtime transport**.

The completed WhatsApp SQL migrations remain immutable unless a separately reviewed defect requires an append-only migration.

Task 5 local schemas remain authoritative:

- existing SQLite WhatsApp cache migration,
- existing IndexedDB WhatsApp cache migration,
- no destructive browser upgrade,
- no separate desktop WhatsApp DB.

A server-auth implementation may use existing `devices`, `shop_memberships`, Supabase Auth, and their RLS policies. Do not add a new client-controlled tenant-mapping table.

---

## 19. Configuration/deployment boundary

Task 5.1/6 implementation is repository work only.

Forbidden during these tasks unless separately authorized:

- changing production Vercel environment variables,
- deploying `/api/whatsapp` to production,
- inserting/updating production `whatsapp_channels`,
- changing Meta webhook/app/phone configuration,
- applying new SQL to production Supabase,
- rotating or exposing secrets,
- changing production JWT settings.

CI/test-only server configuration is allowed when it contains no real secrets and follows repository conventions.

---

## 20. Required verification categories for the later implementation plan

The implementation plan written after approval of this spec must include TDD evidence for at least these categories.

### Task 5.1 layering cleanup

- RED proving persistence currently imports application or a compile/static dependency rule that fails before cleanup.
- GREEN proving zero `@tux/application` imports from persistence.
- Existing Task 5 focused tests remain green.
- No local schema or remote SQL diff.

### Server device authority

Tests must prove:

- browser valid session derives shop from device authority,
- desktop valid bearer + device ID derives the same authority,
- desktop bearer without device ID fails,
- device ID without bearer fails,
- invalid bearer does not fall back to cookies,
- caller-supplied shop cannot select another tenant,
- tampered/mismatched browser shop cookie cannot select another tenant,
- inactive/wrong device fails,
- non-`OPERATIONS_DEVICE`/inactive membership fails,
- cross-tenant device attempt fails,
- browser POST same-origin fence remains,
- desktop main request without browser Origin can authenticate by bearer.

### Desktop remote

Tests must prove:

- uses `SupabaseDeviceSessionManager` resolution rather than custom refresh logic,
- near-expiry resolution follows the existing manager,
- sends only access bearer + device ID as authority headers,
- does not send refresh token/shopId/service-role/Meta credentials,
- validates HTTPS API origin,
- maps transient session transport failure to `REMOTE_UNAVAILABLE`,
- maps authoritative invalid session to `DEVICE_AUTH_INVALID`,
- preserves delivery-uncertain semantics,
- never sends media.

### Electron IPC/preload

Tests must prove:

- all public `TuxWhatsAppApi` methods are bridged,
- `saveDraft`/`getDraft` are included,
- trusted sender check exists on every handler,
- malformed payloads are rejected before application invocation,
- malformed main results are rejected in preload,
- no direct renderer network path is required.

### Browser runtime

Tests must prove:

- browser service uses the existing IndexedDB store and Vercel remote,
- desktop presence selects `window.tuxDesktop.whatsapp`,
- browser absence selects the browser WhatsApp service,
- public API shapes are equivalent.

### Full gate

Later completion claims require fresh evidence for focused tests, full typecheck, lint, format check, migration tests, security/secret fencing, and clean-tree/diff verification.

---

## 21. Supersession rules for the original Task 6

Where `2026-09-02-tux-operations-whatsapp-inbox.md` Task 6 conflicts with this spec, this spec wins.

Specifically, the following original assumptions are superseded:

- Task 6 is no longer limited to platform-contract/preload/main/sessionClient files; server auth and a desktop remote adapter are required.
- Desktop does not emulate browser cookies.
- Desktop does not call Supabase WhatsApp repository/RPCs or Meta directly.
- `TuxWhatsAppApi` must include the actual service draft methods.
- Runtime DTOs must follow actual Task 5 service types rather than stale parallel names.
- A package-layer cleanup occurs before the runtime bridge.
- The server must derive tenant authority for both credential presentations rather than trust a client shop identifier.

Everything in the original plan that is not contradicted remains valid, including defensive preload parsing, trusted IPC sender checks, same public API shape, and browser/desktop runtime parity.

---

## 22. Acceptance definition

This design is satisfied when the later implementation demonstrates the following end state:

```text
persistence ─X─> application              # no dependency
application ----> persistence             # allowed

Browser renderer
  -> OperationsWhatsAppService
  -> IndexedDB + /api/whatsapp

Desktop renderer
  -> contextBridge / trusted IPC
  -> Electron Main OperationsWhatsAppService
  -> SQLite + DesktopWhatsAppRemote
  -> HTTPS /api/whatsapp

/api/whatsapp
  -> authoritative access-token/device verification
  -> derives shop server-side
  -> existing WhatsApp business/idempotency/provider authority
```

And all of the following statements are true:

- one server WhatsApp authority,
- one application WhatsApp behavior layer,
- two runtime adapters only where platform mechanics differ,
- no persistence→application cycle,
- no client-selected tenant,
- no desktop secret expansion,
- no Electron hardening regression,
- cached inbox remains available on transient network outage,
- no blind offline outbound replay,
- no production mutation performed as part of Task 5.1/6 implementation.

---

## 23. Planning gate

Do not start production-code implementation from this document alone.

After the written spec is reviewed and accepted, invoke the planning workflow and create a binding implementation amendment with two ordered phases:

1. **Task 5.1 — package-layer cleanup**, independently RED/GREEN verified.
2. **Corrected Task 6 — unified runtime bridge + desktop transport + server device authority**, independently RED/GREEN verified.

Only then hand the plan to the Classic ChatGPT implementer.