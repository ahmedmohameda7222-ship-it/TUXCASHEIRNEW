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
- The implementer already recorded the valid provider-gateway RED:

```text
npm test -- server/whatsappProviderGateway.test.ts
FAIL: Cannot find module './whatsappProviderGateway'
ERR_MODULE_NOT_FOUND
```

That RED remains valid evidence. Do not manufacture a second initial RED for the same missing provider-gateway module.

## Global Constraints

- Do not modify `supabase/migrations/20260902220000_whatsapp_inbox.sql`.
- Add only append-only migration `supabase/migrations/20260902223000_whatsapp_channels.sql`.
- Inbound tenant authority is `META_CLOUD_API + metadata.phone_number_id -> active whatsapp_channels row -> shop_id`.
- Customer/sender phone, conversation search, request body, first shop, only shop, or environment-supplied shop ID must never choose a tenant.
- V1 permits exactly one active WhatsApp channel per shop.
- `(provider, provider_phone_number_id)` uniquely identifies a provider channel globally.
- Invalid/missing webhook POST signature returns HTTP `401` and performs no tenant resolution or mutation.
- Verified webhook with unknown/inactive `phone_number_id` returns HTTP `200` and performs no tenant mutation.
- Outbound routing begins from authenticated TUX `shop_id`; renderer/client code never chooses authoritative `shop_id` or `provider_phone_number_id`.
- `TUX_WHATSAPP_PHONE_NUMBER_ID` is not a production routing input and must not be required by the provider gateway.
- Provider/Meta secrets remain server-side only.
- The trusted Supabase service credential is server-side only. Never print it, return it, log it, commit it, or ask the user to paste it into chat.
- No production migration deployment is part of this task.
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

Create `scripts/test-whatsapp-channel-migration.mjs` with this exact contract shape:

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

### Step 2: Run the new migration RED

Run:

```bash
node scripts/test-whatsapp-channel-migration.mjs
```

Expected: FAIL exactly because `20260902223000_whatsapp_channels.sql` does not exist.

Record this RED before creating the migration.

### Step 3: Create the append-only channel migration

Create `supabase/migrations/20260902223000_whatsapp_channels.sql` using this schema contract:

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

Add the inbound resolver exactly as a server-only read boundary:

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

Add the outbound resolver exactly as a shop-authoritative server-only read boundary:

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

Do not add a broad `SELECT`, `INSERT`, `UPDATE`, or `DELETE` grant for `anon` or `authenticated`.

### Step 4: Run migration GREEN

Run:

```bash
node scripts/test-whatsapp-channel-migration.mjs
```

Expected: PASS.

### Step 5: Extend the permanent migration gate

Modify root `package.json` so `test:migrations` includes the new test after the existing WhatsApp inbox migration test:

```json
"test:migrations": "node scripts/test-migrations.mjs && node scripts/test-whatsapp-migration.mjs && node scripts/test-whatsapp-channel-migration.mjs && node scripts/test-worker-pin-rate-limit.mjs && node scripts/test-bootstrap-request-provenance.mjs && node scripts/test-worker-menu-layout-migration.mjs"
```

Do not remove or reorder existing security/migration tests except for inserting this new contract check after `test-whatsapp-migration.mjs`.

### Step 6: Run the repository migration gate

Run:

```bash
npm run test:migrations
```

Expected: PASS.

If the isolated migration database reports a syntax/ownership/role error, fix the new migration only. Do not rewrite historical migrations.

### Step 7: Commit Task 3A

```bash
git add \
  scripts/test-whatsapp-channel-migration.mjs \
  supabase/migrations/20260902223000_whatsapp_channels.sql \
  package.json

git commit -m "feat: add WhatsApp channel tenant resolution"
```

Record the commit SHA.

---

## Amended Task 3B: Add trusted server configuration, channel resolver, and provider gateway

**Files:**
- Create: `server/whatsappServerConfig.ts`
- Create: `server/whatsappServerConfig.test.ts`
- Create: `server/whatsappChannelResolver.ts`
- Create: `server/whatsappChannelResolver.test.ts`
- Create: `server/whatsappProviderGateway.ts`
- Create: `server/whatsappProviderGateway.test.ts`

**Environment names consumed by production server code:**

```text
TUX_SUPABASE_URL
TUX_SUPABASE_SERVICE_ROLE_KEY
TUX_WHATSAPP_GRAPH_VERSION
TUX_WHATSAPP_ACCESS_TOKEN
TUX_WHATSAPP_WEBHOOK_VERIFY_TOKEN
TUX_WHATSAPP_APP_SECRET
```

Allowed Supabase fallback name for the service credential:

```text
SUPABASE_SERVICE_ROLE_KEY
```

Explicitly absent from production routing:

```text
TUX_WHATSAPP_PHONE_NUMBER_ID
TUX_WHATSAPP_SHOP_ID
```

Never ask the user to paste any secret value into chat. Later deployment instructions may name the environment variables and dashboard location only.

### Step 1: Preserve the already-recorded provider RED

The existing RED for `server/whatsappProviderGateway.test.ts` is accepted as the initial RED for the provider module. Do not recreate or invalidate it.

Before implementing the provider gateway, add additional test cases to the same test file proving that `providerPhoneNumberId` is a required input and is used in the URL:

```ts
expect(fetchMock).toHaveBeenCalledWith(
  `https://graph.facebook.com/${graphVersion}/${providerPhoneNumberId}/messages`,
  expect.objectContaining({
    method: 'POST',
    headers: expect.objectContaining({
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    }),
  }),
);
```

The test must instantiate the gateway without any `TUX_WHATSAPP_PHONE_NUMBER_ID` dependency.

### Step 2: Write server-config RED tests

Create `server/whatsappServerConfig.test.ts` proving:

```ts
it('loads server-only WhatsApp and Supabase admin configuration without a phone-number routing env', () => {
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

Create `server/whatsappServerConfig.ts` with a deterministic parser that:

- requires HTTPS `TUX_SUPABASE_URL`/`SUPABASE_URL`;
- requires `TUX_SUPABASE_SERVICE_ROLE_KEY` or `SUPABASE_SERVICE_ROLE_KEY`;
- requires all four approved Meta configuration values;
- strips any leading/trailing whitespace;
- returns no phone-number ID or shop ID routing value;
- never logs secret values.

Use this public shape:

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

### Step 4: Write channel-resolver RED tests

Create `server/whatsappChannelResolver.test.ts` around an injected `fetch` implementation.

Prove the inbound resolver uses only provider identity:

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

Prove unknown/inactive channel response resolves to `null` when RPC returns `[]`.

Prove outbound routing accepts only `shopId`:

```ts
const resolved = await resolver.resolveOutboundChannel({
  shopId: shopA,
});

expect(fetchMock).toHaveBeenCalledWith(
  'https://example.supabase.co/rest/v1/rpc/resolve_tux_whatsapp_outbound_channel_v1',
  expect.objectContaining({
    method: 'POST',
    body: JSON.stringify({ p_shop_id: shopA }),
  }),
);
```

Prove Shop B's resolver call cannot reuse Shop A's RPC input by asserting the exact serialized `p_shop_id` for each request.

Run:

```bash
npm test -- server/whatsappChannelResolver.test.ts
```

Expected: FAIL because `./whatsappChannelResolver` does not exist.

### Step 5: Implement the server-only channel resolver

Create `server/whatsappChannelResolver.ts` with these interfaces:

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

Implement `SupabaseWhatsAppChannelResolver` using injected `fetch`, `projectUrl`, and `serviceRoleKey`.

Every RPC request must use:

```ts
headers: {
  apikey: serviceRoleKey,
  Authorization: `Bearer ${serviceRoleKey}`,
  'Content-Type': 'application/json',
}
```

Do not include the service credential in thrown error messages.

Treat a successful empty RPC array as `null`. Treat malformed successful payloads or non-2xx responses as typed/server errors rather than selecting a fallback tenant.

### Step 6: Implement provider gateway from the recorded RED

Create `server/whatsappProviderGateway.ts` with a provider phone number supplied per call:

```ts
export interface SendWhatsAppTextInput {
  readonly providerPhoneNumberId: string;
  readonly recipient: string;
  readonly text: string;
}

export interface WhatsAppProviderGateway {
  sendText(input: SendWhatsAppTextInput): Promise<{ providerMessageId: string }>;
}
```

The Meta URL must be:

```ts
`https://graph.facebook.com/${graphVersion}/${input.providerPhoneNumberId}/messages`
```

Text body:

```ts
{
  messaging_product: 'whatsapp',
  recipient_type: 'individual',
  to: input.recipient,
  type: 'text',
  text: { body: input.text },
}
```

Never read `TUX_WHATSAPP_PHONE_NUMBER_ID` inside the gateway.

Provider error translation may retain safe numeric HTTP/provider error codes but must never include the access token or Authorization header in logs/errors.

### Step 7: Run Task 3B GREEN

Run:

```bash
npm test -- \
  server/whatsappServerConfig.test.ts \
  server/whatsappChannelResolver.test.ts \
  server/whatsappProviderGateway.test.ts
```

Expected: PASS.

Then run:

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

Record the commit SHA.

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

**Interfaces produced:**

```ts
handleWhatsAppWebhook(input, dependencies): Promise<WhatsAppWebhookResult>
```

### Step 1: Write webhook RED tests before production webhook code

Create `server/whatsappWebhook.test.ts` with dependency injection for:

- `appSecret`;
- `webhookVerifyToken`;
- `channelResolver`;
- `materializer`;
- optional diagnostic sink.

Use exact raw bytes for HMAC tests:

```ts
import { createHmac } from 'node:crypto';

function signatureFor(rawBody: Buffer, appSecret: string): string {
  return `sha256=${createHmac('sha256', appSecret).update(rawBody).digest('hex')}`;
}
```

Test these required cases:

1. `POST` with missing signature -> `401`; resolver not called; materializer not called.
2. `POST` with invalid signature -> `401`; resolver not called; materializer not called.
3. Valid signature + known `metadata.phone_number_id` -> resolver called before materializer; resolved `shopId` is passed to materializer.
4. Valid signature + unknown/inactive channel -> `200`; materializer not called.
5. Changing sender/customer phone while preserving the same provider channel cannot change resolver input. Resolver input must remain only `{ provider: 'META_CLOUD_API', providerPhoneNumberId }`.
6. Duplicate provider message IDs may call the idempotent Task 2 RPC twice at the HTTP boundary, but persistence semantics must return/retain one message; webhook code must not invent a second local idempotency scheme that bypasses Task 2.
7. Verification `GET` with matching `hub.verify_token` returns the `hub.challenge`; mismatched token returns `403`.

Use a minimal valid text provider fixture:

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

In `server/whatsappWebhook.ts`, verify the exact raw POST body before JSON parsing.

Use `createHmac` and `timingSafeEqual`. Do not compare HMAC strings with ordinary `===` after decoding.

The verifier must:

- require prefix `sha256=`;
- compute the expected hex HMAC over the raw bytes;
- reject length mismatch before `timingSafeEqual`;
- return `false` without throwing secret-bearing diagnostics.

### Step 3: Parse only verified provider payloads

After signature success:

- parse JSON;
- require `metadata.phone_number_id` for a materializable inbound message;
- derive sender identity from the message `from`/contact `wa_id` only after shop resolution;
- call the shared `normalizeEgyptianPhone` contract;
- if the sender phone is invalid, acknowledge safely without creating customer/message state and emit a safe diagnostic;
- translate Meta text/image/document/audio/location payloads into Task 2 RPC fields without passing raw Meta object shapes into domain/application code.

For text messages use:

```ts
{
  kind: 'TEXT',
  text: providerMessage.text.body,
  mediaRef: null,
  mediaMetadata: {},
}
```

For image/document/audio messages, persist the provider media identifier as `mediaRef` and safe metadata only. Do not download media in Task 3.

For location messages persist structured latitude/longitude/name/address fields in `mediaMetadata`; do not treat location text as customer address truth.

### Step 4: Bind tenant resolution before materialization

The production order is mandatory:

```text
raw body
-> signature verification
-> JSON parse
-> metadata.phone_number_id
-> channelResolver.resolveInboundChannel(...)
-> resolved shopId
-> normalize sender/customer phone
-> materialize_tux_whatsapp_inbound_v1(shopId, ...)
```

Never reorder customer lookup ahead of channel resolution.

Unknown/inactive channel behavior is exactly:

```text
HTTP 200
no shop selected
no Task 2 materialization call
safe server diagnostic only
```

### Step 5: Add trusted inbound materializer adapter

Inside `server/whatsappWebhook.ts` or a focused private helper in the same file, call:

```text
POST ${projectUrl}/rest/v1/rpc/materialize_tux_whatsapp_inbound_v1
```

with server-only service credentials and body keys matching Task 2 exactly:

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

Do not grant or expose this RPC to browser/device roles.

### Step 6: Add the Vercel webhook route without JSON pre-processing

Create `api/whatsapp-webhook.ts` as a thin Node adapter.

For `POST`, read the incoming request stream into a `Buffer` with a hard maximum of 1 MiB before calling the webhook handler. Do not stringify `request.body` to recreate signature bytes.

Use a helper equivalent to:

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

The route loads `WhatsAppServerConfig`, constructs the server-side resolver/provider dependencies, and writes only the result status/body. It must never echo secrets.

`GET` verification does not require a POST signature; it validates the configured webhook verify token against query parameters.

### Step 7: Run webhook GREEN

Run:

```bash
npm test -- server/whatsappWebhook.test.ts
```

Expected: PASS.

Then run the complete amended Task 3 focused suite:

```bash
npm test -- \
  server/whatsappServerConfig.test.ts \
  server/whatsappChannelResolver.test.ts \
  server/whatsappProviderGateway.test.ts \
  server/whatsappWebhook.test.ts
```

Expected: PASS.

Then run:

```bash
npm run typecheck
npm run lint
npm run test:migrations
```

Expected: PASS for all three.

### Step 8: Commit Task 3C

```bash
git add \
  server/whatsappWebhook.ts \
  server/whatsappWebhook.test.ts \
  api/whatsapp-webhook.ts

git commit -m "feat: add tenant-fenced WhatsApp webhook"
```

Record the commit SHA.

---

## Amended Task 3 Final Verification

After Task 3A, 3B, and 3C are committed, run:

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

Also verify:

```bash
git diff 9733cfd0a2f90030016f201b5b737a6d63b1056c..HEAD -- \
  supabase/migrations/20260902220000_whatsapp_inbox.sql
```

Expected: no output. Task 2 migration must remain byte-for-byte untouched.

Search production code to prove obsolete routing variables were not introduced:

```bash
git grep -n "TUX_WHATSAPP_SHOP_ID\|TUX_WHATSAPP_PHONE_NUMBER_ID" -- \
  server api packages apps
```

Expected: no production-code matches.

No production Supabase migration, Meta webhook registration, or Vercel environment change is performed during this task.

## Task 3 Completion Report

Report exactly:

```text
TASK 3 COMPLETE

Task 2 base:
9733cfd0a2f90030016f201b5b737a6d63b1056c
UNCHANGED

Task 3A migration RED:
<command>
<expected missing migration failure>

Task 3A GREEN:
<command/result>

Task 3A commit:
<SHA>

Provider RED already recorded before amendment:
npm test -- server/whatsappProviderGateway.test.ts
FAIL ERR_MODULE_NOT_FOUND

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

After this report, resume the original WhatsApp Inbox plan at **Task 4** unless a new repository/spec contradiction is discovered. If one is discovered, STOP with evidence instead of guessing.

## Plan Self-Review Result

- Spec coverage: provider-channel ownership, one-active-channel v1 rule, inbound tenant resolution, outbound symmetry, signature-before-resolution, unknown-channel `200` no-mutation behavior, invalid-signature `401`, Task 2 idempotency reuse, server-only secret boundary, and no production deployment are all assigned to concrete steps.
- Placeholder scan: no implementation step depends on TBD/TODO behavior.
- Type consistency: `WhatsAppChannelResolver` produces the exact channel identifiers consumed by webhook/provider routing; Task 2 `materialize_tux_whatsapp_inbound_v1` parameter names are preserved.
- Scope: this amendment changes Task 3 only. It does not implement Operations UI, Task 4 authenticated worker API, TUX-MENU, Admin, or production onboarding.
