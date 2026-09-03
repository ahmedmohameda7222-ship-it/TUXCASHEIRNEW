# TUX Operations WhatsApp Task 5.1 + Corrected Task 6 — Execution Corrections

**Date:** 2026-09-03  
**Status:** BINDING execution amendment.  
**Applies to:** `docs/superpowers/plans/2026-09-03-tux-operations-whatsapp-runtime-transport-task5-1-task6.md`  
**Binding design:** `docs/superpowers/specs/2026-09-03-whatsapp-runtime-transport-boundary-design.md`

This amendment does not change the approved architecture. It corrects execution details found during the required self-review of the implementation plan. Where this file conflicts with the parent plan, **this file wins**.

---

## 1. Execution mode is Classic ChatGPT only

The parent plan's generic template line mentioning `subagent-driven-development` is superseded.

Binding execution mode:

```text
Classic ChatGPT implementer
superpowers:executing-plans
NO subagents
one task/checkpoint at a time
strict RED -> verify RED -> minimal GREEN -> verify GREEN -> related gate -> commit
```

Do not invoke or simulate subagent-driven development.

---

## 2. Exact existing local schema files are confirmed

The Task 5 browser migration source is exactly:

```text
packages/persistence/src/browser/indexedDbMigrations.ts
```

At the approved Task 5 baseline it has:

```text
INDEXED_DB_VERSION = 5
migration v5 = whatsapp_local_cache
```

The Task 5 SQLite migration source is exactly:

```text
packages/persistence/src/sqlite/migrations.ts
```

Therefore the Task 5.1 schema-immutability command is exactly:

```bash
git diff 66c981af26c4aa6779a414e78f3642c31ef4ee3e -- \
  packages/persistence/src/sqlite/migrations.ts \
  packages/persistence/src/browser/indexedDbMigrations.ts \
  supabase/migrations
```

Expected: no output.

Remove the parent plan's conditional language about discovering a different IndexedDB migration filename. No discovery is required.

---

## 3. Do not modify the desktop package manifest for Task 6

`apps/operations-desktop/package.json` already contains all required workspace dependencies:

```text
@tux/application
@tux/domain
@tux/persistence
@tux/platform-contracts
@tux/printing
@tux/sync
```

Therefore:

```text
apps/operations-desktop/package.json
```

is **not a Task 6 implementation file** and must not be changed for the runtime bridge described by this plan.

Remove it from the Task 5 staging command in the parent plan.

If a genuinely new external dependency unexpectedly appears necessary, STOP and return to the Planner/Auditor instead of adding it ad hoc.

---

## 4. Replace the brittle final `shopId` grep with request-capture evidence

The parent plan's Task 8 Step 8 raw grep for:

```text
shopId
providerPhoneNumberId
sentByWorkerId
```

inside `desktopWhatsAppRemote.ts` is superseded. A parser/type implementation may legitimately mention a returned domain field; source-token absence is not the security property.

The binding security property is **what the desktop sends on the wire**.

`apps/operations-desktop/src/main/desktopWhatsAppRemote.test.ts` must contain a request-capture test that performs both GET and representative POST calls and asserts the captured outbound request has:

Allowed authority headers only:

```text
Authorization: Bearer <access token>
x-tux-device-id: <device ID>
Accept: application/json
Content-Type: application/json   # POST only
```

And explicitly asserts the following are absent from headers, URL query, and serialized POST body unless they are a legitimate Task 4 application payload field listed below:

```text
shopId
deviceId
sentByWorkerId
providerPhoneNumberId
refreshToken
SUPABASE_SERVICE_ROLE_KEY
TUX_SUPABASE_SERVICE_ROLE_KEY
TUX_WHATSAPP_ACCESS_TOKEN
TUX_WHATSAPP_APP_SECRET
TUX_WHATSAPP_WEBHOOK_VERIFY_TOKEN
apikey
```

The only worker/business authority fields allowed in mutation bodies remain the existing Task 4 application claims where applicable:

```text
businessDayId
workerId
```

plus the operation's normal non-authority payload (`conversationId`, `outboundIntentKey`, `text`, `orderId`, booleans, action).

Final verification must run that test and report it PASS. Do not delete legitimate response parsing merely to satisfy a grep.

---

## 5. Same-origin regression must be scheme-aware when proxy protocol is available

The approved spec requires browser POST **same-origin** enforcement, not merely same-host enforcement.

The current `requireSameOrigin()` checks the host. Corrected Task 6 may harden it narrowly so that when the trusted reverse-proxy protocol signal is present it also compares scheme.

Binding behavior:

```text
origin host != forwarded/request host                  -> 403
x-forwarded-proto=https + Origin=http://same-host     -> 403
x-forwarded-proto=https + Origin=https://same-host    -> allowed
no Origin (Electron main bearer request)               -> allowed
```

Do not weaken the existing host check.

Recommended minimal change in `server/supabaseGateway.ts`:

```ts
const forwardedProto = firstHeader(request.headers['x-forwarded-proto'])
  .split(',')[0]
  ?.trim()
  .toLowerCase() ?? '';
const parsedOrigin = new URL(origin);
if (
  parsedOrigin.host !== host ||
  (forwardedProto.length > 0 && parsedOrigin.protocol !== `${forwardedProto}:`)
) {
  sendJson(response, 403, { error: 'origin_not_allowed' });
  return false;
}
```

Tests must add the same-host/wrong-scheme case with `x-forwarded-proto: https` and prove 403 before WhatsApp mutation. Keep existing callers compatible; this is a narrow hardening of the shared same-origin helper, not a new authentication mechanism.

---

## 6. Reviewer checkpoint after Task 5.1 is mandatory

The parent plan's conditional reviewer wording is superseded.

After Task 5.1 is committed:

```text
STOP.
DO NOT START corrected Task 6.
```

Report Task 5.1 evidence to the Planner/Auditor:

```text
architecture RED command/result
architecture GREEN command/result
Task 5 regression tests
persistence typecheck
application typecheck
schema diff = no output
commit SHA
exact changed files
working tree state
```

Only continue to corrected Task 6 after the Planner/Auditor explicitly approves Task 5.1.

This keeps the package-boundary cleanup independently auditable and prevents a large runtime/security change from obscuring it.

---

## 7. Corrected Task 6 checkpointing

After Task 5.1 approval, execute the parent Task 6 in these independently committed checkpoints:

```text
6A shared wire/error contract
6B unified server device authority
6C desktop WhatsApp remote
6D platform contract + Electron main IPC composition
6E defensive preload bridge
6F browser runtime composition
6G final verification only
```

The implementer may proceed checkpoint-to-checkpoint within corrected Task 6 under the approved plan, but if any binding RED unexpectedly passes, any architecture/interface contradiction appears, or a new dependency/schema requirement appears, STOP with evidence rather than guessing.

After 6G:

```text
STOP.
DO NOT START the original WhatsApp Task 7 UI.
```

---

## 8. Production boundary remains unchanged

Neither Task 5.1 nor corrected Task 6 authorizes production mutation.

Still forbidden:

```text
Supabase production SQL application
production whatsapp_channels insert/update
Meta webhook/app/phone configuration
real Meta credential changes
Vercel production environment changes
application production deployment
Windows release publication
```

`TUX_OPERATIONS_API_ORIGIN` is introduced as an environment-variable **name only** in this task. Do not set its production value here.

---

## 9. Final authority order

For implementation, read in this order:

1. `docs/superpowers/specs/2026-09-03-whatsapp-runtime-transport-boundary-design.md`
2. `docs/superpowers/plans/2026-09-03-tux-operations-whatsapp-runtime-transport-task5-1-task6.md`
3. `docs/superpowers/plans/2026-09-03-tux-operations-whatsapp-runtime-transport-task5-1-task6-execution-corrections.md`

The design spec is architectural authority. The parent plan supplies the full implementation detail. This amendment supplies the final execution corrections above.
