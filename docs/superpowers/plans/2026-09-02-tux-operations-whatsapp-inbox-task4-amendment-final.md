# TUX Operations WhatsApp Inbox Task 4 — Final Amendment

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` for Classic ChatGPT execution. This plan supersedes **only Task 4** of `docs/superpowers/plans/2026-09-02-tux-operations-whatsapp-inbox.md` and supersedes both earlier Task 4 draft amendments. Tasks 1-3 are not redone. After Task 4 completes, stop for the Task 5 pre-implementation audit.

**Goal:** Build the authenticated Operations WhatsApp remote API with durable Current Operator attribution, deterministic tenant/channel routing, concurrency-safe outbound idempotency, and a typed browser remote contract.

**Architecture:** Device-session cookies remain authoritative for `shopId` and `deviceId`. `businessDayId` and `workerId` from Operations are correlation claims that must match synchronized remote Business Day/worker-session state. The server performs a clean Current Operator preflight before channel resolution, then an atomic Postgres intent claim that rechecks and row-locks the matching shop, Business Day, worker session, and worker before inserting the outbound message. Only the transaction that actually creates the durable outbound intent may call Meta; duplicate requests never call Meta again. If delivery becomes uncertain after the durable claim, TUX preserves the PENDING intent and does not blindly resend.

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

- Do not modify `supabase/migrations/20260902220000_whatsapp_inbox.sql` or `supabase/migrations/20260902223000_whatsapp_channels.sql`.
- Add only append-only migration `supabase/migrations/20260902224500_whatsapp_current_worker_authority.sql` for Task 4 SQL changes.
- `shopId` and `deviceId` come only from the authenticated device session.
- Request-body `businessDayId` and `workerId` are claims, never sole authority.
- Current Operator preflight happens before channel resolution so stale-worker requests create no durable intent when the channel is unavailable.
- Final Current Operator verification happens again inside the transaction that claims the outbound intent.
- The claim transaction row-locks the matched shop, Business Day, worker session, and worker before insert so a synchronized worker switch or End Day cannot commit between authority validation and durable attribution.
- Do not use nullable `worker_sessions.device_id` as v1 Current Operator authority because the shared `WorkerSession` domain does not own device identity.
- Authenticated `deviceId` remains durable audit attribution via `initiated_by_device_id`.
- Recipient phone comes from the tenant-fenced conversation row, never the request body.
- Provider phone-number ID comes only from `authenticated shopId -> whatsapp_channels`.
- The same `(shopId, outboundIntentKey)` must never cause more than one Meta call.
- Existing intent-key reuse with a different conversation, payload, worker, or device is a conflict.
- An existing PENDING intent with no `providerMessageId` is an uncertain delivery state; retrying the same intent returns the same uncertainty state and calls Meta zero times.
- A Meta success followed by failure to attach/persist the returned provider message ID is also an uncertain delivery state; do not call Meta again for that intent.
- Explicit provider rejection represented by `WhatsAppProviderError` may mark the newly-created intent FAILED using safe error metadata only.
- Task 4 outbound provider support is TEXT only. Media transport remains for the later media task.
- WhatsApp failure never blocks POS, Orders, Orders Board, Expenses, Bulk Stock, printing, Business Day, End Day, local worker transitions, or normal outbox sync.
- No production migration, Meta setup, Vercel secret change, or manual deployment in Task 4.

---

# Task 4A — Current Operator authority and atomic outbound claim

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

## Step 1 — Write migration RED

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
assert.doesNotMatch(resolverSignature, /p_device_id/i);

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

## Step 2 — Add non-locking preflight resolver

Create the migration and add:

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

This resolver is preflight only. It does not close the race by itself.

## Step 3 — Add row-locked atomic claim

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
    select 1 from public.devices device
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
    select message.* into v_message
    from public.whatsapp_messages message
    where message.shop_id = p_shop_id
      and message.id = v_message_id;
  else
    select message.* into v_message
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

The `FOR SHARE` clause is mandatory.

## Step 4 — Add explicit provider-rejection failure RPC

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
    select 1 from public.whatsapp_messages message
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

Use this only for explicit provider rejection, not network or persistence uncertainty.

## Step 5 — Add row-locked worker-authorized order-link wrapper

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
    select 1 from public.devices device
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

## Step 6 — Run migration GREEN and root gate

Insert `node scripts/test-whatsapp-current-worker-migration.mjs` into root `test:migrations` immediately after `test-whatsapp-channel-migration.mjs`.

Run:

```bash
node scripts/test-whatsapp-current-worker-migration.mjs
npm run test:migrations
```

Expected: PASS.

## Step 7 — Verify historical WhatsApp migrations are unchanged

Run:

```bash
git diff 9733cfd0a2f90030016f201b5b737a6d63b1056c..HEAD -- \
  supabase/migrations/20260902220000_whatsapp_inbox.sql
```

Expected: no output.

Run:

```bash
CHANNEL_MIGRATION_COMMIT="$(git log --format=%H --reverse -- supabase/migrations/20260902223000_whatsapp_channels.sql | head -n 1)"
git diff "${CHANNEL_MIGRATION_COMMIT}"..HEAD -- \
  supabase/migrations/20260902223000_whatsapp_channels.sql
```

Expected: no output.

## Step 8 — Commit Task 4A

```bash
git add \
  scripts/test-whatsapp-current-worker-migration.mjs \
  supabase/migrations/20260902224500_whatsapp_current_worker_authority.sql \
  package.json

git commit -m "feat: add WhatsApp Current Operator authority"
```

Record the exact SHA from:

```bash
git rev-parse HEAD
```

---

# Task 4B — Shared remote contract, trusted repository, and authenticated HTTP gateway

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

## Step 1 — Write shared-contract RED

Create `packages/application/src/whatsappRemote.test.ts`:

```ts
import { expect, it } from 'vitest';
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

## Step 2 — Add exact shared remote contract

Create `packages/application/src/whatsappRemote.ts`:

```ts
import type {
  BusinessDayId,
  Instant,
  OrderId,
  WhatsAppConversation,
  WhatsAppMessage,
  WhatsAppQuickReply,
  WorkerId,
} from '@tux/domain';

export interface WhatsAppInboxOrderLink {
  readonly conversationId: string;
  readonly orderId: OrderId;
  readonly linkedAt: Instant;
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

Export from `packages/application/src/index.ts`.

Run:

```bash
npm test -- packages/application/src/whatsappRemote.test.ts
npm run typecheck -w @tux/application
```

Expected: PASS.

## Step 3 — Add data-plane config RED and GREEN

Extend `server/whatsappServerConfig.test.ts` first:

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

Run RED:

```bash
npm test -- server/whatsappServerConfig.test.ts
```

Expected: FAIL because `loadWhatsAppDataServerConfig` does not exist.

Then modify `server/whatsappServerConfig.ts`:

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

Refactor the full Task 3 config loader to reuse this parser. Data-plane inbox reads/state changes must not require Meta secrets.

Run GREEN:

```bash
npm test -- server/whatsappServerConfig.test.ts
```

Expected: PASS.

## Step 4 — Write repository RED

Create `server/whatsappOperationsRepository.test.ts` with injected `fetch` and prove:

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
- malformed successful payload -> safe `PROTOCOL_ERROR`;
- claim parses `{ created, recipient_normalized_phone, message_json }`;
- inbox uses Task 2 `get_tux_whatsapp_inbox_v1`;
- provider attach uses Task 2 `attach_tux_whatsapp_provider_message_v1`;
- state mutation uses Task 2 `set_tux_whatsapp_conversation_state_v1`;
- failure uses `fail_tux_whatsapp_outbound_intent_v1`;
- order link uses `link_tux_whatsapp_conversation_order_authorized_v1`;
- service credential appears only in trusted headers;
- parsed messages pass `assertWhatsAppMessageInvariant`;
- `nextCursor` is greatest observed message `updated_at`, or preserves input cursor when no newer messages were observed;
- `linkedOrderId` is set only when exactly one active order link exists; otherwise it is `null`, while all active links remain in `orderLinks`.

Run:

```bash
npm test -- server/whatsappOperationsRepository.test.ts
```

Expected RED: FAIL because the repository module does not exist.

## Step 5 — Implement repository and exact safe error contract

Create `server/whatsappOperationsRepository.ts`.

```ts
export type WhatsAppOperationsRepositoryErrorCode =
  | 'OPERATOR_NOT_SYNCHRONIZED'
  | 'OUTBOUND_INTENT_CONFLICT'
  | 'REMOTE_UNAVAILABLE'
  | 'REMOTE_REJECTED'
  | 'PROTOCOL_ERROR';

export class WhatsAppOperationsRepositoryError extends Error {
  readonly code: WhatsAppOperationsRepositoryErrorCode;

  constructor(code: WhatsAppOperationsRepositoryErrorCode, message: string) {
    super(message);
    this.name = 'WhatsAppOperationsRepositoryError';
    this.code = code;
  }
}
```

Implement:

```ts
export interface ClaimedWhatsAppOutboundIntent {
  readonly created: boolean;
  readonly recipientNormalizedPhone: string;
  readonly message: WhatsAppMessage;
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

Map only these Postgres exception messages specially:

```text
TUX_WHATSAPP_OPERATOR_NOT_SYNCHRONIZED -> OPERATOR_NOT_SYNCHRONIZED
TUX_WHATSAPP_OUTBOUND_INTENT_CONFLICT -> OUTBOUND_INTENT_CONFLICT
```

Everything else is safe `REMOTE_REJECTED`, `REMOTE_UNAVAILABLE`, or `PROTOCOL_ERROR` according to transport/HTTP/response shape. Never expose raw remote bodies or service credentials.

## Step 6 — Write gateway RED

Create `server/whatsappOperationsGateway.test.ts` with dependency injection and prove:
1. invalid/no device session -> existing `401`; no WhatsApp dependency call;
2. disallowed POST Origin -> `403` before mutation;
3. POST body containing `shopId`, `deviceId`, `sentByWorkerId`, `to`, or `providerPhoneNumberId` -> `400 invalid_whatsapp_request`;
4. malformed SEND_MESSAGE claims/payload -> `400`;
5. Current Operator preflight null -> `409 whatsapp_operator_not_synchronized`; no channel lookup, claim, or Meta;
6. channel missing -> `503 whatsapp_channel_not_configured`; no claim or Meta;
7. atomic claim reports operator mismatch after successful preflight -> `409`; no Meta;
8. new claim -> Meta called exactly once with provider phone from channel resolver and destination from trusted claim result;
9. existing SENT/DELIVERED/READ/FAILED claim -> Meta zero calls and existing message returned;
10. existing PENDING claim with no provider ID -> Meta zero calls and `503 whatsapp_delivery_uncertain` with the same durable message ID;
11. conflicting key reuse -> `409 whatsapp_outbound_intent_conflict`; Meta zero calls;
12. explicit `WhatsAppProviderError` -> new intent marked FAILED and API returns `502 whatsapp_provider_rejected`;
13. generic provider transport exception -> no failure RPC; API returns `503 whatsapp_delivery_uncertain`; intent remains PENDING;
14. provider returns success but `attachProviderMessage` fails -> API returns `503 whatsapp_delivery_uncertain`; Meta is not called again inside the request;
15. retry after provider-success/attach-failure -> existing PENDING intent returns same uncertainty state and Meta zero calls;
16. GET inbox constructs only data-plane dependencies and never provider gateway;
17. MARK_UNREAD/ARCHIVE/FOLLOW_UP use authenticated session shop only;
18. LINK_ORDER uses Current Operator claims plus authorized wrapper only.

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

## Step 7 — Implement lazy dependency factory and ordered gateway

Create `server/whatsappOperationsGateway.ts`:

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

Production factory rules:
- `createRepository()` loads only data-plane config;
- `createChannelResolver()` uses data-plane service-role config;
- `createProviderGateway()` loads full Meta config;
- GET and non-provider state mutations must not construct provider dependencies.

Every request first uses `requireServerConfig` + `requireDeviceSession` to get authoritative session `shopId`/`deviceId`. POST additionally requires same-origin.

SEND_MESSAGE ordered flow:

```text
device session
-> parse businessDayId + workerId claims
-> repository.resolveCurrentOperator(...)
-> channelResolver.resolveOutboundChannel(shopId)
-> repository.claimOutboundTextIntent(...)  // row-locked recheck + insert/find
-> inspect claim
```

Claim behavior:
- `created=false` and message `PENDING` with `providerMessageId=null` -> return `503 whatsapp_delivery_uncertain`, Meta zero calls;
- `created=false` otherwise -> return existing message, Meta zero calls;
- `created=true` -> call provider once.

Provider success path:

```ts
const providerResult = await providerGateway.sendMessage(...);
await repository.attachProviderMessage({
  shopId: session.shopId,
  messageId: claim.message.id,
  providerMessageId: providerResult.providerMessageId,
});

const sentMessage: WhatsAppMessage = {
  ...claim.message,
  providerMessageId: providerResult.providerMessageId,
  status: 'SENT',
};
```

Validate `sentMessage` with `assertWhatsAppMessageInvariant` before returning it.

If provider succeeded but attach/persist fails, return `503 whatsapp_delivery_uncertain` with `claim.message.id`; do not mark FAILED and do not resend.

Explicit `WhatsAppProviderError`:

```ts
failureCode:
  error.providerCode === null ? `HTTP_${error.httpStatus}` : String(error.providerCode),
failureMessage: error.safeMessage,
```

Call `failOutboundIntent` and return `502 whatsapp_provider_rejected` with durable message ID.

Generic provider transport exception: leave PENDING and return `503 whatsapp_delivery_uncertain`.

Never accept `kind`; Task 4 server supplies `'TEXT'`.

## Step 8 — Add Vercel adapter

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

## Step 9 — Run Task 4B GREEN

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

## Step 10 — Commit Task 4B

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
git rev-parse HEAD
```

Record the printed SHA.

---

# Task 4C — Browser remote implementation

**Files:**
- Create: `apps/operations/src/app/browserWhatsAppRemote.ts`
- Create: `apps/operations/src/app/browserWhatsAppRemote.test.ts`

**Consumes:** `WhatsAppRemoteGateway` and `WhatsAppInboxSnapshot` from `@tux/application`.

## Step 1 — Write browser RED

Tests must prove:
- every request uses `credentials: 'same-origin'` and `cache: 'no-store'`;
- `loadInbox()` performs `GET /api/whatsapp`;
- cursor is URL-encoded when supplied;
- `sendText` serializes only `action`, `businessDayId`, `workerId`, `conversationId`, `outboundIntentKey`, `text`;
- no `shopId`, `deviceId`, `sentByWorkerId`, recipient phone, provider phone, token, or `kind` appears in request JSON;
- `409 whatsapp_operator_not_synchronized` -> `WhatsAppOperatorNotSynchronizedError`;
- `409 whatsapp_outbound_intent_conflict` -> `WhatsAppOutboundIntentConflictError`;
- `503 whatsapp_delivery_uncertain` -> `WhatsAppDeliveryUncertainError` carrying only durable message ID;
- successful send validates `WhatsAppMessage` via `assertWhatsAppMessageInvariant`;
- mutations serialize only documented fields;
- `linkOrder` sends Current Operator claims but no authority-bearing shop/device fields.

Run:

```bash
npm test -- apps/operations/src/app/browserWhatsAppRemote.test.ts
```

Expected RED: FAIL because the module does not exist.

## Step 2 — Implement browser remote

Create `apps/operations/src/app/browserWhatsAppRemote.ts`:

```ts
import type { WhatsAppRemoteGateway } from '@tux/application';
import { assertWhatsAppMessageInvariant } from '@tux/domain';

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
  // implement every method of the exact shared contract
}
```

Use same-origin fetches with defensive JSON parsing. Do not import any server implementation module.

SEND_MESSAGE JSON must be exactly:

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

Archive default is explicit: when `archived` is omitted, serialize `archived: true`.

Map only documented safe error codes. Never expose raw provider/Supabase diagnostics.

## Step 3 — Run GREEN

```bash
npm test -- apps/operations/src/app/browserWhatsAppRemote.test.ts
npm run typecheck -w @tux/operations
```

Expected: PASS.

## Step 4 — Commit Task 4C

```bash
git add \
  apps/operations/src/app/browserWhatsAppRemote.ts \
  apps/operations/src/app/browserWhatsAppRemote.test.ts

git commit -m "feat: add browser WhatsApp remote client"
git rev-parse HEAD
```

Record the printed SHA.

---

# Final Task 4 Gate

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

Verify Task 2 migration unchanged:

```bash
git diff 9733cfd0a2f90030016f201b5b737a6d63b1056c..HEAD -- \
  supabase/migrations/20260902220000_whatsapp_inbox.sql
```

Expected: no output.

Verify Task 3 channel migration unchanged since creation:

```bash
CHANNEL_MIGRATION_COMMIT="$(git log --format=%H --reverse -- supabase/migrations/20260902223000_whatsapp_channels.sql | head -n 1)"
git diff "${CHANNEL_MIGRATION_COMMIT}"..HEAD -- \
  supabase/migrations/20260902223000_whatsapp_channels.sql
```

Expected: no output.

Verify obsolete routing shortcuts are absent:

```bash
git grep -n "TUX_WHATSAPP_SHOP_ID\|TUX_WHATSAPP_WORKER_ID\|TUX_WHATSAPP_PHONE_NUMBER_ID" -- \
  server api packages apps
```

Expected: no production-code routing matches.

Verify renderer/platform code contains no service-role env usage:

```bash
git grep -n "TUX_SUPABASE_SERVICE_ROLE_KEY\|SUPABASE_SERVICE_ROLE_KEY" -- \
  apps/operations packages/platform-contracts
```

Expected: no matches.

## Required Completion Report

Report exact command output and SHAs under these headings:

```text
TASK 4 COMPLETE

Task 4A RED
Task 4A GREEN
Task 4A commit SHA

Task 4B RED/GREEN
Task 4B commit SHA

Task 4C RED/GREEN
Task 4C commit SHA

Authority proof
- authoritative shopId/deviceId from device session only
- businessDayId/workerId are claims
- Current Operator preflight before channel lookup
- final Current Operator recheck plus row locks inside atomic claim
- worker_sessions.device_id not used as v1 Current Operator authority

Idempotency/recovery proof
- only newly-created intent can call Meta
- existing non-PENDING intent calls Meta zero times
- existing PENDING/no-provider-ID intent returns uncertainty and Meta zero times
- conflicting key reuse cannot replace worker/device/payload
- provider transport uncertainty does not auto-resend
- provider success plus provider-ID attach failure does not auto-resend

Routing proof
- authenticated shopId -> whatsapp_channels -> providerPhoneNumberId
- recipient phone from tenant-fenced conversation

Historical migrations modified
NO

Production deployment
NO

Environment variable names only
TUX_SUPABASE_URL
TUX_SUPABASE_SERVICE_ROLE_KEY
TUX_WHATSAPP_GRAPH_VERSION
TUX_WHATSAPP_ACCESS_TOKEN
TUX_WHATSAPP_WEBHOOK_VERIFY_TOKEN
TUX_WHATSAPP_APP_SECRET

Final focused tests
Migration gate
Typecheck
Lint
Format check
Working tree
```

Then **STOP before Task 5 production code**. Audit the original Task 5 against the exact `WhatsAppRemoteGateway` contract established here. Do not guess through any mismatch.
