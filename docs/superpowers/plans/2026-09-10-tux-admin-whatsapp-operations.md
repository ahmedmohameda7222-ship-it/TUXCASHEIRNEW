# TUX Admin WhatsApp and Operations Health Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a WhatsApp management/control center and operational-health surfaces without duplicating Operations live customer messaging, while also delivering shop health, device/printer management, opening/closing checklists, and manager logs.

**Architecture:** Reuse the existing TUX WhatsApp implementation and its shop/device/worker/message authority. Operations remains the live reply surface; Admin provides configuration, read-only oversight/history by default, templates, quick replies, event-message rules, analytics, channel assignment, health, and alerts. Automatic messages are driven by canonical server-side order/delivery events and a durable send-intent queue, never by the Admin browser or a second chat composer. Operational-health reads aggregate existing device/config/business-day/online-order state into actionable Admin summaries; remote controls remain deliberately limited.

**Tech Stack:** Existing WhatsApp server/Edge-function contracts, TypeScript Admin BFF, React/TanStack Query, Supabase/PostgreSQL, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-10-tux-admin-design.md`

## Global Constraints

- Operations owns live customer conversations and worker sending authority; Admin does not become a second worker inbox.
- Existing message status/retry rules remain: only explicit FAILED retry; no blind PENDING resend.
- Existing private media and 30-day binary-retention policy remains authoritative.
- Automatic order-event messages are system-originated and must be distinguishable from worker-originated messages in history/audit.
- Meta/provider secrets stay server-side.
- Real Meta provider acceptance does not block Admin application completion.
- No dangerous remote POS actions such as remote cash-drawer opening or remote order injection.

---

### Task 1: Add WhatsApp Admin configuration, system-message authority, quick replies, event rules, and durable event-send intents

**Files:**
- Create: `supabase/migrations/20260910230000_admin_whatsapp_control.sql`
- Create: `scripts/test-admin-whatsapp-control-migration.mjs`
- Modify: `package.json`

**Interfaces:**
- Produces tables: `whatsapp_admin_quick_replies`, `whatsapp_event_message_rules`, `whatsapp_admin_preferences`, `whatsapp_event_send_intents` and reporting views/materialized projections only where justified by query cost.
- Extends canonical `whatsapp_messages` to represent `WORKER` versus `SYSTEM` outbound origin without fabricating a worker/device identity.
- Existing WhatsApp channel/message/media/conversation tables remain canonical and are extended rather than replaced.
- Installs canonical event-to-intent functions/triggers for eligible order and delivery events.

- [ ] **Step 1: Write the failing migration invariant test**

```js
import fs from 'node:fs';
const sql = fs.readFileSync('supabase/migrations/20260910230000_admin_whatsapp_control.sql', 'utf8').toLowerCase();
for (const name of [
  'whatsapp_admin_quick_replies',
  'whatsapp_event_message_rules',
  'whatsapp_admin_preferences',
  'whatsapp_event_send_intents',
  'sender_kind',
  'enqueue_whatsapp_order_event_intent',
]) {
  if (!sql.includes(name)) throw new Error(`missing ${name}`);
}
```

- [ ] **Step 2: Run and verify RED**

```bash
node scripts/test-admin-whatsapp-control-migration.mjs
```

Expected: ENOENT before migration creation.

- [ ] **Step 3: Implement shop-safe control and system-message schema**

Quick replies support a business default plus optional shop override. Event-message rules map canonical business events to an approved Meta template and explicit shop/channel scope. At minimum support `ORDER_ACCEPTED`, `DELIVERY_OUT_FOR_DELIVERY`, and `DELIVERY_DELIVERED` when the corresponding canonical source event exists.

The migration must alter `whatsapp_messages` so an OUTBOUND row has an explicit `sender_kind in ('WORKER','SYSTEM')`. Existing rows backfill as `WORKER`. `WORKER` messages retain the current requirement for `sent_by_worker_id`, `initiated_by_device_id`, and `initiated_at`; `SYSTEM` messages require both worker/device ids to be null and retain a non-empty deterministic `outbound_intent_key` plus `initiated_at`. Do not fake a worker or device to satisfy the old constraint.

`whatsapp_event_send_intents` stores the canonical source event id/type, shop/order/customer target, rule version, status, deterministic idempotency key, attempts/status metadata, and timestamps. A trigger/function on `public.order_status_events` creates `ORDER_ACCEPTED` intent candidates from canonical `PLACED` events for ONLINE orders. The delivery plan must expose canonical delivery state events; triggers/functions enqueue `DELIVERY_OUT_FOR_DELIVERY` and `DELIVERY_DELIVERED` from those events. Trigger logic only creates a durable candidate; it does not call Meta from PostgreSQL.

Do not duplicate WhatsApp conversations/messages into Admin-specific history tables.

- [ ] **Step 4: Verify WhatsApp migration/security regression suite**

```bash
node scripts/test-admin-whatsapp-control-migration.mjs
npm run test:migrations
npm run test:whatsapp-architecture
npm run test:whatsapp-security
```

Expected: exit `0`, including tests proving legacy WORKER messages remain valid and SYSTEM messages cannot impersonate worker/device attribution.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260910230000_admin_whatsapp_control.sql scripts/test-admin-whatsapp-control-migration.mjs package.json
git commit -m "feat(admin): add WhatsApp management and system-message authority"
```

### Task 2: Implement WhatsApp Admin read/configuration service

**Files:**
- Create: `packages/admin-contracts/src/whatsapp.ts`
- Create: `apps/admin/server/whatsapp/whatsappAdminService.ts`
- Create: `apps/admin/api/admin/whatsapp.ts`
- Test: `apps/admin/server/whatsapp/whatsappAdminService.test.ts`

**Interfaces:**
- Produces `getWhatsAppOverview`, `searchConversationHistory`, `getConversationDetail`, `listTemplates`, `saveQuickReply`, `saveEventMessageRule`, `getWhatsAppHealth`, `getWhatsAppAnalytics`.

- [ ] **Step 1: Write failing authority-boundary test**

```ts
it('does not expose a generic Admin live-send command', () => {
  expect(Object.keys(service)).not.toContain('sendMessage');
  expect(Object.keys(service)).not.toContain('replyToConversation');
});
```

- [ ] **Step 2: Run and verify RED**

```bash
npx vitest run apps/admin/server/whatsapp/whatsappAdminService.test.ts
```

Expected: fail before service exists.

- [ ] **Step 3: Implement oversight/configuration APIs**

Conversation history joins canonical customer/order/worker/shop context and is read-only by default. System messages display as `TUX Automatic`, never as an invented employee. Template state maps provider statuses to plain English (`Draft`, `Pending Meta Approval`, `Approved`, `Rejected`, `Paused/Disabled`). Safe variables are represented as typed tokens such as `customerFirstName`, `orderNumber`, `orderTotal`, `orderStatus`, `shopName`, `shopPhone`, `storeLocation`; the server renders them from canonical data rather than accepting arbitrary template expressions.

- [ ] **Step 4: Verify type/security tests**

```bash
npx vitest run apps/admin/server/whatsapp/whatsappAdminService.test.ts
npm run test:whatsapp-security
npm run typecheck -w @tux/admin
```

Expected: exit `0`.

- [ ] **Step 5: Commit**

```bash
git add packages/admin-contracts/src/whatsapp.ts apps/admin/server/whatsapp apps/admin/api/admin/whatsapp.ts
git commit -m "feat(admin): add WhatsApp control service"
```

### Task 3: Build WhatsApp Admin control-center UI

**Files:**
- Create: `apps/admin/src/whatsapp/WhatsAppPage.tsx`
- Create: `apps/admin/src/whatsapp/ConversationsPage.tsx`
- Create: `apps/admin/src/whatsapp/ConversationDetailPage.tsx`
- Create: `apps/admin/src/whatsapp/TemplatesPage.tsx`
- Create: `apps/admin/src/whatsapp/QuickRepliesPage.tsx`
- Create: `apps/admin/src/whatsapp/AutomaticMessagesPage.tsx`
- Create: `apps/admin/src/whatsapp/AnalyticsPage.tsx`
- Create: `apps/admin/src/whatsapp/ChannelsPage.tsx`
- Create: `apps/admin/src/whatsapp/WhatsAppHealthPage.tsx`
- Test: `apps/admin/src/whatsapp/WhatsAppPage.test.tsx`
- E2E: `e2e/admin-whatsapp.spec.ts`

**Interfaces:**
- Produces Overview, Conversations, Templates, Quick Replies, Automatic Messages, Analytics, Channels, Settings/Health navigation.

- [ ] **Step 1: Write failing disconnected-state test**

```tsx
it('shows a usable not-configured state without blocking Admin', () => {
  render(<WhatsAppPage overview={{ status: 'NOT_CONFIGURED' }} />);
  expect(screen.getByText('Not Configured')).toBeTruthy();
  expect(screen.getByText(/Admin remains available/i)).toBeTruthy();
});
```

- [ ] **Step 2: Run and verify RED**

```bash
npx vitest run apps/admin/src/whatsapp/WhatsAppPage.test.tsx
```

Expected: fail before screens exist.

- [ ] **Step 3: Implement mobile-first WhatsApp management screens**

Overview shows connection, business number, conversations, unread, failed messages, attention count, response time, template states, and health. Conversation detail links Customer and Order, shows worker or `TUX Automatic` attribution and delivery/read/failure status, and does not provide a generic Admin reply composer. Quick Reply editor uses buttons for safe variables. Failed-message UI links back to the conversation and respects explicit FAILED-only retry authority.

- [ ] **Step 4: Verify WhatsApp UI/E2E and existing architecture tests**

```bash
npx vitest run apps/admin/src/whatsapp/WhatsAppPage.test.tsx
npx playwright test e2e/admin-whatsapp.spec.ts
npm run test:whatsapp-architecture
npm run test:whatsapp-security
```

Expected: exit `0`.

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src/whatsapp e2e/admin-whatsapp.spec.ts
git commit -m "feat(admin): add WhatsApp control center UI"
```

### Task 4: Dispatch automatic order/delivery WhatsApp intents without duplicate sends

**Files:**
- Create: `server/whatsappEventMessaging.ts`
- Create: `server/whatsappEventMessaging.test.ts`
- Create: `api/whatsapp-event-dispatch.ts`
- Modify: `server/whatsappOutboundRepository.ts`
- Modify: `server/whatsappOutboundRepository.test.ts`
- Modify: `server/whatsappOutboundProviderGateway.ts` only to expose/reuse the existing approved-template provider call if the current export surface is insufficient; do not duplicate provider logic.
- Create: `scripts/test-whatsapp-admin-event-idempotency.mjs`
- Modify: `vercel.json` only if the existing Operations/backend Vercel cron configuration needs the dispatcher route scheduled.

**Existing canonical event sources:**
- `public.order_status_events` already materializes `PLACED`, `MARKED_DONE`, `DONE_UNDONE`, `CANCELLED`, and `DELIVERY_RETURNED` through the trusted Operations sync gateway.
- `supabase/functions/operations-sync/index.ts` already applies the canonical materialization plan through `ingest_tux_operations_materialization_v1`; do not add direct Meta side effects to this sync request.
- The delivery-domain plan runs before this plan and must materialize durable delivery state events for `OUT_FOR_DELIVERY` and `DELIVERED`.

**Interfaces:**
- Produces `dispatchPendingWhatsAppEventMessages()` that claims durable `whatsapp_event_send_intents`, resolves the current enabled rule/template/channel/customer, renders safe variables, claims one canonical SYSTEM outbound WhatsApp intent, and sends through the existing provider gateway.

- [ ] **Step 1: Write failing duplicate/replay tests**

```ts
it('sends one automatic message for repeated dispatch of the same canonical event', async () => {
  await dispatchPendingWhatsAppEventMessages(deps);
  await dispatchPendingWhatsAppEventMessages(deps);
  expect(deps.provider.sendTemplate).toHaveBeenCalledTimes(1);
});

it('does not blindly resend a claimed PENDING outbound message after provider uncertainty', async () => {
  deps.repository.seedPendingUncertainIntent();
  await dispatchPendingWhatsAppEventMessages(deps);
  expect(deps.provider.sendTemplate).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run and verify RED**

```bash
npx vitest run server/whatsappEventMessaging.test.ts server/whatsappOutboundRepository.test.ts
node scripts/test-whatsapp-admin-event-idempotency.mjs
```

Expected: fail before the system-message dispatcher/repository methods exist.

- [ ] **Step 3: Implement policy-safe server dispatcher**

The dispatcher must run in the existing Operations/backend server environment, not in the Admin browser. Claim due event-intent rows with row locking/lease semantics so concurrent cron invocations cannot send twice. Require an enabled shop rule, approved template, eligible customer phone, valid canonical channel, and deterministic outbound intent key derived from source-event id + rule version. Resolve variables from canonical order/customer/shop data. Create/claim a `SYSTEM` outbound message through the existing repository authority, call the existing approved-template provider gateway, and attach provider message id/status using the same uncertainty rules as worker-originated WhatsApp.

If the provider deterministically rejects the send, mark the outbound message/event intent FAILED and expose it to Admin alerts/history. If the provider outcome is uncertain, leave the outbound message PENDING/uncertain and do not blindly call Meta again. A repeated source event, Operations sync replay, dispatcher retry, or concurrent dispatcher must never create a second customer message for the same event/rule version.

Do not modify `packages/application/src/ordersBoard.ts` to send WhatsApp directly. Its canonical transitions continue to emit/materialize order-status events; the database event-intent boundary keeps customer communication independent from local POS execution and offline sync.

- [ ] **Step 4: Verify full WhatsApp/Operations regression gate**

```bash
npx vitest run server/whatsappEventMessaging.test.ts server/whatsappOutboundRepository.test.ts
node scripts/test-whatsapp-admin-event-idempotency.mjs
npm run test:whatsapp-architecture
npm run test:whatsapp-security
npm run test:migrations
npm test
```

Expected: exit `0`; sync replay and duplicate cron cases produce one send, uncertainty produces no blind resend, and ordinary Operations worker messaging remains unchanged.

- [ ] **Step 5: Commit**

```bash
git add server/whatsappEventMessaging.ts server/whatsappEventMessaging.test.ts api/whatsapp-event-dispatch.ts server/whatsappOutboundRepository.ts server/whatsappOutboundRepository.test.ts server/whatsappOutboundProviderGateway.ts scripts/test-whatsapp-admin-event-idempotency.mjs vercel.json
git commit -m "feat(whatsapp): add idempotent system event messaging"
```

### Task 5: Add shop health, device/printer management, opening/closing checklists, and manager log

**Files:**
- Create: `supabase/migrations/20260911000000_admin_operations_health.sql`
- Create: `packages/admin-contracts/src/operationsHealth.ts`
- Create: `apps/admin/server/operations/healthService.ts`
- Create: `apps/admin/api/admin/operations-health.ts`
- Create: `apps/admin/src/operations/ShopHealthPage.tsx`
- Create: `apps/admin/src/operations/DevicesPage.tsx`
- Create: `apps/admin/src/operations/DeviceDetailPage.tsx`
- Create: `apps/admin/src/operations/PrintersPage.tsx`
- Create: `apps/admin/src/operations/OpeningClosingPage.tsx`
- Create: `apps/admin/src/operations/ManagerLogPage.tsx`
- Test: `apps/admin/server/operations/healthService.test.ts`
- E2E: `e2e/admin-operations-health.spec.ts`

**Interfaces:**
- Produces shop health from Operations device online state, last sync, business day, active worker, configuration version, online-order health, inventory/cash alerts, and WhatsApp status.

- [ ] **Step 1: Write failing health-summary test**

```ts
it('does not mark the shop unhealthy only because WhatsApp is not configured', async () => {
  const health = await buildShopHealth({ ...healthyFixture, whatsapp: { status: 'NOT_CONFIGURED' } });
  expect(health.overall).toBe('HEALTHY');
});
```

- [ ] **Step 2: Run and verify RED**

```bash
npx vitest run apps/admin/server/operations/healthService.test.ts
```

Expected: fail before service exists.

- [ ] **Step 3: Implement actionable health and checklist model**

Device actions are limited to rename, shop reassignment with permission, disable/revoke, enroll, and force configuration refresh. Printer management exposes receipt/kitchen assignment, enable/disable, routing supported by current Operations contracts, and test print. Opening/closing checklists are simple configurable task sets; manager log stores dated shop notes. Do not expose remote cash-drawer opening or remote order creation.

- [ ] **Step 4: Verify E2E and Operations regression**

```bash
npx vitest run apps/admin/server/operations/healthService.test.ts
npx playwright test e2e/admin-operations-health.spec.ts
npm test
```

Expected: exit `0`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260911000000_admin_operations_health.sql packages/admin-contracts/src/operationsHealth.ts apps/admin/server/operations apps/admin/api/admin/operations-health.ts apps/admin/src/operations e2e/admin-operations-health.spec.ts
git commit -m "feat(admin): add operations health and daily checklists"
```
