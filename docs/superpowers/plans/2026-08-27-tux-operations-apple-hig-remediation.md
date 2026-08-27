# TUX Operations Apple HIG Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve TUX Operations’ high-frequency cashier controls and close the concrete Apple/HIG accessibility contradictions found in the 2026-08-27 repo audit without changing business behavior or redesigning approved flows.

**Architecture:** Keep the existing React/TypeScript component structure and TUX semantic-token system. Phase A makes the requested POS controls more legible and differentiates increment/decrement with semantics plus color reinforcement; Phase B fixes concrete accessibility gaps at the token/CSS layer so the same behavior applies consistently across light/dark themes and system accessibility preferences. Do not redesign Orders Board, change routes, change business/domain logic, or introduce new component abstractions unless a task below explicitly requires it.

**Tech Stack:** React 19, TypeScript 6, CSS custom properties, Vitest 4, Playwright 1.62, Vite 8, Electron 43, npm workspaces.

**Spec:** `DESIGN.md`

## Audit authority

Implementation must also preserve the approved 2026-08-27 audit decisions that led to this plan:

- High-frequency POS order-type and payment labels become `600` Semibold, not `800` Heavy.
- `Edit` and `Extra` operational labels become `600` Semibold.
- Quantity `+` and `−` glyphs remain heavy (`800`) and 44×44 px.
- `+` uses TUX action green as reinforcement; `−` remains neutral and must not use destructive red.
- Color is never the sole indicator: the explicit `+` / `−` symbols and accessible names remain intact.
- Current light/dark themes, rounded Current Order panel, resize behavior, mobile flow, keyboard behavior, and business logic remain unchanged.
- Fix the six concrete audit failures: reduced motion, reduced transparency, increased contrast, weak focus visibility, light secondary-text contrast, and dark selected-accent contrast.
- Defer subjective follow-up redesigns (Orders Board tab restyling, reducing repeated `Mark Done` prominence, global screen-title rescaling) to a separate explicitly approved design task.

## Baseline

- Planning baseline: `main` at `039ca29720ba2d32c3d75d9d8fc1a1b7d4fa42d1`.
- Before implementation, re-read `DESIGN.md`, verify current `main`, and preserve any newer compatible work.
- Create one isolated implementation worktree/branch from the then-current `main`; do not implement on this docs branch.
- Recommended implementation branch: `ui/apple-hig-operations-remediation`.
- Create a Draft PR against `main` after the first meaningful RED→GREEN commit.
- Do not deploy the feature branch to Vercel.
- Do not merge until all permanent `TUX V2 CI` gates pass on the exact PR head.

## Global Constraints

- Use the system UI stack already defined in the repo; do not bundle SF Pro or proprietary Apple fonts.
- Keep high-frequency interaction targets at least `44px × 44px`.
- Keep Place Order at least `48px` visible height.
- Preserve all existing `aria-label`, role, keyboard, and focus contracts unless a task explicitly strengthens them.
- Use semantic CSS tokens; do not scatter new raw colors through component styles.
- Do not use TUX destructive red for decrement because decrement is reversible direct manipulation, not deletion.
- Use RED→GREEN TDD for every production change.
- Use `superpowers:systematic-debugging` for any unexpected failure.
- Use `superpowers:verification-before-completion` before claiming the implementation is ready.
- Do not apply or add Supabase migrations for this UI-only work.
- Do not change order placement, payment logic, stock logic, persistence, sync, or printing behavior.
- Do not alter the approved Menu-to-Current-Order 8px structural gap.

## File map

**Primary production files**

- `apps/operations/src/app/MenuProductCard.tsx` — product-card quantity increment/decrement controls and Extra action markup.
- `apps/operations/src/app/OrdersCart.tsx` — Current Order quantity controls, Edit/Extra actions, order-type controls, payment controls.
- `apps/operations/src/styles/premium.css` — canonical refined Operations visual hierarchy, control typography, hover/selected/focus styling, system-preference media queries.
- `packages/ui/src/tokens.css` — light/dark semantic color tokens and increased-contrast overrides.

**Tests / QA**

- Create `apps/operations/src/styles/apple-hig-remediation.test.ts` — source/token contracts plus contrast calculations for this bounded remediation.
- Modify `e2e/operations.e2e.ts` — rendered computed-style assertions for cashier-critical controls and reduced-motion behavior.
- Existing full suite remains authoritative: `npm run format:check`, `npm run lint`, `npm run test`, `npm run typecheck`, `npm run build`, `npm run test:e2e`, Windows package, and `Required quality gate`.

---

## Phase A — High-frequency cashier controls

### Task 1: Lock semantic quantity-button hooks and cashier-control typography

**Files:**
- Modify: `apps/operations/src/app/MenuProductCard.tsx`
- Modify: `apps/operations/src/app/OrdersCart.tsx`
- Modify: `apps/operations/src/styles/premium.css`
- Create/Test: `apps/operations/src/styles/apple-hig-remediation.test.ts`

**Interfaces:**
- Consumes: existing button accessible names (`Add one …`, `Remove one …`, `Increase … quantity`, `Decrease … quantity`).
- Produces: reusable CSS hooks `.quantity-increment` and `.quantity-decrement` on both product-card and Current Order steppers.
- Produces: scoped `600` weights for order type, payment methods, Edit, line Extra, and product Extra.

- [ ] **Step 1: Create the failing source contract for cashier-critical typography and quantity semantics**

Create `apps/operations/src/styles/apple-hig-remediation.test.ts` with:

```ts
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const stylesDirectory = dirname(fileURLToPath(import.meta.url));
const appDirectory = resolve(stylesDirectory, '..', 'app');

function css(name: string): string {
  return readFileSync(resolve(stylesDirectory, name), 'utf8');
}

function app(name: string): string {
  return readFileSync(resolve(appDirectory, name), 'utf8');
}

describe('Apple/HIG remediation contracts', () => {
  it('uses explicit semantic hooks for both quantity stepper directions', () => {
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
      /\.order-type-section \.segmented-control button,\s*\.payment-section \.payment-methods button\s*\{[^}]*font-size:\s*14px;[^}]*line-height:\s*18px;[^}]*font-weight:\s*600;/s,
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

Run:

```bash
npm test -- apps/operations/src/styles/apple-hig-remediation.test.ts
```

Expected: FAIL because the semantic classes do not exist yet and refined cashier controls still use `font-weight: 500`.

- [ ] **Step 3: Add semantic quantity hooks without changing accessible names or behavior**

In `MenuProductCard.tsx`, add only the class names to the existing decrement/increment buttons:

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

In `OrdersCart.tsx`, add the same classes to the existing Current Order stepper buttons:

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

Do not change event handlers, disabled conditions, text, or ARIA labels.

- [ ] **Step 4: Raise only the approved high-frequency labels to Semibold**

In `premium.css`, change the final refined order/payment rule from `500` to `600`:

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

Change the refined Current Order action rule to:

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

Change product Extra to:

```css
.product-extra-action {
  min-height: 44px;
  font-size: 14px;
  line-height: 18px;
  font-weight: 600;
}
```

Keep all existing dimensions, colors, borders, selected states, and hover states unchanged in this task.

- [ ] **Step 5: Restore heavy glyph weight specifically inside steppers**

Add after the refined stepper geometry rules in `premium.css`:

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

This prevents the broader `.line-actions button { font-weight: 600; }` rule from visually weakening Current Order `+` / `−` glyphs.

- [ ] **Step 6: Run the focused test and verify GREEN**

Run:

```bash
npm test -- apps/operations/src/styles/apple-hig-remediation.test.ts
```

Expected: PASS.

- [ ] **Step 7: Run the existing style/UI regression tests**

Run:

```bash
npm test -- apps/operations/src/styles/ui-alignment.test.ts apps/operations/src/styles/cart-divider.test.ts
```

Expected: PASS; Current Order rounding, gap, resize target, and other approved corrections remain locked.

- [ ] **Step 8: Commit**

```bash
git add apps/operations/src/app/MenuProductCard.tsx \
  apps/operations/src/app/OrdersCart.tsx \
  apps/operations/src/styles/premium.css \
  apps/operations/src/styles/apple-hig-remediation.test.ts
git commit -m "ui: strengthen cashier-critical controls"
```

After this commit, open a Draft PR against `main` if one does not exist yet.

---

### Task 2: Differentiate increment and decrement without misusing destructive color

**Files:**
- Modify: `apps/operations/src/styles/premium.css`
- Modify/Test: `apps/operations/src/styles/apple-hig-remediation.test.ts`

**Interfaces:**
- Consumes: `.quantity-increment` / `.quantity-decrement` from Task 1.
- Consumes: existing `--tux-accent-strong`, `--tux-accent-hover-soft`, `--tux-text-primary`, `--tux-surface-subtle` tokens.
- Produces: distinct direction styling while preserving symbol-based meaning.

- [ ] **Step 1: Extend the test with a failing color-semantics contract**

Add inside the existing describe block:

```ts
it('uses action green for increment and keeps decrement neutral', () => {
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

This intentionally refers to `--tux-accent-text`, which Task 3 will introduce. For this task, first use the temporary existing semantic action token `--tux-accent-strong`, then update the assertion in the same RED→GREEN cycle only after Task 3 lands. To keep every task independently green, use this Task 2 test initially:

```ts
expect(source).toMatch(
  /\.quantity-increment\s*\{[^}]*color:\s*var\(--tux-accent-strong\);/s,
);
```

- [ ] **Step 2: Run focused test and verify RED**

```bash
npm test -- apps/operations/src/styles/apple-hig-remediation.test.ts
```

Expected: FAIL because direction-specific color rules do not exist.

- [ ] **Step 3: Add minimal direction styling in `premium.css`**

```css
.quantity-decrement {
  color: var(--tux-text-primary);
}

.quantity-increment {
  color: var(--tux-accent-strong);
}

.quantity-increment:hover:not(:disabled) {
  background: var(--tux-accent-hover-soft);
  color: var(--tux-accent-strong);
}

.quantity-decrement:hover:not(:disabled) {
  background: color-mix(in srgb, var(--tux-text-primary) 5%, transparent);
  color: var(--tux-text-primary);
}
```

Do not introduce red, success green, labels, icons, or layout changes.

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

## Phase B — Concrete Apple/HIG audit remediation

### Task 3: Separate selected-control text color from pressed-action color and fix light secondary contrast

**Files:**
- Modify: `packages/ui/src/tokens.css`
- Modify: `apps/operations/src/styles/premium.css`
- Modify/Test: `apps/operations/src/styles/apple-hig-remediation.test.ts`

**Interfaces:**
- Produces new semantic token `--tux-accent-text`.
- Light `--tux-accent-text`: `#14533f`.
- Dark `--tux-accent-text`: `#5fae8a`.
- Light `--tux-text-secondary`: `#6d7470` in both default light root and explicit `[data-theme='light']` root.
- Selected text and quantity increment consume `--tux-accent-text`; pressed primary-action surfaces continue consuming `--tux-accent-pressed` / `--tux-accent-strong`.

- [ ] **Step 1: Add token parsing and contrast helpers to the test file**

Add above the describe block:

```ts
const repoRoot = resolve(stylesDirectory, '../../../..');

function tokenCss(): string {
  return readFileSync(resolve(repoRoot, 'packages/ui/src/tokens.css'), 'utf8');
}

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

- [ ] **Step 2: Add failing token/contrast contracts**

```ts
it('keeps light secondary text at WCAG AA for small operational copy', () => {
  expect(contrast('#6d7470', '#f8faf9')).toBeGreaterThanOrEqual(4.5);
  expect(tokenCss()).toContain('--tux-text-secondary: #6d7470;');
});

it('separates selected-control text from pressed-action color in dark mode', () => {
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

Expected: FAIL because the new token and adjusted light secondary value do not exist.

- [ ] **Step 4: Update light tokens in `packages/ui/src/tokens.css`**

In `:root` and `:root[data-theme='light']`, change:

```css
--tux-text-secondary: #6d7470;
--tux-accent-text: #14533f;
```

Keep:

```css
--tux-accent-pressed: #14533f;
--tux-accent-strong: var(--tux-accent-pressed);
```

The new text token is semantically separate even though light mode initially shares the same numeric color.

- [ ] **Step 5: Add the dark selected-text token**

In both dark token blocks (`prefers-color-scheme: dark` and explicit `[data-theme='dark']`):

```css
--tux-accent-text: #5fae8a;
```

Keep the pressed action token unchanged:

```css
--tux-accent-pressed: #4f9b7a;
--tux-accent-strong: var(--tux-accent-pressed);
```

- [ ] **Step 6: Route selected text and increment glyphs through `--tux-accent-text`**

In `premium.css`, replace selected-control text uses for these refined controls:

```css
.operations-header .nav-item-active,
.menu-toolbar .category-rail button.selected,
.menu-toolbar > .field-stack > .segmented-control button.selected,
.order-type-section .segmented-control button.selected,
.payment-section .payment-methods button.selected,
.quantity-increment {
  color: var(--tux-accent-text);
}
```

Do not replace primary-action backgrounds or pressed-state tokens.

Also update the Task 2 test assertion from `--tux-accent-strong` to `--tux-accent-text`.

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

### Task 4: Strengthen keyboard focus visibility

**Files:**
- Modify: `apps/operations/src/styles/premium.css`
- Modify/Test: `apps/operations/src/styles/apple-hig-remediation.test.ts`

**Interfaces:**
- Consumes: existing `--tux-focus-ring` token.
- Produces: a 3px focus outline mixed at `70%`, preserving the existing 2px offset.

- [ ] **Step 1: Add a failing focus contract**

```ts
it('keeps keyboard focus strong enough to locate immediately', () => {
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

Expected: FAIL because the current premium override uses `36%`.

- [ ] **Step 3: Replace the weak premium focus rule**

```css
:focus-visible {
  outline: 3px solid color-mix(in srgb, var(--tux-focus-ring) 70%, transparent);
  outline-offset: 2px;
}
```

Do not remove the special `.cart-resize-separator:focus-visible::before` behavior in `final-pos-corrections.css`.

- [ ] **Step 4: Run focused and existing divider tests**

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
- Removes press translation and nonessential transition motion without changing layout or disabled behavior.

- [ ] **Step 1: Add the failing source contract**

```ts
it('disables nonessential control motion when reduced motion is requested', () => {
  const source = css('premium.css');

  expect(source).toMatch(
    /@media \(prefers-reduced-motion: reduce\)\s*\{[\s\S]*button:not\(:disabled\):active\s*\{[^}]*transform:\s*none;/,
  );
  expect(source).toMatch(
    /@media \(prefers-reduced-motion: reduce\)\s*\{[\s\S]*button,\s*input,\s*select,\s*textarea\s*\{[^}]*transition-duration:\s*0\.01ms;/,
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

Do not remove focus, hover, selected, or disabled visual state changes.

- [ ] **Step 4: Run focused test and verify GREEN**

```bash
npm test -- apps/operations/src/styles/apple-hig-remediation.test.ts
```

Expected: PASS.

- [ ] **Step 5: Add rendered reduced-motion coverage to `e2e/operations.e2e.ts`**

Reuse the existing browser seeding/sign-in helpers in that file. Add a test that calls:

```ts
await page.emulateMedia({ reducedMotion: 'reduce' });
```

Then after reaching Orders, assert an enabled product `+` button computes to no press transform after `mouse.down()`:

```ts
const addButton = page.getByRole('button', { name: /Add one Single Smashed Patty/ });
await addButton.hover();
await page.mouse.down();
expect(await addButton.evaluate((node) => getComputedStyle(node).transform)).toBe('none');
await page.mouse.up();
```

Use the existing test setup helpers rather than creating a second seed/bootstrap path.

- [ ] **Step 6: Run the specific Playwright test**

Run the exact test title you added, for example:

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

### Task 6: Provide an opaque reduced-transparency header fallback

**Files:**
- Modify: `apps/operations/src/styles/premium.css`
- Modify/Test: `apps/operations/src/styles/apple-hig-remediation.test.ts`

**Interfaces:**
- Produces `@media (prefers-reduced-transparency: reduce)` fallback for the only approved glass-like persistent navigation surface.
- Keeps header geometry, borders, radius, and layout unchanged.

- [ ] **Step 1: Add failing reduced-transparency contract**

```ts
it('provides an opaque operations header when reduced transparency is requested', () => {
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

- [ ] **Step 3: Add the fallback at the end of `premium.css`**

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

### Task 7: Add increased-contrast token overrides

**Files:**
- Modify: `packages/ui/src/tokens.css`
- Modify/Test: `apps/operations/src/styles/apple-hig-remediation.test.ts`

**Interfaces:**
- Produces `@media (prefers-contrast: more)` token overrides.
- Does not change default light/dark appearance.
- Increased contrast strengthens borders, secondary text, focus ring, and selected-control text while preserving semantic roles.

- [ ] **Step 1: Add failing increased-contrast contract**

```ts
it('provides stronger semantic tokens when increased contrast is requested', () => {
  const tokens = tokenCss();

  expect(tokens).toMatch(
    /@media \(prefers-contrast: more\)\s*\{[\s\S]*--tux-border-subtle:[^;]+;[\s\S]*--tux-focus-ring:[^;]+;[\s\S]*--tux-accent-text:[^;]+;/,
  );
});
```

- [ ] **Step 2: Run focused test and verify RED**

```bash
npm test -- apps/operations/src/styles/apple-hig-remediation.test.ts
```

Expected: FAIL because no `prefers-contrast` override exists.

- [ ] **Step 3: Add increased-contrast overrides at the end of `tokens.css`**

Use semantic token derivation instead of raw component colors:

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

Because explicit theme roots already redefine the base semantic tokens, this media query must remain last in `tokens.css` so it wins after light/dark theme selection.

- [ ] **Step 4: Run focused test and verify GREEN**

```bash
npm test -- apps/operations/src/styles/apple-hig-remediation.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run token consumers’ unit/style suite**

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

## Phase C — Rendered cashier QA and final verification

### Task 8: Verify computed styles for the exact requested controls

**Files:**
- Modify/Test: `e2e/operations.e2e.ts`

**Interfaces:**
- Consumes: seeded fixture order types `Take Away`, `Dine In`, `Delivery`; payment methods `Cash`, `Instapay`.
- Consumes: product fixture `Single Smashed Patty`.
- Produces: rendered evidence that requested controls have the intended hierarchy and quantity direction is visually distinct in both product card and Current Order.

- [ ] **Step 1: Add a rendered typography test**

Using the file’s existing seed/bootstrap helpers, add a test titled:

```ts
test('cashier-critical controls use the approved operational emphasis', async ({ page }) => {
  // existing seed + sign-in helper calls here, exactly as neighboring Orders tests use them

  const takeAway = page.getByRole('button', { name: 'Take Away' });
  const delivery = page.getByRole('button', { name: 'Delivery' });

  for (const control of [takeAway, delivery]) {
    await expect(control).toBeVisible();
    expect(await control.evaluate((node) => getComputedStyle(node).fontWeight)).toBe('600');
  }

  await page.getByRole('button', { name: /Add one Single Smashed Patty/ }).click();

  const cash = page.getByRole('button', { name: 'Cash' });
  const instapay = page.getByRole('button', { name: 'Instapay' });
  for (const control of [cash, instapay]) {
    await expect(control).toBeVisible();
    expect(await control.evaluate((node) => getComputedStyle(node).fontWeight)).toBe('600');
  }
});
```

Do not duplicate setup logic; copy the exact setup calls from the closest existing Orders E2E test.

- [ ] **Step 2: Run the new typography test and verify it passes**

```bash
npm run test:e2e -- --grep "cashier-critical controls use the approved operational emphasis"
```

Expected: PASS.

- [ ] **Step 3: Add a rendered quantity-direction test**

```ts
test('quantity increment is action-colored while decrement stays neutral', async ({ page }) => {
  // existing seed + sign-in helper calls here, exactly as neighboring Orders tests use them

  const addButton = page.getByRole('button', { name: /Add one Single Smashed Patty/ });
  await addButton.click();

  const removeButton = page.getByRole('button', { name: /Remove one Single Smashed Patty/ });
  const addColor = await addButton.evaluate((node) => getComputedStyle(node).color);
  const removeColor = await removeButton.evaluate((node) => getComputedStyle(node).color);

  expect(addColor).not.toBe(removeColor);
  await expect(addButton).toHaveAttribute('aria-label', /Add one Single Smashed Patty/);
  await expect(removeButton).toHaveAttribute('aria-label', /Remove one Single Smashed Patty/);
});
```

The test intentionally asserts distinction plus semantics rather than hard-coding one browser’s RGB serialization.

- [ ] **Step 4: Run the new quantity test**

```bash
npm run test:e2e -- --grep "quantity increment is action-colored while decrement stays neutral"
```

Expected: PASS.

- [ ] **Step 5: Capture rendered QA evidence at desktop and mobile widths through the existing Playwright artifact flow**

Run the full E2E suite locally when the environment is available:

```bash
npm run test:e2e
```

At minimum inspect the generated report/evidence for:

- desktop 1440px: Delivery / Take Away and Cash / InstaPay remain readable and aligned;
- product-card `+ / −`: direction is immediately distinguishable without red;
- Current Order `+ / −`: same semantic treatment as product card;
- Edit and Extra remain 44px high and visibly stronger;
- dark mode selected labels remain readable;
- mobile Review & pay flow has no overflow or clipped controls.

Do not approve screenshot-only evidence if computed-style or behavior tests fail.

- [ ] **Step 6: Commit**

```bash
git add e2e/operations.e2e.ts
git commit -m "test: cover cashier control emphasis and quantity semantics"
```

---

### Task 9: Documentation reconciliation and full permanent verification

**Files:**
- Modify: `DESIGN.md`
- Test: entire repository

**Interfaces:**
- Updates the enduring design authority so later work does not reintroduce the audited contradictions.
- Does not add new product requirements beyond what this plan implements.

- [ ] **Step 1: Update `DESIGN.md` with the exact implemented rules**

Under **Typography**, add:

```markdown
Cashier-critical mutually exclusive controls such as Order Type and Payment Method may use Semibold at the existing standard-control size when repeated scan speed warrants stronger recognition. Do not escalate these controls to Bold/Heavy by default.
```

Under **Interaction targets and controls**, add:

```markdown
Quantity steppers distinguish direction through symbol plus semantic color reinforcement: increment uses the TUX action accent, decrement remains neutral, and decrement must not use destructive red unless the action becomes destructive rather than reversible.
```

Under **Accessibility**, add:

```markdown
- Persistent translucent navigation must provide an opaque `prefers-reduced-transparency: reduce` fallback.
- Nonessential press/transition motion must respect `prefers-reduced-motion: reduce`.
- Semantic tokens must provide a `prefers-contrast: more` path for stronger borders, focus, and control text.
- Keyboard focus indicators must maintain at least 3:1 non-text contrast against adjacent surfaces.
```

Do not change the existing rules that reserve Bold for exceptional emphasis or require 44px targets.

- [ ] **Step 2: Run formatting first and inspect the diff**

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

Expected: only the planned files and planned semantics changed. No business logic, unrelated formatting churn, or `final-pos-corrections.css` gap/rounding edits.

- [ ] **Step 3: Run all local permanent checks**

```bash
npm run format:check
npm run lint
npm run test
npm run typecheck
npm run build
```

Expected: all commands exit 0.

- [ ] **Step 4: Run rendered browser E2E**

```bash
npm run test:e2e
```

Expected: all Playwright tests pass.

- [ ] **Step 5: Commit documentation reconciliation**

```bash
git add DESIGN.md
git commit -m "docs: codify Apple HIG operations accessibility rules"
```

- [ ] **Step 6: Push exact head and wait for `TUX V2 CI` on the PR**

Required permanent gates from `.github/workflows/ci.yml`:

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

No gate may be skipped because this is UI-only work.

- [ ] **Step 7: Review the exact-head PR diff and review threads**

Confirm:

- No Supabase migration was added or applied.
- No domain/application/server behavior changed.
- No Vercel deployment was created from the feature branch.
- The Menu-to-Current-Order 8px structural gap remains unchanged.
- Product and Current Order steppers both use semantic increment/decrement classes.
- Increment uses action accent; decrement is neutral and not destructive red.
- Delivery / Take Away / Cash / InstaPay / Edit / Extra compute to `font-weight: 600`.
- All quantity glyphs remain 44px targets and `font-weight: 800`.
- `prefers-reduced-motion`, `prefers-reduced-transparency`, and `prefers-contrast` contracts exist.
- Light secondary text and dark selected text meet the numeric contrast tests.
- Focus ring no longer uses the old `36%` mix.
- All unresolved review threads are addressed before merge approval.

- [ ] **Step 8: Use verification-before-completion and stop before merge**

Re-run or freshly inspect the exact-head permanent CI result. Report:

- implementation branch;
- PR number and exact head SHA;
- commits created;
- RED evidence per task;
- final GREEN local and CI evidence;
- rendered QA result;
- any intentionally deferred design recommendations.

Do **not** merge until the user explicitly asks.

---

## Deferred follow-up design decisions — not part of this implementation

The audit identified these as plausible improvements, but they require a separate design approval because they change visual hierarchy rather than merely fixing a concrete contradiction:

1. Convert Orders Board `Active / Done / Cancelled / Returned` pills into the same segmented-control visual language used elsewhere.
2. Rebalance repeated green `Mark Done` actions on dense Orders Board views so the accent does not lose priority meaning.
3. Normalize major screen-title sizes across Orders Board, Expenses, and Bulk Stock.
4. Broaden typography normalization beyond the explicitly requested cashier-critical controls.

Do not implement these four items under this plan.

## Final acceptance criteria

The implementation is ready for user review only when all of the following are true:

- Delivery / Take Away / Cash / InstaPay are rendered at `14px / 18px / 600`.
- Edit and Extra are rendered at `14px / 18px / 600`.
- Product-card and Current Order `+ / −` controls remain 44×44 px.
- `+` and `−` glyphs are heavy (`800`).
- `+` uses action accent and `−` remains neutral; neither meaning depends on color alone.
- Decrement never uses destructive red.
- Light secondary operational text meets at least 4.5:1 against the approved canvas in the regression calculation.
- Dark selected-control text meets at least 4.5:1 against the selected soft-accent surface in the regression calculation.
- Focus indicator uses the strengthened 70% focus-ring mix and retains a visible keyboard focus state.
- Reduced Motion removes press translation and reduces transition duration.
- Reduced Transparency makes the persistent Operations header opaque and removes backdrop blur.
- Increased Contrast strengthens semantic tokens without changing default theme behavior.
- Existing mobile/desktop flows, Current Order rounding/gap/resize behavior, business logic, accessibility names, and keyboard paths remain intact.
- Full `TUX V2 CI` is green on the exact PR head, including Windows packaging and rendered browser E2E.
