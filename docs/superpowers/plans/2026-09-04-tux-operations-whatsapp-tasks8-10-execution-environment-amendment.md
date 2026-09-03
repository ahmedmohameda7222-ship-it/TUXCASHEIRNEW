# TUX Operations WhatsApp Tasks 8–10 Execution Environment Amendment

Date: 2026-09-04  
Status: Binding execution-environment amendment  
Implementation baseline: `0684c49f3988545ea68efdfa1d0a1ce4de9e0cdc`

## Authority

This amendment changes **only the executor/environment requirements** for the approved Tasks 8–10 implementation. Product scope, architecture, task order, TDD requirements, migrations, security boundaries, and acceptance requirements remain unchanged.

Where this amendment conflicts with wording that says the implementer must be Classic ChatGPT, this amendment wins.

The implementation authority order is now:

1. `docs/superpowers/specs/2026-09-04-whatsapp-orders-media-production-closeout-design.md`
2. `docs/superpowers/plans/2026-09-04-tux-operations-whatsapp-tasks8-10-production-closeout-finalization.md`
3. `docs/superpowers/plans/2026-09-04-tux-operations-whatsapp-tasks8-10-production-closeout-self-review-corrections.md`
4. **this execution-environment amendment**
5. `docs/superpowers/plans/2026-09-04-tux-operations-whatsapp-tasks8-10-production-closeout.md`

This amendment does not authorize production mutations.

## Root cause of the previous STOP

The previous implementation runtime could read GitHub remote state but had no local checkout of `TUXCASHEIRNEW`, and its shell could not clone/fetch the repository.

Therefore it could not truthfully execute or verify:

```bash
git status --short
npm test
npm run typecheck
npm run lint
npm run build
npm run test:migrations
npm run test:e2e
npm run package:win -- --publish never
```

Remote GitHub branch state is not a substitute for a local working tree. GitHub API writes alone also cannot satisfy strict RED/GREEN TDD and fresh local verification.

This is an execution-environment mismatch, not a Task 8–10 product/design/code blocker.

## Required executor environment

Tasks 8–10 must execute in a **checkout-capable development environment with a real shell**, for example Codex or an equivalent local development environment.

Before production-code editing, the executor must be able to run all of the following against an actual repository checkout:

```bash
git rev-parse HEAD
git status --short
git diff --check
node --version
npm --version
```

It must also be able to modify files locally, run the repository test/build toolchain, create commits, and push the implementation branch.

A runtime that only exposes GitHub API/file mutations but has no repository checkout is **not an approved executor** for this plan.

## Frozen baseline gate

The first local checkout used for implementation must satisfy exactly:

```text
branch: feat/operations-whatsapp-inbox
HEAD:   0684c49f3988545ea68efdfa1d0a1ce4de9e0cdc
```

Required commands:

```bash
git rev-parse --abbrev-ref HEAD
git rev-parse HEAD
git status --short
```

Required results:

```text
feat/operations-whatsapp-inbox
0684c49f3988545ea68efdfa1d0a1ce4de9e0cdc
<no output from git status --short>
```

If the branch/HEAD/clean-tree gate is not satisfied, STOP. Do not rebase, merge main, reset to another baseline, or silently reinterpret the plan.

## Execution skill mode

The executor must read/invoke:

1. `superpowers:using-superpowers`
2. `superpowers:executing-plans`

Do not use `subagent-driven-development` for this approved one-pass implementation.

If the checkout is created specifically for this work and the execution harness supports worktrees, follow the applicable `using-git-worktrees` guidance before implementation.

## One-pass cadence remains binding

Once the local baseline gate is satisfied, execute continuously:

`8A → 8B → 8C → 8D → 8E → 9A → 9B → 9C → 9D → 9E → 10A → 10B → 10C`

Do not return for planner review between Tasks 8, 9, and 10. Maintain separate logical commits and strict RED → GREEN verification internally.

Return once after Task 10C with the complete evidence packet required by the parent/finalization plan.

## GitHub API usage

GitHub API/connector reads may be used for independent remote inspection and final CI evidence. They are not a replacement for the local implementation checkout.

Production source changes must originate from the verified checkout and must be locally tested before push.

## Production mutation policy

Unchanged: this implementation pass does not authorize applying migrations, changing production Supabase Storage, configuring Meta, changing production Vercel environment variables, or deploying production.

Expected production mutations during repository implementation remain: **none**.
