# TUX Operations WhatsApp Inbox Task 4 Amendment

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` for Classic ChatGPT execution. This amendment supersedes **only Task 4** of `docs/superpowers/plans/2026-09-02-tux-operations-whatsapp-inbox.md`. Tasks 1-3 are not redone. After this amended Task 4 is complete and verified, stop for the normal pre-Task-5 plan/repository audit before writing Task 5 production code.

**Goal:** Add the authenticated Operations WhatsApp remote API with long-term-safe Current Operator verification, atomic outbound-intent claiming, deterministic shop-to-channel routing, and a typed browser remote client.

**Architecture:** The existing authenticated device session is authoritative for `shopId` and `deviceId`. `businessDayId` and `workerId` supplied by Operations are claims that must match the synchronized remote OPEN Business Day and Current Operator. The final current-operator check and new outbound-intent creation occur in one Postgres transaction so a worker switch cannot race between authorization and attribution. Only a newly claimed durable intent may call Meta; retries return the existing intent and never call Meta again.

**Tech Stack:** TypeScript 6, Vitest 4, Node/Vercel API handlers, Supabase/Postgres RPCs, WhatsApp Business Platform Cloud API, existing TUX device-session cookies.

**Primary spec:** `docs/superpowers/specs/2026-09-02-tux-operations-whatsapp-inbox-design.md`

**Binding authority spec:** `docs/superpowers/specs/2026-09-02-whatsapp-current-operator-authority-design.md`

**Binding channel spec:** `docs/superpowers/specs/2026-09-02-whatsapp-channel-tenant-resolution-design.md`

## Starting State and Preconditions

Before Task 4 RED, verify the implementation branch contains completed Task 1 and Task 2 and the completed Task 3 interfaces required below.

Task 1 permanent commit:

```text
4e92f421e8026ebfe7ea74c8d4fe101e0ac312ce
```

Task 2 permanent commit:

```text
9733cfd0a2f90030016f201b5b737a6d63b1056c
```

Task 3 must expose these interfaces from its approved amendment:

```ts
// server/whatsappChannelResolver.ts
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

// server/whatsappProviderGateway.ts
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

If Task 3 has not completed or its permanent interfaces materially differ from those binding interfaces, **STOP before Task 4 RED** and report the exact mismatch. Do not silently rename or redesign Task 3 during Task 4.

## Global Constraints

- Do not modify historical migrations `20260902220000_whatsapp_inbox.sql` or `20260902223000_whatsapp_channels.sql`.
- Add only append-only migration `supabase/migrations/20260902224500_whatsapp_current_worker_authority.sql` for Task 4 database authority/idempotency additions.
- `shopId` and `deviceId` come only from the authenticated device session.
- Request-body `businessDayId` and `workerId` are claims only and never sufficient authority.
- Current Operator must be synchronized remotely before an outbound message or worker-attributed order link is created.
- Final Current Operator verification and outbound-intent creation must be atomic in Postgres; a preflight resolver alone is not sufficient because it creates a time-of-check/time-of-use race.
- The current shared `WorkerSession` domain does not contain `deviceId`; do not make nullable remote `worker_sessions.device_id` a v1 authorization invariant.
- The authenticated device ID is still durable outbound audit attribution through `initiated_by_device_id`.
- Outbound channel routing is only `authenticated shopId -> whatsapp_channels -> providerPhoneNumberId`.
- Never accept a destination phone from the renderer for an existing conversation; recipient phone comes from the tenant-fenced conversation row.
- The same `(shopId, outboundIntentKey)` may never cause more than one provider call.
- Reusing an existing outbound intent key with a different conversation, payload, worker, or device is a conflict, never a resend.
- A provider transport uncertainty must not be blindly retried with the same durable intent. Preserve the PENDING intent and return a typed uncertainty response; a later retry of that intent returns the existing record without calling Meta.
- An explicit provider HTTP rejection represented by `WhatsAppProviderError` may mark the newly-created intent `FAILED` with safe error metadata.
- Task 4 outbound provider transport supports `TEXT` only because the approved Task 3 provider gateway is text-only. Media transport remains for the later media task; do not fake media support here.
- WhatsApp failures must never block Orders, Orders Board, Expenses, Bulk Stock, printing, Business Day, End Day, local sign-in/switch/sign-out, or outbox synchronization.
- No production migrations, Meta setup, Vercel secret changes, or manual production deployment in this task.
- Never ask the user to paste service-role keys, Meta tokens, JWTs, worker PINs, or Authorization headers.

---

## Amended Task 4A: Add Current Operator authority and atomic outbound-intent RPCs

**Files:**
- Create: `scripts/test-whatsapp-current-worker-migration.mjs`
- Create: `supabase/migrations/20260902224500_whatsapp_current_worker_authority.sql`
- Modify: `package.json`

**Consumes:**

```sql
public.business_days
public.worker_sessions
public.workers
public.devices
public.whatsapp_conversations
public.whatsapp_messages
public.link_tux_whatsapp_conversation_order_v1(...)
```

**Produces:**

```sql
public.resolve_tux_whatsapp_current_operator_v1(uuid, uuid, uuid)
public.claim_tux_whatsapp_outbound_intent_v2(...)
public.fail_tux_whatsapp_outbound_intent_v1(uuid, uuid, text, text)
public.link_tux_whatsapp_conversation_order_authorized_v1(...)
```

### Step 1: Write the migration contract RED first

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

assert.match(
  sql,
  /resolve_tux_whatsapp_current_operator_v1\s*\(\s*p_shop_id\s+uuid\s*,\s*p_business_day_id\s+uuid\s*,\s*p_claimed_worker_id\s+uuid\s*\)/i,
);
assert.match(sql, /business_day\.status\s*=\s*'OPEN'/i);
assert.match(sql, /worker_session\.ended_at\s+is\s+null/i);
assert.match(sql, /worker_session\.worker_id\s*=\s*p_claimed_worker_id/i);
assert.match(sql, /worker\.active/i);
assert.match(sql, /shop\.active/i);

assert.doesNotMatch(
  sql,
  /resolve_tux_whatsapp_current_operator_v1[\s\S]*p_device_id\s+uuid/i,
  'v1 Current Operator authority must not invent device binding absent from the canonical WorkerSession domain.',
);

assert.match(sql, /claim_tux_whatsapp_outbound_intent_v2/i);
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

### Step 2: Run RED

Run:

```bash
node scripts/test-whatsapp-current-worker-migration.mjs
```

Expected: FAIL exactly because `20260902224500_whatsapp_current_worker_authority.sql` does not exist.

Record this RED before creating the migration.

### Step 3: Create the Current Operator resolver

Create `supabase/migrations/20260902224500_whatsapp_current_worker_authority.sql` starting with:

```sql
-- TUX WhatsApp Current Operator authority and atomic outbound-intent claim.
-- Repository migration only. Do not deploy to a remote project from automated implementation tooling.

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
      where open_session.business_day_id = business_day.id
        and open_session.shop_id = shop.id
        and open_session.ended_at is null
    ) = 1
$$;

revoke all on function public.resolve_tux_whatsapp_current_operator_v1(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.resolve_tux_whatsapp_current_operator_v1(uuid, uuid, uuid)
  to service_role;
```

Do not add `p_device_id` to this resolver and do not check `worker_sessions.device_id`.

### Step 4: Add an atomic, conflict-detecting outbound-intent claim

Add a new function rather than changing Task 2's completed `create_tux_whatsapp_outbound_intent_v1` return type:

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

  select resolved.worker_id
    into v_verified_worker_id
  from public.resolve_tux_whatsapp_current_operator_v1(
    p_shop_id,
    p_business_day_id,
    p_claimed_worker_id
  ) resolved;

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

  if not v_created then
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
  else
    select message.*
      into v_message
    from public.whatsapp_messages message
    where message.shop_id = p_shop_id
      and message.id = v_message_id;
  end if;

  return query
  select
    v_created,
    v_recipient_normalized_phone,
    to_jsonb(v_message);
end;
$$;

revoke all on function public.claim_tux_whatsapp_outbound_intent_v2(
  uuid, uuid, uuid, uuid, uuid, text, text, text, text, jsonb, timestamptz
) from public, anon, authenticated;
grant execute on function public.claim_tux_whatsapp_outbound_intent_v2(
  uuid, uuid, uuid, uuid, uuid, text, text, text, text, jsonb, timestamptz
) to service_role;
```

This function is the final authority gate for new outbound intent creation. The HTTP server may perform a preflight Current Operator resolution for a clean `409`, but it must still use this atomic claim for the durable intent.

### Step 5: Add explicit authoritative provider-failure marking

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

  if found then
    return;
  end if;

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

Use this only after an explicit provider response represented by `WhatsAppProviderError`. Do not use it for network/transport uncertainty.

### Step 6: Add atomically worker-authorized order linking

The existing Task 2 link function takes a worker ID. Wrap it with Current Operator verification so renderer claims cannot become audit authority:

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
  select resolved.worker_id
    into v_verified_worker_id
  from public.resolve_tux_whatsapp_current_operator_v1(
    p_shop_id,
    p_business_day_id,
    p_claimed_worker_id
  ) resolved;

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

### Step 7: Run migration GREEN

Run:

```bash
node scripts/test-whatsapp-current-worker-migration.mjs
```

Expected: PASS.

### Step 8: Extend the root migration gate

Insert the new test immediately after the channel migration contract. Preserve all existing migration/security tests.

Expected root script shape:

```json
"test:migrations": "node scripts/test-migrations.mjs && node scripts/test-whatsapp-migration.mjs && node scripts/test-whatsapp-channel-migration.mjs && node scripts/test-whatsapp-current-worker-migration.mjs && node scripts/test-worker-pin-rate-limit.mjs && node scripts/test-bootstrap-request-provenance.mjs && node scripts/test-worker-menu-layout-migration.mjs"
```

Run:

```bash
npm run test:migrations
```

Expected: PASS.

### Step 9: Verify historical WhatsApp migrations are untouched

Run:

```bash
git diff 9733cfd0a2f90030016f201b5b737a6d63b1056c..HEAD -- \
  supabase/migrations/20260902220000_whatsapp_inbox.sql
```

Expected: no output.

After Task 3 is complete, also verify:

```bash
git diff <TASK_3A_COMMIT>..HEAD -- \
  supabase/migrations/20260902223000_whatsapp_channels.sql
```

Expected: no output.

### Step 10: Commit Task 4A

```bash
git add \
  scripts/test-whatsapp-current-worker-migration.mjs \
  supabase/migrations/20260902224500_whatsapp_current_worker_authority.sql \
  package.json

git commit -m "feat: add WhatsApp Current Operator authority"
```

Record the exact commit SHA.

---

## Amended Task 4B: Add the trusted Operations repository and authenticated server gateway

**Files:**
- Create: `server/whatsappOperationsRepository.ts`
- Create: `server/whatsappOperationsRepository.test.ts`
- Create: `server/whatsappOperationsGateway.ts`
- Create: `server/whatsappOperationsGateway.test.ts`
- Create: `api/whatsapp.ts`
- Modify: `server/whatsappServerConfig.ts`
- Modify: `server/whatsappServerConfig.test.ts`

**Consumes:**

```ts
requireServerConfig(...)
requireDeviceSession(...)
requireSameOrigin(...)
readJsonBody(...)
sendJson(...)
loadWhatsAppServerConfig(...)
WhatsAppChannelResolver.resolveOutboundChannel(...)
WhatsAppProviderGateway.sendMessage(...)
WhatsAppProviderError
```

**Produces:**

```ts
WhatsAppOperationsRepository
handleWhatsAppOperations(request, response, dependencies)
```

### Step 1: Add a data-plane config RED before repository implementation

Task 4 inbox reads and non-provider mutations require the trusted Supabase service boundary but must not unnecessarily require Meta tokens. Extend `server/whatsappServerConfig.test.ts` first:

```ts
it('loads the WhatsApp data-plane config without requiring Meta credentials', () => {
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

Expected: FAIL because `loadWhatsAppDataServerConfig` does not exist.

### Step 2: Add the narrow data-plane config loader

Modify `server/whatsappServerConfig.ts` to export:

```ts
export interface WhatsAppDataServerConfig {
  readonly projectUrl: string;
  readonly serviceRoleKey: string;
}

export function loadWhatsAppDataServerConfig(
  env: Readonly<Record<string, string | undefined>> = process.env,
): WhatsAppDataServerConfig;
```

It must use the same HTTPS URL validation and service-role fallback names already approved in Task 3:

```text
TUX_SUPABASE_URL / SUPABASE_URL
TUX_SUPABASE_SERVICE_ROLE_KEY / SUPABASE_SERVICE_ROLE_KEY
```

Refactor `loadWhatsAppServerConfig` to reuse this data-plane parser rather than duplicate URL/key parsing. Do not weaken Task 3 tests and do not expose secret values in errors.

Run:

```bash
npm test -- server/whatsappServerConfig.test.ts
```

Expected: PASS.

### Step 3: Write repository RED tests

Create `server/whatsappOperationsRepository.test.ts` with injected `fetch` and test-only keys.

The tests must prove these exact RPC requests:

Current Operator preflight:

```ts
await repository.resolveCurrentOperator({
  shopId,
  businessDayId,
  workerId,
});

expect(fetchMock).toHaveBeenCalledWith(
  'https://example.supabase.co/rest/v1/rpc/resolve_tux_whatsapp_current_operator_v1',
  expect.objectContaining({
    method: 'POST',
    body: JSON.stringify({
      p_shop_id: shopId,
      p_business_day_id: businessDayId,
      p_claimed_worker_id: workerId,
    }),
  }),
);
```

Atomic claim:

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

- successful resolver `[]` -> `null`;
- malformed resolver payload -> safe protocol error;
- claim response parses `{ created, recipient_normalized_phone, message_json }`;
- the repository never serializes a body-provided `shopId` outside the method's server-supplied `shopId` argument;
- `failOutboundIntent` uses `fail_tux_whatsapp_outbound_intent_v1`;
- `attachProviderMessage` uses existing Task 2 `attach_tux_whatsapp_provider_message_v1`;
- `loadInbox` uses existing Task 2 `get_tux_whatsapp_inbox_v1`;
- conversation state uses existing Task 2 `set_tux_whatsapp_conversation_state_v1`;
- `linkOrderAuthorized` uses the new authorized wrapper RPC;
- every RPC request uses the service credential only in `apikey` and `Authorization` headers and never in returned error text.

Run:

```bash
npm test -- server/whatsappOperationsRepository.test.ts
```

Expected: FAIL because `./whatsappOperationsRepository` does not exist.

### Step 4: Implement the repository boundary

Create `server/whatsappOperationsRepository.ts` with these public shapes:

```ts
import type {
  BusinessDayId,
  DeviceId,
  OrderId,
  ShopId,
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

Implement `SupabaseWhatsAppOperationsRepository` with constructor:

```ts
constructor(
  config: WhatsAppDataServerConfig,
  fetchImpl: typeof fetch = fetch,
)
```

Use the server-only service-role headers established by Task 3.

For `loadInbox`, parse the Task 2 `get_tux_whatsapp_inbox_v1` JSON object defensively into the domain camelCase model. Do not return raw snake_case database rows to the browser API.

Compute `nextCursor` as the greatest valid `updated_at` among returned message rows. If the response has no messages newer than `after`, preserve `after` as `nextCursor`. This avoids advancing a cursor beyond data that was actually observed.

For `WhatsAppConversation.linkedOrderId`, set it only when exactly one active order-link row exists for that conversation. If zero or more than one active link exists, return `null`; the separate `orderLinks` collection preserves all active links without guessing.

Call `assertWhatsAppMessageInvariant` on every parsed message before returning it.

### Step 5: Write authenticated gateway RED tests

Create `server/whatsappOperationsGateway.test.ts` using the existing `GatewayRequest`/`GatewayResponse` test style and dependency injection.

Required cases:

1. No valid device session -> existing `401` behavior; repository/channel/provider not called.
2. POST from disallowed Origin -> `403`; no mutation.
3. Any POST body containing `shopId`, `deviceId`, or `sentByWorkerId` -> `400 invalid_whatsapp_request`; those fields are never used as authority.
4. `SEND_MESSAGE` missing/invalid `businessDayId`, `workerId`, `conversationId`, `outboundIntentKey`, or non-empty `text` -> `400`.
5. Current Operator preflight returns null -> `409 { error: 'whatsapp_operator_not_synchronized' }`; no channel resolve, no claim, no Meta call.
6. Channel resolver returns null -> `503 { error: 'whatsapp_channel_not_configured' }`; no intent claim and no Meta call.
7. Claim RPC reports Current Operator race/conflict -> `409 whatsapp_operator_not_synchronized`; no Meta call.
8. New claim -> provider called exactly once with `providerPhoneNumberId` from channel resolver and `to` from `recipientNormalizedPhone` returned by the trusted claim RPC.
9. Existing claim (`created: false`) -> provider called zero times and existing message returned.
10. Same intent retry after a previous successful send -> provider called zero times.
11. Same intent key with different worker/device/payload causes repository conflict -> `409 whatsapp_outbound_intent_conflict`; provider called zero times.
12. `WhatsAppProviderError` on a newly-created intent -> `failOutboundIntent` called with safe code/message; response does not contain access token/provider raw diagnostic.
13. Generic transport exception after newly-created claim -> `503 { error: 'whatsapp_delivery_uncertain', messageId }`; `failOutboundIntent` not called; provider is not automatically retried.
14. `GET /api/whatsapp?after=...` needs only valid device session/data-plane config; it does not require Current Operator verification or Meta provider call.
15. `MARK_UNREAD`, `ARCHIVE`, and `FOLLOW_UP` are tenant-fenced by authenticated session `shopId` and never accept a body shop.
16. `LINK_ORDER` requires `businessDayId` + `workerId` claims and uses only `linkOrderAuthorized`; stale worker -> `409`.

For the successful send, assert the exact provider input:

```ts
expect(provider.sendMessage).toHaveBeenCalledWith({
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

Expected: FAIL because `./whatsappOperationsGateway` does not exist.

### Step 6: Implement the authenticated gateway

Create `server/whatsappOperationsGateway.ts`.

Export:

```ts
export interface WhatsAppOperationsDependencies {
  readonly repository: WhatsAppOperationsRepository;
  readonly channelResolver: WhatsAppChannelResolver;
  readonly providerGateway: WhatsAppProviderGateway;
  readonly now: () => Date;
}

export async function handleWhatsAppOperations(
  request: GatewayRequest,
  response: GatewayResponse,
  dependencies?: WhatsAppOperationsDependencies,
): Promise<void>;
```

Production dependency construction must use server-only config; tests inject fakes.

For every request:

1. `requireServerConfig(response)` for the existing publishable Supabase/device-session boundary.
2. `requireDeviceSession(request, response, config)` to obtain authoritative `session.shopId` and `session.deviceId`.
3. For POST only, require same-origin before mutation.
4. Never derive `shopId`, `deviceId`, recipient phone, or provider phone-number ID from the request body.

`GET` flow:

```text
device session
-> repository.loadInbox({ shopId: session.shopId, after })
-> 200 camelCase snapshot
```

Reject malformed `after` values with `400 invalid_whatsapp_request`; accept absent `after` as `null`.

`SEND_MESSAGE` flow is binding and ordered:

```text
device session
-> parse businessDayId + workerId claims
-> repository.resolveCurrentOperator(...)       // clean preflight
-> channelResolver.resolveOutboundChannel(shop) // no intent if channel missing
-> repository.claimOutboundTextIntent(...)      // atomic Current Operator re-check + insert/find
-> if created=false: return existing message, NO Meta call
-> provider.sendMessage(resolved channel + trusted recipient)
-> repository.attachProviderMessage(...)
-> return SENT message shape
```

If the atomic claim throws/returns the Current Operator synchronization code after preflight, map to `409 whatsapp_operator_not_synchronized`. This closes the preflight/worker-switch TOCTOU race.

Do not accept `kind` from the Task 4 browser client. This Task sends text only and the server supplies `kind: 'TEXT'` internally.

On explicit `WhatsAppProviderError`, mark the newly-created intent failed through `failOutboundIntent` using only safe values such as:

```ts
failureCode: error.providerCode === null ? `HTTP_${error.httpStatus}` : String(error.providerCode)
failureMessage: error.safeMessage
```

Return `502 { error: 'whatsapp_provider_rejected', messageId }`.

On a generic transport exception after the claim, leave the message PENDING and return:

```json
{
  "error": "whatsapp_delivery_uncertain",
  "messageId": "<durable-message-id>"
}
```

with HTTP `503`. Do not call Meta again for that same intent key on a later retry.

For `MARK_UNREAD`, `ARCHIVE`, and `FOLLOW_UP`, call `setConversationState` with authoritative session shop.

For `LINK_ORDER`, parse `businessDayId`, `workerId`, `conversationId`, `orderId`, and optional `linked` boolean, then call `linkOrderAuthorized` with authoritative `shopId` + `deviceId` from the device session.

### Step 7: Add the Vercel API adapter

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

No provider or service-role secret may appear in this file.

### Step 8: Run Task 4B GREEN

Run:

```bash
npm test -- \
  server/whatsappServerConfig.test.ts \
  server/whatsappOperationsRepository.test.ts \
  server/whatsappOperationsGateway.test.ts
```

Expected: PASS.

Then:

```bash
npm run typecheck
npm run lint
```

Expected: PASS.

### Step 9: Commit Task 4B

```bash
git add \
  server/whatsappServerConfig.ts \
  server/whatsappServerConfig.test.ts \
  server/whatsappOperationsRepository.ts \
  server/whatsappOperationsRepository.test.ts \
  server/whatsappOperationsGateway.ts \
  server/whatsappOperationsGateway.test.ts \
  api/whatsapp.ts

git commit -m "feat: add authenticated WhatsApp Operations gateway"
```

Record the exact commit SHA.

---

## Amended Task 4C: Add the typed browser WhatsApp remote client

**Files:**
- Create: `apps/operations/src/app/browserWhatsAppRemote.ts`
- Create: `apps/operations/src/app/browserWhatsAppRemote.test.ts`

**Consumes HTTP contract:**

```text
GET  /api/whatsapp?after=<cursor>
POST /api/whatsapp SEND_MESSAGE
POST /api/whatsapp MARK_UNREAD
POST /api/whatsapp ARCHIVE
POST /api/whatsapp FOLLOW_UP
POST /api/whatsapp LINK_ORDER
```

**Produces:**

```ts
BrowserWhatsAppRemote
WhatsAppOperatorNotSynchronizedError
WhatsAppDeliveryUncertainError
```

### Step 1: Write browser remote RED tests

Create `apps/operations/src/app/browserWhatsAppRemote.test.ts` with mocked `fetch`.

Required assertions:

- every request uses `credentials: 'same-origin'` and `cache: 'no-store'`;
- `loadInbox()` performs `GET /api/whatsapp`;
- `loadInbox(cursor)` URL-encodes `after`;
- `sendText` serializes only `action`, `businessDayId`, `workerId`, `conversationId`, `outboundIntentKey`, and `text`;
- `sendText` does **not** serialize `shopId`, `deviceId`, `sentByWorkerId`, recipient phone, provider phone number, access token, or `kind`;
- `409 whatsapp_operator_not_synchronized` throws `WhatsAppOperatorNotSynchronizedError`;
- `503 whatsapp_delivery_uncertain` throws `WhatsAppDeliveryUncertainError` carrying only the durable `messageId`;
- successful send parses and validates a `WhatsAppMessage` with `assertWhatsAppMessageInvariant`;
- inbox response is already camelCase and parsed defensively before use;
- conversation mutation methods serialize only their documented fields;
- `linkOrder` carries `businessDayId` + `workerId` claims but no authority-bearing shop/device field.

Run:

```bash
npm test -- apps/operations/src/app/browserWhatsAppRemote.test.ts
```

Expected: FAIL because `./browserWhatsAppRemote` does not exist.

### Step 2: Implement the typed client

Create `apps/operations/src/app/browserWhatsAppRemote.ts` with:

```ts
import type {
  BusinessDayId,
  OrderId,
  WhatsAppMessage,
  WorkerId,
} from '@tux/domain';
import type { WhatsAppInboxSnapshot } from '../../../../server/whatsappOperationsRepository';

export class WhatsAppOperatorNotSynchronizedError extends Error {}

export class WhatsAppDeliveryUncertainError extends Error {
  readonly messageId: string;

  constructor(messageId: string) {
    super('WhatsApp delivery is not confirmed yet.');
    this.name = 'WhatsAppDeliveryUncertainError';
    this.messageId = messageId;
  }
}

export interface BrowserWhatsAppRemote {
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

Do **not** import server runtime code into the browser bundle. If importing the type across the server path causes the bundler/type boundary to include server code, move only the shared DTO type into a type-only file under `packages/application` or `packages/platform-contracts` during this task, with a focused typecheck test. Do not import Node-only implementations into the renderer.

For every mutation use:

```ts
fetch('/api/whatsapp', {
  method: 'POST',
  credentials: 'same-origin',
  cache: 'no-store',
  headers: {
    accept: 'application/json',
    'content-type': 'application/json',
  },
  body: JSON.stringify(...),
});
```

`sendText` body must be exactly:

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

Map server errors deterministically. Do not expose raw server/provider diagnostics in thrown browser errors.

### Step 3: Run browser GREEN

Run:

```bash
npm test -- apps/operations/src/app/browserWhatsAppRemote.test.ts
```

Expected: PASS.

Run:

```bash
npm run typecheck -w @tux/operations
```

Expected: PASS.

### Step 4: Run the complete Task 4 focused gate

Run:

```bash
npm test -- \
  server/whatsappServerConfig.test.ts \
  server/whatsappChannelResolver.test.ts \
  server/whatsappProviderGateway.test.ts \
  server/whatsappOperationsRepository.test.ts \
  server/whatsappOperationsGateway.test.ts \
  apps/operations/src/app/browserWhatsAppRemote.test.ts
```

Expected: PASS.

Then:

```bash
npm run test:migrations
npm run typecheck
npm run lint
npm run format:check
```

Expected: PASS for every command.

### Step 5: Security/source checks

Run:

```bash
git grep -n "TUX_WHATSAPP_SHOP_ID\|TUX_WHATSAPP_WORKER_ID\|TUX_WHATSAPP_PHONE_NUMBER_ID" -- \
  server api packages apps
```

Expected: no production-code routing matches.

Run:

```bash
git grep -n "serviceRoleKey\|TUX_SUPABASE_SERVICE_ROLE_KEY\|SUPABASE_SERVICE_ROLE_KEY" -- \
  apps/operations packages/platform-contracts
```

Expected: no secret-bearing renderer/platform-contract implementation.

Run:

```bash
git diff 9733cfd0a2f90030016f201b5b737a6d63b1056c..HEAD -- \
  supabase/migrations/20260902220000_whatsapp_inbox.sql
```

Expected: no output.

### Step 6: Commit Task 4C

```bash
git add \
  apps/operations/src/app/browserWhatsAppRemote.ts \
  apps/operations/src/app/browserWhatsAppRemote.test.ts

git commit -m "feat: add browser WhatsApp remote client"
```

If a shared type-only DTO file was required by the renderer boundary, include that exact file in this commit and report why it was necessary.

---

## Task 4 Completion Gate

Before reporting Task 4 complete, run fresh verification from the final Task 4 HEAD:

```bash
npm test -- \
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

Verify the working tree:

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

Verify the obsolete authority/routing variables are absent from production code:

```bash
git grep -n "TUX_WHATSAPP_SHOP_ID\|TUX_WHATSAPP_WORKER_ID\|TUX_WHATSAPP_PHONE_NUMBER_ID" -- \
  server api packages apps
```

Expected: no production-code matches.

## Required Task 4 Report

Report exactly:

```text
TASK 4 COMPLETE

Task 4A migration RED:
<command>
<expected failure>

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
- shopId from authenticated device session only
- deviceId from authenticated device session only
- businessDayId/workerId treated as claims
- Current Operator rechecked atomically inside outbound intent claim
- worker_sessions.device_id NOT used as v1 authority

Idempotency proof:
- newly-created intent calls Meta once
- existing intent calls Meta zero times
- conflicting key reuse cannot change worker/device/payload
- transport uncertainty leaves durable PENDING intent and does not auto-resend

Channel proof:
- authenticated shopId -> whatsapp_channels -> providerPhoneNumberId
- recipient phone comes from tenant-fenced conversation, not request body

Historical migrations modified:
NO

Production deployment:
NO

Environment variable NAMES required by the completed WhatsApp server path:
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
<clean or exact explanation>
```

Then **STOP before Task 5 production code** and perform the original Task 5 pre-implementation audit against the Current Operator/browser remote contracts now established by this amendment. Do not guess through a Task 5 mismatch.