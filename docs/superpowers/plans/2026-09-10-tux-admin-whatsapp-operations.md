# TUX Admin WhatsApp and Operations Health Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a WhatsApp management/control center and operational-health surfaces without duplicating Operations live customer messaging, while also delivering shop health, device/printer management, opening/closing checklists, and manager logs.

**Architecture:** Reuse the existing TUX WhatsApp implementation and its shop/device/worker/message authority. Operations remains the live reply surface; Admin provides configuration, read-only oversight/history by default, templates, quick replies, event-message rules, analytics, channel assignment, health, and alerts. Operational-health reads aggregate existing device/config/business-day/online-order state into actionable Admin summaries; remote controls remain deliberately limited.

**Tech Stack:** Existing WhatsApp server/Edge-function contracts, TypeScript Admin BFF, React/TanStack Query, Supabase/PostgreSQL, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-10-tux-admin-design.md`

## Global Constraints

- Operations owns live customer conversations and sending authority; Admin does not become a second worker inbox.
- Existing message status/retry rules remain: only explicit FAILED retry; no blind PENDING resend.
- Existing private media and 30-day binary-retention policy remains authoritative.
- Meta/provider secrets stay server-side.
- Real Meta provider acceptance does not block Admin application completion.
- No dangerous remote POS actions such as remote cash-drawer opening or remote order injection.

---

### Task 1: Add WhatsApp Admin configuration, quick-reply, event-message, and analytics schema

**Files:**
- Create: `supabase/migrations/20260910230000_admin_whatsapp_control.sql`
- Create: `scripts/test-admin-whatsapp-control-migration.mjs`
- Modify: `package.json`

**Interfaces:**
- Produces tables: `whatsapp_admin_quick_replies`, `whatsapp_event_message_rules`, `whatsapp_admin_preferences` and reporting views/materialized projections as justified by query cost.
- Existing WhatsApp channel/message/media tables remain canonical and are extended rather than replaced.

- [ ] **Step 1: Write the failing migration invariant test**

```js
import fs from 'node:fs';
const sql = fs.readFileSync('supabase/migrations/20260910230000_admin_whatsapp_control.sql', 'utf8').toLowerCase();
for (const name of ['whatsapp_admin_quick_replies','whatsapp_event_message_rules','whatsapp_admin_preferences']) {
  if (!sql.includes(name)) throw new Error(`missing ${name}`);
}
```

- [ ] **Step 2: Run and verify RED**

```bash
node scripts/test-admin-whatsapp-control-migration.mjs
```

Expected: ENOENT before migration creation.

- [ ] **Step 3: Implement shop-safe control schema**

Quick replies support business default plus optional shop override. Event-message rules map canonical order events such as Accepted, Out for Delivery, and Delivered to an approved Meta template and explicit shop/channel scope. Do not duplicate WhatsApp messages/conversations into Admin-specific history tables.

- [ ] **Step 4: Verify WhatsApp migration/security regression suite**

```bash
node scripts/test-admin-whatsapp-control-migration.mjs
npm run test:migrations
npm run test:whatsapp-architecture
npm run test:whatsapp-security
```

Expected: exit `0`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260910230000_admin_whatsapp_control.sql scripts/test-admin-whatsapp-control-migration.mjs package.json
git commit -m "feat(admin): add WhatsApp management schema"
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

Conversation history joins canonical customer/order/worker/shop context and is read-only by default. Template state maps provider statuses to plain English (`Draft`, `Pending Meta Approval`, `Approved`, `Rejected`, `Paused/Disabled`). Safe variables are represented as typed tokens such as `customerFirstName`, `orderNumber`, `orderTotal`, `orderStatus`, `shopName`, `shopPhone`, `storeLocation`; the server renders them from canonical data rather than accepting arbitrary template expressions.

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

Overview shows connection, business number, conversations, unread, failed messages, attention count, response time, template states, and health. Conversation detail links Customer and Order, shows worker attribution and delivery/read/failure status, and does not provide a generic Admin reply composer. Quick Reply editor uses buttons for safe variables. Failed-message UI links back to the conversation and respects explicit FAILED-only retry authority.

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

### Task 4: Connect automatic order-event WhatsApp rules without duplicate sends

**Files:**
- Create: `apps/admin/server/whatsapp/eventMessaging.ts`
- Modify: canonical order status transition server path discovered during execution
- Test: `apps/admin/server/whatsapp/eventMessaging.test.ts`
- Test: `scripts/test-whatsapp-admin-event-idempotency.mjs`

**Interfaces:**
- Produces `handleOrderCommunicationEvent(event)` that resolves shop rule/template/channel/customer and creates one permitted send intent.

- [ ] **Step 1: Write failing duplicate-event test**

```ts
it('creates one outbound intent for duplicate delivery events', async () => {
  await handleOrderCommunicationEvent(event, deps);
  await handleOrderCommunicationEvent(event, deps);
  expect(deps.createOutboundIntent).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: Run and verify RED**

```bash
npx vitest run apps/admin/server/whatsapp/eventMessaging.test.ts
node scripts/test-whatsapp-admin-event-idempotency.mjs
```

Expected: fail before integration exists.

- [ ] **Step 3: Implement policy-safe event messaging**

The handler must require an enabled shop rule, approved template, eligible customer/channel, canonical order event, and deterministic idempotency key derived from order/event/rule version. It must never convert provider uncertainty into a blind duplicate send.

- [ ] **Step 4: Verify full WhatsApp regression gate**

```bash
npx vitest run apps/admin/server/whatsapp/eventMessaging.test.ts
node scripts/test-whatsapp-admin-event-idempotency.mjs
npm run test:whatsapp-architecture
npm run test:whatsapp-security
npm run test:migrations
```

Expected: exit `0`.

- [ ] **Step 5: Commit**

```bash
git add apps/admin/server/whatsapp/eventMessaging.ts scripts/test-whatsapp-admin-event-idempotency.mjs
git commit -m "feat(whatsapp): add idempotent order-event messaging rules"
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
