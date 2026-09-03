# TUX Operations WhatsApp Inbox Task 5 Amendment

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` for Classic ChatGPT execution. This amendment supersedes **only Task 5** of `docs/superpowers/plans/2026-09-02-tux-operations-whatsapp-inbox.md`. Tasks 1-4 are not redone. After Task 5 completes, stop for the Task 6 pre-implementation audit.

**Goal:** Add the provider-agnostic WhatsApp application service and durable local cache on SQLite and IndexedDB while consuming the final authenticated Task 4 remote contract exactly.

**Architecture:** The application service consumes the existing Operations session state as the local Current Operator source; it never invents WhatsApp worker identity. Reads may cache the authenticated-shop inbox, while worker-attributed mutations require an `ACTIVE` Operations session and send the current `businessDayId` plus `workerId` as claims to the Task 4 `WhatsAppRemoteGateway`. The local cache is a projection/cache only: remote/provider truth stays authoritative, drafts are local durable state, and no local cache write may create a second outbound provider send.

**Tech Stack:** TypeScript 6, Vitest 4, Node `node:sqlite`, IndexedDB/fake-indexeddb, existing TUX domain/application/persistence packages.

**Specs:**
- `docs/superpowers/specs/2026-09-02-tux-operations-whatsapp-inbox-design.md`
- `docs/superpowers/specs/2026-09-02-whatsapp-current-operator-authority-design.md`
- `docs/superpowers/specs/2026-09-02-whatsapp-channel-tenant-resolution-design.md`

## Preconditions

Permanent Task 4 implementation branch:

```text
feat/operations-whatsapp-inbox
```

Approved Task 4 HEAD:

```text
da87bb3dc7c7d77b92240f4ff4c109b7ad0d2642
```

Before Task 5 RED, verify the permanent Task 4 contract still exposes:

```ts
export interface WhatsAppRemoteGateway {
  loadInbox(cursor?: string): Promise<WhatsAppInboxSnapshot>;

  sendText(input: {
    readonly businessDayId: BusinessDayId;
    readonly workerId: WorkerId;
    readonly conversationId: string;
    readonly outboundIntentKey: string;
    readonly text: string;
  }): Promise<WhatsAppMessage>;

  markUnread(conversationId: string): Promise<void>;
  archive(conversationId: string, archived?: boolean): Promise<void>;
  setFollowUp(conversationId: string, followUp: boolean): Promise<void>;

  linkOrder(input: {
    readonly businessDayId: BusinessDayId;
    readonly workerId: WorkerId;
    readonly conversationId: string;
    readonly orderId: OrderId;
    readonly linked?: boolean;
  }): Promise<void>;
}
```

If that interface materially differs, **STOP before Task 5 RED** with evidence.

## Binding corrections to the original Task 5

The original Task 5 examples are stale in four places. These corrections are binding:

1. Call `remote.sendText(...)`, not `remote.sendMessage(...)`.
2. Pass `workerId`, not `sentByWorkerId`; server-side durable attribution remains authoritative.
3. Pass `businessDayId` together with `workerId` from the current local `ACTIVE` Operations session.
4. Do **not** add `sendMedia` in Task 5. Task 4 intentionally supports outbound TEXT only. Media sending remains deferred to the later media task; Task 5 may cache inbound media metadata already present in `WhatsAppMessage`.

Do not modify Task 4 server authority or make renderer/client identity authoritative to satisfy old examples.

## Global constraints

- Do not redo or weaken Tasks 1-4.
- Do not modify the three production WhatsApp Supabase migrations.
- No new Supabase migration is required by Task 5; this task changes device-local persistence only.
- Do not call Meta directly from application/persistence code.
- No service-role or Meta credential may enter application/persistence/browser cache code.
- Local cache failure must not manufacture a second send. After `remote.sendText` returns a message, a cache-write failure returns a local persistence error while preserving the remote send result only as cause/diagnostic; retry behavior remains governed by the same caller-provided `outboundIntentKey` and Task 4 server idempotency.
- Remote delivery uncertainty remains remote authority; Task 5 must not convert uncertainty into a fresh intent key or automatic resend.
- Draft text is local-only and never auto-sent.
- Snapshot upsert is idempotent by durable remote IDs.
- Cached records are fenced by `shopId`; a device that later activates another shop must not read the previous shop's WhatsApp cache through the new shop context.
- Keep provider-specific logic out of `@tux/application` and `@tux/persistence`.

---

## Task 5A — Define the local WhatsApp cache contract

**Files:**
- Create: `packages/persistence/src/whatsappStore.ts`
- Modify: `packages/persistence/src/index.ts`
- Create: `packages/persistence/src/whatsappStore.test.ts`

**Consumes:**
- `WhatsAppInboxSnapshot`, `WhatsAppInboxOrderLink` from `@tux/application`.
- `ShopId`, `Instant`, `WhatsAppConversation`, `WhatsAppMessage`, `WhatsAppQuickReply` from `@tux/domain`.

**Produces:**

```ts
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
  readonly orderLinks: readonly WhatsAppInboxOrderLink[];
}

export interface WhatsAppStore {
  initialize(): Promise<void>;
  upsertRemoteSnapshot(snapshot: WhatsAppInboxSnapshot): Promise<void>;
  upsertMessage(message: WhatsAppMessage): Promise<void>;
  loadInbox(shopId: ShopId): Promise<CachedWhatsAppInboxSnapshot>;
  listMessages(shopId: ShopId, conversationId: string): Promise<readonly WhatsAppMessage[]>;
  saveDraft(draft: WhatsAppDraft): Promise<void>;
  getDraft(shopId: ShopId, conversationId: string): Promise<WhatsAppDraft | null>;
  close(): Promise<void>;
}
```

### Step 1 — Write contract RED

Create `packages/persistence/src/whatsappStore.test.ts` with a runtime import:

```ts
import { describe, expect, it } from 'vitest';
import { whatsappStoreContractVersion } from './whatsappStore';

describe('WhatsAppStore contract', () => {
  it('exposes the v1 local cache contract marker', () => {
    expect(whatsappStoreContractVersion).toBe(1);
  });
});
```

Do not create `whatsappStore.ts` first.

### Step 2 — Verify RED

Run:

```bash
npm test -- packages/persistence/src/whatsappStore.test.ts
```

Expected: FAIL because `./whatsappStore` does not exist.

### Step 3 — Implement minimal contract

Create `whatsappStore.ts` with the interfaces above and:

```ts
export const whatsappStoreContractVersion = 1 as const;
```

Export it from `packages/persistence/src/index.ts`.

### Step 4 — Verify GREEN

```bash
npm test -- packages/persistence/src/whatsappStore.test.ts
npm run typecheck -w @tux/persistence
```

Expected: PASS.

### Step 5 — Commit

```bash
git add packages/persistence/src/whatsappStore.ts packages/persistence/src/whatsappStore.test.ts packages/persistence/src/index.ts
git commit -m "feat: add WhatsApp local cache contract"
```

Record the SHA.

---

## Task 5B — Add SQLite WhatsApp cache to the existing Operations database

**Files:**
- Modify: `packages/persistence/src/sqlite/migrations.ts`
- Create: `packages/persistence/src/sqlite/SqliteWhatsAppStore.ts`
- Create: `packages/persistence/src/sqlite/SqliteWhatsAppStore.test.ts`
- Modify: `packages/persistence/src/sqlite/index.ts`

**Architecture:** Use the same SQLite file passed to the existing Operations persistence stack. Add an append-only local SQLite schema migration after the current latest local migration. Do not create a second POS database file and do not alter remote Supabase migrations.

### Step 1 — Write RED SQLite tests

Create tests proving:

1. store must be initialized before use;
2. snapshot upsert is idempotent by conversation/message/quick-reply/order-link IDs;
3. later snapshot values replace stale values for the same durable ID;
4. messages list in `createdAt`, then `id` order;
5. `loadInbox(shopA)` cannot return shop B records;
6. draft survives close/reopen of the same SQLite file;
7. draft is fenced by `(shopId, conversationId)`;
8. existing Operations data survives the schema migration.

Use a temporary SQLite file and real `SqliteOperationsDatabase`/`SqliteWhatsAppStore` rather than mocking SQL.

### Step 2 — Verify RED

```bash
npm test -- packages/persistence/src/sqlite/SqliteWhatsAppStore.test.ts
```

Expected: FAIL because `SqliteWhatsAppStore` does not exist and the new local tables are absent.

### Step 3 — Add one local SQLite migration

Append the next sequential version to `SQLITE_MIGRATIONS` in `packages/persistence/src/sqlite/migrations.ts` with name:

```text
whatsapp_local_cache
```

Create these local tables/indexes:

```sql
CREATE TABLE whatsapp_cache_conversations (
  id TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL,
  last_message_at TEXT,
  payload_json TEXT NOT NULL
);
CREATE INDEX idx_whatsapp_cache_conversations_shop_last
  ON whatsapp_cache_conversations(shop_id, last_message_at, id);

CREATE TABLE whatsapp_cache_messages (
  id TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  payload_json TEXT NOT NULL
);
CREATE INDEX idx_whatsapp_cache_messages_conversation_created
  ON whatsapp_cache_messages(shop_id, conversation_id, created_at, id);

CREATE TABLE whatsapp_cache_quick_replies (
  id TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL,
  payload_json TEXT NOT NULL
);
CREATE INDEX idx_whatsapp_cache_quick_replies_shop
  ON whatsapp_cache_quick_replies(shop_id, id);

CREATE TABLE whatsapp_cache_order_links (
  shop_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  order_id TEXT NOT NULL,
  linked_at TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  PRIMARY KEY (shop_id, conversation_id, order_id)
);

CREATE TABLE whatsapp_drafts (
  shop_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  text TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (shop_id, conversation_id)
);
```

Do not add foreign keys from this remote cache projection to local Orders/Workers; cache arrival may precede local projection timing and the remote server already tenant-fences source data.

### Step 4 — Implement `SqliteWhatsAppStore`

Constructor:

```ts
constructor(path: string)
```

Initialization must use the same durable SQLite conventions:

```sql
PRAGMA foreign_keys = ON;
PRAGMA synchronous = FULL;
PRAGMA busy_timeout = 5000;
```

Then call existing `applySqliteMigrations(database)` so a clean install and an upgraded install reach the same local schema.

Every persisted domain payload must be JSON-serialized, parsed back, and validated sufficiently to reject malformed local rows. At minimum call `assertWhatsAppMessageInvariant` for cached messages and validate shop/conversation IDs before returning them.

`upsertRemoteSnapshot` must execute in one `BEGIN IMMEDIATE` transaction and upsert all four remote arrays. It must not delete older messages merely because a paginated snapshot omits them.

`upsertMessage` updates the durable row with the same message ID and does not call any remote gateway.

### Step 5 — Verify SQLite GREEN

```bash
npm test -- packages/persistence/src/sqlite/SqliteWhatsAppStore.test.ts
npm test -- packages/persistence/src/sqlite/SqliteOperationsDatabase.test.ts
npm run typecheck -w @tux/persistence
```

Expected: PASS.

### Step 6 — Commit

```bash
git add packages/persistence/src/sqlite/migrations.ts packages/persistence/src/sqlite/SqliteWhatsAppStore.ts packages/persistence/src/sqlite/SqliteWhatsAppStore.test.ts packages/persistence/src/sqlite/index.ts
git commit -m "feat: add SQLite WhatsApp local cache"
```

Record the SHA.

---

## Task 5C — Add IndexedDB WhatsApp cache through a schema-version bump

**Files:**
- Modify: `packages/persistence/src/browser/indexedDbMigrations.ts`
- Create: `packages/persistence/src/browser/openOperationsIndexedDb.ts`
- Modify: `packages/persistence/src/browser/IndexedDbOperationsDatabase.ts`
- Create: `packages/persistence/src/browser/IndexedDbWhatsAppStore.ts`
- Create: `packages/persistence/src/browser/IndexedDbWhatsAppStore.test.ts`
- Modify: `packages/persistence/src/browser/index.ts`

**Architecture:** Keep WhatsApp cache in the existing `tux-operations-v2` IndexedDB database. Extract only the common database-open/upgrade helper required for both `IndexedDbOperationsDatabase` and `IndexedDbWhatsAppStore`; do not duplicate migration logic or create a second WhatsApp database.

### Step 1 — Write RED browser persistence tests

With `fake-indexeddb`, prove:

1. upgrading a version-4 Operations database preserves an existing non-WhatsApp record;
2. the new version creates deterministic WhatsApp object stores and indexes;
3. snapshot upsert is idempotent;
4. shop A cannot read shop B cache;
5. messages are ordered by `createdAt`, then `id`;
6. draft survives store close/reopen;
7. draft is fenced by `(shopId, conversationId)`;
8. requesting persistent storage is best-effort and not required for correctness.

### Step 2 — Verify RED

```bash
npm test -- packages/persistence/src/browser/IndexedDbWhatsAppStore.test.ts
```

Expected: FAIL because `IndexedDbWhatsAppStore` and the next schema version do not exist.

### Step 3 — Add IndexedDB migration

Increment:

```ts
INDEXED_DB_VERSION
```

from `4` to `5`.

Append these names to `INDEXED_DB_STORES`:

```text
whatsappConversations
whatsappMessages
whatsappQuickReplies
whatsappOrderLinks
whatsappDrafts
```

Add migration version `5`, name:

```text
whatsapp_local_cache
```

Create stores/indexes:

```ts
const conversations = database.createObjectStore('whatsappConversations', { keyPath: 'id' });
conversations.createIndex('shopLastMessage', ['shopId', 'lastMessageAt', 'id']);

const messages = database.createObjectStore('whatsappMessages', { keyPath: 'id' });
messages.createIndex('shopConversationCreated', ['shopId', 'conversationId', 'createdAt', 'id']);

const quickReplies = database.createObjectStore('whatsappQuickReplies', { keyPath: 'id' });
quickReplies.createIndex('shopId', 'shopId');

const orderLinks = database.createObjectStore('whatsappOrderLinks', {
  keyPath: ['shopId', 'conversationId', 'orderId'],
});
orderLinks.createIndex('shopConversation', ['shopId', 'conversationId']);

const drafts = database.createObjectStore('whatsappDrafts', {
  keyPath: ['shopId', 'conversationId'],
});
```

Do not delete or recreate existing object stores during upgrade.

### Step 4 — Extract one shared IndexedDB opener

Create `openOperationsIndexedDb.ts` that opens a supplied database name using `INDEXED_DB_VERSION` and `applyIndexedDbMigrations`.

Refactor `IndexedDbOperationsDatabase` to call this helper without changing its public behavior.

`IndexedDbWhatsAppStore` uses the same helper and defaults to database name:

```text
tux-operations-v2
```

### Step 5 — Implement `IndexedDbWhatsAppStore`

Use strict readwrite durability where supported by the current repository pattern. `upsertRemoteSnapshot` writes all snapshot components in one transaction. Do not delete historical messages just because a page omits them.

### Step 6 — Verify IndexedDB GREEN

```bash
npm test -- packages/persistence/src/browser/IndexedDbWhatsAppStore.test.ts
npm test -- packages/persistence/src/browser/IndexedDbOperationsDatabase.test.ts
npm run typecheck -w @tux/persistence
```

Expected: PASS.

### Step 7 — Commit

```bash
git add packages/persistence/src/browser/indexedDbMigrations.ts packages/persistence/src/browser/openOperationsIndexedDb.ts packages/persistence/src/browser/IndexedDbOperationsDatabase.ts packages/persistence/src/browser/IndexedDbWhatsAppStore.ts packages/persistence/src/browser/IndexedDbWhatsAppStore.test.ts packages/persistence/src/browser/index.ts
git commit -m "feat: add IndexedDB WhatsApp local cache"
```

Record the SHA.

---

## Task 5D — Add the Operations WhatsApp application service against the final Task 4 contract

**Files:**
- Create: `packages/application/src/whatsapp.ts`
- Create: `packages/application/src/whatsapp.test.ts`
- Modify: `packages/application/src/whatsappRemote.ts`
- Modify: `packages/application/src/index.ts`
- Modify: `apps/operations/src/app/browserWhatsAppRemote.ts`
- Modify: `apps/operations/src/app/browserWhatsAppRemote.test.ts`

**Consumes:**
- `WhatsAppRemoteGateway` from Task 4.
- `WhatsAppStore` from Task 5A-C.
- Existing `OperationsSessionService.getState()` semantics.

**Produces:**

```ts
export interface WhatsAppSessionStateSource {
  getState(): Promise<OperationsSessionResult>;
}

export class OperationsWhatsAppService {
  loadInbox(cursor?: string): Promise<Result<WhatsAppInboxSnapshot, ApplicationError>>;
  loadConversation(conversationId: string): Promise<Result<readonly WhatsAppMessage[], ApplicationError>>;
  sendText(input: {
    readonly conversationId: string;
    readonly text: string;
    readonly outboundIntentKey: string;
  }): Promise<Result<WhatsAppMessage, ApplicationError>>;
  markUnread(conversationId: string): Promise<Result<void, ApplicationError>>;
  archive(conversationId: string, archived?: boolean): Promise<Result<void, ApplicationError>>;
  setFollowUp(conversationId: string, followUp: boolean): Promise<Result<void, ApplicationError>>;
  linkOrder(input: {
    readonly conversationId: string;
    readonly orderId: OrderId;
    readonly linked?: boolean;
  }): Promise<Result<void, ApplicationError>>;
  saveDraft(conversationId: string, text: string): Promise<Result<void, ApplicationError>>;
  getDraft(conversationId: string): Promise<Result<WhatsAppDraft | null, ApplicationError>>;
}
```

No `sendMedia` method is added in Task 5.

### Step 1 — Centralize provider-agnostic remote error codes

The current browser implementation defines typed remote errors inside the renderer module. Task 5 application logic must not import renderer modules.

Add to `packages/application/src/whatsappRemote.ts`:

```ts
export type WhatsAppRemoteErrorCode =
  | 'OPERATOR_NOT_SYNCHRONIZED'
  | 'OUTBOUND_INTENT_CONFLICT'
  | 'DELIVERY_UNCERTAIN'
  | 'REMOTE_UNAVAILABLE';

export class WhatsAppRemoteError extends Error {
  constructor(
    readonly code: WhatsAppRemoteErrorCode,
    message: string,
    readonly messageId: string | null = null,
  ) {
    super(message);
    this.name = 'WhatsAppRemoteError';
  }
}
```

Update `VercelBrowserWhatsAppRemote` to throw this shared error rather than renderer-private error classes. Keep the same safe messages and status mapping; do not expose provider/server diagnostics.

### Step 2 — Write application RED tests

Create `packages/application/src/whatsapp.test.ts` and import `OperationsWhatsAppService` at runtime before `whatsapp.ts` exists.

Required RED behaviors:

1. `ACTIVE` state forwards exact current claims:

```ts
expect(remote.sendText).toHaveBeenCalledWith({
  businessDayId: active.businessDayId,
  workerId: active.operator.id,
  conversationId,
  outboundIntentKey: 'intent-1',
  text: 'تمام',
});
```

2. `SIGN_IN_REQUIRED`, `NO_ACTIVE_DAY`, or `CONFIGURATION_REQUIRED` -> `CONFLICT_ERROR`, no remote send.
3. `OPERATOR_NOT_SYNCHRONIZED` -> `CONFLICT_ERROR`; service does not alter worker identity or retry with another worker.
4. `OUTBOUND_INTENT_CONFLICT` -> `CONFLICT_ERROR`.
5. `DELIVERY_UNCERTAIN` -> `REMOTE_SYNC_ERROR`; same intent key remains caller-owned and no automatic second remote call occurs.
6. `loadInbox` remote success upserts cache and returns remote snapshot.
7. `loadInbox` remote unavailable returns cached snapshot for the resolved local shop when one exists.
8. successful `sendText` upserts returned message locally exactly once.
9. remote success followed by local cache-write failure -> `LOCAL_PERSISTENCE_ERROR` and **no second remote call**.
10. drafts never invoke `WhatsAppRemoteGateway`.
11. `linkOrder` requires ACTIVE session and forwards `businessDayId + workerId` claims.
12. `markUnread/archive/setFollowUp` do not manufacture worker authority fields; they use their Task 4 methods as defined.

### Step 3 — Verify application RED

```bash
npm test -- packages/application/src/whatsapp.test.ts
```

Expected: FAIL because `./whatsapp` does not exist.

### Step 4 — Implement minimal application service

Resolve the local state through the injected `WhatsAppSessionStateSource` for every worker-attributed mutation at call time. Do not cache worker identity in the service constructor.

A helper may return the active claims only when:

```ts
result.ok && result.value.status === 'ACTIVE'
```

Use:

```ts
{
  businessDayId: result.value.businessDayId,
  workerId: result.value.operator.id,
  shopId: result.value.shopId,
}
```

`shopId` is only for local cache fencing. It is never sent as remote authority.

For `loadInbox`, use any successfully resolved session state carrying a `shopId` to select the local cache; do not infer another shop. The UI decision about exposing Inbox while a Business Day is closed remains outside Task 5.

On remote `loadInbox` success, cache the snapshot. On remote unavailable, return the local cached projection if a shop can be resolved; otherwise return a safe application error.

### Step 5 — Verify application GREEN

```bash
npm test -- packages/application/src/whatsapp.test.ts
npm test -- apps/operations/src/app/browserWhatsAppRemote.test.ts
npm run typecheck -w @tux/application
npm run typecheck -w @tux/operations
```

Expected: PASS.

### Step 6 — Commit

```bash
git add packages/application/src/whatsapp.ts packages/application/src/whatsapp.test.ts packages/application/src/whatsappRemote.ts packages/application/src/index.ts apps/operations/src/app/browserWhatsAppRemote.ts apps/operations/src/app/browserWhatsAppRemote.test.ts
git commit -m "feat: add WhatsApp application service"
```

Record the SHA.

---

## Task 5 final verification

Run fresh from the final permanent Task 5 HEAD:

```bash
npm test -- \
  packages/persistence/src/whatsappStore.test.ts \
  packages/persistence/src/sqlite/SqliteWhatsAppStore.test.ts \
  packages/persistence/src/browser/IndexedDbWhatsAppStore.test.ts \
  packages/application/src/whatsapp.test.ts \
  apps/operations/src/app/browserWhatsAppRemote.test.ts \
  server/whatsappOperationsGateway.test.ts

npm run typecheck
npm run lint
npm run format:check
npm run test:migrations
```

Also verify Tasks 2-4 remote SQL did not change:

```bash
git diff da87bb3dc7c7d77b92240f4ff4c109b7ad0d2642..HEAD -- \
  supabase/migrations/20260902220000_whatsapp_inbox.sql \
  supabase/migrations/20260902223000_whatsapp_channels.sql \
  supabase/migrations/20260902224500_whatsapp_current_worker_authority.sql
```

Expected: no output.

Verify no provider/server secret enters local packages:

```bash
if git grep -n "TUX_WHATSAPP_ACCESS_TOKEN\|TUX_WHATSAPP_APP_SECRET\|TUX_SUPABASE_SERVICE_ROLE_KEY\|SUPABASE_SERVICE_ROLE_KEY" -- packages/application packages/persistence apps/operations; then
  echo "Server/provider secret reference found in local WhatsApp layers." >&2
  exit 1
fi
```

Expected: no matches.

Verify no outbound media API was prematurely added:

```bash
if git grep -n "sendMedia" -- packages/application/src/whatsapp.ts packages/application/src/whatsappRemote.ts; then
  echo "Outbound media was added before the media task." >&2
  exit 1
fi
```

Expected: no matches.

No production Supabase DDL is required for Task 5. The three authorized WhatsApp migrations are already production state; do not reapply them.

## Task 5 completion report

Report:

```text
TASK 5 COMPLETE

Base Task 4 HEAD:
da87bb3dc7c7d77b92240f4ff4c109b7ad0d2642
UNCHANGED

Task 5A contract:
RED command/result
GREEN command/result
commit SHA

Task 5B SQLite:
RED command/result
GREEN commands/results
local SQLite migration version/name
restart persistence result
shop-fencing result
commit SHA

Task 5C IndexedDB:
RED command/result
GREEN commands/results
old version -> new version
upgrade-preservation result
restart persistence result
shop-fencing result
commit SHA

Task 5D application:
RED command/result
GREEN commands/results
ACTIVE current-operator forwarding result
non-ACTIVE no-send result
uncertainty no-auto-resend result
cache-failure no-second-send result
commit SHA

Final focused tests:
<counts>

npm run typecheck:
PASS/FAIL

npm run lint:
PASS/FAIL

npm run format:check:
PASS/FAIL

npm run test:migrations:
PASS/FAIL

Tasks 2-4 Supabase migration files unchanged:
YES/NO

sendMedia absent:
YES/NO

provider/service-role secrets absent from local layers:
YES/NO

Production Supabase migration applied in Task 5:
NO

Final branch:
<name>

Final HEAD:
<SHA>

Working tree:
clean / explain
```

After Task 5 completion, **STOP**. Do not start Task 6 until Planner/Auditor reviews the evidence and audits Task 6 against the final Task 5 interfaces.
