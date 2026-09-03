# TUX Operations WhatsApp Worker Inbox UI — Task 7 Implementation Plan

> **Execution mode:** Classic ChatGPT only. REQUIRED SUB-SKILL: use `superpowers:executing-plans` and execute task-by-task with reviewer checkpoints. **NO subagents.** Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first worker-facing WhatsApp inbox UI inside TUX Operations on top of the completed Task 1–6 runtime, without changing backend authority, adding media sending, duplicating order logic, or introducing new schema.

**Architecture:** `ActiveShell` owns one `TuxWhatsAppApi` and one UI-level `WhatsAppInboxController`. The controller owns the latest inbox snapshot, unread aggregate, filters/search, selected conversation, refresh scheduling, draft/composer state, and stable send-attempt identity. `WhatsAppWorkspace` is a thin renderer/action surface. The controller polls every 15 seconds only while visible and online, coalesces refreshes, preserves the last good snapshot on errors, and never creates an offline send queue.

**Tech Stack:** TypeScript 6, React 19, Vitest 4, existing TUX Operations CSS/React runtime, existing `TuxWhatsAppApi`, Browser/Electron runtime selected by `createOperationsWhatsAppClient()`.

**Spec:**
- `docs/superpowers/specs/2026-09-03-whatsapp-worker-inbox-ui-design.md`
- Binding correction: `docs/superpowers/specs/2026-09-03-whatsapp-worker-inbox-ui-design-self-review-corrections.md`

**Implementation baseline:** `2a39d9bfaf8622907646294fba8515854d4c3834`

## Global Constraints

- Task 7 consumes the existing nine-method `TuxWhatsAppApi`; it MUST NOT add a tenth method.
- UI MUST NOT send or choose `shopId`, `deviceId`, `businessDayId`, `workerId`, `sentByWorkerId`, `providerPhoneNumberId`, or provider credentials.
- `sendMedia` MUST remain absent.
- No attachment-send button or control that implies media sending is supported.
- IMAGE / DOCUMENT / AUDIO / LOCATION are read-only UI placeholders only in Task 7.
- Quick replies come only from `snapshot.quickReplies.filter(active)`; no hard-coded fallback reply list in React/application code.
- Selecting a quick reply never sends. Empty composer → set reply text. Non-empty composer → append exactly one newline then reply text.
- No Create Order from Chat, Order → WhatsApp, View Order display-number integration, Send Menu, or web-order Review/Accept in Task 7.
- No human order-number search in Task 7.
- No WhatsApp access outside the existing ACTIVE Operations shell.
- No realtime/WebSocket/Supabase subscription path.
- No automatic failed-message replay, reconnect replay, or offline send queue.
- Same unchanged failed text attempt reuses the same `outboundIntentKey`; changing text creates a new attempt/key.
- A successful `loadInbox()` result is treated as usable data; Task 7 MUST NOT infer provider availability from whether the application layer served remote data or cached fallback.
- Network advisory may use only standard renderer online/offline state. It is not provider-status truth.
- On `loadInbox()` error, preserve the last successful snapshot and display only the safe `ApplicationError.message`; never expose or inspect raw `cause` in React.
- Poll every 15 seconds only while visible and online. Pause periodic refresh while hidden or offline. `online` and visibility restoration trigger one coalesced refresh.
- One refresh in flight at a time; multiple concurrent triggers collapse to one active refresh plus at most one pending refresh.
- Use `dir="auto"` for message text; do not implement Arabic-regex direction guessing.
- Keep the existing Orders Menu Edit unsaved-change guard for navigation to WhatsApp.
- Use the existing TUX visual system/system accent color; do not theme the app WhatsApp green.
- No Supabase migration, SQLite migration, IndexedDB migration, package dependency, production config, or deployment.

---

### Task 7A: Add deterministic inbox view-model helpers

**Files:**
- Create: `apps/operations/src/app/whatsappView.ts`
- Create: `apps/operations/src/app/whatsappView.test.ts`

**Interfaces:**
- Consumes: `WhatsAppConversation`, `WhatsAppMessage`, `WhatsAppQuickReply` from `@tux/domain`.
- Produces:
  - `type WhatsAppInboxFilter = 'ALL' | 'UNREAD' | 'FOLLOW_UP' | 'ARCHIVED'`
  - `filterAndSortWhatsAppConversations(...)`
  - `whatsAppConversationLabel(...)`
  - `whatsAppConversationDisplayName(...)`
  - `lastMessagePreview(...)`
  - `sortActiveQuickReplies(...)`
  - `insertQuickReply(...)`
  - `whatsAppMessageKindLabel(...)`
  - `whatsAppStatusLabel(...)`
  - `totalUnreadCount(...)`
  - `formatUnreadBadge(...)`

- [ ] **Step 1: Write the failing view-model tests**

Create tests that import from `./whatsappView` before the module exists and cover these exact semantics:

```ts
import { describe, expect, it } from 'vitest';
import type { WhatsAppConversation, WhatsAppMessage, WhatsAppQuickReply } from '@tux/domain';
import {
  filterAndSortWhatsAppConversations,
  formatUnreadBadge,
  insertQuickReply,
  sortActiveQuickReplies,
  totalUnreadCount,
  whatsAppConversationLabel,
  whatsAppMessageKindLabel,
  whatsAppStatusLabel,
} from './whatsappView';

it('filters ALL to non-archived conversations and sorts newest first deterministically', () => {
  const result = filterAndSortWhatsAppConversations(conversations, messages, 'ALL', '');
  expect(result.map((item) => item.id)).toEqual(['newer', 'older', 'null-last']);
});

it('supports UNREAD, FOLLOW_UP, and ARCHIVED exactly', () => {
  expect(filterAndSortWhatsAppConversations(conversations, messages, 'UNREAD', '').every((c) => !c.archived && c.unreadCount > 0)).toBe(true);
  expect(filterAndSortWhatsAppConversations(conversations, messages, 'FOLLOW_UP', '').every((c) => !c.archived && c.followUp)).toBe(true);
  expect(filterAndSortWhatsAppConversations(conversations, messages, 'ARCHIVED', '').every((c) => c.archived)).toBe(true);
});

it('searches customer name, both phone forms, and loaded message text only', () => {
  expect(filterAndSortWhatsAppConversations(conversations, messages, 'ALL', 'ahmed').map((c) => c.id)).toContain('customer-match');
  expect(filterAndSortWhatsAppConversations(conversations, messages, 'ALL', '010').map((c) => c.id)).toContain('phone-match');
  expect(filterAndSortWhatsAppConversations(conversations, messages, 'ALL', 'العنوان').map((c) => c.id)).toContain('message-match');
});

it.each([
  ['DIRECT', 'Direct WhatsApp'],
  ['WEB_REQUEST', 'Website Order Request'],
  ['ORDER_LINKED', 'Existing Order Chat'],
] as const)('maps %s context without inventing a human order number', (context, expected) => {
  expect(whatsAppConversationLabel({ ...baseConversation, context })).toBe(expected);
});

it('computes unread from non-archived conversations and caps badge presentation only', () => {
  expect(totalUnreadCount(conversations)).toBe(123);
  expect(formatUnreadBadge(0)).toBe(null);
  expect(formatUnreadBadge(12)).toBe('12');
  expect(formatUnreadBadge(123)).toBe('99+');
});

it('uses only active snapshot quick replies and deterministic category/usage ordering', () => {
  const sorted = sortActiveQuickReplies(quickReplies);
  expect(sorted.every((reply) => reply.active)).toBe(true);
  expect(sorted.map((reply) => reply.category)).toEqual([
    'PREPARATION',
    'PREPARATION',
    'DELIVERY',
    'ADDRESS',
    'PAYMENT',
    'DELAY',
    'THANKS',
  ]);
});

it('inserts a quick reply without clearing worker text and never sends by itself', () => {
  expect(insertQuickReply('', 'أوردر حضرتك جاهز.')).toBe('أوردر حضرتك جاهز.');
  expect(insertQuickReply('تمام', 'أوردر حضرتك جاهز.')).toBe('تمام\nأوردر حضرتك جاهز.');
});

it.each([
  ['IMAGE', 'Image message'],
  ['DOCUMENT', 'Document message'],
  ['AUDIO', 'Voice / audio message'],
  ['LOCATION', 'Location message'],
  ['SYSTEM', 'System update'],
] as const)('renders %s as a safe label', (kind, label) => {
  expect(whatsAppMessageKindLabel(kind)).toBe(label);
});

it.each([
  ['PENDING', 'Sending…'],
  ['SENT', 'Sent'],
  ['DELIVERED', 'Delivered'],
  ['READ', 'Read'],
  ['FAILED', 'Failed'],
] as const)('maps %s status deterministically', (status, label) => {
  expect(whatsAppStatusLabel(status)).toBe(label);
});
```

Use local fixture builders in the test file; do not import test fixtures from application/persistence layers.

- [ ] **Step 2: Run RED**

Run:

```bash
npm test -- apps/operations/src/app/whatsappView.test.ts
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND` / cannot resolve `./whatsappView`.

If it fails for a different reason, STOP.

- [ ] **Step 3: Implement the minimal deterministic view-model**

Implement these rules exactly:

```ts
export type WhatsAppInboxFilter = 'ALL' | 'UNREAD' | 'FOLLOW_UP' | 'ARCHIVED';

const QUICK_REPLY_CATEGORY_ORDER = [
  'PREPARATION',
  'DELIVERY',
  'ADDRESS',
  'PAYMENT',
  'DELAY',
  'THANKS',
] as const;

export function insertQuickReply(current: string, reply: string): string {
  return current.length === 0 ? reply : `${current}\n${reply}`;
}
```

Search normalization must:

```ts
value.normalize('NFKC').replace(/\s+/g, ' ').trim().toLocaleLowerCase();
```

Conversation sort must be explicit and deterministic:

1. `lastMessageAt DESC`, null last;
2. display/customer label using `localeCompare`;
3. `id.localeCompare` final tie-break.

Search must inspect only loaded `messages` whose `conversationId` matches and `text !== null`.

`totalUnreadCount()` must ignore archived conversations.

- [ ] **Step 4: Run GREEN**

```bash
npm test -- apps/operations/src/app/whatsappView.test.ts
npm run typecheck -w @tux/operations
```

Expected: PASS.

- [ ] **Step 5: Commit Task 7A separately**

```bash
git add apps/operations/src/app/whatsappView.ts apps/operations/src/app/whatsappView.test.ts
git commit -m "feat: add WhatsApp inbox view model"
```

**Mandatory reviewer checkpoint:** STOP after this commit if any view-model behavior differs from the binding spec.

---

### Task 7B: Add the App-owned WhatsApp inbox controller

**Files:**
- Create: `apps/operations/src/app/whatsappInboxController.ts`
- Create: `apps/operations/src/app/whatsappInboxController.test.ts`

**Interfaces:**
- Consumes: `TuxWhatsAppApi` from `@tux/platform-contracts`, `ApplicationError`, inbox/domain types, Task 7A view helpers.
- Produces:

```ts
export interface WhatsAppInboxUiState {
  readonly snapshot: WhatsAppInboxSnapshot | null;
  readonly visibleConversations: readonly WhatsAppConversation[];
  readonly selectedConversationId: string | null;
  readonly selectedMessages: readonly WhatsAppMessage[];
  readonly filter: WhatsAppInboxFilter;
  readonly search: string;
  readonly totalUnread: number;
  readonly refreshing: boolean;
  readonly networkOffline: boolean;
  readonly lastRefreshedAt: number | null;
  readonly errorMessage: string | null;
  readonly composerText: string;
  readonly sendBusy: boolean;
}

export interface WhatsAppInboxControllerEnvironment {
  readonly nowMs: () => number;
  readonly createIntentKey: () => string;
  readonly setInterval: (callback: () => void, intervalMs: number) => unknown;
  readonly clearInterval: (handle: unknown) => void;
  readonly isDocumentHidden: () => boolean;
  readonly isOnline: () => boolean;
  readonly addVisibilityListener: (listener: () => void) => () => void;
  readonly addOnlineListener: (listener: () => void) => () => void;
  readonly addOfflineListener: (listener: () => void) => () => void;
}

export class WhatsAppInboxController {
  constructor(client: TuxWhatsAppApi, environment: WhatsAppInboxControllerEnvironment);
  getState(): WhatsAppInboxUiState;
  subscribe(listener: (state: WhatsAppInboxUiState) => void): () => void;
  start(): void;
  stop(): void;
  refresh(): Promise<void>;
  onAreaSelected(): void;
  setFilter(filter: WhatsAppInboxFilter): void;
  setSearch(search: string): void;
  selectConversation(conversationId: string): Promise<void>;
  setComposerText(text: string): void;
  insertQuickReply(text: string): void;
  sendCurrentText(): Promise<void>;
  markUnread(conversationId: string): Promise<void>;
  setArchived(conversationId: string, archived: boolean): Promise<void>;
  setFollowUp(conversationId: string, followUp: boolean): Promise<void>;
}
```

- [ ] **Step 1: Write controller RED tests before the module exists**

Cover these behaviors with a fake `TuxWhatsAppApi` and fake environment:

```ts
it('loads immediately on start and publishes unread from the shared snapshot', async () => { ... });
it('polls at 15 seconds only while visible and online', async () => { ... });
it('coalesces simultaneous refresh triggers to one in-flight request plus at most one pending refresh', async () => { ... });
it('preserves the last successful snapshot when a refresh returns an application error', async () => { ... });
it('treats successful loadInbox data as usable without inferring provider availability', async () => { ... });
it('tracks offline advisory from standard network state only', async () => { ... });
it('refreshes once on online and visibility restoration', async () => { ... });
it('keeps selected conversation when still present, otherwise chooses the first visible conversation', async () => { ... });
it('loads per-conversation local draft and messages when selecting a conversation', async () => { ... });
it('inserts quick reply text without invoking sendText', async () => { ... });
it('reuses the same outboundIntentKey when unchanged text is retried after failure', async () => { ... });
it('creates a new outboundIntentKey only after text changes following a failed attempt', async () => { ... });
it('clears text/attempt only after successful send and refreshes', async () => { ... });
it('preserves text after failed or uncertain send', async () => { ... });
it('refreshes after successful markUnread/archive/follow-up mutations', async () => { ... });
it('never schedules automatic send or replay on online event', async () => { ... });
it('stops timers/listeners cleanly', async () => { ... });
```

The fake client must count `sendText` calls and capture `outboundIntentKey`.

- [ ] **Step 2: Run RED**

```bash
npm test -- apps/operations/src/app/whatsappInboxController.test.ts
```

Expected: FAIL because `./whatsappInboxController` does not exist.

If another reason appears, STOP.

- [ ] **Step 3: Implement controller state and subscription first**

Use immutable state replacement and one publish method. Do not expose raw mutable arrays.

Required initial state:

```ts
{
  snapshot: null,
  visibleConversations: [],
  selectedConversationId: null,
  selectedMessages: [],
  filter: 'ALL',
  search: '',
  totalUnread: 0,
  refreshing: false,
  networkOffline: !environment.isOnline(),
  lastRefreshedAt: null,
  errorMessage: null,
  composerText: '',
  sendBusy: false,
}
```

- [ ] **Step 4: Implement single-flight/coalesced refresh**

Use explicit controller fields, not arbitrary sleeps/retries:

```ts
#refreshPromise: Promise<void> | null = null;
#refreshPending = false;
```

Behavior:

- if refresh starts while one is active: set `#refreshPending = true`, await active request, return;
- after active request finishes: if pending and visible+online, clear pending and run exactly one more refresh;
- failed refresh preserves `snapshot` and derives only `errorMessage = result.error.message`;
- never inspect `result.error.cause`;
- successful refresh clears `errorMessage`, recomputes visible conversations/unread, records `lastRefreshedAt`.

- [ ] **Step 5: Implement start/stop polling lifecycle**

`start()`:

- idempotent;
- attach visibility, online, offline listeners;
- schedule 15-second interval;
- trigger initial `refresh()` when online;
- if offline, publish network advisory state and do not remote-refresh until online.

Interval callback:

```ts
if (!environment.isDocumentHidden() && environment.isOnline()) void this.refresh();
```

Visibility listener triggers refresh only when document becomes visible and online.

Online listener clears network advisory and triggers one coalesced refresh.

Offline listener sets `networkOffline = true` only; it must not send/replay anything.

`stop()` removes listeners and interval, idempotently.

- [ ] **Step 6: Implement selection, conversation load, and draft semantics**

On `selectConversation(id)`:

1. set selected ID only if the conversation exists in latest snapshot;
2. call `client.loadConversation(id)`;
3. call `client.getDraft(id)`;
4. publish selected messages and draft text;
5. if either call returns an application error, keep safe existing state and set `errorMessage` to the safe message only.

When refresh/filter/search changes selection:

- keep selected if it still exists in the latest snapshot and is visible;
- otherwise choose first visible;
- if none visible, selected ID becomes null and composer/messages become empty.

Do not mark read/unread merely due to selection.

- [ ] **Step 7: Implement composer/draft + stable intent key**

Controller fields:

```ts
#sendAttempt: {
  readonly conversationId: string;
  readonly text: string;
  readonly outboundIntentKey: string;
} | null = null;
```

`setComposerText(text)`:

- update state;
- if the current attempt exists and its text differs, clear the attempt;
- persist via `client.saveDraft(selectedConversationId, text)` using a deterministic small debounce internal to controller or an injected scheduler if needed for testability;
- draft persistence errors set `errorMessage`, never block POS shell.

`insertQuickReply(replyText)` calls Task 7A `insertQuickReply` and MUST NOT call `sendText`.

`sendCurrentText()`:

- return without sending if no selected conversation, send busy, or `composerText.trim().length === 0`;
- create an attempt only when no matching current attempt exists;
- call:

```ts
client.sendText({
  conversationId,
  text,
  outboundIntentKey,
});
```

- failure: preserve text + attempt key, expose safe error message, no automatic retry;
- success: clear text + attempt, `saveDraft(conversationId, '')`, then one coalesced refresh.

Do not generate an intent key from timestamps or worker IDs. Use injected opaque `createIntentKey()`.

- [ ] **Step 8: Implement explicit conversation mutations**

`markUnread`, `setArchived`, `setFollowUp`:

- call the existing public API only;
- no optimistic durable state assumption;
- success → refresh;
- error → preserve last good snapshot and set safe `errorMessage`.

- [ ] **Step 9: Run controller GREEN**

```bash
npm test -- apps/operations/src/app/whatsappInboxController.test.ts apps/operations/src/app/whatsappView.test.ts
npm run typecheck -w @tux/operations
```

Expected: PASS.

- [ ] **Step 10: Commit Task 7B separately**

```bash
git add apps/operations/src/app/whatsappInboxController.ts apps/operations/src/app/whatsappInboxController.test.ts
git commit -m "feat: add WhatsApp inbox controller"
```

**Mandatory reviewer checkpoint:** STOP if refresh coalescing, offline behavior, intent-key reuse, or safe-error behavior diverges from the spec.

---

### Task 7C: Build the thin WhatsApp workspace UI

**Files:**
- Create: `apps/operations/src/app/WhatsAppWorkspace.tsx`
- Create: `apps/operations/src/app/WhatsAppWorkspace.test.tsx`
- Modify: `apps/operations/src/styles/global.css`
- Modify: `apps/operations/src/app/icons.tsx` only if a WhatsApp/nav icon is actually needed by the existing icon pattern.

**Interfaces:**
- Consumes: `WhatsAppInboxController`, `WhatsAppInboxUiState`, Task 7A labels/helpers.
- Produces:

```ts
export interface WhatsAppWorkspaceProps {
  readonly controller: WhatsAppInboxController;
  readonly state: WhatsAppInboxUiState;
}
```

No current-worker prop is allowed.

- [ ] **Step 1: Write component RED tests before creating the component**

Cover all of these:

```ts
it('renders a two-pane conversation rail and active conversation panel', () => { ... });
it('renders All / Unread / Follow-up / Archived filters', () => { ... });
it('renders search and delegates query changes to controller', () => { ... });
it('renders Direct WhatsApp / Website Order Request / Existing Order Chat labels', () => { ... });
it('never renders a raw linked-order UUID as an Order # label', () => { ... });
it('renders inbound/outbound bubbles and uses dir="auto" on message text', () => { ... });
it('renders safe placeholders for image/document/audio/location without fetching media', () => { ... });
it('renders outbound PENDING/SENT/DELIVERED/READ/FAILED state', () => { ... });
it('renders only active snapshot quick replies and selection never calls sendText', () => { ... });
it('appends quick reply after one newline when composer already has text', () => { ... });
it('renders no attachment-send or sendMedia affordance', () => { ... });
it('disables Send for blank composer or while sendBusy', () => { ... });
it('renders network advisory only from state.networkOffline', () => { ... });
it('renders safe errorMessage without raw error/cause detail', () => { ... });
it('invokes explicit markUnread, archive/unarchive, and follow-up actions', () => { ... });
```

Use a fake controller object exposing only methods the component needs; do not instantiate the real polling controller in component tests.

- [ ] **Step 2: Run RED**

```bash
npm test -- apps/operations/src/app/WhatsAppWorkspace.test.tsx
```

Expected: FAIL because `./WhatsAppWorkspace` does not exist.

- [ ] **Step 3: Implement the workspace structure**

Required semantic structure:

```tsx
<section className="whatsapp-workspace" aria-label="WhatsApp inbox">
  <aside className="whatsapp-conversation-rail">...</aside>
  <section className="whatsapp-conversation-panel">...</section>
</section>
```

Conversation rail contains:

- heading/status row;
- local search input;
- four filter buttons;
- conversation rows.

Active panel contains:

- customer/display phone/context header;
- follow-up + archive controls;
- scrollable message history;
- active quick replies;
- textarea composer;
- explicit Send button.

No order actions in Task 7.

- [ ] **Step 4: Implement message rendering safely**

For TEXT:

```tsx
<p dir="auto" className="whatsapp-message-text">{message.text}</p>
```

For non-text kinds use safe labels from Task 7A. Do not render `mediaRef` as a provider URL, image `src`, download URL, or audio `src` in Task 7.

SYSTEM messages render visually distinct and are not presented as customer outbound content.

- [ ] **Step 5: Implement quick replies and composer**

Quick reply buttons invoke:

```ts
controller.insertQuickReply(reply.text)
```

Never call `sendText` directly from the component.

Textarea invokes `controller.setComposerText(value)`.

Send invokes only:

```ts
void controller.sendCurrentText();
```

The component must not create its own outbound intent key.

- [ ] **Step 6: Implement CSS within existing TUX visual system**

Use existing CSS variables/accent palette. Required layout behaviors:

- desktop-first two-pane grid;
- conversation rail has bounded width and independent scrolling;
- message panel flexes to available width;
- inbound/outbound bubble alignment distinct;
- `.whatsapp-message-text { unicode-bidi: plaintext; overflow-wrap: anywhere; }` with `dir="auto"` on element;
- clear unread/follow-up indicators;
- compact `99+` nav-compatible badge class can be reused by App later;
- dark/light/system accent compatibility through existing variables;
- no hard-coded WhatsApp green theme.

Do not redesign unrelated Orders/Operations CSS.

- [ ] **Step 7: Run component GREEN**

```bash
npm test -- apps/operations/src/app/WhatsAppWorkspace.test.tsx apps/operations/src/app/whatsappView.test.ts
npm run typecheck -w @tux/operations
```

Expected: PASS.

- [ ] **Step 8: Commit Task 7C separately**

```bash
git add apps/operations/src/app/WhatsAppWorkspace.tsx apps/operations/src/app/WhatsAppWorkspace.test.tsx apps/operations/src/styles/global.css
# add apps/operations/src/app/icons.tsx only if actually changed
git commit -m "feat: add WhatsApp inbox workspace"
```

**Mandatory reviewer checkpoint:** STOP if the workspace introduces current-worker authority, hard-coded quick replies, media fetch/send, or order logic.

---

### Task 7D: Integrate WhatsApp into the ACTIVE Operations shell and shared nav unread state

**Files:**
- Modify: `apps/operations/src/app/App.tsx`
- Create: `apps/operations/src/app/App.whatsapp.test.tsx`

**Interfaces:**
- Consumes: `createOperationsWhatsAppClient()`, `WhatsAppInboxController`, `WhatsAppWorkspace`, `formatUnreadBadge()`.
- Produces: WhatsApp navigation destination and App-owned controller lifecycle.

- [ ] **Step 1: Write shell integration RED tests**

The test must prove:

```ts
it('renders navigation in Orders, Orders Board, WhatsApp, Expenses, Bulk Stock order', () => { ... });
it('shows unread badge from the shared controller while Orders is active', () => { ... });
it('passes navigation to WhatsApp through the existing protected transition guard', () => { ... });
it('renders WhatsAppWorkspace only when WHATSAPP is selected', () => { ... });
it('calls controller.onAreaSelected when WhatsApp becomes active', () => { ... });
it('starts one controller for the ACTIVE shell and stops it on unmount', () => { ... });
it('does not expose WhatsApp in non-ACTIVE entry/greeting states', () => { ... });
it('keeps Orders shell usable when WhatsApp controller publishes an error', () => { ... });
```

Mock `createOperationsWhatsAppClient`, `WhatsAppInboxController`, and `WhatsAppWorkspace` at module boundaries. Do not make these tests depend on real polling timers.

- [ ] **Step 2: Run RED**

```bash
npm test -- apps/operations/src/app/App.whatsapp.test.tsx
```

Expected: FAIL because WhatsApp is not yet an `OperationsArea` / no integration exists.

The RED must be a product integration failure, not a broken unrelated existing App fixture. If unrelated test harness failures appear, STOP.

- [ ] **Step 3: Add the WhatsApp client/controller exactly once per ACTIVE shell**

In `ActiveShell`, create the public client once:

```ts
const whatsappClient = useMemo(() => createOperationsWhatsAppClient(), []);
```

Create environment adapter once around browser/renderer primitives:

```ts
const whatsappController = useMemo(
  () => new WhatsAppInboxController(whatsappClient, createBrowserWhatsAppInboxEnvironment()),
  [whatsappClient],
);
```

The environment helper may live in `whatsappInboxController.ts` only if it stays presentation/runtime-only and testable. If a separate file is cleaner, STOP and report before expanding file scope rather than silently adding it.

Subscribe in `ActiveShell`:

```ts
const [whatsappState, setWhatsAppState] = useState(() => whatsappController.getState());

useEffect(() => whatsappController.subscribe(setWhatsAppState), [whatsappController]);
useEffect(() => {
  whatsappController.start();
  return () => whatsappController.stop();
}, [whatsappController]);
```

Do not create a controller per navigation click.

- [ ] **Step 4: Extend OperationsArea and navigation**

Change:

```ts
type OperationsArea = 'ORDERS' | 'ORDERS_BOARD' | 'EXPENSES' | 'BULK_STOCK';
```

to:

```ts
type OperationsArea = 'ORDERS' | 'ORDERS_BOARD' | 'WHATSAPP' | 'EXPENSES' | 'BULK_STOCK';
```

Insert the button after Orders Board.

Use the same `requestProtectedTransition(() => setArea('WHATSAPP'))` path used by protected navigation away from Orders.

Unread presentation:

```tsx
const unreadBadge = formatUnreadBadge(whatsappState.totalUnread);
```

Render badge only when non-null.

- [ ] **Step 5: Render workspace and area-selection refresh**

When `area` becomes `WHATSAPP`, call `whatsappController.onAreaSelected()` from an effect keyed to `area` and controller. Do not call it during render.

Render:

```tsx
<WhatsAppWorkspace controller={whatsappController} state={whatsappState} />
```

only for `WHATSAPP`.

Preserve all existing Orders/Orders Board/Expenses/Bulk Stock behavior.

- [ ] **Step 6: Verify protected-navigation behavior**

The App integration tests must cover an Orders Menu Edit dirty state where clicking WhatsApp opens the existing discard/keep-editing guard rather than switching immediately.

No new guard implementation is allowed.

- [ ] **Step 7: Run shell GREEN**

```bash
npm test -- \
  apps/operations/src/app/App.whatsapp.test.tsx \
  apps/operations/src/app/WhatsAppWorkspace.test.tsx \
  apps/operations/src/app/whatsappInboxController.test.ts \
  apps/operations/src/app/whatsappView.test.ts

npm run typecheck -w @tux/operations
```

Expected: PASS.

- [ ] **Step 8: Commit Task 7D separately**

```bash
git add apps/operations/src/app/App.tsx apps/operations/src/app/App.whatsapp.test.tsx
git commit -m "feat: add WhatsApp to Operations navigation"
```

**Mandatory reviewer checkpoint:** STOP after 7D. Do not continue if nav unread, protected transitions, ACTIVE-shell scope, or controller lifetime are wrong.

---

### Task 7E: Final Task 7 regression/security verification

**Files:**
- No production files should be needed.
- Temporary diagnostic verification workflow, if required, MUST stay on a diagnostic branch and MUST NOT enter the permanent Task 7 ancestry.

**Interfaces:**
- Consumes all Task 7A–7D changes.
- Produces audit evidence only.

- [ ] **Step 1: Run focused Task 7 suites fresh from permanent candidate HEAD**

```bash
npm test -- \
  apps/operations/src/app/whatsappView.test.ts \
  apps/operations/src/app/whatsappInboxController.test.ts \
  apps/operations/src/app/WhatsAppWorkspace.test.tsx \
  apps/operations/src/app/App.whatsapp.test.tsx \
  apps/operations/src/app/sessionClient.whatsapp.test.ts \
  packages/application/src/whatsapp.test.ts \
  packages/application/src/whatsappWire.test.ts
```

Expected: all PASS.

Record exact file/test counts.

- [ ] **Step 2: Run existing Task 6/runtime regression suites**

```bash
npm test -- \
  apps/operations/src/app/browserWhatsAppRemote.test.ts \
  server/operationsDeviceAuthority.test.ts \
  server/whatsappOperationsGateway.test.ts \
  apps/operations-desktop/src/main/desktopWhatsAppRemote.test.ts \
  apps/operations-desktop/src/main/whatsappIpc.test.ts \
  apps/operations-desktop/src/preload/whatsappResult.test.ts \
  apps/operations-desktop/src/main/security.test.ts \
  apps/operations-desktop/src/main/session.integration.test.ts \
  apps/operations-desktop/src/preload/sessionResult.test.ts
```

Expected: all PASS.

- [ ] **Step 3: Run architecture and repository gates**

```bash
npm run test:whatsapp-architecture
npm run typecheck
npm run lint
npm run format:check
npm run test:migrations
```

Expected: all PASS.

- [ ] **Step 4: Prove no forbidden Task 7 scope expansion**

Run negative source checks:

```bash
if git grep -n "sendMedia" -- \
  apps/operations/src/app/WhatsAppWorkspace.tsx \
  apps/operations/src/app/whatsappInboxController.ts \
  apps/operations/src/app/whatsappView.ts; then
  echo 'Task 7 must not expose sendMedia.' >&2
  exit 1
fi

if git grep -n "graph.facebook.com\|TUX_WHATSAPP_ACCESS_TOKEN\|TUX_WHATSAPP_APP_SECRET\|SUPABASE_SERVICE_ROLE_KEY\|TUX_SUPABASE_SERVICE_ROLE_KEY\|providerPhoneNumberId" -- \
  apps/operations/src/app/WhatsAppWorkspace.tsx \
  apps/operations/src/app/whatsappInboxController.ts \
  apps/operations/src/app/whatsappView.ts \
  apps/operations/src/app/App.tsx; then
  echo 'Privileged/provider authority leaked into Task 7 UI.' >&2
  exit 1
fi
```

Run a scoped semantic guard for hard-coded quick replies: the Task 7 production files MUST NOT contain the approved Egyptian default reply strings from the old plan. The test fixtures may use isolated Arabic samples, but production source cannot seed a fallback list.

Also prove no attachment-send affordance was added by asserting the workspace component does not contain an input/button with upload/file/send-media semantics.

- [ ] **Step 5: Prove database/migration immutability**

```bash
git diff --exit-code 2a39d9bfaf8622907646294fba8515854d4c3834 -- \
  supabase/migrations \
  packages/persistence/src/sqlite/migrations.ts \
  packages/persistence/src/browser/indexedDbMigrations.ts
```

Expected: NO OUTPUT.

No database migration is authorized in Task 7.

- [ ] **Step 6: Prove package/dependency immutability**

```bash
git diff --exit-code 2a39d9bfaf8622907646294fba8515854d4c3834 -- \
  package-lock.json \
  apps/operations/package.json \
  apps/operations-desktop/package.json
```

Expected: NO OUTPUT.

If an existing formatting tool rewrites a manifest unexpectedly, STOP and diagnose; do not commit dependency drift.

- [ ] **Step 7: Prove permanent source scope**

The permanent Task 7 diff from baseline may contain only:

```text
apps/operations/src/app/whatsappView.ts
apps/operations/src/app/whatsappView.test.ts
apps/operations/src/app/whatsappInboxController.ts
apps/operations/src/app/whatsappInboxController.test.ts
apps/operations/src/app/WhatsAppWorkspace.tsx
apps/operations/src/app/WhatsAppWorkspace.test.tsx
apps/operations/src/app/App.tsx
apps/operations/src/app/App.whatsapp.test.tsx
apps/operations/src/styles/global.css
apps/operations/src/app/icons.tsx   # only if actually needed
```

No `.github/workflows/*` file may appear in permanent Task 7 ancestry.

If an additional source file is genuinely required, STOP before committing it and return exact evidence to Planner/Auditor.

- [ ] **Step 8: Verify working tree clean**

```bash
git status --short
```

Expected: NO OUTPUT.

- [ ] **Step 9: STOP before Task 8**

Do NOT start:

- order/customer context;
- Create Order from Chat;
- Order → WhatsApp;
- Send Menu;
- media upload/send;
- Windows notifications;
- production configuration/deployment.

Return the evidence below to Planner/Auditor.

---

## Final Task 7 Report Format

```text
TASK 7 COMPLETE

Baseline:
2a39d9bfaf8622907646294fba8515854d4c3834

7A View Model:
- RED command/result
- GREEN command/result
- test count
- commit SHA

7B Controller:
- RED command/result
- GREEN command/result
- initial load test PASS/FAIL
- 15s visible-only polling PASS/FAIL
- single-flight/coalescing PASS/FAIL
- hidden/offline pause PASS/FAIL
- online/visibility refresh PASS/FAIL
- last-good snapshot preservation PASS/FAIL
- safe ApplicationError.message only PASS/FAIL
- stable unchanged retry intent key PASS/FAIL
- changed text creates new attempt PASS/FAIL
- no automatic replay PASS/FAIL
- commit SHA

7C Workspace:
- RED command/result
- GREEN command/result
- two-pane layout PASS/FAIL
- dir=auto PASS/FAIL
- quick replies from snapshot only PASS/FAIL
- quick-reply empty/non-empty insertion PASS/FAIL
- selection sends zero messages PASS/FAIL
- media placeholders PASS/FAIL
- sendMedia/attachment control absent PASS/FAIL
- status rendering PASS/FAIL
- commit SHA

7D App Integration:
- RED command/result
- GREEN command/result
- nav order PASS/FAIL
- unread visible outside WhatsApp PASS/FAIL
- protected Menu Edit transition PASS/FAIL
- one controller per ACTIVE shell PASS/FAIL
- controller start/stop PASS/FAIL
- WhatsApp absent outside ACTIVE shell PASS/FAIL
- POS shell remains usable on WhatsApp error PASS/FAIL
- commit SHA

7E Final Verification:
- focused files/tests passed
- Task 6/runtime regression files/tests passed
- npm run test:whatsapp-architecture PASS/FAIL
- npm run typecheck PASS/FAIL
- npm run lint PASS/FAIL
- npm run format:check PASS/FAIL
- npm run test:migrations PASS/FAIL
- forbidden provider/secret scan PASS/FAIL
- sendMedia absent PASS/FAIL
- hard-coded production quick-reply fallback absent PASS/FAIL
- attachment-send control absent PASS/FAIL
- migrations unchanged YES/NO
- package manifests/lock unchanged YES/NO
- permanent source scope PASS/FAIL

Repository:
- branch
- final HEAD
- exact permanent changed files
- git status --short
- working tree clean YES/NO

Production:
- Supabase mutation NO
- whatsapp_channels mutation NO
- Meta configuration NO
- Vercel env change NO
- Vercel deployment NO
- Windows release NO

STOPPED BEFORE TASK 8: YES
```

---

## Plan Self-Review Result

### Spec coverage

Covered explicitly:

- App-owned single controller;
- nav unread outside workspace;
- ACTIVE-shell scope;
- existing protected navigation guard;
- visible-only 15-second polling;
- single-flight/coalescing;
- standard online/offline advisory only;
- no provider-status inference from successful cached fallback;
- last-good snapshot preservation;
- safe application error presentation;
- deterministic filters/sort/search;
- no human order-number search;
- context labels without raw UUID-as-order-number;
- native `dir="auto"` bidi handling;
- text/media placeholder rendering;
- canonical snapshot quick replies only;
- deterministic quick-reply insertion;
- persistent local draft API use;
- stable send-attempt idempotency key;
- no replay/offline queue;
- explicit archive/unarchive/follow-up/mark-unread;
- no `sendMedia` / attachment-send affordance;
- Task 8 order-context exclusions;
- zero migration/dependency/production mutation.

### Placeholder scan

No `TBD`, `TODO`, "similar to", or unspecified "handle edge cases" instructions are permitted in this plan.

### Type consistency

The plan consumes only the already-established public `TuxWhatsAppApi` methods and existing domain/application snapshot/error types. The UI never introduces a worker/shop authority DTO. `WhatsAppWorkspace` receives controller/state only. The controller owns outbound intent-key generation and calls the existing `sendText({ conversationId, text, outboundIntentKey })` public method exactly.

### Reviewer stop boundary

After Task 7 final verification, execution MUST stop before Task 8.
