# TUX Operations WhatsApp Tasks 8–10 Runtime-Window Recovery Amendment

Date: 2026-09-04
Status: Binding execution-cadence amendment
Implementation baseline: `0684c49f3988545ea68efdfa1d0a1ce4de9e0cdc`

## Purpose

The previous one-return execution cadence exceeded the executor runtime/tool window. This is an execution-window limitation, not a product, architecture, or code defect.

This amendment changes only checkpoint/resume behavior. Product scope, architecture, TDD, migrations, security, and acceptance requirements remain unchanged.

## Authority

Where this amendment conflicts with prior wording that requires a single uninterrupted tool window or forbids intermediate runtime-boundary returns, this amendment wins.

All completed logical commits must be published and remotely verified immediately after they pass their focused GREEN gates. The permanent implementation branch remains:

`feat/operations-whatsapp-inbox`

## Current recovery state

The executor reported two locally tested commits derived from the frozen baseline:

- `b74dc60dafc7ea9b7f5836206519b66e24f1dea5` — `feat: add atomic parked order drafts`
- `7e3a3ee5b293f83b12bae5feeab87b63caf93e8f` — `feat: protect parked orders through End Day`

These commits are not yet present on the permanent remote branch. The remote branch is still at baseline until recovery publication succeeds.

Local tested trees reported:

- Task 8A tree: `2f12309c8323e2f5efef45e7e90bbf9ae25da1cc`
- Task 8B tree: `c7a32ecbe8b5ee98f5ac897f3ef59996cee17aaa`

These tree SHAs are evidence identifiers only until the GitHub object database contains equivalent trees/commits.

## Mandatory first action on resume

Before Task 8C continues, salvage completed Task 8A and Task 8B.

If the previous local checkout still exists, verify exactly:

```bash
git rev-parse --abbrev-ref HEAD
git rev-parse HEAD
git status --short
git log --oneline -3
```

Expected local HEAD:

`7e3a3ee5b293f83b12bae5feeab87b63caf93e8f`

Expected parent:

`b74dc60dafc7ea9b7f5836206519b66e24f1dea5`

Expected grandparent:

`0684c49f3988545ea68efdfa1d0a1ce4de9e0cdc`

Working tree must be clean before publication.

If the previous local checkout no longer exists, do **not** stop merely because the runtime was recycled. Automatically recover from the previously verified offline executor bundle, restore the frozen baseline, reinstall/use the locked dependency bootstrap through the already-approved GitHub Actions fallback if required, and re-execute Task 8A then Task 8B with the same RED/GREEN gates before continuing. A recycled runtime is not a product-decision blocker and does not require planner approval.

## Atomic publication requirement

For every completed GREEN logical commit:

1. publish it to GitHub immediately;
2. fast-forward only;
3. verify the remote branch HEAD equals the published commit;
4. only then start the next logical task.

If shell `git push` is unavailable, use the authorized GitHub Git-data route. Publishing must preserve the tested tree exactly; do not perform ad-hoc file-by-file mutations that change the tested content.

For the current recovery, publish Task 8A first, verify remote HEAD, then Task 8B, verify remote HEAD. Only after remote HEAD is the Task 8B equivalent may Task 8C continue.

## Portable recovery artifact

After each remotely verified GREEN commit, also create a portable local recovery artifact before beginning the next task:

```bash
git bundle create /mnt/data/tux-whatsapp-progress.bundle HEAD ^0684c49f3988545ea68efdfa1d0a1ce4de9e0cdc
sha256sum /mnt/data/tux-whatsapp-progress.bundle
```

If the runtime supports user-visible file attachments, attach the latest bundle when a runtime/tool window ends unexpectedly. This is a secondary recovery mechanism; the remotely verified permanent branch remains primary.

## Runtime-window semantics

A tool/runtime window ending is not a planner review checkpoint and does not change scope.

When a runtime window ends:

- completed GREEN commits must already be remote;
- incomplete work may remain local but must not be published as permanent GREEN work;
- on the next continuation, resume from the latest remotely verified GREEN commit;
- rerun the relevant focused test before continuing the incomplete task;
- do not restart Tasks 8–10 from baseline unless the last remote GREEN checkpoint is baseline.

The user may send a simple continuation instruction. No new product approval is required merely because a tool window ended.

## Revised execution cadence

Continue in order:

`8A → 8B → 8C → 8D → 8E → 9A → 9B → 9C → 9D → 9E → 10A → 10B → 10C`

But after every completed logical GREEN commit:

`GREEN → focused gate → commit → remote publish → remote verify → recovery bundle → next task`

No planner review between tasks is required.

## Final verification

All final verification and evidence requirements from the approved finalization plan remain binding. Runtime-window checkpointing does not reduce any final gate.

## Production mutation policy

Unchanged: no production Supabase/Meta/Vercel deployment or mutation is authorized by this amendment.
