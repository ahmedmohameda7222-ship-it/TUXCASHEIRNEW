# TUX WhatsApp Channel Tenant Resolution — Binding Design

Date: 2026-09-02
Status: Approved architectural correction; implementation plan amendment pending user review
Repository: `ahmedmohameda7222-ship-it/TUXCASHEIRNEW`

## 1. Purpose

Bind one deterministic tenant-resolution mechanism for inbound and outbound WhatsApp traffic so Meta provider identities are mapped to the correct TUX shop before any tenant-owned WhatsApp data is read or mutated.

This design corrects the Task 3 ambiguity in `docs/superpowers/plans/2026-09-02-tux-operations-whatsapp-inbox.md` without changing the approved worker-facing WhatsApp product scope.

## 2. Binding decision

TUX shall introduce a server-side WhatsApp channel mapping whose provider identity is authoritative for resolving the owning shop.

The v1 mapping is:

`META_CLOUD_API + provider_phone_number_id -> shop_id`

Inbound webhook tenant resolution and outbound provider routing shall both use this mapping. No request body, customer phone, conversation search, or implicit single-shop assumption may choose a tenant.

## 3. Data model

Add a tenant-owned channel configuration relation named `public.whatsapp_channels` with at least:

- `id uuid primary key`;
- `shop_id uuid not null` referencing the owning TUX shop;
- `provider text not null` with v1 value `META_CLOUD_API`;
- `provider_phone_number_id text not null`;
- `business_phone_e164 text` for display/configuration audit where available;
- `active boolean not null`;
- `created_at timestamptz not null`;
- `updated_at timestamptz not null`.

The exact audit/default expressions must follow established repository migration conventions.

### 3.1 Provider identity uniqueness

The pair `(provider, provider_phone_number_id)` must uniquely identify at most one channel row across TUX.

This is the inbound tenant-resolution authority.

### 3.2 One active channel per shop in v1

V1 supports exactly one active WhatsApp channel per shop.

Enforce this with a partial unique index on `shop_id` where `active = true`.

Inactive historical/configuration rows may coexist so future re-onboarding does not require destructive rewriting of old configuration.

A later explicit migration may introduce multiple active channels per shop if the product requires routing/default-channel semantics. V1 must not pre-build that complexity.

## 4. Inbound webhook flow

For a Meta webhook POST:

1. Receive the raw HTTP request body.
2. Verify the Meta webhook signature using the configured app secret before accepting provider data.
3. Parse the verified Meta event only after signature validation.
4. Extract the provider `phone_number_id` from the provider metadata.
5. Resolve exactly one active `public.whatsapp_channels` row where:
   - `provider = 'META_CLOUD_API'`;
   - `provider_phone_number_id = <incoming phone_number_id>`;
   - `active = true`.
6. If no active mapping exists, do not select a tenant and do not materialize any inbound WhatsApp data.
7. If a deterministic active mapping exists, take its `shop_id` and call the tenant-fenced inbound materialization boundary such as `public.materialize_tux_whatsapp_inbound_v1(p_shop_id, ...)`.
8. Existing message/provider idempotency rules continue to prevent duplicate materialization.

The provider channel mapping occurs before customer/conversation lookup. Customer matching happens only inside the already-resolved shop boundary.

## 5. Tenant-resolution prohibitions

The following mechanisms are explicitly forbidden for choosing an inbound shop:

- first active shop;
- only shop found in the database;
- sender/customer phone;
- normalized customer phone;
- searching all conversations for a matching number;
- a shop identifier supplied by the Meta payload or Operations client body;
- an invented global `TUX_WHATSAPP_SHOP_ID` deployment variable;
- weakening or removing `p_shop_id` tenant fencing from persistence RPCs.

If tenant resolution fails, the safe result is no tenant mutation.

## 6. Outbound routing symmetry

Outbound WhatsApp messages begin from an existing authenticated TUX Operations session. The existing device/session gateway determines the authoritative `shop_id` and current worker identity.

Outbound provider routing is then:

`authenticated shop_id -> exactly one active whatsapp_channels row -> provider_phone_number_id -> Meta /PHONE_NUMBER_ID/messages`

The renderer or client must not choose `provider_phone_number_id` directly for a send operation.

If no active channel exists for the authenticated shop, the WhatsApp send operation returns a typed/configuration error and must not affect Orders or other POS behavior.

## 7. Secret/configuration boundary

`whatsapp_channels` contains provider routing identity and non-secret configuration only.

Long-lived Meta access tokens, app secrets, webhook verification tokens, and equivalent provider credentials remain server-side secrets/environment configuration and must never be stored in the Operations renderer or exposed through public/client APIs.

The existing Task 3 environment contract may still include:

- `TUX_WHATSAPP_GRAPH_VERSION`;
- `TUX_WHATSAPP_ACCESS_TOKEN`;
- `TUX_WHATSAPP_WEBHOOK_VERIFY_TOKEN`;
- `TUX_WHATSAPP_APP_SECRET`.

`TUX_WHATSAPP_PHONE_NUMBER_ID` must not be the long-term tenant-routing authority once `whatsapp_channels` exists. Provider phone number identity is resolved from the active channel row for outbound sends and from the verified webhook metadata for inbound events.

A fixed phone-number-id environment variable may only remain if needed temporarily by test/bootstrap tooling and must not override the database channel mapping in production request handling.

## 8. Admin relationship

Future TUX Admin owns WhatsApp onboarding and channel configuration.

The future Admin flow may create, activate, deactivate, or replace `whatsapp_channels` rows after official Meta onboarding/coexistence succeeds.

Operations does not gain an Admin configuration screen for channel ownership.

Until Admin exists, any initial production channel row is provisioned through an explicit controlled deployment/setup step, not inferred at runtime.

## 9. Migration strategy

Do not modify Task 2 migration history.

Add one new append-only migration for the channel mapping. Recommended migration path:

`supabase/migrations/20260902223000_whatsapp_channels.sql`

The migration must follow repository patterns for:

- tenant foreign keys/integrity;
- RLS;
- explicit privilege revocation;
- controlled server-side read/write boundaries;
- no broad anonymous/public table mutation;
- non-redundant uniqueness/index structures.

No production migration deployment is part of implementation coding. Production application remains a manual user-controlled step.

## 10. Server interface boundary

Task 3 implementation should expose a focused server-side resolver abstraction rather than scattering SQL/provider mapping logic through webhook code.

Conceptually:

```ts
interface WhatsAppChannelResolver {
  resolveInboundChannel(input: {
    provider: 'META_CLOUD_API';
    providerPhoneNumberId: string;
  }): Promise<{ shopId: string; channelId: string } | null>;

  resolveOutboundChannel(input: {
    shopId: string;
  }): Promise<{
    channelId: string;
    provider: 'META_CLOUD_API';
    providerPhoneNumberId: string;
  } | null>;
}
```

Exact branded ID types should use existing repository domain/server conventions during implementation rather than introducing untyped tenant identifiers where established types are available.

## 11. Error behavior

Inbound unknown/inactive channel:

- signature verification still occurs;
- no tenant is chosen;
- no inbound message/conversation mutation occurs;
- the event is handled with a safe provider-facing HTTP response/logging strategy that does not leak secrets or cross-tenant data.

Outbound missing/inactive channel:

- return a typed WhatsApp configuration/unavailable error;
- do not call Meta;
- do not mutate unrelated POS state;
- Orders, Business Day, End Day, printing, Expenses, and Bulk Stock continue normally.

Ambiguous channel resolution must be structurally prevented by uniqueness constraints rather than resolved by arbitrary runtime selection.

## 12. Testing requirements

The implementation plan amendment must include TDD coverage proving at minimum:

1. the new migration does not yet exist before the migration RED;
2. provider/channel uniqueness exists without redundant uniqueness structures;
3. only one active channel per shop is allowed in v1;
4. inactive historical rows do not violate the one-active-channel rule;
5. an inbound known active `phone_number_id` resolves to exactly its configured shop;
6. an unknown/inactive inbound `phone_number_id` performs no materialization;
7. sender/customer phone cannot influence tenant selection;
8. outbound authenticated Shop A resolves Shop A's channel only;
9. outbound Shop B cannot route through Shop A's channel;
10. no provider call occurs when outbound channel resolution fails;
11. webhook signature verification happens before provider payload materialization;
12. duplicate provider messages remain idempotent through the existing Task 2 persistence rules.

Migration tests must extend the existing repository migration gate without weakening or replacing existing security/migration tests.

## 13. Scope

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

## 14. Acceptance invariant

The completed architecture must satisfy this invariant:

**No inbound WhatsApp provider event can enter tenant-owned TUX state until a verified provider channel identity resolves deterministically to exactly one active TUX shop. No outbound WhatsApp send can choose a provider channel except through the already-authenticated shop identity.**
