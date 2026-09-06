# TUX Monorepo Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete Phase A by history-importing TUX-MENU into `apps/menu`, integrating it with the existing npm workspace/root lock/CI/deployment model, quarantining legacy SQL, and proving Menu plus Operations behavior without catalog/Admin/Supabase/Meta/WhatsApp product changes.

**Architecture:** `TUXCASHEIRNEW` remains canonical. Rewrite only a disposable TUX-MENU clone with `git filter-repo --to-subdirectory-filter apps/menu`, merge that full history into `work/monorepo-foundation`, then integrate `@tux/menu` using existing npm workspaces and one root lock. Temporary `/admin` remains in Menu during Phase A; canonical catalog/API and standalone `apps/admin` remain mandatory later phases.

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

- Task 1: source/target authority and baselines.
- Task 2: full-history filtered import and provenance.
- Task 3: legacy SQL quarantine and single migration authority.
- Task 4: `@tux/menu`, root lock, deterministic root install.
- Task 5: existing root quality policy and environment ownership.
- Task 6: exact Menu rendered-route/asset/deep-entry tests.
- Task 7: exact positive/negative architecture guard fixtures and current-tree implementation.
- Task 8: permanent Menu/architecture CI, exact-head dispatch, independent deployment.
- Task 9: full Operations/Menu/Windows/migration/WhatsApp verification.
- No Phase B catalog work, no `apps/admin`, no Menu canonical-backend cutover, and no old-repository retirement are implemented by this plan.
