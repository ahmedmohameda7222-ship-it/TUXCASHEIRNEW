# TUX Operations WhatsApp Live-Branch Pre-Test Checkpoint Amendment

Date: 2026-09-04
Status: Binding execution durability amendment
Permanent implementation branch: `feat/operations-whatsapp-inbox`
Live WIP branch: `work/operations-whatsapp-inbox-live`

## Purpose

The live-branch model still allowed a meaningful implementation batch to remain local-only while focused tests were running. Task 8D demonstrated this gap: the RED checkpoint was durable on GitHub, but the subsequent server implementation reached 58/58 focused server tests locally without first being published to the live branch.

This amendment closes that gap. It changes checkpoint timing only. Product scope, architecture, TDD requirements, security boundaries, migration rules, and permanent GREEN branch semantics are unchanged.

## Authority

Where this amendment conflicts with earlier wording about when WIP/live checkpoints may be published, this amendment wins.

## Absolute durability rule

After any production/source/test file edit batch that materially changes behavior or test expectations, the exact current tree must be published to `work/operations-whatsapp-inbox-live` BEFORE running any test command against that tree.

No meaningful implementation batch may be tested while existing only in an ephemeral local runtime.

## Exact cadence for every remaining substep

1. Edit a small source/test batch locally.
2. Commit the exact batch as RED/WIP on the local live-work history.
3. Publish that commit/tree immediately to `work/operations-whatsapp-inbox-live`.
4. Verify live remote HEAD/tree.
5. Only then run the intended focused test command.
6. If the test fails as intended, continue with the next small implementation batch.
7. Before running the next test command, publish the new batch to the live branch again.
8. Repeat until GREEN.
9. When focused GREEN passes, publish the exact tested GREEN tree to the live branch and verify it remotely.
10. Only then create the clean permanent GREEN commit on `feat/operations-whatsapp-inbox` from that exact tree.

In shorthand:

`EDIT → LIVE REMOTE CHECKPOINT → TEST → EDIT → LIVE REMOTE CHECKPOINT → TEST → ... → GREEN → LIVE REMOTE GREEN → PERMANENT GREEN`

Testing before the live remote checkpoint is prohibited for any meaningful edit batch.

## Time bound

No more than approximately 2 minutes of meaningful source/test editing may remain local-only. If a batch takes longer, split it into smaller checkpoints.

## Long-running commands

Before any command expected to take more than approximately 30 seconds, ensure the exact tree being tested is already the verified live-branch tree.

This includes focused suites, broad suites, typecheck, lint, build, migration tests, E2E, package tests, or code generation.

## WIP publication mechanics

The live branch is explicitly allowed to contain RED or failing checkpoints. Exact tested-tree publication is required for GREEN/permanent promotion; WIP durability may use the authorized GitHub Git-data route or safe contents updates on the live branch when faster, provided the resulting live tree is verified before the next test command.

Unsafe file-by-file mutation remains forbidden on the permanent branch.

## Task 8D current recovery state

At adoption:

- permanent GREEN HEAD: `ffa5e5992caee6cb5d5debebdf0a040b4ca116d0`
- permanent GREEN tree: `d453c658d3495f3120852abe5d36c8735aa759e2`
- live RED HEAD: `42d84b2a0e17924326d61f9ced4b052561af043d`
- live RED tree: `62ef5c91a9bc60ffd4b95b64528857f37cf4d42d`
- reported local server implementation tree: `6a20df270c065575be3de775ad5eace92b339b20`
- reported focused server result on that local tree: 58 tests passing

The local implementation tree is not authoritative until published and verified on the live branch. The first action on resume is to materialize/publish that exact tree (if still available), verify it remotely, and only then continue Task 8D application/browser/Desktop work.

## Runtime-boundary rule

If the runtime ends, recovery always prefers:

1. permanent GREEN branch for completed logical tasks;
2. live WIP branch for in-progress task state;
3. recovery bundle only as a secondary fallback.

No code that has already been verified as present on the live branch needs to be reconstructed from local state.

## Production mutation policy

Unchanged. No production Supabase, Meta, Vercel, deployment, or real-provider mutation is authorized by this amendment.
