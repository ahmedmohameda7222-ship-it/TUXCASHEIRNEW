# TUX Operations Apple HIG Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve TUX Operations’ high-frequency cashier controls and close the concrete Apple/HIG accessibility contradictions found in the 2026-08-27 repo audit without changing business behavior or redesigning approved flows.

**Architecture:** Preserve the existing React/TypeScript component structure and TUX semantic-token system. Phase A strengthens the cashier controls the user explicitly called out; Phase B fixes concrete accessibility gaps at token/CSS level so light/dark themes and system accessibility preferences remain coherent; Phase C adds rendered verification and reconciles the enduring design authority. No business/domain logic or route architecture changes are authorized.

**Tech Stack:** React 19, TypeScript 6, CSS custom properties, Vitest 4, Playwright 1.62, Vite 8, Electron 43, npm workspaces.

**Spec:** `DESIGN.md`

## External Apple guidance used by the approved audit

- Buttons: `https://developer.apple.com/design/human-interface-guidelines/buttons`
- Accessibility: `https://developer.apple.com/design/human-interface-guidelines/accessibility`
- Color: `https://developer.apple.com/design/human-interface-guidelines/color`
- Motion: `https://developer.apple.com/design/human-interface-guidelines/motion`
- Focus and selection: `https://developer.apple.com/design/human-interface-guidelines/focus-and-selection`
- Segmented controls: `https://developer.apple.com/design/human-interface-guidelines/segmented-controls`

## Audit authority

Implementation must preserve these approved 2026-08-27 audit decisions:

- High-frequency Order Type and Payment Method labels use `14px / 18px / 600` Semibold, not `800` Heavy.
- `Edit` and `Extra` operational labels use `14px / 18px / 600` Semibold.
- Quantity `+` and `−` glyphs remain heavy (`800`) and inside 44×44 px targets.
- `+` uses the TUX action accent as reinforcement; `−` remains neutral and must not use destructive red.
- Color is never the sole direction cue: explicit `+` / `−` glyphs and accessible names remain intact.
- Current light/dark themes, rounded Current Order panel, resize behavior, mobile Review & pay flow, keyboard behavior, and business logic remain unchanged.
- Fix the six concrete audit failures: reduced motion, reduced transparency, increased contrast, weak focus visibility, light secondary-text contrast, and dark selected-accent contrast.
- Defer subjective follow-up redesigns — Orders Board tab restyling, repeated `Mark Done` prominence, global title rescaling — to a separate explicit design approval.

## Baseline

- Planning baseline: `main` at `039ca29720ba2d32c3d75d9d8fc1a1b7d4fa42d1`.
- Before implementation, re-read `DESIGN.md`, verify the actual current `main`, and preserve any newer compatible work.
- Create one isolated implementation worktree/branch from the then-current `main`; do not implement on this docs branch.
- Recommended implementation branch: `ui/apple-hig-operations-remediation`.
- Create a Draft PR against `main` after the first meaningful RED→GREEN commit.
- Do not deploy the feature branch to Vercel.
- Do not merge until all permanent `TUX V2 CI` gates pass on the exact PR head.

## Global Constraints

- Use the existing system font stack; do not bundle SF Pro or proprietary Apple font files.
- Keep high-frequency interaction targets at least `44px × 44px`.
- Keep Place Order at least `48px` visible height.
- Preserve existing `aria-label`, role, keyboard, and focus contracts unless a task explicitly strengthens them.
- Use semantic CSS tokens; do not scatter new raw colors through component styles.
- Decrement is reversible direct manipulation, so it must not use `--tux-destructive`.
- Use RED→GREEN TDD for every production change.
- Use `superpowers:systematic-debugging` for unexpected failures.
- Use `superpowers:verification-before-completion` before claiming readiness.
- Do not add or apply Supabase migrations for this UI-only work.
- Do not change order placement, payment logic, stock logic, persistence, sync, printing, or receipt behavior.
- Do not alter the approved Menu-to-Current-Order 8px structural gap or Current Order 12px invisible resize target.

## File map

**Primary production files**

- `apps/operations/src/app/MenuProductCard.tsx` — product quantity buttons and product Extra markup.
- `apps/operations/src/app/OrdersCart.tsx` — Current Order quantity buttons, Edit/Extra, Order Type, and Payment controls.
- `apps/operations/src/styles/premium.css` — canonical refined Operations hierarchy, control typography, focus, and system-preference fallbacks.
- `packages/ui/src/tokens.css` — semantic light/dark/increased-contrast tokens.

**Tests / QA**

- Create `apps/operations/src/styles/apple-hig-remediation.test.ts` — source/token contracts and numeric contrast checks.
- Modify `e2e/operations.e2e.ts` — rendered computed-style and reduced-motion coverage using existing `enterActiveOrdersForCategoryTests`, `openCartIfMobile`, and `currentOrderCart` helpers.
- Existing permanent suite remains authoritative: format, lint, unit/integration, typecheck, builds, provisioning smoke, migration-chain smoke, Edge Function typecheck, rendered Playwright E2E, Windows package, Required quality gate.

---

## Phase A — High-frequency cashier controls

### Task 1: Add semantic quantity hooks and strengthen cashier-critical typography

**Files:**
- Modify: `apps/operations/src/app/MenuProductCard.tsx`
- Modify: `apps/operations/src/app/OrdersCart.tsx`
- Modify: `apps/operations/src/styles/premium.css`
- Create/Test: `apps/operations/src/styles/apple-hig-remediation.test.ts`

**Interfaces:**
- Consumes existing accessible names: `Add one …`, `Remove one …`, `Increase … quantity`, `Decrease … quantity`.
- Produces `.quantity-increment` and `.quantity-decrement` CSS hooks on both product-card and Current Order steppers.
- Produces scoped `600` typography for Order Type, Payment Method, Edit, line Extra, and product Extra.

- [ ] **Step 1: Create the failing source contract**

Create `apps/operations/src/styles/apple-hig-remediation.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const stylesDirectory = dirname(fileURLToPath(import.meta.url));
const appDirectory = resolve(stylesDirectory, '..', 'app');
const repoRoot = resolve(stylesDirectory, '../../../..');

function css(name: string): string {
  return readFileSync(resolve(stylesDirectory, name), 'utf8');
}

function app(name: string): string {
  return readFileSync(resolve(appDirectory, name), 'utf8');
}

function tokenCss(): string {
  return readFileSync(resolve(repoRoot, 'packages/ui/src/tokens.css'), 'utf8');
}

describe('Apple/HIG remediation contracts', () => {
  it('uses explicit semantic hooks for both quantity directions', () => {
    const productCard = app('MenuProductCard.tsx');
    const ordersCart = app('OrdersCart.tsx');

    for (const source of [productCard, ordersCart]) {
      expect(source).toContain('className="quantity-decrement"');
      expect(source).toContain('className="quantity-increment"');
    }
  });

  it('makes cashier-critical labels semibold without making the whole control system heavy', () => {
    const source = css('premium.css');

    expect(source).toMatch(
      /\.order-type-section \.segmented-control button,\s*\.payment-section \.payment-methods button,\s*\.split-payment-action\s*\{[^}]*font-size:\s*14px;[^}]*line-height:\s*18px;[^}]*font-weight:\s*600;/s,
    );
    expect(source).toMatch(
      /\.line-actions button\s*\{[^}]*font-size:\s*14px;[^}]*line-height:\s*18px;[^}]*font-weight:\s*600;/s,
    );
    expect(source).toMatch(
      /\.product-extra-action\s*\{[^}]*font-size:\s*14px;[^}]*line-height:\s*18px;[^}]*font-weight:\s*600;/s,
    );
  });
});
```

- [ ] **Step 2: Run the focused test and verify RED**

```bash
npm test -- apps/operations/src/styles/apple-hig-remediation.test.ts
```

Expected: FAIL because the semantic classes do not exist and refined cashier controls still use `font-weight: 500`.

- [ ] **Step 3: Add semantic classes without changing behavior**

In `MenuProductCard.tsx`, preserve the existing handlers/ARIA and add only:

```tsx
<button
  type="button"
  className="quantity-decrement"
  aria-label={`Remove one ${product.name}`}
  disabled={busy || quantity === 0}
  onClick={(event) => runIndependentAction(event, onDecrement)}
>
  −
</button>
```

```tsx
<button
  type="button"
  className="quantity-increment"
  aria-label={`Add one ${product.name}`}
  disabled={busy || product.soldOut}
  onClick={(event) => runIndependentAction(event, onAdd)}
>
  +
</button>
```

In `OrdersCart.tsx`, preserve the existing handlers/ARIA and add:

```tsx
<button
  type="button"
  className="quantity-decrement"
  aria-label={`Decrease ${line.productName} quantity`}
  disabled={busy}
  onClick={() => onDecrementLine(line.id)}
>
  −
</button>
```

```tsx
<button
  type="button"
  className="quantity-increment"
  aria-label={`Increase ${line.productName} quantity`}
  disabled={busy}
  onClick={() => onIncrementLine(line.id)}
>
  +
</button>
```

- [ ] **Step 4: Raise only approved operational labels to `600`**

In the final refined rules in `premium.css`, use:

```css
.order-type-section .segmented-control button,
.payment-section .payment-methods button,
.split-payment-action {
  min-height: 44px;
  font-size: 14px;
  line-height: 18px;
  font-weight: 600;
}
```

```css
.line-actions button {
  min-height: 44px;
  border: 1px solid color-mix(in srgb, var(--tux-border-subtle) 72%, transparent);
  border-radius: var(--tux-radius-sm);
  background: var(--tux-surface-subtle);
  padding: 0 12px;
  font-size: 14px;
  line-height: 18px;
  font-weight: 600;
}
```

```css
.product-extra-action {
  min-height: 44px;
  font-size: 14px;
  line-height: 18px;
  font-weight: 600;
}
```

This intentionally applies the stronger weight to the whole mutually exclusive Order Type group, including Dine In, and the whole Payment Method group, not only labels present in the screenshot.

- [ ] **Step 5: Preserve heavy quantity glyphs in both steppers**

Add after the refined stepper geometry rules:

```css
.product-quantity .quantity-decrement,
.product-quantity .quantity-increment,
.line-quantity-stepper .quantity-decrement,
.line-quantity-stepper .quantity-increment {
  font-size: 20px;
  line-height: 1;
  font-weight: 800;
}
```

- [ ] **Step 6: Run focused test and verify GREEN**

```bash
npm test -- apps/operations/src/styles/apple-hig-remediation.test.ts
```

Expected: PASS.

- [ ] **Step 7: Run existing visual contracts**

```bash
npm test -- apps/operations/src/styles/ui-alignment.test.ts apps/operations/src/styles/cart-divider.test.ts
```

Expected: PASS; Current Order rounding, 8px structural gap, hidden divider, keyboard focus restoration, and 12px resize hit area remain intact.

- [ ] **Step 8: Commit and open Draft PR**

```bash
git add apps/operations/src/app/MenuProductCard.tsx \
  apps/operations/src/app/OrdersCart.tsx \
  apps/operations/src/styles/premium.css \
  apps/operations/src/styles/apple-hig-remediation.test.ts
git commit -m "ui: strengthen cashier-critical controls"
```

Open one Draft PR against `main` after this commit.

---

## Phase B — Concrete Apple/HIG audit remediation

### Task 2: Introduce selected-text semantics and fix concrete color contrast failures

**Files:**
- Modify: `packages/ui/src/tokens.css`
- Modify: `apps/operations/src/styles/premium.css`
- Modify/Test: `apps/operations/src/styles/apple-hig-remediation.test.ts`

**Interfaces:**
- Produces `--tux-accent-text` separate from pressed-action color.
- Light `--tux-accent-text`: `#14533f`.
- Dark `--tux-accent-text`: `#5fae8a`.
- Light `--tux-text-secondary`: `#6d7470` in both default and explicit light roots.
- Selected control text consumes `--tux-accent-text`; primary pressed backgrounds continue consuming existing pressed/action tokens.

- [ ] **Step 1: Add numeric contrast helpers**

Add above the describe block:

```ts
function rgb(hex: string): readonly [number, number, number] {
  const value = hex.replace('#', '');
  return [0, 2, 4].map((offset) => Number.parseInt(value.slice(offset, offset + 2), 16) / 255) as [
    number,
    number,
    number,
  ];
}

function luminance(hex: string): number {
  const channels = rgb(hex).map((channel) =>
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrast(left: string, right: string): number {
  const a = luminance(left);
  const b = luminance(right);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
```

- [ ] **Step 2: Add failing token contracts**

```ts
it('keeps light secondary text at AA contrast for small operational copy', () => {
  expect(contrast('#6d7470', '#f8faf9')).toBeGreaterThanOrEqual(4.5);
  expect(tokenCss()).toContain('--tux-text-secondary: #6d7470;');
});

it('separates selected text from pressed-action color in dark mode', () => {
  const tokens = tokenCss();
  const styles = css('premium.css');

  expect(tokens).toContain('--tux-accent-text: #14533f;');
  expect(tokens).toContain('--tux-accent-text: #5fae8a;');
  expect(contrast('#5fae8a', '#173429')).toBeGreaterThanOrEqual(4.5);
  expect(styles).toContain('color: var(--tux-accent-text);');
});
```

- [ ] **Step 3: Run focused test and verify RED**

```bash
npm test -- apps/operations/src/styles/apple-hig-remediation.test.ts
```

Expected: FAIL because the new token and revised secondary text value do not exist.

- [ ] **Step 4: Update light semantic tokens**

In both `:root` and `:root[data-theme='light']`:

```css
--tux-text-secondary: #6d7470;
--tux-accent-text: #14533f;
```

Keep the action/pressed relationship unchanged:

```css
--tux-accent-pressed: #14533f;
--tux-accent-strong: var(--tux-accent-pressed);
```

- [ ] **Step 5: Add dark selected-text token**

In both dark token blocks:

```css
--tux-accent-text: #5fae8a;
```

Keep:

```css
--tux-accent-pressed: #4f9b7a;
--tux-accent-strong: var(--tux-accent-pressed);
```

- [ ] **Step 6: Route refined selected text through the new token**

In `premium.css`, use `var(--tux-accent-text)` for selected-control text where the refined layer currently uses `var(--tux-accent-strong)`, including:

```css
.operations-header .nav-item-active,
.menu-toolbar .category-rail button.selected,
.menu-toolbar > .field-stack > .segmented-control button.selected,
.order-type-section .segmented-control button.selected,
.payment-section .payment-methods button.selected {
  color: var(--tux-accent-text);
}
```

Do not replace primary-action backgrounds, hover backgrounds, or pressed-action tokens.

- [ ] **Step 7: Run focused test and verify GREEN**

```bash
npm test -- apps/operations/src/styles/apple-hig-remediation.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/ui/src/tokens.css \
  apps/operations/src/styles/premium.css \
  apps/operations/src/styles/apple-hig-remediation.test.ts
git commit -m "fix: strengthen operations color contrast"
```

---

### Task 3: Differentiate increment and decrement using symbol plus semantic color

**Files:**
- Modify: `apps/operations/src/styles/premium.css`
- Modify/Test: `apps/operations/src/styles/apple-hig-remediation.test.ts`

**Interfaces:**
- Consumes `.quantity-increment` / `.quantity-decrement` from Task 1.
- Consumes `--tux-accent-text` from Task 2.
- Produces distinct direction styling without destructive semantics.

- [ ] **Step 1: Add failing direction-color contract**

```ts
it('uses action accent for increment and keeps decrement neutral', () => {
  const source = css('premium.css');

  expect(source).toMatch(
    /\.quantity-increment\s*\{[^}]*color:\s*var\(--tux-accent-text\);/s,
  );
  expect(source).toMatch(
    /\.quantity-decrement\s*\{[^}]*color:\s*var\(--tux-text-primary\);/s,
  );
  expect(source).not.toMatch(
    /\.quantity-decrement\s*\{[^}]*var\(--tux-destructive\)/s,
  );
});
```

- [ ] **Step 2: Run focused test and verify RED**

```bash
npm test -- apps/operations/src/styles/apple-hig-remediation.test.ts
```

Expected: FAIL because direction-specific color rules do not exist.

- [ ] **Step 3: Add minimal scoped styling**

```css
.quantity-decrement {
  color: var(--tux-text-primary);
}

.quantity-increment {
  color: var(--tux-accent-text);
}

.quantity-increment:hover:not(:disabled) {
  background: var(--tux-accent-hover-soft);
  color: var(--tux-accent-text);
}

.quantity-decrement:hover:not(:disabled) {
  background: color-mix(in srgb, var(--tux-text-primary) 5%, transparent);
  color: var(--tux-text-primary);
}
```

Do not add labels, new icons, red, or layout changes.

- [ ] **Step 4: Run focused test and verify GREEN**

```bash
npm test -- apps/operations/src/styles/apple-hig-remediation.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/operations/src/styles/premium.css \
  apps/operations/src/styles/apple-hig-remediation.test.ts
git commit -m "ui: distinguish quantity increment and decrement"
```

---

### Task 4: Strengthen keyboard focus visibility

**Files:**
- Modify: `apps/operations/src/styles/premium.css`
- Modify/Test: `apps/operations/src/styles/apple-hig-remediation.test.ts`

**Interfaces:**
- Consumes `--tux-focus-ring`.
- Produces a 3px focus outline at a `70%` token mix with the existing 2px offset.

- [ ] **Step 1: Add failing focus contract**

```ts
it('keeps keyboard focus immediately visible', () => {
  const source = css('premium.css');

  expect(source).toMatch(
    /:focus-visible\s*\{[^}]*outline:\s*3px solid color-mix\(in srgb, var\(--tux-focus-ring\) 70%, transparent\);[^}]*outline-offset:\s*2px;/s,
  );
  expect(source).not.toContain('var(--tux-focus-ring) 36%');
});
```

- [ ] **Step 2: Run focused test and verify RED**

```bash
npm test -- apps/operations/src/styles/apple-hig-remediation.test.ts
```

Expected: FAIL because the refined layer currently mixes the focus ring at `36%`.

- [ ] **Step 3: Replace only the weak refined focus rule**

```css
:focus-visible {
  outline: 3px solid color-mix(in srgb, var(--tux-focus-ring) 70%, transparent);
  outline-offset: 2px;
}
```

Do not remove `.cart-resize-separator:focus-visible::before` from `final-pos-corrections.css`.

- [ ] **Step 4: Run focused and divider tests**

```bash
npm test -- apps/operations/src/styles/apple-hig-remediation.test.ts apps/operations/src/styles/cart-divider.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/operations/src/styles/premium.css \
  apps/operations/src/styles/apple-hig-remediation.test.ts
git commit -m "fix: strengthen keyboard focus visibility"
```

---

### Task 5: Respect reduced motion

**Files:**
- Modify: `apps/operations/src/styles/premium.css`
- Modify/Test: `apps/operations/src/styles/apple-hig-remediation.test.ts`
- Modify/Test: `e2e/operations.e2e.ts`

**Interfaces:**
- Produces `@media (prefers-reduced-motion: reduce)` behavior.
- Removes the 1px press translation and effectively eliminates nonessential transition duration without altering selection/focus/disabled states.

- [ ] **Step 1: Add failing source contract**

```ts
it('disables nonessential control motion when reduced motion is requested', () => {
  const source = css('premium.css');

  expect(source).toMatch(
    /@media \(prefers-reduced-motion: reduce\)\s*\{[\s\S]*button,\s*input,\s*select,\s*textarea\s*\{[^}]*transition-duration:\s*0\.01ms;/,
  );
  expect(source).toMatch(
    /@media \(prefers-reduced-motion: reduce\)\s*\{[\s\S]*button:not\(:disabled\):active\s*\{[^}]*transform:\s*none;/,
  );
});
```

- [ ] **Step 2: Run focused test and verify RED**

```bash
npm test -- apps/operations/src/styles/apple-hig-remediation.test.ts
```

Expected: FAIL because no reduced-motion rule exists.

- [ ] **Step 3: Add reduced-motion fallback at the end of `premium.css`**

```css
@media (prefers-reduced-motion: reduce) {
  button,
  input,
  select,
  textarea {
    transition-duration: 0.01ms;
  }

  button:not(:disabled):active {
    transform: none;
  }
}
```

- [ ] **Step 4: Run focused test and verify GREEN**

```bash
npm test -- apps/operations/src/styles/apple-hig-remediation.test.ts
```

Expected: PASS.

- [ ] **Step 5: Add rendered reduced-motion E2E using the existing setup helper**

Add to `e2e/operations.e2e.ts`:

```ts
test('respects reduced motion for cashier controls', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await enterActiveOrdersForCategoryTests(page);

  const addButton = page.getByRole('button', { name: 'Add one Single Smashed Patty' });
  await addButton.hover();
  const box = await addButton.boundingBox();
  expect(box).not.toBeNull();

  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  expect(await addButton.evaluate((node) => getComputedStyle(node).transform)).toBe('none');
  await page.mouse.up();
});
```

- [ ] **Step 6: Run the exact Playwright test**

```bash
npm run test:e2e -- --grep "respects reduced motion for cashier controls"
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/operations/src/styles/premium.css \
  apps/operations/src/styles/apple-hig-remediation.test.ts \
  e2e/operations.e2e.ts
git commit -m "fix: respect reduced motion in operations controls"
```

---

### Task 6: Provide an opaque reduced-transparency fallback

**Files:**
- Modify: `apps/operations/src/styles/premium.css`
- Modify/Test: `apps/operations/src/styles/apple-hig-remediation.test.ts`

**Interfaces:**
- Produces `@media (prefers-reduced-transparency: reduce)` for the persistent floating Operations header.
- Keeps header dimensions, radius, border, and navigation layout unchanged.

- [ ] **Step 1: Add failing reduced-transparency contract**

```ts
it('makes the floating header opaque when reduced transparency is requested', () => {
  const source = css('premium.css');

  expect(source).toMatch(
    /@media \(prefers-reduced-transparency: reduce\)\s*\{[\s\S]*\.operations-header\s*\{[^}]*background:\s*var\(--tux-surface-panel\);[^}]*backdrop-filter:\s*none;[^}]*-webkit-backdrop-filter:\s*none;/,
  );
});
```

- [ ] **Step 2: Run focused test and verify RED**

```bash
npm test -- apps/operations/src/styles/apple-hig-remediation.test.ts
```

Expected: FAIL because no reduced-transparency media query exists.

- [ ] **Step 3: Add fallback**

```css
@media (prefers-reduced-transparency: reduce) {
  .operations-header {
    background: var(--tux-surface-panel);
    backdrop-filter: none;
    -webkit-backdrop-filter: none;
  }
}
```

- [ ] **Step 4: Run focused test and verify GREEN**

```bash
npm test -- apps/operations/src/styles/apple-hig-remediation.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/operations/src/styles/premium.css \
  apps/operations/src/styles/apple-hig-remediation.test.ts
git commit -m "fix: add reduced transparency fallback"
```

---

### Task 7: Add increased-contrast semantic-token overrides

**Files:**
- Modify: `packages/ui/src/tokens.css`
- Modify/Test: `apps/operations/src/styles/apple-hig-remediation.test.ts`

**Interfaces:**
- Produces `@media (prefers-contrast: more)` token overrides.
- Default light/dark appearance remains unchanged when the preference is not active.

- [ ] **Step 1: Add failing increased-contrast contract**

```ts
it('provides stronger semantic tokens when increased contrast is requested', () => {
  const tokens = tokenCss();

  expect(tokens).toMatch(
    /@media \(prefers-contrast: more\)\s*\{[\s\S]*--tux-text-secondary:[^;]+;[\s\S]*--tux-border-subtle:[^;]+;[\s\S]*--tux-focus-ring:[^;]+;[\s\S]*--tux-accent-text:[^;]+;/,
  );
});
```

- [ ] **Step 2: Run focused test and verify RED**

```bash
npm test -- apps/operations/src/styles/apple-hig-remediation.test.ts
```

Expected: FAIL because `tokens.css` has no increased-contrast override.

- [ ] **Step 3: Add the media query last in `tokens.css`**

```css
@media (prefers-contrast: more) {
  :root {
    --tux-text-secondary: color-mix(in srgb, var(--tux-text-primary) 78%, var(--tux-surface-canvas));
    --tux-border-subtle: color-mix(in srgb, var(--tux-text-primary) 32%, var(--tux-surface-panel));
    --tux-focus-ring: var(--tux-accent);
    --tux-accent-text: var(--tux-accent);
  }
}
```

The media query stays after explicit light/dark theme blocks so the accessibility preference wins regardless of selected theme.

- [ ] **Step 4: Run focused test and verify GREEN**

```bash
npm test -- apps/operations/src/styles/apple-hig-remediation.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run existing style contracts**

```bash
npm test -- apps/operations/src/styles/apple-hig-remediation.test.ts apps/operations/src/styles/ui-alignment.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/tokens.css \
  apps/operations/src/styles/apple-hig-remediation.test.ts
git commit -m "fix: support increased contrast preferences"
```

---

## Phase C — Rendered cashier QA and authority reconciliation

### Task 8: Verify the exact requested controls in rendered Playwright

**Files:**
- Modify/Test: `e2e/operations.e2e.ts`

**Interfaces:**
- Uses existing `enterActiveOrdersForCategoryTests(page)` for deterministic browser-fallback setup.
- Uses `openCartIfMobile(page, testInfo)` and `currentOrderCart(page, testInfo)` so the same test works across desktop and mobile projects.
- Uses fixture labels `Take Away`, `Dine In`, `Delivery`, `Cash`, `Instapay`, and product `Single Smashed Patty`.

- [ ] **Step 1: Add rendered typography coverage with exact existing helpers**

```ts
test('cashier-critical controls use the approved operational emphasis', async ({ page }, testInfo) => {
  await enterActiveOrdersForCategoryTests(page);

  const productCard = page
    .locator('.product-card')
    .filter({ hasText: 'Single Smashed Patty' })
    .first();
  const productExtra = productCard.getByRole('button', { name: 'Extra', exact: true });
  expect(await productExtra.evaluate((node) => getComputedStyle(node).fontWeight)).toBe('600');

  await productCard.getByRole('button', { name: 'Add one Single Smashed Patty' }).click();
  await openCartIfMobile(page, testInfo);
  const cart = currentOrderCart(page, testInfo);

  for (const name of ['Take Away', 'Dine In', 'Delivery', 'Cash', 'Instapay']) {
    const control = cart.getByRole('button', { name, exact: true });
    await expect(control).toBeVisible();
    expect(await control.evaluate((node) => getComputedStyle(node).fontWeight)).toBe('600');
  }

  const line = cart.locator('.cart-line').filter({ hasText: 'Single Smashed Patty' }).first();
  for (const name of ['Edit', 'Extra']) {
    const control = line.getByRole('button', { name, exact: true });
    await expect(control).toBeVisible();
    expect(await control.evaluate((node) => getComputedStyle(node).fontWeight)).toBe('600');
  }
});
```

- [ ] **Step 2: Run the exact typography test**

```bash
npm run test:e2e -- --grep "cashier-critical controls use the approved operational emphasis"
```

Expected: PASS.

- [ ] **Step 3: Add rendered quantity-direction coverage for both steppers**

```ts
test('quantity increment is action-colored while decrement stays neutral', async ({ page }, testInfo) => {
  await enterActiveOrdersForCategoryTests(page);

  const productCard = page
    .locator('.product-card')
    .filter({ hasText: 'Single Smashed Patty' })
    .first();
  const productAdd = productCard.getByRole('button', { name: 'Add one Single Smashed Patty' });
  await productAdd.click();
  const productRemove = productCard.getByRole('button', { name: 'Remove one Single Smashed Patty' });

  expect(await productAdd.evaluate((node) => getComputedStyle(node).fontWeight)).toBe('800');
  expect(await productRemove.evaluate((node) => getComputedStyle(node).fontWeight)).toBe('800');
  expect(await productAdd.evaluate((node) => getComputedStyle(node).color)).not.toBe(
    await productRemove.evaluate((node) => getComputedStyle(node).color),
  );

  await openCartIfMobile(page, testInfo);
  const cart = currentOrderCart(page, testInfo);
  const line = cart.locator('.cart-line').filter({ hasText: 'Single Smashed Patty' }).first();
  const lineAdd = line.getByRole('button', { name: /Increase Single Smashed Patty quantity/ });
  const lineRemove = line.getByRole('button', { name: /Decrease Single Smashed Patty quantity/ });

  expect(await lineAdd.evaluate((node) => getComputedStyle(node).fontWeight)).toBe('800');
  expect(await lineRemove.evaluate((node) => getComputedStyle(node).fontWeight)).toBe('800');
  expect(await lineAdd.evaluate((node) => getComputedStyle(node).color)).not.toBe(
    await lineRemove.evaluate((node) => getComputedStyle(node).color),
  );

  await expect(productAdd).toHaveAttribute('aria-label', 'Add one Single Smashed Patty');
  await expect(productRemove).toHaveAttribute('aria-label', 'Remove one Single Smashed Patty');
  await expect(lineAdd).toHaveAttribute('aria-label', 'Increase Single Smashed Patty quantity');
  await expect(lineRemove).toHaveAttribute('aria-label', 'Decrease Single Smashed Patty quantity');
});
```

- [ ] **Step 4: Run the exact quantity test**

```bash
npm run test:e2e -- --grep "quantity increment is action-colored while decrement stays neutral"
```

Expected: PASS.

- [ ] **Step 5: Run all three new rendered tests together**

```bash
npm run test:e2e -- --grep "cashier-critical controls|quantity increment|respects reduced motion"
```

Expected: PASS on configured desktop/mobile Playwright projects.

- [ ] **Step 6: Inspect rendered evidence produced by the existing artifact flow**

Check the existing Playwright report/test-results output for:

- 1440px desktop: Order Type and Payment labels are stronger without clipping.
- Product-card `+ / −`: immediately distinguishable, no red decrement.
- Current Order `+ / −`: same semantic treatment as product cards.
- Edit and Extra remain 44px high and align with the existing line-action geometry.
- Dark mode selected labels remain legible.
- Mobile Review & pay has no horizontal overflow or clipped action controls.

- [ ] **Step 7: Commit**

```bash
git add e2e/operations.e2e.ts
git commit -m "test: cover Apple HIG cashier control remediation"
```

---

### Task 9: Reconcile `DESIGN.md` and run full permanent verification

**Files:**
- Modify: `DESIGN.md`
- Test: entire repository

**Interfaces:**
- Updates the enduring design authority to prevent regression.
- Adds no new product behavior beyond Tasks 1–8.

- [ ] **Step 1: Add the implemented typography exception under `## Typography`**

Add:

```markdown
Cashier-critical mutually exclusive controls such as Order Type and Payment Method may use Semibold at the existing standard-control size when repeated scan speed warrants stronger recognition. Do not escalate these controls to Bold/Heavy by default.
```

- [ ] **Step 2: Add the quantity-direction rule under `## Interaction targets and controls`**

Add:

```markdown
Quantity steppers distinguish direction through symbol plus semantic color reinforcement: increment uses the TUX action accent, decrement remains neutral, and decrement must not use destructive red unless the action becomes destructive rather than reversible.
```

- [ ] **Step 3: Add exact accessibility preference rules under `## Accessibility`**

Add:

```markdown
- Persistent translucent navigation must provide an opaque `prefers-reduced-transparency: reduce` fallback.
- Nonessential press/transition motion must respect `prefers-reduced-motion: reduce`.
- Semantic tokens must provide a `prefers-contrast: more` path for stronger borders, focus, and control text.
- Keyboard focus indicators must maintain at least 3:1 non-text contrast against adjacent surfaces.
```

Do not remove the existing rules reserving Bold for exceptional emphasis or requiring 44px targets.

- [ ] **Step 4: Format and inspect the exact diff before broad verification**

```bash
npm run format
git diff --check
git diff -- DESIGN.md \
  apps/operations/src/app/MenuProductCard.tsx \
  apps/operations/src/app/OrdersCart.tsx \
  apps/operations/src/styles/premium.css \
  apps/operations/src/styles/apple-hig-remediation.test.ts \
  packages/ui/src/tokens.css \
  e2e/operations.e2e.ts
```

Expected: only planned files/semantics changed. No business logic, unrelated formatting churn, Supabase migrations, or `final-pos-corrections.css` gap/rounding changes.

- [ ] **Step 5: Run all local permanent checks**

```bash
npm run format:check
npm run lint
npm run test
npm run typecheck
npm run build
npm run test:e2e
```

Expected: all commands exit 0.

- [ ] **Step 6: Commit authority reconciliation**

```bash
git add DESIGN.md
git commit -m "docs: codify Apple HIG operations accessibility rules"
```

- [ ] **Step 7: Push exact head and require full `TUX V2 CI`**

The PR must pass every permanent gate defined in `.github/workflows/ci.yml`:

1. Format check
2. Lint
3. Unit and integration tests
4. Typecheck
5. Production builds
6. Development provisioning safety smoke
7. Migration-chain smoke
8. Edge Function typecheck
9. Rendered browser E2E
10. QA evidence upload
11. Unsigned Windows x64 package
12. Required quality gate

No gate may be skipped because the change is UI-only.

- [ ] **Step 8: Audit the exact-head PR before completion claim**

Confirm all of the following directly from the exact PR head/diff:

- No migration was added or applied.
- No domain/application/server behavior changed.
- No feature-branch Vercel deploy was created.
- Menu-to-Current-Order 8px structural gap remains unchanged.
- Current Order 12px invisible resize target remains unchanged.
- Product and Current Order steppers both use `.quantity-increment` / `.quantity-decrement`.
- Increment uses `--tux-accent-text`; decrement is neutral and never destructive red.
- Order Type / Payment / Edit / Extra compute to `600`.
- Quantity glyphs compute to `800` inside 44px targets.
- `prefers-reduced-motion`, `prefers-reduced-transparency`, and `prefers-contrast` contracts exist.
- Light secondary text and dark selected text pass the numeric contrast tests.
- Focus ring no longer contains the old `36%` mix.
- All PR review threads are resolved or explicitly addressed.

- [ ] **Step 9: Use verification-before-completion and stop before merge**

Freshly inspect the exact-head CI result and report:

- implementation branch;
- PR number and exact head SHA;
- commits created;
- RED evidence per production task;
- final GREEN local + CI evidence;
- rendered QA result;
- intentionally deferred design recommendations.

Do **not** merge until the user explicitly asks.

---

## Deferred follow-up design decisions — not part of this plan

These audit observations require a separate design approval because they change hierarchy rather than fixing a concrete contradiction:

1. Convert Orders Board `Active / Done / Cancelled / Returned` pills into the same segmented visual language used elsewhere.
2. Rebalance repeated green `Mark Done` actions on dense Orders Board views so the accent does not lose priority meaning.
3. Normalize major screen-title scales across Orders Board, Expenses, and Bulk Stock.
4. Broaden typography normalization beyond the explicitly approved cashier-critical controls.

Do not implement these four items under this plan.

## Final acceptance criteria

The implementation is ready for user review only when all are true:

- Take Away / Dine In / Delivery render at `14px / 18px / 600`.
- Cash / Instapay render at `14px / 18px / 600`.
- Edit and Extra render at `14px / 18px / 600`.
- Product-card and Current Order `+ / −` controls remain 44×44 px.
- `+` and `−` glyphs render at weight `800`.
- `+` uses the action accent and `−` remains neutral; direction never depends on color alone.
- Decrement never uses destructive red.
- Light secondary operational text meets at least 4.5:1 against the approved canvas in the regression calculation.
- Dark selected-control text meets at least 4.5:1 against the soft selected surface in the regression calculation.
- Focus uses the strengthened 70% ring mix and retains visible keyboard focus.
- Reduced Motion removes press translation and effectively removes nonessential transition duration.
- Reduced Transparency makes the persistent Operations header opaque and removes backdrop blur.
- Increased Contrast strengthens semantic tokens without changing default theme behavior.
- Existing mobile/desktop flows, Current Order rounding/gap/resize behavior, business logic, accessibility names, and keyboard paths remain intact.
- Full `TUX V2 CI` is green on the exact PR head, including Windows packaging and rendered browser E2E.
