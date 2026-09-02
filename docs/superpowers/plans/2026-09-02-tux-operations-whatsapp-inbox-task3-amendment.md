# TUX Operations WhatsApp Inbox Task 3 Amendment

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans for Classic ChatGPT execution. This amendment supersedes **only Task 3** of `docs/superpowers/plans/2026-09-02-tux-operations-whatsapp-inbox.md`. Tasks 1 and 2 remain complete. After this amended Task 3 is complete and verified, resume the original plan at Task 4.

**Goal:** Build the server-side Meta provider gateway and verified webhook materializer with deterministic `provider_phone_number_id -> shop_id` tenant resolution before any inbound WhatsApp state mutation.

**Architecture:** Introduce `public.whatsapp_channels` as the server-side provider-channel ownership map. Inbound webhooks verify the Meta signature first, resolve `metadata.phone_number_id` to exactly one active TUX shop through a trusted resolver, then call the existing Task 2 tenant-fenced materialization RPC. Outbound provider calls receive the already-resolved provider phone-number ID from the server-side channel resolver; no environment variable or client body chooses the tenant/channel.

**Tech Stack:** TypeScript 6, Vitest 4, Node crypto/HTTP streams, Vercel Node Functions, Supabase/Postgres RPCs, WhatsApp Business Platform Cloud API.

**Primary spec:** `docs/superpowers/specs/2026-09-02-tux-operations-whatsapp-inbox-design.md`

**Binding correction:** `docs/superpowers/specs/2026-09-02-whatsapp-channel-tenant-resolution-design.md`

## Starting State

- Task 1 permanent commit: `4e92f421e8026ebfe7ea74c8d4fe101e0ac312ce`.
- Task 2 permanent commit: `9733cfd0a2f90030016f201b5b737a6d63b1056c`.
- Do not modify or redo either commit.
- The implementer already recorded a valid provider-gateway RED on its isolated diagnostic branch:

```text
npm test -- server/whatsappProviderGateway.test.ts
FAIL: Cannot find module './whatsappProviderGateway'
ERR_MODULE_NOT_FOUND
```

That RED remains valid evidence. The diagnostic test used the original Task 3 method name `sendMessage`; this amendment preserves that method name and `createWhatsAppProviderGateway` factory so downstream Task 4 does not inherit a needless interface rename.

## Global Constraints

- Do not modify `supabase/migrations/20260902220000_whatsapp_inbox.sql`.
- Add only append-only migration `supabase/migrations/20260902223000_whatsapp_channels.sql` for channel ownership.
- Inbound tenant authority is `META_CLOUD_API + metadata.phone_number_id -> active whatsapp_channels row -> shop_id`.
- Customer/sender phone, conversation search, request body, first shop, only shop, or environment-supplied shop ID must never choose a tenant.
- V1 permits exactly one active WhatsApp channel per shop.
- `(provider, provider_phone_number_id)` uniquely identifies a provider channel globally.
- Invalid/missing webhook POST signature returns HTTP `401` and performs no tenant resolution or mutation.
- Verified webhook with unknown/inactive `phone_number_id` returns HTTP `200` and performs no tenant mutation.
- Outbound routing begins from authenticated TUX `shop_id`; renderer/client code never chooses authoritative `shop_id` or `provider_phone_number_id`.
- `TUX_WHATSAPP_PHONE_NUMBER_ID` is not a production routing input and must not be required by the provider gateway.
- `TUX_WHATSAPP_SHOP_ID` must not exist as a routing shortcut.
- Provider/Meta secrets and the trusted Supabase service credential remain server-side only. Never print, return, log, commit, or request their values in chat.
- No production migration deployment, Meta webhook registration, or Vercel secret configuration is performed during this task.
- No AI/chatbot/order-text parsing.
- WhatsApp failure must remain isolated from Orders, Business Day, End Day, printing, Expenses, and Bulk Stock.

---

## Amended Task 3A: Add WhatsApp channel ownership persistence and resolver RPCs

**Files:**
- Create: `scripts/test-whatsapp-channel-migration.mjs`
- Create: `supabase/migrations/20260902223000_whatsapp_channels.sql`
- Modify: `package.json`

**Interfaces produced:**

```sql
public.whatsapp_channels
public.resolve_tux_whatsapp_inbound_channel_v1(text, text)
public.resolve_tux_whatsapp_outbound_channel_v1(uuid)
```

### Step 1: Write the migration contract test first

Create `scripts/test-whatsapp-channel-migration.mjs`:

```js
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migrationPath = resolve(
  'supabase/migrations/20260902223000_whatsapp_channels.sql',
);

assert.equal(
  existsSync(migrationPath),
  true,
  '20260902223000_whatsapp_channels.sql is missing.',
);

const sql = readFileSync(migrationPath, 'utf8');

assert.match(sql, /create\s+table\s+public\.whatsapp_channels/i);
assert.match(sql, /provider\s+text\s+not\s+null/i);
assert.match(sql, /provider_phone_number_id\s+text\s+not\s+null/i);
assert.match(sql, /active\s+boolean\s+not\s+null\s+default\s+true/i);

assert.match(
  sql,
  /unique\s*\(\s*provider\s*,\s*provider_phone_number_id\s*\)/i,
  'provider identity must resolve to one channel row globally.',
);

assert.match(
  sql,
  /create\s+unique\s+index\s+whatsapp_channels_one_active_per_shop\s+on\s+public\.whatsapp_channels\s*\(\s*shop_id\s*\)\s+where\s+active\s*(?:=\s*true)?\s*;/i,
  'v1 must allow at most one active WhatsApp channel per shop.',
);

assert.match(sql, /enable\s+row\s+level\s+security/i);
assert.match(sql, /revoke\s+all\s+on\s+table\s+public\.whatsapp_channels/i);
assert.match(sql, /resolve_tux_whatsapp_inbound_channel_v1/i);
assert.match(sql, /resolve_tux_whatsapp_outbound_channel_v1/i);
assert.match(sql, /security\s+definer/i);
assert.match(sql, /grant\s+execute[\s\S]*service_role/i);

assert.doesNotMatch(
  sql,
  /TUX_WHATSAPP_SHOP_ID/i,
  'tenant resolution must not be encoded as a deployment shop variable.',
);
```

### Step 2: Run migration RED

```bash
node scripts/test-whatsapp-channel-migration.mjs
```

Expected: FAIL exactly because `20260902223000_whatsapp_channels.sql` does not exist.

Record this RED before creating the migration.

### Step 3: Create the append-only channel migration

Create `supabase/migrations/20260902223000_whatsapp_channels.sql` with:

```sql
create table public.whatsapp_channels (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  provider text not null
    check (provider = 'META_CLOUD_API'),
  provider_phone_number_id text not null
    check (btrim(provider_phone_number_id) <> ''),
  business_phone_e164 text
    check (
      business_phone_e164 is null
      or business_phone_e164 ~ '^[+][1-9][0-9]{7,14}$'
    ),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, provider_phone_number_id)
);

create unique index whatsapp_channels_one_active_per_shop
  on public.whatsapp_channels (shop_id)
  where active = true;

alter table public.whatsapp_channels enable row level security;
revoke all on table public.whatsapp_channels from public, anon, authenticated;
```

Add the inbound resolver:

```sql
create or replace function public.resolve_tux_whatsapp_inbound_channel_v1(
  p_provider text,
  p_provider_phone_number_id text
)
returns table(channel_id uuid, shop_id uuid)
language sql
security definer
set search_path = pg_catalog, public, private
as $$
  select channel.id, channel.shop_id
  from public.whatsapp_channels channel
  join public.shops shop on shop.id = channel.shop_id
  where channel.provider = p_provider
    and channel.provider_phone_number_id = p_provider_phone_number_id
    and channel.active
    and shop.active
  limit 1
$$;

revoke all on function public.resolve_tux_whatsapp_inbound_channel_v1(text, text)
  from public, anon, authenticated;
grant execute on function public.resolve_tux_whatsapp_inbound_channel_v1(text, text)
  to service_role;
```

Add the outbound resolver:

```sql
create or replace function public.resolve_tux_whatsapp_outbound_channel_v1(
  p_shop_id uuid
)
returns table(
  channel_id uuid,
  provider text,
  provider_phone_number_id text
)
language sql
security definer
set search_path = pg_catalog, public, private
as $$
  select channel.id, channel.provider, channel.provider_phone_number_id
  from public.whatsapp_channels channel
  join public.shops shop on shop.id = channel.shop_id
  where channel.shop_id = p_shop_id
    and channel.active
    and shop.active
  limit 1
$$;

revoke all on function public.resolve_tux_whatsapp_outbound_channel_v1(uuid)
  from public, anon, authenticated;
grant execute on function public.resolve_tux_whatsapp_outbound_channel_v1(uuid)
  to service_role;
```

Do not add broad table grants for `anon` or `authenticated`.

### Step 4: Run migration GREEN

```bash
node scripts/test-whatsapp-channel-migration.mjs
```

Expected: PASS.

### Step 5: Extend the migration gate

Set root `test:migrations` to:

```json
"test:migrations": "node scripts/test-migrations.mjs && node scripts/test-whatsapp-migration.mjs && node scripts/test-whatsapp-channel-migration.mjs && node scripts/test-worker-pin-rate-limit.mjs && node scripts/test-bootstrap-request-provenance.mjs && node scripts/test-worker-menu-layout-migration.mjs"
```

Do not remove or weaken any existing migration/security test.

### Step 6: Run migration gate

```bash
npm run test:migrations
```

Expected: PASS.

If the isolated migration database reports a syntax/role problem, fix the new migration only. Never rewrite historical migrations.

### Step 7: Commit Task 3A

```bash
git add \
  scripts/test-whatsapp-channel-migration.mjs \
  supabase/migrations/20260902223000_whatsapp_channels.sql \
  package.json

git commit -m "feat: add WhatsApp channel tenant resolution"
```

Record the SHA.

---

## Amended Task 3B: Add trusted server config, channel resolver, and provider gateway

**Files:**
- Create: `server/whatsappServerConfig.ts`
- Create: `server/whatsappServerConfig.test.ts`
- Create: `server/whatsappChannelResolver.ts`
- Create: `server/whatsappChannelResolver.test.ts`
- Create: `server/whatsappProviderGateway.ts`
- Continue the already-created diagnostic contract in: `server/whatsappProviderGateway.test.ts`

**Environment names consumed by production server code:**

```text
TUX_SUPABASE_URL
TUX_SUPABASE_SERVICE_ROLE_KEY
TUX_WHATSAPP_GRAPH_VERSION
TUX_WHATSAPP_ACCESS_TOKEN
TUX_WHATSAPP_WEBHOOK_VERIFY_TOKEN
TUX_WHATSAPP_APP_SECRET
```

Allowed server-only fallback names:

```text
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
```

Explicitly absent from production routing:

```text
TUX_WHATSAPP_PHONE_NUMBER_ID
TUX_WHATSAPP_SHOP_ID
```

Never ask the user to paste secret values into chat.

### Step 1: Preserve and update the already-recorded provider RED contract

The existing diagnostic test already proved the provider module is missing. Preserve its public method/factory names:

```ts
createWhatsAppProviderGateway(...)
gateway.sendMessage(...)
WhatsAppProviderError
```

Before writing production code, update only the routing shape in that test from constructor-level `phoneNumberId` to per-send `providerPhoneNumberId`:

```ts
const gateway = createWhatsAppProviderGateway(
  { graphVersion, accessToken },
  fetchMock,
);

await gateway.sendMessage({
  providerPhoneNumberId: phoneNumberId,
  to: '01012345678',
  kind: 'TEXT',
  text: 'Order ready',
});
```

Keep the existing assertion that the provider boundary converts the canonical Egyptian local phone to Meta recipient form `201012345678`.

Keep the existing safe-error assertion for:

```ts
WhatsAppProviderError
httpStatus
providerCode
safeMessage
```

The test must contain no dependency on `TUX_WHATSAPP_PHONE_NUMBER_ID`.

### Step 2: Write server-config RED tests

Create `server/whatsappServerConfig.test.ts`:

```ts
it('loads server-only config without a phone-number routing env', () => {
  const config = loadWhatsAppServerConfig({
    TUX_SUPABASE_URL: 'https://example.supabase.co',
    TUX_SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
    TUX_WHATSAPP_GRAPH_VERSION: 'v99.0',
    TUX_WHATSAPP_ACCESS_TOKEN: 'test-meta-token',
    TUX_WHATSAPP_WEBHOOK_VERIFY_TOKEN: 'test-verify-token',
    TUX_WHATSAPP_APP_SECRET: 'test-app-secret',
  });

  expect(config).toMatchObject({
    projectUrl: 'https://example.supabase.co',
    graphVersion: 'v99.0',
  });
  expect('phoneNumberId' in config).toBe(false);
});

it('rejects missing trusted Supabase service credentials', () => {
  expect(() =>
    loadWhatsAppServerConfig({
      TUX_SUPABASE_URL: 'https://example.supabase.co',
      TUX_WHATSAPP_GRAPH_VERSION: 'v99.0',
      TUX_WHATSAPP_ACCESS_TOKEN: 'test-meta-token',
      TUX_WHATSAPP_WEBHOOK_VERIFY_TOKEN: 'test-verify-token',
      TUX_WHATSAPP_APP_SECRET: 'test-app-secret',
    }),
  ).toThrow('WhatsApp server configuration is incomplete.');
});
```

Run:

```bash
npm test -- server/whatsappServerConfig.test.ts
```

Expected: FAIL because `./whatsappServerConfig` does not exist.

### Step 3: Implement server-only config loading

Create `server/whatsappServerConfig.ts`:

```ts
export interface WhatsAppServerConfig {
  readonly projectUrl: string;
  readonly serviceRoleKey: string;
  readonly graphVersion: string;
  readonly accessToken: string;
  readonly webhookVerifyToken: string;
  readonly appSecret: string;
}

export function loadWhatsAppServerConfig(
  env: Readonly<Record<string, string | undefined>> = process.env,
): WhatsAppServerConfig;
```

The implementation must:

- require HTTPS `TUX_SUPABASE_URL` or `SUPABASE_URL`;
- require `TUX_SUPABASE_SERVICE_ROLE_KEY` or `SUPABASE_SERVICE_ROLE_KEY`;
- require all four Meta values shown above;
- trim configured values;
- return no shop ID or provider phone-number routing value;
- never log secrets.

### Step 4: Write channel-resolver RED tests

Create `server/whatsappChannelResolver.test.ts` with an injected `fetch`.

Inbound known channel:

```ts
const resolved = await resolver.resolveInboundChannel({
  provider: 'META_CLOUD_API',
  providerPhoneNumberId: '123456789',
});

expect(fetchMock).toHaveBeenCalledWith(
  'https://example.supabase.co/rest/v1/rpc/resolve_tux_whatsapp_inbound_channel_v1',
  expect.objectContaining({
    method: 'POST',
    body: JSON.stringify({
      p_provider: 'META_CLOUD_API',
      p_provider_phone_number_id: '123456789',
    }),
  }),
);

expect(resolved).toEqual({
  channelId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  shopId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
});
```

Also prove:

- successful `[]` inbound result -> `null`;
- outbound resolver serializes only `p_shop_id`;
- Shop A and Shop B produce distinct RPC bodies;
- non-2xx or malformed successful payload throws a safe server error instead of falling back to another tenant.

Run:

```bash
npm test -- server/whatsappChannelResolver.test.ts
```

Expected: FAIL because `./whatsappChannelResolver` does not exist.

### Step 5: Implement the server-only channel resolver

Create `server/whatsappChannelResolver.ts`:

```ts
import type { ShopId } from '@tux/domain';

export type WhatsAppProvider = 'META_CLOUD_API';

export interface WhatsAppResolvedInboundChannel {
  readonly channelId: string;
  readonly shopId: ShopId;
}

export interface WhatsAppResolvedOutboundChannel {
  readonly channelId: string;
  readonly provider: WhatsAppProvider;
  readonly providerPhoneNumberId: string;
}

export interface WhatsAppChannelResolver {
  resolveInboundChannel(input: {
    readonly provider: WhatsAppProvider;
    readonly providerPhoneNumberId: string;
  }): Promise<WhatsAppResolvedInboundChannel | null>;

  resolveOutboundChannel(input: {
    readonly shopId: ShopId;
  }): Promise<WhatsAppResolvedOutboundChannel | null>;
}
```

Implement `SupabaseWhatsAppChannelResolver` with injected `fetch`, `projectUrl`, and `serviceRoleKey`.

Every trusted RPC request uses:

```ts
headers: {
  apikey: serviceRoleKey,
  Authorization: `Bearer ${serviceRoleKey}`,
  'Content-Type': 'application/json',
}
```

A successful empty array means `null`. No arbitrary first-shop or first-conversation fallback is permitted. Error text must never contain the service credential.

### Step 6: Implement provider gateway against the existing RED

Create `server/whatsappProviderGateway.ts` with the already-bound factory/method names:

```ts
export interface WhatsAppProviderGatewayConfig {
  readonly graphVersion: string;
  readonly accessToken: string;
}

export type SendWhatsAppMessageInput = {
  readonly providerPhoneNumberId: string;
  readonly to: string;
  readonly kind: 'TEXT';
  readonly text: string;
};

export interface WhatsAppProviderGateway {
  sendMessage(
    input: SendWhatsAppMessageInput,
  ): Promise<{ providerMessageId: string }>;
}

export function createWhatsAppProviderGateway(
  config: WhatsAppProviderGatewayConfig,
  fetchImpl: typeof fetch = fetch,
): WhatsAppProviderGateway;
```

Keep/export the diagnostic-test error contract:

```ts
export class WhatsAppProviderError extends Error {
  readonly httpStatus: number;
  readonly providerCode: number | null;
  readonly safeMessage: string;
}
```

The Meta URL is:

```ts
`https://graph.facebook.com/${config.graphVersion}/${input.providerPhoneNumberId}/messages`
```

For `kind: 'TEXT'`, body is:

```ts
{
  messaging_product: 'whatsapp',
  recipient_type: 'individual',
  to: providerRecipient,
  type: 'text',
  text: { body: input.text },
}
```

Use the shared Egyptian phone normalization contract at this provider boundary and send the international digits without leading `+` (for example `01012345678 -> 201012345678`). Invalid phone input must fail before the provider call.

Never read `TUX_WHATSAPP_PHONE_NUMBER_ID` inside this module.

Provider failures may retain safe numeric status/code fields but must never expose the access token, Authorization header, or raw provider diagnostic if it contains secrets.

### Step 7: Run Task 3B GREEN

```bash
npm test -- \
  server/whatsappServerConfig.test.ts \
  server/whatsappChannelResolver.test.ts \
  server/whatsappProviderGateway.test.ts
```

Expected: PASS.

Then:

```bash
npm run typecheck
```

Expected: PASS.

### Step 8: Commit Task 3B

```bash
git add \
  server/whatsappServerConfig.ts \
  server/whatsappServerConfig.test.ts \
  server/whatsappChannelResolver.ts \
  server/whatsappChannelResolver.test.ts \
  server/whatsappProviderGateway.ts \
  server/whatsappProviderGateway.test.ts

git commit -m "feat: add WhatsApp channel and provider gateways"
```

Record the SHA.

---

## Amended Task 3C: Add verified Meta webhook parsing and tenant-fenced materialization

**Files:**
- Create: `server/whatsappWebhook.ts`
- Create: `server/whatsappWebhook.test.ts`
- Create: `api/whatsapp-webhook.ts`

**Interfaces consumed:**

```ts
WhatsAppChannelResolver.resolveInboundChannel(...)
normalizeEgyptianPhone(raw)
public.materialize_tux_whatsapp_inbound_v1(...)
```

**Interface produced:**

```ts
handleWhatsAppWebhook(input, dependencies): Promise<WhatsAppWebhookResult>
```

### Step 1: Write webhook RED tests

Create `server/whatsappWebhook.test.ts` with injected:

- `appSecret`;
- `webhookVerifyToken`;
- `channelResolver`;
- `materializer`;
- safe diagnostic sink.

HMAC helper:

```ts
import { createHmac } from 'node:crypto';

function signatureFor(rawBody: Buffer, appSecret: string): string {
  return `sha256=${createHmac('sha256', appSecret).update(rawBody).digest('hex')}`;
}
```

Required tests:

1. POST missing signature -> `401`, resolver not called, materializer not called.
2. POST invalid signature -> `401`, resolver not called, materializer not called.
3. Valid signature + known `metadata.phone_number_id` -> resolver called before materializer and resolved `shopId` passed to materializer.
4. Valid signature + unknown/inactive channel -> `200`, materializer not called.
5. Changing sender/customer phone cannot change resolver input; resolver input remains only `{ provider: 'META_CLOUD_API', providerPhoneNumberId }`.
6. Duplicate provider message delivery reuses Task 2 RPC idempotency; webhook code does not invent a cross-tenant/global message lookup.
7. Verification GET with matching `hub.verify_token` returns `hub.challenge`; mismatched token returns `403`.

Use this minimal valid text fixture:

```ts
const payload = {
  object: 'whatsapp_business_account',
  entry: [
    {
      id: 'waba-1',
      changes: [
        {
          field: 'messages',
          value: {
            messaging_product: 'whatsapp',
            metadata: {
              display_phone_number: '201012345678',
              phone_number_id: 'provider-phone-1',
            },
            contacts: [{ wa_id: '201012345678', profile: { name: 'Ahmed' } }],
            messages: [
              {
                from: '201012345678',
                id: 'wamid.test-1',
                timestamp: '1788375600',
                type: 'text',
                text: { body: 'مساء الخير' },
              },
            ],
          },
        },
      ],
    },
  ],
};
```

Run:

```bash
npm test -- server/whatsappWebhook.test.ts
```

Expected: FAIL because `./whatsappWebhook` does not exist.

### Step 2: Implement constant-time signature verification over raw bytes

Verify the exact POST bytes before JSON parsing.

Use `createHmac` and `timingSafeEqual`.

The verifier must:

- require `sha256=` prefix;
- compute expected HMAC over the raw `Buffer`;
- reject byte-length mismatch before `timingSafeEqual`;
- return false without secret-bearing diagnostics.

### Step 3: Parse only verified provider payloads

After signature success:

- parse JSON;
- require `metadata.phone_number_id` for materializable inbound messages;
- resolve the provider channel before customer lookup/normalization-driven matching;
- normalize sender identity with the shared `normalizeEgyptianPhone` contract after shop resolution;
- invalid sender phone -> acknowledge safely, no customer/message state, safe diagnostic only;
- translate Meta text/image/document/audio/location shapes into the existing Task 2 RPC fields.

Text translation:

```ts
{
  kind: 'TEXT',
  text: providerMessage.text.body,
  mediaRef: null,
  mediaMetadata: {},
}
```

Image/document/audio: persist provider media identifier as `mediaRef` plus safe metadata only; do not download media in Task 3.

Location: persist structured latitude/longitude/name/address in `mediaMetadata`; never treat it as confirmed delivery-address truth.

### Step 4: Enforce tenant-resolution order

Mandatory order:

```text
raw body
-> signature verification
-> JSON parse
-> metadata.phone_number_id
-> channelResolver.resolveInboundChannel(...)
-> resolved shopId
-> normalize sender phone
-> materialize_tux_whatsapp_inbound_v1(shopId, ...)
```

Unknown/inactive channel behavior:

```text
HTTP 200
no tenant selected
no Task 2 materialization call
safe configuration diagnostic only
```

### Step 5: Add trusted Task 2 materializer adapter

Call:

```text
POST ${projectUrl}/rest/v1/rpc/materialize_tux_whatsapp_inbound_v1
```

using server-only service credentials and exact Task 2 body names:

```ts
{
  p_shop_id: shopId,
  p_provider_message_id: providerMessageId,
  p_normalized_phone: phone.normalizedPhone,
  p_display_phone: phone.displayPhone,
  p_kind: kind,
  p_text: text,
  p_media_ref: mediaRef,
  p_media_metadata: mediaMetadata,
  p_provider_occurred_at: providerOccurredAt,
}
```

Do not expose this trusted RPC credential to browser/device code.

### Step 6: Add thin Vercel webhook route with raw-body handling

Create `api/whatsapp-webhook.ts`.

For POST, read the Node `IncomingMessage` stream into a `Buffer` with hard maximum 1 MiB. Never recreate signature bytes with `JSON.stringify(request.body)`.

Use:

```ts
async function readRawBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += buffer.length;
    if (length > 1_048_576) throw new Error('WHATSAPP_WEBHOOK_BODY_TOO_LARGE');
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}
```

The route loads `WhatsAppServerConfig`, constructs the server-side channel resolver/materializer dependencies, and writes only safe status/body output.

GET verification validates the configured verify token and does not require POST HMAC.

### Step 7: Run Task 3C GREEN and related gates

```bash
npm test -- server/whatsappWebhook.test.ts
```

Expected: PASS.

Then:

```bash
npm test -- \
  server/whatsappServerConfig.test.ts \
  server/whatsappChannelResolver.test.ts \
  server/whatsappProviderGateway.test.ts \
  server/whatsappWebhook.test.ts

npm run typecheck
npm run lint
npm run test:migrations
```

Expected: PASS for all.

### Step 8: Commit Task 3C

```bash
git add \
  server/whatsappWebhook.ts \
  server/whatsappWebhook.test.ts \
  api/whatsapp-webhook.ts

git commit -m "feat: add tenant-fenced WhatsApp webhook"
```

Record the SHA.

---

## Amended Task 3 Final Verification

Run:

```bash
npm test -- \
  packages/domain/src/phone.test.ts \
  packages/domain/src/whatsapp.test.ts \
  server/whatsappServerConfig.test.ts \
  server/whatsappChannelResolver.test.ts \
  server/whatsappProviderGateway.test.ts \
  server/whatsappWebhook.test.ts

npm run test:migrations
npm run typecheck
npm run lint
```

Expected: PASS.

Prove Task 2 migration stayed untouched:

```bash
git diff 9733cfd0a2f90030016f201b5b737a6d63b1056c..HEAD -- \
  supabase/migrations/20260902220000_whatsapp_inbox.sql
```

Expected: no output.

Prove obsolete routing shortcuts are absent from production code:

```bash
git grep -n "TUX_WHATSAPP_SHOP_ID\|TUX_WHATSAPP_PHONE_NUMBER_ID" -- \
  server api packages apps
```

Expected: no production-code matches.

No production Supabase migration, Meta webhook registration, or Vercel environment update is performed during this task.

## Task 3 Completion Report

Report:

```text
TASK 3 COMPLETE

Task 2 base:
9733cfd0a2f90030016f201b5b737a6d63b1056c
UNCHANGED

Task 3A migration RED:
<command + expected missing migration failure>

Task 3A GREEN:
<command/result>

Task 3A commit:
<SHA>

Provider RED already recorded before amendment:
npm test -- server/whatsappProviderGateway.test.ts
FAIL ERR_MODULE_NOT_FOUND

Provider public interface preserved:
createWhatsAppProviderGateway + sendMessage + WhatsAppProviderError

Task 3B GREEN:
<commands/results>

Task 3B commit:
<SHA>

Webhook RED:
<command/result>

Webhook GREEN:
<command/result>

Task 3C commit:
<SHA>

Final focused suite:
PASS

Migration gate:
PASS

Typecheck:
PASS

Lint:
PASS

Tenant routing:
Inbound = provider phone_number_id -> active channel -> shop
Outbound = authenticated shop -> active channel -> provider phone_number_id

TUX_WHATSAPP_SHOP_ID production routing:
ABSENT

TUX_WHATSAPP_PHONE_NUMBER_ID production routing:
ABSENT

Historical Task 2 migration modified:
NO

Production migration/deployment performed:
NO

Environment variable names required later:
TUX_SUPABASE_URL
TUX_SUPABASE_SERVICE_ROLE_KEY
TUX_WHATSAPP_GRAPH_VERSION
TUX_WHATSAPP_ACCESS_TOKEN
TUX_WHATSAPP_WEBHOOK_VERIFY_TOKEN
TUX_WHATSAPP_APP_SECRET

Secret values exposed in report:
NO

Working tree:
<clean / explain>

Plan progress:
Task 3 of 10 complete
```

After this report, resume the original WhatsApp Inbox plan at **Task 4** unless another repository/spec contradiction appears. If one appears, STOP with evidence instead of guessing.

## Plan Self-Review Result

- Spec coverage: provider-channel ownership, one-active-channel v1 rule, inbound tenant resolution, outbound symmetry, signature-before-resolution, unknown-channel `200` no-mutation behavior, invalid-signature `401`, Task 2 idempotency reuse, server-only secret boundary, and no production deployment are all assigned to concrete steps.
- Placeholder scan: no implementation step depends on TBD/TODO behavior.
- Type consistency: the already-recorded provider RED's `createWhatsAppProviderGateway`, `sendMessage`, and `WhatsAppProviderError` contract is preserved; `WhatsAppChannelResolver` produces the exact routing identity consumed by provider/webhook paths; Task 2 RPC parameter names are preserved.
- Scope: this amendment changes Task 3 only. It does not implement Task 4 authenticated worker API, Operations UI, TUX-MENU, Admin, or production onboarding.
