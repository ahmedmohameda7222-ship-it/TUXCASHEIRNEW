# WhatsApp Phone Normalization — Binding Decision

Date: 2026-09-02
Status: Approved planner correction after pre-implementation repository audit
Repository: `ahmedmohameda7222-ship-it/TUXCASHEIRNEW`
Applies to: `docs/superpowers/specs/2026-09-02-tux-operations-whatsapp-inbox-design.md` and `docs/superpowers/specs/2026-09-02-tux-customer-web-order-bridge-design.md`

## Decision

WhatsApp and the Web Order Bridge SHALL consume the existing shared Egyptian phone normalization contract. They SHALL NOT replace it with a second WhatsApp-specific normalization contract and SHALL NOT change its return type merely for this feature.

The authoritative shared API remains:

```ts
export interface EgyptianPhoneNormalization {
  readonly normalizedPhone: string;
  readonly displayPhone: string;
  readonly valid: boolean;
}

export function normalizeEgyptianPhone(raw: string): EgyptianPhoneNormalization
```

## Canonical identity semantics

For a valid Egyptian mobile number:

- `normalizedPhone` is the canonical TUX customer identity key in local Egyptian form, e.g. `01012345678`.
- `displayPhone` is the canonical human/international display form, e.g. `+201012345678`.
- `valid` determines whether matching is permitted.

Equivalent supported customer/provider inputs such as `01012345678`, `+201012345678`, `00201012345678`, `201012345678`, and `1012345678` resolve to the same canonical `normalizedPhone` when valid.

## WhatsApp usage

Inbound provider sender identifiers SHALL be passed through `normalizeEgyptianPhone`. If `valid === false`, TUX must not silently create or match a customer identity from that value.

WhatsApp conversation/customer matching SHALL use `result.normalizedPhone`, matching the existing Orders/customer-contact domain.

Human-facing UI MAY use `result.displayPhone`.

Provider-specific outbound formatting, such as whether Meta expects a leading `+` or digits-only international recipient value, belongs at the WhatsApp provider gateway boundary. It must derive from the valid shared normalization result rather than changing the shared customer identity format.

## Compatibility rule

`packages/domain/src/phone.ts` and its existing tests are established shared-domain behavior. The WhatsApp implementation must preserve them unless a separate, explicitly approved cross-domain migration is designed and tested.

## Rationale

The existing Orders validation path already uses `normalizeEgyptianPhone(...).normalizedPhone` as the durable customer-contact lookup key. Replacing the function with a `string | null` E.164-returning API would create two incompatible customer identity formats and require an unnecessary migration of existing Orders/customer-contact behavior.
