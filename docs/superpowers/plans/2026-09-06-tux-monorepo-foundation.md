# TUX Monorepo Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete Phase A by history-importing TUX-MENU into `apps/menu`, integrating it with the existing npm workspace/root lock/CI/deployment model, quarantining legacy SQL, and proving Menu plus Operations behavior without catalog/Admin/Supabase/Meta/WhatsApp product changes.

**Architecture:** `TUXCASHEIRNEW` remains canonical. Rewrite only a disposable TUX-MENU clone with `git filter-repo --to-subdirectory-filter apps/menu`, merge that full history into `work/monorepo-foundation`, then integrate `@tux/menu` using the existing npm workspaces and one root lock. Temporary `/admin` remains in Menu during Phase A; canonical catalog/API and standalone `apps/admin` remain mandatory later phases.

**Tech Stack:** Git, npm workspaces, Node 24 CI, React 19, TypeScript, Vite, Playwright, ESLint, Prettier, GitHub Actions, Vercel.

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

### Task 1: Re-verify Authorities and Baselines

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

If newer than the approved checkpoint, inspect the exact new commits and diff. If legitimate and compatible, merge the advance into the isolated branch with:

```bash
git merge --no-ff origin/work/operations-whatsapp-inbox-live -m "chore(monorepo): refresh foundation base"
```

Do not rewrite either history.

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
285635181a9ee1ec2f760feb38abae8fa19a201d
e9ddcc696470d7bb116e1d888a77ade84f95bf83
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

- [ ] **Step 5: Run source Menu baseline**

```bash
git -C .tmp/tux-menu-source-check switch --detach "$SOURCE_HEAD"
(cd .tmp/tux-menu-source-check && npm ci && npm run typecheck && npm run build)
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

Expected: source typecheck/build and all representative routes GREEN.

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

- [ ] **Step 5: Record actual provenance and clean temporary source clone**

Create `docs/superpowers/provenance/2026-09-06-tux-menu-history-import.md` containing the actual source repository/branch, original HEAD/tree, rewritten import SHA, import merge SHA, canonical base, `git filter-repo` version, reachable commit count, and the successful blob/tree inventory proof.

```bash
git add docs/superpowers/provenance/2026-09-06-tux-menu-history-import.md
git commit -m "docs(monorepo): record TUX-MENU import provenance"
git remote remove tux-menu-import
rm -rf .tmp/tux-menu-filtered .tmp/tux-menu-source-check .tmp/source-tree.txt .tmp/rewritten-tree.txt .tmp/import-tree.txt
```

Expected: clean tree and a distinct pristine import merge boundary.

---

### Task 3: Quarantine Legacy SQL

**Files:** Move `apps/menu/supabase_setup.sql` to `apps/menu/legacy/supabase_setup.sql.reference`; create `apps/menu/legacy/README.md`; do not touch `supabase/migrations/**`.

- [ ] **Step 1: Move SQL to non-executable reference**

```bash
mkdir -p apps/menu/legacy
git mv apps/menu/supabase_setup.sql apps/menu/legacy/supabase_setup.sql.reference
```

- [ ] **Step 2: Create quarantine README**

The README must state that the file is historical reference only, must never be run against canonical TUX Supabase or copied into `supabase/migrations/`, and that its `product_sections`/TEXT ID/`price NUMERIC`/legacy storage assumptions conflict with canonical shop-scoped UUID/`price_minor`/modifier/combo/inventory authority. Catalog reconciliation belongs to Phase B.

- [ ] **Step 3: Verify authority and commit**

```bash
git diff --exit-code -- supabase/migrations
test -z "$(git status --porcelain -- supabase/migrations)"
find apps packages -type d -path '*/supabase/migrations' -print
find . \( -path './.git' -o -path './.tmp' -o -path './node_modules' \) -prune -o -name supabase_setup.sql -print
git add -A apps/menu
git commit -m "docs(menu): quarantine legacy Supabase setup"
```

Expected: no canonical migration diff, no nested migration chain, no executable current-tree `supabase_setup.sql`.

---

### Task 4: Workspace Identity and One Root Lock

**Files:** Modify `apps/menu/package.json`, root `package.json`, root `package-lock.json`; delete `apps/menu/package-lock.json` only after root-install proof.

- [ ] **Step 1: RED workspace identity check**

```bash
node --input-type=module <<'NODE'
import fs from 'node:fs';
const menu = JSON.parse(fs.readFileSync('apps/menu/package.json', 'utf8'));
if (menu.name !== '@tux/menu') throw new Error(`expected @tux/menu, got ${menu.name}`);
NODE
```

Expected: FAIL.

- [ ] **Step 2: Rename package only and add root scripts**

Set Menu package name to `@tux/menu`; preserve source dependency versions. Add:

```json
"dev:menu": "npm run dev -w @tux/menu",
"build:menu": "npm run build -w @tux/menu",
"typecheck:menu": "npm run typecheck -w @tux/menu",
"test:e2e:menu": "playwright test --config playwright.menu.config.ts",
"test:monorepo-architecture": "node --test scripts/monorepo-architecture-guard.test.mjs && node scripts/test-monorepo-architecture.mjs"
```

Do not change existing Operations scripts.

- [ ] **Step 3: Generate root lock and prove it before deleting nested lock**

```bash
npm install --package-lock-only --ignore-scripts
npm ls -w @tux/menu --depth=0
rm -rf node_modules apps/*/node_modules packages/*/node_modules
npm ci
npm run typecheck:menu
npm run build:menu
```

Expected: GREEN.

- [ ] **Step 4: Delete nested lock, rerun clean proof, and commit**

```bash
git rm apps/menu/package-lock.json
rm -rf node_modules apps/*/node_modules packages/*/node_modules
npm ci
npm run typecheck:menu
npm run build:menu
find apps packages -name package-lock.json -print
git diff --exit-code "$(git merge-base HEAD origin/work/operations-whatsapp-inbox-live)" -- \
  apps/operations/package.json apps/operations-desktop/package.json packages/*/package.json
git add package.json package-lock.json apps/menu/package.json
git commit -m "build(monorepo): integrate menu workspace"
```

Expected: no nested lock and no existing package manifest change.

---

### Task 5: Existing Root Quality Rules and Environment Ownership

**Files:** Imported Menu source reported by root ESLint/Prettier; `apps/menu/.env.example`; `apps/menu/DEPLOYMENT.md`. Do not weaken root lint/format config.

- [ ] **Step 1: Capture RED imported-quality diagnostics**

```bash
npm run format:check || true
npx eslint 'apps/menu/**/*.{ts,tsx,mjs}' --max-warnings 0 || true
```

- [ ] **Step 2: Apply mechanical formatting/autofix only under Menu**

```bash
npx prettier --write 'apps/menu/**/*.{ts,tsx,css,html,json,md}'
npx eslint 'apps/menu/**/*.{ts,tsx,mjs}' --fix --max-warnings 0 || true
```

For known remaining type-rule issues use behavior-neutral `import type`, `Session | null`, and `catch (err: unknown)` forms. Extract unknown error messages with:

```ts
const message = err instanceof Error ? err.message : 'Unknown error';
```

If a residual diagnostic requires runtime semantic change, invoke `systematic-debugging` rather than weakening root rules.

- [ ] **Step 3: Make Menu env ownership truthful**

Replace `apps/menu/.env.example` with:

```dotenv
# TUX Menu — browser-visible legacy backend variables used during Phase A.
# Never place service-role or private server secrets here.
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=

# WhatsApp ordering remains configured in src/lib/constants.ts during Phase A.
```

Update `apps/menu/DEPLOYMENT.md` to state that dynamic legacy Supabase-backed Menu/Admin behavior uses these two browser variables, while fallback catalog rendering can work without them. Do not add `TUX_SUPABASE_*` server secrets.

- [ ] **Step 4: Verify and commit**

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

- [ ] **Step 1: Write RED browser tests**

Create tests covering direct entries for `/`, `/order-now`, `/tux-burger`, `/products/tux-burger`, and temporary `/admin`; assert expected visible route text, successful document response, no failed image responses, and positive `naturalWidth`/`naturalHeight` for imported images.

Run:

```bash
npm run test:e2e:menu
```

Expected: RED because the Menu Playwright config is absent.

- [ ] **Step 2: Create independent Menu Playwright config**

```ts
import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './e2e/menu',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  workers: 1,
  retries: process.env['CI'] ? 1 : 0,
  reporter: process.env['CI'] ? [['line'], ['html', { outputFolder: 'playwright-report-menu', open: 'never' }]] : 'line',
  use: { baseURL: 'http://127.0.0.1:4174', headless: true, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  webServer: {
    command: 'npm run build:menu && npm run preview -w @tux/menu -- --host 127.0.0.1 --port 4174',
    url: 'http://127.0.0.1:4174',
    timeout: 120_000,
    reuseExistingServer: !process.env['CI'],
  },
});
```

Add `playwright.menu.config.ts` to `tsconfig.e2e.json` include.

- [ ] **Step 3: GREEN rendered proof and commit**

```bash
npm run typecheck:e2e
npm run test:e2e:menu
git add e2e/menu/menu.e2e.ts playwright.menu.config.ts tsconfig.e2e.json
git commit -m "test(menu): add rendered route smoke coverage"
```

If direct route entry fails, invoke `systematic-debugging`; do not add a test-only redirect.

---

### Task 7: Permanent Architecture Guards With TDD Fixtures

**Files:** Create `scripts/monorepo-architecture-guard.mjs`, `scripts/monorepo-architecture-guard.test.mjs`, `scripts/test-monorepo-architecture.mjs`.

**Produces:** `collectArchitectureViolations(root)` and `assertMonorepoArchitecture(root)`.

- [ ] **Step 1: Write RED fixtures first**

Use `node:test` temporary directories. Required negative fixtures must independently prove detection of: relative cross-app imports, another app package-name import, nested `package-lock.json`, executable `supabase_setup.sql`, second `supabase/migrations`, wrong Menu package identity, and missing CI command coverage. Include one valid fixture expecting zero violations.

Run:

```bash
node --test scripts/monorepo-architecture-guard.test.mjs
```

Expected: RED because implementation is absent.

- [ ] **Step 2: Implement guard**

Use Node built-ins only. Ignore `.git`, `.tmp`, `node_modules`, `dist`, and `coverage`. Scan app source import specifiers using a pattern that catches `from`, dynamic imports, and side-effect imports. Resolve relative imports to `apps/<name>` and map app package names from each `apps/*/package.json`. Report cross-app imports when source and target apps differ.

Also report every nested `package-lock.json`; any current-tree `supabase_setup.sql`; any migration authority other than root `supabase/migrations`; missing `apps/*`; Menu package name not `@tux/menu`; missing root `build`, `typecheck`, `test:e2e:menu`, or `test:monorepo-architecture`; and missing CI strings:

```text
npm run typecheck:menu
npm run build:menu
npm run test:e2e:menu
npm run test:monorepo-architecture
```

Export:

```js
export async function collectArchitectureViolations(root) { /* sorted string[] */ }
export async function assertMonorepoArchitecture(root) {
  const violations = await collectArchitectureViolations(root);
  if (violations.length) throw new Error(`Monorepo architecture violations:\n${violations.join('\n')}`);
}
```

Create `scripts/test-monorepo-architecture.mjs` to resolve repo root, call `assertMonorepoArchitecture`, and print `Monorepo architecture guard passed.`.

- [ ] **Step 3: Run fixture tests GREEN and commit**

```bash
node --test scripts/monorepo-architecture-guard.test.mjs
git add scripts/monorepo-architecture-guard.mjs scripts/monorepo-architecture-guard.test.mjs scripts/test-monorepo-architecture.mjs package.json
git commit -m "test(monorepo): add architecture guards"
```

Current-tree guard may remain RED only for CI coverage until Task 8.

---

### Task 8: Permanent CI and Independent Menu Deployment

**Files:** Modify `.github/workflows/ci.yml`, `apps/menu/vercel.json`, `apps/menu/DEPLOYMENT.md`.

- [ ] **Step 1: Prove current-tree architecture RED on missing CI coverage**

```bash
npm run test:monorepo-architecture
```

- [ ] **Step 2: Add exact-head manual dispatch**

Under workflow `on:` add required string input `expected_sha`. Immediately after checkout in the existing `quality` job, when `github.event_name == 'workflow_dispatch'`, assert `git rev-parse HEAD` equals that input. Do not modify PR #54 or weaken existing triggers/gates.

- [ ] **Step 3: Add independent Menu job**

The `menu` job must run Ubuntu/Node 24, root `npm ci`, `npm run typecheck:menu`, `npm run build:menu`, install Playwright Chromium, run `npm run test:e2e:menu`, and upload `playwright-report-menu`/`test-results` evidence.

- [ ] **Step 4: Add independent architecture job and required gate dependencies**

The `monorepo-architecture` job runs `npm run test:monorepo-architecture`. Add both `menu` and `architecture` to `required-quality-gate.needs` and assert both results equal `success`, while retaining existing `quality`, `edge-security`, and `windows-package` requirements.

- [ ] **Step 5: Replace imported Menu Vercel config**

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

- [ ] **Step 6: Simulate deployment commands, document them, then GREEN all integration gates**

```bash
(cd apps/menu && cd ../.. && npm ci)
(cd apps/menu && cd ../.. && npm run build:menu)
test -f apps/menu/dist/index.html
npm run test:monorepo-architecture
npm run format:check
npm run lint
npm run typecheck
npm run build
npm run test:e2e:menu
```

If actual Vercel preview proves parent traversal unsupported, invoke `systematic-debugging` and select another root-lock-preserving configuration; never restore a nested Menu lock.

- [ ] **Step 7: Commit**

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

- [ ] **Step 3: Prove external authorities and provenance remain independent/traceable**

```bash
git fetch origin work/operations-whatsapp-inbox-live
TUX_MENU_MAIN="$(git ls-remote https://github.com/ahmedmohameda7222-ship-it/TUX-MENU.git refs/heads/main | awk '{print $1}')"
cat docs/superpowers/provenance/2026-09-06-tux-menu-history-import.md
git log --follow --oneline -- apps/menu/src/App.tsx | head -20
```

Report newer legitimate external advances; never reset them.

- [ ] **Step 4: Prove lock/migration/legacy-SQL invariants**

```bash
npm run test:monorepo-architecture
find . \( -path './.git' -o -path './.tmp' -o -path './node_modules' \) -prune -o -name package-lock.json -print
find . \( -path './.git' -o -path './.tmp' -o -path './node_modules' \) -prune -o -type d -path '*/supabase/migrations' -print
find . \( -path './.git' -o -path './.tmp' -o -path './node_modules' \) -prune -o -name supabase_setup.sql -print
```

Expected only root `package-lock.json`, root `supabase/migrations`, and no executable legacy SQL.

- [ ] **Step 5: Clean install and complete Linux gates**

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

- [ ] **Step 6: Prove no Phase A Operations/migration implementation change**

```bash
LIVE_BASE="$(git merge-base HEAD origin/work/operations-whatsapp-inbox-live)"
git diff --name-only "$LIVE_BASE"..HEAD -- supabase/migrations
git diff --name-only "$LIVE_BASE"..HEAD -- apps/operations apps/operations-desktop
```

Expected: no output, accounting for any explicitly accepted live-base advance from Task 1.

- [ ] **Step 7: Dispatch permanent CI on exact final SHA**

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

- [ ] **Step 8: Final report and stop**

Report branch, HEAD/tree/parent, accepted Operations/source SHAs and trees, rewritten import SHA, import merge SHA, clean root install, every Operations/Menu/architecture/Windows gate, exact CI run, confirmation `supabase/migrations` unchanged, no remote Supabase write, no Meta change, and that temporary `/admin` remains while standalone `apps/admin` is mandatory Phase C work.

Do not start Phase B. Stop for user review/acceptance of Phase A.

---

## Plan Self-Review Coverage

- Task 1: source/target authority and baselines.
- Task 2: full-history filtered import and provenance.
- Task 3: legacy SQL quarantine and single migration authority.
- Task 4: `@tux/menu`, root lock, deterministic root install.
- Task 5: existing root quality policy and environment ownership.
- Task 6: Menu rendered routes/assets/deep entries.
- Task 7: permanent tested architecture guards.
- Task 8: permanent Menu/architecture CI, exact-head dispatch, independent deployment.
- Task 9: full Operations/Menu/Windows/migration/WhatsApp verification.
- No Phase B catalog work, no `apps/admin`, no Menu canonical-backend cutover, and no old-repository retirement are implemented by this plan.
