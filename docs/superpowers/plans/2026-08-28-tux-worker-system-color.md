# TUX Worker System Color Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add one worker-specific, synced base system accent color with native picker, HEX, RGB, optional eyedropper, live preview, and automatically generated accessible Light/Dark palettes without changing semantic business-state colors.

**Architecture:** Extend the existing `WorkerUiPreferences` aggregate with one nullable canonical `accentColor`, keep Appearance device-local, and add intent-specific menu-layout vs accent writes so the two preferences cannot overwrite each other from stale UI snapshots. A focused runtime theme engine derives only the existing accent CSS variables from the worker's base color for the effective Light/Dark mode; `null` removes runtime overrides so the current TUX token palette stays exact.

**Tech Stack:** React 19, TypeScript 6, CSS custom properties, Vitest, Playwright, IndexedDB, Node SQLite, Electron IPC/preload, Vercel server gateway, Supabase PostgreSQL/RPC.

**Spec:** `docs/superpowers/specs/2026-08-28-tux-worker-system-color-design.md`

## Global Constraints

- System color is per worker and synced across devices.
- Existing `System | Light | Dark` Appearance remains device-local in `localStorage`.
- Persist only one nullable canonical `#RRGGBB` base color; never persist derived palette shades.
- `accentColor === null` must remove runtime overrides and preserve the exact current TUX Light/Dark token palette.
- Semantic positive, warning, and destructive colors remain independent from the worker accent.
- Color Save must not overwrite menu layout; menu-layout Save must not overwrite color.
- Valid extreme RGB colors are normalized into accessible companions rather than rejected for low contrast.
- Runtime color controls are native picker + HEX + RGB + EyeDropper when available; no third-party picker dependency.
- Supabase migration is committed to the repository but is not automatically applied to the live project without separate authorization.
- Use TDD for each behavior change and keep full rendered QA on desktop, tablet, and mobile.
- Do not merge until full CI, rendered QA, exact-diff review, and pre-merge review are green.

---

## File Structure

### Create

- `apps/operations/src/app/systemAccentTheme.ts` — HEX/RGB draft conversion, contrast math, Light/Dark palette derivation, root CSS-variable application/removal.
- `apps/operations/src/app/systemAccentTheme.test.ts` — palette math, contrast thresholds, extreme colors, and root override tests.
- `apps/operations/src/app/SystemColorPickerDialog.tsx` — modal draft transaction, native picker, HEX/RGB, progressive EyeDropper, Reset/Cancel/Save UI.
- `apps/operations/src/app/SystemColorPickerDialog.test.tsx` — static contract/accessibility tests for the dialog surface.
- `apps/operations/src/styles/system-color-picker.css` — profile-row and modal layout, 44px targets, responsive behavior.
- `apps/operations/src/styles/system-accent-token-contract.test.ts` — prevents app-specific CSS from hardcoding the current brand-green palette.
- `server/workerUiPreferencesAccentColorMigration.test.ts` — verifies the Supabase migration adds/validates/returns accent color without dropping existing preference fields.
- `supabase/migrations/20260828150000_worker_ui_preferences_accent_color.sql` — remote schema/RPC extension.

### Modify

- `packages/domain/src/workerUiPreferences.ts` — `SystemAccentColor`, parser/normalizer, nullable `accentColor` on preferences.
- `packages/domain/src/workerUiPreferences.test.ts` — domain compatibility and validation tests.
- `packages/domain/src/index.ts` — export the new accent type/parser if worker preference exports are explicit.
- `packages/application/src/workerUiPreferences.ts` — intent-specific update methods and remote sync field.
- `packages/application/src/workerUiPreferences.test.ts` — menu/color preservation and sync tests.
- `packages/persistence/src/browser/IndexedDbWorkerUiPreferencesStore.ts` — persist/read `accentColor`; tolerate older records.
- `packages/persistence/src/browser/indexedDbMigrations.test.ts` — prove older records without the field still load as default.
- `packages/persistence/src/sqlite/migrations.ts` — local migration version 8 adding `accent_color`.
- `packages/persistence/src/sqlite/SqliteWorkerUiPreferencesStore.ts` — nullable accent read/write.
- `packages/persistence/src/sqlite/SqliteOperationsDatabase.test.ts` — version-7 -> version-8 migration/round-trip coverage.
- `packages/platform-contracts/index.d.ts` — replace generic worker-preference write with explicit menu-layout and accent operations.
- `apps/operations/src/app/sessionClient.ts` — browser runtime implementations and exported preference client wrapper.
- `apps/operations/src/app/browserRemote.ts` — remote preference parsing/PUT payload includes accent.
- `apps/operations/src/app/workerUiPreferenceEditing.ts` — expose the menu-layout payload only; no accent field copied from UI state.
- `apps/operations/src/app/workerUiPreferenceEditing.test.ts` — menu payload remains layout-only.
- `apps/operations/src/app/OrdersWorkspace.tsx` — call `updateMenuLayout`, leaving color untouched.
- `apps/operations/src/app/unifiedMenuEditMode.source.test.ts` — update single-save contract to the explicit menu-layout method.
- `apps/operations/src/app/App.tsx` — worker accent lifecycle, profile entry, dialog integration, System-theme media response, sign-out reset.
- `apps/operations/src/main.tsx` — import the new picker stylesheet.
- `apps/operations/src/styles/premium.css` — style System color row only if shared profile styling belongs here; no raw accent literals.
- `apps/operations/src/styles/final-pos-corrections.css` — only replace any audited brand-green bypasses; do not change unrelated visual locks.
- `apps/operations-desktop/src/main/workerUiPreferencesIpc.ts` — separate validated menu-layout/accent IPC actions.
- `apps/operations-desktop/src/main/workerUiPreferencesIpc.test.ts` — IPC validation and field-preservation tests.
- `apps/operations-desktop/src/main/workerUiPreferencesRemote.test.ts` — remote sync includes accent.
- `apps/operations-desktop/src/preload/index.ts` — expose/parse the new explicit preference API.
- `server/workerUiPreferencesGateway.ts` — request/response validation, REST select, RPC argument.
- `server/workerUiPreferencesGateway.test.ts` — GET/PUT accent validation and compatibility.
- `e2e/operations.e2e.ts` — live preview, Cancel/Save, reload, worker isolation, Light/Dark/System, responsive checks.

---

### Task 1: Add the canonical worker accent to the domain model

**Files:**
- Modify: `packages/domain/src/workerUiPreferences.ts`
- Modify: `packages/domain/src/workerUiPreferences.test.ts`
- Modify if needed: `packages/domain/src/index.ts`

**Interfaces:**
- Produces: `SystemAccentColor`, `parseSystemAccentColor(value: unknown): SystemAccentColor`, `WorkerUiPreferences.accentColor: SystemAccentColor | null`.
- Backward compatibility: missing/undefined/null `accentColor` parses as `null`.

- [ ] **Step 1: Write failing domain tests**

Add cases equivalent to:

```ts
it('normalizes valid worker accent colors and defaults missing legacy values to null', () => {
  expect(parseSystemAccentColor('#1e3a8a')).toBe('#1E3A8A');
  expect(parseWorkerUiPreferences({ ...validPreference, accentColor: undefined }).accentColor).toBeNull();
  expect(parseWorkerUiPreferences({ ...validPreference, accentColor: '#1e3a8a' }).accentColor).toBe('#1E3A8A');
});

it.each(['#12345', '#1234567', '1E3A8A', '#GG0000', '', 42])(
  'rejects invalid persisted accent %p',
  (value) => expect(() => parseSystemAccentColor(value)).toThrow(TypeError),
);
```

- [ ] **Step 2: Run the targeted test and verify RED**

Run:

```bash
npx vitest run packages/domain/src/workerUiPreferences.test.ts
```

Expected: FAIL because `parseSystemAccentColor`/`accentColor` do not exist.

- [ ] **Step 3: Implement canonical parsing**

Add a branded/template-compatible type and parser with case-insensitive six-digit input and uppercase output:

```ts
export type SystemAccentColor = `#${string}`;

export function parseSystemAccentColor(value: unknown): SystemAccentColor {
  if (typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value)) {
    throw new TypeError('WorkerUiPreferences.accentColor must be a six-digit HEX color.');
  }
  return value.toUpperCase() as SystemAccentColor;
}
```

Extend `WorkerUiPreferences` and `parseWorkerUiPreferences`:

```ts
readonly accentColor: SystemAccentColor | null;

accentColor:
  preferences['accentColor'] === undefined || preferences['accentColor'] === null
    ? null
    : parseSystemAccentColor(preferences['accentColor']),
```

- [ ] **Step 4: Run domain tests GREEN**

```bash
npx vitest run packages/domain/src/workerUiPreferences.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run domain typecheck**

```bash
npm run typecheck -w @tux/domain
```

Expected: existing preference fixtures elsewhere now report missing `accentColor`; do not paper over them with casts. Update fixtures in later tasks as their owning files are touched, using `accentColor: null`.

- [ ] **Step 6: Commit**

```bash
git add packages/domain/src/workerUiPreferences.ts packages/domain/src/workerUiPreferences.test.ts packages/domain/src/index.ts
git commit -m "feat: add worker system accent preference"
```

---

### Task 2: Split worker preference mutations by intent

**Files:**
- Modify: `packages/application/src/workerUiPreferences.ts`
- Modify: `packages/application/src/workerUiPreferences.test.ts`

**Interfaces:**
- Consumes: `SystemAccentColor` from Task 1.
- Produces:

```ts
updateMenuLayout(shopId, workerId, input): Promise<WorkerUiPreferences>
updateAccentColor(shopId, workerId, accentColor): Promise<WorkerUiPreferences>
```

- Remote gateway complete record includes `accentColor`.

- [ ] **Step 1: Write RED tests for non-destructive field merging**

Add tests proving both directions:

```ts
it('changes accent without overwriting menu layout', async () => {
  repository.value = existingPreference({
    categoryOrder: [categoryA],
    categoryAlignment: 'right',
    productOrder: [productA],
    accentColor: null,
  });

  const saved = await service.updateAccentColor(shopId, workerId, parseSystemAccentColor('#1E3A8A'));

  expect(saved.categoryOrder).toEqual([categoryA]);
  expect(saved.categoryAlignment).toBe('right');
  expect(saved.productOrder).toEqual([productA]);
  expect(saved.accentColor).toBe('#1E3A8A');
});

it('changes menu layout without overwriting accent', async () => {
  repository.value = existingPreference({ accentColor: parseSystemAccentColor('#1E3A8A') });
  const saved = await service.updateMenuLayout(shopId, workerId, {
    categoryOrder: [categoryB],
    categoryAlignment: 'center',
    productOrder: [productB],
  });
  expect(saved.accentColor).toBe('#1E3A8A');
});
```

Also test color-only creation when no local record: default layout fields are `[]`, `'left'`, `[]`.

- [ ] **Step 2: Run targeted application test RED**

```bash
npx vitest run packages/application/src/workerUiPreferences.test.ts
```

- [ ] **Step 3: Replace the generic `update` implementation with merge helpers**

Use one private/current-base helper:

```ts
const current = await this.#repository.get(shopId, workerId);
const base = current ?? parseWorkerUiPreferences({
  shopId,
  workerId,
  categoryOrder: [],
  categoryAlignment: 'left',
  productOrder: [],
  accentColor: null,
  updatedAt: this.#now(),
  serverVersion: 0,
  syncState: 'CLEAN',
});
```

`updateMenuLayout` replaces only the three layout fields. `updateAccentColor` replaces only `accentColor`. Both set fresh `updatedAt`, retain `serverVersion`, and set `syncState: 'DIRTY'`.

Extend `RemoteWorkerUiPreferences` and `putWorkerUiPreferences` input with:

```ts
readonly accentColor: SystemAccentColor | null;
```

Ensure `syncOnce` sends the complete local record including accent and materializes the returned accent.

- [ ] **Step 4: Run application tests GREEN**

```bash
npx vitest run packages/application/src/workerUiPreferences.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add packages/application/src/workerUiPreferences.ts packages/application/src/workerUiPreferences.test.ts
git commit -m "refactor: separate worker preference mutations"
```

---

### Task 3: Persist accent locally without breaking legacy records

**Files:**
- Modify: `packages/persistence/src/browser/IndexedDbWorkerUiPreferencesStore.ts`
- Modify: `packages/persistence/src/browser/indexedDbMigrations.test.ts`
- Modify: `packages/persistence/src/sqlite/migrations.ts`
- Modify: `packages/persistence/src/sqlite/SqliteWorkerUiPreferencesStore.ts`
- Modify: `packages/persistence/src/sqlite/SqliteOperationsDatabase.test.ts`

**Interfaces:**
- IndexedDB stored record gains nullable `accentColor` but no database version/object-store bump.
- SQLite schema gains nullable `accent_color` at migration version 8.

- [ ] **Step 1: Write legacy IndexedDB and SQLite RED tests**

For IndexedDB, insert an old worker preference object with no `accentColor`, then assert loading returns `accentColor: null`.

For SQLite, construct a database at migrations 1..7, insert a worker preference, apply migration 8, then assert:

```ts
expect(columns).toContain('accent_color');
expect(await repository.get(shopId, workerId)).toMatchObject({ accentColor: null });
```

Round-trip a custom color and assert `#1E3A8A` returns exactly.

- [ ] **Step 2: Run targeted persistence tests RED**

```bash
npx vitest run packages/persistence/src/browser/indexedDbMigrations.test.ts packages/persistence/src/sqlite/SqliteOperationsDatabase.test.ts
```

- [ ] **Step 3: Extend IndexedDB stored shape**

Add:

```ts
readonly accentColor: string | null;
```

and persist:

```ts
accentColor: preferences.accentColor,
```

Do not increment IndexedDB schema version just for the new object property.

- [ ] **Step 4: Add SQLite migration 8**

Append:

```ts
{
  version: 8,
  name: 'worker_ui_accent_color',
  sql: `
ALTER TABLE worker_ui_preferences
ADD COLUMN accent_color TEXT;
`,
},
```

Update SELECT/INSERT/UPSERT and parser mapping so `accent_color` is nullable and passed as `accentColor`.

- [ ] **Step 5: Run targeted persistence tests GREEN**

```bash
npx vitest run packages/persistence/src/browser/indexedDbMigrations.test.ts packages/persistence/src/sqlite/SqliteOperationsDatabase.test.ts
```

- [ ] **Step 6: Run migration-chain smoke**

```bash
npm run test:migrations
```

Expected: PASS through SQLite migration 8 and existing Supabase migration chain.

- [ ] **Step 7: Commit**

```bash
git add packages/persistence/src/browser/IndexedDbWorkerUiPreferencesStore.ts packages/persistence/src/browser/indexedDbMigrations.test.ts packages/persistence/src/sqlite/migrations.ts packages/persistence/src/sqlite/SqliteWorkerUiPreferencesStore.ts packages/persistence/src/sqlite/SqliteOperationsDatabase.test.ts
git commit -m "feat: persist worker accent locally"
```

---

### Task 4: Extend Supabase and server worker-preference contracts

**Files:**
- Create: `supabase/migrations/20260828150000_worker_ui_preferences_accent_color.sql`
- Create: `server/workerUiPreferencesAccentColorMigration.test.ts`
- Modify: `server/workerUiPreferencesGateway.ts`
- Modify: `server/workerUiPreferencesGateway.test.ts`

**Interfaces:**
- Remote row/RPC adds nullable `accent_color`.
- New RPC signature:

```sql
public.put_worker_ui_preferences(uuid, uuid, jsonb, text, jsonb, text)
```

- [ ] **Step 1: Write migration RED test**

Read the migration as text and assert it contains all of:

```ts
expect(sql).toContain('add column if not exists accent_color text');
expect(sql).toContain("accent_color ~ '^#[0-9A-F]{6}$'");
expect(sql).toContain('p_accent_color text');
expect(sql).toContain('product_order');
expect(sql).toContain('server_version = preferences.server_version + 1');
```

Also assert the previous five-argument RPC is dropped before the six-argument function is created.

- [ ] **Step 2: Run migration test RED**

```bash
npx vitest run server/workerUiPreferencesAccentColorMigration.test.ts
```

- [ ] **Step 3: Create additive Supabase migration**

The migration must use this shape:

```sql
alter table public.worker_ui_preferences
  add column if not exists accent_color text;

alter table public.worker_ui_preferences
  drop constraint if exists worker_ui_preferences_accent_color_check;

alter table public.worker_ui_preferences
  add constraint worker_ui_preferences_accent_color_check
  check (accent_color is null or accent_color ~ '^#[0-9A-F]{6}$');

drop function if exists public.put_worker_ui_preferences(uuid, uuid, jsonb, text, jsonb);
```

Recreate the RPC with `p_accent_color text`, reject non-null non-canonical values with `TUX_WORKER_UI_PREFERENCES_ACCENT_INVALID`, insert/update `accent_color`, and return it alongside all existing fields. Preserve current device authorization and worker/shop validation exactly.

- [ ] **Step 4: Write server gateway RED tests**

Add PUT cases:

```ts
expect(rpcBody.p_accent_color).toBe('#1E3A8A');
```

and reject malformed `accentColor` before upstream fetch. Add GET parsing for `accent_color: null` and `accent_color: '#1E3A8A'`.

- [ ] **Step 5: Extend `server/workerUiPreferencesGateway.ts`**

Add domain-equivalent canonical validation at the server boundary:

```ts
const ACCENT_PATTERN = /^#[0-9A-F]{6}$/;
```

Include `accent_color` in REST `select`, RPC body, remote-row parsing, and JSON response.

- [ ] **Step 6: Run server tests GREEN**

```bash
npx vitest run server/workerUiPreferencesGateway.test.ts server/workerUiPreferencesAccentColorMigration.test.ts
```

- [ ] **Step 7: Run migration-chain smoke again**

```bash
npm run test:migrations
```

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/20260828150000_worker_ui_preferences_accent_color.sql server/workerUiPreferencesAccentColorMigration.test.ts server/workerUiPreferencesGateway.ts server/workerUiPreferencesGateway.test.ts
git commit -m "feat: sync worker accent remotely"
```

---

### Task 5: Carry explicit preference mutations through browser and Electron boundaries

**Files:**
- Modify: `packages/platform-contracts/index.d.ts`
- Modify: `apps/operations/src/app/sessionClient.ts`
- Modify: `apps/operations/src/app/browserRemote.ts`
- Modify: `apps/operations-desktop/src/main/workerUiPreferencesIpc.ts`
- Modify: `apps/operations-desktop/src/main/workerUiPreferencesIpc.test.ts`
- Modify: `apps/operations-desktop/src/main/workerUiPreferencesRemote.test.ts`
- Modify: `apps/operations-desktop/src/preload/index.ts`
- Modify: existing fixtures that construct `WorkerUiPreferences` in touched tests, adding `accentColor: null`.

**Interfaces:**

Replace the generic platform write/reset surface with:

```ts
export interface TuxWorkerUiPreferencesApi {
  load(): Promise<WorkerUiPreferences | null>;
  updateMenuLayout(input: {
    readonly categoryOrder: readonly MenuCategoryId[];
    readonly categoryAlignment: CategoryAlignment;
    readonly productOrder: readonly ProductId[];
  }): Promise<WorkerUiPreferences>;
  updateAccentColor(accentColor: SystemAccentColor | null): Promise<WorkerUiPreferences>;
  resetMenuLayout(): Promise<void>;
}
```

- [ ] **Step 1: Change platform contract first and run typecheck RED**

```bash
npm run typecheck
```

Expected: browser runtime, preload, IPC, Orders callers fail on removed `update/reset` methods.

- [ ] **Step 2: Update browser runtime implementation**

Map methods directly to Task 2 service methods:

```ts
updateMenuLayout: async (input) => preferencesService.updateMenuLayout(identity.shopId, identity.workerId, input),
updateAccentColor: async (accentColor) => preferencesService.updateAccentColor(identity.shopId, identity.workerId, accentColor),
resetMenuLayout: async () => preferencesService.updateMenuLayout(identity.shopId, identity.workerId, {
  categoryOrder: [],
  categoryAlignment: 'left',
  productOrder: [],
}),
```

Each successful local mutation triggers the existing preference retry.

Extend `parseRemoteWorkerUiPreferences` and PUT input in `browserRemote.ts` with `accentColor`.

- [ ] **Step 3: Write Electron IPC RED tests**

Test separate menu/accent inputs and malformed accent rejection. The accent IPC accepts only `null` or a canonical parsed accent; it never accepts arbitrary renderer strings.

- [ ] **Step 4: Implement explicit IPC channels and preload methods**

Use channels such as:

```ts
const IPC_WORKER_UI_PREFERENCES_UPDATE_MENU_LAYOUT = 'tux:worker-ui-preferences:update-menu-layout';
const IPC_WORKER_UI_PREFERENCES_UPDATE_ACCENT = 'tux:worker-ui-preferences:update-accent';
const IPC_WORKER_UI_PREFERENCES_RESET_MENU_LAYOUT = 'tux:worker-ui-preferences:reset-menu-layout';
```

The main process calls the matching service method after `assertTrustedIpcSender`. Preload parses returned preferences with `parseWorkerUiPreferences`.

- [ ] **Step 5: Run targeted desktop tests GREEN**

```bash
npx vitest run apps/operations-desktop/src/main/workerUiPreferencesIpc.test.ts apps/operations-desktop/src/main/workerUiPreferencesRemote.test.ts
```

- [ ] **Step 6: Run full typecheck GREEN**

```bash
npm run typecheck
```

- [ ] **Step 7: Commit**

```bash
git add packages/platform-contracts/index.d.ts apps/operations/src/app/sessionClient.ts apps/operations/src/app/browserRemote.ts apps/operations-desktop/src/main/workerUiPreferencesIpc.ts apps/operations-desktop/src/main/workerUiPreferencesIpc.test.ts apps/operations-desktop/src/main/workerUiPreferencesRemote.test.ts apps/operations-desktop/src/preload/index.ts
git commit -m "refactor: expose explicit worker preference APIs"
```

---

### Task 6: Keep Menu Edit layout-only

**Files:**
- Modify: `apps/operations/src/app/workerUiPreferenceEditing.ts`
- Modify: `apps/operations/src/app/workerUiPreferenceEditing.test.ts`
- Modify: `apps/operations/src/app/OrdersWorkspace.tsx`
- Modify: `apps/operations/src/app/unifiedMenuEditMode.source.test.ts`

**Interfaces:**
- Menu Edit consumes `updateMenuLayout` only.
- Menu helper returns only category/product/alignment fields.

- [ ] **Step 1: Update source/unit tests RED**

Require exactly one Menu Edit persistence call to:

```ts
preferencesClient.updateMenuLayout(...)
```

and explicitly assert the menu payload type has no `accentColor` field.

- [ ] **Step 2: Run targeted tests RED**

```bash
npx vitest run apps/operations/src/app/workerUiPreferenceEditing.test.ts apps/operations/src/app/unifiedMenuEditMode.source.test.ts
```

- [ ] **Step 3: Rename the menu payload interface and call site**

Use:

```ts
export interface WorkerMenuLayoutUpdateInput {
  readonly categoryOrder: readonly MenuCategoryId[];
  readonly categoryAlignment: CategoryAlignment;
  readonly productOrder: readonly ProductId[];
}
```

`saveMenuEdit()` calls `preferencesClient.updateMenuLayout(menuEditPreferenceInput(...))`. Do not read/copy the accent in the component.

- [ ] **Step 4: Run tests GREEN**

```bash
npx vitest run apps/operations/src/app/workerUiPreferenceEditing.test.ts apps/operations/src/app/unifiedMenuEditMode.source.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add apps/operations/src/app/workerUiPreferenceEditing.ts apps/operations/src/app/workerUiPreferenceEditing.test.ts apps/operations/src/app/OrdersWorkspace.tsx apps/operations/src/app/unifiedMenuEditMode.source.test.ts
git commit -m "refactor: keep menu edit layout scoped"
```

---

### Task 7: Build the accessible Light/Dark palette engine

**Files:**
- Create: `apps/operations/src/app/systemAccentTheme.ts`
- Create: `apps/operations/src/app/systemAccentTheme.test.ts`

**Interfaces:**
- Consumes: `SystemAccentColor`.
- Produces:

```ts
export type EffectiveTheme = 'light' | 'dark';
export interface RgbColor { readonly r: number; readonly g: number; readonly b: number }
export interface SystemAccentPalette { /* exact fields from the spec */ }
export function parseHexDraft(value: string): SystemAccentColor | null;
export function rgbToSystemAccentColor(rgb: RgbColor): SystemAccentColor;
export function systemAccentColorToRgb(color: SystemAccentColor): RgbColor;
export function contrastRatio(a: RgbColor, b: RgbColor): number;
export function deriveSystemAccentPalette(color: SystemAccentColor, theme: EffectiveTheme): SystemAccentPalette;
export function applySystemAccentPalette(root: HTMLElement, palette: SystemAccentPalette): void;
export function clearSystemAccentPalette(root: HTMLElement): void;
```

- [ ] **Step 1: Write RED conversion and contrast tests**

Cover:

```ts
expect(parseHexDraft('#1e3a8a')).toBe('#1E3A8A');
expect(parseHexDraft('#123')).toBe('#112233');
expect(parseHexDraft('#12')).toBeNull();
expect(systemAccentColorToRgb(parseSystemAccentColor('#1E3A8A'))).toEqual({ r: 30, g: 58, b: 138 });
expect(rgbToSystemAccentColor({ r: 30, g: 58, b: 138 })).toBe('#1E3A8A');
expect(contrastRatio({ r: 0, g: 0, b: 0 }, { r: 255, g: 255, b: 255 })).toBeCloseTo(21, 2);
```

- [ ] **Step 2: Write RED palette matrix tests**

Use bases:

```ts
['#1F6B52', '#1E3A8A', '#7E22CE', '#DC2626', '#FACC15', '#050505', '#FAFAFA']
```

For both modes, assert:

- action foreground contrast >= 4.5;
- accent/focus non-text contrast against mode panel >= 3;
- accent text contrast against derived soft >= 4.5;
- dark `#1E3A8A` effective accent is not the unchanged raw `#1E3A8A`.

- [ ] **Step 3: Run palette tests RED**

```bash
npx vitest run apps/operations/src/app/systemAccentTheme.test.ts
```

- [ ] **Step 4: Implement deterministic dependency-free math**

Use WCAG sRGB conversion:

```ts
function linearChannel(channel: number): number {
  const value = channel / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance({ r, g, b }: RgbColor): number {
  return 0.2126 * linearChannel(r) + 0.7152 * linearChannel(g) + 0.0722 * linearChannel(b);
}
```

Use bounded binary search for `ensureSurfaceContrast(candidate, surface, target, direction)` where direction is black for Light and white for Dark. Use deterministic sRGB blend percentages for hover/pressed/soft states, then independently enforce text/focus thresholds.

Use the current surfaces as palette QA references:

```ts
const LIGHT_PANEL = { r: 255, g: 255, b: 255 };
const DARK_PANEL = { r: 20, g: 24, b: 22 };
```

- [ ] **Step 5: Implement root token application**

Set only:

```ts
const TOKEN_MAP = {
  '--tux-accent': palette.accent,
  '--tux-accent-hover': palette.hover,
  '--tux-accent-pressed': palette.pressed,
  '--tux-accent-strong': palette.strong,
  '--tux-accent-text': palette.text,
  '--tux-accent-soft': palette.soft,
  '--tux-accent-hover-soft': palette.hoverSoft,
  '--tux-focus-ring': palette.focusRing,
  '--tux-action-foreground': palette.actionForeground,
};
```

`clearSystemAccentPalette` removes exactly those inline custom properties.

- [ ] **Step 6: Run palette tests GREEN**

```bash
npx vitest run apps/operations/src/app/systemAccentTheme.test.ts
```

- [ ] **Step 7: Commit**

```bash
git add apps/operations/src/app/systemAccentTheme.ts apps/operations/src/app/systemAccentTheme.test.ts
git commit -m "feat: derive accessible system accent palettes"
```

---

### Task 8: Build the color-picker dialog as a draft transaction

**Files:**
- Create: `apps/operations/src/app/SystemColorPickerDialog.tsx`
- Create: `apps/operations/src/app/SystemColorPickerDialog.test.tsx`
- Create: `apps/operations/src/styles/system-color-picker.css`
- Modify: `apps/operations/src/main.tsx`

**Interfaces:**

```ts
interface SystemColorPickerDialogProps {
  readonly savedAccentColor: SystemAccentColor | null;
  readonly defaultPreviewColor: SystemAccentColor;
  readonly saving: boolean;
  readonly saveError: string | null;
  readonly onPreview: (accentColor: SystemAccentColor | null) => void;
  readonly onSave: (accentColor: SystemAccentColor | null) => Promise<void>;
  readonly onCancel: () => void;
}
```

- [ ] **Step 1: Write RED static contract tests**

With `renderToStaticMarkup`, assert labels/copy for:

```text
Choose system color
HEX
Red
Green
Blue
Reset to TUX default
Cancel
Save
```

Assert `input type="color"`, dialog labelling, numeric min/max, and visible canonical HEX value. Make EyeDropper rendering injectable/deterministic in tests rather than depending on the Node environment.

- [ ] **Step 2: Run dialog test RED**

```bash
npx vitest run apps/operations/src/app/SystemColorPickerDialog.test.tsx
```

- [ ] **Step 3: Implement synchronized draft state**

Rules in code:

- initialize from `savedAccentColor` or default preview color;
- HEX parser accepts 3/6 digit draft input but calls `onPreview` only when valid;
- RGB accepts only integer `0..255` values before updating preview;
- native picker writes canonical six-digit HEX;
- `Reset to TUX default` sets draft persistence value to `null` and calls `onPreview(null)`;
- EyeDropper uses feature detection:

```ts
if ('EyeDropper' in window) {
  const result = await new window.EyeDropper().open();
  const picked = parseHexDraft(result.sRGBHex);
  if (picked !== null) applyDraft(picked);
}
```

Add a narrow local TypeScript declaration only if Electron/DOM typings do not already include EyeDropper.

- [ ] **Step 4: Implement modal accessibility**

On open focus the HEX input. Trap Tab/Shift+Tab within the modal. Escape calls `onCancel` only when `saving === false`. Disable all mutating inputs/buttons while saving. Keep save error inline with `role="alert"`.

- [ ] **Step 5: Implement responsive styling**

Use existing surfaces/tokens only. Keep 44px minimum controls, RGB fields in a three-column row on wide dialog and stack/fit them without horizontal overflow at mobile width.

- [ ] **Step 6: Import stylesheet and run tests GREEN**

```bash
npx vitest run apps/operations/src/app/SystemColorPickerDialog.test.tsx
npm run typecheck -w @tux/operations
```

- [ ] **Step 7: Commit**

```bash
git add apps/operations/src/app/SystemColorPickerDialog.tsx apps/operations/src/app/SystemColorPickerDialog.test.tsx apps/operations/src/styles/system-color-picker.css apps/operations/src/main.tsx
git commit -m "feat: add system color picker dialog"
```

---

### Task 9: Integrate worker accent lifecycle into the Operations shell

**Files:**
- Modify: `apps/operations/src/app/App.tsx`
- Modify: `apps/operations/src/app/sessionClient.ts` only if the shell needs a stable exported preference client already not exposed after Task 5.
- Modify: `apps/operations/src/styles/premium.css` only for profile-row presentation.

**Interfaces:**
- Consumes: `createWorkerUiPreferencesClient`, `derive/apply/clearSystemAccentPalette`, `SystemColorPickerDialog`.
- Appearance remains current local `theme` state.

- [ ] **Step 1: Add a source-level RED test or E2E-first assertion for worker color entry**

If a focused App source test is introduced, require:

```text
System color
Choose system color
```

and require `createWorkerUiPreferencesClient` in the shell. Otherwise add the first Playwright assertion from Task 11 now and observe RED.

- [ ] **Step 2: Load worker preference guarded by worker identity**

Create the preferences client once with `useMemo`. On `session.operator.id` change:

```ts
let cancelled = false;
setSavedAccentColor(null);
clearSystemAccentPalette(document.documentElement);
void preferencesClient.load().then((preference) => {
  if (cancelled) return;
  setSavedAccentColor(preference?.accentColor ?? null);
});
return () => { cancelled = true; };
```

This guard prevents a slow previous-worker response from repainting a later worker.

- [ ] **Step 3: Resolve effective Light/Dark mode live**

For explicit Light/Dark use the selected Appearance. For System subscribe to:

```ts
window.matchMedia('(prefers-color-scheme: dark)')
```

and update effective mode on `change`. When saved/draft accent or effective mode changes:

- custom accent -> derive/apply palette;
- null -> clear inline overrides.

- [ ] **Step 4: Add profile System color row**

Immediately below Appearance render current swatch + canonical base/default HEX and a `Choose system color` button. Close the operator menu before opening the dialog.

- [ ] **Step 5: Implement live preview transaction**

Maintain:

```ts
const [savedAccentColor, setSavedAccentColor] = useState<SystemAccentColor | null>(null);
const [previewAccentColor, setPreviewAccentColor] = useState<SystemAccentColor | null>(null);
```

Opening copies saved -> preview. `onPreview` changes preview only. Cancel closes and restores preview to saved. Save calls only:

```ts
await preferencesClient.updateAccentColor(draft);
```

then updates saved/preview from the returned record. Failure keeps the dialog open and draft active.

- [ ] **Step 6: Clear personalization on sign-out/non-active state**

Before/when ActiveShell unmounts, remove inline accent variables so the entry/sign-in screen never displays the previous worker's custom accent.

- [ ] **Step 7: Run targeted type/unit checks**

```bash
npm run typecheck -w @tux/operations
npx vitest run apps/operations/src/app/systemAccentTheme.test.ts apps/operations/src/app/SystemColorPickerDialog.test.tsx
```

- [ ] **Step 8: Commit**

```bash
git add apps/operations/src/app/App.tsx apps/operations/src/styles/premium.css apps/operations/src/app/sessionClient.ts
git commit -m "feat: apply worker system color in operations shell"
```

---

### Task 10: Audit brand-green bypasses and enforce the token boundary

**Files:**
- Create: `apps/operations/src/styles/system-accent-token-contract.test.ts`
- Modify only if audit finds real bypasses: app-specific CSS under `apps/operations/src/styles/`

**Interfaces:**
- No runtime API change.

- [ ] **Step 1: Write the brand-literal regression test**

Read app-specific CSS files and reject these current brand literals case-insensitively:

```ts
const forbiddenBrandLiterals = [
  '#1f6b52', '#195f48', '#14533f', '#eaf4ef', '#f3f8f5',
  '#5fae8a', '#6dba98', '#4f9b7a', '#173429',
];
```

Do not scan `packages/ui/src/tokens.css`; that file is the legitimate default-token authority.

- [ ] **Step 2: Run RED/inspection**

```bash
npx vitest run apps/operations/src/styles/system-accent-token-contract.test.ts
```

If it fails, inspect each occurrence. Replace only brand/interaction literals with the existing semantic accent tokens. If an occurrence is semantic positive state, use the positive token instead of accent.

- [ ] **Step 3: Run style contract GREEN**

```bash
npx vitest run apps/operations/src/styles/system-accent-token-contract.test.ts
```

- [ ] **Step 4: Commit**

```bash
git add apps/operations/src/styles/system-accent-token-contract.test.ts apps/operations/src/styles/*.css
git commit -m "test: enforce runtime accent token boundary"
```

Before committing, use `git diff --cached --name-only` to ensure unrelated CSS files were not staged.

---

### Task 11: Add rendered worker-isolation and Light/Dark E2E coverage

**Files:**
- Modify: `e2e/operations.e2e.ts`

**Interfaces:**
- Exercises the feature only through visible UI and existing test bootstrap/session fixtures.

- [ ] **Step 1: Add desktop live-preview/Cancel RED test**

Flow:

1. sign in as fixture Worker A;
2. open profile -> `Choose system color`;
3. enter `#1E3A8A` in HEX;
4. assert `getComputedStyle(document.documentElement).getPropertyValue('--tux-accent')` changes from the saved/default value;
5. assert selected navigation/category and Place Order use the new accent family;
6. click Cancel;
7. assert computed accent returns exactly to the pre-dialog value.

Run:

```bash
npx playwright test e2e/operations.e2e.ts --project=desktop-browser-fallback --grep "worker system color"
```

Expected: FAIL before integration is complete.

- [ ] **Step 2: Add Save/reload and menu-preservation test**

Arrange a non-default menu layout first, save it, then save `#1E3A8A` from the color dialog. Reload and assert both the color and layout remain. This is the rendered guard against cross-field overwrite.

- [ ] **Step 3: Add worker-isolation test**

Using the existing multi-worker fixture/PIN flow:

- Worker A saves blue;
- switch to Worker B and assert B gets its own default or saved value;
- switch back to A and assert blue returns.

Also assert the device Appearance selection did not change during worker switches.

- [ ] **Step 4: Add Light/Dark/System test**

For Worker A base `#1E3A8A`:

- Light -> record effective accent;
- Dark -> assert effective accent changes and is not raw `#1E3A8A`;
- inspect action foreground/background computed colors and use the same contrast helper logic in the test to assert >= 4.5;
- System -> emulate `prefers-color-scheme: dark`/light with Playwright media and verify palette flips without reload.

- [ ] **Step 5: Add extreme-color matrix at unit level plus representative rendered colors**

Do not create seven full screenshot permutations. Keep exhaustive contrast in Task 7 unit tests and render representative blue + yellow + near-black/near-white states to catch CSS integration defects.

- [ ] **Step 6: Run targeted desktop E2E GREEN**

```bash
npx playwright test e2e/operations.e2e.ts --project=desktop-browser-fallback --grep "worker system color"
```

- [ ] **Step 7: Run the same feature on tablet/mobile projects**

```bash
npx playwright test e2e/operations.e2e.ts --project=tablet-browser-fallback --grep "worker system color"
npx playwright test e2e/operations.e2e.ts --project=mobile-browser-fallback --grep "worker system color"
```

Verify no picker clipping/overflow and all controls remain usable.

- [ ] **Step 8: Capture approval evidence using the existing screenshot helper**

Capture at least:

```text
system-color-light-blue-desktop.png
system-color-dark-blue-desktop.png
system-color-picker-mobile.png
```

Do not add a new screenshot infrastructure; use the repository's existing evidence path/helper.

- [ ] **Step 9: Commit**

```bash
git add e2e/operations.e2e.ts
git commit -m "test: cover worker system color rendering"
```

---

### Task 12: Full verification, documentation review, and pre-merge gate

**Files:**
- Review all changed files.
- Modify docs only if implementation discovered a factual mismatch with this spec/plan; do not silently change approved behavior.

- [ ] **Step 1: Run formatting**

```bash
npm run format
npm run format:check
```

Expected: PASS.

- [ ] **Step 2: Run lint**

```bash
npm run lint
```

Expected: PASS with zero warnings.

- [ ] **Step 3: Run full unit/integration suite**

```bash
npm test
```

Expected: PASS.

- [ ] **Step 4: Run full typecheck**

```bash
npm run typecheck
```

Expected: PASS across workspaces, API, and E2E.

- [ ] **Step 5: Run production builds**

```bash
npm run build
```

Expected: PASS.

- [ ] **Step 6: Run migration-chain smoke**

```bash
npm run test:migrations
```

Expected: PASS including SQLite version 8 and the new Supabase migration text/chain.

- [ ] **Step 7: Run full rendered E2E**

```bash
npm run test:e2e
```

Expected: PASS on configured desktop/tablet/mobile projects.

- [ ] **Step 8: Inspect exact diff scope**

Run:

```bash
git status --short
git diff --stat main...HEAD
git diff main...HEAD -- packages/ui/src/tokens.css
```

`packages/ui/src/tokens.css` should remain the unchanged default palette unless a strictly necessary token-definition correction was explicitly approved; runtime custom color must not rewrite the defaults.

- [ ] **Step 9: Verify no semantic-color corruption**

Search changed app CSS/TSX and rendered states to confirm destructive/warning/positive styling still uses its semantic tokens and has not become worker-accent-driven.

- [ ] **Step 10: Verify migration handling**

Confirm the new Supabase migration is committed and **not applied automatically** to the live project. Report it in the handoff for manual application/authorization.

- [ ] **Step 11: Push and let normal PR CI run on the exact head**

Require green:

- format;
- lint;
- unit/integration;
- typecheck;
- production builds;
- provisioning safety smoke;
- migration-chain smoke;
- Edge Function typecheck;
- rendered Playwright E2E/evidence;
- Windows package;
- Required quality gate.

- [ ] **Step 12: Perform pre-merge review**

Check:

- branch is `behind_by: 0` or rebase/update safely before final verification;
- no unrelated files/migrations/temp workflows/scripts;
- no unresolved review threads/comments;
- color/menu writes preserve one another;
- worker switch race is guarded;
- Cancel restores the exact saved theme;
- `null` clears overrides rather than approximating default;
- Dark mode palette meets contrast requirements;
- semantic colors remain independent.

- [ ] **Step 13: Stop before merge**

Report exact head SHA, CI run, migration file requiring manual application, rendered evidence, changed-file list, and merge-readiness verdict. Do not merge until the user explicitly requests it.
