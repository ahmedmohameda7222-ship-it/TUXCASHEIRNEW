# TUX Menu Layout Editor Long-Term Phase A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the fragile Menu Edit implementation with a worker-bound reducer transaction, cross-input dnd-kit sorting, guarded dirty exits, explicit preference loading, shared Product Card presentation, and deterministic rendered acceptance while preserving current persistence/business contracts.

**Architecture:** A pure `menuLayoutEditorSession` reducer becomes the single transaction authority and `OrdersWorkspace` becomes a view/integration layer. dnd-kit owns pointer/touch/keyboard sorting; `ActiveShell` owns one reusable protected-transition guard; worker preference load and save results are identity-checked; normal/edit Product Cards share one presentational component. Phase A does not alter preference schema, persistence representation, Supabase, or domain business behavior.

**Tech Stack:** TypeScript, React 19, Vitest, `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities`, Playwright Chromium, existing TUX CSS/token system, GitHub Actions permanent quality gate.

**Spec:** `docs/superpowers/specs/2026-08-30-tux-menu-layout-editor-long-term-design.md`

## Global Constraints

- Exact base: `main@d624315b742bd70f6817d1292542f16372138784`.
- Branch: `refactor/menu-layout-editor-long-term`; one Draft PR to `main`; do not merge or deploy.
- No Supabase schema/RPC/migration/remote operation, no SQLite/IndexedDB preference migration, no serverVersion/live-reconciliation Phase B work.
- Do not change order/cart/catalog business behavior, product data, System Color behavior, or unrelated POS UI.
- Pencil remains the only Menu Edit entry point; one draft covers category order/alignment/product order; Reset/Cancel/Save semantics remain as specified.
- TDD is mandatory: behavioral tests are committed and executed RED before production code for each behavioral task.
- Native HTML5 menu-edit sorting is removed, not wrapped.
- Permanent CI remains read-only and no temporary workflow/test bypass may land.

---

## File Structure

### New focused production modules

- `apps/operations/src/app/menuLayoutEditorSession.ts` — pure reducer/state-machine and preference-load state helpers.
- `apps/operations/src/app/ProductCardPresentation.tsx` — shared non-interactive Product Card visual content.
- `apps/operations/src/app/MenuEditProductCard.tsx` — dnd-kit sortable edit wrapper using the shared presentation.
- `apps/operations/src/app/unsavedChangesGuard.ts` — pure protected-transition decision model.

### New focused tests

- `apps/operations/src/app/menuLayoutEditorSession.test.ts`
- `apps/operations/src/app/MenuEditProductCard.test.tsx`
- `apps/operations/src/app/unsavedChangesGuard.test.ts`
- `e2e/menu-layout-editor.e2e.ts`
- `e2e/menu-layout-editor.touch.e2e.ts`

### Modified integration

- `apps/operations/src/app/OrdersWorkspace.tsx`
- `apps/operations/src/app/MenuProductCard.tsx`
- `apps/operations/src/app/App.tsx`
- menu-edit CSS in existing Operations style files
- `playwright.config.ts`
- `apps/operations/package.json`
- `package-lock.json`
- existing source/behavior tests where their architectural assertions change.

### Deleted after consumer search

- `apps/operations/src/app/ProductPositionEditor.tsx`
- `apps/operations/src/app/ProductPositionEditor.test.tsx`
- `apps/operations/src/styles/product-position-editor.test.ts`

---

### Task 1: Pure Menu Layout Editor Session State Machine

**Files:**
- Create: `apps/operations/src/app/menuLayoutEditorSession.test.ts`
- Create: `apps/operations/src/app/menuLayoutEditorSession.ts`
- Reuse: `apps/operations/src/app/menuProductOrder.ts`

**Interfaces:**
- Produces `MenuLayoutDraft`, `MenuLayoutEditorSession`, `menuLayoutEditorReducer`, `createClosedMenuLayoutEditorSession`, `openMenuLayoutEditorSession`, and exact draft equality helpers.
- Reducer events include OPEN, SET_CATEGORY_ORDER, SET_ALIGNMENT, SET_PRODUCT_ORDER, BEGIN/DROP/CANCEL_CATEGORY_PICKUP, BEGIN/DROP/CANCEL_PRODUCT_PICKUP, CATEGORY_CHANGE, RESET, CANCEL_EDITOR, BEGIN_SAVE, SAVE_SUCCESS, SAVE_FAILURE, IDENTITY_INVALIDATED.
- SAVE_SUCCESS/SAVE_FAILURE carry `shopId`, `workerId`, and `saveToken`.

- [ ] **Step 1: Write failing reducer tests**

Cover each required transition with real state:

```ts
it('rolls an undropped product move back before a category change', () => {
  const opened = openMenuLayoutEditorSession(identity, base);
  const picked = reduce(opened, { type: 'BEGIN_PRODUCT_PICKUP', productId: p1, categoryId: c1 });
  const moved = reduce(picked, { type: 'SET_PRODUCT_ORDER', productOrder: [p2, p1, p3] });
  const changed = reduce(moved, { type: 'CATEGORY_CHANGE' });
  expect(changed.draft?.productOrder).toEqual(base.productOrder);
  expect(changed.interaction.type).toBe('NONE');
});
```

Add separate tests for product->category pickup rollback, category->product pickup rollback, Escape/cancel pickup rollback, Reset during pickup, Cancel dirty editor, identity invalidation, stale save completion, dirty/clean recomputation, and SAVING mutation no-ops.

- [ ] **Step 2: Run RED**

Run in CI-compatible form:

```bash
npm test -- apps/operations/src/app/menuLayoutEditorSession.test.ts
```

Expected: FAIL because the reducer module/API does not exist.

- [ ] **Step 3: Implement the minimal pure reducer**

Use immutable draft copies. A superseding interaction first restores `interaction.snapshot`; Reset restores canonical reset draft supplied by the event and clears pickup; Cancel/identity invalidation close to canonical CLOSED; mutations during SAVING are no-ops; stale save completion is an identity/token no-op.

- [ ] **Step 4: Run GREEN and related order tests**

```bash
npm test -- apps/operations/src/app/menuLayoutEditorSession.test.ts apps/operations/src/app/menuProductOrder.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit and review**

Commit focused reducer/tests; inspect diff for independent setters/snapshot logic accidentally leaking into the reducer API.

---

### Task 2: Explicit Preference Load State and Worker-Safe Async Results

**Files:**
- Modify: `apps/operations/src/app/menuLayoutEditorSession.ts`
- Modify: `apps/operations/src/app/menuLayoutEditorSession.test.ts`
- Modify: `apps/operations/src/app/OrdersWorkspace.tsx`
- Modify: `apps/operations/src/app/OrdersWorkspace.test.ts`

**Interfaces:**
- Produces `WorkerMenuPreferenceLoadState = LOADING | READY | ERROR` and a worker identity request token/generation used by `OrdersWorkspace` load/retry logic.
- `OrdersWorkspace` exposes a visible retry button when ERROR and disables Pencil unless READY.

- [ ] **Step 1: Add failing load/retry/stale-result tests**

Test LOADING -> ERROR, ERROR -> retry -> LOADING -> READY with saved custom layout, and stale Worker A load resolving after Worker B becomes active.

- [ ] **Step 2: Run RED**

```bash
npm test -- apps/operations/src/app/menuLayoutEditorSession.test.ts apps/operations/src/app/OrdersWorkspace.test.ts
```

Expected: new load-state assertions fail against the current `catch(() => setCategoryPreference(null))` behavior.

- [ ] **Step 3: Implement explicit load state**

On every `(shopId, workerId)` change enter LOADING and start a generation-scoped load. Only the current generation/identity may publish READY/ERROR. ERROR renders safe current/catalog fallback for cashier continuity, visible error copy, Retry, and disabled Menu Edit. `READY(null)` alone represents intentional default/no record.

- [ ] **Step 4: Run GREEN**

Run the focused tests above.

- [ ] **Step 5: Commit and review**

Search `OrdersWorkspace` for `load().then(...).catch(() => setCategoryPreference(null))`; it must no longer exist.

---

### Task 3: Shared Product Card Presentation and Dead Editor Removal

**Files:**
- Create: `apps/operations/src/app/ProductCardPresentation.tsx`
- Create: `apps/operations/src/app/MenuEditProductCard.test.tsx`
- Create later in this task after RED: `apps/operations/src/app/MenuEditProductCard.tsx`
- Modify: `apps/operations/src/app/MenuProductCard.tsx`
- Modify: `apps/operations/src/app/OrdersWorkspace.tsx`
- Delete: `apps/operations/src/app/ProductPositionEditor.tsx`
- Delete: `apps/operations/src/app/ProductPositionEditor.test.tsx`
- Delete: `apps/operations/src/styles/product-position-editor.test.ts`
- Modify legacy-only CSS tests/selectors as necessary.

**Interfaces:**
- `ProductCardPresentation({ product, showDescription, quantity? })` contains media/fallback, name, optional approved description, price, sold-out label, and optional non-interactive quantity badge slot/data.
- `MenuProductCard` supplies cashier interaction shell.
- `MenuEditProductCard` supplies sortable semantics only.

- [ ] **Step 1: Add failing rendered/component contract tests**

Assert normal/edit presentation renders the same product name/media/price core via stable `data-product-presentation`/`data-product-media` markers; edit wrapper contains no `Extra`, decrement/increment, or Quick Info action; no nested interactive controls.

- [ ] **Step 2: Run RED**

```bash
npm test -- apps/operations/src/app/MenuEditProductCard.test.tsx
```

Expected: FAIL because shared/edit components do not exist.

- [ ] **Step 3: Extract the shared presentation and edit wrapper**

Move visual content without changing normal Product Card cashier behavior. Keep description visibility equivalent to approved normal/edit rules; do not make presentation itself a button.

- [ ] **Step 4: Remove dead editor after production consumer search**

Search repository imports/usages first. Delete the isolated editor/tests/styles only if no production consumer exists; do not create another entry point.

- [ ] **Step 5: Run GREEN plus relevant card/source tests**

```bash
npm test -- apps/operations/src/app/MenuEditProductCard.test.tsx apps/operations/src/app/OrdersWorkspace.test.ts apps/operations/src/app/unifiedMenuEditMode.source.test.ts
```

- [ ] **Step 6: Commit and review**

Verify normal cashier Product Card actions/semantics remain in `MenuProductCard`, while the edit wrapper shares presentation and has no cashier actions.

---

### Task 4: Replace Native Sorting with dnd-kit for Pointer, Touch, and Spatial Keyboard

**Files:**
- Modify: `apps/operations/package.json`
- Modify: `package-lock.json`
- Modify: `apps/operations/src/app/MenuEditProductCard.tsx`
- Modify: `apps/operations/src/app/OrdersWorkspace.tsx`
- Modify: `apps/operations/src/app/menuLayoutEditorSession.ts` only if a reducer event is needed by the sortable integration
- Modify: menu-edit CSS selectors.

**Interfaces:**
- Sensors: `PointerSensor`, `TouchSensor`, `KeyboardSensor` with `sortableKeyboardCoordinates`.
- Product `SortableContext` uses grid geometry; category `SortableContext` uses horizontal strategy.
- `DragOverlay` renders stable product/category presentation.
- Drag end dispatches target order through the reducer; cancel restores pre-drag ordering when required.

- [ ] **Step 1: Add dependencies using the locked npm workflow**

Add exactly `@dnd-kit/core`, `@dnd-kit/sortable`, and `@dnd-kit/utilities` to the Operations workspace and lockfile. No other drag framework.

- [ ] **Step 2: Add failing architecture/interaction tests before wiring production**

Update the focused source boundary test so it fails while native `draggable`/`onDragEnter` menu-edit sorting still exists and requires dnd-kit sensor/sortable boundaries.

- [ ] **Step 3: Run RED**

```bash
npm test -- apps/operations/src/app/unifiedMenuEditMode.source.test.ts apps/operations/src/app/MenuEditProductCard.test.tsx
```

Expected: FAIL on native sorting and missing sortable integration.

- [ ] **Step 4: Implement DndContext/sensors/sortables**

Use separate sortable IDs for categories/products, collision behavior appropriate to the visible grid, stable overlay, no hover-only mutation, and reducer updates only for valid current-category products. Disable all sensors/mutation callbacks while SAVING.

- [ ] **Step 5: Remove native HTML5 drag handlers and obsolete drag CSS**

Production Menu Edit contains no primary `draggable`, dragstart/dragenter/dragover/drop reorder path.

- [ ] **Step 6: Run GREEN and typecheck affected workspace**

```bash
npm test -- apps/operations/src/app/unifiedMenuEditMode.source.test.ts apps/operations/src/app/MenuEditProductCard.test.tsx apps/operations/src/app/menuLayoutEditorSession.test.ts
npm run typecheck
```

- [ ] **Step 7: Commit and review**

Review specifically for accidental cashier actions, cross-category moves, DOM-under-pointer feedback loops, and save-in-flight mutation.

---

### Task 5: Integrate Reducer Transaction into OrdersWorkspace

**Files:**
- Modify: `apps/operations/src/app/OrdersWorkspace.tsx`
- Modify: `apps/operations/src/app/menuLayoutEditorSession.ts`
- Modify: focused tests.

**Interfaces:**
- One `useReducer` state replaces the independent edit drafts, grabbed IDs, pickup refs, reset flag, saving flag, and save error.
- `OrdersWorkspace` may retain UI-only `menuEditAnnouncement`, DnD active overlay ID, refs for category visibility, and non-editor cashier state.

- [ ] **Step 1: Add failing integration tests for transaction boundaries**

Cover active product pickup -> category click rollback, Reset/Cancel whole-draft behavior, save failure exact-draft retention, worker identity invalidation, and save-in-flight freezing alignment/reset/cancel/reorder callbacks.

- [ ] **Step 2: Run RED**

```bash
npm test -- apps/operations/src/app/OrdersWorkspace.test.ts apps/operations/src/app/menuLayoutEditorSession.test.ts
```

- [ ] **Step 3: Replace independent Menu Edit setters/refs with reducer dispatches**

Begin edit captures session identity + reconciled base. Category selection first cancels active product pickup. Begin either pickup resolves the other. Save creates a unique token and captures opening identity; result handlers verify current session identity before publishing `categoryPreference` or reducer completion.

- [ ] **Step 4: Run GREEN**

Run focused tests and `npm run typecheck`.

- [ ] **Step 5: Commit and review**

Compare `OrdersWorkspace` against base: editor-specific transaction state/handler complexity must be reduced, not merely relocated into more local setters.

---

### Task 6: Shell-Level Dirty Exit Guard and beforeunload

**Files:**
- Create: `apps/operations/src/app/unsavedChangesGuard.test.ts`
- Create: `apps/operations/src/app/unsavedChangesGuard.ts`
- Modify: `apps/operations/src/app/App.tsx`
- Modify: `apps/operations/src/app/OrdersWorkspace.tsx`
- Modify relevant styles/tests.

**Interfaces:**
- Pure guard decision: CLOSED/CLEAN -> RUN; DIRTY -> CONFIRM; SAVING -> BLOCK.
- `ActiveShell` stores at most one pending protected action and owns the accessible `Discard menu changes?` dialog.
- `OrdersWorkspace` reports `{ lifecycle, dirty }` and provides a discard callback that rolls back/clears pickup/closes before the shell action executes.

- [ ] **Step 1: Add failing pure guard tests**

```ts
expect(decideProtectedTransition({ lifecycle: 'EDITING', dirty: true })).toBe('CONFIRM');
expect(decideProtectedTransition({ lifecycle: 'SAVING', dirty: true })).toBe('BLOCK');
```

- [ ] **Step 2: Run RED**

```bash
npm test -- apps/operations/src/app/unsavedChangesGuard.test.ts
```

- [ ] **Step 3: Implement pure guard and shell wiring**

Route Orders Board, Expenses, Bulk Stock, Switch worker, Sign out, and End Day through one request function. Keep editing preserves exact draft. Discard executes editor discard then queued action once. Escape=Keep editing; backdrop cannot discard; initial focus Keep editing.

- [ ] **Step 4: Add beforeunload while dirty only**

Install/remove the handler from the shell/editor-state integration without custom browser copy.

- [ ] **Step 5: Run GREEN + App/Orders tests + typecheck**

- [ ] **Step 6: Commit and review**

Review every protected shell transition for bypasses and any duplicated confirmation logic.

---

### Task 7: Selected Category Visibility and Responsive Edit Toolbar

**Files:**
- Modify: `apps/operations/src/app/OrdersWorkspace.tsx`
- Modify: menu-edit CSS.
- Modify/add focused tests where possible.

**Interfaces:**
- Rail ref + category-tab refs.
- `ensureSelectedCategoryVisible()` calls `scrollIntoView({ block: 'nearest', inline: 'nearest' })` only at edit-entry/selection/size-boundary changes.

- [ ] **Step 1: Add failing testable visibility boundary**

Extract a tiny helper if necessary so unit tests prove scroll is requested only when selected tab lies outside rail bounds; rendered acceptance remains authoritative for actual 375 px visibility.

- [ ] **Step 2: Run RED**

Run focused test.

- [ ] **Step 3: Implement refs/ResizeObserver and CSS reachability**

Do not reset category rail scroll globally. Preserve sticky action bar and touch targets.

- [ ] **Step 4: Run GREEN + typecheck**

- [ ] **Step 5: Commit and review**

---

### Task 8: Rendered Desktop/Mobile/Touch Acceptance and Evidence

**Files:**
- Modify: `playwright.config.ts`
- Create: `e2e/menu-layout-editor.e2e.ts`
- Create: `e2e/menu-layout-editor.touch.e2e.ts`
- Reuse existing Operations fixture/seeding helpers from `e2e/operations.e2e.ts`, extracting a focused helper only if needed without changing production data semantics.

**Interfaces:**
- Add project `touch-mobile-browser-fallback` with Chromium, viewport 375x812 (or repository mobile dimensions), `hasTouch: true`, and `testMatch` restricted to `menu-layout-editor.touch.e2e.ts`.
- Existing projects exclude the touch-only file to avoid duplication.

- [ ] **Step 1: Write failing acceptance tests first**

Cover all required cases: desktop pointer reorder/save/re-entry persistence; touch reorder/save/re-entry + cancel restoration; desktop spatial keyboard grid; one-column mobile keyboard; category horizontal keyboard; dirty navigation/worker switch/sign-out Keep/Discard; active pickup category-change rollback; selected category visible at 375; save failure exact draft; save-in-flight freezes mutation/protected navigation; normal/edit presentation geometry; no ProductPositionEditor/Manage order; horizontal overflow.

Use pointer/touch actions from Playwright input APIs and observable DOM order/accessible state; do not emulate touch by viewport alone.

- [ ] **Step 2: Run RED on the Draft PR SHA**

```bash
npm run test:e2e -- --project=desktop-browser-fallback e2e/menu-layout-editor.e2e.ts
npm run test:e2e -- --project=touch-mobile-browser-fallback e2e/menu-layout-editor.touch.e2e.ts
```

Expected before the integration is complete: behavior-specific failures, not fixture/setup errors.

- [ ] **Step 3: Implement only fixes required by RED evidence**

Use systematic-debugging for unexpected failures: inspect error/trace, reproduce in CI, identify root cause, make one bounded fix, rerun.

- [ ] **Step 4: Capture rendered evidence**

Attach screenshots through `testInfo.attach` for desktop normal/edit/drag/guard/save-error/selected-category, mobile edit/selected/touch-drag/sticky/guard, tablet edit, and Reduced Motion edit state so they land in the permanent `operations-rendered-e2e` artifact.

- [ ] **Step 5: Run focused GREEN across projects**

```bash
npm run test:e2e -- --project=desktop-browser-fallback e2e/menu-layout-editor.e2e.ts
npm run test:e2e -- --project=mobile-browser-fallback e2e/menu-layout-editor.e2e.ts
npm run test:e2e -- --project=mobile-tablet-browser-fallback e2e/menu-layout-editor.e2e.ts
npm run test:e2e -- --project=touch-mobile-browser-fallback e2e/menu-layout-editor.touch.e2e.ts
```

- [ ] **Step 6: Commit and review**

Review that tests are behavioral and deterministic, touch has `hasTouch: true`, and no workflow/test bypass was introduced.

---

### Task 9: Final Architecture Audit and Permanent Quality Gate

**Files:**
- Modify only files required by verified failures/review findings; no scope expansion.

- [ ] **Step 1: Repository audit searches**

Verify:

```text
ProductPositionEditor          -> no production consumer/file
Manage order                   -> no edit entry point
native draggable/dragenter     -> no menu-edit sorting path
preference load catch(null)    -> absent
independent grabbed refs       -> absent from OrdersWorkspace transaction authority
menu-edit Supabase/migrations  -> no changed files
```

- [ ] **Step 2: Full local-equivalent command matrix on the exact final SHA**

```bash
npm run format
npm run format:check
npm run lint
npm test
npm run typecheck
npm run build
npm run test:migrations
npm run test:e2e
```

Permanent CI must additionally show the repository-required provisioning safety, Deno Edge checks, and Windows x64 package success.

- [ ] **Step 3: Request whole-branch code review**

Review against this plan/spec and A1-A12. Fix every Critical/Important finding with focused RED/GREEN evidence; rerun affected tests.

- [ ] **Step 4: Verify exact final SHA through `TUX V2 CI / Required quality gate`**

Record workflow run ID, job IDs, job conclusions, unit/integration totals, Playwright totals by project, touch result, Windows packaging result, and rendered artifact metadata/digest.

- [ ] **Step 5: Compare against main and assemble handoff**

Record exact base/final SHA, ahead/behind, changed-file count, created/deleted/modified files, exact dnd-kit package versions, A1-A12 PASS/FAIL evidence, screenshots/evidence list, blockers, and the two required explicit confirmations.

- [ ] **Step 6: STOP**

Leave the PR Draft and unmerged. Do not start Phase B.

---

## Plan Self-Review

### Spec coverage

- A1 orphan pickup: Tasks 1, 5, 8.
- A2 real pointer/touch: Tasks 4, 8.
- A3 native dragenter fragility: Tasks 4, 9.
- A4 coherent state machine: Tasks 1, 5.
- A5 worker identity binding: Tasks 1, 2, 5, 8.
- A6 dirty exit loss: Tasks 6, 8.
- A7 preference load error: Task 2.
- A8 presentation duplication: Task 3, rendered Task 8.
- A9 dead ProductPositionEditor: Task 3, audit Task 9.
- A10 spatial keyboard: Tasks 4, 8.
- A11 mobile visibility: Tasks 7, 8.
- A12 behavioral/touch coverage: Task 8 plus reducer tests.

### Placeholder scan

No `TBD`, `TODO`, implementation-later placeholders, or unspecified test-only work remain. Every task has explicit files, RED command, implementation boundary, GREEN command, and review gate.

### Interface consistency

The plan consistently uses one reducer transaction, one explicit load state, one shell guard, one shared Product Card presentation, one dnd-kit sorting layer, and one Draft PR. No task introduces a Phase B schema/API contract.