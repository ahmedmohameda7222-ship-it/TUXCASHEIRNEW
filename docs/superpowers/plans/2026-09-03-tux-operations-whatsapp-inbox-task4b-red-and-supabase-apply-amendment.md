# TUX Operations WhatsApp Inbox — Task 4B RED + Supabase Apply Amendment

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` for Classic ChatGPT execution. This amendment supersedes only the Task 4B shared-contract RED mechanics and the earlier blanket prohibition on production migration application for the three explicitly listed WhatsApp migrations. All Task 4 architecture, security, idempotency, and Current Operator requirements remain binding.

**Goal:** Replace the invalid Vitest runtime RED for a type-only shared contract with a real TypeScript compile RED, and explicitly authorize application of the three already-reviewed WhatsApp migrations to the production TUX V2 Supabase project.

**Repository:** `ahmedmohameda7222-ship-it/TUXCASHEIRNEW`

**Permanent implementation branch:** `feat/operations-whatsapp-inbox`

**Task 4A approved implementation HEAD at amendment time:** `821de0be5c26ce00ed6a3584ef1aa0924ff57f6d`

**Production Supabase project:** `TUX V2` / `awpdcsayuwbsruwvaosg`

**Parent Task 4 plan:** `docs/superpowers/plans/2026-09-02-tux-operations-whatsapp-inbox-task4-amendment-final.md`

## 1. Root cause of the invalid Task 4B RED

The original Task 4B test uses:

```ts
import type { WhatsAppRemoteGateway } from './whatsappRemote';
```

Vitest/esbuild erases type-only imports during runtime transformation. Therefore:

```bash
npm test -- packages/application/src/whatsappRemote.test.ts
```

can pass even when `packages/application/src/whatsappRemote.ts` does not exist.

The observed PASS is therefore expected toolchain behavior and is not a valid RED. Do not change production architecture to force a runtime import.

## 2. Binding replacement RED

Keep the exact provider-agnostic contract test from the final Task 4 plan in:

```text
packages/application/src/whatsappRemote.test.ts
```

Do not create `packages/application/src/whatsappRemote.ts` yet.

Run:

```bash
npm run typecheck -w @tux/application
```

Expected RED:

```text
TS2307: Cannot find module './whatsappRemote' or its corresponding type declarations.
```

The package TypeScript config includes `src`, so this compile gate resolves type-only imports and is the correct missing-module RED.

Record this RED before creating `whatsappRemote.ts`.

Then create the minimal shared contract implementation required by the final Task 4 plan.

Run GREEN:

```bash
npm run typecheck -w @tux/application
npm test -- packages/application/src/whatsappRemote.test.ts
```

Expected: both PASS.

The earlier diagnostic Vitest PASS on the missing type-only module is preserved as diagnostic evidence only; it is not counted as the Task 4B RED.

## 3. No architecture change

This amendment changes only the TDD verification mechanism.

It does not change:

- `WhatsAppRemoteGateway` responsibilities;
- provider-agnostic application boundaries;
- server-only Meta/provider code;
- authenticated device-session authority;
- Current Operator verification;
- channel routing;
- outbound idempotency;
- uncertainty handling;
- browser/renderer isolation;
- Task 4A SQL contracts.

## 4. Explicit production Supabase migration authorization

The user explicitly authorized applying pending migrations to Supabase on 2026-09-03.

This authorization overrides the earlier `production deployment = NO` restriction **only for applying the following three repository migrations to the existing production TUX V2 Supabase database**:

```text
supabase/migrations/20260902220000_whatsapp_inbox.sql
supabase/migrations/20260902223000_whatsapp_channels.sql
supabase/migrations/20260902224500_whatsapp_current_worker_authority.sql
```

Production project:

```text
TUX V2
project_id = awpdcsayuwbsruwvaosg
```

Read-only production inspection at amendment time confirmed the effects of all three are absent: no `whatsapp_conversations`, no `whatsapp_channels`, no inbound materializer/channel resolvers, and no Current Operator/outbound-claim resolver.

### Required deployment sequence

Before applying anything:

1. Verify the target project is exactly `awpdcsayuwbsruwvaosg` (`TUX V2`).
2. Re-check the expected effects are still absent/pending.
3. Fetch the exact SQL contents from the permanent implementation branch/repository commits. Do not rewrite or hand-reconstruct SQL.
4. Apply migrations in timestamp order using the Supabase migration/DDL mechanism, not ad-hoc `execute_sql` for DDL and not manual migration-history inserts.

Apply in this exact order:

```text
1. 20260902220000_whatsapp_inbox.sql
2. 20260902223000_whatsapp_channels.sql
3. 20260902224500_whatsapp_current_worker_authority.sql
```

Use migration names:

```text
whatsapp_inbox
whatsapp_channels
whatsapp_current_worker_authority
```

If any earlier migration is already materially present when rechecked, do not blindly reapply it. Stop and reconcile effects first.

### Required post-apply verification

After all three are applied, verify at minimum:

```sql
select
  to_regclass('public.whatsapp_conversations')::text,
  to_regclass('public.whatsapp_messages')::text,
  to_regclass('public.whatsapp_channels')::text,
  to_regprocedure('public.materialize_tux_whatsapp_inbound_v1(uuid,text,text,text,text,text,text,jsonb,timestamptz)')::text,
  to_regprocedure('public.resolve_tux_whatsapp_inbound_channel_v1(text,text)')::text,
  to_regprocedure('public.resolve_tux_whatsapp_outbound_channel_v1(uuid)')::text,
  to_regprocedure('public.resolve_tux_whatsapp_current_operator_v1(uuid,uuid,uuid)')::text,
  to_regprocedure('public.claim_tux_whatsapp_outbound_intent_v2(uuid,uuid,uuid,uuid,uuid,text,text,text,text,jsonb,timestamptz)')::text;
```

All must resolve non-null.

Also verify:

- RLS is enabled on the WhatsApp tables;
- `anon` and `authenticated` do not have direct mutation/table privileges;
- resolver/materialization RPC execution is granted only to the intended trusted service boundary;
- no production `whatsapp_channels` row is invented unless the user separately supplies/authorizes the real Meta channel identity;
- no Meta token/webhook/Vercel environment setup is implied by this migration authorization.

Run Supabase security advisor after DDL application and report any new warnings/errors. Existing intentional deny-by-default/no-policy RLS patterns are not a reason to weaken RLS.

## 5. Scope of production authorization

Authorized now:

- apply the three listed WhatsApp database migrations to production TUX V2 Supabase;
- verify schema/functions/privileges/advisors.

Not authorized by this amendment:

- inserting a guessed `whatsapp_channels` production row;
- configuring a Meta phone number ID;
- adding real Meta access tokens/app secrets;
- registering the Meta webhook;
- changing Vercel production environment variables;
- deploying application code to production;
- deploying any migration other than the three explicitly listed above.

## 6. Task 4 continuation

After the migration application and Task 4B compile RED are recorded, continue the final Task 4 plan from the shared contract implementation onward.

After full Task 4 completion and verification, STOP before Task 5 and return evidence to Planner/Auditor.
