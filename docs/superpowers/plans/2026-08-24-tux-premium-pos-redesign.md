# TUX Premium POS Redesign Implementation Plan

> **For the implementation chat:** Use Superpowers `executing-plans` to execute this plan task-by-task. Do not re-plan the product or redesign it again. The approved design is already locked in `DESIGN.md` and the approved feature spec.

**Goal:** Replace the current warm beige/brown TUX Operations UI with the approved premium green, Apple-derived POS experience while preserving every existing business workflow, local-first invariant, accessibility contract, and deployment constraint.

**Architecture:** Keep business/domain/application state ownership where it is today. Refactor the renderer presentation around a canonical design-token layer, a reusable brand component, truthful sync-health presentation, compact menu product cards, and a structurally simpler Current Order rail. Extend sync observability only where required to expose real status; do not change sync cadence, retry rules, local transaction semantics, or remote materialization behavior.

**Tech Stack:** React 19, TypeScript 6, Vite 8, Vitest 4, Playwright 1.62, Electron 43, CSS custom properties, existing `@tux/*` workspaces.

**Repository:** `ahmedmohameda7222-ship-it/TUXCASHEIRNEW`

**Implementation branch:** `ui/tux-premium-pos-redesign`

**Base main SHA when the design branch was created:** `62a7343fc861d3917611b13a6198c8e099a99b1f`

**Spec:** `docs/superpowers/specs/2026-08-24-tux-premium-pos-redesign-design.md`

**Design authority:** `DESIGN.md`

## Global Constraints

- Work only on `ui/tux-premium-pos-redesign`; never implement directly on `main`.
- Read `DESIGN.md`, the approved redesign spec, `docs/TUX_V2_Operations_Master_Approved_Plan.md`, `docs/IMPLEMENTER_CONTEXT.md`, and relevant ADRs before editing.
- Read every file in the attached Designer Skill ZIP before UI work. Use it as the UI/UX quality process; where generic skill advice conflicts with the approved TUX design, `DESIGN.md` and the approved redesign spec win.
- Use the attached accepted laptop mock as a visual reference. It is not a source of business behavior.
- The exact user-provided `favicon.svg` is the only approved TUX logo. If it is not available in the implementation chat, block only the logo-asset wiring step and ask the user for the exact SVG. Never generate, redraw, scrape, recolor, or approximate it.
- Preserve all existing Orders, Orders Board, Expenses, Bulk Stock, End Day, worker/session, pricing, delivery, payment, modifier, printing, inventory, persistence, and idempotency behavior.
- Do not add an Admin tab or build TUX Admin.
- Do not add a new checkout/payment page. Payment remains in the one-screen Current Order rail.
- Do not use product descriptions or images that are not already real application data.
- Do not add a new icon library unless the repository already contains an approved one and it is actually necessary. Prefer semantic text plus minimal inline SVG where a status icon is required.
- No beige/brown palette drift, bright emerald SaaS styling, glass on content cards, nested card stacks, oversized ordinary radii, fake imagery, or literal Apple cloning.
- Light action green is exactly `#1F6B52`. Action and success semantics stay separate.
- Typography uses `-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif`; do not bundle SF Pro or any Apple font file.
- Primary click/touch targets are at least 44×44px where practical.
- Preserve keyboard search shortcuts, semantic roles, accessible names, visible focus, and existing E2E behavior.
- Feature/fix branches must generate zero Vercel Preview Deploys. Only `main` is allowed to deploy.
- Do not manually deploy this branch.
- Do not merge until the user gives final rendered visual approval.
- Do not claim a command, screenshot, CI run, or deployment passed without real evidence.

## Required Baseline Commands

Run from repository root before code changes:

```bash
npm ci
npm run format:check
npm run lint
npm run typecheck
npm run test
npm run build
npm run test:migrations
npm run test:e2e
```

The permanent GitHub quality gate also runs:
- development provisioning safety smoke;
- Deno checks for all Supabase Edge Functions;
- unsigned Windows x64 packaging with `npm run package:win`.

If the implementation chat has no terminal/runtime, use GitHub Actions and repository evidence instead. Never fabricate local execution.

---

# File Structure Map

## New renderer files

### `apps/operations/src/app/BrandLogo.tsx`
One canonical component for the exact TUX SVG mark. It owns accessible brand labeling; consumers do not duplicate brand markup.

### `apps/operations/src/app/SyncStatusIndicator.tsx`
Pure presentation for a renderer-level sync snapshot. It maps status to text/icon semantics without knowing transport internals.

### `apps/operations/src/app/syncStatus.ts`
Renderer-side external store/client abstraction for sync snapshots. Browser mode receives scheduler updates directly; Electron mode reads/subscribes through the preload bridge.

### `apps/operations/src/app/MenuProductCard.tsx`
Presentational menu product card. Business mutations remain in `OrdersWorkspace`; this component only receives product/quantity/busy state and callbacks.

## Potential new desktop preload test file

### `apps/operations-desktop/src/preload/syncStatusResult.test.ts`
Only create this if a dedicated runtime parser is introduced for sync IPC payloads. If the bridge uses a closed string-union payload and the validation remains local to preload, keep the test next to the parser.

## Existing files expected to change

- `packages/ui/src/tokens.css`
- `apps/operations/src/styles/premium.css`
- `apps/operations/src/styles/global.css` only if the system font baseline belongs there after inspection
- `apps/operations/src/app/App.tsx`
- `apps/operations/src/app/BrowserBootstrapGate.tsx`
- `apps/operations/src/app/OrdersWorkspace.tsx`
- `apps/operations/src/app/OrdersCart.tsx`
- `apps/operations/src/app/automaticSync.ts`
- `apps/operations/src/app/sessionClient.ts`
- `apps/operations/index.html`
- `packages/sync/src/scheduler.ts`
- `packages/sync/src/syncHealth.ts` only if a small truthful mapping improvement is required
- `packages/sync/src/syncHealth.test.ts`
- `packages/sync/src/index.ts` if new exported sync types are needed
- `packages/platform-contracts/index.d.ts`
- `apps/operations-desktop/src/main/automaticSync.ts`
- `apps/operations-desktop/src/main/index.ts`
- `apps/operations-desktop/src/preload/index.ts`
- `apps/operations/src/types/platform.d.ts` only if the global desktop API declaration requires adjustment
- `e2e/operations.e2e.ts`

Do not create a new `phaseXX-fixes.css`. The final CSS structure must describe product responsibility, not chat history.

---

## Task 0: Verify the Real Starting Tree and Inputs

**Files:** No production files changed.

**Produces:** A verified starting point for all later tasks.

- [ ] **Step 1: Verify repository and branch**

Run:

```bash
git status --short --branch
git rev-parse HEAD
git rev-parse main
git log --oneline --decorate -8
```

Expected:
- current branch is `ui/tux-premium-pos-redesign`;
- the branch contains the approved `DESIGN.md` and redesign spec;
- no unrelated uncommitted work is present.

- [ ] **Step 2: Read the design and product authorities**

Read in this order:

```text
DESIGN.md
docs/superpowers/specs/2026-08-24-tux-premium-pos-redesign-design.md
docs/TUX_V2_Operations_Master_Approved_Plan.md
docs/IMPLEMENTER_CONTEXT.md
docs/adr/0002-electron-security-boundary.md
docs/adr/0003-local-first-storage.md
docs/adr/0006-outbox-sync.md
docs/adr/0009-outbox-aggregate-dependency-and-monotonic-materialization.md
```

Also read every Markdown file in the attached Designer Skill ZIP.

- [ ] **Step 3: Inspect the current renderer and sync files before editing**

Read:

```text
apps/operations/src/app/App.tsx
apps/operations/src/app/BrowserBootstrapGate.tsx
apps/operations/src/app/OrdersWorkspace.tsx
apps/operations/src/app/OrdersCart.tsx
apps/operations/src/app/automaticSync.ts
apps/operations/src/app/sessionClient.ts
apps/operations/src/styles/premium.css
packages/ui/src/tokens.css
packages/sync/src/scheduler.ts
packages/sync/src/syncHealth.ts
apps/operations-desktop/src/main/automaticSync.ts
apps/operations-desktop/src/main/index.ts
apps/operations-desktop/src/preload/index.ts
packages/platform-contracts/index.d.ts
e2e/operations.e2e.ts
```

- [ ] **Step 4: Confirm required visual inputs**

Confirm the implementation chat has:
1. the accepted laptop mock;
2. the Designer Skill ZIP;
3. the exact original `favicon.svg`.

If item 3 is missing, record `LOGO_ASSET_BLOCKED` and continue all non-logo tasks. Do not substitute another asset.

- [ ] **Step 5: Run baseline quality**

```bash
npm ci
npm run format:check
npm run lint
npm run typecheck
npm run test
npm run build
npm run test:migrations
npm run test:e2e
```

Expected: baseline is green before redesign changes. If baseline is not green, record the exact pre-existing failure before changing UI code.

- [ ] **Step 6: Confirm branch deployment safety**

Inspect `vercel.json` and confirm non-`main` deployments remain disabled. Do not invoke Vercel deployment commands.

---

## Task 1: Make Shared Design Tokens the Single Color Authority

**Files:**
- Modify: `packages/ui/src/tokens.css`
- Modify: `apps/operations/src/styles/premium.css`
- Modify: `apps/operations/src/styles/global.css` only if required for typography baseline

**Consumes:** Approved palette and typography from `DESIGN.md`.

**Produces:** One semantic light/dark token system consumed by all later tasks.

- [ ] **Step 1: Add a failing static regression check before changing tokens**

Use a one-off repository search first:

```bash
grep -RIn --exclude-dir=node_modules -E '#f5f1ea|#fffcf8|#8f3e24|#f4f1eb|#a84727' \
  apps/operations/src packages/ui/src
```

Expected before implementation: matches exist in the current warm token blocks.

Record this as the red-state evidence for the palette migration.

- [ ] **Step 2: Replace the shared light palette in `packages/ui/src/tokens.css`**

The light semantic values must resolve to:

```css
:root {
  color-scheme: light;
  --tux-surface-canvas: #f8faf9;
  --tux-surface-panel: #ffffff;
  --tux-surface-raised: #ffffff;
  --tux-surface-subtle: #f3f6f4;
  --tux-text-primary: #181a19;
  --tux-text-secondary: #707773;
  --tux-text-muted: #707773;
  --tux-border-subtle: #e3e9e6;
  --tux-border-strong: #d3ddd8;
  --tux-accent: #1f6b52;
  --tux-accent-strong: #14533f;
  --tux-accent-soft: #eaf4ef;
  --tux-accent-hover-soft: #f3f8f5;
  --tux-positive: #2b7a55;
  --tux-positive-soft: #eaf5ef;
  --tux-warning: #a86400;
  --tux-destructive: #b42318;
  --tux-focus-ring: #1f6b52;
}
```

Keep existing spacing/z-index/breakpoint tokens unless a later task explicitly changes them.

- [ ] **Step 3: Replace dark/system token mappings**

Use exactly the dark semantic values in `DESIGN.md`:
- canvas `#0E1110`
- surface primary `#141816`
- surface secondary `#1A201D`
- text primary `#F4F7F5`
- text secondary `#AAB4AF`
- border `#29322E`
- action `#5FAE8A`
- action hover `#6DBA98`
- action pressed `#4F9B7A`
- action soft `#173429`
- success `#63B78E`
- warning `#E3A23A`
- destructive `#F06B61`
- primary action foreground `#07110C`

Preserve both system-driven dark mode and explicit `data-theme='light'` / `data-theme='dark'`.

- [ ] **Step 4: Remove palette duplication from `premium.css`**

Delete the duplicated warm `:root`, `@media (prefers-color-scheme: dark)`, `:root[data-theme='light']`, and `:root[data-theme='dark']` palette blocks from `premium.css`.

`packages/ui/src/tokens.css` becomes the color authority. Operations-specific CSS may define component aliases only when they are derived from semantic tokens.

- [ ] **Step 5: Lock typography and numeric behavior**

At the renderer baseline, ensure:

```css
html,
body,
button,
input,
select,
textarea {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
}
```

Apply `font-variant-numeric: tabular-nums` to the real price, totals, quantity, amount and output selectors already present in the renderer. Do not add dead classes merely to match the design document.

- [ ] **Step 6: Add reduced-motion baseline**

Add:

```css
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    scroll-behavior: auto !important;
    transition-duration: 0.01ms !important;
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
  }
}
```

Do not remove functional state changes.

- [ ] **Step 7: Re-run the warm-palette regression search**

```bash
grep -RIn --exclude-dir=node_modules -E '#f5f1ea|#fffcf8|#8f3e24|#f4f1eb|#a84727' \
  apps/operations/src packages/ui/src
```

Expected: no matches in active renderer/token code.

- [ ] **Step 8: Verify and commit**

```bash
npm run format:check
npm run lint
npm run typecheck
npm run build -w @tux/operations
git add packages/ui/src/tokens.css apps/operations/src/styles
git commit -m "style: establish TUX premium green design tokens"
```

---

## Task 2: Wire the Canonical TUX Logo Everywhere Branding Is Needed

**Files:**
- Create: `apps/operations/src/app/BrandLogo.tsx`
- Add exact user asset: `apps/operations/public/favicon.svg`
- Modify: `apps/operations/src/app/App.tsx`
- Modify: `apps/operations/src/app/BrowserBootstrapGate.tsx`
- Modify: `apps/operations/index.html`
- Modify: `apps/operations/src/styles/premium.css`
- Test: `e2e/operations.e2e.ts`

**Consumes:** Exact original `favicon.svg`.

**Produces:** A single canonical brand component and browser favicon.

- [ ] **Step 1: Write the rendered contract first**

Add an assertion to the existing rendered E2E startup/Orders flow:

```ts
await expect(page.getByRole('img', { name: 'TUX' })).toBeVisible();
```

If the current top-level page uses a different fixture variable, use that existing `page`; preserve the exact accessible requirement.

Run the focused test file:

```bash
npm run test:e2e -- e2e/operations.e2e.ts
```

Expected before implementation: FAIL because the current brand is typed text, not an image role.

- [ ] **Step 2: Add the exact SVG asset**

Copy the user-provided `favicon.svg` byte-for-byte to:

```text
apps/operations/public/favicon.svg
```

Do not edit SVG paths, colors, viewBox, proportions, metadata, or stroke geometry.

- [ ] **Step 3: Create `BrandLogo.tsx`**

Implement this interface:

```tsx
type BrandLogoProps = {
  readonly className?: string;
};

export function BrandLogo({ className }: BrandLogoProps) {
  return (
    <img
      className={className === undefined ? 'tux-brand-logo' : className}
      src="/favicon.svg"
      alt="TUX"
      draggable={false}
    />
  );
}
```

Do not create another text fallback while the exact asset is present.

- [ ] **Step 4: Replace duplicated typed brand functions**

In both `App.tsx` and `BrowserBootstrapGate.tsx`, remove the local typed `Brand()` implementation and render `BrandLogo`.

Use CSS sizing rather than hard-coded SVG dimensions in JSX.

- [ ] **Step 5: Wire browser favicon**

Inside `apps/operations/index.html` `<head>`, add:

```html
<link rel="icon" href="/favicon.svg" type="image/svg+xml" />
```

- [ ] **Step 6: Style the mark**

The header mark should remain compact and preserve aspect ratio. Startup/sign-in may use a larger variant through a class, but both render the exact same asset.

- [ ] **Step 7: Verify and commit**

```bash
npm run format:check
npm run lint
npm run typecheck
npm run build -w @tux/operations
npm run test:e2e -- e2e/operations.e2e.ts
git add apps/operations/public/favicon.svg apps/operations/src/app/BrandLogo.tsx \
  apps/operations/src/app/App.tsx apps/operations/src/app/BrowserBootstrapGate.tsx \
  apps/operations/index.html apps/operations/src/styles/premium.css e2e/operations.e2e.ts
git commit -m "feat: use canonical TUX brand mark"
```

If the original SVG is missing, do not execute Steps 1–7. Record the task as asset-blocked and continue Task 3.

---

## Task 3: Expose Truthful Sync Health to the Shared Renderer

**Files:**
- Modify: `packages/sync/src/scheduler.ts`
- Create: `packages/sync/src/scheduler.test.ts`
- Modify: `packages/sync/src/syncHealth.ts` only if needed for a narrow mapping
- Modify: `packages/sync/src/syncHealth.test.ts`
- Modify: `packages/sync/src/index.ts` if required for exports
- Create: `apps/operations/src/app/syncStatus.ts`
- Create: `apps/operations/src/app/SyncStatusIndicator.tsx`
- Modify: `apps/operations/src/app/automaticSync.ts`
- Modify: `apps/operations/src/app/sessionClient.ts`
- Modify: `packages/platform-contracts/index.d.ts`
- Modify: `apps/operations-desktop/src/main/automaticSync.ts`
- Modify: `apps/operations-desktop/src/main/index.ts`
- Modify: `apps/operations-desktop/src/preload/index.ts`
- Modify: `apps/operations/src/types/platform.d.ts` if required by the global declaration
- Test: sync package tests, preload/main tests where the bridge is introduced

**Consumes:** Existing `buildSyncHealth()` and `SyncHealthSnapshot`.

**Produces:** One renderer API that tells the header the truth in browser and Electron.

### Required status mapping

Do not replace the existing sync-health model. Reuse it.

Renderer-visible copy:
- `SYNCED` → `Synced`
- `SYNCING` → `Syncing…`
- `SYNC_PENDING` → `Syncing…` only after the 400ms visibility delay
- `SYNC_RETRYING` → `Offline`
- `SYNC_ISSUE` → `Sync issue`
- `LOCAL_ONLY` → `Local only`

`Sync issue` and `Local only` are necessary truth states; do not lie merely to force every state into the three common labels.

- [ ] **Step 1: Write scheduler lifecycle tests first**

Create `packages/sync/src/scheduler.test.ts` with fake timers. Cover this exact behavior: `onStart` fires once after the running guard and before `onResult`; overlapping ticks still do not start a second cycle.

Run:

```bash
npx vitest run packages/sync/src/scheduler.test.ts
```

Expected before implementation: FAIL because `onStart` does not exist.

- [ ] **Step 2: Add `onStart` without changing scheduler behavior**

Extend:

```ts
export interface AutomaticOutboxSchedulerOptions {
  readonly intervalMs?: number;
  readonly onStart?: () => void;
  readonly onResult?: (result: OutboxSyncSummary | Error) => void;
}
```

Call `onStart` only after the scheduler has passed the `#running` guard and immediately before invoking `syncOnce()`.

Do not change default 15-second interval, overlap prevention, retry behavior, error normalization, or stop/start semantics.

- [ ] **Step 3: Test the existing health mapper for every UI-relevant state**

Ensure `syncHealth.test.ts` explicitly covers unconfigured, active, pending, successful, transient-failed, quarantined/permanent-issue, and thrown-error states.

Run:

```bash
npx vitest run packages/sync/src/scheduler.test.ts packages/sync/src/syncHealth.test.ts
```

- [ ] **Step 4: Create renderer sync store/client**

`apps/operations/src/app/syncStatus.ts` must:
1. hold the latest `SyncHealthSnapshot`;
2. allow React subscription;
3. receive browser scheduler start/result events;
4. read/subscribe through preload in Electron;
5. delay visible `SYNCING`/`SYNC_PENDING` about 400ms so fast cycles do not flash every 15 seconds.

Use `useSyncExternalStore`; do not create a React polling timer.

- [ ] **Step 5: Wire browser automatic sync into the store**

Update `startBrowserAutomaticSync()` so scheduler callbacks update the browser store. Set `remoteConfigured: true` only when the remote browser runtime has actually been started.

- [ ] **Step 6: Extend the desktop contract**

Expose a narrow read/subscribe sync API. If platform-contracts can depend type-only on `@tux/sync`, use `SyncHealthSnapshot`; otherwise define a closed transport DTO and validate/map it. Do not pass unvalidated `unknown` through preload.

- [ ] **Step 7: Make Electron main own the desktop sync snapshot**

Initialize health truthfully, update it from scheduler `onStart`/`onResult`, add one get channel and one change-notification channel, and broadcast only to the trusted Operations window.

Do not expose raw errors, env vars, credentials, SQLite objects, or scheduler instances.

- [ ] **Step 8: Expose validated preload get/subscribe methods**

The preload method must return a cleanup function that removes the exact listener. Add a parser test if a new runtime validator is introduced.

- [ ] **Step 9: Create `SyncStatusIndicator.tsx`**

Render meaningful icon/symbol plus label. Success uses `--tux-positive`, not `--tux-accent`. Color is supplemental, never the sole cue.

- [ ] **Step 10: Verify sync and desktop contracts**

```bash
npx vitest run packages/sync/src/scheduler.test.ts packages/sync/src/syncHealth.test.ts
npm run typecheck
npm run test
npm run build
```

- [ ] **Step 11: Commit**

```bash
git add packages/sync packages/platform-contracts apps/operations/src/app \
  apps/operations/src/types apps/operations-desktop/src
git commit -m "feat: expose truthful Operations sync status"
```

---

## Task 4: Build the Floating Premium App Header and Move Appearance Into the Operator Menu

**Files:**
- Modify: `apps/operations/src/app/App.tsx`
- Modify: `apps/operations/src/styles/premium.css`
- Test: `e2e/operations.e2e.ts`

**Consumes:** `BrandLogo`, `SyncStatusIndicator`, approved semantic tokens.

**Produces:** Shared premium app shell used by Orders, Board, Expenses, Bulk Stock.

- [ ] **Step 1: Add E2E header contracts before restyling**

Protect Operations nav, all four area controls, operator trigger, removal of static `Local-first`, and the labeled Appearance control inside the operator menu.

- [ ] **Step 2: Refactor the header markup**

Keep existing `ActiveShell` state/area switching. Organize brand leading, primary nav, then sync status/operator trailing. Remove the persistent `Theme: Light` text control.

- [ ] **Step 3: Move appearance selection into operator menu**

Keep the same `system | light | dark` state and `tux.operations.theme` localStorage key. Add labeled System/Light/Dark choices inside the operator menu.

- [ ] **Step 4: Style the header as the single glass layer**

Required: inset outer margin, restrained translucent surface, backdrop blur, hairline, low shadow, compact height, soft green active nav, and an opaque-enough base/fallback for reduced or unsupported transparency.

- [ ] **Step 5: Correct shell height calculations**

Account for floating header margins without viewport overflow.

- [ ] **Step 6: Verify**

```bash
npm run format:check
npm run lint
npm run typecheck
npm run build -w @tux/operations
npm run test:e2e -- e2e/operations.e2e.ts
```

- [ ] **Step 7: Commit**

```bash
git add apps/operations/src/app/App.tsx apps/operations/src/styles/premium.css e2e/operations.e2e.ts
git commit -m "feat: redesign Operations floating header"
```

---

## Task 5: Rebuild Category/Search Navigation and Product-Family Control

**Files:**
- Modify: `apps/operations/src/app/OrdersWorkspace.tsx`
- Modify: `apps/operations/src/styles/premium.css`
- Test: `e2e/operations.e2e.ts`

- [ ] **Step 1: Protect existing search behavior**

Keep/add E2E coverage for categories, Search products, Ctrl/Cmd+K, `/`, and product-family filtering. Do not change keyboard behavior to fit styling.

- [ ] **Step 2: Restructure toolbar**

Render an opaque floating category/search surface and a compact family segmented control beneath/attached. Categories stay text-first; Search sits at the trailing side.

- [ ] **Step 3: Style category surface**

Use panel/subtle surface, hairline, 12–16px radius, minimal/no blur, restrained/no shadow. It is not a second glass layer.

- [ ] **Step 4: Style active category/family states**

Use green-soft selection, not saturated full-fill pills.

- [ ] **Step 5: Verify and commit**

```bash
npm run format:check
npm run lint
npm run typecheck
npm run build -w @tux/operations
npm run test:e2e -- e2e/operations.e2e.ts
git add apps/operations/src/app/OrdersWorkspace.tsx apps/operations/src/styles/premium.css e2e/operations.e2e.ts
git commit -m "feat: refine Orders menu navigation"
```

---

## Task 6: Implement the Approved Compact Product Card and Container-Responsive Grid

**Files:**
- Create: `apps/operations/src/app/MenuProductCard.tsx`
- Modify: `apps/operations/src/app/OrdersWorkspace.tsx`
- Modify: `apps/operations/src/styles/premium.css`
- Test: `e2e/operations.e2e.ts`

- [ ] **Step 1: Add E2E contracts first**

Use a fixture product with a real description and assert it is visible in the menu card. Keep Add/Remove accessible names, quantity change, sold-out disabled behavior, and null-image fallback without errors.

- [ ] **Step 2: Create focused product card component**

Use the repository’s real catalog product type. Props contain product, quantity, busy, Quick Info, decrement, and add callbacks. Do not duplicate business state.

- [ ] **Step 3: Implement exact card anatomy**

Media left; name and optional real description beside it; sold-out state in copy; footer spans card bottom; price left; stepper right. Clamp description to two lines and never synthesize copy.

- [ ] **Step 4: Preserve Quick Info and independent stepper actions**

Add/Remove must not bubble into Quick Info.

- [ ] **Step 5: Style approved card**

80–96px image, 12–16px radius, white surface, hairline, little/no shadow, approved type sizes, 44×44 stepper targets, subtle selected tint/hairline, polished image fallback.

- [ ] **Step 6: Make product grid respond to product-pane width**

Target: <600 1 col, 600–899 2, 900–1279 3, >=1280 4 only if real pane width allows. Typical laptop with cart open should naturally land near 3.

- [ ] **Step 7: Verify no horizontal overflow**

Use rendered E2E at desktop/mobile and check document scrollWidth does not exceed clientWidth.

- [ ] **Step 8: Verify and commit**

```bash
npm run format:check
npm run lint
npm run typecheck
npm run build -w @tux/operations
npm run test:e2e -- e2e/operations.e2e.ts
git add apps/operations/src/app/MenuProductCard.tsx apps/operations/src/app/OrdersWorkspace.tsx \
  apps/operations/src/styles/premium.css e2e/operations.e2e.ts
git commit -m "feat: add compact premium menu product cards"
```

---

## Task 7: Flatten the Current Order Rail Into a Structural Checkout Surface

**Files:**
- Modify: `apps/operations/src/app/OrdersCart.tsx`
- Modify: `apps/operations/src/styles/premium.css`
- Test: `e2e/operations.e2e.ts`

- [ ] **Step 1: Protect cart contract first**

Keep complementary `Current order`, Clear, order types, Edit, decrement/remove, metadata, validation issues and line total behavior covered.

- [ ] **Step 2: Preserve Current Order outer structure**

Keep dynamic configured order types and existing callbacks. Do not hard-code order types.

- [ ] **Step 3: Replace cart-line cards with divider rows**

Every row retains quantity, product name, total, modifier/combo/note metadata, validation, Edit and decrement/remove.

- [ ] **Step 4: Style the rail structurally**

Persistent desktop rail, opaque surface, no glass, no card-inside-card, restrained separation only.

- [ ] **Step 5: Verify and commit**

```bash
npm run format:check
npm run lint
npm run typecheck
npm run build -w @tux/operations
npm run test:e2e -- e2e/operations.e2e.ts
git add apps/operations/src/app/OrdersCart.tsx apps/operations/src/styles/premium.css e2e/operations.e2e.ts
git commit -m "feat: flatten Current Order rail"
```

---

## Task 8: Add Progressive Note/Discount Editors Without Changing Delivery or Payment Semantics

**Files:**
- Modify: `apps/operations/src/app/OrdersCart.tsx`
- Optionally create: `apps/operations/src/app/OrderAdjustments.tsx` only if it materially reduces `OrdersCart` complexity
- Modify: `apps/operations/src/styles/premium.css`
- Test: `e2e/operations.e2e.ts`

- [ ] **Step 1: Write progressive-disclosure E2E behavior first**

With cart lines present, verify `Add order note` and `Discount · EGP 0` are compact collapsed rows, activating each reveals the existing editor, and non-empty values persist through the existing mutation path.

- [ ] **Step 2: Add local visibility state only**

Note starts expanded when `draft.orderNote !== null`; discount starts expanded when `draft.discountMinor > 0`; validation issues auto-expand the relevant editor. Persisted values remain in `draft` through `onMutate`.

- [ ] **Step 3: Render compact adjustment rows**

Inline disclosure only; no modal.

- [ ] **Step 4: Preserve Delivery exactly**

Do not change phone normalization/autofill, customer, zone, address, delivery fee, reference or validation behavior.

- [ ] **Step 5: Preserve Payment exactly**

Do not change dynamic methods, Cash, Instapay, split, cash received, change, tender suggestions or validation. Only simplify visual nesting.

- [ ] **Step 6: Verify core checkout flows**

```bash
npm run test:e2e -- e2e/operations.e2e.ts
```

- [ ] **Step 7: Verify and commit**

```bash
npm run format:check
npm run lint
npm run typecheck
npm run build -w @tux/operations
npm run test:e2e -- e2e/operations.e2e.ts
git add apps/operations/src/app/OrdersCart.tsx apps/operations/src/styles/premium.css e2e/operations.e2e.ts
```

If `OrderAdjustments.tsx` was created, add it before commit.

```bash
git commit -m "feat: add progressive order adjustments"
```

---

## Task 9: Finish Sticky Totals, Primary CTA, and Mobile/Tablet Composition

**Files:**
- Modify: `apps/operations/src/app/OrdersCart.tsx`
- Modify: `apps/operations/src/app/OrdersWorkspace.tsx`
- Modify: `apps/operations/src/styles/premium.css`
- Test: `e2e/operations.e2e.ts`

- [ ] **Step 1: Keep `Place Order` accessibility stable**

Visible CTA may show the computed total, but preserve accessible name `Place Order` using `aria-label="Place Order"` if needed. Never recalculate money independently in JSX.

- [ ] **Step 2: Style the financial summary**

Subtotal/items, Discount, Delivery where applicable, then strongly emphasized Total. Place Order is the strongest action-green surface.

- [ ] **Step 3: Preserve sticky checkout reachability**

Desktop cart scrolls independently while totals/payment/CTA remain reachable. Mobile preserves the existing Review & pay trigger/overlay and never forces a desktop rail beside a one-column menu.

- [ ] **Step 4: Verify 375 / 768 / 1440**

No horizontal overflow, header overlap, clipped CTA, or unreadable product card at any target width.

- [ ] **Step 5: Verify and commit**

```bash
npm run format:check
npm run lint
npm run typecheck
npm run build -w @tux/operations
npm run test:e2e -- e2e/operations.e2e.ts
git add apps/operations/src/app/OrdersCart.tsx apps/operations/src/app/OrdersWorkspace.tsx \
  apps/operations/src/styles/premium.css e2e/operations.e2e.ts
git commit -m "feat: finish responsive premium checkout layout"
```

---

## Task 10: Accessibility, Dark Theme, Reduced Motion, and Material Fallback Audit

**Files:** Modify only renderer files that fail the audit.

- [ ] **Step 1: Verify semantic/accessibility contracts**

Operations nav, Current order, Search, Add/Remove, Delivery labels, payment buttons, Place Order, operator menu and visible keyboard focus remain correct.

- [ ] **Step 2: Audit 44px hit targets**

Check product stepper, order type, categories, operator trigger, CTA and mobile Review & pay.

- [ ] **Step 3: Verify Light, Dark and System**

No warm palette returns; approved semantic colors remain readable and distinct.

- [ ] **Step 4: Verify reduced motion**

Emulate `prefers-reduced-motion: reduce`; interactions must work without decorative transitions.

- [ ] **Step 5: Verify glass fallback**

Header remains legible without backdrop filtering. Category/content remain opaque.

- [ ] **Step 6: Run complete rendered suite**

```bash
npm run test:e2e
```

- [ ] **Step 7: Commit only if fixes were required**

```bash
git add apps/operations e2e/operations.e2e.ts
git commit -m "fix: harden premium UI accessibility and themes"
```

Do not create an empty commit if no fixes are necessary.

---

## Task 11: Full Quality Gate and Visual Design Review

**Files:** No new feature scope; fix only demonstrated defects.

- [ ] **Step 1: Run full repository gate**

```bash
npm run format:check
npm run lint
npm run typecheck
npm run test
npm run build
```

- [ ] **Step 2: Run provisioning and migration gates**

Use the same safety behavior as CI, then run `npm run test:migrations`. Clean only generated local test databases afterward.

- [ ] **Step 3: Run Edge Function checks if Deno is available**

Use the exact four `deno check` commands from `.github/workflows/ci.yml`. If Deno is unavailable locally, use GitHub Actions as evidence.

- [ ] **Step 4: Run complete browser E2E**

```bash
npm run test:e2e
```

Confirm no console/page errors or horizontal overflow and all core desktop/mobile/checkout/navigation flows pass.

- [ ] **Step 5: Run Windows package gate**

On Windows or GitHub Actions:

```bash
npm run package:win
```

- [ ] **Step 6: Capture visual QA evidence**

Capture Orders screenshots at approximately 1440px, 768px and 375px, plus light and dark sanity views. Desktop screenshot must contain representative products and a non-empty Current Order.

- [ ] **Step 7: Audit screenshots against approved design**

PASS requires canonical mark when supplied, near-white canvas, premium green action hierarchy, one glass header, opaque menu bar, exact compact landscape card anatomy, flattened Current Order, restrained radii, dominant Place Order, Apple-derived typography, and no generic SaaS/beige/brown drift.

- [ ] **Step 8: Regression-search banned warm colors**

```bash
grep -RIn --exclude-dir=node_modules -E '#f5f1ea|#fffcf8|#8f3e24|#f4f1eb|#a84727' \
  apps/operations/src packages/ui/src
```

Expected: no active UI matches.

- [ ] **Step 9: Verify exact final branch head**

```bash
git status --short
git log --oneline --decorate -12
git diff main...HEAD --stat
```

---

## Task 12: PR, User Visual Approval, Squash Merge, and Production Verification

- [ ] **Step 1: Confirm zero Vercel Preview Deploys for the feature branch**

Do not merge if deployment configuration was changed to enable previews.

- [ ] **Step 2: Open PR to `main`**

Title: `Premium green TUX POS redesign`

Body summarizes design system, logo status, truthful sync state, header, product cards, Current Order, responsive/accessibility work, and exact test evidence.

- [ ] **Step 3: Wait for all permanent GitHub gates**

`quality`, `windows-package`, and `Required quality gate` must all be green on the exact PR head.

- [ ] **Step 4: Show final rendered screenshots to the user and wait**

Do not merge from code review alone. User must approve the actual rendered implementation.

- [ ] **Step 5: Apply only requested visual corrections**

Each correction gets real verification and refreshed screenshots; do not reopen architecture unless the user explicitly changes the approved design.

- [ ] **Step 6: After explicit visual approval, squash merge into `main`**

- [ ] **Step 7: Verify production**

Confirm exactly one Production deploy originates from `main`, reaches READY, and `https://tuxcasheirnew-three.vercel.app` responds successfully. Do not create destructive real business data during smoke verification.

- [ ] **Step 8: Final report**

Report branch SHA, PR, squash SHA, deployment, URL, every quality gate, visual QA, overflow at 375/768/1440, logo, tokens, header, menu bar, product cards, Current Order, sync status, themes and reduced motion. Every line must have evidence.

---

# Implementation Stop Conditions

Stop and ask one precise question instead of guessing if:

1. the exact original `favicon.svg` is unavailable;
2. the mock conflicts with `DESIGN.md`/spec in a way that changes a product decision;
3. truthful Electron sync status would require weakening the preload security boundary;
4. a business behavior must change to achieve the visual design;
5. the baseline is already red in an unrelated way that blocks meaningful validation;
6. a visual change would require fake product data, fake images, or a new unapproved workflow.

Do not stop for ordinary implementation choices already resolved by the approved spec.

# Completion Definition

Complete only when the exact feature-branch head passes permanent gates, rendered desktop/mobile QA matches the approved design, the user approves the real rendered UI, the PR is squash-merged only after that approval, exactly one Production deploy comes from `main`, production is verified, and no business/system invariant was silently changed.
