# TUX WhatsApp Current Operator Authority — Binding Design

Date: 2026-09-02
Status: Approved architectural correction; written-spec review pending
Repository: `ahmedmohameda7222-ship-it/TUXCASHEIRNEW`

## 1. Purpose

Bind one long-term-safe authority model for attributing outbound WhatsApp messages to the current Operations worker without trusting renderer-supplied worker identity and without introducing a second worker-authentication system.

This design corrects the Task 4 ambiguity in `docs/superpowers/plans/2026-09-02-tux-operations-whatsapp-inbox.md` while preserving the approved local-first Operations session model and the approved WhatsApp channel tenant-resolution model.

## 2. Binding decision

TUX shall use the existing synchronized remote `worker_sessions` projection as the server-side authority for the current worker when an authenticated Operations client sends a WhatsApp message.

The authority chain is:

```text
authenticated device session
        ↓
authoritative shop_id + device_id
        ↓
client claims businessDayId + workerId
        ↓
remote OPEN business_day
+ exactly one OPEN worker_session
+ active worker
        ↓
verified Current Operator
```

`businessDayId` and `workerId` are correlation claims, not authority by themselves. The server must verify them against synchronized TUX operational state before creating any outbound WhatsApp intent or calling Meta.

## 3. Why this is the long-term model

This model reuses TUX's existing operational truth rather than creating parallel authentication state:

- the device session already authenticates the Operations device and resolves its shop;
- the local Operations session already owns worker PIN sign-in, switch, and sign-out semantics;
- local session transitions already create durable audit/outbox events;
- Operations sync already materializes Business Day and worker-session lifecycle remotely;
- the remote schema already enforces at most one open worker session per Business Day;
- WhatsApp worker attribution can therefore verify the same Current Operator lifecycle used by TUX instead of inventing a WhatsApp-only worker session.

No signed worker cookie, client-authoritative worker ID, deployment worker setting, or WhatsApp-specific PIN/session subsystem is introduced in v1.

## 4. Existing authority boundaries

### 4.1 Device identity

The existing server device-session gateway remains authoritative for:

- `shop_id`;
- `device_id`;
- device enrollment/session validity.

A WhatsApp POST body must never choose the authoritative shop or device.

`device_id` remains durable audit context for outbound messages, even though the current WorkerSession domain does not yet bind operator sessions to a device.

### 4.2 Local worker session

The installed/browser Operations runtime remains authoritative locally for:

- Business Day creation/open state;
- worker PIN sign-in;
- worker switch;
- worker sign-out;
- the Current Operator shown to the worker;
- local audit/outbox events.

The local state remains local-first. WhatsApp must not make Orders, End Day, printing, or other POS workflows wait for Meta or for the remote WhatsApp service.

### 4.3 Remote worker-session projection

The synchronized remote `worker_sessions` projection is the server authority used specifically to verify that the worker claim attached to a remote WhatsApp send still matches the shop's current synchronized Operations session.

This is a verification boundary, not a replacement for the local session service.

## 5. Current device-binding limitation

The current shared `WorkerSession` domain model contains:

- `id`;
- `shopId`;
- `businessDayId`;
- `workerId`;
- `startedAt`;
- `endedAt`.

It does **not** contain `deviceId`.

Although the remote `worker_sessions` table currently has a nullable `device_id` column, Task 4 must not treat that column as authoritative operator-device binding because the current local session/outbox contract does not guarantee that it is populated.

Therefore v1 current-operator verification does **not** require `worker_sessions.device_id = authenticated device_id`.

This is deliberate, not an omission. If TUX later supports multiple concurrent Operations devices per shop, device-bound worker sessions must be introduced as an explicit domain + sync-contract migration and then added to this resolver through a versioned authority change. TUX must not infer future security guarantees from a nullable remote column that the canonical domain does not own today.

## 6. Server-side current-operator resolver

Add one server-only resolver boundary named:

```sql
public.resolve_tux_whatsapp_current_operator_v1(
  p_shop_id uuid,
  p_business_day_id uuid,
  p_claimed_worker_id uuid
)
```

It returns the validated current worker/business-day identity only when all required invariants hold.

The return shape must include at least:

- `business_day_id`;
- `worker_id`.

The authenticated device ID is not passed to this v1 resolver. It remains server-known audit context and is written to the outbound WhatsApp audit fields through the existing device session.

## 7. Required validation invariants

The resolver succeeds only when all of the following are true:

1. `p_shop_id` identifies an active shop.
2. `p_business_day_id` belongs to that same shop.
3. That Business Day is `OPEN`.
4. There is exactly one `worker_sessions` row for that Business Day with `ended_at is null`.
5. The open worker session belongs to the same shop.
6. The open worker session `worker_id` equals `p_claimed_worker_id`.
7. The referenced worker exists, is active, and belongs to the same shop.

No fallback chooses a worker when these invariants fail.

## 8. Client request contract

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
- the server derives authoritative `shopId` and `deviceId` from the authenticated device session;
- the server validates `businessDayId` and `workerId` against the remote current-operator resolver before creating any outbound intent;
- changing body `workerId` cannot attribute a message to another active worker.

If an older/client DTO contains a redundant `shopId`, the server must reject a mismatch and must never use the body value to select a tenant. Long-term platform contracts should omit redundant authority fields where practical.

## 9. Outbound WhatsApp flow

The production send path is:

1. Receive authenticated Operations request.
2. Enforce same-origin rules where existing mutating API routes require them.
3. Resolve/refresh the existing device session.
4. Obtain authoritative `shop_id` and `device_id` from that session.
5. Parse `businessDayId` and `workerId` claims from the request.
6. Resolve the current synchronized worker through `resolve_tux_whatsapp_current_operator_v1(...)` using authoritative `shop_id`.
7. If current-operator verification fails, stop before creating an outbound intent and before calling Meta.
8. Resolve the active WhatsApp channel using the approved `shop_id -> whatsapp_channels -> provider_phone_number_id` path.
9. Create/find the Task 2 outbound intent with the verified `worker_id` and authoritative `device_id` attribution.
10. For a newly created intent only, call the provider gateway using the resolved provider phone-number ID.
11. Persist provider message ID/status through the approved server boundary.
12. Return the stored message/result to Operations.

The verified worker identity—not the raw body value—is written to `sent_by_worker_id`.

The authenticated device identity—not any body value—is written to `initiated_by_device_id`.

## 10. Synchronization race behavior

Worker switch/sign-out is local-first and may temporarily be ahead of the remote projection.

Example:

```text
Local current worker: B
Remote open worker session: A
```

In that state, a WhatsApp send claiming Worker B must fail safely with a typed synchronization conflict.

Bound API behavior:

```text
HTTP 409
error = whatsapp_operator_not_synchronized
```

The server performs:

- no outbound-intent creation;
- no Meta call;
- no worker attribution mutation.

Once the existing Operations outbox synchronizes the worker-session transition and the remote projection matches Worker B, the send may be retried through the normal WhatsApp send path.

The UI/application layer may request/await an immediate normal Operations sync before retrying, but it must not bypass current-operator verification.

## 11. Business Day rules

WhatsApp worker sends require an `OPEN` Business Day and a verified open worker session.

Therefore:

- no current Business Day -> no worker send;
- CLOSED Business Day -> no worker send under that closed day;
- signed-out worker / no open worker session -> no worker send;
- stale claims from a prior Business Day -> no worker send.

This does not change Business Day lifecycle. WhatsApp consumes it as an authorization condition only.

## 12. Idempotency ordering

Current-operator verification occurs **before** creation of a new outbound intent.

This prevents a stale/unauthorized worker claim from leaving a durable outbound intent that can never validly send.

For an already-existing outbound intent key:

- Task 2 idempotency remains authoritative;
- Meta must never be called a second time for the same durable intent;
- another shop cannot access the intent;
- another worker cannot take over attribution;
- another device cannot take over the recorded `initiated_by_device_id`;
- a retry must return/reconcile the existing stored result according to the established outbound-intent state rather than manufacture a new send.

The Task 4 implementation plan must explicitly test this ordering.

## 13. Future multi-device evolution

V1 product scope remains one Operations laptop per shop.

The server does not treat that topology as an everlasting architectural law. Instead:

- authoritative shop/device identity already comes from the device session;
- device identity is durably recorded on WhatsApp outbound intent audit;
- current operator authority comes from the canonical worker-session lifecycle;
- future multi-device support can version the WorkerSession domain to include a device binding and then strengthen `resolve_tux_whatsapp_current_operator_v1` or introduce `v2` without replacing the overall authority chain.

No multi-device presence, chat locking, or session migration is added now.

## 14. Failure isolation

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

## 15. Error contract

At minimum Task 4 must distinguish these categories without exposing secrets or cross-tenant data:

- device session missing/invalid -> existing device-session `401` behavior;
- malformed WhatsApp request -> `400`;
- redundant/cross-shop authority mismatch -> `403` or the established validation response without selecting the body shop;
- current operator not synchronized / stale Business Day-worker claim -> `409 whatsapp_operator_not_synchronized`;
- WhatsApp channel missing/inactive -> typed WhatsApp unavailable/configuration response;
- remote backend transport unavailable -> `503`;
- invalid upstream/provider protocol -> `502` where appropriate.

Exact envelopes should follow existing server gateway conventions.

## 16. Migration strategy

Do not modify completed WhatsApp migrations from Tasks 2 or 3.

Add one append-only migration:

`supabase/migrations/20260902224500_whatsapp_current_worker_authority.sql`

It adds only the server-side current-operator resolver and the minimal supporting objects actually required by the verified current schema.

Do not add:

- a second worker-session table;
- duplicate Current Operator state;
- a WhatsApp-specific worker authentication table;
- a device-binding constraint unsupported by the current shared WorkerSession domain.

No production migration deployment is part of implementation coding.

## 17. Privilege boundary

The resolver is server-only.

Follow repository conventions:

- `SECURITY DEFINER` only where required;
- fixed safe `search_path`;
- revoke from `public`, `anon`, and `authenticated`;
- grant execution only to the trusted server/service boundary used by the WhatsApp gateway;
- no renderer/browser direct access to the resolver;
- no service-role secret in browser/Electron code.

## 18. Explicitly rejected alternatives

### 18.1 Signed worker HttpOnly cookie

Rejected for v1.

It would create a second worker-session state with independent signing, expiry, rotation, sign-out invalidation, and offline-staleness semantics. TUX already has a durable worker-session lifecycle.

### 18.2 Client-authoritative worker ID

Rejected.

Checking only that a claimed worker is active in the shop does not prove that worker is the Current Operator.

### 18.3 Deployment worker/shop identity

Rejected.

No `TUX_WHATSAPP_WORKER_ID`, `TUX_WHATSAPP_SHOP_ID`, or equivalent deployment variable may determine worker attribution.

### 18.4 First/only open session without claim verification

Rejected.

The server compares the client's local session claims with the synchronized remote session so stale local/remote state becomes an explicit conflict rather than silent misattribution.

### 18.5 Nullable remote `worker_sessions.device_id` as current authority

Rejected for v1.

The canonical WorkerSession domain does not currently carry device identity, so the nullable remote field cannot be promoted into a security invariant without a separate domain/sync-contract change.

## 19. Testing requirements

The Task 4 amendment must include TDD coverage proving at minimum:

1. `supabase/migrations/20260902224500_whatsapp_current_worker_authority.sql` is absent before the migration RED;
2. the resolver requires an active shop;
3. CLOSED/wrong Business Day does not resolve;
4. no open worker session does not resolve;
5. a different claimed worker does not resolve even if that worker is active in the same shop;
6. a worker from another shop does not resolve;
7. the valid shop/business-day/current-worker tuple resolves exactly one worker;
8. `worker_sessions.device_id` is not used as an unbacked v1 authorization requirement;
9. request-body `shopId` cannot choose the tenant;
10. request-body `deviceId` cannot choose outbound audit identity;
11. `SEND_MESSAGE` performs current-operator verification before outbound-intent creation;
12. `409 whatsapp_operator_not_synchronized` causes no outbound-intent creation and no Meta call;
13. after synchronized worker switch, Worker B can send and durable attribution is Worker B;
14. Worker A's stale claim cannot send after the synchronized switch to Worker B;
15. the authoritative device session ID is stored in outbound audit attribution;
16. duplicate retry of the same valid outbound intent does not call Meta twice;
17. another worker cannot reuse an existing intent key to cause resend or attribution takeover;
18. another device cannot replace the existing intent's durable device attribution;
19. outbound channel routing still uses the approved authenticated `shop_id -> whatsapp_channels` mapping;
20. WhatsApp authorization failure does not alter unrelated POS state.

Migration/security tests must extend existing repository gates without weakening historical tests.

## 20. Scope

This correction adds only server-side current-worker authority required by Task 4 outbound WhatsApp actions.

It does not add:

- a new worker PIN system;
- a worker authentication cookie;
- a WorkerSession device-binding migration;
- Admin UI;
- multi-device chat locking;
- WhatsApp channel onboarding UI;
- TUX-MENU Web Order Bridge behavior;
- AI/chatbot behavior;
- production secrets;
- production migration deployment.

## 21. Acceptance invariant

**An outbound WhatsApp message may be attributed to a worker only when the authenticated Operations device supplies the authoritative shop/device identity and the client's Business Day/worker claim matches the shop's currently open synchronized TUX worker session. A stale, cross-shop, signed-out, or closed-day claim produces no outbound intent and no Meta send; the authenticated device ID remains the durable device attribution for every valid outbound intent.**
