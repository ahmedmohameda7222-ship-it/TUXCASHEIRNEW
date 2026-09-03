# TUX Operations WhatsApp Worker Inbox UI — Binding Design

Date: 2026-09-03
Status: Written spec pending final user review
Repository: `ahmedmohameda7222-ship-it/TUXCASHEIRNEW`
Implementation baseline: `2a39d9bfaf8622907646294fba8515854d4c3834`
Scope: Corrected Task 7 only

## 1. Purpose

This specification replaces the stale original Task 7 UI instructions with the long-term worker-facing WhatsApp inbox architecture that fits the completed Task 1–6 runtime.

The implementation adds the first usable WhatsApp worker UI inside TUX Operations without changing the backend authority model, adding a second client authority path, adding media sending, or duplicating order logic.

The worker experience remains inside the existing active Operations shell:

`Orders → Orders Board → WhatsApp → Expenses → Bulk Stock`

Task 7 is a worker inbox UI and presentation/controller task. It is not an order-context implementation, a media transport implementation, a notification implementation, a Meta/provider configuration task, or a production deployment task.

## 2. Existing authority and runtime are binding

Task 7 MUST consume the completed Task 6 runtime exactly as it exists.

The public WhatsApp client is `TuxWhatsAppApi`, exposed through `createOperationsWhatsAppClient()` and selected automatically by the runtime:

- Desktop: `window.tuxDesktop.whatsapp`
- Browser: `OperationsWhatsAppService + IndexedDbWhatsAppStore + VercelBrowserWhatsAppRemote`

The UI MUST NOT bypass this public boundary.

The current nine public methods are authoritative:

1. `loadInbox`
2. `loadConversation`
3. `sendText`
4. `markUnread`
5. `archive`
6. `setFollowUp`
7. `linkOrder`
8. `saveDraft`
9. `getDraft`

`sendMedia` is not part of Task 7 and MUST remain absent.

The UI MUST NOT send or choose:

- `shopId`
- `deviceId`
- `businessDayId`
- `workerId`
- `sentByWorkerId`
- `providerPhoneNumberId`
- Meta/provider credentials

Current Operator resolution and durable worker/device attribution remain inside the completed application/server authority path.

## 3. Architectural shape

Task 7 uses an App-owned inbox controller plus a thin workspace.

```text
ActiveShell
  ├─ one TuxWhatsAppApi
  ├─ one WhatsAppInboxController
  │    ├─ latest inbox snapshot
  │    ├─ refresh lifecycle
  │    ├─ unread aggregate
  │    ├─ active conversation
  │    ├─ filter/search state
  │    └─ send-attempt identity
  ├─ Operations nav unread badge
  └─ WhatsAppWorkspace
       ├─ conversation rail
       └─ active conversation panel
```

The controller is the single UI-state owner for inbox refresh and unread aggregation.

The workspace renders controller state and invokes controller actions. It does not create a second independently-loading inbox data island.

This boundary is required so the nav unread badge stays current even when the worker is in Orders or another Operations area.

## 4. Scope boundaries

### 4.1 Included in Task 7

Task 7 includes:

- `WHATSAPP` as an `OperationsArea`;
- navigation item after Orders Board;
- unread badge in navigation;
- conversation list;
- non-archived default view;
- All / Unread / Follow-up / Archived filters;
- search over currently available inbox data;
- conversation selection;
- message history rendering;
- TEXT rendering;
- safe read-only placeholders for inbound IMAGE / DOCUMENT / AUDIO / LOCATION records;
- outbound delivery/read/failure status presentation;
- `dir="auto"` bidi-safe message text rendering;
- mark unread;
- archive/unarchive;
- follow-up toggle;
- text composer;
- canonical quick replies from inbox snapshot;
- explicit text send;
- stable outbound intent key for one unchanged send attempt;
- transient offline/unavailable status presentation;
- menu-layout protected-navigation preservation;
- deterministic controller refresh policy.

### 4.2 Explicitly excluded from Task 7

Task 7 MUST NOT implement:

- media upload/send;
- attachment button that implies media send support;
- provider-media download/fetch logic;
- Windows notifications;
- customer/order resolution logic;
- human order-number search;
- Create Order from Chat;
- Order → WhatsApp navigation;
- Send Menu;
- website order request Review/Accept;
- payment-proof interpretation;
- automatic chat-to-order parsing;
- automatic failed-message replay;
- background offline send queue;
- realtime/WebSocket/Supabase subscription path;
- Meta/provider configuration;
- TUX Admin saved-reply editing;
- production quick-reply seeding hidden inside React;
- WhatsApp availability while Business Day is CLOSED;
- any database migration.

These remain later tasks or previously defined companion-system responsibilities.

## 5. Navigation and Operations-shell integration

`OperationsArea` becomes:

```text
ORDERS
ORDERS_BOARD
WHATSAPP
EXPENSES
BULK_STOCK
```

Visual order is:

```text
Orders | Orders Board | WhatsApp | Expenses | Bulk Stock
```

Entering WhatsApp from Orders MUST pass through the existing `requestProtectedTransition()` / menu-layout unsaved-change guard.

Task 7 MUST NOT introduce a second navigation transition mechanism.

The WhatsApp workspace exists only in the ACTIVE Operations shell for Task 7.

This spec intentionally does not expand WhatsApp access to `NO_ACTIVE_DAY`, `SIGN_IN_REQUIRED`, or closed-day states. Messaging outside an active worker session remains a separately unresolved product decision.

## 6. Controller responsibilities

Create a UI-level `WhatsAppInboxController` or equivalent focused controller with one clear responsibility: coordinate worker inbox presentation state using `TuxWhatsAppApi`.

The controller owns:

- latest successful `WhatsAppInboxSnapshot`;
- loading/refreshing state;
- remote-unavailable state;
- last safe UI error;
- selected conversation ID;
- active filter;
- search query;
- refresh scheduling/single-flight state;
- stable send-attempt state for the current composer text;
- total unread aggregate derived from snapshot.

The controller MUST NOT own:

- authentication;
- Current Operator identity;
- tenant identity;
- order mutations;
- provider rules;
- Meta credentials;
- backend idempotency decisions.

Those remain in existing lower layers.

## 7. Refresh model

Task 7 uses deterministic polling rather than introducing a new realtime subsystem.

### 7.1 Triggers

The controller refreshes:

1. immediately when the ACTIVE shell initializes;
2. immediately when WhatsApp becomes the selected area;
3. every 15 seconds while the document is visible;
4. when the document becomes visible again;
5. when the browser/window emits `online`.

### 7.2 Polling constraints

- Polling MUST pause while `document.hidden === true`.
- Only one `loadInbox` request may be in flight at a time.
- Multiple simultaneous refresh triggers coalesce into one active request plus, at most, one pending refresh after the current request completes.
- There MUST be no arbitrary retry loop or exponential retry subsystem in Task 7.
- A failed refresh does not clear the last successful snapshot.

### 7.3 Why polling is chosen

The current backend/runtime already provides a secure unified request path. Adding a new realtime transport now would expand security, desktop/runtime, reconnect, and tenancy surface area without being required for the first worker UI.

The controller boundary allows polling to be replaced later with a push/realtime trigger without rewriting the workspace.

## 8. Inbox snapshot and unread aggregation

The latest successful snapshot is the presentation source of truth.

Total nav unread count is:

```text
sum(conversation.unreadCount)
```

across all non-archived conversations unless product semantics later explicitly change.

The nav badge:

- is hidden when total is zero;
- does not display negative values;
- should cap visual text at a compact maximum such as `99+` without changing the underlying count.

A transient refresh failure MUST NOT reset unread to zero.

## 9. Conversation list behavior

### 9.1 Default list

Default filter is `ALL`, meaning non-archived conversations.

### 9.2 Filters

Task 7 supports exactly:

- `ALL`
- `UNREAD`
- `FOLLOW_UP`
- `ARCHIVED`

Definitions:

- ALL: `archived === false`
- UNREAD: `archived === false && unreadCount > 0`
- FOLLOW_UP: `archived === false && followUp === true`
- ARCHIVED: `archived === true`

### 9.3 Sorting

Sort conversations deterministically by:

1. `lastMessageAt DESC`, null last;
2. display/customer label using locale-safe stable comparison;
3. conversation ID as final tie-breaker.

No sort may depend on current array insertion order.

### 9.4 Search

Task 7 search is local over data already present in the loaded snapshot.

Search fields:

- `customerName`
- `displayPhone`
- `normalizedPhone`
- currently loaded message text for that conversation

Search is case-insensitive for Latin text and literal Unicode matching for Arabic/mixed text after normal whitespace normalization.

Task 7 MUST NOT claim search by human order number because the current inbox model only exposes `linkedOrderId`, not a display order number.

Human order-number search belongs to the later order-context task.

## 10. Conversation labels

The UI maps domain context to worker-facing labels:

- `DIRECT` → `Direct WhatsApp`
- `WEB_REQUEST` → `Website Order Request`
- `ORDER_LINKED` → `Existing Order Chat`

If `linkedOrderId` exists, Task 7 may indicate that an order is linked, but MUST NOT render the raw UUID as a human `Order #...` label.

Official order-number display and navigation belong to the later order-context integration.

## 11. Active-conversation selection

When the filtered/search result set changes:

- keep current selection if the conversation still exists in the latest snapshot;
- otherwise select the first visible conversation;
- if no conversation is visible, render an empty conversation panel state.

The controller must not silently archive, mark read, or mutate a conversation merely because it was selected.

Task 7 only exposes the explicit `markUnread` mutation currently available. It does not invent an implicit mark-read mutation that does not exist in the runtime contract.

## 12. Message rendering

### 12.1 Bubble direction

Message bubble alignment is based on message direction:

- INBOUND → customer side
- OUTBOUND → store/worker side

### 12.2 Text direction

Text content uses native bidi handling:

```html
<div dir="auto">...</div>
```

with bidi-safe CSS.

Task 7 MUST NOT use a simplistic Arabic-regex heuristic to force an entire message into RTL/LTR.

This is required for mixed Arabic/English/phone/URL content.

### 12.3 Message kinds

TEXT:
- render text normally.

IMAGE:
- render a safe `Image message` placeholder/metadata affordance only.

DOCUMENT:
- render a safe `Document message` placeholder/metadata affordance only.

AUDIO:
- render a safe `Voice/Audio message` placeholder only.

LOCATION:
- render a safe `Location message` placeholder only.

SYSTEM:
- render as an internal/system timeline style distinct from customer messages.

Task 7 MUST NOT fetch provider media URLs or expose a send-media control.

### 12.4 Status

Outbound message status displays deterministic worker-readable state for:

- PENDING
- SENT
- DELIVERED
- READ
- FAILED

No status UI may trigger automatic resend.

## 13. Quick replies

Quick replies come only from:

```text
snapshot.quickReplies
```

filtered to:

```text
active === true
```

Task 7 MUST NOT hard-code Egyptian defaults inside React, view-model, or application code as a fallback source of truth.

Future Admin owns saved-reply administration. Production data seeding/configuration is a separate operational step.

### 13.1 Category order

Display categories deterministically:

1. PREPARATION
2. DELIVERY
3. ADDRESS
4. PAYMENT
5. DELAY
6. THANKS

Within a category sort by:

1. `usageCount DESC`
2. text or stable ID as deterministic tie-breaker.

### 13.2 Selection semantics

Selecting a quick reply:

- copies its text into the composer;
- MAY replace the current composer only after normal UI confirmation semantics if non-empty text would otherwise be lost;
- never sends;
- never changes a conversation remotely.

If no active quick replies exist, show a small empty state; do not invent defaults in the UI.

## 14. Composer and draft behavior

Task 7 uses the existing `saveDraft` / `getDraft` API for the currently selected conversation.

### 14.1 On conversation change

When selecting a conversation:

- load its current local draft through `getDraft`;
- do not send it automatically;
- keep draft ownership per conversation.

### 14.2 Saving

Task 7 may save draft text locally on explicit changes using a small deterministic debounce.

A draft write failure is presented as a local, non-fatal WhatsApp UI error and MUST NOT block Orders or other Operations areas.

### 14.3 Clearing

The composer may be cleared only after a successful `sendText` result for the exact text/send attempt being submitted.

A send failure or delivery uncertainty MUST preserve the composer text.

## 15. Outbound intent-key semantics

The UI generates one opaque outbound intent key for one text send attempt.

The key MUST remain stable when all of these remain unchanged:

- conversation ID;
- composer text;
- current unsent attempt.

If the worker presses Send again after a failure without changing the text, Task 7 reuses the same intent key.

If the worker changes the text after a failed attempt, the UI creates a new attempt and therefore a new intent key.

After successful send, the attempt is cleared.

Task 7 MUST NOT:

- create a fresh intent key merely because the request failed;
- automatically retry a failed/uncertain request;
- queue a failed request for background replay.

The server remains the durable idempotency authority.

## 16. Conversation mutations

Task 7 exposes these explicit controls through the existing API:

- Mark unread
- Archive / Unarchive
- Follow-up on/off

After successful mutation, the controller triggers an inbox refresh.

If the mutation fails:

- retain the last good local snapshot;
- show a safe worker-readable WhatsApp error;
- do not optimistically persist a false final state unless the controller has an explicit rollback implementation.

No mutation failure may affect Orders/POS state.

## 17. Offline and error presentation

Task 7 distinguishes:

### 17.1 Remote unavailable

When the application returns cached inbox data because remote WhatsApp is unavailable:

- cached conversations remain readable;
- UI indicates `WhatsApp Offline — POS continues normally` or equivalent concise status;
- text send remains explicit and may fail; it is not queued for replay.

### 17.2 Device/auth invalid

Authoritative device/session invalidation is not ordinary offline state.

Task 7 displays a stronger session/device-auth error and MUST NOT present it as a harmless network outage.

### 17.3 Local persistence error

Draft/cache errors are local WhatsApp errors. They do not crash or block the Operations shell.

### 17.4 Delivery uncertain

Delivery uncertainty must communicate that TUX cannot safely confirm whether the provider accepted the message.

The UI MUST NOT auto-retry.

If the worker retries unchanged text, reuse the same outbound intent key.

## 18. Visual structure

The first worker UI is desktop-first and uses a two-pane workspace:

```text
┌─────────────────────────┬─────────────────────────────────────┐
│ Conversation rail       │ Active conversation                 │
│ search                  │ customer/context header             │
│ filters                 │ message history                     │
│ conversation rows       │                                     │
│                         │ quick replies                       │
│                         │ composer + explicit Send            │
└─────────────────────────┴─────────────────────────────────────┘
```

The workspace follows the existing TUX Operations visual system and system accent color rather than introducing a separate WhatsApp-green application theme.

WhatsApp brand/provider styling must not visually overpower TUX Operations.

## 19. Conversation-row content

Each conversation row should show, when available:

- customer name or display phone fallback;
- context label;
- last-message preview if loaded;
- last-message time;
- unread count;
- follow-up indicator;
- archived styling in Archived filter.

No row should expose internal provider IDs.

## 20. Active-conversation header

The header may show:

- customer name;
- display phone;
- context label;
- linked-order presence indicator;
- follow-up/archive controls.

It MUST NOT add Task 8 actions such as:

- View Order using unresolved display-number semantics;
- Create Order from Chat;
- Send Menu;
- automatic order/customer matching UI beyond fields already present in the conversation snapshot.

## 21. React / view-model separation

Business/presentation rules belong outside JSX where practical.

Create a focused `whatsappView.ts` or equivalent pure module for:

- filter logic;
- deterministic sorting;
- search projection;
- context labels;
- last-message preview;
- quick-reply ordering;
- status labels;
- unread aggregation.

The React workspace owns interaction/layout/effects, not domain authority.

The controller owns asynchronous orchestration and refresh state.

## 22. Testing requirements

Task 7 implementation planning must include strict TDD for the following behavior.

### 22.1 Pure view model

Tests MUST cover:

- ALL filter;
- UNREAD filter;
- FOLLOW_UP filter;
- ARCHIVED filter;
- deterministic conversation sorting;
- stable tie-breaks;
- search by customer name;
- search by display/normalized phone;
- search by loaded message text;
- no claimed human order-number search;
- context label mapping;
- unread aggregation;
- quick-reply category ordering;
- quick-reply usage ordering;
- outbound status labels.

### 22.2 Controller

Tests MUST cover:

- initial refresh;
- 15-second visible polling;
- no polling while hidden;
- refresh on visibility restore;
- refresh on `online`;
- single-flight behavior;
- coalesced concurrent triggers;
- failed refresh retaining last successful snapshot;
- unread badge retained on transient failure;
- active-conversation selection stability;
- successful mutation triggers refresh;
- no automatic mutation/send during refresh.

### 22.3 Composer/idempotency

Tests MUST cover:

- quick reply fills composer but sends zero messages;
- explicit Send calls `sendText` exactly once;
- repeated failed Send with unchanged text reuses the same outbound intent key;
- text edit after failed send creates a new intent key;
- success clears the attempt/composer;
- failure preserves composer;
- delivery uncertainty does not auto-retry;
- draft load/save is per conversation.

### 22.4 Component / shell integration

Tests MUST cover:

- nav order is Orders / Orders Board / WhatsApp / Expenses / Bulk Stock;
- unread badge visible when non-zero;
- leaving Orders for WhatsApp uses the existing unsaved menu-layout guard;
- WhatsApp workspace renders inside ACTIVE shell only;
- `dir="auto"` is used on message text;
- inbound/outbound bubble presentation differs;
- IMAGE / DOCUMENT / AUDIO / LOCATION placeholders render safely;
- no attachment-send control;
- `sendMedia` is absent;
- WhatsApp load failure does not prevent Orders shell rendering/navigation.

## 23. Files expected in Task 7 implementation

The implementation plan may create/modify a narrow set around:

- `apps/operations/src/app/WhatsAppWorkspace.tsx`
- `apps/operations/src/app/WhatsAppWorkspace.test.tsx`
- `apps/operations/src/app/whatsappView.ts`
- `apps/operations/src/app/whatsappView.test.ts`
- a focused inbox controller module/test under `apps/operations/src/app/`
- `apps/operations/src/app/App.tsx`
- `apps/operations/src/app/icons.tsx` only if a dedicated icon is required
- `apps/operations/src/styles/global.css`

The implementation plan MUST NOT require changes to:

- Supabase migrations;
- SQLite migrations;
- IndexedDB migrations;
- Meta provider gateway;
- server authority;
- Electron IPC/preload/runtime contracts;
- `TuxWhatsAppApi` method set;
- package manifests unless an unexpected existing-tooling gap is proven and separately reviewed.

## 24. Production and data boundary

Task 7 performs no production deployment and no production data/config mutation.

Specifically Task 7 does NOT authorize:

- Supabase migration/application;
- insertion/update of `whatsapp_channels`;
- quick-reply data seeding;
- Meta phone/webhook/token configuration;
- Vercel production env changes;
- Vercel deployment;
- Windows release publication.

## 25. Acceptance for Task 7 completion

Task 7 may be considered implementation-complete only when all of the following are proven:

1. WhatsApp appears in the correct nav position.
2. Nav unread badge updates from the shared controller snapshot.
3. Inbox list/filter/search are deterministic.
4. Conversation selection and history rendering work using the existing nine-method API.
5. Arabic/English/mixed message text uses native bidi-safe direction handling.
6. Quick replies come only from canonical snapshot data and never auto-send.
7. Explicit text send uses stable retry identity for unchanged failed attempts.
8. No automatic outbound replay exists.
9. No media-send affordance or `sendMedia` is introduced.
10. Existing Orders menu-edit guard remains intact.
11. WhatsApp unavailability cannot make the POS shell unavailable.
12. No backend/security/schema authority changes are required.
13. Full relevant tests/typecheck/lint/format gates pass.
14. Working tree is clean and only authorized Task 7 files changed.

## 26. Deferred immediately after Task 7

The next feature work remains separately gated.

Order/customer context work includes:

- customer matching presentation;
- active-order candidate presentation;
- human order-number search;
- View Order;
- Create Order from Chat;
- Order → WhatsApp;
- Send Menu.

Media/offline hardening later includes:

- provider media retrieval/cache policy;
- outbound media transport;
- explicit failed-message retry UX where safe;
- Windows notifications;
- richer reconnect status handling.

Structured website-order Review/Accept remains owned by the TUX-MENU Web Order Bridge design.

## 27. Supersession

This specification supersedes the implementation semantics of `Task 7: Build the worker WhatsApp inbox UI` in:

`docs/superpowers/plans/2026-09-02-tux-operations-whatsapp-inbox.md`

Only Task 7 is superseded by this document.

Completed Tasks 1–6 and their later amendments remain authoritative.

The original Task 8+ content remains subject to mandatory pre-implementation audit and MUST NOT be executed merely because Task 7 completes.
