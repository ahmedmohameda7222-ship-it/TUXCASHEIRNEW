# TUX Operations Worker System Color Design

## Status

Approved in chat on 2026-08-28. This document is the binding Product, UX, Visual, Accessibility, Persistence, and Runtime Theme authority for this bounded refinement.

It extends the current TUX Operations visual system after PR #42. It does not redesign the POS, replace the existing Light/System/Dark appearance control, or alter business-domain semantics.

## Goal

Allow each worker to choose one personal TUX system accent color from the profile menu using a visual color picker, HEX, RGB, or an eyedropper when supported. The chosen base color must sync with that worker across devices and automatically produce a coherent, accessible Light and Dark accent palette while preserving all non-brand semantic colors.

## Non-goals

- Do not make the system color shop-global or device-global.
- Do not make the existing Appearance preference worker-synced; `System | Light | Dark` remains the current device-local preference.
- Do not let workers edit individual derived theme shades.
- Do not recolor semantic positive/success, warning, destructive/error, inventory, payment, or business-state colors when those colors carry meaning.
- Do not introduce a second theme framework or a second worker-preference persistence subsystem.
- Do not persist generated Light/Dark palette values.
- Do not redesign navigation, product cards, Current Order, Orders Board, Expenses, Bulk Stock, or End Day.

---

## 1. Preference ownership and persistence

### Worker ownership

The system accent is a **per-worker preference synced across devices**.

Use the existing `worker_ui_preferences` aggregate keyed by `(shop_id, worker_id)`. Add one nullable canonical field:

```text
accentColor: SystemAccentColor | null
```

`null` means **TUX default accent**. It is intentionally different from persisting the current green literal so future default-token improvements can flow to workers who never opted into a custom color or who reset to default.

The current default appearance must remain pixel-equivalent when `accentColor === null`; runtime overrides must be removed rather than recreating the default palette approximately.

### Canonical format

Persist only canonical six-digit RGB HEX:

```text
#RRGGBB
```

Rules:

- leading `#` required after normalization;
- exactly six hexadecimal digits;
- canonical persisted value uppercase;
- alpha is not supported;
- three-digit shorthand may be accepted by UI parsing only if it is normalized to six-digit form before preview/persistence;
- invalid input must never reach persistence, IPC, HTTP, or SQL writes.

### Existing sync model

Keep the existing local-first worker-preference synchronization model and record-level version semantics. The system color is not a business event and must not enter the business-event outbox.

The preference service must expose intent-specific writes so a color save cannot overwrite menu layout from a stale UI snapshot and a menu-layout save cannot overwrite the worker color:

```ts
updateMenuLayout(input: {
  categoryOrder: readonly MenuCategoryId[];
  categoryAlignment: CategoryAlignment;
  productOrder: readonly ProductId[];
}): Promise<WorkerUiPreferences>

updateAccentColor(accentColor: SystemAccentColor | null): Promise<WorkerUiPreferences>
```

Both methods merge against the current local preference record before marking it dirty. Remote synchronization may continue to send the complete merged preference record using the repository's existing last-writer-wins record version model.

`Reset` in Menu Edit remains a menu-layout action only. `Reset to TUX default` in the color dialog changes only `accentColor`.

---

## 2. Appearance ownership

The existing profile-menu Appearance selector remains:

```text
System | Light | Dark
```

Its current `localStorage` ownership remains unchanged.

The effective rendering mode is:

- `light` when Appearance is explicitly Light;
- `dark` when Appearance is explicitly Dark;
- the current OS `prefers-color-scheme` result when Appearance is System.

When Appearance is System and the OS theme changes while TUX Operations is open, the worker accent palette must update immediately without reload.

Switching workers must load and apply the newly active worker's saved accent without reload. Signing out must remove any active worker custom accent so entry/sign-in screens cannot leak the previous worker's personalization.

---

## 3. Runtime accent-token model

The existing semantic CSS token system remains authoritative. Runtime theming may override only brand/accent variables on `document.documentElement`:

```text
--tux-accent
--tux-accent-hover
--tux-accent-pressed
--tux-accent-strong
--tux-accent-text
--tux-accent-soft
--tux-accent-hover-soft
--tux-focus-ring
--tux-action-foreground
```

Do not override surface, text, border, spacing, typography, radius, shadow, warning, destructive, or positive tokens.

If `accentColor === null`, remove all runtime accent overrides and let `@tux/ui/tokens.css` provide the exact current default Light/Dark values.

### Semantic colors that remain independent

The following must not inherit the user accent merely because the current default brand happens to be green:

- `--tux-positive`
- `--tux-positive-soft`
- `--tux-warning`
- `--tux-destructive`

Any component using a raw TUX brand-green literal for a brand/interaction state must be migrated to the semantic accent tokens. Any raw green that is genuinely semantic positive state must remain positive and must not be migrated to accent.

---

## 4. Palette derivation

Persist **one base color only**. Generate the effective Light or Dark palette at runtime.

Implement dependency-free RGB helpers with deterministic behavior:

```ts
interface RgbColor {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

interface SystemAccentPalette {
  readonly accent: string;
  readonly hover: string;
  readonly pressed: string;
  readonly strong: string;
  readonly text: string;
  readonly soft: string;
  readonly hoverSoft: string;
  readonly focusRing: string;
  readonly actionForeground: '#000000' | '#FFFFFF';
}
```

Required primitives:

- HEX <-> RGB conversion;
- sRGB relative luminance using the WCAG transfer function;
- contrast ratio `(L1 + 0.05) / (L2 + 0.05)`;
- deterministic sRGB blending toward black, white, or a surface color;
- binary-search or bounded iterative adjustment toward black/white until the required contrast threshold is met.

### Light palette

Use the worker's base hue as the starting point.

1. Ensure the primary accent has at least **3:1** contrast against the light panel/canvas surface by progressively blending toward black only when needed.
2. Choose `actionForeground` as black or white, whichever gives the higher contrast against the final primary accent; the chosen foreground must reach **4.5:1**.
3. Derive hover and pressed from the final accent by controlled darkening, with pressed stronger than hover.
4. Derive soft selected backgrounds by low-percentage blending of the final accent into the light panel surface.
5. Derive `accent-text` from the same hue family, adjusting toward black until it reaches at least **4.5:1** against the soft selected background.
6. Derive the focus ring from the same hue family and ensure at least **3:1** non-text contrast against the adjacent light surface.

### Dark palette

Do **not** reuse the raw base HEX unchanged.

1. Start from the same worker base hue.
2. Ensure the primary dark-mode accent has at least **3:1** contrast against the dark panel/canvas surface by progressively blending toward white only when needed. This is what makes a dark base such as `#1E3A8A` become a legible dark-mode blue companion rather than disappearing into the surface.
3. Choose `actionForeground` as black or white, whichever provides at least **4.5:1** against the final primary accent.
4. Derive hover as a controlled lighter companion and pressed as a controlled darker companion, preserving clear state separation.
5. Derive soft selected backgrounds using a higher accent contribution than Light mode while keeping them subordinate to filled actions.
6. Derive `accent-text` toward white as needed until it reaches at least **4.5:1** against the dark soft selected background.
7. Ensure the focus ring reaches at least **3:1** against the adjacent dark surface.

### Extreme inputs

The generator must remain usable for at least:

- near-black;
- near-white;
- saturated yellow;
- saturated red;
- saturated blue;
- saturated purple;
- the current TUX green.

Do not reject a valid RGB color merely because it is initially inaccessible. Normalize its generated Light/Dark companions instead.

---

## 5. Profile-menu UX

Keep the current Appearance selector in the operator profile menu. Add a second section immediately below it:

```text
System color
[ current swatch ] Choose system color
```

The current swatch reflects the saved worker base color, or the TUX default when the worker has no override.

Activating `Choose system color` closes the profile menu and opens a modal dialog titled:

```text
Choose system color
```

### Dialog controls

The dialog contains:

1. a clearly visible color preview/swatch;
2. native visual color input (`input[type=color]`);
3. HEX text input;
4. RGB numeric inputs: Red, Green, Blue, each constrained to `0..255`;
5. `Pick from screen` eyedropper action when the runtime exposes the EyeDropper API;
6. `Reset to TUX default`;
7. `Cancel`;
8. `Save`.

All color inputs represent one draft value and stay synchronized after every valid change.

### Input behavior

- Valid HEX immediately updates RGB, native picker, preview, and live theme preview.
- Valid RGB immediately updates HEX, native picker, preview, and live theme preview.
- Partial/invalid text editing may remain visible while the field has focus, but must not mutate the live theme until it parses successfully.
- Show concise inline validation for invalid HEX/RGB.
- The eyedropper result is normalized through the same parser; it is not a trusted bypass.
- If EyeDropper is unavailable, omit/disable only that action. HEX/RGB/native picker remain fully functional.

### Live preview transaction

Opening the dialog creates a draft from the worker's saved `accentColor`.

- Valid draft changes apply immediately to the entire Operations UI.
- `Cancel`, Escape, or modal dismissal restores the previously saved worker accent exactly and persists nothing.
- `Reset to TUX default` changes the draft to `null` and previews the exact default TUX palette; it does not persist until Save.
- `Save` persists only the accent preference.
- While Save is in flight, all color-mutating controls are disabled.
- If Save fails, keep the dialog open, keep the draft preview visible, show an inline error, and allow retry or Cancel.
- After successful Save, the dialog closes and the saved color remains active.

### Accessibility

- Modal is labelled by `Choose system color`.
- All inputs have programmatic labels.
- RGB inputs expose numeric constraints.
- Validation is connected with `aria-describedby`; save errors use an appropriate alert/live region.
- All interactive targets remain at least 44px effective size.
- Escape cancels and restores the saved theme when not saving.
- Focus enters the dialog on open, remains contained while the modal is active, and returns to the invoking control on close.
- The swatch is not the only communication of the current value; expose the canonical HEX text as accessible/visible value.

---

## 6. Worker switching and lifecycle

On active worker change:

1. cancel/close any color dialog owned by the previous worker;
2. load the new worker preference using the existing worker UI-preference client;
3. apply that worker's saved accent or the TUX default;
4. keep the device-local Appearance selection unchanged;
5. compute the palette for the current effective Light/Dark mode.

A slow response from the previous worker must not overwrite the theme after a later worker switch. Use cancellation/version guarding in the React effect.

On sign-out or transition away from an active worker, remove worker accent overrides immediately.

---

## 7. Local and remote data changes

### Domain

Extend `WorkerUiPreferences` with:

```ts
readonly accentColor: SystemAccentColor | null;
```

The parser treats missing/undefined `accentColor` as `null` for backward compatibility with existing IndexedDB records, SQLite rows serialized before the new column, older test fixtures, and remote rows during rollout.

### IndexedDB

The object store is schemaless. Store `accentColor` in new records. Existing records without it parse as `null`; no IndexedDB object-store/version migration is required solely for this field.

### SQLite

Add a local migration after version 7:

```sql
ALTER TABLE worker_ui_preferences ADD COLUMN accent_color TEXT;
```

The SQLite repository reads/writes the nullable canonical field.

### Supabase

Add a repository migration that:

- adds nullable `accent_color text` to `public.worker_ui_preferences`;
- constrains non-null values to canonical `#RRGGBB` form;
- replaces the current `put_worker_ui_preferences(uuid, uuid, jsonb, text, jsonb)` RPC with a signature that includes accent color;
- validates/normalizes the incoming accent;
- returns `accent_color` in the RPC result;
- preserves authorization, worker/shop validation, `server_version` increment behavior, and existing layout fields.

The migration belongs in the repository. Do not automatically apply it to the live Supabase project unless separately authorized.

### HTTP and Electron boundaries

Every boundary must parse/validate the field rather than trusting renderer input:

- browser client;
- Electron preload;
- Electron main IPC;
- remote worker-preference gateway;
- server/Vercel gateway;
- Supabase RPC.

---

## 8. CSS/token audit

The current app already routes the dominant brand states through accent variables. The implementation must audit all Operations CSS and source for raw literals matching the current TUX brand palette and classify each occurrence as either:

- legitimate token-definition/default value in `packages/ui/src/tokens.css`;
- semantic positive state that must remain independent;
- brand/interaction literal that must be replaced with a semantic accent token.

Add a regression test that prevents known current TUX brand literals from being introduced into app-specific style files where accent tokens should be used. The token-definition file itself is exempt.

---

## 9. Acceptance criteria

### Persistence and isolation

- Worker A can save a custom accent.
- Reloading restores Worker A's accent.
- Switching to Worker B applies B's own accent/default without changing A.
- Switching back to Worker A restores A.
- A menu-layout save preserves the worker accent.
- A color save preserves category order, alignment, and product order.
- Offline local save remains usable and later syncs under the existing preference retry mechanism.

### Appearance

For the same saved base color:

- Light renders an accessible Light companion palette.
- Dark renders an accessible Dark companion palette.
- System follows OS changes live.
- Appearance changes do not modify the persisted base color.

### Visual/interaction coverage

The user accent visibly and consistently affects brand/interaction states including:

- active top navigation;
- selected category/family controls;
- quantity increment controls and quantity badges;
- primary actions including Place Order;
- selected order type/payment controls;
- Menu Edit accent states;
- focus rings;
- other components already consuming TUX accent tokens.

Semantic success/warning/error states remain semantically colored.

### Color robustness matrix

Rendered QA must exercise at minimum these base colors in both Light and Dark:

```text
TUX default green
#1E3A8A
purple
red
yellow
near-black
near-white
```

For each, verify readable selected labels, primary-action foreground, focus visibility, soft selection contrast, and no accidental semantic-state recoloring.

### Responsive QA

Verify the profile menu and picker at existing Playwright desktop, tablet, and mobile projects. The dialog must remain usable without horizontal clipping at the smallest supported viewport.

---

## 10. Implementation boundaries

- Use TDD for domain parsing, palette math, persistence, IPC/HTTP validation, React transaction behavior, and rendered E2E flows.
- Do not implement a third-party color-picker dependency unless the native input plus custom HEX/RGB controls cannot satisfy this approved UX.
- Prefer focused files for color parsing/palette generation and the color dialog rather than expanding `App.tsx` with all color logic.
- Preserve the current theme token system and current default visual output.
- Do not merge implementation until the full TUX V2 CI, rendered QA, exact-diff review, and pre-merge review are green.
