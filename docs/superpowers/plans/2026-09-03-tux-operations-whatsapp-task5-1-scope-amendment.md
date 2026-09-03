# TUX Operations WhatsApp Task 5.1 Scope Amendment

> **For this project:** Classic ChatGPT must use `superpowers:executing-plans` inline. NO subagents.

**Goal:** Amend only Task 5.1 file scope after the valid architecture RED proved that four additional persistence files also import `@tux/application`.

**Architecture:** No design change. `@tux/persistence` still owns neutral local-cache DTOs and must have zero source imports from `@tux/application`, including type-only imports and tests under `packages/persistence/src`. The additional files are direct participants in the same dependency-cycle cleanup and must consume the persistence-owned cache snapshot type.

**Tech Stack:** TypeScript 6, Vitest 4, Node 24, SQLite, IndexedDB.

**Spec:** `docs/superpowers/specs/2026-09-03-whatsapp-runtime-transport-boundary-design.md`

## Authority

This amendment is binding for Task 5.1 and supersedes only the Task 5.1 file-scope restriction in:

- `docs/superpowers/plans/2026-09-03-tux-operations-whatsapp-runtime-transport-task5-1-task6.md`
- `docs/superpowers/plans/2026-09-03-tux-operations-whatsapp-runtime-transport-task5-1-task6-execution-corrections.md`

All other Task 5.1 constraints and the mandatory STOP before corrected Task 6 remain unchanged.

## Independently verified blocker

At approved implementation baseline:

`66c981af26c4aa6779a414e78f3642c31ef4ee3e`

all five of these files directly import `@tux/application`:

1. `packages/persistence/src/whatsappStore.ts`
2. `packages/persistence/src/browser/IndexedDbWhatsAppStore.ts`
3. `packages/persistence/src/browser/IndexedDbWhatsAppStore.test.ts`
4. `packages/persistence/src/sqlite/SqliteWhatsAppStore.ts`
5. `packages/persistence/src/sqlite/SqliteWhatsAppStore.test.ts`

The diagnostic architecture guard correctly failed against all five. Do not weaken or narrow the guard.

The permanent implementation branch remains at the approved baseline. The diagnostic branch is evidence only and must not be merged wholesale.

---

## Amended Task 5.1 file scope

### Previously authorized files remain authorized

- Create: `scripts/test-whatsapp-package-layering.mjs`
- Modify: `packages/persistence/src/whatsappStore.ts`
- Modify: `packages/persistence/src/index.ts`
- Modify: `packages/application/src/whatsappRemote.ts`
- Modify: `package.json`

### Newly authorized files

- Modify: `packages/persistence/src/browser/IndexedDbWhatsAppStore.ts`
- Modify: `packages/persistence/src/browser/IndexedDbWhatsAppStore.test.ts`
- Modify: `packages/persistence/src/sqlite/SqliteWhatsAppStore.ts`
- Modify: `packages/persistence/src/sqlite/SqliteWhatsAppStore.test.ts`

No other production/source files are authorized by this amendment.

---

## Exact cleanup required in the newly authorized implementation files

### `packages/persistence/src/browser/IndexedDbWhatsAppStore.ts`

Remove:

```ts
import type { WhatsAppInboxSnapshot } from '@tux/application';
```

Continue importing the persistence contract from `../whatsappStore`, and include `CachedWhatsAppInboxSnapshot` there.

Change:

```ts
async upsertRemoteSnapshot(snapshot: WhatsAppInboxSnapshot): Promise<void>
```

to:

```ts
async upsertRemoteSnapshot(snapshot: CachedWhatsAppInboxSnapshot): Promise<void>
```

Do not change IndexedDB schema, indexes, migration version, tenant fencing, sorting, draft behavior, or persistence semantics.

### `packages/persistence/src/sqlite/SqliteWhatsAppStore.ts`

Remove:

```ts
import type { WhatsAppInboxSnapshot } from '@tux/application';
```

Continue importing the persistence contract from `../whatsappStore`, and include `CachedWhatsAppInboxSnapshot` there.

Change the `upsertRemoteSnapshot` parameter type from `WhatsAppInboxSnapshot` to `CachedWhatsAppInboxSnapshot`.

Do not change SQLite schema, migrations, SQL tables/indexes, tenant fencing, sorting, draft behavior, or persistence semantics.

---

## Exact cleanup required in the newly authorized tests

### `packages/persistence/src/browser/IndexedDbWhatsAppStore.test.ts`

Remove:

```ts
import type { WhatsAppInboxSnapshot } from '@tux/application';
```

Add a relative persistence-owned type import:

```ts
import type { CachedWhatsAppInboxSnapshot } from '../whatsappStore';
```

Change the local snapshot helper from application wire shape to persistence cache shape:

```ts
function snapshot(input: {
  conversations?: readonly WhatsAppConversation[];
  messages?: readonly WhatsAppMessage[];
  quickReplies?: readonly WhatsAppQuickReply[];
  orderLinks?: CachedWhatsAppInboxSnapshot['orderLinks'];
}): CachedWhatsAppInboxSnapshot {
  return {
    conversations: input.conversations ?? [],
    messages: input.messages ?? [],
    quickReplies: input.quickReplies ?? [],
    orderLinks: input.orderLinks ?? [],
  };
}
```

Important: `nextCursor` must disappear from this persistence-store fixture. Pagination is remote/application state, not local-cache state.

Do not otherwise rewrite test behavior.

### `packages/persistence/src/sqlite/SqliteWhatsAppStore.test.ts`

Apply the same test-only type cleanup:

```ts
import type { CachedWhatsAppInboxSnapshot } from '../whatsappStore';
```

The local `snapshot()` helper must return `CachedWhatsAppInboxSnapshot`, use `CachedWhatsAppInboxSnapshot['orderLinks']`, and omit `nextCursor`.

Do not otherwise rewrite test behavior.

---

## RED handling

The existing RED from diagnostic run `33765918918`, job `100683625401`, is accepted as the mandatory Task 5.1 architecture RED because it failed for the intended architectural invariant: persistence source contains direct `@tux/application` imports.

The broader file list does not invalidate the RED; it reveals the original plan's incomplete scope.

Do not manufacture a narrower RED and do not weaken `scripts/test-whatsapp-package-layering.mjs` to name only `whatsappStore.ts`.

On the permanent branch, create/copy the same architecture guard and proceed directly to minimal GREEN using the amended scope.

---

## GREEN acceptance

After the minimal cleanup, run:

```bash
npm run test:whatsapp-architecture
```

Expected: PASS with zero `@tux/application` imports anywhere under `packages/persistence/src`.

Then run the original focused Task 5.1 regression gate:

```bash
npm test -- \
  packages/persistence/src/whatsappStore.test.ts \
  packages/application/src/whatsapp.test.ts \
  packages/persistence/src/sqlite/SqliteWhatsAppStore.test.ts \
  packages/persistence/src/browser/IndexedDbWhatsAppStore.test.ts
```

Then:

```bash
npm run typecheck -w @tux/persistence
npm run typecheck -w @tux/application
```

Then prove schema immutability:

```bash
git diff 66c981af26c4aa6779a414e78f3642c31ef4ee3e -- \
  packages/persistence/src/sqlite/migrations.ts \
  packages/persistence/src/browser/indexedDbMigrations.ts \
  supabase/migrations
```

Expected: no output.

Also run:

```bash
git grep -n "@tux/application" -- packages/persistence/src
```

Expected: exit 1 / no matches. Treat no matches as PASS for this negative grep.

---

## Commit scope

The Task 5.1 GREEN commit may contain exactly these implementation files:

```text
scripts/test-whatsapp-package-layering.mjs
packages/persistence/src/whatsappStore.ts
packages/persistence/src/index.ts
packages/persistence/src/browser/IndexedDbWhatsAppStore.ts
packages/persistence/src/browser/IndexedDbWhatsAppStore.test.ts
packages/persistence/src/sqlite/SqliteWhatsAppStore.ts
packages/persistence/src/sqlite/SqliteWhatsAppStore.test.ts
packages/application/src/whatsappRemote.ts
package.json
```

Do not include `.github/workflows/task5-1-red.yml` from the diagnostic branch in the permanent implementation commit.

Suggested commit:

```bash
git commit -m "refactor: remove WhatsApp persistence application dependency"
```

---

## Mandatory reviewer STOP

After Task 5.1 GREEN commit, STOP and return exact evidence to Planner/Auditor.

Do not start corrected Task 6.

The report must additionally state:

```text
Persistence architecture grep:
- @tux/application matches under packages/persistence/src: 0

Newly authorized files changed:
- IndexedDbWhatsAppStore.ts YES/NO
- IndexedDbWhatsAppStore.test.ts YES/NO
- SqliteWhatsAppStore.ts YES/NO
- SqliteWhatsAppStore.test.ts YES/NO

Diagnostic workflow merged into permanent branch: NO
```

Production mutation remains NO.