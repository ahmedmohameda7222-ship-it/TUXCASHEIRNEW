# TUX Operations WhatsApp Inbox Task 4 Amendment v2

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` for Classic ChatGPT execution. This plan supersedes **only Task 4** of `docs/superpowers/plans/2026-09-02-tux-operations-whatsapp-inbox.md` and also supersedes the earlier Task 4 draft amendment. Tasks 1-3 are not redone. After Task 4 completes, stop for the Task 5 pre-implementation audit.

**Goal:** Build the authenticated Operations WhatsApp remote API with durable Current Operator attribution, deterministic tenant/channel routing, concurrency-safe outbound idempotency, and a typed browser remote contract.

**Architecture:** Device-session cookies remain authoritative for `shopId` and `deviceId`. `businessDayId` and `workerId` from Operations are correlation claims that must match synchronized remote Business Day/worker-session state. The server performs a clean Current Operator preflight before channel resolution, then an atomic Postgres intent claim that rechecks and row-locks shop, Business Day, worker session, and worker before inserting the outbound message. Only the transaction that actually creates the durable outbound intent may call Meta; duplicate requests never call Meta again.

**Tech Stack:** TypeScript 6, Vitest 4, Node/Vercel functions, Supabase/Postgres RPCs, existing TUX device-session gateway, WhatsApp Business Platform Cloud API.

**Specs:**
- `docs/superpowers/specs/2026-09-02-tux-operations-whatsapp-inbox-design.md`
- `docs/superpowers/specs/2026-09-02-whatsapp-current-operator-authority-design.md`
- `docs/superpowers/specs/2026-09-02-whatsapp-channel-tenant-resolution-design.md`

## Preconditions

Task 1 permanent commit:

```text
4e92f421e8026ebfe7ea74c8d4fe101e0ac312ce
```

Task 2 permanent commit:

```text
9733cfd0a2f90030016f201b5b737a6d63b1056c
```

Before Task 4 RED, confirm completed Task 3 exposes the approved interfaces:

```ts
export interface WhatsAppChannelResolver {
  resolveOutboundChannel(input: {
    readonly shopId: ShopId;
  }): Promise<WhatsAppResolvedOutboundChannel | null>;
}

export interface WhatsAppResolvedOutboundChannel {
  readonly channelId: string;
  readonly provider: 'META_CLOUD_API';
  readonly providerPhoneNumberId: string;
}

export interface WhatsAppProviderGateway {
  sendMessage(input: {
    readonly providerPhoneNumberId: string;
    readonly to: string;
    readonly kind: 'TEXT';
    readonly text: string;
  }): Promise<{ providerMessageId: string }>;
}

export class WhatsAppProviderError extends Error {
  readonly httpStatus: number;
  readonly providerCode: number | null;
  readonly safeMessage: string;
}
```

If Task 3 is incomplete or those permanent interfaces materially differ, **STOP before Task 4 RED** with evidence.

## Global Constraints

- Do not modify `20260902220000_whatsapp_inbox.sql` or `20260902223000_whatsapp_channels.sql`.
- Add only append-only migration `20260902224500_whatsapp_current_worker_authority.sql` for Task 4 SQL changes.
- `shopId` and `deviceId` come only from the authenticated device session.
- Request-body `businessDayId` and `workerId` are claims, never sole authority.
- Current Operator preflight must happen before channel resolution so stale-worker requests create no intent when the channel is missing.
- Final Current Operator verification must happen again inside the same transaction that claims a new outbound intent.
- That atomic claim must row-lock the matched shop, Business Day, open worker session, and worker before insert so a synchronized worker switch/End Day cannot interleave between authority validation and durable attribution.
- Do not use nullable `worker_sessions.device_id` as v1 Current Operator authority because the shared `WorkerSession` domain does not own device identity.
- Authenticated `deviceId` remains durable audit attribution via `initiated_by_device_id`.
- Recipient phone comes from the tenant-fenced conversation row, never the request body.
- Provider phone-number ID comes only from `authenticated shopId -> whatsapp_channels`.
- The same `(shopId, outboundIntentKey)` must never cause more than one Meta call.
- Existing intent-key reuse with different conversation, payload, worker, or device is a conflict.
- Transport uncertainty leaves the newly-created intent PENDING and must not trigger automatic resend of the same intent.
- Explicit provider rejection represented by `WhatsAppProviderError` may mark the newly-created intent FAILED using safe error metadata only.
- Task 4 outbound provider support is TEXT only; media transport is deferred to the later media task.
- WhatsApp failure never blocks POS, Orders, Orders Board, Expenses, Bulk Stock, printing, Business Day, End Day, local worker transitions, or normal outbox sync.
- No production migration, Meta setup, Vercel secret change, or manual deployment in Task 4.

---

## Task 4A — Current Operator authority and atomic outbound claim

**Files:**
- Create: `scripts/test-whatsapp-current-worker-migration.mjs`
- Create: `supabase/migrations/20260902224500_whatsapp_current_worker_authority.sql`
- Modify: `package.json`

**Produces:**

```sql
public.resolve_tux_whatsapp_current_operator_v1(uuid, uuid, uuid)
public.claim_tux_whatsapp_outbound_intent_v2(...)
public.fail_tux_whatsapp_outbound_intent_v1(uuid, uuid, text, text)
public.link_tux_whatsapp_conversation_order_authorized_v1(...)
```

### Step 1 — Write migration RED

Create `scripts/test-whatsapp-current-worker-migration.mjs`:

```js
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migrationPath = resolve(
  'supabase/migrations/20260902224500_whatsapp_current_worker_authority.sql',
);

assert.equal(
  existsSync(migrationPath),
  true,
  '20260902224500_whatsapp_current_worker_authority.sql is missing.',
);

const sql = readFileSync(migrationPath, 'utf8');

const resolverSignature = sql.match(
  /resolve_tux_whatsapp_current_operator_v1\s*\(([^)]*)\)/i,
)?.[1] ?? '';

assert.match(resolverSignature, /p_shop_id\s+uuid/i);
assert.match(resolverSignature, /p_business_day_id\s+uuid/i);
assert.match(resolverSignature, /p_claimed_worker_id\s+uuid/i);
assert.doesNotMatch(
  resolverSignature,
  /p_device_id/i,
  'v1 Current Operator resolver must not invent device binding absent from the canonical WorkerSession domain.',
);

assert.match(sql, /business_day\.status\s*=\s*'OPEN'/i);
assert.match(sql, /worker_session\.ended_at\s+is\s+null/i);
assert.match(sql, /worker_session\.worker_id\s*=\s*p_claimed_worker_id/i);
assert.match(sql, /worker\.active/i);
assert.match(sql, /shop\.active/i);

assert.match(sql, /claim_tux_whatsapp_outbound_intent_v2/i);
assert.match(sql, /for\s+share\s+of\s+shop\s*,\s*business_day\s*,\s*worker_session\s*,\s*worker/i);
assert.match(sql, /TUX_WHATSAPP_OPERATOR_NOT_SYNCHRONIZED/i);
assert.match(sql, /TUX_WHATSAPP_OUTBOUND_INTENT_CONFLICT/i);
assert.match(sql, /on\s+conflict\s*\(\s*shop_id\s*,\s*outbound_intent_key\s*\)/i);
assert.match(sql, /recipient_normalized_phone/i);
assert.match(sql, /fail_tux_whatsapp_outbound_intent_v1/i);
assert.match(sql, /link_tux_whatsapp_conversation_order_authorized_v1/i);

assert.match(sql, /security\s+definer/i);
assert.match(sql, /set\s+search_path\s*=\s*pg_catalog\s*,\s*public\s*,\s*private/i);
assert.match(sql, /revoke\s+all[\s\S]*from\s+public\s*,\s*anon\s*,\s*authenticated/i);
assert.match(sql, /grant\s+execute[\s\S]*service_role/i);
assert.doesNotMatch(sql, /TUX_WHATSAPP_SHOP_ID/i);
assert.doesNotMatch(sql, /TUX_WHATSAPP_WORKER_ID/i);
```

Run:

```bash
node scripts/test-whatsapp-current-worker-migration.mjs
```

Expected RED: FAIL because `20260902224500_whatsapp_current_worker_authority.sql` does not exist.

### Step 2 — Add preflight resolver

Create `supabase/migrations/20260902224500_whatsapp_current_worker_authority.sql` with this resolver:

```sql
create or replace function public.resolve_tux_whatsapp_current_operator_v1(
  p_shop_id uuid,
  p_business_day_id uuid,
  p_claimed_worker_id uuid
)
returns table(business_day_id uuid, worker_id uuid)
language sql
stable
security definer
set search_path = pg_catalog, public, private
as $$
  select business_day.id, worker.id
  from public.shops shop
  join public.business_days business_day
    on business_day.shop_id = shop.id
  join public.worker_sessions worker_session
    on worker_session.business_day_id = business_day.id
   and worker_session.shop_id = shop.id
  join public.workers worker
    on worker.id = worker_session.worker_id
   and worker.shop_id = shop.id
  where shop.id = p_shop_id
    and shop.active
    and business_day.id = p_business_day_id
    and business_day.status = 'OPEN'
    and worker_session.ended_at is null
    and worker_session.worker_id = p_claimed_worker_id
    and worker.active
    and (
      select count(*)
      from public.worker_sessions open_session
      where open_session.shop_id = shop.id
        and open_session.business_day_id = business_day.id
        and open_session.ended_at is null
    ) = 1
$$;

revoke all on function public.resolve_tux_whatsapp_current_operator_v1(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.resolve_tux_whatsapp_current_operator_v1(uuid, uuid, uuid)
  to service_role;
```

This resolver is a non-locking preflight only.

### Step 3 — Add concurrency-safe atomic claim

Add:

```sql
create or replace function public.claim_tux_whatsapp_outbound_intent_v2(
  p_shop_id uuid,
  p_business_day_id uuid,
  p_claimed_worker_id uuid,
  p_device_id uuid,
  p_conversation_id uuid,
  p_outbound_intent_key text,
  p_kind text,
  p_text text,
  p_media_ref text,
  p_media_metadata jsonb,
  p_initiated_at timestamptz
)
returns table(
  created boolean,
  recipient_normalized_phone text,
  message_json jsonb
)
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_verified_worker_id uuid;
  v_message_id uuid;
  v_created boolean := false;
  v_recipient_normalized_phone text;
  v_message public.whatsapp_messages%rowtype;
begin
  if btrim(coalesce(p_outbound_intent_key, '')) = '' then
    raise exception 'TUX_WHATSAPP_OUTBOUND_INTENT_INVALID';
  end if;
  if p_kind not in ('TEXT', 'IMAGE', 'DOCUMENT', 'AUDIO', 'LOCATION') then
    raise exception 'TUX_WHATSAPP_MESSAGE_KIND_INVALID';
  end if;
  if p_initiated_at is null then
    raise exception 'TUX_WHATSAPP_INITIATED_AT_REQUIRED';
  end if;

  select worker.id
    into v_verified_worker_id
  from public.shops shop
  join public.business_days business_day
    on business_day.shop_id = shop.id
  join public.worker_sessions worker_session
    on worker_session.shop_id = shop.id
   and worker_session.business_day_id = business_day.id
  join public.workers worker
    on worker.shop_id = shop.id
   and worker.id = worker_session.worker_id
  where shop.id = p_shop_id
    and shop.active
    and business_day.id = p_business_day_id
    and business_day.status = 'OPEN'
    and worker_session.ended_at is null
    and worker_session.worker_id = p_claimed_worker_id
    and worker.active
    and (
      select count(*)
      from public.worker_sessions open_session
      where open_session.shop_id = shop.id
        and open_session.business_day_id = business_day.id
        and open_session.ended_at is null
    ) = 1
  for share of shop, business_day, worker_session, worker;

  if v_verified_worker_id is null then
    raise exception 'TUX_WHATSAPP_OPERATOR_NOT_SYNCHRONIZED';
  end if;

  if not exists (
    select 1
    from public.devices device
    where device.id = p_device_id
      and device.shop_id = p_shop_id
      and device.active
  ) then
    raise exception 'TUX_WHATSAPP_DEVICE_INVALID';
  end if;

  select conversation.normalized_phone
    into v_recipient_normalized_phone
  from public.whatsapp_conversations conversation
  where conversation.id = p_conversation_id
    and conversation.shop_id = p_shop_id;

  if v_recipient_normalized_phone is null then
    raise exception 'TUX_WHATSAPP_CONVERSATION_INVALID';
  end if;

  insert into public.whatsapp_messages as message (
    shop_id,
    conversation_id,
    provider_message_id,
    outbound_intent_key,
    direction,
    kind,
    text,
    media_ref,
    media_metadata,
    status,
    sent_by_worker_id,
    initiated_by_device_id,
    initiated_at,
    created_at,
    updated_at
  ) values (
    p_shop_id,
    p_conversation_id,
    null,
    p_outbound_intent_key,
    'OUTBOUND',
    p_kind,
    p_text,
    p_media_ref,
    coalesce(p_media_metadata, '{}'::jsonb),
    'PENDING',
    v_verified_worker_id,
    p_device_id,
    p_initiated_at,
    now(),
    now()
  )
  on conflict (shop_id, outbound_intent_key)
    where outbound_intent_key is not null
  do nothing
  returning message.id into v_message_id;

  v_created := v_message_id is not null;

  if v_created then
    select message.*
      into v_message
    from public.whatsapp_messages message
    where message.shop_id = p_shop_id
      and message.id = v_message_id;
  else
    select message.*
      into v_message
    from public.whatsapp_messages message
    where message.shop_id = p_shop_id
      and message.outbound_intent_key = p_outbound_intent_key;

    if v_message.id is null then
      raise exception 'TUX_WHATSAPP_OUTBOUND_INTENT_LOOKUP_FAILED';
    end if;

    if v_message.direction <> 'OUTBOUND'
       or v_message.conversation_id <> p_conversation_id
       or v_message.kind <> p_kind
       or v_message.text is distinct from p_text
       or v_message.media_ref is distinct from p_media_ref
       or v_message.media_metadata is distinct from coalesce(p_media_metadata, '{}'::jsonb)
       or v_message.sent_by_worker_id <> v_verified_worker_id
       or v_message.initiated_by_device_id <> p_device_id then
      raise exception 'TUX_WHATSAPP_OUTBOUND_INTENT_CONFLICT';
    end if;
  end if;

  return query
  select v_created, v_recipient_normalized_phone, to_jsonb(v_message);
end;
$$;

revoke all on function public.claim_tux_whatsapp_outbound_intent_v2(
  uuid, uuid, uuid, uuid, uuid, text, text, text, text, jsonb, timestamptz
) from public, anon, authenticated;
grant execute on function public.claim_tux_whatsapp_outbound_intent_v2(
  uuid, uuid, uuid, uuid, uuid, text, text, text, text, jsonb, timestamptz
) to service_role;
```

The `FOR SHARE` lock is mandatory. It prevents worker-switch or Business Day close updates to the matched authority rows from committing between validation and intent insertion.

### Step 4 — Add explicit provider-rejection failure RPC

Add:

```sql
create or replace function public.fail_tux_whatsapp_outbound_intent_v1(
  p_shop_id uuid,
  p_message_id uuid,
  p_failure_code text,
  p_failure_message text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
begin
  update public.whatsapp_messages message
     set status = 'FAILED',
         failure_code = nullif(btrim(p_failure_code), ''),
         failure_message = nullif(btrim(p_failure_message), ''),
         updated_at = now()
   where message.shop_id = p_shop_id
     and message.id = p_message_id
     and message.direction = 'OUTBOUND'
     and message.provider_message_id is null
     and message.status = 'PENDING';

  if found then return; end if;

  if exists (
    select 1
    from public.whatsapp_messages message
    where message.shop_id = p_shop_id
      and message.id = p_message_id
      and message.direction = 'OUTBOUND'
      and message.status = 'FAILED'
  ) then
    return;
  end if;

  raise exception 'TUX_WHATSAPP_OUTBOUND_MESSAGE_NOT_FAILABLE';
end;
$$;

revoke all on function public.fail_tux_whatsapp_outbound_intent_v1(uuid, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.fail_tux_whatsapp_outbound_intent_v1(uuid, uuid, text, text)
  to service_role;
```

Use this only for explicit provider rejection, not network uncertainty.

### Step 5 — Add atomic worker-authorized order-link wrapper

Add:

```sql
create or replace function public.link_tux_whatsapp_conversation_order_authorized_v1(
  p_shop_id uuid,
  p_business_day_id uuid,
  p_claimed_worker_id uuid,
  p_device_id uuid,
  p_conversation_id uuid,
  p_order_id uuid,
  p_linked boolean default true
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_verified_worker_id uuid;
begin
  select worker.id
    into v_verified_worker_id
  from public.shops shop
  join public.business_days business_day
    on business_day.shop_id = shop.id
  join public.worker_sessions worker_session
    on worker_session.shop_id = shop.id
   and worker_session.business_day_id = business_day.id
  join public.workers worker
    on worker.shop_id = shop.id
   and worker.id = worker_session.worker_id
  where shop.id = p_shop_id
    and shop.active
    and business_day.id = p_business_day_id
    and business_day.status = 'OPEN'
    and worker_session.ended_at is null
    and worker_session.worker_id = p_claimed_worker_id
    and worker.active
  for share of shop, business_day, worker_session, worker;

  if v_verified_worker_id is null then
    raise exception 'TUX_WHATSAPP_OPERATOR_NOT_SYNCHRONIZED';
  end if;

  if not exists (
    select 1
    from public.devices device
    where device.id = p_device_id
      and device.shop_id = p_shop_id
      and device.active
  ) then
    raise exception 'TUX_WHATSAPP_DEVICE_INVALID';
  end if;

  perform public.link_tux_whatsapp_conversation_order_v1(
    p_shop_id,
    p_conversation_id,
    p_order_id,
    v_verified_worker_id,
    p_device_id,
    p_linked
  );
end;
$$;

revoke all on function public.link_tux_whatsapp_conversation_order_authorized_v1(
  uuid, uuid, uuid, uuid, uuid, uuid, boolean
) from public, anon, authenticated;
grant execute on function public.link_tux_whatsapp_conversation_order_authorized_v1(
  uuid, uuid, uuid, uuid, uuid, uuid, boolean
) to service_role;
```

### Step 6 — Run migration GREEN and permanent gate

Run:

```bash
node scripts/test-whatsapp-current-worker-migration.mjs
npm run test:migrations
```

Expected: PASS.

Modify root `test:migrations` only by inserting:

```text
node scripts/test-whatsapp-current-worker-migration.mjs
```

after `test-whatsapp-channel-migration.mjs` and before the existing worker/security migration tests.

### Step 7 — Prove historical migrations unchanged

Run:

```bash
git diff 9733cfd0a2f90030016f201b5b737a6d63b1056c..HEAD -- \
  supabase/migrations/20260902220000_whatsapp_inbox.sql
```

Expected: no output.

After Task 3A has a permanent commit, also run:

```bash
git diff <TASK_3A_COMMIT>..HEAD -- \
  supabase/migrations/20260902223000_whatsapp_channels.sql
```

Expected: no output.

### Step 8 — Commit Task 4A

```bash
git add \
  scripts/test-whatsapp-current-worker-migration.mjs \
  supabase/migrations/20260902224500_whatsapp_current_worker_authority.sql \
  package.json

git commit -m "feat: add WhatsApp Current Operator authority"
```

Record the exact SHA.

---

## Task 4B — Shared remote contract, trusted repository, and authenticated HTTP gateway

**Files:**
- Create: `packages/application/src/whatsappRemote.ts`
- Create: `packages/application/src/whatsappRemote.test.ts`
- Modify: `packages/application/src/index.ts`
- Modify: `server/whatsappServerConfig.ts`
- Modify: `server/whatsappServerConfig.test.ts`
- Create: `server/whatsappOperationsRepository.ts`
- Create: `server/whatsappOperationsRepository.test.ts`
- Create: `server/whatsappOperationsGateway.ts`
- Create: `server/whatsappOperationsGateway.test.ts`
- Create: `api/whatsapp.ts`

### Step 1 — Write shared-contract RED

Create `packages/application/src/whatsappRemote.test.ts` that imports the missing contract and instantiates a compile/runtime-safe fake:

```ts
import { describe, expect, it } from 'vitest';
import type { WhatsAppRemoteGateway } from './whatsappRemote';

it('defines a provider-agnostic WhatsApp remote contract', () => {
  const fake: WhatsAppRemoteGateway = {
    loadInbox: async () => ({
      conversations: [],
      messages: [],
      quickReplies: [],
      orderLinks: [],
      nextCursor: null,
    }),
    sendText: async () => {
      throw new Error('not called');
    },
    markUnread: async () => undefined,
    archive: async () => undefined,
    setFollowUp: async () => undefined,
    linkOrder: async () => undefined,
  };

  expect(fake).toBeDefined();
});
```

Run:

```bash
npm test -- packages/application/src/whatsappRemote.test.ts
```

Expected RED: FAIL because `./whatsappRemote` does not exist.

### Step 2 — Add shared application-layer transport contract

Create `packages/application/src/whatsappRemote.ts`:

```ts
import type {
  BusinessDayId,
  OrderId,
  WhatsAppConversation,
  WhatsAppMessage,
  WhatsAppQuickReply,
  WorkerId,
} from '@tux/domain';

export interface WhatsAppInboxOrderLink {
  readonly conversationId: string;
  readonly orderId: OrderId;
  readonly linkedAt: string;
}

export interface WhatsAppInboxSnapshot {
  readonly conversations: readonly WhatsAppConversation[];
  readonly messages: readonly WhatsAppMessage[];
  readonly quickReplies: readonly WhatsAppQuickReply[];
  readonly orderLinks: readonly WhatsAppInboxOrderLink[];
  readonly nextCursor: string | null;
}

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

Export these types from `packages/application/src/index.ts`.

Run:

```bash
npm test -- packages/application/src/whatsappRemote.test.ts
npm run typecheck -w @tux/application
```

Expected: PASS.

This contract is the exact Task 5 handoff. Task 5 must consume it rather than invent another remote send signature.

### Step 3 — Add data-plane server-config RED

Extend `server/whatsappServerConfig.test.ts` before production changes:

```ts
it('loads WhatsApp data-plane config without Meta credentials', () => {
  expect(
    loadWhatsAppDataServerConfig({
      TUX_SUPABASE_URL: 'https://example.supabase.co',
      TUX_SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
    }),
  ).toEqual({
    projectUrl: 'https://example.supabase.co',
    serviceRoleKey: 'test-service-role-key',
  });
});
```

Run:

```bash
npm test -- server/whatsappServerConfig.test.ts
```

Expected RED: FAIL because `loadWhatsAppDataServerConfig` does not exist.

### Step 4 — Add narrow data-plane config loader

Modify `server/whatsappServerConfig.ts`:

```ts
export interface WhatsAppDataServerConfig {
  readonly projectUrl: string;
  readonly serviceRoleKey: string;
}

export function loadWhatsAppDataServerConfig(
  env: Readonly<Record<string, string | undefined>> = process.env,
): WhatsAppDataServerConfig;
```

Use only:

```text
TUX_SUPABASE_URL / SUPABASE_URL
TUX_SUPABASE_SERVICE_ROLE_KEY / SUPABASE_SERVICE_ROLE_KEY
```

Refactor the full Task 3 `loadWhatsAppServerConfig` to reuse this parser. Do not weaken Task 3 tests. Data-plane reads/state mutations must not require Meta credentials.

### Step 5 — Write repository RED

Create `server/whatsappOperationsRepository.test.ts` with injected `fetch`.

Required RPC/body assertions:

```ts
await repository.resolveCurrentOperator({ shopId, businessDayId, workerId });
expect(lastRpcBody(fetchMock)).toEqual({
  p_shop_id: shopId,
  p_business_day_id: businessDayId,
  p_claimed_worker_id: workerId,
});
```

```ts
await repository.claimOutboundTextIntent({
  shopId,
  businessDayId,
  workerId,
  deviceId,
  conversationId,
  outboundIntentKey: 'intent-1',
  text: 'أوردر حضرتك جاهز.',
  initiatedAt: '2026-09-02T20:00:00.000Z',
});
expect(lastRpcBody(fetchMock)).toEqual({
  p_shop_id: shopId,
  p_business_day_id: businessDayId,
  p_claimed_worker_id: workerId,
  p_device_id: deviceId,
  p_conversation_id: conversationId,
  p_outbound_intent_key: 'intent-1',
  p_kind: 'TEXT',
  p_text: 'أوردر حضرتك جاهز.',
  p_media_ref: null,
  p_media_metadata: {},
  p_initiated_at: '2026-09-02T20:00:00.000Z',
});
```

Also prove:
- resolver `[]` -> `null`;
- malformed successful payload -> typed safe protocol error;
- claim parses `{ created, recipient_normalized_phone, message_json }`;
- existing Task 2 RPCs are used for inbox load, provider-ID attach, and conversation state;
- `failOutboundIntent` calls the new failure RPC;
- `linkOrderAuthorized` calls the new authorized wrapper;
- service credential appears only in trusted headers, never returned error text;
- parsed messages pass `assertWhatsAppMessageInvariant`;
- `nextCursor` equals greatest observed message `updated_at`, or preserves input cursor when no newer messages were observed;
- `linkedOrderId` is set only when exactly one active order link exists for the conversation; otherwise `null` while all links remain in `orderLinks`.

Run:

```bash
npm test -- server/whatsappOperationsRepository.test.ts
```

Expected RED: FAIL because the repository module does not exist.

### Step 6 — Implement repository

Create `server/whatsappOperationsRepository.ts` implementing:

```ts
import type {
  BusinessDayId,
  DeviceId,
  OrderId,
  ShopId,
  WorkerId,
} from '@tux/domain';
import type { WhatsAppInboxSnapshot } from '@tux/application';

export class WhatsAppOperationsRepositoryError extends Error {
  readonly code:
    | 'OPERATOR_NOT_SYNCHRONIZED'
    | 'OUTBOUND_INTENT_CONFLICT'
    | 'REMOTE_UNAVAILABLE'
    | 'REMOTE_REJECTED'
    | 'PROTOCOL_ERROR';
}

export interface ClaimedWhatsAppOutboundIntent {
  readonly created: boolean;
  readonly recipientNormalizedPhone: string;
  readonly message: import('@tux/domain').WhatsAppMessage;
}

export interface WhatsAppOperationsRepository {
  resolveCurrentOperator(input: {
    readonly shopId: ShopId;
    readonly businessDayId: BusinessDayId;
    readonly workerId: WorkerId;
  }): Promise<{ businessDayId: BusinessDayId; workerId: WorkerId } | null>;

  loadInbox(input: {
    readonly shopId: ShopId;
    readonly after: string | null;
  }): Promise<WhatsAppInboxSnapshot>;

  claimOutboundTextIntent(input: {
    readonly shopId: ShopId;
    readonly businessDayId: BusinessDayId;
    readonly workerId: WorkerId;
    readonly deviceId: DeviceId;
    readonly conversationId: string;
    readonly outboundIntentKey: string;
    readonly text: string;
    readonly initiatedAt: string;
  }): Promise<ClaimedWhatsAppOutboundIntent>;

  attachProviderMessage(input: {
    readonly shopId: ShopId;
    readonly messageId: string;
    readonly providerMessageId: string;
  }): Promise<void>;

  failOutboundIntent(input: {
    readonly shopId: ShopId;
    readonly messageId: string;
    readonly failureCode: string;
    readonly failureMessage: string;
  }): Promise<void>;

  setConversationState(input: {
    readonly shopId: ShopId;
    readonly conversationId: string;
    readonly archived: boolean | null;
    readonly followUp: boolean | null;
    readonly markUnread: boolean;
  }): Promise<void>;

  linkOrderAuthorized(input: {
    readonly shopId: ShopId;
    readonly businessDayId: BusinessDayId;
    readonly workerId: WorkerId;
    readonly deviceId: DeviceId;
    readonly conversationId: string;
    readonly orderId: OrderId;
    readonly linked: boolean;
  }): Promise<void>;
}
```

Implement `SupabaseWhatsAppOperationsRepository(config, fetchImpl = fetch)` using `WhatsAppDataServerConfig` and trusted service-role RPC headers.

PostgREST exception messages must be mapped narrowly:

```text
TUX_WHATSAPP_OPERATOR_NOT_SYNCHRONIZED -> OPERATOR_NOT_SYNCHRONIZED
TUX_WHATSAPP_OUTBOUND_INTENT_CONFLICT -> OUTBOUND_INTENT_CONFLICT
```

Do not return raw Supabase/Postgres error bodies to callers.

### Step 7 — Write HTTP gateway RED

Create `server/whatsappOperationsGateway.test.ts` using existing device-session gateway test conventions and dependency injection.

Required cases:
1. invalid/no device session -> existing `401`; no WhatsApp dependency call;
2. disallowed POST Origin -> `403` before mutation;
3. POST body containing any of `shopId`, `deviceId`, `sentByWorkerId`, `to`, or `providerPhoneNumberId` -> `400 invalid_whatsapp_request`;
4. malformed SEND_MESSAGE claims/payload -> `400`;
5. Current Operator preflight null -> `409 whatsapp_operator_not_synchronized`; no channel lookup, no claim, no Meta call;
6. channel missing -> `503 whatsapp_channel_not_configured`; no claim, no Meta call;
7. atomic claim reports operator mismatch after successful preflight -> `409`; no Meta call;
8. new claim -> Meta called once with provider number from channel resolver and destination from trusted conversation claim result;
9. existing claim -> Meta zero calls, existing message returned;
10. conflicting key reuse -> `409 whatsapp_outbound_intent_conflict`; Meta zero calls;
11. explicit `WhatsAppProviderError` -> newly-created intent marked FAILED with safe code/message and API returns `502 whatsapp_provider_rejected`;
12. generic provider/transport exception -> intent remains PENDING, no failure RPC, API returns `503 whatsapp_delivery_uncertain` with durable `messageId`;
13. retry of that same existing intent -> Meta zero calls;
14. GET inbox requires only device/data-plane config, not Current Operator or provider credentials;
15. MARK_UNREAD/ARCHIVE/FOLLOW_UP use authenticated session shop only;
16. LINK_ORDER requires Current Operator claims and uses only authorized wrapper.

Successful provider assertion:

```ts
expect(providerGateway.sendMessage).toHaveBeenCalledWith({
  providerPhoneNumberId: 'provider-phone-1',
  to: '01012345678',
  kind: 'TEXT',
  text: 'أوردر حضرتك جاهز.',
});
```

Run:

```bash
npm test -- server/whatsappOperationsGateway.test.ts
```

Expected RED: FAIL because the gateway module does not exist.

### Step 8 — Implement lazy dependency factory and gateway

Create `server/whatsappOperationsGateway.ts` with:

```ts
export interface WhatsAppOperationsDependencyFactory {
  createRepository(): WhatsAppOperationsRepository;
  createChannelResolver(): WhatsAppChannelResolver;
  createProviderGateway(): WhatsAppProviderGateway;
  now(): Date;
}

export async function handleWhatsAppOperations(
  request: GatewayRequest,
  response: GatewayResponse,
  dependencies?: WhatsAppOperationsDependencyFactory,
): Promise<void>;
```

Production default dependencies are **lazy**:
- `createRepository()` loads only `loadWhatsAppDataServerConfig()`;
- `createChannelResolver()` uses data-plane service-role config;
- `createProviderGateway()` loads the full Task 3 Meta config;
- GET and non-provider state mutations must not construct the provider gateway.

Every request first uses existing `requireServerConfig` + `requireDeviceSession` to obtain authoritative session `shopId`/`deviceId`.

For POST, enforce same-origin before mutation.

SEND_MESSAGE ordered flow:

```text
authenticated device session
-> parse businessDayId + workerId claims
-> repository.resolveCurrentOperator(...)        // preflight
-> channelResolver.resolveOutboundChannel(shop)  // no intent when not configured
-> repository.claimOutboundTextIntent(...)       // lock/recheck + insert/find
-> created=false => return existing message, NO Meta
-> created=true  => provider.sendMessage(...)
-> attach provider ID
-> return SENT result
```

Map repository Current Operator mismatch to `409 whatsapp_operator_not_synchronized` both during preflight and atomic claim.

Map intent conflict to `409 whatsapp_outbound_intent_conflict`.

Do not accept `kind`; server supplies `'TEXT'` internally.

For explicit `WhatsAppProviderError`, call `failOutboundIntent` with:

```ts
failureCode:
  error.providerCode === null ? `HTTP_${error.httpStatus}` : String(error.providerCode),
failureMessage: error.safeMessage,
```

and return `502 { error: 'whatsapp_provider_rejected', messageId }`.

For a generic transport exception after a newly-created claim, return:

```json
{
  "error": "whatsapp_delivery_uncertain",
  "messageId": "<durable-message-id>"
}
```

with HTTP `503`; leave PENDING and do not auto-resend.

### Step 9 — Add Vercel adapter

Create `api/whatsapp.ts`:

```ts
import { normalizeVercelSupabaseEnv } from '../server/vercelSupabaseEnv';
import type { GatewayRequest, GatewayResponse } from '../server/supabaseGateway';
import { handleWhatsAppOperations } from '../server/whatsappOperationsGateway';

normalizeVercelSupabaseEnv();

export default async function handler(
  request: GatewayRequest,
  response: GatewayResponse,
): Promise<void> {
  await handleWhatsAppOperations(request, response);
}
```

### Step 10 — Run Task 4B GREEN

Run:

```bash
npm test -- \
  packages/application/src/whatsappRemote.test.ts \
  server/whatsappServerConfig.test.ts \
  server/whatsappOperationsRepository.test.ts \
  server/whatsappOperationsGateway.test.ts

npm run typecheck
npm run lint
```

Expected: PASS.

### Step 11 — Commit Task 4B

```bash
git add \
  packages/application/src/whatsappRemote.ts \
  packages/application/src/whatsappRemote.test.ts \
  packages/application/src/index.ts \
  server/whatsappServerConfig.ts \
  server/whatsappServerConfig.test.ts \
  server/whatsappOperationsRepository.ts \
  server/whatsappOperationsRepository.test.ts \
  server/whatsappOperationsGateway.ts \
  server/whatsappOperationsGateway.test.ts \
  api/whatsapp.ts

git commit -m "feat: add authenticated WhatsApp Operations API"
```

Record the exact SHA.

---

## Task 4C — Browser remote implementation

**Files:**
- Create: `apps/operations/src/app/browserWhatsAppRemote.ts`
- Create: `apps/operations/src/app/browserWhatsAppRemote.test.ts`

**Consumes:** `WhatsAppRemoteGateway` and `WhatsAppInboxSnapshot` from `@tux/application`.

### Step 1 — Write browser RED

Create tests proving:
- every request uses `credentials: 'same-origin'` and `cache: 'no-store'`;
- `loadInbox()` performs `GET /api/whatsapp`;
- cursor is URL-encoded when supplied;
- `sendText` serializes only `action`, `businessDayId`, `workerId`, `conversationId`, `outboundIntentKey`, `text`;
- it never serializes `shopId`, `deviceId`, `sentByWorkerId`, recipient phone, provider phone number, access token, or `kind`;
- `409 whatsapp_operator_not_synchronized` maps to `WhatsAppOperatorNotSynchronizedError`;
- `409 whatsapp_outbound_intent_conflict` maps to a distinct safe conflict error;
- `503 whatsapp_delivery_uncertain` maps to `WhatsAppDeliveryUncertainError` carrying only the durable message ID;
- successful send validates the returned WhatsApp message with `assertWhatsAppMessageInvariant`;
- mutation methods serialize only their documented fields;
- `linkOrder` includes `businessDayId` + `workerId` claims and no authority-bearing shop/device fields.

Run:

```bash
npm test -- apps/operations/src/app/browserWhatsAppRemote.test.ts
```

Expected RED: FAIL because the module does not exist.

### Step 2 — Implement browser remote

Create `apps/operations/src/app/browserWhatsAppRemote.ts`:

```ts
import type { WhatsAppInboxSnapshot, WhatsAppRemoteGateway } from '@tux/application';
import {
  assertWhatsAppMessageInvariant,
  type WhatsAppMessage,
} from '@tux/domain';

export class WhatsAppOperatorNotSynchronizedError extends Error {}
export class WhatsAppOutboundIntentConflictError extends Error {}

export class WhatsAppDeliveryUncertainError extends Error {
  readonly messageId: string;
  constructor(messageId: string) {
    super('WhatsApp delivery is not confirmed yet.');
    this.name = 'WhatsAppDeliveryUncertainError';
    this.messageId = messageId;
  }
}

export class VercelBrowserWhatsAppRemote implements WhatsAppRemoteGateway {
  // implement the exact WhatsAppRemoteGateway contract
}
```

Use same-origin fetches with defensive JSON parsing. Do not import server implementation types/modules.

SEND_MESSAGE body must be exactly:

```ts
{
  action: 'SEND_MESSAGE',
  businessDayId: input.businessDayId,
  workerId: input.workerId,
  conversationId: input.conversationId,
  outboundIntentKey: input.outboundIntentKey,
  text: input.text,
}
```

Map only documented safe error codes. Never surface raw provider/Supabase error bodies to the renderer.

### Step 3 — Run GREEN

Run:

```bash
npm test -- apps/operations/src/app/browserWhatsAppRemote.test.ts
npm run typecheck -w @tux/operations
```

Expected: PASS.

### Step 4 — Commit Task 4C

```bash
git add \
  apps/operations/src/app/browserWhatsAppRemote.ts \
  apps/operations/src/app/browserWhatsAppRemote.test.ts

git commit -m "feat: add browser WhatsApp remote client"
```

Record the exact SHA.

---

## Final Task 4 Gate

Run fresh from final Task 4 HEAD:

```bash
npm test -- \
  packages/application/src/whatsappRemote.test.ts \
  server/whatsappServerConfig.test.ts \
  server/whatsappChannelResolver.test.ts \
  server/whatsappProviderGateway.test.ts \
  server/whatsappOperationsRepository.test.ts \
  server/whatsappOperationsGateway.test.ts \
  apps/operations/src/app/browserWhatsAppRemote.test.ts

npm run test:migrations
npm run typecheck
npm run lint
npm run format:check
```

All must PASS.

Run:

```bash
git status --short
```

Expected: empty.

Verify Task 2 migration remains unchanged:

```bash
git diff 9733cfd0a2f90030016f201b5b737a6d63b1056c..HEAD -- \
  supabase/migrations/20260902220000_whatsapp_inbox.sql
```

Expected: no output.

Verify obsolete authority/routing shortcuts are absent:

```bash
git grep -n "TUX_WHATSAPP_SHOP_ID\|TUX_WHATSAPP_WORKER_ID\|TUX_WHATSAPP_PHONE_NUMBER_ID" -- \
  server api packages apps
```

Expected: no production-code routing matches.

Verify renderer/platform code contains no service-role configuration:

```bash
git grep -n "TUX_SUPABASE_SERVICE_ROLE_KEY\|SUPABASE_SERVICE_ROLE_KEY" -- \
  apps/operations packages/platform-contracts
```

Expected: no matches.

## Required Completion Report

```text
TASK 4 COMPLETE

Task 4A RED:
<command/result>

Task 4A GREEN:
<commands/results>

Task 4A commit:
<SHA>

Task 4B RED/GREEN:
<commands/results>

Task 4B commit:
<SHA>

Task 4C RED/GREEN:
<commands/results>

Task 4C commit:
<SHA>

Authority proof:
- authoritative shopId/deviceId from device session only
- businessDayId/workerId are claims
- Current Operator preflight before channel lookup
- final Current Operator recheck + row locks inside atomic claim
- worker_sessions.device_id not used as v1 Current Operator authority

Idempotency proof:
- only newly-created intent can call Meta
- existing intent calls Meta zero times
- conflicting key reuse cannot replace worker/device/payload
- transport uncertainty preserves PENDING and does not auto-resend

Routing proof:
- authenticated shopId -> whatsapp_channels -> providerPhoneNumberId
- recipient phone from tenant-fenced conversation

Historical migrations modified:
NO

Production deployment:
NO

Environment variable NAMES only:
TUX_SUPABASE_URL
TUX_SUPABASE_SERVICE_ROLE_KEY
TUX_WHATSAPP_GRAPH_VERSION
TUX_WHATSAPP_ACCESS_TOKEN
TUX_WHATSAPP_WEBHOOK_VERIFY_TOKEN
TUX_WHATSAPP_APP_SECRET

Final focused tests:
<result>
Migration gate:
<result>
Typecheck:
<result>
Lint:
<result>
Format check:
<result>
Working tree:
<state>
```

Then **STOP before Task 5 production code**. Audit the original Task 5 against the exact `WhatsAppRemoteGateway` contract established here. Do not guess through any mismatch.
