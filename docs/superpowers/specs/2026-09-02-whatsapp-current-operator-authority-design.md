# TUX WhatsApp Current Operator Authority — Binding Design

Date: 2026-09-02
Status: Approved architectural correction; written-spec review pending
Repository: `ahmedmohameda7222-ship-it/TUXCASHEIRNEW`

## 1. Purpose

Bind one long-term-safe authority model for attributing outbound WhatsApp messages to the current Operations worker without trusting renderer-supplied worker identity and without introducing a second worker-authentication system.

This design corrects the Task 4 ambiguity in `docs/superpowers/plans/2026-09-02-tux-operations-whatsapp-inbox.md` while preserving the approved local-first Operations session model and the approved WhatsApp channel tenant-resolution model.

## 2. Binding decision

TUX shall use the existing synchronized remote `worker_sessions` record as the server-side authority for the current worker when an authenticated Operations client sends WhatsApp messages.

The authority chain is:

`device session -> authoritative shop_id + device_id`

plus

`client claim: businessDayId + workerId`

validated against

`remote OPEN business_day + exactly one OPEN worker_session + active worker`

before any outbound WhatsApp intent is created or sent.

The renderer/client may carry `businessDayId` and `workerId` as claims so the server can verify the exact local session the user is operating under, but those values are never trusted by themselves.

## 3. Why this is the long-term model

This model reuses existing TUX concepts rather than creating parallel authentication state:

- the device session already authenticates the Operations device and resolves the shop;
- the local Operations session already owns worker sign-in, switch, and sign-out semantics;
- Operations sync already materializes Business Day and worker-session lifecycle remotely;
- the remote schema already enforces at most one open worker session per Business Day;
- WhatsApp worker attribution therefore verifies the same operational truth used by the rest of TUX.

No signed worker cookie, client-authoritative worker ID, deployment worker setting, or WhatsApp-specific PIN/session subsystem is introduced in v1.

## 4. Existing authority boundaries

### 4.1 Device identity

The existing server device-session gateway remains authoritative for:

- `shop_id`;
- `device_id`;
- device enrollment/session validity.

A WhatsApp POST request body must never choose the authoritative shop or device.

### 4.2 Local worker session

The installed/browser Operations runtime remains authoritative locally for the current user experience:

- Business Day creation/open state;
- worker PIN sign-in;
- worker switch;
- worker sign-out;
- Current Operator shown to the worker;
- local audit/outbox events.

The local state remains local-first. WhatsApp must not make Orders, End Day, printing, or other POS workflows wait for Meta or the remote WhatsApp service.

### 4.3 Remote worker-session projection

The synchronized remote `worker_sessions` projection is the server authority used specifically to verify that the worker claim attached to a remote WhatsApp send still matches the shop's current synchronized Operations session.

This is a verification boundary, not a replacement for the local session service.

## 5. Server-side current-operator resolver

Add one server-only resolver boundary conceptually named:

```sql
public.resolve_tux_whatsapp_current_operator_v1(
  p_shop_id uuid,
  p_device_id uuid,
  p_business_day_id uuid,
  p_claimed_worker_id uuid
)
```

It returns the validated current worker/business-day identity only when all required invariants hold.

The exact return shape may follow repository RPC conventions, but the resolved values must include at least:

- `business_day_id`;
- `worker_id`.

## 6. Required validation invariants

The resolver succeeds only when all of the following are true:

1. `p_shop_id` identifies an active shop.
2. `p_device_id` identifies an active device belonging to that same shop.
3. `p_business_day_id` belongs to that shop.
4. That Business Day is `OPEN`.
5. There is exactly one `worker_sessions` row for that Business Day with `ended_at is null`.
6. The open worker session belongs to the same shop.
7. The open worker session `worker_id` equals `p_claimed_worker_id`.
8. The referenced worker exists, is active, and belongs to the same shop.
9. The open worker session is bound to the authenticated device: `worker_sessions.device_id = p_device_id`.

If the synchronized open worker session has a null/different `device_id`, WhatsApp send authorization fails safely. V1 does not silently accept a session that cannot be bound back to the authenticated Operations device.

This device binding is deliberately included now so a future second Operations device cannot impersonate the other device's Current Operator merely by knowing its worker/business-day IDs.

## 7. Client request contract

An authenticated Operations send request may include:

```ts
{
  action: 'SEND_MESSAGE';
  businessDayId: string;
  workerId: string;
  conversationId: string;
  outboundIntentKey: string;
  kind: WhatsAppMessageKind;
  text?: string;
  mediaRef?: string;
  mediaMetadata?: Record<string, unknown>;
}
```

The following rules are binding:

- `shopId` is not accepted as an authority-bearing body field;
- `deviceId` is not accepted as an authority-bearing body field;
- `businessDayId` and `workerId` are claims only;
- the server derives `shopId` and `deviceId` from the authenticated device session;
- the server validates the claims against the remote current-operator resolver before creating any outbound intent;
- changing body `workerId` cannot attribute a message to another active worker.

If legacy/client DTOs carry redundant `shopId`, the server must reject a mismatch and must not use the body value to choose a tenant. Long-term platform contracts should omit redundant authority fields where practical.

## 8. Outbound WhatsApp flow

The production send path is:

1. Receive authenticated Operations request.
2. Enforce same-origin rules where existing mutating API routes require them.
3. Resolve/refresh the existing device session.
4. Obtain authoritative `shop_id` and `device_id` from that session.
5. Parse `businessDayId` and `workerId` claims from the request.
6. Resolve the current synchronized worker through `resolve_tux_whatsapp_current_operator_v1(...)`.
7. If current-operator verification fails, stop before creating an outbound intent and before calling Meta.
8. Resolve the active WhatsApp channel using the approved `shop_id -> whatsapp_channels -> provider_phone_number_id` path.
9. Create/find the Task 2 outbound intent with the verified worker/device attribution.
10. For a newly created intent only, call the provider gateway using the resolved provider phone-number ID.
11. Persist provider message ID/status through the approved server boundary.
12. Return the stored message/result to Operations.

The verified worker identity—not the raw body value—is written to `sent_by_worker_id`.

## 9. Synchronization race behavior

Worker switch/sign-out is local-first and may temporarily be ahead of the remote projection.

Example:

```text
Local current worker: B
Remote open worker session: A
```

In that state, a WhatsApp send claiming Worker B must fail safely with a typed synchronization conflict.

Recommended API behavior:

```text
HTTP 409
error = whatsapp_operator_not_synchronized
```

The server must perform:

- no outbound-intent creation;
- no Meta call;
- no worker attribution mutation.

Once the existing Operations outbox synchronizes the worker-session transition and the remote projection matches Worker B, the same user action may be retried with a fresh/appropriate outbound intent key according to the send-idempotency contract.

The UI/application layer may trigger or await an immediate normal Operations sync before retrying, but it must not bypass current-operator verification.

## 10. Business Day rules

WhatsApp worker sends require an `OPEN` Business Day and a verified open worker session.

Therefore:

- no current Business Day -> no worker send;
- CLOSED Business Day -> no worker send under that closed day;
- signed-out worker / no open worker session -> no worker send;
- stale client claims from a prior Business Day -> no worker send.

This does not change the existing Business Day lifecycle. WhatsApp consumes it as an authorization condition only.

## 11. Idempotency ordering

Current-operator verification occurs before creating a new outbound intent.

This prevents an unauthorized/stale worker claim from leaving durable outbound intent rows that can never validly send.

For an already-existing outbound intent key, the server must preserve Task 2 idempotency semantics and must never issue a second Meta send. Authorization/retrieval behavior for retries must not allow a different worker/device/shop to claim or resend an existing intent belonging to another attribution context.

The Task 4 implementation plan must explicitly test this ordering.

## 12. Device-switch and future multi-device safety

V1 still assumes one Operations laptop per shop at the product level, but the authorization model must not bake that assumption into server trust.

Because the resolver verifies `worker_sessions.device_id` against the authenticated device session:

- Shop A Device 1 cannot send as a session synchronized from Shop A Device 2;
- future multi-device support can add explicit presence/locking policy without replacing the worker-attribution authority model;
- the server does not rely on "only one laptop exists" as a security invariant.

No multi-device UI coordination is added in this correction.

## 13. Failure isolation

WhatsApp synchronization/authorization failures affect WhatsApp only.

A `409 whatsapp_operator_not_synchronized`, missing WhatsApp channel, Meta outage, or WhatsApp server error must not block:

- Orders;
- Orders Board;
- Expenses;
- Bulk Stock;
- printing;
- Business Day;
- End Day;
- local worker switch/sign-out;
- local durable persistence/outbox processing.

## 14. Error contract

At minimum, Task 4 must distinguish these categories without exposing secrets or cross-tenant data:

- device session missing/invalid -> existing device-session `401` behavior;
- malformed WhatsApp request -> `400`;
- cross-shop/redundant authority mismatch -> `403` or bound request-validation response, without selecting the body shop;
- current operator not yet synchronized / stale Business Day-worker claim -> `409 whatsapp_operator_not_synchronized`;
- WhatsApp channel missing/inactive -> typed WhatsApp unavailable/configuration response;
- remote backend transport unavailable -> `503`;
- invalid upstream/provider protocol -> `502` where appropriate.

Exact response envelopes should follow existing gateway conventions.

## 15. Migration strategy

Do not modify completed WhatsApp migrations from Tasks 2 or 3.

Add one append-only migration for the server-side current-operator resolver:

`supabase/migrations/20260902224500_whatsapp_current_worker_authority.sql`

The migration should add the resolver RPC and only the minimal supporting database objects actually required by the verified current schema.

Do not add a second worker-session table, duplicate Current Operator state, or WhatsApp-specific worker authentication table.

No production migration deployment is part of implementation coding.

## 16. Privilege boundary

The resolver is server-only.

Follow established repository conventions:

- `SECURITY DEFINER` only where required;
- fixed safe `search_path`;
- revoke from `public`, `anon`, and `authenticated`;
- grant execution only to the trusted server/service boundary needed by the Vercel WhatsApp gateway;
- no renderer/browser direct access to the current-operator resolver;
- no service-role secret in browser/Electron code.

## 17. Explicitly rejected alternatives

### 17.1 Signed worker HttpOnly cookie

Not used in v1.

It would create a second worker-session state with separate signing, expiry, rotation, sign-out invalidation, and offline-staleness semantics. TUX already has a durable Operations worker-session lifecycle, so duplicating it is unnecessary.

### 17.2 Client-authoritative worker ID

Rejected.

Checking only that the claimed worker is active in the shop does not prove that worker is the Current Operator.

### 17.3 Deployment worker/shop identity

Rejected.

No `TUX_WHATSAPP_WORKER_ID`, `TUX_WHATSAPP_SHOP_ID`, or equivalent deployment variable may determine worker attribution.

### 17.4 First/only open session without claim verification

Rejected.

The server must compare the client's local session claim with the synchronized remote session so stale local/remote state becomes an explicit conflict rather than silent misattribution.

## 18. Testing requirements

The Task 4 amendment must include TDD coverage proving at minimum:

1. the new migration is absent before the migration RED;
2. the resolver requires active shop and active same-shop device;
3. CLOSED/wrong Business Day does not resolve;
4. no open worker session does not resolve;
5. a different claimed worker does not resolve even if that worker is active in the same shop;
6. a worker from another shop does not resolve;
7. an open session on another device does not resolve for the authenticated device;
8. null `worker_sessions.device_id` does not authorize a WhatsApp send;
9. the valid shop/device/business-day/current-worker tuple resolves exactly one worker;
10. request-body `shopId` cannot choose the tenant;
11. `SEND_MESSAGE` performs current-operator verification before outbound-intent creation;
12. a `409 whatsapp_operator_not_synchronized` causes no outbound-intent creation and no Meta call;
13. after synchronized worker switch, Worker B can send and durable attribution is Worker B;
14. Worker A's stale claim cannot send after the synchronized switch to Worker B;
15. duplicate retry of the same valid outbound intent does not call Meta twice;
16. another worker/device cannot reuse an existing intent key to cause resend or attribution takeover;
17. outbound channel routing still uses the approved authenticated `shop_id -> whatsapp_channels` mapping;
18. WhatsApp authorization failure does not alter unrelated POS state.

Migration/security tests must extend existing repository gates without weakening historical tests.

## 19. Scope

This correction adds only server-side current-worker authority required by Task 4 outbound WhatsApp actions.

It does not add:

- a new worker PIN system;
- a worker authentication cookie;
- Admin UI;
- multi-device chat locking;
- WhatsApp channel onboarding UI;
- TUX-MENU Web Order Bridge behavior;
- AI/chatbot behavior;
- production secrets;
- production migration deployment.

## 20. Acceptance invariant

The completed architecture must satisfy:

**An outbound WhatsApp message may be attributed to a worker only when the authenticated Operations device's authoritative shop/device identity and the client's Business Day/worker claim resolve to the same currently open synchronized TUX worker session. A stale, cross-device, cross-shop, signed-out, or closed-day claim produces no outbound intent and no Meta send.**
