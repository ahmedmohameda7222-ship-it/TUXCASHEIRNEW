# TUX Operations WhatsApp Inbox Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the approved native WhatsApp business inbox inside TUX Operations so the current worker can receive, read, search, and reply to store conversations without leaving TUX.

**Architecture:** Meta WhatsApp Business Platform / Cloud API remains behind a server-side TUX WhatsApp Gateway. Provider webhooks materialize idempotent remote conversation/message state; authenticated Operations clients read/send through TUX-controlled endpoints. Operations exposes the inbox through the existing application/platform-contract/Electron-or-browser client boundaries and never embeds WhatsApp Web or provider credentials in the renderer.

**Tech Stack:** TypeScript 6, React 19, Electron 43, Vitest 4, IndexedDB, SQLite, Vercel serverless API routes, Supabase/Postgres/Edge Functions, WhatsApp Business Platform Cloud API.

**Spec:** `docs/superpowers/specs/2026-09-02-tux-operations-whatsapp-inbox-design.md`

## Global Constraints

- No AI, chatbot, AI extraction, AI reply generation, or automatic AI response.
- All shop workers may use WhatsApp; outgoing messages are attributed to the current signed-in worker.
- One Operations laptop per shop is the v1 topology; do not build multi-laptop locking/presence.
- Egyptian Arabic quick replies are the default; quick replies insert into the composer and never auto-send.
- Arabic RTL, English LTR, and mixed-direction messages must render correctly.
- WhatsApp/provider failure must never block Orders, Orders Board, Expenses, Bulk Stock, printing, Business Day, End Day, or local persistence.
- Provider tokens/secrets are server-side only.
- Do not enable Electron `webviewTag`, arbitrary navigation, or Node integration in the Operations renderer.
- Free-form chat text must never be parsed into order lines automatically.
- `Create Order from Chat` transfers customer context only and opens the normal Orders flow with an empty cart.
- The Cloud API provider contract must use a configurable Graph API version and `/PHONE_NUMBER_ID/messages`; do not hard-code a soon-to-expire Graph version.
- Webhook processing and outbound send intents must be idempotent.

---

### Task 1: Add WhatsApp domain types and Egyptian phone normalization

**Files:**
- Create: `packages/domain/src/whatsapp.ts`
- Create: `packages/domain/src/whatsapp.test.ts`
- Create: `packages/domain/src/phone.ts`
- Create: `packages/domain/src/phone.test.ts`
- Modify: `packages/domain/src/index.ts`

**Interfaces:**
- Produces: `normalizeEgyptianPhone(value: string): string | null`
- Produces: `WhatsAppConversation`, `WhatsAppMessage`, `WhatsAppMessageStatus`, `WhatsAppConversationContext`, `WhatsAppQuickReply`
- Consumes later: normalized phone strings are the only customer matching key used by WhatsApp and the Web Order Bridge.

- [ ] **Step 1: Write the failing phone-normalization tests**

```ts
import { describe, expect, it } from 'vitest';
import { normalizeEgyptianPhone } from './phone';

describe('normalizeEgyptianPhone', () => {
  it.each([
    ['01012345678', '+201012345678'],
    ['+201012345678', '+201012345678'],
    ['00201012345678', '+201012345678'],
    ['201012345678', '+201012345678'],
  ])('normalizes %s', (input, expected) => {
    expect(normalizeEgyptianPhone(input)).toBe(expected);
  });

  it.each(['', '12345', '+491701234567'])('rejects unsupported values: %s', (input) => {
    expect(normalizeEgyptianPhone(input)).toBeNull();
  });
});
```

- [ ] **Step 2: Run RED**

Run: `npm test -- packages/domain/src/phone.test.ts`
Expected: FAIL because `./phone` does not exist.

- [ ] **Step 3: Implement deterministic normalization**

```ts
export function normalizeEgyptianPhone(value: string): string | null {
  const digits = value.replace(/\D/g, '');
  const national = digits.startsWith('0020')
    ? digits.slice(4)
    : digits.startsWith('20')
      ? digits.slice(2)
      : digits;
  if (!/^01[0125]\d{8}$/.test(national)) return null;
  return `+20${national.slice(1)}`;
}
```

- [ ] **Step 4: Add WhatsApp model tests and types**

```ts
export type WhatsAppMessageStatus = 'PENDING' | 'SENT' | 'DELIVERED' | 'READ' | 'FAILED';
export type WhatsAppMessageDirection = 'INBOUND' | 'OUTBOUND';
export type WhatsAppMessageKind = 'TEXT' | 'IMAGE' | 'DOCUMENT' | 'AUDIO' | 'LOCATION' | 'SYSTEM';
export type WhatsAppConversationContext = 'DIRECT' | 'WEB_REQUEST' | 'ORDER_LINKED';

export interface WhatsAppMessage {
  readonly id: string;
  readonly shopId: ShopId;
  readonly conversationId: string;
  readonly providerMessageId: string | null;
  readonly outboundIntentKey: string | null;
  readonly direction: WhatsAppMessageDirection;
  readonly kind: WhatsAppMessageKind;
  readonly text: string | null;
  readonly mediaRef: string | null;
  readonly status: WhatsAppMessageStatus;
  readonly sentByWorkerId: WorkerId | null;
  readonly createdAt: Instant;
}
```

Test the invariant that inbound messages cannot carry `sentByWorkerId` and outbound messages require an intent key before persistence.

- [ ] **Step 5: Run GREEN and the domain suite**

Run: `npm test -- packages/domain/src/phone.test.ts packages/domain/src/whatsapp.test.ts`
Expected: PASS.

Run: `npm run typecheck -w @tux/domain`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/domain/src/phone.ts packages/domain/src/phone.test.ts packages/domain/src/whatsapp.ts packages/domain/src/whatsapp.test.ts packages/domain/src/index.ts
git commit -m "feat: add WhatsApp domain and Egyptian phone normalization"
```

---

### Task 2: Add remote WhatsApp persistence with tenant fencing and idempotency

**Files:**
- Create: `supabase/migrations/20260902HHMM00_whatsapp_inbox.sql`
- Create: `scripts/test-whatsapp-migration.mjs`
- Modify: `package.json`

**Interfaces:**
- Produces remote tables: `whatsapp_conversations`, `whatsapp_messages`, `whatsapp_quick_replies`, `whatsapp_conversation_order_links`
- Produces stable uniqueness on provider message IDs and outbound intent keys.
- Produces server-only RPCs/functions for webhook materialization and authenticated Operations reads/writes.

- [ ] **Step 1: Write the migration contract test first**

Create `scripts/test-whatsapp-migration.mjs` that reads the migration text and asserts all of these exact protections exist:

```js
assert.match(sql, /unique\s*\(\s*shop_id\s*,\s*provider_message_id\s*\)/i);
assert.match(sql, /unique\s*\(\s*shop_id\s*,\s*outbound_intent_key\s*\)/i);
assert.match(sql, /whatsapp_conversations/i);
assert.match(sql, /whatsapp_messages/i);
assert.match(sql, /enable row level security/i);
assert.match(sql, /revoke all/i);
```

- [ ] **Step 2: Run RED**

Run: `node scripts/test-whatsapp-migration.mjs`
Expected: FAIL because the migration does not exist.

- [ ] **Step 3: Create the migration**

Use UUID primary keys, `shop_id` on every tenant-owned row, server timestamps, and check constraints for direction/status/media shape. At minimum enforce:

```sql
create unique index whatsapp_messages_provider_message_unique
  on public.whatsapp_messages (shop_id, provider_message_id)
  where provider_message_id is not null;

create unique index whatsapp_messages_outbound_intent_unique
  on public.whatsapp_messages (shop_id, outbound_intent_key)
  where outbound_intent_key is not null;
```

Store worker attribution on outbound messages as `sent_by_worker_id` and preserve `device_id`/`initiated_at` audit fields. Keep media metadata separate from any expiring local/provider URL.

- [ ] **Step 4: Fence public/client writes**

Enable RLS but do not grant direct anonymous/public table mutation. Provider webhooks and authenticated TUX gateways use explicit server-side functions/RPCs. Follow the repository's existing tenant-integrity and remote-gateway migration patterns rather than adding broad table grants.

- [ ] **Step 5: Extend migration gate**

Modify `package.json` so `test:migrations` also executes `node scripts/test-whatsapp-migration.mjs`.

- [ ] **Step 6: Run GREEN**

Run: `npm run test:migrations`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations scripts/test-whatsapp-migration.mjs package.json
git commit -m "feat: add WhatsApp inbox persistence"
```

---

### Task 3: Build the server-side WhatsApp provider gateway and webhook materializer

**Files:**
- Create: `server/whatsappProviderGateway.ts`
- Create: `server/whatsappProviderGateway.test.ts`
- Create: `server/whatsappWebhook.ts`
- Create: `server/whatsappWebhook.test.ts`
- Create: `api/whatsapp-webhook.ts`
- Modify: `server/vercelSupabaseEnv.ts`

**Interfaces:**
- Produces: `WhatsAppProviderGateway.sendMessage(input): Promise<{ providerMessageId: string }>`
- Produces: `handleWhatsAppWebhook(request): Promise<Response>`
- Consumes env names: `TUX_WHATSAPP_GRAPH_VERSION`, `TUX_WHATSAPP_PHONE_NUMBER_ID`, `TUX_WHATSAPP_ACCESS_TOKEN`, `TUX_WHATSAPP_WEBHOOK_VERIFY_TOKEN`, `TUX_WHATSAPP_APP_SECRET`.

- [ ] **Step 1: Write RED tests for outbound request shape**

Inject `fetch` into the provider gateway and assert the request is built as:

```ts
expect(fetchMock).toHaveBeenCalledWith(
  `https://graph.facebook.com/${graphVersion}/${phoneNumberId}/messages`,
  expect.objectContaining({
    method: 'POST',
    headers: expect.objectContaining({
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    }),
  }),
);
```

For text bodies assert `messaging_product: 'whatsapp'`, `recipient_type: 'individual'`, recipient `to`, and `type: 'text'`.

- [ ] **Step 2: Run RED**

Run: `npm test -- server/whatsappProviderGateway.test.ts`
Expected: FAIL because the gateway does not exist.

- [ ] **Step 3: Implement provider gateway**

Do not expose access tokens in thrown errors/logs. Parse provider failures into a typed result containing HTTP status, provider error code if present, and a safe message.

- [ ] **Step 4: Write webhook verification/materialization RED tests**

Cover both Meta verification GET and event POST. POST tests must prove invalid request signatures are rejected before parsing/mutating state and duplicate `wamid...` events materialize once.

Use a signature helper with the raw request body:

```ts
const expected = `sha256=${createHmac('sha256', appSecret).update(rawBody).digest('hex')}`;
expect(timingSafeEqual(Buffer.from(received), Buffer.from(expected))).toBe(true);
```

- [ ] **Step 5: Implement webhook handler**

The handler translates provider payloads into an internal provider-event DTO and calls a repository/RPC abstraction. Keep provider JSON parsing in this boundary; domain/application code must not depend on Meta webhook object shapes.

- [ ] **Step 6: Run GREEN**

Run: `npm test -- server/whatsappProviderGateway.test.ts server/whatsappWebhook.test.ts`
Expected: PASS.

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add server/whatsappProviderGateway.ts server/whatsappProviderGateway.test.ts server/whatsappWebhook.ts server/whatsappWebhook.test.ts server/vercelSupabaseEnv.ts api/whatsapp-webhook.ts
git commit -m "feat: add WhatsApp provider gateway and webhook"
```

---

### Task 4: Add authenticated Operations WhatsApp remote API

**Files:**
- Create: `server/whatsappOperationsGateway.ts`
- Create: `server/whatsappOperationsGateway.test.ts`
- Create: `api/whatsapp.ts`
- Create: `apps/operations/src/app/browserWhatsAppRemote.ts`
- Create: `apps/operations/src/app/browserWhatsAppRemote.test.ts`

**Interfaces:**
- Produces authenticated operations actions:
  - `GET /api/whatsapp?after=<cursor>` -> conversation/message snapshot for the enrolled shop.
  - `POST /api/whatsapp` with `{ action: 'SEND_MESSAGE', conversationId, outboundIntentKey, kind, text/media }`.
  - `POST /api/whatsapp` with `{ action: 'MARK_UNREAD' | 'ARCHIVE' | 'FOLLOW_UP' | 'LINK_ORDER', ... }`.
- Every action resolves shop/device/worker identity from the existing device/session gateway; request bodies never choose an arbitrary shop or worker.

- [ ] **Step 1: Write RED authorization tests**

Reuse the existing server device-session test style. Prove:

```ts
expect(await callWithoutDeviceSession()).toMatchObject({ status: 401 });
expect(await callWithMismatchedShopPayload()).toMatchObject({ status: 400 });
```

The send path must take current worker identity from the authenticated session, not from JSON supplied by the renderer.

- [ ] **Step 2: Run RED**

Run: `npm test -- server/whatsappOperationsGateway.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement the authenticated gateway**

Use the existing `resolveDeviceSession`/Supabase gateway pattern. Build server-side repository calls with the resolved shop/device/worker. For `SEND_MESSAGE`, insert/find the outbound intent first, call Meta once for a newly-created intent, then attach the returned provider message ID.

- [ ] **Step 4: Test retry idempotency**

Two sends with the same `outboundIntentKey` must return the same stored message record and invoke the provider gateway once.

- [ ] **Step 5: Implement browser remote client**

Expose a typed class with methods such as:

```ts
export interface BrowserWhatsAppRemote {
  loadInbox(cursor?: string): Promise<WhatsAppInboxSnapshot>;
  sendMessage(input: SendWhatsAppMessageInput): Promise<WhatsAppMessage>;
  markUnread(conversationId: string): Promise<void>;
  archive(conversationId: string): Promise<void>;
  setFollowUp(conversationId: string, followUp: boolean): Promise<void>;
}
```

- [ ] **Step 6: Run GREEN**

Run: `npm test -- server/whatsappOperationsGateway.test.ts apps/operations/src/app/browserWhatsAppRemote.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add server/whatsappOperationsGateway.ts server/whatsappOperationsGateway.test.ts api/whatsapp.ts apps/operations/src/app/browserWhatsAppRemote.ts apps/operations/src/app/browserWhatsAppRemote.test.ts
git commit -m "feat: add authenticated WhatsApp Operations API"
```

---

### Task 5: Add application service and local cache contracts

**Files:**
- Create: `packages/application/src/whatsapp.ts`
- Create: `packages/application/src/whatsapp.test.ts`
- Create: `packages/persistence/src/whatsappStore.ts`
- Create: `packages/persistence/src/sqlite/whatsappStore.ts`
- Create: `packages/persistence/src/sqlite/whatsappStore.test.ts`
- Create: `packages/persistence/src/browser/indexedDbWhatsAppStore.ts`
- Create: `packages/persistence/src/browser/indexedDbWhatsAppStore.test.ts`
- Modify: `packages/application/src/index.ts`
- Modify: `packages/persistence/src/index.ts`
- Modify: `packages/persistence/src/browser/index.ts`
- Modify: `packages/persistence/src/sqlite/index.ts`

**Interfaces:**
- Produces `WhatsAppStore` with `upsertRemoteSnapshot`, `listConversations`, `listMessages`, `saveDraft`, `getDraft`.
- Produces `OperationsWhatsAppService` with `loadInbox`, `loadConversation`, `sendText`, `sendMedia`, `markUnread`, `archive`, `setFollowUp`, `linkOrder`.
- `send*` requires current operator identity through `OperatorSessionReadModel` and delegates remote delivery to an injected `WhatsAppRemoteGateway`.

- [ ] **Step 1: Write RED application tests**

Prove the current worker is captured at send intent time:

```ts
const result = await service.sendText({ conversationId, text: 'تمام', outboundIntentKey: 'intent-1' });
expect(result.ok).toBe(true);
expect(remote.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
  sentByWorkerId: worker.id,
  outboundIntentKey: 'intent-1',
}));
```

Also prove no ACTIVE worker returns an application conflict/auth error without remote send.

- [ ] **Step 2: Run RED**

Run: `npm test -- packages/application/src/whatsapp.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement application service with dependency injection**

Keep provider-specific rules out of the service. The service handles current-operator fencing, local draft/cache state, customer/order contextual linking, and safe result mapping.

- [ ] **Step 4: Write SQLite and IndexedDB cache tests**

Cover restart persistence of message drafts and idempotent snapshot upsert by message ID.

- [ ] **Step 5: Implement both stores**

SQLite must use the existing Operations DB location/transaction conventions. IndexedDB uses a schema-version bump and deterministic object-store/index creation. Do not erase existing stores during upgrade.

- [ ] **Step 6: Run GREEN**

Run: `npm test -- packages/application/src/whatsapp.test.ts packages/persistence/src/sqlite/whatsappStore.test.ts packages/persistence/src/browser/indexedDbWhatsAppStore.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/application/src/whatsapp.ts packages/application/src/whatsapp.test.ts packages/application/src/index.ts packages/persistence/src/whatsappStore.ts packages/persistence/src/sqlite packages/persistence/src/browser packages/persistence/src/index.ts
git commit -m "feat: add WhatsApp application service and local cache"
```

---

### Task 6: Extend platform contracts, Electron IPC, preload, and browser runtime

**Files:**
- Modify: `packages/platform-contracts/index.d.ts`
- Modify: `apps/operations-desktop/src/main/index.ts`
- Create: `apps/operations-desktop/src/preload/whatsappResult.ts`
- Create: `apps/operations-desktop/src/preload/whatsappResult.test.ts`
- Modify: `apps/operations-desktop/src/preload/index.ts`
- Modify: `apps/operations/src/app/sessionClient.ts`
- Create: `apps/operations-desktop/src/main/whatsappIpc.test.ts`

**Interfaces:**
- Produces `TuxWhatsAppApi` and `TuxDesktopApi.whatsapp`.
- Browser runtime returns the same API shape backed by `OperationsWhatsAppService` + `BrowserWhatsAppRemote`.
- Desktop runtime returns the same API shape through trusted IPC and the local SQLite cache.

- [ ] **Step 1: Add the contract first and verify type failures**

```ts
export interface TuxWhatsAppApi {
  loadInbox(): Promise<WhatsAppInboxResult>;
  loadConversation(conversationId: string): Promise<WhatsAppConversationResult>;
  sendText(input: SendWhatsAppTextInput): Promise<WhatsAppSendResult>;
  markUnread(conversationId: string): Promise<WhatsAppMutationResult>;
  archive(conversationId: string): Promise<WhatsAppMutationResult>;
  setFollowUp(conversationId: string, followUp: boolean): Promise<WhatsAppMutationResult>;
  linkOrder(conversationId: string, orderId: OrderId): Promise<WhatsAppMutationResult>;
}
```

Run: `npm run typecheck`
Expected: FAIL until both runtimes implement the new contract.

- [ ] **Step 2: Add preload result parsers/tests**

Mirror the existing `ordersResult.ts` defensive parse pattern; untrusted IPC results must be structurally validated before entering the renderer.

- [ ] **Step 3: Register desktop IPC**

Every handler must call `assertTrustedIpcSender(event, window.webContents.id)` exactly like the existing Orders handlers. Reject invalid payload types before invoking application services.

- [ ] **Step 4: Wire browser runtime**

Instantiate one WhatsApp service/cache/remote per browser runtime. Browser fallback may poll/load when open; it must not require desktop-only APIs.

- [ ] **Step 5: Run GREEN**

Run: `npm test -- apps/operations-desktop/src/preload/whatsappResult.test.ts apps/operations-desktop/src/main/whatsappIpc.test.ts`
Expected: PASS.

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/platform-contracts/index.d.ts apps/operations-desktop/src/main/index.ts apps/operations-desktop/src/main/whatsappIpc.test.ts apps/operations-desktop/src/preload apps/operations/src/app/sessionClient.ts
git commit -m "feat: bridge WhatsApp into Operations runtimes"
```

---

### Task 7: Build the worker WhatsApp inbox UI

**Files:**
- Create: `apps/operations/src/app/WhatsAppWorkspace.tsx`
- Create: `apps/operations/src/app/WhatsAppWorkspace.test.tsx`
- Create: `apps/operations/src/app/whatsappView.ts`
- Create: `apps/operations/src/app/whatsappView.test.ts`
- Modify: `apps/operations/src/app/App.tsx`
- Modify: `apps/operations/src/styles/global.css`
- Modify: `apps/operations/src/app/icons.tsx`

**Interfaces:**
- Adds `WHATSAPP` to `OperationsArea`.
- `WhatsAppWorkspace` consumes `TuxWhatsAppApi`, current session worker, and an `onOpenOrder(orderId)` navigation callback.
- Does not mutate Orders directly.

- [ ] **Step 1: Write RED view-model tests**

Cover unread filtering, conversation sorting, contextual labels (`Direct WhatsApp`, `Website Order`, `Order #...`), message direction, and Arabic text direction.

```ts
expect(messageDirection('أوردر حضرتك جاهز')).toBe('rtl');
expect(messageDirection('Your order is ready')).toBe('ltr');
```

- [ ] **Step 2: Run RED**

Run: `npm test -- apps/operations/src/app/whatsappView.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement the workspace**

Render a two-pane desktop layout: conversation list/search/filter on the left, active conversation on the right. Include unread badge, archive, follow-up, mark-unread, composer, attachment affordances, and delivery/read state. Keep component business rules in `whatsappView.ts`/application service rather than JSX.

- [ ] **Step 4: Implement Egyptian quick replies**

Seed deterministic defaults in the view/application boundary:

```ts
[
  'أوردر حضرتك بيتجهز دلوقتي.',
  'أوردر حضرتك جاهز.',
  'الأوردر خرج مع الدليفري.',
  'ممكن تأكدلنا العنوان لو سمحت؟',
  'ممكن تبعتلنا اللوكيشن؟',
  'الدليفري في الطريق لحضرتك.',
  'تمام، هنعدل الأوردر لحضرتك.',
  'شكراً لحضرتك.',
]
```

Clicking one changes composer text only; test that no send call occurs until explicit Send.

- [ ] **Step 5: Add navigation entry**

Extend `OperationsArea` and insert `WhatsApp` after Orders Board. Display unread count on the nav item. Preserve existing menu-layout unsaved-change guard when switching away from Orders.

- [ ] **Step 6: Run component GREEN**

Run: `npm test -- apps/operations/src/app/whatsappView.test.ts apps/operations/src/app/WhatsAppWorkspace.test.tsx`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/operations/src/app/WhatsAppWorkspace.tsx apps/operations/src/app/WhatsAppWorkspace.test.tsx apps/operations/src/app/whatsappView.ts apps/operations/src/app/whatsappView.test.ts apps/operations/src/app/App.tsx apps/operations/src/app/icons.tsx apps/operations/src/styles/global.css
git commit -m "feat: add native WhatsApp inbox workspace"
```

---

### Task 8: Add customer/order context, Send Menu, and Create Order from Chat

**Files:**
- Modify: `packages/application/src/whatsapp.ts`
- Modify: `packages/application/src/whatsapp.test.ts`
- Modify: `apps/operations/src/app/WhatsAppWorkspace.tsx`
- Modify: `apps/operations/src/app/OrdersWorkspace.tsx`
- Modify: `apps/operations/src/app/App.tsx`
- Create: `apps/operations/src/app/whatsappOrderContext.test.tsx`

**Interfaces:**
- `OperationsWhatsAppService.resolveCustomerOrderContext(conversationId)` returns matched customer and zero/one/many active-order candidates.
- `Create Order from Chat` produces a customer-prefill intent, not product lines.
- `Send Menu` inserts the configured public TUX-MENU URL into the composer and does not auto-send.

- [ ] **Step 1: Write RED tests for zero/one/many order matching**

```ts
expect(await contextFor(phoneWithOneActiveOrder)).toMatchObject({ mode: 'SINGLE_ACTIVE_ORDER' });
expect(await contextFor(phoneWithTwoActiveOrders)).toMatchObject({ mode: 'CHOOSE_ACTIVE_ORDER' });
```

No test may infer order intent from message text.

- [ ] **Step 2: Implement normalized-phone customer matching**

Reuse `normalizeEgyptianPhone`; query customer contacts/orders by normalized phone. Multiple active orders remain explicit candidates.

- [ ] **Step 3: Add `Create Order from Chat` navigation intent**

Use an app-level state object such as:

```ts
type OrdersPrefill = {
  readonly normalizedPhone: string;
  readonly displayPhone: string;
  readonly customerName: string;
  readonly address: string | null;
  readonly zoneId: DeliveryZoneId | null;
};
```

Opening Orders with this prefill must leave `draft.lines` empty.

- [ ] **Step 4: Add Order -> WhatsApp action**

Where an order has a normalized customer phone, expose `WhatsApp Customer` and navigate to the matched conversation. If no conversation exists yet, open a conversation composer addressed to the normalized phone through the service; do not launch an external app.

- [ ] **Step 5: Add Send Menu**

Read a non-secret public storefront URL from configuration and insert an Egyptian saved reply into the composer. Explicit Send remains required.

- [ ] **Step 6: Run GREEN**

Run: `npm test -- packages/application/src/whatsapp.test.ts apps/operations/src/app/whatsappOrderContext.test.tsx`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/application/src/whatsapp.ts packages/application/src/whatsapp.test.ts apps/operations/src/app/WhatsAppWorkspace.tsx apps/operations/src/app/OrdersWorkspace.tsx apps/operations/src/app/App.tsx apps/operations/src/app/whatsappOrderContext.test.tsx
git commit -m "feat: link WhatsApp conversations with Orders"
```

---

### Task 9: Add media, local drafts, offline state, and Windows notifications

**Files:**
- Modify: `packages/application/src/whatsapp.ts`
- Modify: `packages/persistence/src/whatsappStore.ts`
- Modify: `apps/operations/src/app/WhatsAppWorkspace.tsx`
- Create: `apps/operations/src/app/whatsappDraftPersistence.test.tsx`
- Create: `apps/operations-desktop/src/main/whatsappNotifications.ts`
- Create: `apps/operations-desktop/src/main/whatsappNotifications.test.ts`
- Modify: `apps/operations-desktop/src/main/index.ts`

**Interfaces:**
- Composer draft is keyed by conversation ID and survives navigation/restart.
- New inbound message can request an OS notification, but notification failure is non-fatal.
- Media records separate durable metadata from cached bytes/temporary provider URLs.

- [ ] **Step 1: Write RED draft-persistence test**

Type Arabic text, navigate away/remount, and assert the composer restores the same text without sending it.

- [ ] **Step 2: Implement draft persistence**

Persist on composer change with debounced/local-store write; clear only after a successful send result for the exact draft revision that was sent.

- [ ] **Step 3: Add media actions**

Support image/document/audio/location message rendering from provider metadata. Do not treat payment screenshots as payment truth. For local media cache, persist an expiry/eviction timestamp and keep the durable message record after cache deletion.

- [ ] **Step 4: Add connectivity state**

Show `WhatsApp Offline — POS continues normally` when remote delivery is unavailable. Existing cached messages remain readable. `Retry` is explicit for failed outbound messages; do not blindly auto-send stale queued free-form messages after long outages.

- [ ] **Step 5: Add Windows notification bridge**

Notify on newly-observed inbound unread messages while Operations is not focused on that conversation. Suppress repeated notifications for the same provider message ID.

- [ ] **Step 6: Run GREEN**

Run: `npm test -- apps/operations/src/app/whatsappDraftPersistence.test.tsx apps/operations-desktop/src/main/whatsappNotifications.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/application/src/whatsapp.ts packages/persistence/src/whatsappStore.ts apps/operations/src/app/WhatsAppWorkspace.tsx apps/operations/src/app/whatsappDraftPersistence.test.tsx apps/operations-desktop/src/main/whatsappNotifications.ts apps/operations-desktop/src/main/whatsappNotifications.test.ts apps/operations-desktop/src/main/index.ts
git commit -m "feat: harden WhatsApp media and offline UX"
```

---

### Task 10: Add integration/E2E/security gates and production acceptance checklist

**Files:**
- Create: `e2e/whatsapp-inbox.spec.ts`
- Create: `scripts/test-whatsapp-security.mjs`
- Modify: `package.json`
- Modify: `.github/workflows/ci.yml`
- Create: `docs/WHATSAPP_PRODUCTION_ACCEPTANCE.md`

**Interfaces:**
- CI must gate domain/application/UI/provider tests plus source-level secret and Electron-boundary checks.
- Production acceptance requires a real test WhatsApp business number/account and real customer test number; no secrets or real PINs are committed or pasted into docs.

- [ ] **Step 1: Write E2E using a deterministic fake provider mode**

Test: direct inbound fixture -> unread badge -> open conversation -> explicit reply -> provider fake receives one outbound intent -> message displays current worker attribution.

- [ ] **Step 2: Add security source checks**

`test-whatsapp-security.mjs` fails if renderer/browser source references `TUX_WHATSAPP_ACCESS_TOKEN`, `TUX_WHATSAPP_APP_SECRET`, or embeds `web.whatsapp.com`; it also asserts Electron `webviewTag: false` remains present.

- [ ] **Step 3: Add CI gates**

Run WhatsApp tests on Linux CI and retain the existing Windows package job. Do not remove any existing security/migration/e2e gate.

- [ ] **Step 4: Run complete local verification**

Run:

```bash
npm run format:check
npm run lint
npm run typecheck
npm test
npm run test:migrations
npm run test:e2e
npm run build
```

Expected: all PASS.

- [ ] **Step 5: Perform real provider acceptance before declaring the subsystem production-ready**

The acceptance document must require these manual checks:

1. Direct customer message appears in TUX.
2. Worker reply reaches WhatsApp exactly once.
3. Delivered/read status updates when provider supplies them.
4. Worker A signs out, Worker B signs in, and later reply attribution changes to Worker B.
5. Known customer/order context opens correct order; multiple orders require worker choice.
6. Voice note/image/document/location render for supported provider events.
7. Internet loss leaves POS fully usable and WhatsApp clearly offline.
8. Reconnect does not duplicate inbound/outbound messages.
9. Provider credentials never appear in installer/renderer/devtools responses.

- [ ] **Step 6: Commit**

```bash
git add e2e/whatsapp-inbox.spec.ts scripts/test-whatsapp-security.mjs package.json .github/workflows/ci.yml docs/WHATSAPP_PRODUCTION_ACCEPTANCE.md
git commit -m "test: gate WhatsApp inbox production behavior"
```

---

## Plan Self-Review Result

- Spec coverage: direct chat, all-worker access, current-worker attribution, Egyptian quick replies, RTL/LTR, Egyptian phone matching, unread/search/history, order context, Send Menu, Create Order from Chat, media, drafts, archive/follow-up, failure isolation, idempotency, and security boundaries are each assigned to a task.
- Explicitly excluded: AI, chatbot, embedded WhatsApp Web, multi-laptop coordination, consumer social features, payment-proof auto-confirmation.
- Type consistency: `normalizeEgyptianPhone`, `OperationsWhatsAppService`, `WhatsAppStore`, `TuxWhatsAppApi`, and `BrowserWhatsAppRemote` are defined before later consumers use them.
- No execution should start until Meta business assets/onboarding strategy is available for real-provider acceptance; fake-provider TDD can proceed without production credentials.
