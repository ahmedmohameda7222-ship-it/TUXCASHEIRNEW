# TUX Monorepo Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete Phase A by history-importing TUX-MENU into `apps/menu`, integrating it with the existing npm workspace/root lock/CI/deployment model, quarantining legacy SQL, and proving Menu plus Operations behavior without catalog/Admin/Supabase/Meta/WhatsApp product changes.

**Architecture:** `TUXCASHEIRNEW` remains canonical. Rewrite only a disposable TUX-MENU clone with `git filter-repo --to-subdirectory-filter apps/menu`, merge that full history into `work/monorepo-foundation`, then integrate `@tux/menu` using existing npm workspaces and one root lock. Temporary `/admin` remains in Menu during Phase A; canonical catalog/API and standalone `apps/admin` remain mandatory later phases.

**Tech Stack:** Git, `git-filter-repo`, GitHub CLI/API, npm workspaces, Node 24 CI, React 19, TypeScript, Vite, Playwright, Chromium, ESLint, Prettier, GitHub Actions, Vercel.

**Spec:** `docs/superpowers/specs/2026-09-06-tux-monorepo-foundation-design.md`

## Global Constraints

- Work only on `work/monorepo-foundation`; never modify `work/operations-whatsapp-inbox-live`, `main`, or PR #54.
- Re-fetch both repositories before execution. Approved target checkpoint: `11e3e9a1c64b2725e956647d081891e59ffb75a8`, tree `530d8860e30c28505dad8091e573b1766e559665`. Approved source checkpoint: `285635181a9ee1ec2f760feb38abae8fa19a201d`, tree `e9ddcc696470d7bb116e1d888a77ade84f95bf83`.
- Preserve source history; no copy/paste or squash-only import.
- Never rewrite TUXCASHEIRNEW history.
- `supabase/migrations/` stays the sole migration authority; no canonical migration edit or remote Supabase write.
- No Meta change, Real Meta acceptance, Task 10A correction, React-key cleanup, WhatsApp redesign, dependency modernization, catalog cutover, new Menu/Admin feature, or `apps/admin` creation in Phase A.
- Keep npm workspaces; no Nx, Turborepo, pnpm, Yarn, or Bazel.
- Preserve Menu dependency versions unless workspace compatibility strictly requires otherwise.
- Strict TDD for new guards/config behavior. Invoke `systematic-debugging` for any unexpected baseline/import/install/CI failure before changing code.
- Invoke `verification-before-completion` before any Phase A GREEN/completion claim.
- **Task 0 is a hard pre-execution gate.** No Phase A implementation write may begin unless Task 0 returns exactly `EXECUTOR CAPABLE`.
- If any mandatory executor capability is unavailable and no approved equivalent is defined in advance, return exactly `EXECUTOR NOT CAPABLE`, stop implementation, and hand off to a full repository executor. Do not weaken the architecture or substitute a degraded implementation path.

## Current Continuation State

This plan amendment was made after Task 1 baseline review in a weaker Classic ChatGPT harness.

```text
Task 1:
COMPLETE WITH DEFERRED BYTE-IDENTICAL CHARACTERIZATION

Task 2:
NOT STARTED
BLOCKED BEFORE FIRST WRITE IN THE CLASSIC HARNESS

Task 3+:
NOT STARTED
```

Accepted Task 1 authority remains:

```text
Operations live:
work/operations-whatsapp-inbox-live
11e3e9a1c64b2725e956647d081891e59ffb75a8
tree 530d8860e30c28505dad8091e573b1766e559665

TUX-MENU source:
ahmedmohameda7222-ship-it/TUX-MENU
main
285635181a9ee1ec2f760feb38abae8fa19a201d
tree e9ddcc696470d7bb116e1d888a77ade84f95bf83
```

The Task 1 Menu `npm run typecheck` and browser-rendered characterization were not waived. They remain deferred only because the Classic harness could not execute them before import. Once Task 2 has established the pristine byte-identical imported snapshot, the full executor must run the deferred Menu typecheck/build/rendered route characterization against that still-pristine `apps/menu/**` state before Task 3 changes the imported subtree. Blob identity must be re-confirmed first if any characterization fails.

For this continuation, a full executor runs **Task 0 first**. If and only if Task 0 returns `EXECUTOR CAPABLE`, it proceeds directly to **Task 2**; it does not reopen Task 1 architecture/baseline decisions unless an authority SHA has genuinely advanced.

## Executor Classification and Handoff Rule

The Classic ChatGPT implementation harness used during planning is classified:

```text
EXECUTOR NOT CAPABLE
```

It may be used only for planning, review, GitHub evidence inspection, checkpoint auditing, and handoff preparation. It is not approved to execute Phase A implementation tasks.

The preferred implementation environment is Codex App / Codex CLI in a full repository workspace, or an equivalent executor that passes Task 0 completely. The full executor must provide, at minimum:

```text
full Git repository checkout
shell and writable temporary filesystem
GitHub network access
authenticated Git fetch/push credentials
git worktree and merge support
git filter-repo
Node satisfying >=20.19.0 <27
npm and deterministic npm ci
root lockfile generation
TypeScript / ESLint / Prettier / Vite execution
local HTTP server binding
Playwright + Chromium installation and launch
localhost browser access
GitHub Actions workflow-file push permission
GitHub Actions trigger/dispatch capability
CI run/job/log/artifact inspection
exact-SHA verification
Windows-package CI evidence inspection
```

No history import, rendered test, root-lock rule, CI gate, or other architecture requirement may be weakened to accommodate a weaker executor.

## Future Architectural Plan Capability-Preflight Rule

Every future architectural implementation plan must identify the following **before implementation begins**:

```text
required executor capabilities
external dependencies
network requirements
credentials requirements
platform-specific requirements
browser requirements
CI requirements
database/provider requirements
```

For every required capability the plan must either:

1. prove the selected executor supports it during a pre-execution capability gate; or
2. define an approved behaviorally/forensically equivalent execution path in advance.

If no equivalent exists, the plan must declare a pre-execution handoff requirement. A missing capability must never first appear as a surprise blocker in the middle of an implementation task.

## Planned Current-Tree Changes

```text
apps/menu/**
apps/menu/legacy/README.md
apps/menu/legacy/supabase_setup.sql.reference
docs/superpowers/provenance/2026-09-06-tux-menu-history-import.md
e2e/menu/menu.e2e.ts
playwright.menu.config.ts
scripts/monorepo-architecture-guard.mjs
scripts/monorepo-architecture-guard.test.mjs
scripts/test-monorepo-architecture.mjs
package.json
package-lock.json
tsconfig.e2e.json
.github/workflows/ci.yml
```

Do not create `packages/shared`, legacy catalog adapters, or `apps/admin`.

---

### Task 0 — Execution Environment Capability Gate

**Files:** Read-only repository inspection plus disposable `.tmp/**`, ignored build outputs, local `node_modules`, disposable worktrees, and temporary remote probe branches that are deleted before the gate finishes. No tracked Phase A implementation file may remain changed.

**Produces:** exactly one classification: `EXECUTOR CAPABLE` or `EXECUTOR NOT CAPABLE`.

**Rule:** Run this task before any Phase A implementation write. If any mandatory check fails, do not continue to Task 1/2/3+. Invoke `systematic-debugging` only to classify whether the failure is environmental or repository-specific; do not modify production/application code to make the gate pass.

#### A. Repository / Git capability

- [ ] **Step A1: Verify executable, checkout, branch, cleanliness, and writable temporary filesystem**

```bash
set -euo pipefail
REPO='ahmedmohameda7222-ship-it/TUXCASHEIRNEW'
FOUNDATION_BRANCH='work/monorepo-foundation'
LIVE_BRANCH='work/operations-whatsapp-inbox-live'
SOURCE_REPO='ahmedmohameda7222-ship-it/TUX-MENU'
SOURCE_URL='https://github.com/ahmedmohameda7222-ship-it/TUX-MENU.git'
EXPECTED_LIVE_HEAD='11e3e9a1c64b2725e956647d081891e59ffb75a8'
EXPECTED_LIVE_TREE='530d8860e30c28505dad8091e573b1766e559665'
EXPECTED_SOURCE_HEAD='285635181a9ee1ec2f760feb38abae8fa19a201d'
EXPECTED_SOURCE_TREE='e9ddcc696470d7bb116e1d888a77ade84f95bf83'

command -v git
git --version
ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
git fetch origin --prune
if git show-ref --verify --quiet "refs/heads/$FOUNDATION_BRANCH"; then
  git switch "$FOUNDATION_BRANCH"
else
  git switch --track -c "$FOUNDATION_BRANCH" "origin/$FOUNDATION_BRANCH"
fi
test "$(git branch --show-current)" = "$FOUNDATION_BRANCH"
test -z "$(git status --porcelain)"
mkdir -p .tmp
touch .tmp/executor-capability-write-probe
rm .tmp/executor-capability-write-probe
```

Expected: all commands succeed and the tracked worktree remains clean.

- [ ] **Step A2: Verify remote fetch/clone and full source checkout**

```bash
git fetch origin "$FOUNDATION_BRANCH" "$LIVE_BRANCH"
rm -rf .tmp/executor-capability-tux-menu
git clone --no-single-branch "$SOURCE_URL" .tmp/executor-capability-tux-menu
git -C .tmp/executor-capability-tux-menu switch --detach "$EXPECTED_SOURCE_HEAD"
git -C .tmp/executor-capability-tux-menu fsck --full
```

- [ ] **Step A3: Verify worktree operations**

```bash
rm -rf .tmp/executor-capability-worktree
git worktree add --detach .tmp/executor-capability-worktree HEAD
test "$(git -C .tmp/executor-capability-worktree rev-parse HEAD)" = "$(git rev-parse HEAD)"
git worktree remove --force .tmp/executor-capability-worktree
```

- [ ] **Step A4: Verify ordinary merge and unrelated-history merge support in disposable repositories**

```bash
rm -rf .tmp/executor-merge-a .tmp/executor-merge-b
GIT_AUTHOR_NAME='Executor Capability Probe' \
GIT_AUTHOR_EMAIL='executor-capability@example.invalid' \
GIT_COMMITTER_NAME='Executor Capability Probe' \
GIT_COMMITTER_EMAIL='executor-capability@example.invalid' \
  git init -q -b main .tmp/executor-merge-a
printf 'a\n' > .tmp/executor-merge-a/a.txt
git -C .tmp/executor-merge-a add a.txt
git -C .tmp/executor-merge-a -c user.name='Executor Capability Probe' -c user.email='executor-capability@example.invalid' commit -q -m a

GIT_AUTHOR_NAME='Executor Capability Probe' \
GIT_AUTHOR_EMAIL='executor-capability@example.invalid' \
GIT_COMMITTER_NAME='Executor Capability Probe' \
GIT_COMMITTER_EMAIL='executor-capability@example.invalid' \
  git init -q -b main .tmp/executor-merge-b
printf 'b\n' > .tmp/executor-merge-b/b.txt
git -C .tmp/executor-merge-b add b.txt
git -C .tmp/executor-merge-b -c user.name='Executor Capability Probe' -c user.email='executor-capability@example.invalid' commit -q -m b

git -C .tmp/executor-merge-a remote add other "$ROOT/.tmp/executor-merge-b"
git -C .tmp/executor-merge-a fetch -q other main
git -C .tmp/executor-merge-a -c user.name='Executor Capability Probe' -c user.email='executor-capability@example.invalid' \
  merge --allow-unrelated-histories --no-ff -m 'executor capability unrelated merge' other/main
test "$(git -C .tmp/executor-merge-a show --no-patch --pretty='%P' HEAD | wc -w | tr -d ' ')" = '2'
```

- [ ] **Step A5: Verify `git filter-repo` exists and is executable**

```bash
command -v git-filter-repo || git filter-repo --version
git filter-repo --version
```

Expected: GREEN. Absence of `git filter-repo` is a mandatory failure; do not synthesize history with low-level GitHub APIs.

#### B. Node / npm capability

- [ ] **Step B1: Verify Node engine and npm**

```bash
command -v node
command -v npm
node --version
npm --version
node --input-type=module <<'NODE'
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 20 || major >= 27 || (major === 20 && minor < 19)) {
  throw new Error(`Node ${process.versions.node} does not satisfy >=20.19.0 <27`);
}
NODE
```

- [ ] **Step B2: Prove locked root install and workspace command execution without changing the canonical lock**

```bash
LOCK_BEFORE="$(git hash-object package-lock.json)"
rm -rf node_modules apps/*/node_modules packages/*/node_modules
npm ci
test "$(git hash-object package-lock.json)" = "$LOCK_BEFORE"
npm run typecheck -w @tux/operations
```

- [ ] **Step B3: Prove safe lockfile generation in a disposable package**

```bash
rm -rf .tmp/executor-npm-lock-probe
mkdir -p .tmp/executor-npm-lock-probe
cat > .tmp/executor-npm-lock-probe/package.json <<'JSON'
{"name":"executor-capability-probe","version":"0.0.0","private":true}
JSON
(cd .tmp/executor-npm-lock-probe && npm install --package-lock-only --ignore-scripts)
test -f .tmp/executor-npm-lock-probe/package-lock.json
test "$(git hash-object package-lock.json)" = "$LOCK_BEFORE"
```

- [ ] **Step B4: Prove build output creation**

```bash
rm -rf apps/operations/dist
npm run build -w @tux/operations
test -f apps/operations/dist/index.html
```

#### C. Browser / rendered-testing capability

- [ ] **Step C1: Verify Playwright package and Chromium installation**

```bash
npx playwright --version
npx playwright install chromium
```

- [ ] **Step C2: Verify Chromium launch**

```bash
node --input-type=module <<'NODE'
import { chromium } from '@playwright/test';
const browser = await chromium.launch({ headless: true });
await browser.close();
NODE
```

- [ ] **Step C3: Verify Vite preview, localhost binding, and browser-to-localhost access**

```bash
rm -f .tmp/executor-vite.pid .tmp/executor-vite.log
(
  cd apps/operations
  npx vite preview --host 127.0.0.1 --port 4179 > ../../.tmp/executor-vite.log 2>&1 &
  echo $! > ../../.tmp/executor-vite.pid
)
node --input-type=module <<'NODE'
import { chromium } from '@playwright/test';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
let response;
for (let attempt = 0; attempt < 40; attempt += 1) {
  try {
    response = await page.goto('http://127.0.0.1:4179', { waitUntil: 'domcontentloaded', timeout: 2000 });
    if (response?.ok()) break;
  } catch {}
  await new Promise((resolve) => setTimeout(resolve, 250));
}
if (!response?.ok()) throw new Error('Chromium could not reach local Vite preview');
await browser.close();
NODE
kill "$(cat .tmp/executor-vite.pid)"
```

Expected: Chromium launches and reaches a locally bound Vite server.

#### D. CI / GitHub capability

- [ ] **Step D1: Verify authenticated GitHub CLI/API access**

```bash
command -v gh
gh --version
gh auth status
gh repo view "$REPO" --json nameWithOwner,defaultBranchRef
```

- [ ] **Step D2: Prove authenticated push and workflow-file push permission on a disposable branch only**

```bash
PROBE_BRANCH="executor-capability-probe-$(date +%s)-$$"
rm -rf .tmp/executor-push-probe
git worktree add -b "$PROBE_BRANCH" .tmp/executor-push-probe HEAD
printf '\n# executor capability probe; disposable branch only\n' >> .tmp/executor-push-probe/.github/workflows/ci.yml
git -C .tmp/executor-push-probe add .github/workflows/ci.yml
git -C .tmp/executor-push-probe \
  -c user.name='Executor Capability Probe' \
  -c user.email='executor-capability@example.invalid' \
  commit -q -m 'chore: executor capability probe'
git -C .tmp/executor-push-probe push --set-upstream origin "$PROBE_BRANCH"
git ls-remote --exit-code origin "refs/heads/$PROBE_BRANCH"
git push origin --delete "$PROBE_BRANCH"
git worktree remove --force .tmp/executor-push-probe
git branch -D "$PROBE_BRANCH"
```

Expected: temporary branch push succeeds, including a workflow-file change, then the remote/local probe branch is deleted. Never use `main`, Operations live, TUX-MENU, or PR #54 for this probe.

- [ ] **Step D3: Prove Actions run/job/log/artifact inspection and tested-SHA visibility**

```bash
RUN_ID="$(gh run list -R "$REPO" --workflow ci.yml --limit 1 --json databaseId --jq '.[0].databaseId')"
test -n "$RUN_ID"
gh run view "$RUN_ID" -R "$REPO" --json headSha,status,conclusion,jobs > .tmp/executor-actions-run.json
gh run view "$RUN_ID" -R "$REPO" --log > .tmp/executor-actions.log
gh api "repos/$REPO/actions/runs/$RUN_ID/artifacts" > .tmp/executor-actions-artifacts.json
node --input-type=module <<'NODE'
import fs from 'node:fs';
const run = JSON.parse(fs.readFileSync('.tmp/executor-actions-run.json', 'utf8'));
if (!run.headSha) throw new Error('Actions run did not expose headSha');
if (!Array.isArray(run.jobs)) throw new Error('Actions jobs unavailable');
NODE
```

- [ ] **Step D4: Prove Actions write/trigger permission without changing repository files**

The pre-Task8 workflow may not yet expose `workflow_dispatch`, so Task 0 proves the executor capability in two parts: Step D2 proves it can push the eventual workflow change, and this step proves it has Actions write/trigger permission by rerunning the repository's permanent non-production CI workflow.

```bash
SAFE_RUN_ID="$(gh run list -R "$REPO" --workflow ci.yml --status completed --limit 1 --json databaseId --jq '.[0].databaseId')"
test -n "$SAFE_RUN_ID"
gh api --method POST "repos/$REPO/actions/runs/$SAFE_RUN_ID/rerun"
```

Expected: request accepted. This may create a redundant CI run on its original SHA; it must not target a deployment/mutation workflow. Once Task 8 adds `workflow_dispatch`, the executor must immediately use the actual dispatch path there and Task 9 must dispatch the exact final SHA. Failure of the actual dispatch path later is handled with `systematic-debugging`, not by weakening exact-SHA verification.

#### E. Filesystem / repository-scale capability

- [ ] **Step E1: Verify available storage and full source history checkout**

```bash
df -Pk "$ROOT"
du -sh .tmp/executor-capability-tux-menu
git -C .tmp/executor-capability-tux-menu rev-list --count "$EXPECTED_SOURCE_HEAD"
git -C .tmp/executor-capability-tux-menu fsck --full
```

- [ ] **Step E2: Prove real history rewriting on a disposable full-history clone**

```bash
rm -rf .tmp/executor-filter-probe
git clone --local .tmp/executor-capability-tux-menu .tmp/executor-filter-probe
FILTER_BEFORE_COUNT="$(git -C .tmp/executor-filter-probe rev-list --count "$EXPECTED_SOURCE_HEAD")"
git -C .tmp/executor-filter-probe switch --detach "$EXPECTED_SOURCE_HEAD"
git -C .tmp/executor-filter-probe filter-repo --force --to-subdirectory-filter __executor_capability_probe
FILTER_AFTER_COUNT="$(git -C .tmp/executor-filter-probe rev-list --count HEAD)"
test "$FILTER_AFTER_COUNT" -gt 0
git -C .tmp/executor-filter-probe fsck --full
printf 'filter-before=%s filter-after=%s\n' "$FILTER_BEFORE_COUNT" "$FILTER_AFTER_COUNT"
```

Expected: rewrite succeeds on the real source-history scale. This probe is disposable; do not use its rewritten history for Task 2.

- [ ] **Step E3: Confirm build output remains writable and tracked tree clean**

```bash
test -f apps/operations/dist/index.html
test -z "$(git status --porcelain)"
```

#### F. External-authority capability

- [ ] **Step F1: Verify both remotes and exact authority objects are resolvable**

```bash
FOUNDATION_REMOTE="$(git ls-remote origin "refs/heads/$FOUNDATION_BRANCH" | awk '{print $1}')"
LIVE_REMOTE="$(git ls-remote origin "refs/heads/$LIVE_BRANCH" | awk '{print $1}')"
SOURCE_REMOTE="$(git ls-remote "$SOURCE_URL" refs/heads/main | awk '{print $1}')"
test -n "$FOUNDATION_REMOTE"
test "$LIVE_REMOTE" = "$EXPECTED_LIVE_HEAD"
test "$SOURCE_REMOTE" = "$EXPECTED_SOURCE_HEAD"
git fetch origin "$LIVE_BRANCH"
test "$(git rev-parse "origin/$LIVE_BRANCH^{tree}")" = "$EXPECTED_LIVE_TREE"
test "$(git -C .tmp/executor-capability-tux-menu rev-parse "$EXPECTED_SOURCE_HEAD^{tree}")" = "$EXPECTED_SOURCE_TREE"
```

If either authority legitimately advanced, do not classify the executor as incapable merely because the SHA changed. Stop the implementation gate, inspect/reconcile the authority change under the plan's authority rules, then rerun Task 0 against the newly approved SHA.

- [ ] **Step F2: Clean capability artifacts and prove no tracked change**

```bash
rm -rf \
  .tmp/executor-capability-tux-menu \
  .tmp/executor-filter-probe \
  .tmp/executor-merge-a \
  .tmp/executor-merge-b \
  .tmp/executor-npm-lock-probe
rm -f \
  .tmp/executor-actions-run.json \
  .tmp/executor-actions.log \
  .tmp/executor-actions-artifacts.json \
  .tmp/executor-vite.pid \
  .tmp/executor-vite.log
rm -rf node_modules apps/*/node_modules packages/*/node_modules apps/operations/dist
test -z "$(git status --porcelain)"
```

- [ ] **Step F3: Classify the executor**

If **every** mandatory check above succeeded, report exactly:

```text
EXECUTOR CAPABLE
```

If **any** mandatory capability failed, report exactly:

```text
EXECUTOR NOT CAPABLE
```

and stop implementation. The missing capability becomes a handoff condition. Do not proceed partially and do not ask for a degraded-import decision.

### Executor Capability Matrix — Tasks 2–9

| Task | Required capability | Current Classic harness | Full repository executor | Potential blocker | Resolution |
| --- | --- | --- | --- | --- | --- |
| Task 2 — history import/provenance | Full Git clone/fetch, complete source history, writable temp clones, `git filter-repo`, unrelated-history merge, tree/blob inventory diff, ancestry inspection, authenticated push; then pristine Menu typecheck/build/browser characterization | **Not capable.** Shell GitHub DNS/authenticated Git and `git filter-repo` are unavailable; low-level connector history synthesis is rejected. | Must pass Task 0 A/E/F plus B/C for deferred pristine characterization. | Lossy/synthetic history, missing blob proof, inability to run pristine checks. | Use a full repository executor; preserve exact source SHA/tree; perform approved filtered import only. |
| Task 3 — SQL quarantine | Local imported tree, Git move/commit, filesystem search, canonical migration diff | Connector file writes are technically possible, but Task 2 pristine state does not exist locally; executing here would break sequencing. | Standard local Git/filesystem after Task 2. | Quarantining before pristine characterization or touching canonical migrations. | Run only after Task 2 provenance and deferred pristine characterization are complete. |
| Task 4 — workspace/root lock | Root `npm ci`, workspace scripts, deterministic lock generation, package-lock editing, clean reinstall, Git diff/commit | **Not approved/capable end-to-end.** No full repository execution contract. | Must pass Task 0 B plus Git push. | Discovering npm/toolchain incompatibility after package edits; nested-lock fallback temptation. | Task 0 proves Node/npm/root install/lock generation first; one-root-lock rule remains mandatory. |
| Task 5 — quality alignment | Prettier, ESLint, TypeScript, Vite build, scoped edits/diffs, environment-doc inspection | Partial text editing is possible, but local lint/type/build verification is not a valid full-repo execution path. | Must pass Task 0 B. | Formatting/type fixes made without executable verification; semantic fixes disguised as lint cleanup. | Full executor only; `systematic-debugging` for any semantic/runtime diagnostic. |
| Task 6 — rendered browser coverage | Playwright package, Chromium installation/launch, Vite/local server, localhost browser access, route/assets assertions | **Not capable** of the required local rendered test loop. HTTP-only fetch is explicitly insufficient. | Must pass Task 0 C. | Discovering missing browser libs, inability to bind localhost, replacing rendered tests with HTTP-only checks. | Task 0 launches Chromium and reaches local Vite before implementation. |
| Task 7 — architecture guards | Node execution, `node:test`, writable temp fixtures, filesystem traversal, current-tree CLI | Partial Node capability is insufficient without the canonical full checkout and verified workspace. | Must pass Task 0 A/B. | Fixture/temp-filesystem restrictions or inability to execute current-tree guard. | Full executor; strict RED/GREEN TDD remains unchanged. |
| Task 8 — CI/deployment integration | Authenticated workflow-file push, GitHub Actions read/write, run/job/log/artifact inspection, exact SHA visibility, local npm/build/Playwright, Vercel root-lock simulation | GitHub connector can inspect/change some GitHub objects, but it is not an approved substitute for authenticated Git + local verification + Actions control. | Must pass Task 0 B/C/D; Vercel preview is conditional if local simulation exposes a platform discrepancy. | Workflow token lacks workflow-file permission; Actions cannot be triggered/inspected; deployment config only works with nested lock. | Task 0 probes workflow-file push and Actions trigger/read; never restore nested lock. |
| Task 9 — complete final verification | Clean full checkout, full npm gates, Operations/Menu E2E, architecture/migration guards, external authority fetch, exact-head CI dispatch, jobs/logs/artifacts, Windows-package evidence | **Not capable** end-to-end. | Must pass all Task 0 groups A–F. | Final SHA cannot be proven, Windows job evidence unavailable, missing browser/toolchain, authority network unavailable. | Full executor only; `verification-before-completion` before any GREEN claim. |

---

### Task 1: Re-verify Authorities and Capture Baselines

**Files:** Read only; no repository change.

**Produces:** accepted target/source SHAs and pre-import Operations/Menu evidence.

- [ ] **Step 1: Prove isolated clean branch**

```bash
git fetch origin --prune
git switch work/monorepo-foundation
test "$(git branch --show-current)" = work/monorepo-foundation
test -z "$(git status --porcelain)"
```

- [ ] **Step 2: Re-verify Operations authority**

```bash
git fetch origin work/operations-whatsapp-inbox-live
LIVE_HEAD="$(git rev-parse origin/work/operations-whatsapp-inbox-live)"
LIVE_TREE="$(git rev-parse "${LIVE_HEAD}^{tree}")"
printf 'LIVE_HEAD=%s\nLIVE_TREE=%s\n' "$LIVE_HEAD" "$LIVE_TREE"
```

If newer than the approved checkpoint, inspect exactly:

```bash
git log --oneline 11e3e9a1c64b2725e956647d081891e59ffb75a8..origin/work/operations-whatsapp-inbox-live
git diff --stat 11e3e9a1c64b2725e956647d081891e59ffb75a8..origin/work/operations-whatsapp-inbox-live
```

If legitimate and design-compatible, merge the advance without rewriting history:

```bash
git merge --no-ff origin/work/operations-whatsapp-inbox-live -m "chore(monorepo): refresh foundation base"
```

- [ ] **Step 3: Re-verify TUX-MENU source**

```bash
rm -rf .tmp/tux-menu-source-check
mkdir -p .tmp
git clone https://github.com/ahmedmohameda7222-ship-it/TUX-MENU.git .tmp/tux-menu-source-check
SOURCE_HEAD="$(git -C .tmp/tux-menu-source-check rev-parse origin/main)"
SOURCE_TREE="$(git -C .tmp/tux-menu-source-check rev-parse "${SOURCE_HEAD}^{tree}")"
printf 'SOURCE_HEAD=%s\nSOURCE_TREE=%s\n' "$SOURCE_HEAD" "$SOURCE_TREE"
```

Expected unless explicitly reconciled:

```text
SOURCE_HEAD=285635181a9ee1ec2f760feb38abae8fa19a201d
SOURCE_TREE=e9ddcc696470d7bb116e1d888a77ade84f95bf83
```

A legitimate source advance requires inspecting its commits/diff and explicit import-SHA reconciliation before proceeding.

- [ ] **Step 4: Run target baseline**

```bash
npm ci
npm run format:check
npm run lint
npm run test
npm run test:whatsapp-architecture
npm run test:whatsapp-security
npm run typecheck
npm run build
npm run test:migrations
npm run test:e2e
```

Expected: GREEN. Any pre-import failure triggers `systematic-debugging`.

- [ ] **Step 5: Run source Menu install/type/build baseline**

```bash
git -C .tmp/tux-menu-source-check switch --detach "$SOURCE_HEAD"
(cd .tmp/tux-menu-source-check && npm ci)
(cd .tmp/tux-menu-source-check && npm run typecheck)
(cd .tmp/tux-menu-source-check && npm run build)
```

Expected: GREEN.

- [ ] **Step 6: Characterize source Menu rendered routes**

```bash
npx playwright install chromium
(cd .tmp/tux-menu-source-check && npm run preview -- --host 127.0.0.1 --port 4174 > ../../.tmp/menu-preview.log 2>&1 & echo $! > ../../.tmp/menu-preview.pid)
node --input-type=module <<'NODE'
import { chromium } from '@playwright/test';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
for (const [route, text] of [['/', null], ['/order-now', /Order\s*Now/i], ['/tux-burger', /Tux Burger/i], ['/admin', /Admin Login/i]]) {
  const response = await page.goto(`http://127.0.0.1:4174${route}`, { waitUntil: 'networkidle' });
  if (!response?.ok()) throw new Error(`${route}: HTTP failure`);
  if (text && !text.test(await page.locator('body').innerText())) throw new Error(`${route}: rendered text missing`);
}
await browser.close();
NODE
kill "$(cat .tmp/menu-preview.pid)"
```

Expected: all representative routes GREEN.

---

### Task 2: History-Preserving Import and Provenance

**Files:** Create through history `apps/menu/**`; create `docs/superpowers/provenance/2026-09-06-tux-menu-history-import.md`.

**Produces:** pristine unrelated-history import merge plus exact source/rewrite/import proof.

- [ ] **Step 1: Create full disposable clone and source inventory**

```bash
rm -rf .tmp/tux-menu-filtered
git clone https://github.com/ahmedmohameda7222-ship-it/TUX-MENU.git .tmp/tux-menu-filtered
git -C .tmp/tux-menu-filtered switch --detach "$SOURCE_HEAD"
git -C .tmp/tux-menu-filtered ls-tree -r "$SOURCE_HEAD" | sort > .tmp/source-tree.txt
```

- [ ] **Step 2: Rewrite only disposable history**

```bash
git filter-repo --version
git -C .tmp/tux-menu-filtered filter-repo --force --to-subdirectory-filter apps/menu
REWRITTEN_IMPORT_SHA="$(git -C .tmp/tux-menu-filtered rev-parse HEAD)"
git -C .tmp/tux-menu-filtered ls-tree -r "$REWRITTEN_IMPORT_SHA" apps/menu \
  | sed 's#\tapps/menu/#\t#' | sort > .tmp/rewritten-tree.txt
diff -u .tmp/source-tree.txt .tmp/rewritten-tree.txt
```

Expected: empty diff. If `git filter-repo` is unavailable, only a non-squashed history-preserving subtree-style fallback is acceptable; otherwise stop for approval.

- [ ] **Step 3: Merge unrelated history intentionally**

```bash
BASE_BEFORE_IMPORT="$(git rev-parse HEAD)"
git remote add tux-menu-import "$(pwd)/.tmp/tux-menu-filtered"
git fetch tux-menu-import
REWRITTEN_IMPORT_SHA="$(git rev-parse FETCH_HEAD)"
git merge --allow-unrelated-histories --no-ff "$REWRITTEN_IMPORT_SHA" \
  -m "chore(monorepo): import TUX-MENU history under apps/menu"
IMPORT_MERGE_SHA="$(git rev-parse HEAD)"
```

- [ ] **Step 4: Prove pristine merge snapshot and ancestry**

```bash
git ls-tree -r "$IMPORT_MERGE_SHA" apps/menu | sed 's#\tapps/menu/#\t#' | sort > .tmp/import-tree.txt
diff -u .tmp/source-tree.txt .tmp/import-tree.txt
git show --no-patch --pretty='%P' "$IMPORT_MERGE_SHA"
git log --follow --oneline -- apps/menu/src/App.tsx | head -20
```

Expected: snapshot diff empty, merge has two parents, source history is visible.

- [ ] **Step 5: Write exact provenance record**

```bash
mkdir -p docs/superpowers/provenance
FILTER_REPO_VERSION="$(git filter-repo --version 2>&1 | head -1)"
SOURCE_COMMIT_COUNT="$(git -C .tmp/tux-menu-filtered rev-list --count "$REWRITTEN_IMPORT_SHA")"
cat > docs/superpowers/provenance/2026-09-06-tux-menu-history-import.md <<EOF2
# TUX-MENU History Import Provenance

- Source repository: \`ahmedmohameda7222-ship-it/TUX-MENU\`
- Source branch: \`main\`
- Original source HEAD: \`$SOURCE_HEAD\`
- Original source tree: \`$SOURCE_TREE\`
- Original reachable commit count: \`$SOURCE_COMMIT_COUNT\`
- Canonical base before import: \`$BASE_BEFORE_IMPORT\`
- Rewrite method: \`git filter-repo --to-subdirectory-filter apps/menu\`
- Rewrite tool version: \`$FILTER_REPO_VERSION\`
- Rewritten import tip: \`$REWRITTEN_IMPORT_SHA\`
- Import merge commit: \`$IMPORT_MERGE_SHA\`

The pristine import merge was verified by comparing original \`git ls-tree -r\` mode/type/blob/path inventory with \`apps/menu/**\` after stripping the prefix. The inventories matched exactly. Neither source repository history was rewritten.
EOF2
git add docs/superpowers/provenance/2026-09-06-tux-menu-history-import.md
git commit -m "docs(monorepo): record TUX-MENU import provenance"
```

- [ ] **Step 6: Remove disposable source clone/remotes**

```bash
git remote remove tux-menu-import
rm -rf .tmp/tux-menu-filtered .tmp/tux-menu-source-check .tmp/source-tree.txt .tmp/rewritten-tree.txt .tmp/import-tree.txt
test -z "$(git status --porcelain)"
```

**Deferred Task 1 characterization boundary:** after Step 4 has proven the pristine imported snapshot, and before Task 3 mutates `apps/menu/**`, run the deferred Menu typecheck, production build, and browser-rendered characterization for `/`, `/order-now`, `/tux-burger`, and `/admin` against the still-pristine imported source. If any check fails, first re-prove source/import blob identity, invoke `systematic-debugging`, classify pre-existing source/toolchain vs import/environment failure, and stop before Task 3 if unresolved. Do not fix imported application code inside Task 2 merely to make characterization GREEN.

---

### Task 3: Quarantine Legacy SQL

**Files:** Move `apps/menu/supabase_setup.sql` to `apps/menu/legacy/supabase_setup.sql.reference`; create `apps/menu/legacy/README.md`; do not touch `supabase/migrations/**`.

- [ ] **Step 1: Move SQL to non-executable reference**

```bash
mkdir -p apps/menu/legacy
git mv apps/menu/supabase_setup.sql apps/menu/legacy/supabase_setup.sql.reference
```

- [ ] **Step 2: Create quarantine README**

Write this content to `apps/menu/legacy/README.md`:

```markdown
# Legacy TUX-MENU Database Reference

`supabase_setup.sql.reference` is historical reference material imported from TUX-MENU. It is not a migration or executable database authority for TUXCASHEIRNEW.

Do not run it against the canonical TUX Supabase project and do not copy it into `supabase/migrations/`.

The historical model uses `product_sections`, text identifiers, `price NUMERIC`, and legacy `product-images` assumptions. Canonical TUX is shop-scoped and uses `menu_categories`, UUID identifiers, `price_minor BIGINT`, modifiers, combo options, inventory/configuration contracts, and root `supabase/migrations/`.

Catalog reconciliation belongs to Phase B.
```

- [ ] **Step 3: Verify database authority**

```bash
git diff --exit-code -- supabase/migrations
test -z "$(git status --porcelain -- supabase/migrations)"
find apps packages -type d -path '*/supabase/migrations' -print
find . \( -path './.git' -o -path './.tmp' -o -path './node_modules' \) -prune -o -name supabase_setup.sql -print
```

Expected: no canonical migration diff, no nested migration chain, no executable current-tree `supabase_setup.sql`.

- [ ] **Step 4: Commit quarantine**

```bash
git add -A apps/menu
git commit -m "docs(menu): quarantine legacy Supabase setup"
```

---

### Task 4: Workspace Identity and One Root Lock

**Files:** Modify `apps/menu/package.json`, root `package.json`, root `package-lock.json`; delete `apps/menu/package-lock.json` only after root-install proof.

- [ ] **Step 1: Write RED workspace identity check**

```bash
node --input-type=module <<'NODE'
import fs from 'node:fs';
const menu = JSON.parse(fs.readFileSync('apps/menu/package.json', 'utf8'));
if (menu.name !== '@tux/menu') throw new Error(`expected @tux/menu, got ${menu.name}`);
NODE
```

Expected: FAIL.

- [ ] **Step 2: Rename package identity**

Change only Menu package name to `@tux/menu`; preserve source dependency versions and scripts.

- [ ] **Step 3: Add root Menu/architecture scripts**

```json
"dev:menu": "npm run dev -w @tux/menu",
"build:menu": "npm run build -w @tux/menu",
"typecheck:menu": "npm run typecheck -w @tux/menu",
"test:e2e:menu": "playwright test --config playwright.menu.config.ts",
"test:monorepo-architecture": "node --test scripts/monorepo-architecture-guard.test.mjs && node scripts/test-monorepo-architecture.mjs"
```

Do not change existing Operations scripts.

- [ ] **Step 4: Prove package identity GREEN and generate root lock**

```bash
node --input-type=module <<'NODE'
import fs from 'node:fs';
const menu = JSON.parse(fs.readFileSync('apps/menu/package.json', 'utf8'));
if (menu.name !== '@tux/menu') throw new Error('workspace identity missing');
NODE
npm install --package-lock-only --ignore-scripts
npm ls -w @tux/menu --depth=0
```

- [ ] **Step 5: Prove root lock before nested-lock deletion**

```bash
rm -rf node_modules apps/*/node_modules packages/*/node_modules
npm ci
npm run typecheck:menu
npm run build:menu
```

Expected: GREEN.

- [ ] **Step 6: Delete nested lock and prove root-only reproducibility**

```bash
git rm apps/menu/package-lock.json
rm -rf node_modules apps/*/node_modules packages/*/node_modules
npm ci
npm run typecheck:menu
npm run build:menu
find apps packages -name package-lock.json -print
```

Expected: no nested lock output.

- [ ] **Step 7: Prove existing package manifests unchanged and commit**

```bash
git diff --exit-code "$(git merge-base HEAD origin/work/operations-whatsapp-inbox-live)" -- \
  apps/operations/package.json apps/operations-desktop/package.json packages/*/package.json
git add package.json package-lock.json apps/menu/package.json
git commit -m "build(monorepo): integrate menu workspace"
```

---

### Task 5: Existing Root Quality Rules and Environment Ownership

**Files:** Imported Menu source reported by root ESLint/Prettier; `apps/menu/.env.example`; `apps/menu/DEPLOYMENT.md`. Do not weaken root lint/format config.

- [ ] **Step 1: Capture RED imported-quality diagnostics**

```bash
npm run format:check || true
npx eslint 'apps/menu/**/*.{ts,tsx,mjs}' --max-warnings 0 || true
```

- [ ] **Step 2: Apply mechanical formatting only under Menu**

```bash
npx prettier --write 'apps/menu/**/*.{ts,tsx,css,html,json,md}'
```

- [ ] **Step 3: Apply ESLint safe autofixes only under Menu**

```bash
npx eslint 'apps/menu/**/*.{ts,tsx,mjs}' --fix --max-warnings 0 || true
```

- [ ] **Step 4: Resolve known remaining type-only diagnostics behavior-neutrally**

Use `import type` for imported types, `Session | null` for the Admin session state, and `catch (err: unknown)` instead of explicit `any`. Extract an unknown error message with:

```ts
const message = err instanceof Error ? err.message : 'Unknown error';
```

If a residual diagnostic requires runtime semantic change, invoke `systematic-debugging` rather than weakening root rules.

- [ ] **Step 5: Replace Menu env example**

```dotenv
# TUX Menu — browser-visible legacy backend variables used during Phase A.
# Never place service-role or private server secrets here.
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=

# WhatsApp ordering remains configured in src/lib/constants.ts during Phase A.
```

- [ ] **Step 6: Correct Menu deployment documentation**

State that dynamic legacy Supabase-backed Menu/Admin behavior uses the two `VITE_*` browser variables, fallback catalog rendering can work without them, and no `TUX_SUPABASE_*` server secret belongs in Menu.

- [ ] **Step 7: Verify and commit**

```bash
npm run format:check
npm run lint
npm run typecheck:menu
npm run build:menu
git diff --name-only -- supabase/migrations apps/operations apps/operations-desktop
git add apps/menu
git commit -m "chore(menu): align imported source with monorepo quality"
```

Expected: GREEN and no canonical migration/Operations change.

---

### Task 6: Independent Rendered Menu Coverage

**Files:** Create `e2e/menu/menu.e2e.ts`, `playwright.menu.config.ts`; modify `tsconfig.e2e.json`.

- [ ] **Step 1: Write exact RED browser tests**

Create `e2e/menu/menu.e2e.ts`:

```ts
import { expect, test } from '@playwright/test';

const routes = [
  { path: '/', text: /TUX/i },
  { path: '/order-now', text: /Order\s*Now/i },
  { path: '/tux-burger', text: /Tux Burger/i },
  { path: '/admin', text: /Admin Login/i },
] as const;

for (const route of routes) {
  test(`direct entry renders ${route.path}`, async ({ page }) => {
    const failedImages: string[] = [];
    page.on('response', (response) => {
      if (response.request().resourceType() === 'image' && response.status() >= 400) {
        failedImages.push(`${response.status()} ${response.url()}`);
      }
    });
    const response = await page.goto(route.path, { waitUntil: 'networkidle' });
    expect(response?.ok()).toBe(true);
    await expect(page.locator('body')).toContainText(route.text);
    expect(failedImages).toEqual([]);
  });
}

test('home images have real dimensions', async ({ page }) => {
  await page.goto('/', { waitUntil: 'networkidle' });
  const images = await page.locator('img').evaluateAll((nodes) =>
    nodes.map((node) => ({
      src: (node as HTMLImageElement).currentSrc,
      width: (node as HTMLImageElement).naturalWidth,
      height: (node as HTMLImageElement).naturalHeight,
    })),
  );
  expect(images.length).toBeGreaterThan(0);
  expect(images.filter((image) => image.src).every((image) => image.width > 0 && image.height > 0)).toBe(true);
});

test('product deep route survives direct entry', async ({ page }) => {
  await page.goto('/products/tux-burger', { waitUntil: 'networkidle' });
  await expect(page).toHaveURL(/\/products\/tux-burger$/);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
});
```

- [ ] **Step 2: Run tests RED before config exists**

```bash
npm run test:e2e:menu
```

Expected: FAIL because `playwright.menu.config.ts` is absent.

- [ ] **Step 3: Create independent Menu Playwright config**

Create `playwright.menu.config.ts`:

```ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e/menu',
  testMatch: /.*\.e2e\.ts/,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env['CI'] ? 1 : 0,
  reporter: process.env['CI']
    ? [['line'], ['html', { outputFolder: 'playwright-report-menu', open: 'never' }]]
    : 'line',
  use: {
    baseURL: 'http://127.0.0.1:4174',
    headless: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'npm run build:menu && npm run preview -w @tux/menu -- --host 127.0.0.1 --port 4174',
    url: 'http://127.0.0.1:4174',
    timeout: 120_000,
    reuseExistingServer: !process.env['CI'],
  },
});
```

- [ ] **Step 4: Include Menu config in E2E typecheck**

Change `tsconfig.e2e.json` include to:

```json
["playwright.config.ts", "playwright.menu.config.ts", "e2e/**/*.ts"]
```

- [ ] **Step 5: Run rendered tests GREEN**

```bash
npm run typecheck:e2e
npm run test:e2e:menu
```

Expected: GREEN. If direct route entry fails, invoke `systematic-debugging`; do not add a test-only redirect.

- [ ] **Step 6: Commit Menu rendered coverage**

```bash
git add e2e/menu/menu.e2e.ts playwright.menu.config.ts tsconfig.e2e.json
git commit -m "test(menu): add rendered route smoke coverage"
```

---

### Task 7: Permanent Architecture Guards With TDD Fixtures

**Files:** Create `scripts/monorepo-architecture-guard.mjs`, `scripts/monorepo-architecture-guard.test.mjs`, `scripts/test-monorepo-architecture.mjs`.

**Produces:** `collectArchitectureViolations(root): Promise<string[]>` and `assertMonorepoArchitecture(root): Promise<void>`.

- [ ] **Step 1: Write exact RED fixture test file**

Create `scripts/monorepo-architecture-guard.test.mjs`:

```js
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { collectArchitectureViolations } from './monorepo-architecture-guard.mjs';

async function fixture(files) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'tux-monorepo-guard-'));
  for (const [relative, content] of Object.entries(files)) {
    const filename = path.join(root, relative);
    await mkdir(path.dirname(filename), { recursive: true });
    await writeFile(filename, content);
  }
  return root;
}

const validRoot = {
  'package.json': JSON.stringify({
    workspaces: ['apps/*', 'packages/*'],
    scripts: {
      build: 'npm run build --workspaces --if-present',
      typecheck: 'npm run typecheck --workspaces --if-present',
      'test:e2e:menu': 'playwright test --config playwright.menu.config.ts',
      'test:monorepo-architecture': 'node scripts/test-monorepo-architecture.mjs',
    },
  }),
  'package-lock.json': '{}',
  'apps/menu/package.json': JSON.stringify({ name: '@tux/menu' }),
  'apps/operations/package.json': JSON.stringify({ name: '@tux/operations' }),
  'apps/menu/src/a.ts': "import '@tux/domain';\n",
  'supabase/migrations/001.sql': '-- canonical',
  '.github/workflows/ci.yml': [
    'npm run typecheck:menu',
    'npm run build:menu',
    'npm run test:e2e:menu',
    'npm run test:monorepo-architecture',
  ].join('\n'),
};

test('accepts canonical current-tree structure', async () => {
  const root = await fixture(validRoot);
  try {
    assert.deepEqual(await collectArchitectureViolations(root), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('rejects relative and package-name cross-app imports', async () => {
  const root = await fixture({
    ...validRoot,
    'apps/menu/src/a.ts': "import '../../operations/src/main';\nimport '@tux/operations';\n",
  });
  try {
    const violations = await collectArchitectureViolations(root);
    assert.equal(violations.filter((value) => value.includes('cross-app import')).length >= 2, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('rejects nested lock, legacy SQL, and second migration authority', async () => {
  const root = await fixture({
    ...validRoot,
    'apps/menu/package-lock.json': '{}',
    'apps/menu/supabase_setup.sql': '-- legacy',
    'apps/menu/supabase/migrations/001.sql': '-- second',
  });
  try {
    const violations = await collectArchitectureViolations(root);
    assert.equal(violations.some((value) => value.includes('nested package-lock')), true);
    assert.equal(violations.some((value) => value.includes('legacy executable SQL')), true);
    assert.equal(violations.some((value) => value.includes('second Supabase migration authority')), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('rejects wrong Menu identity and missing permanent CI coverage', async () => {
  const root = await fixture({
    ...validRoot,
    'apps/menu/package.json': JSON.stringify({ name: 'tux-burger-website' }),
    '.github/workflows/ci.yml': 'npm run build\n',
  });
  try {
    const violations = await collectArchitectureViolations(root);
    assert.equal(violations.some((value) => value.includes('@tux/menu')), true);
    assert.equal(violations.some((value) => value.includes('CI coverage')), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run fixtures RED**

```bash
node --test scripts/monorepo-architecture-guard.test.mjs
```

Expected: FAIL because implementation is absent.

- [ ] **Step 3: Create exact guard implementation**

Create `scripts/monorepo-architecture-guard.mjs`:

```js
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const ignoredDirectories = new Set(['.git', '.tmp', 'node_modules', 'dist', 'coverage']);
const sourceExtension = /\.(?:ts|tsx|js|jsx|mjs|cjs)$/;
const importPattern = /(?:from\s+|import\s*\(\s*|import\s+)['"]([^'"]+)['"]/g;

async function walk(root) {
  const result = [];
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(absolute);
      else if (entry.isFile()) result.push(absolute);
    }
  }
  await visit(root);
  return result;
}

function appNameFromPath(root, filename) {
  const parts = path.relative(root, filename).split(path.sep);
  return parts[0] === 'apps' && parts.length > 2 ? parts[1] : null;
}

export async function collectArchitectureViolations(root) {
  const files = await walk(root);
  const violations = [];
  const appPackageNames = new Map();

  for (const filename of files.filter((value) => path.basename(value) === 'package.json')) {
    const appName = appNameFromPath(root, filename);
    if (!appName) continue;
    const pkg = JSON.parse(await readFile(filename, 'utf8'));
    if (typeof pkg.name === 'string') appPackageNames.set(pkg.name, appName);
  }

  for (const filename of files.filter((value) => sourceExtension.test(value))) {
    const sourceApp = appNameFromPath(root, filename);
    if (!sourceApp) continue;
    const source = await readFile(filename, 'utf8');
    for (const match of source.matchAll(importPattern)) {
      const specifier = match[1];
      const packageTarget = appPackageNames.get(specifier);
      if (packageTarget && packageTarget !== sourceApp) {
        violations.push(`cross-app import: ${path.relative(root, filename)} -> ${specifier}`);
        continue;
      }
      if (!specifier.startsWith('.')) continue;
      const targetApp = appNameFromPath(root, path.resolve(path.dirname(filename), specifier));
      if (targetApp && targetApp !== sourceApp) {
        violations.push(`cross-app import: ${path.relative(root, filename)} -> ${specifier}`);
      }
    }
  }

  for (const filename of files) {
    const relative = path.relative(root, filename).split(path.sep).join('/');
    if (relative !== 'package-lock.json' && relative.endsWith('/package-lock.json')) {
      violations.push(`nested package-lock: ${relative}`);
    }
    if (path.basename(filename) === 'supabase_setup.sql') {
      violations.push(`legacy executable SQL: ${relative}`);
    }
  }

  const migrationAuthorities = new Set();
  for (const filename of files) {
    const relative = path.relative(root, filename).split(path.sep).join('/');
    const match = relative.match(/^(.*?supabase\/migrations)(?:\/|$)/);
    if (match) migrationAuthorities.add(match[1]);
  }
  for (const authority of migrationAuthorities) {
    if (authority !== 'supabase/migrations') {
      violations.push(`second Supabase migration authority: ${authority}`);
    }
  }

  const rootPackage = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  const menuPackage = JSON.parse(await readFile(path.join(root, 'apps/menu/package.json'), 'utf8'));
  if (!rootPackage.workspaces?.includes('apps/*')) violations.push('root workspaces must include apps/*');
  if (menuPackage.name !== '@tux/menu') violations.push('Menu workspace must be named @tux/menu');
  for (const script of ['build', 'typecheck', 'test:e2e:menu', 'test:monorepo-architecture']) {
    if (!rootPackage.scripts?.[script]) violations.push(`root script missing: ${script}`);
  }

  const ci = await readFile(path.join(root, '.github/workflows/ci.yml'), 'utf8');
  for (const command of [
    'npm run typecheck:menu',
    'npm run build:menu',
    'npm run test:e2e:menu',
    'npm run test:monorepo-architecture',
  ]) {
    if (!ci.includes(command)) violations.push(`CI coverage missing: ${command}`);
  }

  return violations.sort();
}

export async function assertMonorepoArchitecture(root) {
  const violations = await collectArchitectureViolations(root);
  if (violations.length > 0) {
    throw new Error(`Monorepo architecture violations:\n${violations.join('\n')}`);
  }
}
```

- [ ] **Step 4: Create exact current-tree CLI**

Create `scripts/test-monorepo-architecture.mjs`:

```js
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertMonorepoArchitecture } from './monorepo-architecture-guard.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
await assertMonorepoArchitecture(root);
console.log('Monorepo architecture guard passed.');
```

- [ ] **Step 5: Run fixtures GREEN**

```bash
node --test scripts/monorepo-architecture-guard.test.mjs
```

Expected: GREEN. Current-tree CLI may remain RED only for missing CI coverage until Task 8.

- [ ] **Step 6: Commit guards**

```bash
git add scripts/monorepo-architecture-guard.mjs scripts/monorepo-architecture-guard.test.mjs scripts/test-monorepo-architecture.mjs package.json
git commit -m "test(monorepo): add architecture guards"
```

---

### Task 8: Permanent CI and Independent Menu Deployment

**Files:** Modify `.github/workflows/ci.yml`, `apps/menu/vercel.json`, `apps/menu/DEPLOYMENT.md`.

- [ ] **Step 1: Prove current-tree architecture RED on missing CI coverage**

```bash
npm run test:monorepo-architecture
```

Expected: only explicit CI-coverage violations.

- [ ] **Step 2: Add exact-head manual dispatch**

Under workflow `on:` add:

```yaml
workflow_dispatch:
  inputs:
    expected_sha:
      description: Exact commit SHA expected after checkout
      required: true
      type: string
```

Immediately after checkout in the existing `quality` job add:

```yaml
- name: Prove dispatched exact HEAD
  if: github.event_name == 'workflow_dispatch'
  run: test "$(git rev-parse HEAD)" = "${{ inputs.expected_sha }}"
```

- [ ] **Step 3: Add independent Menu job**

```yaml
menu:
  name: menu
  runs-on: ubuntu-latest
  timeout-minutes: 25
  env:
    ELECTRON_SKIP_BINARY_DOWNLOAD: '1'
  steps:
    - uses: actions/checkout@v7
    - uses: actions/setup-node@v7
      with:
        node-version: '24'
        cache: npm
    - name: Install locked root dependencies
      run: npm ci
    - name: Menu typecheck
      run: npm run typecheck:menu
    - name: Menu production build
      run: npm run build:menu
    - name: Install Playwright Chromium
      run: npx playwright install --with-deps chromium
    - name: Rendered Menu E2E
      run: npm run test:e2e:menu
    - name: Upload Menu rendered QA evidence
      if: always()
      uses: actions/upload-artifact@v4
      with:
        name: menu-rendered-e2e
        path: |
          playwright-report-menu
          test-results
        if-no-files-found: warn
        retention-days: 14
```

- [ ] **Step 4: Add independent architecture job**

```yaml
architecture:
  name: monorepo-architecture
  runs-on: ubuntu-latest
  timeout-minutes: 10
  steps:
    - uses: actions/checkout@v7
    - uses: actions/setup-node@v7
      with:
        node-version: '24'
    - name: Monorepo architecture guards
      run: npm run test:monorepo-architecture
```

- [ ] **Step 5: Extend required-quality gate**

Add `menu` and `architecture` to `needs`. Add `MENU_RESULT` and `ARCHITECTURE_RESULT` environment values from those jobs, then assert:

```bash
test "$MENU_RESULT" = "success"
test "$ARCHITECTURE_RESULT" = "success"
```

Retain existing `quality`, `edge-security`, and `windows-package` requirements.

- [ ] **Step 6: Replace imported Menu Vercel config**

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "framework": "vite",
  "installCommand": "cd ../.. && npm ci",
  "buildCommand": "cd ../.. && npm run build:menu",
  "outputDirectory": "dist",
  "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }]
}
```

Intended Menu Vercel Root Directory: `apps/menu`. The root Operations Vercel project remains separate and authoritative for Operations/API/crons.

- [ ] **Step 7: Simulate deployment commands**

```bash
(cd apps/menu && cd ../.. && npm ci)
(cd apps/menu && cd ../.. && npm run build:menu)
test -f apps/menu/dist/index.html
```

If actual Vercel preview proves parent traversal unsupported, invoke `systematic-debugging` and select another root-lock-preserving configuration; never restore a nested Menu lock.

- [ ] **Step 8: Document Menu deployment contract**

Document repository, Root Directory `apps/menu`, root-lock install, `build:menu`, `dist`, SPA rewrite, and Menu-only `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY`; explicitly state Operations remains a separate project.

- [ ] **Step 9: Run integration GREEN**

```bash
npm run test:monorepo-architecture
npm run format:check
npm run lint
npm run typecheck
npm run build
npm run test:e2e:menu
```

Expected: GREEN.

- [ ] **Step 10: Commit CI/deployment integration**

```bash
git add .github/workflows/ci.yml apps/menu/vercel.json apps/menu/DEPLOYMENT.md
git commit -m "ci(monorepo): require menu and architecture gates"
```

---

### Task 9: Final Exact-Head Phase A Verification

**Files:** Read/verify only; no planned production change.

- [ ] **Step 1: Invoke `verification-before-completion`**

No GREEN/completion wording before following that skill.

- [ ] **Step 2: Record exact identity and clean state**

```bash
FINAL_HEAD="$(git rev-parse HEAD)"
FINAL_TREE="$(git rev-parse HEAD^{tree})"
FINAL_PARENT="$(git rev-parse HEAD^)"
printf 'HEAD=%s\nTREE=%s\nPARENT=%s\n' "$FINAL_HEAD" "$FINAL_TREE" "$FINAL_PARENT"
test -z "$(git status --porcelain)"
```

- [ ] **Step 3: Prove external authorities remain independent**

```bash
git fetch origin work/operations-whatsapp-inbox-live
printf 'LIVE=%s\n' "$(git rev-parse origin/work/operations-whatsapp-inbox-live)"
TUX_MENU_MAIN="$(git ls-remote https://github.com/ahmedmohameda7222-ship-it/TUX-MENU.git refs/heads/main | awk '{print $1}')"
printf 'TUX_MENU_MAIN=%s\n' "$TUX_MENU_MAIN"
```

Report newer legitimate external advances; never reset them.

- [ ] **Step 4: Prove provenance traceability**

```bash
cat docs/superpowers/provenance/2026-09-06-tux-menu-history-import.md
git log --follow --oneline -- apps/menu/src/App.tsx | head -20
```

- [ ] **Step 5: Prove lock/migration/legacy-SQL invariants**

```bash
npm run test:monorepo-architecture
find . \( -path './.git' -o -path './.tmp' -o -path './node_modules' \) -prune -o -name package-lock.json -print
find . \( -path './.git' -o -path './.tmp' -o -path './node_modules' \) -prune -o -type d -path '*/supabase/migrations' -print
find . \( -path './.git' -o -path './.tmp' -o -path './node_modules' \) -prune -o -name supabase_setup.sql -print
```

Expected only root `package-lock.json`, root `supabase/migrations`, and no executable legacy SQL.

- [ ] **Step 6: Clean install and complete Linux gates**

```bash
rm -rf node_modules apps/*/node_modules packages/*/node_modules
npm ci
npm run format:check
npm run lint
npm run test
npm run test:whatsapp-architecture
npm run test:whatsapp-security
npm run typecheck
npm run build
npm run test:migrations
npm run test:monorepo-architecture
npm run test:e2e
npm run test:e2e:menu
```

Expected: all GREEN.

- [ ] **Step 7: Prove no Phase A Operations/migration implementation change**

```bash
LIVE_BASE="$(git merge-base HEAD origin/work/operations-whatsapp-inbox-live)"
git diff --name-only "$LIVE_BASE"..HEAD -- supabase/migrations
git diff --name-only "$LIVE_BASE"..HEAD -- apps/operations apps/operations-desktop
```

Expected: no output, accounting for any explicitly accepted live-base advance from Task 1.

- [ ] **Step 8: Dispatch permanent CI on exact final SHA**

Run `.github/workflows/ci.yml` on `work/monorepo-foundation` with `expected_sha=$FINAL_HEAD`. Required conclusions:

```text
quality = success
edge-security = success
windows-package = success
menu = success
monorepo-architecture = success
Required quality gate = success
```

Windows packaging must check out the same `FINAL_HEAD`.

- [ ] **Step 9: Final clean-tree check**

```bash
test -z "$(git status --porcelain)"
git log --oneline --decorate "$(git merge-base HEAD origin/work/operations-whatsapp-inbox-live)"..HEAD
```

- [ ] **Step 10: Final report and stop**

Report branch, HEAD/tree/parent, accepted Operations/source SHAs and trees, rewritten import SHA, import merge SHA, clean root install, every Operations/Menu/architecture/Windows gate, exact CI run, confirmation `supabase/migrations` unchanged, no remote Supabase write, no Meta change, and that temporary `/admin` remains while standalone `apps/admin` is mandatory Phase C work.

Do not start Phase B. Stop for user review/acceptance of Phase A.

---

## Plan Self-Review Coverage

- Task 0: complete executor-capability preflight, explicit `EXECUTOR CAPABLE` / `EXECUTOR NOT CAPABLE` classification, Tasks 2–9 capability matrix, and pre-execution handoff rule.
- Task 1: source/target authority and baselines; current continuation classification records accepted deferred byte-identical characterization.
- Task 2: full-history filtered import and provenance, plus mandatory deferred pristine Menu characterization before Task 3.
- Task 3: legacy SQL quarantine and single migration authority.
- Task 4: `@tux/menu`, root lock, deterministic root install.
- Task 5: existing root quality policy and environment ownership.
- Task 6: exact Menu rendered-route/asset/deep-entry tests.
- Task 7: exact positive/negative architecture guard fixtures and current-tree implementation.
- Task 8: permanent Menu/architecture CI, exact-head dispatch, independent deployment.
- Task 9: full Operations/Menu/Windows/migration/WhatsApp verification.
- Future architectural plans must declare executor/network/credential/platform/browser/CI/database/provider requirements before implementation and gate or pre-approve an equivalent path.
- No Phase B catalog work, no `apps/admin`, no Menu canonical-backend cutover, and no old-repository retirement are implemented by this plan.
