# TUX Operations WhatsApp Task 6D + 6E Atomic Checkpoint Amendment

> **For this project:** Classic ChatGPT must use `superpowers:executing-plans` inline. NO subagents.

**Goal:** Correct the Task 6 checkpoint boundary so the platform contract, Electron-main IPC bridge, and defensive preload bridge land atomically in one compilable, security-preserving commit.

**Architecture:** No approved architecture changes. `TuxDesktopApi.whatsapp` remains mandatory. Electron main still owns `OperationsWhatsAppService`; preload still exposes only a defensive IPC facade and never tokens/secrets. The only correction is checkpoint composition: the former 6D and 6E are one atomic implementation/review unit because making `whatsapp` mandatory immediately makes the existing preload structurally incomplete.

**Tech Stack:** TypeScript 6, Vitest 4, Electron 43, existing platform contracts and preload hardening.

**Spec:** `docs/superpowers/specs/2026-09-03-whatsapp-runtime-transport-boundary-design.md`

## Authority

This amendment supersedes only the checkpoint/file-boundary and intermediate verification instructions for former Task 6D and Task 6E in:

- `docs/superpowers/plans/2026-09-03-tux-operations-whatsapp-runtime-transport-task5-1-task6.md`
- `docs/superpowers/plans/2026-09-03-tux-operations-whatsapp-runtime-transport-task5-1-task6-execution-corrections.md`

All security, method, IPC-channel, parser, no-secret, no-schema, no-production, and STOP-after-6G requirements remain binding.

## Independently verified contradiction

Permanent implementation branch is currently:

`feat/operations-whatsapp-inbox`

at:

`384fa615bbf0373c0f97a8eac66c6afecf528a90`

Task 6C is complete at that SHA.

Accepted 6D RED evidence:

1. Platform-contract compile RED:
   - run `33774295804`
   - job `100712020335`
   - exact failure: `apps/operations-desktop/src/preload/index.ts` TS2741 because `TuxDesktopApi.whatsapp` is mandatory but preload does not yet provide it.

2. IPC module RED:
   - run `33774539777`
   - job `100712834883`
   - exact failure: `ERR_MODULE_NOT_FOUND` for `./whatsappIpc`; zero tests executed.

These REDs are valid and accepted. Do not recreate narrower substitutes.

## Why the checkpoint must be atomic

The former plan created an impossible clean intermediate state:

- 6D makes `TuxDesktopApi.whatsapp` mandatory.
- Desktop typecheck includes `apps/operations-desktop/src/preload/index.ts`.
- 6E was the only checkpoint authorized to add the preload `whatsapp` implementation.

Therefore a 6D-only commit would either:

- fail desktop typecheck, or
- require a temporary unvalidated preload bridge.

Both are rejected.

Binding correction:

```text
former 6D + former 6E
=> one atomic checkpoint: 6D/E
```

There must be no deliberately uncompilable permanent commit and no temporary unsafe preload implementation.

---

# Atomic Checkpoint 6D/E — Platform Contract + Main IPC + Defensive Preload

## Files

### Modify

- `packages/platform-contracts/index.d.ts`
- `apps/operations-desktop/src/main/index.ts`
- `apps/operations-desktop/src/preload/index.ts`

### Create

- `apps/operations-desktop/src/main/whatsappIpc.ts`
- `apps/operations-desktop/src/main/whatsappIpc.test.ts`
- `apps/operations-desktop/src/preload/whatsappResult.ts`
- `apps/operations-desktop/src/preload/whatsappResult.test.ts`

### Explicitly do not modify

- `apps/operations-desktop/package.json`
- any SQLite migration
- any IndexedDB migration
- any Supabase migration

If a new dependency or schema change appears necessary, STOP.

## Binding public contract

Define:

```ts
export type TuxWhatsAppApi = Pick<
  OperationsWhatsAppService,
  | 'loadInbox'
  | 'loadConversation'
  | 'sendText'
  | 'markUnread'
  | 'archive'
  | 'setFollowUp'
  | 'linkOrder'
  | 'saveDraft'
  | 'getDraft'
>;
```

`TuxDesktopApi` gains:

```ts
readonly whatsapp: TuxWhatsAppApi;
```

`sendMedia` remains absent.

## Accepted REDs

Use the already-recorded 6D REDs as TDD evidence:

```text
contract RED -> TS2741 preload missing whatsapp
IPC RED      -> ./whatsappIpc module missing
```

Do not discard or replace them.

## Additional preload parser RED before implementation

Before creating:

`apps/operations-desktop/src/preload/whatsappResult.ts`

create:

`apps/operations-desktop/src/preload/whatsappResult.test.ts`

with the exact defensive-result cases from the parent plan, then run:

```bash
npm test -- apps/operations-desktop/src/preload/whatsappResult.test.ts
```

Expected RED:

```text
ERR_MODULE_NOT_FOUND for ./whatsappResult
```

If it does not fail for that intended reason, STOP.

## Main IPC implementation

Implement `WhatsAppIpcRuntime` exactly according to the parent plan.

All nine channels remain exactly:

```text
tux:whatsapp:load-inbox
tux:whatsapp:load-conversation
tux:whatsapp:send-text
tux:whatsapp:mark-unread
tux:whatsapp:archive
tux:whatsapp:set-follow-up
tux:whatsapp:link-order
tux:whatsapp:save-draft
tux:whatsapp:get-draft
```

Every handler must call trusted-sender verification before the application service.

Malformed payloads must fail before service invocation.

The IPC layer contains no Business Day authority, worker authority, tenant routing, provider routing, or Meta logic.

## Electron-main composition

Compose exactly the approved stack:

```text
OperationsWhatsAppService
+ SqliteWhatsAppStore using the existing Operations database path
+ DesktopWhatsAppRemote when configured
+ unavailable WhatsApp remote when not configured
+ WhatsAppIpcRuntime
```

WhatsApp unavailability or missing `TUX_OPERATIONS_API_ORIGIN` must not crash POS/Orders startup.

Do not create another SQLite file.

## Defensive preload implementation

Implement `whatsappResult.ts` before wiring `preload/index.ts` GREEN.

The parser must validate all untrusted main-process `Result` values described in the parent plan:

- inbox result
- conversation result
- send-message result
- void mutation results
- draft result

Reject malformed domain/result/error shapes.

Normalize error results to renderer-safe `{code, message}`; do not expose raw `cause`.

Then add all nine methods under:

```ts
window.tuxDesktop.whatsapp
```

Every method must go through `ipcRenderer.invoke(...)` and the appropriate defensive result parser.

Preload must never expose or transport:

```text
accessToken
refreshToken
SUPABASE_SERVICE_ROLE_KEY
TUX_SUPABASE_SERVICE_ROLE_KEY
TUX_WHATSAPP_ACCESS_TOKEN
TUX_WHATSAPP_APP_SECRET
TUX_WHATSAPP_WEBHOOK_VERIFY_TOKEN
providerPhoneNumberId
```

## Atomic GREEN gate

Only after platform contract + main IPC + defensive preload are all implemented run:

```bash
npm test -- \
  apps/operations-desktop/src/main/whatsappIpc.test.ts \
  apps/operations-desktop/src/preload/whatsappResult.test.ts \
  apps/operations-desktop/src/main/security.test.ts \
  apps/operations-desktop/src/preload/sessionResult.test.ts
```

Expected: PASS.

Then run:

```bash
npm run typecheck -w @tux/operations-desktop
```

Expected: PASS.

This is the first required full desktop typecheck GREEN after `TuxDesktopApi.whatsapp` becomes mandatory.

Also verify:

```bash
git diff --exit-code HEAD -- \
  apps/operations-desktop/package.json \
  packages/persistence/src/sqlite/migrations.ts \
  packages/persistence/src/browser/indexedDbMigrations.ts \
  supabase/migrations
```

Expected: no output.

## Atomic commit

Commit former 6D + 6E together only after all GREEN gates pass.

Allowed commit files:

```text
packages/platform-contracts/index.d.ts
apps/operations-desktop/src/main/whatsappIpc.ts
apps/operations-desktop/src/main/whatsappIpc.test.ts
apps/operations-desktop/src/main/index.ts
apps/operations-desktop/src/preload/whatsappResult.ts
apps/operations-desktop/src/preload/whatsappResult.test.ts
apps/operations-desktop/src/preload/index.ts
```

Suggested commit:

```bash
git commit -m "feat: bridge WhatsApp through Electron IPC"
```

Do not promote diagnostic RED workflows.

## Continuation after atomic 6D/E

After the atomic 6D/E commit is GREEN, continue under the existing corrected Task 6 plan with:

```text
6F browser runtime composition
6G final verification
```

No separate 6E commit exists after this amendment.

If another interface contradiction appears, STOP instead of guessing.

## Final report adjustment

The Task 6 report must list:

```text
Task 6D/E atomic bridge:
- accepted platform-contract TS2741 RED run/job
- accepted whatsappIpc module RED run/job
- whatsappResult module RED run/job
- all 9 IPC methods bridged YES/NO
- trusted sender tests PASS/FAIL
- malformed IPC payload tests PASS/FAIL
- defensive preload result tests PASS/FAIL
- all 9 preload methods bridged YES/NO
- desktop typecheck PASS/FAIL
- POS startup independent of WhatsApp config YES/NO
- commit SHA
```

Then continue with 6F and 6G reporting as previously specified.

## Production boundary

Still forbidden:

```text
Supabase production mutation
production whatsapp_channels change
Meta configuration
real Meta credential change
Vercel environment change
Vercel deployment
Windows release publication
```

No production mutation is authorized by this amendment.
