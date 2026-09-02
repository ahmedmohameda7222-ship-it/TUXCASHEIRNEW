# TUX Operations WhatsApp Inbox Task 2 Amendment

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans for Classic ChatGPT execution. This amendment supersedes **only Task 2** of `docs/superpowers/plans/2026-09-02-tux-operations-whatsapp-inbox.md`. Task 1 remains governed by its prior amendment. After this amended Task 2 passes and is committed, resume the original plan at Task 3 without changing its order.

**Goal:** Add the WhatsApp remote persistence migration and migration contract test without creating redundant uniqueness structures.

**Architecture:** Provider message IDs and outbound intent keys are nullable until those identities exist, so idempotency is enforced by two partial unique indexes on `(shop_id, provider_message_id)` and `(shop_id, outbound_intent_key)` with `WHERE ... IS NOT NULL`. Do not add duplicate table-level `UNIQUE (shop_id, ...)` constraints. This follows the repository's established rule of avoiding redundant uniqueness indexes/write amplification.

**Tech Stack:** PostgreSQL/Supabase migrations, Node.js migration contract tests.

**Spec:** `docs/superpowers/specs/2026-09-02-tux-operations-whatsapp-inbox-design.md`

## Global Constraints

- Use an append-only new migration. Do not rewrite historical migrations.
- Exact migration path for this task: `supabase/migrations/20260902220000_whatsapp_inbox.sql`.
- Do not add table-level `UNIQUE (shop_id, provider_message_id)` or `UNIQUE (shop_id, outbound_intent_key)` constraints.
- Enforce those identities only through the named partial unique indexes documented below.
- Every tenant-owned WhatsApp table must carry `shop_id` and be protected by RLS.
- Do not grant anonymous/public table mutation.
- Follow existing repository `SECURITY DEFINER`, explicit `REVOKE`, controlled-grant, and tenant-fencing patterns.
- No production migration deployment in this task.
- No manual Supabase migration-history edits.

---

### Amended Task 2: Add remote WhatsApp persistence with tenant fencing and non-redundant idempotency indexes

**Files:**
- Create: `supabase/migrations/20260902220000_whatsapp_inbox.sql`
- Create: `scripts/test-whatsapp-migration.mjs`
- Modify: `package.json`

**Interfaces produced:**
- Remote tables: `whatsapp_conversations`, `whatsapp_messages`, `whatsapp_quick_replies`, `whatsapp_conversation_order_links`.
- Partial unique index: `whatsapp_messages_provider_message_unique` on `(shop_id, provider_message_id)` where `provider_message_id is not null`.
- Partial unique index: `whatsapp_messages_outbound_intent_unique` on `(shop_id, outbound_intent_key)` where `outbound_intent_key is not null`.
- RLS-enabled tenant-owned tables with direct public/client mutation fenced.

- [ ] **Step 1: Write the migration contract test first**

Create `scripts/test-whatsapp-migration.mjs` with this exact contract shape:

```js
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migrationPath = resolve(
  'supabase/migrations/20260902220000_whatsapp_inbox.sql',
);

assert.equal(
  existsSync(migrationPath),
  true,
  '20260902220000_whatsapp_inbox.sql is missing.',
);

const sql = readFileSync(migrationPath, 'utf8');

for (const table of [
  'whatsapp_conversations',
  'whatsapp_messages',
  'whatsapp_quick_replies',
  'whatsapp_conversation_order_links',
]) {
  assert.match(sql, new RegExp(`\\b${table}\\b`, 'i'));
}

assert.match(
  sql,
  /create\s+unique\s+index\s+whatsapp_messages_provider_message_unique\s+on\s+public\.whatsapp_messages\s*\(\s*shop_id\s*,\s*provider_message_id\s*\)\s+where\s+provider_message_id\s+is\s+not\s+null\s*;/i,
  'provider-message idempotency must use the required partial unique index.',
);

assert.match(
  sql,
  /create\s+unique\s+index\s+whatsapp_messages_outbound_intent_unique\s+on\s+public\.whatsapp_messages\s*\(\s*shop_id\s*,\s*outbound_intent_key\s*\)\s+where\s+outbound_intent_key\s+is\s+not\s+null\s*;/i,
  'outbound-intent idempotency must use the required partial unique index.',
);

assert.doesNotMatch(
  sql,
  /\bunique\s*\(\s*shop_id\s*,\s*provider_message_id\s*\)/i,
  'Do not add a redundant table-level provider_message_id unique constraint.',
);

assert.doesNotMatch(
  sql,
  /\bunique\s*\(\s*shop_id\s*,\s*outbound_intent_key\s*\)/i,
  'Do not add a redundant table-level outbound_intent_key unique constraint.',
);

assert.match(sql, /enable\s+row\s+level\s+security/i);
assert.match(sql, /revoke\s+all/i);
```

The two negative assertions are intentional. They ensure the implementation cannot satisfy the test by adding duplicate table-level unique constraints alongside the required partial indexes.

- [ ] **Step 2: Run RED**

Run:

```bash
node scripts/test-whatsapp-migration.mjs
```

Expected: FAIL with `20260902220000_whatsapp_inbox.sql is missing.` because the migration has not been created yet.

Do not create the migration before recording this RED.

- [ ] **Step 3: Create the migration using the original Task 2 schema/security requirements**

Create `supabase/migrations/20260902220000_whatsapp_inbox.sql` and implement the WhatsApp tables, tenant keys, foreign keys, check constraints, RLS, server-side RPC/function boundaries, explicit revocations, and controlled grants required by the original Task 2.

For message idempotency, use exactly these two structures and **no equivalent table-level duplicate constraints**:

```sql
create unique index whatsapp_messages_provider_message_unique
  on public.whatsapp_messages (shop_id, provider_message_id)
  where provider_message_id is not null;

create unique index whatsapp_messages_outbound_intent_unique
  on public.whatsapp_messages (shop_id, outbound_intent_key)
  where outbound_intent_key is not null;
```

This task must preserve nullable provider/outbound identities; do not make either column `not null` merely to simplify uniqueness.

- [ ] **Step 4: Run the focused contract test GREEN**

Run:

```bash
node scripts/test-whatsapp-migration.mjs
```

Expected: PASS.

If the test passes only after adding table-level `UNIQUE (shop_id, ...)` constraints, the implementation is wrong; remove the redundant constraints and fix the migration instead.

- [ ] **Step 5: Extend the repository migration gate**

Modify the root `package.json` `test:migrations` script so it also runs:

```text
node scripts/test-whatsapp-migration.mjs
```

Preserve all existing migration/security test commands and their order unless insertion requires placing the new WhatsApp migration test after the general migration runner.

- [ ] **Step 6: Run the full migration gate**

Run:

```bash
npm run test:migrations
```

Expected: PASS.

If an existing migration test fails, STOP and report the exact failing command/output. Do not weaken an existing test to accommodate the WhatsApp migration.

- [ ] **Step 7: Verify the migration remains append-only and no historical SQL changed**

Run:

```bash
git diff --name-only HEAD~1..HEAD
```

if a commit already exists for intermediate work, or otherwise inspect:

```bash
git status --short
git diff -- supabase/migrations package.json scripts/test-whatsapp-migration.mjs
```

Before commit, confirm the only new migration is:

```text
supabase/migrations/20260902220000_whatsapp_inbox.sql
```

and that no existing migration file was modified.

- [ ] **Step 8: Commit**

```bash
git add \
  supabase/migrations/20260902220000_whatsapp_inbox.sql \
  scripts/test-whatsapp-migration.mjs \
  package.json

git commit -m "feat: add WhatsApp inbox persistence"
```

- [ ] **Step 9: Report Task 2 evidence before continuing**

Report:

```text
TASK 2 COMPLETE

RED:
node scripts/test-whatsapp-migration.mjs
FAIL — expected missing migration

GREEN:
node scripts/test-whatsapp-migration.mjs
PASS

Migration gate:
npm run test:migrations
PASS

Uniqueness model:
- partial unique index on (shop_id, provider_message_id) WHERE provider_message_id IS NOT NULL
- partial unique index on (shop_id, outbound_intent_key) WHERE outbound_intent_key IS NOT NULL
- no duplicate table-level UNIQUE constraints

Historical migrations modified: NO
Production deployment performed: NO
Commit: <exact SHA>
Working tree: <clean or explain>
```

Then resume the original WhatsApp Inbox implementation plan at **Task 3**. If Task 3 has a repository/plan contradiction, STOP with evidence rather than guessing.

## Amendment Self-Review Result

- The original contradiction between `UNIQUE (...)` regexes and required partial unique indexes is removed.
- The contract now positively proves both named partial unique indexes including their `WHERE ... IS NOT NULL` predicates.
- The contract negatively proves redundant table-level uniqueness is absent.
- The exact migration filename is fixed; no `HHMM` placeholder remains for this task.
- Existing RLS/revocation requirements are retained.
- No product architecture or WhatsApp domain behavior is changed by this amendment.
