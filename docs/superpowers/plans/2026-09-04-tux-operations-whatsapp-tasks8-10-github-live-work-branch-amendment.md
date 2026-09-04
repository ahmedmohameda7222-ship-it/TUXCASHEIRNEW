# TUX Operations WhatsApp Tasks 8–10 GitHub Live-Work Branch Amendment

Date: 2026-09-04
Status: Binding execution-recovery amendment
Permanent implementation branch: `feat/operations-whatsapp-inbox`
Live recovery branch: `work/operations-whatsapp-inbox-live`
Current permanent GREEN head at adoption: `ffa5e5992caee6cb5d5debebdf0a040b4ca116d0`
Current permanent GREEN tree at adoption: `d453c658d3495f3120852abe5d36c8735aa759e2`

## Purpose

The previous local-first execution model still allowed meaningful work to exist only inside an ephemeral runtime until a task reached GREEN and was published. The user explicitly requires GitHub to remain the durable source of truth while implementation is in progress.

This amendment changes execution persistence only. Product scope, architecture, TDD requirements, security requirements, migration rules, and final acceptance requirements remain unchanged.

## Authority

Where this amendment conflicts with earlier recovery wording that permits meaningful implementation work to remain local-only until GREEN, this amendment wins.

The permanent branch remains GREEN-only:

`feat/operations-whatsapp-inbox`

The live recovery branch is now the durable work-in-progress branch:

`work/operations-whatsapp-inbox-live`

## Core rule

No meaningful implementation state may exist only in an ephemeral local runtime.

The local checkout is a disposable execution workspace used for editing, tests, builds, and Git object creation. GitHub is the durable checkpoint authority.

## Required dual-branch model

### Permanent branch

`feat/operations-whatsapp-inbox`

Contains only completed logical GREEN checkpoints that have passed their focused gates.

Do not push RED or partially implemented work to the permanent branch.

### Live work branch

`work/operations-whatsapp-inbox-live`

Contains active RED/WIP/diagnostic/recovery commits while a logical task is in progress.

It is explicitly allowed to contain failing tests and incomplete code because it is a recovery branch, not a release-quality branch.

## Mandatory remote checkpoint cadence

For every remaining logical task beginning with Task 8D:

1. Start from the current verified permanent GREEN head.
2. Ensure the live work branch is aligned to that permanent head before new task work begins.
3. Establish the intended RED test locally.
4. Commit the RED checkpoint.
5. Publish that RED checkpoint immediately to `work/operations-whatsapp-inbox-live` and verify the remote branch head/tree.
6. During implementation, publish a WIP checkpoint after every meaningful file batch and before any long-running command or risky refactor. No more than approximately 5 minutes of meaningful code changes should remain uncheckpointed locally.
7. Before running broad GREEN/full gates, publish the latest WIP checkpoint to the live work branch.
8. Once the task is GREEN and focused gates pass, commit the exact tested GREEN tree locally.
9. Publish that GREEN tree to the live work branch first and verify it remotely.
10. Create one clean permanent logical commit from that exact GREEN tree with the current permanent branch head as parent.
11. Fast-forward `feat/operations-whatsapp-inbox` only to that clean GREEN commit.
12. Verify permanent parent, tree, and branch head from GitHub.
13. Realign/reset the live work branch to the new permanent GREEN head before starting the next task. Force-updating the live recovery branch is allowed; force-updating the permanent branch is forbidden.

## If shell GitHub access is unavailable

Network isolation in the local shell is not a blocker.

Use the authorized GitHub connector/Git-data route for all live and permanent branch publication:

- create blobs/trees/commits as needed;
- update `work/operations-whatsapp-inbox-live` for RED/WIP/GREEN recovery checkpoints;
- update `feat/operations-whatsapp-inbox` only for clean GREEN checkpoints;
- verify every remote head/tree after publication.

Do not substitute unsafe file-by-file permanent contents mutations for exact tested-tree publication.

## Recovery semantics

If the runtime ends at any point:

- resume from `work/operations-whatsapp-inbox-live` when it is ahead of the permanent branch;
- the live branch is the primary recovery source for in-progress work;
- the permanent branch remains the primary authority for last completed GREEN work;
- git bundle attachments are secondary disaster-recovery artifacts only, not the primary checkpoint channel;
- do not rerun a completed RED/WIP step that is already verified on the live branch unless a fresh verification is required by TDD;
- do not restart prior GREEN tasks.

## Checkpoint labels

Use clear commit messages on the live branch, for example:

- `wip(task8d): red messaging policy authority`
- `wip(task8d): implement template eligibility`
- `wip(task8d): green messaging policy authority`

Permanent GREEN commit messages remain clean logical feature commits and must not use `wip:`.

## Task 8C adoption state

At the time this amendment was adopted, Task 8C was already completed and remotely verified on the permanent branch:

- permanent head: `ffa5e5992caee6cb5d5debebdf0a040b4ca116d0`
- permanent tree: `d453c658d3495f3120852abe5d36c8735aa759e2`
- parent: `21246155100b7200986cfb5f57cfd24e2caffc5c`

The uploaded recovery bundle was independently verified to have SHA-256:

`ad888e59f83266c5718c8a27bd7acbb49e1f7a7cf886ad9e343dff902c5b99e4`

and to expose bundle HEAD:

`0bb4426fc3202bf115f9bcb393ff72ca12eac179`

The live work branch was created from the verified permanent Task 8C head before Task 8D begins.

## Revised remaining execution

Continue:

`8D → 8E → 9A → 9B → 9C → 9D → 9E → 10A → 10B → 10C`

For each task:

`RED → remote live checkpoint → WIP remote checkpoints → GREEN → remote live GREEN → clean permanent GREEN → verify permanent → realign live branch → next task`

No planner review is required between these tasks.

## Production mutation policy

Unchanged. No production Supabase, Meta, Vercel, deployment, or real-provider mutation is authorized by this amendment.
