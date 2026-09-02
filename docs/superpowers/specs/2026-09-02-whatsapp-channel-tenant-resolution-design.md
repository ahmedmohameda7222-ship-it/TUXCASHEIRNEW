# TUX WhatsApp Channel Tenant Resolution — Binding Design

Date: 2026-09-02
Status: Approved architectural correction; written-spec review pending
Repository: `ahmedmohameda7222-ship-it/TUXCASHEIRNEW`

## 1. Purpose

Bind one deterministic tenant-resolution mechanism for inbound and outbound WhatsApp traffic so Meta provider identities are mapped to the correct TUX shop before any tenant-owned WhatsApp data is read or mutated.

This design corrects the Task 3 ambiguity in `docs/superpowers/plans/2026-09-02-tux-operations-whatsapp-inbox.md` without changing the approved worker-facing WhatsApp product scope.

## 2. Binding decision

TUX shall introduce a server-side WhatsApp channel mapping whose provider identity is authoritative for resolving the owning shop.

The v1 mapping is:

`META_CLOUD_API + provider_phone_number_id -> shop_id`

Inbound webhook tenant resolution and outbound provider routing shall both use this mapping. No request body, customer phone, conversation search, environment-supplied shop ID, or implicit single-shop assumption may choose a tenant.

## 3. Data model

Add a tenant-owned channel configuration relation named `public.whatsapp_channels` with:

- `id uuid primary key`;
- `shop_id uuid not null` referencing the owning TUX shop;
- `provider text not null` constrained in v1 to `META_CLOUD_API`;
- `provider_phone_number_id text not null` and non-blank;
- `business_phone_e164 text` for non-secret display/configuration audit where available;
- `active boolean not null default true`;
- `created_at timestamptz not null default now()`;
- `updated_at timestamptz not null default now()`.

The migration must follow existing same-shop foreign-key, RLS, privilege-revocation, and server-only access conventions.

### 3.1 Provider identity uniqueness

The pair `(provider, provider_phone_number_id)` must uniquely identify one channel row across TUX.

This is the inbound tenant-resolution authority. Re-onboarding the same provider phone number must update/reactivate its channel row rather than creating a second row with the same provider identity.

### 3.2 One active channel per shop in v1

V1 supports exactly one active WhatsApp channel per shop.

Enforce this with a partial unique index on `shop_id` where `active = true`.

Inactive historical/configuration rows may coexist so a shop can replace its number without destructive history rewriting.

A later explicit migration may introduce multiple active channels per shop if the product requires routing/default-channel semantics. V1 must not pre-build that complexity.

## 4. Inbound webhook flow

For a Meta webhook POST:

1. Receive the raw HTTP request body.
2. Verify the Meta webhook signature using the configured app secret before parsing or accepting provider data.
3. Reject an invalid/missing POST signature with HTTP `401` and perform no provider payload parsing that can trigger state mutation.
4. Parse the verified Meta event.
5. Extract `metadata.phone_number_id` from the verified provider payload.
6. Resolve exactly one active `public.whatsapp_channels` row where:
   - `provider = 'META_CLOUD_API'`;
   - `provider_phone_number_id = <metadata.phone_number_id>`;
   - `active = true`.
7. If no active mapping exists, select no tenant, perform no inbound WhatsApp mutation, record a server-side configuration diagnostic without secrets/customer data, and return HTTP `200` to acknowledge the verified provider event and prevent pointless provider retries.
8. If a deterministic active mapping exists, take its `shop_id` and call the existing Task 2 boundary `public.materialize_tux_whatsapp_inbound_v1(p_shop_id, ...)`.
9. Existing Task 2 `(shop_id, provider_message_id)` idempotency continues to prevent duplicate materialization.

The provider channel mapping occurs before customer/conversation lookup. Customer matching happens only inside the already-resolved shop boundary.

## 5. Tenant-resolution prohibitions

The following mechanisms are explicitly forbidden for choosing an inbound shop:

- first active shop;
- only shop found in the database;
- sender/customer phone;
- normalized customer phone;
- searching all conversations for a matching number;
- a shop identifier supplied by the Meta payload or Operations client body;
- a global `TUX_WHATSAPP_SHOP_ID` deployment variable;
- `TUX_WHATSAPP_PHONE_NUMBER_ID` as an implicit shop selector;
- weakening or removing `p_shop_id` tenant fencing from persistence RPCs.

If tenant resolution fails, the safe result is no tenant mutation.

## 6. Outbound routing symmetry

Outbound WhatsApp messages begin from an existing authenticated TUX Operations session. The existing device/session gateway determines the authoritative `shop_id`, device, and current worker identity.

Outbound provider routing is then:

`authenticated shop_id -> exactly one active whatsapp_channels row -> provider_phone_number_id -> Meta /PHONE_NUMBER_ID/messages`

The renderer/client request must not supply the authoritative `shop_id` or `provider_phone_number_id` for a send operation.

If no active channel exists for the authenticated shop:

- return a typed WhatsApp configuration/unavailable error;
- do not call Meta;
- preserve the existing outbound intent/idempotency semantics without fabricating provider acceptance;
- do not affect Orders or other POS behavior.

## 7. Provider gateway contract

The provider gateway must receive the already-resolved `providerPhoneNumberId` as an input from the server-side channel resolver.

Conceptually:

```ts
sendMessage(input: {
  providerPhoneNumberId: string;
  recipient: string;
  // message payload fields
}): Promise<{ providerMessageId: string }>;
```

The gateway constructs:

`https://graph.facebook.com/${graphVersion}/${providerPhoneNumberId}/messages`

`TUX_WHATSAPP_PHONE_NUMBER_ID` is removed from the production request-routing contract. It must not override channel resolution for inbound or outbound production traffic.

## 8. Secret/configuration boundary

`whatsapp_channels` contains provider routing identity and non-secret configuration only.

Long-lived Meta access tokens, app secrets, webhook verification tokens, and equivalent provider credentials remain server-side secrets/environment configuration and must never be stored in the Operations renderer, committed to git, or exposed through public/client APIs.

Task 3 production server configuration retains:

- `TUX_WHATSAPP_GRAPH_VERSION`;
- `TUX_WHATSAPP_ACCESS_TOKEN`;
- `TUX_WHATSAPP_WEBHOOK_VERIFY_TOKEN`;
- `TUX_WHATSAPP_APP_SECRET`.

The current v1 implementation may use one server-side Meta access-token configuration for the integrated business assets. Credential partitioning across multiple independent Meta business owners is not introduced by this correction; if required later, it must be designed explicitly without storing long-lived tokens in tenant-readable tables.

## 9. Admin relationship

Future TUX Admin owns WhatsApp onboarding and channel configuration.

The future Admin flow may create, activate, deactivate, or replace `whatsapp_channels` rows after official Meta onboarding/coexistence succeeds.

Operations does not gain an Admin configuration screen for channel ownership.

Until Admin exists, the initial production channel row is provisioned through an explicit controlled manual deployment/setup step. Runtime code never infers it.

## 10. Migration strategy

Do not modify the completed Task 2 migration `supabase/migrations/20260902220000_whatsapp_inbox.sql`.

Add one new append-only migration:

`supabase/migrations/20260902223000_whatsapp_channels.sql`

The migration must follow repository patterns for:

- tenant foreign keys/integrity;
- RLS;
- explicit privilege revocation;
- controlled server-side read boundaries;
- no broad anonymous/authenticated table mutation;
- non-redundant uniqueness/index structures.

No production migration deployment is part of implementation coding. Production application remains a manual user-controlled step.

## 11. Server interface boundary

Task 3 implementation shall expose a focused server-side resolver abstraction rather than scattering SQL/provider mapping logic through webhook/provider code.

Conceptually:

```ts
interface WhatsAppChannelResolver {
  resolveInboundChannel(input: {
    provider: 'META_CLOUD_API';
    providerPhoneNumberId: string;
  }): Promise<{ shopId: ShopId; channelId: string } | null>;

  resolveOutboundChannel(input: {
    shopId: ShopId;
  }): Promise<{
    channelId: string;
    provider: 'META_CLOUD_API';
    providerPhoneNumberId: string;
  } | null>;
}
```

Use the existing branded `ShopId` type where the server/application boundary already consumes domain IDs. Channel IDs may remain server-local strings/UUIDs until a shared domain type is actually needed.

The resolver implementation is server-only and may use the existing trusted Supabase/service-role boundary. Browser/Electron renderer code must not query `whatsapp_channels` directly.

## 12. Error behavior

### Invalid provider authentication

For webhook POST requests with invalid/missing Meta signature:

- return HTTP `401`;
- do not resolve a shop;
- do not materialize provider data.

Meta verification GET remains governed by the existing verify-token contract in Task 3 and is separate from channel tenant resolution.

### Verified but unknown/inactive channel

- return HTTP `200` after verification;
- do not select a tenant;
- do not call `materialize_tux_whatsapp_inbound_v1`;
- emit only a safe server-side configuration diagnostic.

### Outbound missing/inactive channel

- return a typed WhatsApp configuration/unavailable error;
- do not call Meta;
- do not mutate unrelated POS state;
- Orders, Business Day, End Day, printing, Expenses, and Bulk Stock continue normally.

Ambiguous channel resolution must be structurally prevented by uniqueness constraints rather than resolved by arbitrary runtime selection.

## 13. Testing requirements

The implementation-plan amendment must include TDD coverage proving at minimum:

1. `supabase/migrations/20260902223000_whatsapp_channels.sql` is absent for the migration RED before it is created;
2. `(provider, provider_phone_number_id)` uniqueness exists without redundant duplicate uniqueness structures;
3. only one active channel per shop is allowed in v1;
4. inactive historical rows do not violate the one-active-channel rule;
5. a known active inbound `phone_number_id` resolves exactly to its configured shop;
6. an unknown/inactive inbound `phone_number_id` performs no materialization and returns the bound HTTP acknowledgement behavior;
7. sender/customer phone cannot influence tenant selection;
8. outbound authenticated Shop A resolves Shop A's active channel only;
9. outbound Shop B cannot route through Shop A's channel;
10. no provider call occurs when outbound channel resolution fails;
11. `TUX_WHATSAPP_PHONE_NUMBER_ID` is not required by production provider routing;
12. webhook signature verification happens before tenant resolution/materialization;
13. invalid webhook signatures return `401` with no mutation;
14. duplicate provider messages remain idempotent through the existing Task 2 persistence rules.

Migration tests must extend the existing repository migration gate without weakening or replacing existing security/migration tests.

## 14. Scope

This correction adds only provider-channel tenant resolution needed by the WhatsApp backend.

It does not add:

- TUX Admin UI;
- multi-channel-per-shop routing;
- multi-laptop coordination;
- WhatsApp Web embedding;
- AI/chatbot behavior;
- TUX-MENU Web Order Bridge behavior;
- production secret values;
- automatic production deployment.

## 15. Acceptance invariant

The completed architecture must satisfy this invariant:

**No inbound WhatsApp provider event can enter tenant-owned TUX state until a verified provider channel identity resolves deterministically to exactly one active TUX shop. No outbound WhatsApp send can choose a provider channel except through the already-authenticated shop identity.**
