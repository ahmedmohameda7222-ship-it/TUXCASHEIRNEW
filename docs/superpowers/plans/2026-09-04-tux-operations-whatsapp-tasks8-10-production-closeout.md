# TUX Operations WhatsApp Tasks 8–10 Production Closeout Implementation Plan

> **For Classic ChatGPT implementer:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans`. Do **not** use `superpowers:subagent-driven-development`. Execute this plan task-by-task with checkbox tracking, but follow the binding one-pass cadence below: no reviewer STOP between Task 8, Task 9, and Task 10; return once after the whole plan is complete.

**Goal:** Complete the remaining TUX Operations WhatsApp Inbox scope: safe customer/order integration with Business-Day-scoped parked drafts, provider-policy-aware internal messaging, full image/document/audio/location send/receive with private 30-day media retention, Windows notification privacy, and deterministic CI/E2E/security/production-acceptance closeout.

**Architecture:** Preserve the Tasks 5–7 browser/Electron/server boundary. Keep Orders ownership local-first and authoritative for local drafts/order context; keep WhatsApp provider policy, Meta credentials, media storage administration, signed media access, and messaging-window/template eligibility server-side. Add focused capabilities instead of turning `packages/application/src/whatsapp.ts` or `apps/operations/src/app/WhatsAppWorkspace.tsx` into cross-domain monoliths.

**Tech Stack:** TypeScript 6, React 19, Vitest 4, Electron 43 contextBridge/IPC, IndexedDB, Node `node:sqlite`, Vercel API routes, Supabase Postgres + private Storage, Meta WhatsApp Cloud API, Playwright 1.62, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-04-whatsapp-orders-media-production-closeout-design.md`

## Global Constraints

- Exact implementation baseline is `0684c49f3988545ea68efdfa1d0a1ce4de9e0cdc` on `feat/operations-whatsapp-inbox`.
- Before editing, verify `git rev-parse HEAD` equals the exact baseline and `git status --short` is empty. If not, STOP rather than rebasing or silently adapting.
- Read the binding spec above plus the completed Task 6/7 runtime/UI specs before editing.
- Use `superpowers:executing-plans`; Classic ChatGPT executes inline. Do not dispatch subagents.
- Strict TDD for every capability: write RED test → run and confirm the intended failure → minimal GREEN implementation → rerun focused tests → related gate → commit.
- Do not STOP for review between Tasks 8, 9, and 10. Only stop for a genuinely unresolved product decision or an external prerequisite that cannot be safely isolated.
- TUX-MENU Web Order Bridge / Web Order Request lifecycle is explicitly out of scope.
- No AI, OCR, chatbot, message-to-order parsing, or payment-proof auto-confirmation.
- WhatsApp remains inside TUX Operations. Do not open `wa.me`, WhatsApp Web, or external WhatsApp Desktop.
- Browser WhatsApp transport remains same-origin `/api/whatsapp`.
- Windows renderer remains `window.tuxDesktop.whatsapp` → defensive preload → trusted IPC → Electron Main → TUX server.
- Renderer/browser/Desktop WhatsApp client code must never contain Meta access tokens/app secrets, Supabase service-role credentials, or direct `graph.facebook.com` calls.
- Device/shop authority remains server-resolved. Client payloads must not choose trusted `shopId`, `deviceId`, `providerPhoneNumberId`, recipient `to`, or sent-by worker identity.
- Current Operator claims remain resolved from the ACTIVE Operations session at call time for worker-authorized sends/links.
- `REMOTE_UNAVAILABLE` is the only cached-inbox fallback condition. Authentication/authority failure is not offline.
- No outbound offline queue and no reconnect auto-replay.
- `PENDING`/delivery uncertainty is never treated as a safe retryable failure.
- Existing migrations are immutable. Create new migrations only.
- Do not apply migrations, Storage changes, Meta configuration, templates, or production environment changes to a remote production project in this implementation pass. Create repository artifacts and deterministic tests only unless the user separately gives explicit production-mutation authority.
- Media binary source of truth after ingestion is private Supabase Storage. Browser `localStorage` is never a media binary store.
- Media binary retention is exactly 30 days from TUX durable ingestion: `expiresAt = storedAt + 30 days`; metadata/history remains after binary deletion.
- Unsent selected files and in-progress voice recordings are transient in v1 and do not survive restart.
- Windows notification without an ACTIVE Business Day/current worker is generic only: `New WhatsApp message`; no customer, phone, text, filename, caption, or location details.
- Node engine remains `>=20.19.0 <27`; CI Node remains 24 unless a separate approved change exists.
- Preserve existing CI migration, security, rendered E2E, and Windows package gates; add to them rather than removing them.

---

## File Structure and Responsibility Map

### Domain / application

- Modify `packages/domain/src/orderDraft.ts` — export the single canonical `hasMeaningfulOrderDraft` predicate.
- Create `packages/domain/src/parkedOrderDraft.ts` — durable parked-draft state and invariants.
- Modify `packages/domain/src/whatsapp.ts` — safe media/template/location/messaging-target domain types; never provider secrets or permanent media URLs.
- Modify `packages/domain/src/index.ts` — export new domain types/helpers.
- Modify `packages/application/src/orders.ts` — park/start/restore/discard application commands and parked summaries.
- Modify `packages/application/src/endDay.ts` — block End Day on active parked drafts using the same shared command coordinator.
- Create `packages/application/src/whatsappOrderContext.ts` — local-first customer + active-order resolution and typed Orders prefill.
- Create `packages/application/src/whatsappMessaging.ts` — provider-policy-facing messaging target/config/template/media/location orchestration kept separate from text draft/cache concerns.
- Modify `packages/application/src/whatsapp.ts` — keep existing inbox/text/cache behavior and compose with new messaging capability only where shared error/idempotency semantics are required.
- Modify `packages/application/src/whatsappRemote.ts` — typed remote operations for policy/config/template/media/location/retry/media access.
- Modify `packages/application/src/whatsappWire.ts` — strict parsing for every new server response and error code.
- Modify `packages/application/src/index.ts` — exports.

### Local persistence

- Modify `packages/persistence/src/orderDraftStore.ts` — atomic parked-draft operations alongside the active draft.
- Modify `packages/persistence/src/browser/IndexedDbOrderDraftStore.ts` — IndexedDB v2 `parkedDrafts` store and atomic multi-store transactions.
- Modify `packages/persistence/src/sqlite/SqliteOrderDraftStore.ts` — local draft schema v2 `parked_order_drafts` table and `BEGIN IMMEDIATE` atomic swaps.
- Modify/add corresponding persistence tests under `packages/persistence/src/browser/*OrderDraftStore.test.ts` and `packages/persistence/src/sqlite/*OrderDraftStore.test.ts`.
- Modify `packages/persistence/src/whatsappStore.ts` only for safe cached message fields if the domain message representation changes; do not persist signed URLs or binary blobs.
- Modify IndexedDB/SQLite WhatsApp store tests to prove signed URLs/provider URLs are not canonical cache fields.

### Server / Supabase

- Create `supabase/migrations/20260904010000_whatsapp_messaging_policy.sql` — starter templates, shop messaging config, policy/context RPCs, server-only grants.
- Create `supabase/migrations/20260904011000_whatsapp_media_storage.sql` — private media metadata, 30-day retention metadata, idempotent cleanup RPC, private Storage bucket metadata.
- Modify `server/whatsappOperationsRepository.ts` — policy/template/config/media metadata RPC adapter.
- Modify `server/whatsappOperationsGateway.ts` — server-authoritative free-form eligibility, template/media/location/retry/media-access actions.
- Modify `server/whatsappProviderGateway.ts` — text + template + image/document/audio/location provider payloads, media metadata fetch/download for inbound.
- Create `server/whatsappMediaStorage.ts` — private bucket signed upload/download, metadata validation, expiry, cleanup adapter.
- Create `server/whatsappMediaPolicy.ts` — centralized MIME/signature/size policy.
- Modify `server/whatsappWebhook.ts` — ingest inbound binary media into TUX Storage before exposing canonical message media references.
- Modify `server/whatsappServerConfig.ts` only if a server-side bucket name/retention constant needs a typed config; never add client exposure.
- Add/update server tests beside each module.

### Browser / Electron transport

- Modify `packages/platform-contracts/index.d.ts` — extend `TuxOrdersApi`, `TuxEndDayApi` as required by parked drafts and extend `TuxWhatsAppApi` with exact new typed methods.
- Modify `apps/operations/src/app/browserWhatsAppRemote.ts` — new JSON actions plus signed upload flow; no direct Meta calls.
- Modify `apps/operations/src/app/sessionClient.ts` — compose browser WhatsApp API with local order-context service and existing shared browser runtime/database/coordinator.
- Modify `apps/operations-desktop/src/main/desktopWhatsAppRemote.ts` — same server contract with bearer + `x-tux-device-id`; signed upload only for media bytes.
- Modify `apps/operations-desktop/src/main/whatsappIpc.ts` — defensive validation of every new renderer request.
- Modify `apps/operations-desktop/src/preload/whatsappResult.ts` — defensive result parsers that strip causes and reject unknown/untrusted shapes.
- Modify `apps/operations-desktop/src/preload/index.ts` — expose only approved typed methods.
- Modify `apps/operations-desktop/src/main/index.ts` — compose local order context into desktop WhatsApp API, scoped media/notification runtime, and shared coordinator.
- Modify corresponding browser/Desktop/preload/IPC tests.

### Operations UI

- Create `apps/operations/src/app/whatsappOrderContext.ts` — pure presentation/navigation helpers for context cards and Orders/WhatsApp intents; no database/provider logic.
- Modify `apps/operations/src/app/whatsappInboxController.ts` — selected-conversation context state, deterministic Send Menu insertion, media send state, explicit failed retry, media access refresh.
- Modify `apps/operations/src/app/WhatsAppWorkspace.tsx` — context card, link/unlink, Create Order from Chat, Send Menu, templates, media rendering/composer, voice/location controls.
- Modify `apps/operations/src/app/OrdersWorkspace.tsx` — consume typed customer prefill; Parked Orders UI; safe park/start and restore/discard flow.
- Modify `apps/operations/src/app/OrdersBoardWorkspace.tsx` — `WhatsApp Customer` for delivery orders with normalized phone and optional focused-order presentation.
- Modify `apps/operations/src/app/App.tsx` — app-owned typed navigation intents between Orders/Board/WhatsApp; preserve `requestProtectedTransition`.
- Create `apps/operations/src/app/whatsappMediaComposer.ts` — transient file/voice/location state machine, object-URL cleanup, permission/error states.
- Modify `apps/operations/src/styles/global.css` and `orders.css` only for the new UI states.
- Add focused component/controller tests; keep all business/provider rules outside JSX.

### Windows notifications

- Create `apps/operations-desktop/src/main/whatsappNotifications.ts` — OS notification dedupe/privacy policy and focus suppression.
- Create `apps/operations-desktop/src/main/whatsappNotificationFeed.ts` — device-authorized minimal server watcher used even when no worker/day is active; generic envelope only outside ACTIVE worker/day.
- Add matching tests and wire lifecycle in `apps/operations-desktop/src/main/index.ts`.

### Task 10 gates

- Create `e2e/whatsapp-inbox.e2e.ts` — rendered deterministic WhatsApp acceptance.
- Create `e2e/whatsappFakeServer.ts` — local contract-faithful API + signed-upload fake used by Playwright; it is test infrastructure, never production code.
- Modify `playwright.config.ts` and root `package.json` so the E2E server hosts both the built Operations frontend and `/api/whatsapp` fake contract instead of relying on plain Vite preview for WhatsApp.
- Create `scripts/test-whatsapp-security.mjs` — source/security boundary assertions.
- Create `scripts/test-whatsapp-media-migration.mjs` and `scripts/test-whatsapp-messaging-policy-migration.mjs` — migration semantics/immutability smoke.
- Modify `scripts/test-migrations.mjs` only if the plain PostgreSQL harness needs the minimal `storage.buckets` test fixture required to execute the new Storage migration.
- Modify `.github/workflows/ci.yml` — add named WhatsApp architecture/security steps without removing existing gates.
- Create `docs/WHATSAPP_PRODUCTION_ACCEPTANCE.md` — real-provider manual checklist and explicit pending classification.

---

# TASK 8 — Customer / Order Context and Safe Order Handoff

## Task 8A: Canonical meaningful-draft rule and atomic parked-draft persistence

**Files:**
- Modify: `packages/domain/src/orderDraft.ts`
- Create: `packages/domain/src/parkedOrderDraft.ts`
- Modify: `packages/domain/src/index.ts`
- Modify: `packages/persistence/src/orderDraftStore.ts`
- Modify: `packages/persistence/src/browser/IndexedDbOrderDraftStore.ts`
- Modify: `packages/persistence/src/sqlite/SqliteOrderDraftStore.ts`
- Test: `packages/domain/src/orderDraft.test.ts`
- Test: `packages/domain/src/parkedOrderDraft.test.ts`
- Test: `packages/persistence/src/browser/IndexedDbOrderDraftStore.test.ts`
- Test: `packages/persistence/src/sqlite/SqliteOrderDraftStore.test.ts`

**Interfaces:**

```ts
// packages/domain/src/orderDraft.ts
export function hasMeaningfulOrderDraft(draft: OrderDraft | null): boolean;

// packages/domain/src/parkedOrderDraft.ts
export type ParkedOrderDraftState = 'PARKED' | 'RESTORED' | 'DISCARDED';

export interface ParkedOrderDraft {
  readonly id: string;
  readonly shopId: ShopId;
  readonly businessDayId: BusinessDayId;
  readonly draftScopeId: string;
  readonly draft: OrderDraft;
  readonly parkedAt: Instant;
  readonly parkedByWorkerId: WorkerId;
  readonly state: ParkedOrderDraftState;
  readonly resolvedAt: Instant | null;
  readonly resolvedByWorkerId: WorkerId | null;
}

export function assertParkedOrderDraftInvariant(value: ParkedOrderDraft): void;
```

`hasMeaningfulOrderDraft` must exactly preserve the current End Day semantics: meaningful when there are lines, non-empty order note, non-zero discount, payment mode not `NONE`, non-empty delivery phone/name/address, non-null zone, or non-zero final delivery fee. Do not treat the default order type, checkout key, revision, or timestamps as meaningful customer work.

```ts
// packages/persistence/src/orderDraftStore.ts
export interface ParkAndReplaceOrderDraftInput {
  readonly activeKey: OrderDraftKey;
  readonly expectedActiveRevision: number;
  readonly parked: ParkedOrderDraft;
  readonly replacement: OrderDraft;
}

export interface RestoreParkedOrderDraftInput {
  readonly activeKey: OrderDraftKey;
  readonly expectedActiveRevision: number;
  readonly parkedId: string;
  readonly parkActiveAs: ParkedOrderDraft | null;
  readonly restoredAt: Instant;
  readonly restoredByWorkerId: WorkerId;
}

export interface ResolveParkedOrderDraftInput {
  readonly shopId: ShopId;
  readonly businessDayId: BusinessDayId;
  readonly parkedId: string;
  readonly resolvedAt: Instant;
  readonly resolvedByWorkerId: WorkerId;
}

export interface OrderDraftStore {
  initialize(): Promise<void>;
  get(key: OrderDraftKey): Promise<OrderDraft | null>;
  put(draft: OrderDraft): Promise<void>;
  delete(key: OrderDraftKey): Promise<void>;
  listParked(shopId: ShopId, businessDayId: BusinessDayId): Promise<readonly ParkedOrderDraft[]>;
  parkAndReplace(input: ParkAndReplaceOrderDraftInput): Promise<ParkedOrderDraft>;
  restoreParked(input: RestoreParkedOrderDraftInput): Promise<{
    readonly restoredDraft: OrderDraft;
    readonly parkedActive: ParkedOrderDraft | null;
  }>;
  discardParked(input: ResolveParkedOrderDraftInput): Promise<ParkedOrderDraft>;
  close(): Promise<void>;
}
```

- [ ] **Step 1: Write RED domain tests for meaningful draft and parked invariants**

Test exact positive/negative cases. In particular, a freshly created empty draft is not meaningful; each customer-entered field independently makes it meaningful. A `PARKED` record requires `resolvedAt/resolvedByWorkerId === null`; `RESTORED` and `DISCARDED` require both non-null; nested draft shop/day/scope must match the record.

- [ ] **Step 2: Run domain RED**

Run:

```bash
npm test -- packages/domain/src/orderDraft.test.ts packages/domain/src/parkedOrderDraft.test.ts
```

Expected: FAIL because `hasMeaningfulOrderDraft` / parked-draft module do not exist.

- [ ] **Step 3: Add the canonical helper and parked-draft invariant implementation**

Implement the exact meaningful predicate and invariant checks. Export them through `packages/domain/src/index.ts`.

- [ ] **Step 4: Run domain GREEN**

Run the same command. Expected: PASS.

- [ ] **Step 5: Write RED persistence tests for atomic park/start, restore, discard, and restart**

For both IndexedDB and SQLite prove:

1. `parkAndReplace` stores the old active draft as `PARKED` and replaces the active key in one storage transaction.
2. Wrong `expectedActiveRevision` rejects without changing active or parked data.
3. Restart/reopen lists the same `PARKED` record for the same Business Day.
4. `restoreParked` marks the selected record `RESTORED`, restores its original checkout intent and payload into the active scope, and optionally parks the previously active draft in the same transaction.
5. `discardParked` changes state to `DISCARDED` with resolver identity/time but no longer appears from `listParked`.
6. Another shop/day cannot restore or discard the record.

- [ ] **Step 6: Run persistence RED**

```bash
npm test -- packages/persistence/src/browser/IndexedDbOrderDraftStore.test.ts packages/persistence/src/sqlite/SqliteOrderDraftStore.test.ts
```

Expected: FAIL because parked operations/schema are absent.

- [ ] **Step 7: Upgrade IndexedDB draft storage to version 2**

Use `upgradeneeded` with `event.oldVersion` guards. Keep the existing `drafts` store unchanged for old installations. Add `parkedDrafts` keyed by `id` with indexes on `['shopId', 'businessDayId', 'state', 'parkedAt']` and `['shopId', 'businessDayId', 'draftScopeId']`. `parkAndReplace` and `restoreParked` must open one `readwrite` transaction containing both stores.

- [ ] **Step 8: Upgrade SQLite local draft schema to version 2**

Add a `parked_order_drafts` table inside the existing local draft migration ledger. Store the validated full parked record as JSON plus indexed authority columns. Use `BEGIN IMMEDIATE` for park/replace/restore/discard transitions and rollback on any error.

- [ ] **Step 9: Run persistence GREEN and typecheck the two persistence packages**

```bash
npm test -- packages/persistence/src/browser/IndexedDbOrderDraftStore.test.ts packages/persistence/src/sqlite/SqliteOrderDraftStore.test.ts
npm run typecheck -w @tux/persistence
```

Expected: PASS.

- [ ] **Step 10: Commit Task 8A**

```bash
git add packages/domain/src/orderDraft.ts packages/domain/src/parkedOrderDraft.ts packages/domain/src/index.ts packages/domain/src/orderDraft.test.ts packages/domain/src/parkedOrderDraft.test.ts packages/persistence/src/orderDraftStore.ts packages/persistence/src/browser/IndexedDbOrderDraftStore.ts packages/persistence/src/browser/IndexedDbOrderDraftStore.test.ts packages/persistence/src/sqlite/SqliteOrderDraftStore.ts packages/persistence/src/sqlite/SqliteOrderDraftStore.test.ts
git commit -m "feat: add atomic parked order drafts"
```

## Task 8B: Orders commands, prefill, parked Orders workspace, and End Day authority

**Files:**
- Modify: `packages/application/src/orders.ts`
- Modify: `packages/application/src/orders.test.ts`
- Modify: `packages/application/src/endDay.ts`
- Modify: `packages/application/src/endDay.test.ts`
- Modify: `packages/platform-contracts/index.d.ts`
- Modify: `apps/operations-desktop/src/main/index.ts`
- Modify: `apps/operations-desktop/src/main/endDayIpc.ts`
- Modify: `apps/operations-desktop/src/preload/endDayResult.ts`
- Modify: `apps/operations-desktop/src/preload/index.ts`
- Modify: `apps/operations/src/app/sessionClient.ts`
- Test the affected desktop/browser integration surfaces.

**Interfaces:**

```ts
export interface OrdersCustomerPrefill {
  readonly normalizedPhone: string;
  readonly displayPhone: string;
  readonly customerName: string;
  readonly address: string | null;
  readonly zoneId: DeliveryZoneId | null;
}

export interface ParkedOrderSummary {
  readonly id: string;
  readonly parkedAt: Instant;
  readonly parkedByWorkerId: WorkerId;
  readonly lineCount: number;
  readonly customerName: string;
  readonly displayPhone: string;
  readonly totalQuantity: number;
}

// OrdersWorkspace gains:
readonly parkedDrafts: readonly ParkedOrderSummary[];

// OperationsOrdersService gains:
startOrderFromCustomerPrefill(input: {
  readonly draftScopeId: string;
  readonly prefill: OrdersCustomerPrefill;
  readonly parkCurrent: boolean;
}): Promise<OrdersWorkspaceResult>;
restoreParkedDraft(input: {
  readonly draftScopeId: string;
  readonly parkedDraftId: string;
  readonly parkCurrent: boolean;
}): Promise<OrdersWorkspaceResult>;
discardParkedDraft(input: {
  readonly parkedDraftId: string;
}): Promise<Result<true, ApplicationError>>;
```

The prefill application must use `normalizeEgyptianPhone` defensively and must only fill delivery customer fields. It must not add product lines, payment, discount, or infer order type from chat content. If a zone id is no longer active/configured, preserve the address/name/phone but set `zoneId` to null and leave normal Orders validation to the worker.

Extend `EndDayGate` with:

```ts
| {
    readonly kind: 'PARKED_DRAFTS_BLOCKED';
    readonly businessDayId: BusinessDayId;
    readonly parkedDraftCount: number;
  }
```

- [ ] **Step 1: Write RED Orders service tests**

Cover empty active draft → new prefilled empty draft; meaningful active draft + `parkCurrent:false` → `CONFLICT_ERROR` and zero storage mutation; meaningful + `parkCurrent:true` → atomic park and fresh prefilled empty draft; park persistence shown in `loadWorkspace`; restore without overwriting meaningful active draft; restore with explicit `parkCurrent:true`; explicit discard.

- [ ] **Step 2: Run Orders RED**

```bash
npm test -- packages/application/src/orders.test.ts
```

Expected: FAIL because parked/prefill commands do not exist.

- [ ] **Step 3: Implement Orders commands using the shared `ApplicationCommandCoordinator`**

Generate parked IDs and fresh checkout keys through the existing runtime `createUuid()`. Always resolve current shop/day/operator immediately before mutation. Build replacements with `createEmptyOrderDraft`, then apply only `OrdersCustomerPrefill`. Use persistence revision compare-and-swap inputs so stale UI state cannot overwrite a newer draft.

- [ ] **Step 4: Run Orders GREEN**

```bash
npm test -- packages/application/src/orders.test.ts
```

Expected: PASS.

- [ ] **Step 5: Write RED End Day tests**

Prove `beginEndDay`, preview, and `closeDay` all reject when `listParked` contains one or more active `PARKED` records, and become READY only after explicit restore/discard. Prove `DISCARDED`/`RESTORED` historical records do not block.

- [ ] **Step 6: Run End Day RED**

```bash
npm test -- packages/application/src/endDay.test.ts
```

Expected: FAIL because the parked gate is absent.

- [ ] **Step 7: Replace the private End Day meaningful predicate with the domain helper and add the parked gate**

`#gate` order remains: active Orders first, meaningful active draft second, active parked drafts third, READY last. Because Orders and End Day share the same application coordinator in both browser and desktop runtimes, the gate and Orders draft mutation cannot interleave inside one process.

- [ ] **Step 8: Extend platform/browser/Electron Orders and End Day contracts defensively**

Add the three new Orders methods to `TuxOrdersApi`; add parser/IPC validation for new result shapes. Do not expose `OrderDraftStore` or raw parked JSON to renderer.

- [ ] **Step 9: Run Task 8B focused GREEN**

```bash
npm test -- packages/application/src/orders.test.ts packages/application/src/endDay.test.ts apps/operations-desktop/src/main/endDayIpc.test.ts apps/operations-desktop/src/preload/endDayResult.test.ts
npm run typecheck -w @tux/application
npm run typecheck -w @tux/operations
npm run typecheck -w @tux/operations-desktop
```

Expected: PASS.

- [ ] **Step 10: Commit Task 8B**

```bash
git add packages/application/src/orders.ts packages/application/src/orders.test.ts packages/application/src/endDay.ts packages/application/src/endDay.test.ts packages/platform-contracts/index.d.ts apps/operations-desktop/src/main/index.ts apps/operations-desktop/src/main/endDayIpc.ts apps/operations-desktop/src/preload/endDayResult.ts apps/operations-desktop/src/preload/index.ts apps/operations/src/app/sessionClient.ts
git commit -m "feat: protect parked orders through End Day"
```

## Task 8C: Local-first WhatsApp customer/order context and typed navigation payloads

**Files:**
- Create: `packages/application/src/whatsappOrderContext.ts`
- Create: `packages/application/src/whatsappOrderContext.test.ts`
- Modify: `packages/application/src/index.ts`
- Modify: `packages/platform-contracts/index.d.ts`
- Modify: `apps/operations/src/app/sessionClient.ts`
- Modify: `apps/operations-desktop/src/main/index.ts`
- Modify: `apps/operations-desktop/src/main/whatsappIpc.ts`
- Modify: `apps/operations-desktop/src/preload/whatsappResult.ts`
- Modify: `apps/operations-desktop/src/preload/index.ts`

**Architecture note:** Customer/active-order context is local-first because newly placed local Orders may not yet be remote-synced. Provider window/template authority remains server-side and is a separate capability in Task 8D.

**Interfaces:**

```ts
export interface WhatsAppActiveOrderCandidate {
  readonly orderId: OrderId;
  readonly displayOrderNo: number;
  readonly createdAt: Instant;
  readonly orderTypeLabel: string;
  readonly totalMinor: MoneyMinor;
}

export interface WhatsAppCustomerOrderContext {
  readonly conversationId: string;
  readonly normalizedPhone: string;
  readonly displayPhone: string;
  readonly customer: null | {
    readonly id: CustomerContactId;
    readonly name: string;
    readonly address: string | null;
    readonly zoneId: DeliveryZoneId | null;
  };
  readonly activeOrders: readonly WhatsAppActiveOrderCandidate[];
  readonly linkedOrderId: OrderId | null;
}

export class OperationsWhatsAppOrderContextService {
  constructor(input: {
    readonly database: OperationsDatabase;
    readonly store: WhatsAppStore;
    readonly session: WhatsAppSessionStateSource;
  });
  resolveCustomerOrderContext(
    conversationId: string,
  ): Promise<Result<WhatsAppCustomerOrderContext, ApplicationError>>;
}
```

Resolution rules:
- current session must resolve a shop; interactive Task 8 UI still lives in ACTIVE shell;
- conversation comes from the local WhatsApp cache and must belong to that shop;
- customer lookup uses normalized phone;
- active-order candidates are current Business Day local orders where `status === 'ACTIVE'`, `fulfillment.behavior === 'DELIVERY'`, and `fulfillment.delivery.normalizedPhone` equals the conversation normalized phone;
- candidates sort by `createdAt`, then `displayOrderNo`, deterministically;
- multiple candidates stay multiple; never pick one implicitly.

- [ ] **Step 1: Write RED context tests for unknown customer, zero/one/many active orders, stale different-shop data, and explicit linked order**

- [ ] **Step 2: Run RED**

```bash
npm test -- packages/application/src/whatsappOrderContext.test.ts
```

Expected: FAIL because the service does not exist.

- [ ] **Step 3: Implement the local-first resolver**

Use only local `OperationsDatabase` and cached WhatsApp store. Do not make a server request from this service and do not parse message text.

- [ ] **Step 4: Run GREEN**

```bash
npm test -- packages/application/src/whatsappOrderContext.test.ts
```

Expected: PASS.

- [ ] **Step 5: Extend `TuxWhatsAppApi` and both runtimes with `resolveCustomerOrderContext`**

Compose the focused service with the existing `OperationsWhatsAppService`. In browser, reuse the already initialized `browserRuntime()` database/session and the singleton WhatsApp store; do not open a second Operations database. In desktop Main, reuse `operationsDatabase`, `sessionService`, and `whatsappStore`.

- [ ] **Step 6: Add defensive IPC/preload parser tests before implementation, verify RED, then implement**

The renderer receives only the typed safe context fields above. No raw database rows or causes.

- [ ] **Step 7: Run transport GREEN**

```bash
npm test -- packages/application/src/whatsappOrderContext.test.ts apps/operations/src/app/sessionClient.whatsapp.test.ts apps/operations-desktop/src/main/whatsappIpc.test.ts apps/operations-desktop/src/preload/whatsappResult.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit Task 8C**

```bash
git add packages/application/src/whatsappOrderContext.ts packages/application/src/whatsappOrderContext.test.ts packages/application/src/index.ts packages/platform-contracts/index.d.ts apps/operations/src/app/sessionClient.ts apps/operations-desktop/src/main/index.ts apps/operations-desktop/src/main/whatsappIpc.ts apps/operations-desktop/src/preload/whatsappResult.ts apps/operations-desktop/src/preload/index.ts
git commit -m "feat: resolve WhatsApp order context locally"
```

## Task 8D: Server-authoritative messaging window, starter templates, Store config, Send Menu, and Order→WhatsApp target resolution

**Files:**
- Create: `supabase/migrations/20260904010000_whatsapp_messaging_policy.sql`
- Create: `scripts/test-whatsapp-messaging-policy-migration.mjs`
- Modify: `server/whatsappOperationsRepository.ts`
- Modify: `server/whatsappOperationsRepository.test.ts`
- Modify: `server/whatsappOperationsGateway.ts`
- Modify: `server/whatsappOperationsGateway.test.ts`
- Modify: `server/whatsappProviderGateway.ts`
- Modify: `server/whatsappProviderGateway.test.ts`
- Modify: `packages/domain/src/whatsapp.ts`
- Modify: `packages/application/src/whatsappRemote.ts`
- Modify: `packages/application/src/whatsappWire.ts`
- Create/modify corresponding application tests.
- Modify browser/Desktop remotes and their tests.

**Database model:**

`public.whatsapp_shop_messaging_config`
- `shop_id uuid primary key references public.shops(id) on delete cascade`
- `storefront_url text not null` restricted to HTTPS URL shape in RPC validation
- `store_latitude double precision`
- `store_longitude double precision`
- `store_location_label text`
- `store_location_address text`
- `updated_at timestamptz not null default now()`
- latitude/longitude must be both null or both present and in `[-90,90]` / `[-180,180]`

`public.whatsapp_starter_templates`
- `id uuid primary key default gen_random_uuid()`
- `shop_id uuid not null`
- `channel_id uuid not null references public.whatsapp_channels(id) on delete cascade`
- `display_label text not null`
- `provider_template_name text not null`
- `language_code text not null`
- `preview_text text not null`
- `provider_status text not null check (provider_status = 'APPROVED')`
- `active boolean not null default true`
- timestamps
- one unique active logical template per channel/name/language

Both tables: RLS enabled, all direct public/anon/authenticated privileges revoked, service-role-only RPC access.

Add service-role-only RPCs:

```sql
get_tux_whatsapp_messaging_policy_v1(p_shop_id uuid, p_conversation_id uuid)
get_tux_whatsapp_contact_target_v1(p_shop_id uuid, p_normalized_phone text)
claim_tux_whatsapp_template_intent_v1(
  p_shop_id uuid,
  p_business_day_id uuid,
  p_claimed_worker_id uuid,
  p_device_id uuid,
  p_normalized_phone text,
  p_display_phone text,
  p_outbound_intent_key text,
  p_template_id uuid,
  p_initiated_at timestamptz
)
```

Policy returns `lastInboundAt`, `freeFormUntil = lastInboundAt + interval '24 hours'`, active approved templates, and shop messaging config. Contact target finds an existing conversation by normalized phone if present; it never creates a conversation just for viewing. Template claim may upsert the conversation because an explicit approved template send is an authorized outbound start.

**Safe domain/application shapes:**

```ts
export interface WhatsAppStarterTemplate {
  readonly id: string;
  readonly label: string;
  readonly languageCode: string;
  readonly previewText: string;
}

export interface WhatsAppShopMessagingConfig {
  readonly storefrontUrl: string;
  readonly storeLocation: null | {
    readonly latitude: number;
    readonly longitude: number;
    readonly label: string | null;
    readonly address: string | null;
  };
}

export type WhatsAppMessagingTarget =
  | {
      readonly mode: 'FREE_FORM';
      readonly conversationId: string;
      readonly freeFormUntil: Instant;
      readonly config: WhatsAppShopMessagingConfig;
    }
  | {
      readonly mode: 'TEMPLATE_ONLY';
      readonly conversationId: string | null;
      readonly normalizedPhone: string;
      readonly displayPhone: string;
      readonly templates: readonly WhatsAppStarterTemplate[];
      readonly config: WhatsAppShopMessagingConfig;
    }
  | {
      readonly mode: 'BLOCKED';
      readonly conversationId: string | null;
      readonly reason: 'NO_APPROVED_TEMPLATE';
      readonly config: WhatsAppShopMessagingConfig;
    };
```

Extend remote gateway with:

```ts
resolveMessagingTarget(input: {
  readonly normalizedPhone: string;
  readonly displayPhone: string;
}): Promise<WhatsAppMessagingTarget>;

sendTemplate(input: {
  readonly businessDayId: BusinessDayId;
  readonly workerId: WorkerId;
  readonly normalizedPhone: string;
  readonly displayPhone: string;
  readonly templateId: string;
  readonly outboundIntentKey: string;
}): Promise<WhatsAppMessage>;
```

Add remote error `FREE_FORM_WINDOW_CLOSED`. `sendText` must enforce the same server policy before provider send; a stale UI cannot bypass the service window.

- [ ] **Step 1: Write migration RED smoke first**

Create the test script asserting tables, RLS/revokes, service-role grants, 24-hour policy computation, tenant fencing, approved-only templates, and template claim idempotency. Add it to `test:migrations` only after it is RED.

- [ ] **Step 2: Run migration RED**

```bash
node scripts/test-whatsapp-messaging-policy-migration.mjs
```

Expected: FAIL because the migration is absent.

- [ ] **Step 3: Implement the migration and rerun GREEN**

```bash
node scripts/test-whatsapp-messaging-policy-migration.mjs
```

Expected: PASS.

- [ ] **Step 4: Write repository/gateway RED tests**

Cover FREE_FORM within 24h; exactly-expired boundary becomes TEMPLATE_ONLY; approved templates only; no-template BLOCKED; cross-shop conversation rejected; Send Text outside window fails before Meta; template send creates/uses the correct conversation and is idempotent.

- [ ] **Step 5: Run server RED**

```bash
npm test -- server/whatsappOperationsRepository.test.ts server/whatsappOperationsGateway.test.ts server/whatsappProviderGateway.test.ts
```

Expected: FAIL on missing policy/template interfaces/actions.

- [ ] **Step 6: Implement repository and provider template support**

Meta template payload is server-built from the stored provider template name/language. Renderer sends only the TUX template id. Static starter templates in this scope have no runtime parameters.

- [ ] **Step 7: Add gateway actions and enforce free-form policy on text**

Use exact actions `RESOLVE_TARGET` and `SEND_TEMPLATE`; preserve existing `SEND_MESSAGE` for text but add policy enforcement before claim/provider contact. Client cannot send `shopId`, recipient `to`, channel id, provider template name, or provider phone id.

- [ ] **Step 8: Extend wire/browser/Desktop remote contracts with RED→GREEN tests**

`throwWhatsAppHttpError` maps the server closed-window response to `FREE_FORM_WINDOW_CLOSED`; signed/secret/provider fields are rejected by parsers rather than forwarded.

- [ ] **Step 9: Run Task 8D GREEN**

```bash
npm test -- packages/application/src/whatsappRemote.test.ts packages/application/src/whatsappWire.test.ts apps/operations/src/app/browserWhatsAppRemote.test.ts apps/operations-desktop/src/main/desktopWhatsAppRemote.test.ts server/whatsappOperationsRepository.test.ts server/whatsappOperationsGateway.test.ts server/whatsappProviderGateway.test.ts
node scripts/test-whatsapp-messaging-policy-migration.mjs
```

Expected: PASS.

- [ ] **Step 10: Commit Task 8D**

```bash
git add supabase/migrations/20260904010000_whatsapp_messaging_policy.sql scripts/test-whatsapp-messaging-policy-migration.mjs package.json packages/domain/src/whatsapp.ts packages/application/src/whatsappRemote.ts packages/application/src/whatsappWire.ts packages/application/src/whatsappRemote.test.ts packages/application/src/whatsappWire.test.ts server/whatsappOperationsRepository.ts server/whatsappOperationsRepository.test.ts server/whatsappOperationsGateway.ts server/whatsappOperationsGateway.test.ts server/whatsappProviderGateway.ts server/whatsappProviderGateway.test.ts apps/operations/src/app/browserWhatsAppRemote.ts apps/operations/src/app/browserWhatsAppRemote.test.ts apps/operations-desktop/src/main/desktopWhatsAppRemote.ts apps/operations-desktop/src/main/desktopWhatsAppRemote.test.ts
git commit -m "feat: enforce WhatsApp messaging policy"
```

## Task 8E: Task 8 UI — context cards, Send Menu, templates, parked Orders, and bidirectional navigation

**Files:**
- Create: `apps/operations/src/app/whatsappOrderContext.ts`
- Create: `apps/operations/src/app/whatsappOrderContext.test.ts`
- Modify: `apps/operations/src/app/whatsappInboxController.ts`
- Modify: `apps/operations/src/app/whatsappInboxController.test.ts`
- Modify: `apps/operations/src/app/WhatsAppWorkspace.tsx`
- Modify: `apps/operations/src/app/WhatsAppWorkspace.test.tsx`
- Modify: `apps/operations/src/app/OrdersWorkspace.tsx`
- Modify: `apps/operations/src/app/OrdersWorkspace.test.ts`
- Modify: `apps/operations/src/app/OrdersBoardWorkspace.tsx`
- Modify/add Board component tests.
- Modify: `apps/operations/src/app/App.tsx`
- Modify: `apps/operations/src/app/App.whatsapp.test.tsx`
- Modify styles.

**Typed app navigation:**

```ts
export interface OrdersPrefillIntent {
  readonly source: 'WHATSAPP_CHAT';
  readonly conversationId: string;
  readonly prefill: OrdersCustomerPrefill;
}

export interface WhatsAppOpenIntent {
  readonly source: 'ORDER';
  readonly orderId: OrderId;
  readonly normalizedPhone: string;
  readonly displayPhone: string;
}
```

App owns pending intent state. JSX modules emit intents; they do not call each other or external WhatsApp.

Controller additions:

```ts
readonly customerOrderContext: WhatsAppCustomerOrderContext | null;
readonly messagingTarget: WhatsAppMessagingTarget | null;
readonly contextBusy: boolean;

insertMenuReply(): void;
linkSelectedOrder(orderId: OrderId, linked: boolean): Promise<void>;
sendSelectedTemplate(templateId: string): Promise<void>;
```

`insertMenuReply` uses the server-returned canonical `storefrontUrl` and inserts deterministic text:

```text
منيو TUX 👇
<canonical storefront URL>
```

It uses the same composer insertion semantics as quick replies and never calls send.

- [ ] **Step 1: Write RED pure helper/controller tests**

Cover zero/one/many order presentation, human order number display, link/unlink explicit action, deterministic Send Menu text, template-only state, blocked state, context selection stale-result fencing, and no auto-send.

- [ ] **Step 2: Run RED**

```bash
npm test -- apps/operations/src/app/whatsappOrderContext.test.ts apps/operations/src/app/whatsappInboxController.test.ts
```

Expected: FAIL on missing context/navigation helpers.

- [ ] **Step 3: Implement pure helpers and controller state with generation fencing**

When conversation selection changes, context/target async completion from conversation A must not overwrite conversation B. Preserve Task 7 draft/send fencing.

- [ ] **Step 4: Run helper/controller GREEN**

Run the same command. Expected: PASS.

- [ ] **Step 5: Write RED workspace/App/Orders/Board tests**

Required UI assertions:
- one active order shows `View Order` and explicit Link/Unlink;
- multiple active orders render all candidates and never auto-select;
- `Create Order from Chat` emits customer-only prefill;
- non-empty Orders draft shows `Keep current order` / `Start new order for …`;
- parked draft list survives reload fixture and Restore/Discard are explicit;
- `WhatsApp Customer` on an eligible delivery order stays inside App navigation;
- FREE_FORM opens internal conversation;
- TEMPLATE_ONLY renders server-approved templates;
- BLOCKED explains that no approved template is available;
- Send Menu changes composer only.

- [ ] **Step 6: Run component RED**

```bash
npm test -- apps/operations/src/app/WhatsAppWorkspace.test.tsx apps/operations/src/app/App.whatsapp.test.tsx apps/operations/src/app/OrdersWorkspace.test.ts apps/operations/src/app/OrdersBoardWorkspace.test.ts
```

Expected: FAIL on missing Task 8 UI.

- [ ] **Step 7: Implement thin UI and app-owned navigation intents**

Keep `requestProtectedTransition` for every area transition. `View Order` navigates to Orders Board with a typed focus id; `Create Order from Chat` navigates to Orders with typed prefill. Do not route raw UUIDs as human-facing order numbers.

- [ ] **Step 8: Run Task 8 final focused GREEN**

```bash
npm test -- packages/domain/src/orderDraft.test.ts packages/domain/src/parkedOrderDraft.test.ts packages/application/src/orders.test.ts packages/application/src/endDay.test.ts packages/application/src/whatsappOrderContext.test.ts packages/application/src/whatsapp.test.ts packages/application/src/whatsappRemote.test.ts packages/application/src/whatsappWire.test.ts apps/operations/src/app/whatsappOrderContext.test.ts apps/operations/src/app/whatsappInboxController.test.ts apps/operations/src/app/WhatsAppWorkspace.test.tsx apps/operations/src/app/App.whatsapp.test.tsx apps/operations/src/app/OrdersWorkspace.test.ts apps/operations/src/app/OrdersBoardWorkspace.test.ts apps/operations-desktop/src/main/whatsappIpc.test.ts apps/operations-desktop/src/preload/whatsappResult.test.ts server/whatsappOperationsGateway.test.ts server/whatsappOperationsRepository.test.ts server/whatsappProviderGateway.test.ts
npm run typecheck
npm run lint
npm run format:check
```

Expected: all PASS.

- [ ] **Step 9: Commit Task 8E and continue immediately to Task 9 without reviewer STOP**

```bash
git add apps/operations/src/app/whatsappOrderContext.ts apps/operations/src/app/whatsappOrderContext.test.ts apps/operations/src/app/whatsappInboxController.ts apps/operations/src/app/whatsappInboxController.test.ts apps/operations/src/app/WhatsAppWorkspace.tsx apps/operations/src/app/WhatsAppWorkspace.test.tsx apps/operations/src/app/OrdersWorkspace.tsx apps/operations/src/app/OrdersWorkspace.test.ts apps/operations/src/app/OrdersBoardWorkspace.tsx apps/operations/src/app/OrdersBoardWorkspace.test.ts apps/operations/src/app/App.tsx apps/operations/src/app/App.whatsapp.test.tsx apps/operations/src/styles/global.css apps/operations/src/styles/orders.css
git commit -m "feat: connect WhatsApp with Orders safely"
```

---

# TASK 9 — Media, Voice, Location, Offline/Retry, and Windows Notifications

## Task 9A: Private media model, Supabase Storage metadata, and 30-day retention

**Files:**
- Create: `supabase/migrations/20260904011000_whatsapp_media_storage.sql`
- Create: `scripts/test-whatsapp-media-migration.mjs`
- Create: `server/whatsappMediaPolicy.ts`
- Create: `server/whatsappMediaPolicy.test.ts`
- Create: `server/whatsappMediaStorage.ts`
- Create: `server/whatsappMediaStorage.test.ts`
- Modify: `packages/domain/src/whatsapp.ts`
- Modify: `packages/application/src/whatsappWire.ts`
- Modify relevant store/parser tests.

**Canonical media reference:** `WhatsAppMessage.mediaRef` becomes an opaque TUX `mediaKey`, never a Meta media id, Storage path, or signed URL.

**Safe media metadata:**

```ts
export interface WhatsAppMediaDescriptor {
  readonly mediaKey: string;
  readonly kind: 'IMAGE' | 'DOCUMENT' | 'AUDIO';
  readonly mimeType: string;
  readonly fileName: string | null;
  readonly byteSize: number;
  readonly storedAt: Instant;
  readonly expiresAt: Instant;
  readonly availability: 'AVAILABLE' | 'EXPIRED';
}

export type WhatsAppMediaAccess =
  | {
      readonly status: 'AVAILABLE';
      readonly media: WhatsAppMediaDescriptor;
      readonly url: string;
      readonly urlExpiresAt: Instant;
    }
  | {
      readonly status: 'EXPIRED';
      readonly media: WhatsAppMediaDescriptor;
    };
```

Signed URLs are response-only and must never be included in `WhatsAppInboxSnapshot`, `WhatsAppMessage`, or local WhatsApp cache rows.

**Database model:** `public.whatsapp_media_objects`
- `media_key text primary key`
- `shop_id uuid not null`
- `message_id uuid not null`
- `kind text not null check in IMAGE/DOCUMENT/AUDIO`
- `bucket_id text not null`
- `object_path text not null`
- `mime_type text not null`
- `file_name text`
- `byte_size bigint not null check >= 0`
- `sha256 text`
- `provider_media_id text` server-only nullable
- `stored_at timestamptz not null`
- `expires_at timestamptz not null`
- `deleted_at timestamptz`
- same-shop message FK; unique `(shop_id,message_id)` and `(bucket_id,object_path)`

Create private bucket `tux-whatsapp-media`, `public = false`. If plain PostgreSQL migration CI lacks Supabase `storage.buckets`, extend only the test harness with a minimal schema/table fixture before migration execution; do not make production migration silently skip bucket creation.

Retention RPC:

```sql
expire_tux_whatsapp_media_v1(p_now timestamptz, p_limit integer)
```

It service-role selects/marks expired rows in deterministic batches and is idempotent. Actual object deletion is performed by the server storage maintenance routine, followed by `deleted_at`; message rows are never deleted by retention.

**Media policy constants:**

```ts
export const WHATSAPP_MEDIA_LIMITS = {
  IMAGE: 5 * 1024 * 1024,
  AUDIO: 16 * 1024 * 1024,
  DOCUMENT: 100 * 1024 * 1024,
} as const;
```

At implementation time, compare these constants against the current official Meta Cloud API policy. If official limits are stricter, lower the constants and lock the official values in tests; do not exceed the provider. This check is verification, not permission to broaden MIME types.

Allowed v1 MIME families:
- images: `image/jpeg`, `image/png`, `image/webp`
- audio: `audio/aac`, `audio/amr`, `audio/mpeg`, `audio/mp4`, `audio/ogg`
- documents: `application/pdf`, `text/plain`, Microsoft Office Open XML document/spreadsheet/presentation MIME types

Magic-byte/content sniffing must agree with declared category for JPEG/PNG/WebP/PDF; text and OOXML use bounded server validation appropriate to their container/type. Filename is display metadata only.

- [ ] **Step 1: Write media migration RED smoke**

Assert bucket is private, metadata table is RLS/server-only, expiry is exactly 30 days, cleanup is idempotent, binary deletion state does not delete messages, and client roles have no table/RPC privilege.

- [ ] **Step 2: Run RED**

```bash
node scripts/test-whatsapp-media-migration.mjs
```

Expected: FAIL because migration is absent.

- [ ] **Step 3: Implement migration and run GREEN**

```bash
node scripts/test-whatsapp-media-migration.mjs
```

Expected: PASS.

- [ ] **Step 4: Write media policy/storage gateway RED tests**

Cover size boundaries, mismatch rejection, path traversal filename neutrality, private signed-upload creation, short-lived signed-download access, no permanent URL, exact 30-day expiry, delete-expired idempotency.

- [ ] **Step 5: Run RED**

```bash
npm test -- server/whatsappMediaPolicy.test.ts server/whatsappMediaStorage.test.ts
```

Expected: FAIL because modules do not exist.

- [ ] **Step 6: Implement policy and Storage gateway**

Use Supabase Storage REST only server-side with service-role authorization for signing/metadata/maintenance. Deterministic object path is `<shopId>/<mediaKey>`. Never use client filename as path.

- [ ] **Step 7: Run GREEN**

```bash
npm test -- server/whatsappMediaPolicy.test.ts server/whatsappMediaStorage.test.ts
node scripts/test-whatsapp-media-migration.mjs
```

Expected: PASS.

- [ ] **Step 8: Commit Task 9A**

```bash
git add supabase/migrations/20260904011000_whatsapp_media_storage.sql scripts/test-whatsapp-media-migration.mjs server/whatsappMediaPolicy.ts server/whatsappMediaPolicy.test.ts server/whatsappMediaStorage.ts server/whatsappMediaStorage.test.ts packages/domain/src/whatsapp.ts packages/domain/src/index.ts packages/application/src/whatsappWire.ts package.json
git commit -m "feat: add private WhatsApp media retention"
```

## Task 9B: Inbound media ingestion before canonical materialization

**Files:**
- Modify: `server/whatsappProviderGateway.ts`
- Modify: `server/whatsappProviderGateway.test.ts`
- Modify: `server/whatsappWebhook.ts`
- Modify: `server/whatsappWebhook.test.ts`
- Modify: `api/whatsapp-webhook.ts`
- Modify: `server/whatsappOperationsRepository.ts` only if the v2 materialization adapter belongs there.
- Modify: `supabase/migrations/20260904011000_whatsapp_media_storage.sql` before Task 9A commit only; after Task 9A commit, create a new follow-up migration rather than rewriting the committed migration. Because Task 9A commits first, any schema correction discovered here must be a new migration such as `20260904011500_whatsapp_media_materialization.sql`.

**Inbound flow:**

```text
verified Meta webhook
  → resolve channel/shop
  → translate provider event
  → for IMAGE/DOCUMENT/AUDIO: fetch Meta media metadata + bytes server-side
  → validate kind/MIME/size/content
  → store private object using deterministic mediaKey
  → materialize inbound message + media metadata transactionally
  → inbox exposes opaque mediaKey only
```

Use `mediaKey = sha256("inbound:" + shopId + ":" + providerMessageId)` as lowercase hex. The provider media id is retained only in server-side media metadata, never returned in inbox responses.

- [ ] **Step 1: Write RED provider/webhook tests**

Cover image/document/audio happy path, duplicate webhook idempotency, provider download unavailable → webhook 503 so Meta can retry, unsafe MIME/oversize → safe diagnostic/no client exposure, location remains structured and does not create binary media, and text remains unchanged.

- [ ] **Step 2: Run RED**

```bash
npm test -- server/whatsappProviderGateway.test.ts server/whatsappWebhook.test.ts
```

Expected: FAIL because provider media download/private ingestion is absent.

- [ ] **Step 3: Extend provider gateway with server-only inbound media fetch**

Expose methods that first resolve Meta media metadata and then download with bearer auth. Do not return the provider download URL beyond the server module.

- [ ] **Step 4: Add the v2 materialization path**

The materializer writes the message and its `whatsapp_media_objects` metadata in one database transaction/RPC after binary storage succeeds. Duplicate `provider_message_id` returns the original canonical message/media relationship without incrementing unread count again.

- [ ] **Step 5: Run GREEN**

```bash
npm test -- server/whatsappProviderGateway.test.ts server/whatsappWebhook.test.ts
```

Expected: PASS.

- [ ] **Step 6: Verify no provider media URL/id is emitted through application wire fixtures**

```bash
npm test -- packages/application/src/whatsappWire.test.ts server/whatsappOperationsRepository.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit Task 9B**

```bash
git add server/whatsappProviderGateway.ts server/whatsappProviderGateway.test.ts server/whatsappWebhook.ts server/whatsappWebhook.test.ts api/whatsapp-webhook.ts server/whatsappOperationsRepository.ts supabase/migrations

git commit -m "feat: ingest WhatsApp media privately"
```

## Task 9C: Outbound signed-upload flow, media/location send, explicit retry, and media access

**Files:**
- Create: `packages/application/src/whatsappMessaging.ts`
- Create: `packages/application/src/whatsappMessaging.test.ts`
- Modify: `packages/application/src/whatsappRemote.ts`
- Modify: `packages/application/src/whatsappWire.ts`
- Modify: `packages/application/src/index.ts`
- Modify: `server/whatsappOperationsGateway.ts`
- Modify: `server/whatsappOperationsRepository.ts`
- Modify: `server/whatsappProviderGateway.ts`
- Modify browser/Desktop remotes + tests.
- Modify platform contracts, IPC, preload parser/exposure + tests.

**Application API:**

```ts
export type WhatsAppOutboundBinaryKind = 'IMAGE' | 'DOCUMENT' | 'AUDIO';

export interface WhatsAppOutboundBinary {
  readonly kind: WhatsAppOutboundBinaryKind;
  readonly bytes: Uint8Array;
  readonly mimeType: string;
  readonly fileName: string | null;
}

export interface WhatsAppLocationPayload {
  readonly latitude: number;
  readonly longitude: number;
  readonly name: string | null;
  readonly address: string | null;
}

export class OperationsWhatsAppMessagingService {
  sendMedia(input: {
    readonly conversationId: string;
    readonly outboundIntentKey: string;
    readonly media: WhatsAppOutboundBinary;
  }): Promise<Result<WhatsAppMessage, ApplicationError>>;

  sendLocation(input: {
    readonly conversationId: string;
    readonly outboundIntentKey: string;
    readonly location: WhatsAppLocationPayload;
  }): Promise<Result<WhatsAppMessage, ApplicationError>>;

  sendTemplate(input: {
    readonly normalizedPhone: string;
    readonly displayPhone: string;
    readonly templateId: string;
    readonly outboundIntentKey: string;
  }): Promise<Result<WhatsAppMessage, ApplicationError>>;

  retryFailedMessage(input: {
    readonly messageId: string;
    readonly outboundIntentKey: string;
  }): Promise<Result<WhatsAppMessage, ApplicationError>>;

  getMediaAccess(messageId: string): Promise<Result<WhatsAppMediaAccess, ApplicationError>>;

  resolveMessagingTarget(input: {
    readonly normalizedPhone: string;
    readonly displayPhone: string;
  }): Promise<Result<WhatsAppMessagingTarget, ApplicationError>>;
}
```

Like `sendText`, all send methods resolve ACTIVE businessDay/worker claims at call time. The renderer never supplies worker/shop/device authority.

**Remote signed-upload protocol for binary sends:**

1. `CREATE_MEDIA_UPLOAD` JSON: worker claims + conversation + outbound intent + safe declared metadata. Server resolves device/shop/worker/window and returns an upload-only URL scoped to deterministic `mediaKey = sha256("outbound:" + shopId + ":" + outboundIntentKey)` with a short expiry.
2. Browser/Desktop remote uploads bytes to that signed URL only after explicit user Send.
3. `FINALIZE_MEDIA_SEND` JSON: server validates uploaded object, claims durable message intent, builds a short-lived private media link/provider media payload, calls Meta, attaches provider id, and returns canonical message.

The API response may contain an upload-only signed URL only during the remote method call. The application service/UI state/store must not persist it.

**Location send:** `SEND_LOCATION` JSON contains only conversation id, worker claims, outbound intent key, and finite lat/lon + bounded optional name/address. Server checks free-form window before claim/provider send.

**Retry:** `RETRY_FAILED` accepts failed `messageId`, new `outboundIntentKey`, business day + worker claims. Server loads the original message/media object in the resolved shop, requires status `FAILED`, reconstructs safe content, and creates a new attempt linked through media metadata `retryOfMessageId`. `PENDING` returns conflict and is never retried.

- [ ] **Step 1: Write application/remote RED tests**

Cover call-time worker claims, stable local error mapping, no send offline fallback, no signed URL persistence, media upload only after `sendMedia`, location validation, template send, FAILED retry, and PENDING retry refusal.

- [ ] **Step 2: Run RED**

```bash
npm test -- packages/application/src/whatsappMessaging.test.ts packages/application/src/whatsappRemote.test.ts
```

Expected: FAIL because the messaging capability is absent.

- [ ] **Step 3: Implement application capability and typed remote contract**

Keep existing `OperationsWhatsAppService` text/draft/cache methods intact. Compose the new messaging service into `TuxWhatsAppApi` rather than moving unrelated draft/cache logic.

- [ ] **Step 4: Write server RED tests for signed-upload/finalize/location/retry/media access**

Cover invalid MIME/size before sign, cross-shop message/media access denied, expired/deleted media returns `EXPIRED`, short-lived access URL only, free-form closed rejects media/location, provider definitive rejection marks FAILED, transport uncertainty stays PENDING/uncertain, repeat finalize/intent does not duplicate provider sends.

- [ ] **Step 5: Run server RED**

```bash
npm test -- server/whatsappOperationsGateway.test.ts server/whatsappOperationsRepository.test.ts server/whatsappProviderGateway.test.ts server/whatsappMediaStorage.test.ts
```

Expected: FAIL on missing actions.

- [ ] **Step 6: Implement server actions and provider payloads**

Provider supports `image`, `document`, and `audio` via TUX-generated short-lived private link or provider media id as appropriate; it supports structured `location`; it supports `template`. Provider credentials remain inside `server/whatsappProviderGateway.ts`.

- [ ] **Step 7: Write browser/Desktop remote RED tests for the three-phase binary flow**

Assert Browser uses same-origin create/finalize actions; Desktop uses configured HTTPS TUX API origin with bearer/device headers; signed upload target is the only extra origin contacted and carries no device bearer/Meta credentials; partial desktop auth headers never cookie-downgrade.

- [ ] **Step 8: Implement browser/Desktop remote, IPC, preload, platform-contract extensions**

Preload validates `Uint8Array`, MIME/fileName bounds, coordinates, UUID/message ids, and result shapes. Do not accept file paths from renderer.

- [ ] **Step 9: Run Task 9C GREEN**

```bash
npm test -- packages/application/src/whatsappMessaging.test.ts packages/application/src/whatsappRemote.test.ts packages/application/src/whatsappWire.test.ts apps/operations/src/app/browserWhatsAppRemote.test.ts apps/operations-desktop/src/main/desktopWhatsAppRemote.test.ts apps/operations-desktop/src/main/whatsappIpc.test.ts apps/operations-desktop/src/preload/whatsappResult.test.ts apps/operations-desktop/src/preload/index.test.ts server/whatsappOperationsGateway.test.ts server/whatsappOperationsRepository.test.ts server/whatsappProviderGateway.test.ts server/whatsappMediaStorage.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 10: Commit Task 9C**

```bash
git add packages/application/src/whatsappMessaging.ts packages/application/src/whatsappMessaging.test.ts packages/application/src/whatsappRemote.ts packages/application/src/whatsappWire.ts packages/application/src/index.ts packages/platform-contracts/index.d.ts server/whatsappOperationsGateway.ts server/whatsappOperationsRepository.ts server/whatsappProviderGateway.ts apps/operations/src/app/browserWhatsAppRemote.ts apps/operations/src/app/browserWhatsAppRemote.test.ts apps/operations/src/app/sessionClient.ts apps/operations-desktop/src/main/desktopWhatsAppRemote.ts apps/operations-desktop/src/main/desktopWhatsAppRemote.test.ts apps/operations-desktop/src/main/whatsappIpc.ts apps/operations-desktop/src/main/whatsappIpc.test.ts apps/operations-desktop/src/preload/whatsappResult.ts apps/operations-desktop/src/preload/whatsappResult.test.ts apps/operations-desktop/src/preload/index.ts apps/operations-desktop/src/preload/index.test.ts apps/operations-desktop/src/main/index.ts
git commit -m "feat: send WhatsApp media and location safely"
```

## Task 9D: Media UI, voice recording, Store/current location, and explicit retry

**Files:**
- Create: `apps/operations/src/app/whatsappMediaComposer.ts`
- Create: `apps/operations/src/app/whatsappMediaComposer.test.ts`
- Modify: `apps/operations/src/app/whatsappInboxController.ts`
- Modify: `apps/operations/src/app/whatsappInboxController.test.ts`
- Modify: `apps/operations/src/app/WhatsAppWorkspace.tsx`
- Modify: `apps/operations/src/app/WhatsAppWorkspace.test.tsx`
- Modify styles.
- Modify Electron security permission handling only if microphone/geolocation needs an explicit handler; update `security.ts` + tests.

**Transient composer state:**

```ts
export type WhatsAppMediaComposerState =
  | { readonly kind: 'IDLE' }
  | {
      readonly kind: 'FILE_READY';
      readonly mediaKind: 'IMAGE' | 'DOCUMENT' | 'AUDIO';
      readonly fileName: string;
      readonly mimeType: string;
      readonly bytes: Uint8Array;
      readonly previewUrl: string | null;
    }
  | { readonly kind: 'RECORDING'; readonly startedAtMs: number }
  | {
      readonly kind: 'AUDIO_READY';
      readonly mimeType: string;
      readonly bytes: Uint8Array;
      readonly previewUrl: string;
    }
  | { readonly kind: 'ERROR'; readonly message: string };
```

No state above is persisted across restart. Always revoke object URLs on replace/cancel/unmount.

**Voice path:** `navigator.mediaDevices.getUserMedia({ audio: true })` → `MediaRecorder` → Stop → bytes/preview → explicit Send/Cancel. Pause/Resume is optional and must not become an acceptance dependency.

**Location path:**
- `Send Store Location`: uses `messagingTarget.config.storeLocation`; disabled with clear text if not configured.
- `Share Current Location`: calls a small injected geolocation adapter around `navigator.geolocation.getCurrentPosition`; denied/unavailable is non-fatal and does not modify Store Location.

**Message rendering:**
- IMAGE: obtain `getMediaAccess(message.id)`, then render signed access only while current; expired → `Media expired`.
- DOCUMENT: safe filename + explicit Open/Download action from short-lived access.
- AUDIO: native audio controls against short-lived access/object URL.
- LOCATION: structured coordinates + safe label/address; do not fetch provider map images.
- payment screenshots are never annotated as paid/confirmed.

- [ ] **Step 1: Write media-composer RED tests**

Cover file kind mapping, unsafe/unsupported rejection before send, voice permission denied, stop→preview, cancel cleanup, object URL revocation, geolocation success/denial, Store Location availability, no persistence.

- [ ] **Step 2: Run RED**

```bash
npm test -- apps/operations/src/app/whatsappMediaComposer.test.ts
```

Expected: FAIL because module does not exist.

- [ ] **Step 3: Implement the transient media state machine**

Use injected environment methods in tests for FileReader/MediaRecorder/object URLs/geolocation. Do not embed provider/storage knowledge.

- [ ] **Step 4: Write controller/workspace RED tests**

Cover explicit attachment Send, voice Preview→Send/Cancel, Store Location/current location, expired media, FAILED Retry button, no Retry for PENDING, offline sends disabled but POS/inbox cache usable, and stale selection/send completion fencing.

- [ ] **Step 5: Run RED**

```bash
npm test -- apps/operations/src/app/whatsappInboxController.test.ts apps/operations/src/app/WhatsAppWorkspace.test.tsx
```

Expected: FAIL on missing Task 9 media UI.

- [ ] **Step 6: Implement controller/workspace integration**

Keep attachment bytes in the media composer/controller only. After successful send, clear the exact matching attachment/recording attempt; if the worker changes selection or replaces the attachment while async send runs, stale completion must not clear the newer UI state.

- [ ] **Step 7: Add Electron permission RED tests before changing security**

If production Electron needs explicit permission handling, test that only the trusted TUX origin/context can request audio capture/geolocation and unrelated permissions remain denied. `webviewTag:false`, context isolation, sandbox, navigation guards, and web security remain unchanged.

- [ ] **Step 8: Run Task 9D GREEN**

```bash
npm test -- apps/operations/src/app/whatsappMediaComposer.test.ts apps/operations/src/app/whatsappInboxController.test.ts apps/operations/src/app/WhatsAppWorkspace.test.tsx apps/operations-desktop/src/main/security.test.ts
npm run typecheck
npm run lint
npm run format:check
```

Expected: PASS.

- [ ] **Step 9: Commit Task 9D**

```bash
git add apps/operations/src/app/whatsappMediaComposer.ts apps/operations/src/app/whatsappMediaComposer.test.ts apps/operations/src/app/whatsappInboxController.ts apps/operations/src/app/whatsappInboxController.test.ts apps/operations/src/app/WhatsAppWorkspace.tsx apps/operations/src/app/WhatsAppWorkspace.test.tsx apps/operations/src/styles/global.css apps/operations-desktop/src/main/security.ts apps/operations-desktop/src/main/security.test.ts
git commit -m "feat: add WhatsApp media composer"
```

## Task 9E: Windows notification privacy, focus suppression, and background feed

**Files:**
- Create: `apps/operations-desktop/src/main/whatsappNotifications.ts`
- Create: `apps/operations-desktop/src/main/whatsappNotifications.test.ts`
- Create: `apps/operations-desktop/src/main/whatsappNotificationFeed.ts`
- Create: `apps/operations-desktop/src/main/whatsappNotificationFeed.test.ts`
- Modify: `apps/operations-desktop/src/main/index.ts`
- Modify server gateway/repository only for the minimal notification-envelope endpoint and tests.

**Server notification envelope:**

```ts
export interface WhatsAppNotificationEnvelope {
  readonly cursor: string | null;
  readonly messages: readonly {
    readonly messageId: string;
    readonly conversationId: string;
    readonly createdAt: string;
    readonly kind: 'TEXT' | 'IMAGE' | 'DOCUMENT' | 'AUDIO' | 'LOCATION';
    readonly preview: string | null;
    readonly customerName: string | null;
  }[];
}
```

The endpoint is device-authorized. The desktop feed must discard customer/preview fields and pass only generic presentation when local session state is not ACTIVE. This endpoint does not grant interactive inbox access or outbound authority.

**Notification policy API:**

```ts
export interface WhatsAppNotificationContext {
  readonly sessionActive: boolean;
  readonly focusedConversationId: string | null;
  readonly windowFocused: boolean;
}

export function notificationPresentation(
  message: WhatsAppNotificationEnvelope['messages'][number],
  context: WhatsAppNotificationContext,
): null | { readonly title: string; readonly body: string };
```

Rules:
- same message id notified once per app runtime;
- focused window + same conversation → suppress;
- ACTIVE/current worker → safe preview allowed;
- not ACTIVE → exact generic title/body with no customer/message metadata;
- OS notification constructor failure is swallowed/logged and never affects POS.

- [ ] **Step 1: Write RED notification policy tests**

Include dedupe, same-conversation focus suppression, active preview, no-worker/day generic-only, and metadata leak assertions.

- [ ] **Step 2: Run RED**

```bash
npm test -- apps/operations-desktop/src/main/whatsappNotifications.test.ts
```

Expected: FAIL because module does not exist.

- [ ] **Step 3: Implement pure notification policy**

Keep Electron `Notification` construction outside the pure function.

- [ ] **Step 4: Write notification-feed RED tests**

Use fake device session + fake server envelope. Prove cursor progression, repeat envelope dedupe, transport failure non-fatal, and non-ACTIVE context never forwards preview/customer to the OS presentation function.

- [ ] **Step 5: Implement feed lifecycle in Electron Main**

Start after device enrollment/session availability; pause/back off only with deterministic bounded cadence already used by the app—do not add rapid retries. One 15-second foreground/background-safe polling cadence is sufficient for v1. Stop cleanly on app shutdown. It must not depend on a current worker to receive a generic envelope.

- [ ] **Step 6: Run GREEN**

```bash
npm test -- apps/operations-desktop/src/main/whatsappNotifications.test.ts apps/operations-desktop/src/main/whatsappNotificationFeed.test.ts apps/operations-desktop/src/main/security.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit Task 9E and continue immediately to Task 10**

```bash
git add apps/operations-desktop/src/main/whatsappNotifications.ts apps/operations-desktop/src/main/whatsappNotifications.test.ts apps/operations-desktop/src/main/whatsappNotificationFeed.ts apps/operations-desktop/src/main/whatsappNotificationFeed.test.ts apps/operations-desktop/src/main/index.ts server/whatsappOperationsGateway.ts server/whatsappOperationsGateway.test.ts server/whatsappOperationsRepository.ts server/whatsappOperationsRepository.test.ts
git commit -m "feat: add private WhatsApp notifications"
```

---

# TASK 10 — Deterministic E2E, Security Gates, CI, and Production Acceptance

## Task 10A: Contract-faithful rendered E2E server and WhatsApp acceptance scenarios

**Files:**
- Create: `e2e/whatsappFakeServer.ts`
- Create: `e2e/whatsapp-inbox.e2e.ts`
- Modify: `playwright.config.ts`
- Modify: `package.json`
- Modify existing E2E helpers only where shared startup/session fixture composition is required.

**Harness rule:** The rendered browser E2E must no longer rely on plain Vite preview to answer `/api/whatsapp`. Build Operations, then start a small test server on `127.0.0.1:4173` that serves the built static assets and implements a deterministic `/api/whatsapp` contract fake. This is the long-term fix for the previously observed Vite `/api/whatsapp` 404. Do not change production client behavior to hide 404s.

The fake must model:
- device/browser session bootstrap fixtures already required by rendered Operations;
- inbox snapshot/cursor;
- policy FREE_FORM/TEMPLATE_ONLY/BLOCKED;
- send intent idempotency;
- signed media upload fake endpoint;
- finalize media send;
- media AVAILABLE/EXPIRED access;
- notification envelope if E2E invokes it;
- deterministic server-side assertion counters so E2E can prove exactly-one sends.

- [ ] **Step 1: Write the first RED E2E for inbound unread → open → explicit text reply exactly once**

Run only the new desktop browser project/spec before changing server startup:

```bash
npx playwright test e2e/whatsapp-inbox.e2e.ts --project=desktop-browser-fallback
```

Expected: FAIL because `/api/whatsapp` is not served by the current Vite preview harness.

- [ ] **Step 2: Implement `whatsappFakeServer.ts` and replace `e2e:serve` with the contract-aware server**

Add a root script such as:

```json
"e2e:serve": "npm run build -w @tux/operations && node --import tsx e2e/whatsappFakeServer.ts"
```

Do not add `tsx` unless required; prefer an existing build/transpile path or a small `.mjs` server if that avoids a new dependency. If a new dev dependency is required, lock it in `package-lock.json` and report its audit effect.

- [ ] **Step 3: Run first E2E GREEN**

Same command. Expected: PASS with no `/api/whatsapp` 404.

- [ ] **Step 4: Expand E2E with the binding Task 10 matrix**

Add deterministic scenarios for:
1. current worker attribution;
2. known customer with one active order;
3. multiple active orders require explicit selection;
4. Create Order from Chat starts empty lines;
5. non-empty draft park/start and parked restore persistence;
6. End Day blocked by parked draft;
7. Order→WhatsApp FREE_FORM;
8. TEMPLATE_ONLY starter-template send;
9. no-template BLOCKED;
10. Send Menu inserts canonical URL, no auto-send;
11. image/document/audio/location send/receive;
12. voice permission denial non-fatal;
13. current-location denial with Store Location still available;
14. FAILED explicit retry;
15. PENDING/uncertain has no blind retry;
16. offline cached WhatsApp with POS still usable;
17. reconnect no duplicate send;
18. media expired state;
19. notification privacy behavior at pure/integration level if OS UI itself is not Playwright-addressable.

- [ ] **Step 5: Run complete WhatsApp E2E**

```bash
npx playwright test e2e/whatsapp-inbox.e2e.ts
```

Expected: PASS in every project where the spec is applicable. If media microphone APIs are desktop-browser-only in the deterministic fixture, use Playwright project annotations rather than production behavior hacks.

- [ ] **Step 6: Run the entire existing rendered E2E suite**

```bash
npm run test:e2e
```

Expected: PASS, including existing Operations flows and no generic `/api/whatsapp` 404 console failure.

- [ ] **Step 7: Commit Task 10A**

```bash
git add e2e/whatsappFakeServer.ts e2e/whatsapp-inbox.e2e.ts playwright.config.ts package.json package-lock.json
git commit -m "test: cover rendered WhatsApp inbox"
```

## Task 10B: Permanent WhatsApp security/migration/architecture gates and CI

**Files:**
- Create: `scripts/test-whatsapp-security.mjs`
- Modify: `scripts/test-whatsapp-package-layering.mjs` only if new focused application modules need allowed dependency rules.
- Modify: `package.json`
- Modify: `.github/workflows/ci.yml`
- Create: `docs/WHATSAPP_PRODUCTION_ACCEPTANCE.md`
- Update migration test scripts created in Tasks 8D/9A.

**Security script required checks:**

Fail if renderer/browser/Desktop WhatsApp runtime source contains any of:
- `TUX_WHATSAPP_ACCESS_TOKEN`
- `TUX_WHATSAPP_APP_SECRET`
- `TUX_SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `graph.facebook.com`
- `web.whatsapp.com`
- `wa.me/`

Also assert:
- `createSecureWebPreferences()` still yields `webviewTag:false`, `contextIsolation:true`, sandbox/web security expectations already covered by hardening tests;
- no renderer/browser remote request body sends `shopId`, `deviceId`, `sentByWorkerId`, `providerPhoneNumberId`, or recipient `to`;
- no source treats a public Storage URL/bucket as canonical WhatsApp media;
- provider media id/download URL stays server-only;
- persistence layer does not import application (`whatsapp` architecture guard remains);
- no `sendMedia` path bypasses `/api/whatsapp` authority to Meta.

Add root scripts:

```json
"test:whatsapp-security": "node scripts/test-whatsapp-security.mjs",
"test:migrations": "<existing chain> && node scripts/test-whatsapp-messaging-policy-migration.mjs && node scripts/test-whatsapp-media-migration.mjs"
```

CI `quality` gets explicit steps after unit tests and before build:

```yaml
- name: WhatsApp architecture gate
  run: npm run test:whatsapp-architecture
- name: WhatsApp security gate
  run: npm run test:whatsapp-security
```

Do not remove or weaken any existing quality, edge-security, rendered E2E, migration, or Windows package step.

**Production acceptance document:** mark status `PENDING REAL META ACCEPTANCE` by default and include all 22 manual checks from the binding spec. Never include real phone numbers, PINs, tokens, app secrets, service-role keys, or template secrets in the document.

- [ ] **Step 1: Write `test-whatsapp-security.mjs` to fail against one temporary/fixture violation, then remove the fixture only after RED is observed**

The durable script must scan exact production boundary directories, not tests/docs/node_modules.

- [ ] **Step 2: Run security RED, then GREEN after the production tree satisfies it**

```bash
node scripts/test-whatsapp-security.mjs
npm run test:whatsapp-architecture
```

Expected final: PASS.

- [ ] **Step 3: Run migration chain with both new scripts**

```bash
npm run test:migrations
```

Expected: PASS and old migration checks unchanged.

- [ ] **Step 4: Add CI steps and acceptance doc**

Use the exact new scripts. Keep `windows-package` and `required-quality-gate` dependencies unchanged.

- [ ] **Step 5: Run YAML/format/script-focused verification**

```bash
npm run format:check
npm run test:whatsapp-security
npm run test:whatsapp-architecture
npm run test:migrations
```

Expected: PASS.

- [ ] **Step 6: Commit Task 10B**

```bash
git add scripts/test-whatsapp-security.mjs scripts/test-whatsapp-package-layering.mjs scripts/test-whatsapp-messaging-policy-migration.mjs scripts/test-whatsapp-media-migration.mjs package.json .github/workflows/ci.yml docs/WHATSAPP_PRODUCTION_ACCEPTANCE.md
git commit -m "test: gate WhatsApp production boundaries"
```

## Task 10C: Final whole-repository verification, CI evidence, and single return

**No production mutation is authorized by this task.** Do not deploy migrations, create Storage buckets remotely, configure Meta templates, or alter Vercel/Supabase production settings. The real-provider checklist remains pending unless the user separately authorized and supplied the external environment.

- [ ] **Step 1: Verify permanent source scope from the baseline**

```bash
git status --short
git log --oneline --decorate 0684c49f3988545ea68efdfa1d0a1ce4de9e0cdc..HEAD
git diff --name-status 0684c49f3988545ea68efdfa1d0a1ce4de9e0cdc..HEAD
```

Expected: clean tree; only Tasks 8–10 files; no TUX-MENU Web Order Bridge files; no unrelated dependency/config churn.

- [ ] **Step 2: Run the complete focused WhatsApp/Orders/End Day/Desktop test set**

Run every focused test introduced/changed by Tasks 8–10 plus the Task 6/7 regression suites. Record exact files/tests passed from Vitest output.

- [ ] **Step 3: Run full repository gates fresh**

```bash
npm run format:check
npm run lint
npm run typecheck
npm test
npm run test:whatsapp-architecture
npm run test:whatsapp-security
npm run test:migrations
npm run test:e2e
npm run build
```

Expected: all PASS.

- [ ] **Step 4: Run Windows/Electron-specific regression/package gate locally when the environment supports it**

At minimum run Electron security/preload/IPC tests on the implementation host. If a Windows host is available:

```bash
npm run package:win -- --publish never
```

If not available, do not fake success; rely on and later cite the GitHub `windows-package` job.

- [ ] **Step 5: Push the exact permanent implementation head and wait for the normal permanent CI workflow**

Do not add a temporary verification workflow if the permanent `.github/workflows/ci.yml` already covers every gate. Record the workflow run ID and each relevant job ID/conclusion: quality, edge-security, windows-package, Required quality gate.

- [ ] **Step 6: Inspect CI logs, not only the green badge**

Record exact test counts where logs provide them and confirm:
- WhatsApp architecture/security steps actually executed;
- both new migration scripts executed;
- rendered WhatsApp E2E ran without `/api/whatsapp` 404;
- Windows package built;
- no hidden skipped permanent gate.

- [ ] **Step 7: Run final clean-tree/hash verification after CI**

```bash
git rev-parse HEAD
git status --short
git diff --check 0684c49f3988545ea68efdfa1d0a1ce4de9e0cdc..HEAD
```

Expected: exact pushed head, empty status, `git diff --check` PASS.

- [ ] **Step 8: Return once with the complete evidence packet**

The final implementer response must contain:
- baseline `0684c49f3988545ea68efdfa1d0a1ce4de9e0cdc`;
- final permanent HEAD SHA;
- every Task 8/9/10 commit SHA and purpose;
- exact baseline→HEAD changed-file list;
- RED command/result for each capability;
- focused GREEN commands/results and exact test counts;
- full repo format/lint/typecheck/test/build results;
- migration + architecture + security gate results;
- rendered E2E result and explicit statement about the former `/api/whatsapp` 404;
- Electron/Windows regression result;
- CI run ID + job IDs + conclusions;
- final `git status --short`;
- explicit production mutation list (expected `none` in this pass);
- `PENDING REAL META ACCEPTANCE` items if real provider acceptance was not performed;
- `npm ci`/audit dependency vulnerability findings exactly as observed, including pre-existing findings.

Do not claim the WhatsApp subsystem `production-ready` or `frozen` until the real Meta acceptance checklist is complete.

---

## Plan Self-Review Checklist for the Implementer

Before starting execution, verify the plan still matches the binding spec at the exact baseline. During execution, do not reinterpret these authorities:

1. Orders business logic stays in Orders/application/local persistence; WhatsApp only transfers typed context/navigation.
2. Parked drafts are Business-Day-scoped and End Day-blocking; no silent carry-forward or auto-delete.
3. Provider messaging-window/template policy is server authority.
4. Send Menu uses canonical server config and never auto-sends.
5. Full image/document/audio/location support is explicit-send only.
6. Voice supports direct recording and file selection.
7. Location supports Store Location and optional Current Location.
8. Supabase Storage is private; binaries expire after 30 days; metadata/history survives.
9. No selected binary or recording is durable before explicit Send.
10. FAILED may be explicitly retried; PENDING/uncertain may not be blindly resent.
11. WhatsApp outage never blocks POS and reconnect never auto-replays.
12. Windows notification without active worker/day is generic only.
13. E2E fixes the API harness rather than production code.
14. Security gates protect tokens, tenant authority, Electron hardening, media privacy, and provider boundary.
15. TUX-MENU Web Order Bridge remains untouched.
16. Real Meta acceptance is a separate external/manual production-readiness gate.

## One-Pass Execution Cadence

The Classic ChatGPT implementation chat must execute **Task 8A → 8B → 8C → 8D → 8E → 9A → 9B → 9C → 9D → 9E → 10A → 10B → 10C** continuously. Each task keeps its own RED/GREEN/commit checkpoint, but there is **no reviewer STOP between tasks**. Return only after Task 10C with the evidence packet above.