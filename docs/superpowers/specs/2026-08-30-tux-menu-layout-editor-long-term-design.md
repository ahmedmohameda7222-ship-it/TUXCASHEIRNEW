# TUX Menu Layout Editor Long-Term Design — Phase A

## Status

Approved Planner authority materialized on 2026-08-30. This document is the binding Phase A architecture, UX, interaction, accessibility, and verification authority for the TUX Operations Product Item / Menu Edit Mode hardening program.

The approved base is exactly `main@d624315b742bd70f6817d1292542f16372138784`. Phase A is implemented on `refactor/menu-layout-editor-long-term` and reviewed through one Draft PR. Phase B persistence/schema work is explicitly excluded.

## Goal

Make Menu Edit a coherent, worker-bound transaction with deterministic cancellation, cross-input spatial sorting, guarded shell exits, explicit preference loading state, shared Product Card presentation, and rendered behavioral coverage without changing cashier business behavior or the existing persistence schema/representation.

## Non-goals

Phase A does not change:

- `WorkerUiPreferences` schema shape or `productOrder` representation;
- Supabase `worker_ui_preferences`, RPCs, migrations, or remote validation;
- optimistic `serverVersion` concurrency semantics;
- live multi-device menu-layout reconciliation;
- SQLite or IndexedDB preference schemas/migrations;
- order/cart/catalog business behavior or product data;
- System Color behavior or its persistence lifecycle;
- unrelated POS visual design;
- the Pencil-only edit entry point or the approved unified edit contract.

No migration is added and no remote Supabase operation is performed.

---

## 1. Menu layout editor session is one state machine

Create `apps/operations/src/app/menuLayoutEditorSession.ts` as the sole owner of the Menu Edit transaction state and pure transitions.

### State model

```ts
export type MenuLayoutEditorLifecycle = 'CLOSED' | 'EDITING' | 'SAVING' | 'ERROR';
export type MenuLayoutEditorInteraction =
  | { readonly type: 'NONE' }
  | {
      readonly type: 'CATEGORY_PICKUP';
      readonly categoryId: MenuCategoryId;
      readonly snapshot: MenuLayoutDraft;
    }
  | {
      readonly type: 'PRODUCT_PICKUP';
      readonly productId: ProductId;
      readonly categoryId: MenuCategoryId;
      readonly snapshot: MenuLayoutDraft;
    };

export interface MenuLayoutDraft {
  readonly categoryOrder: readonly MenuCategoryId[];
  readonly categoryAlignment: CategoryAlignment;
  readonly productOrder: readonly ProductId[];
}

export interface MenuLayoutEditorSession {
  readonly lifecycle: MenuLayoutEditorLifecycle;
  readonly openingShopId: ShopId | null;
  readonly openingWorkerId: WorkerId | null;
  readonly base: MenuLayoutDraft | null;
  readonly draft: MenuLayoutDraft | null;
  readonly interaction: MenuLayoutEditorInteraction;
  readonly dirty: boolean;
  readonly resetRequested: boolean;
  readonly saveError: string | null;
  readonly saveToken: string | null;
}
```

`CLOSED` has no worker identity/base/draft, no pickup, `dirty=false`, `resetRequested=false`, and no error/token. `EDITING`, `SAVING`, and `ERROR` always have opening identity and base/draft.

`dirty` is derived by exact layout equality between `base` and `draft`; the reducer may store the boolean for convenience but every draft transition must recompute it from state, never independently toggle it.

### Required transitions

The reducer exposes explicit events for:

- open editor with `(shopId, workerId, base)`;
- set category order/alignment/product order;
- begin/drop/cancel category pickup;
- begin/drop/cancel product pickup;
- select category boundary cancellation;
- reset full draft;
- cancel/close editor;
- begin save with a unique save token;
- save success/failure with `(shopId, workerId, saveToken)`;
- active worker/session identity invalidation.

Invalid lifecycle transitions are explicit no-ops. Mutation events are no-ops in `SAVING`. Save completion is accepted only when all three match the active transaction: opening shop ID, opening worker ID, and current save token.

`OrdersWorkspace` must no longer coordinate grabbed IDs, pickup snapshots, reset flags, category/product drafts, dirty state, or saving/error state through unrelated setters/refs. UI-only transient state such as an announcement string or currently active DnD overlay identifier may remain local if it is not transaction authority.

---

## 2. Pickup is a reversible sub-transaction

A keyboard pickup captures the entire current Menu Layout draft as its snapshot before movement. Movement changes the draft but remains provisional until the pickup is dropped.

Before any operation that supersedes an active pickup, dispatch cancellation first so the draft is restored exactly to the pickup snapshot.

Required cancellation boundaries:

- product pickup -> category selection;
- product pickup -> begin category pickup;
- category pickup -> begin product pickup;
- Escape;
- Reset;
- Cancel editor;
- dirty discard;
- worker/session identity change;
- navigation/unmount;
- any equivalent shell transition that closes the editor.

A movement that was never dropped must never become part of Save. Dropping commits only to the in-memory editor draft; persistence still happens only through the final Menu Edit Save.

---

## 3. Cross-input sorting uses dnd-kit, not native HTML5 drag

Add the focused Operations dependencies:

- `@dnd-kit/core`
- `@dnd-kit/sortable`
- `@dnd-kit/utilities`

Use the repository lockfile and normal npm dependency policy; do not create a custom drag framework.

The unified Menu Edit sorting layer uses:

- `DndContext`;
- `PointerSensor` for mouse/trackpad/pointer;
- `TouchSensor` for real touch;
- `KeyboardSensor` with `sortableKeyboardCoordinates`;
- `SortableContext`;
- a grid-aware sorting strategy for Product Cards;
- horizontal list strategy for the category rail;
- `DragOverlay` or an equivalent stable overlay.

No menu-edit production element uses native `draggable`, `dragstart`, `dragenter`, `dragover`, or `drop` as the sorting engine after Phase A.

Order changes occur deterministically on sortable drag movement/end semantics, not DOM `dragenter` hover. The active source/overlay is visually stable and does not participate in decorative jiggle. Product sorting is constrained to the selected category's canonical product IDs; category sorting remains within the active category set.

All layout mutation callbacks are disabled/no-ops while lifecycle is `SAVING`.

---

## 4. Spatial keyboard behavior follows rendered geometry

Keyboard DnD uses dnd-kit's geometry-aware `sortableKeyboardCoordinates`, not hard-coded `-1/+1` mappings for both axes.

Acceptance semantics:

- desktop 3-column Product grid: Right/Left target adjacent visual columns; Down/Up target the corresponding next/previous row where one exists;
- mobile one-column Product grid: Down/Up move naturally vertically;
- category rail: Left/Right follow horizontal visual order.

Accessible announcements continue to include item name and updated `position N of M`. Keyboard pickup uses Space/Enter according to dnd-kit keyboard sensor semantics and Escape cancels the active DnD operation without persisting an uncommitted move.

---

## 5. Shared Product Card presentation

Create `ProductCardPresentation.tsx` as the presentational owner of shared Product Card visual content:

- product image with fallback initials and image-error fallback;
- product name;
- approved description visibility rules;
- price;
- sold-out presentation where applicable.

It must not own cashier actions or reorder actions.

`MenuProductCard` keeps normal cashier semantics and wraps the shared presentation with Quick Info, Extra, decrement/increment, quantity badge, busy/disabled rules, and existing card semantics.

Create `MenuEditProductCard.tsx` as the sortable wrapper around the same presentation. It adds reorder status/handle/position semantics and contains no Extra/quantity/Quick Info cashier action.

Do not nest an interactive control inside another interactive control. Preserve the approved normal Product Card geometry and core visual content; edit mode may add its reorder affordance/status without recreating the whole visual tree.

Rendered tests compare normal/edit core presentation geometry using stable data attributes/bounding boxes rather than source-string duplication assertions.

---

## 6. Remove the dead ProductPositionEditor path

Repository search confirms the unified Pencil path renders reorder cards directly from `OrdersWorkspace`; the standalone `ProductPositionEditor` has no production consumer.

Delete:

- `apps/operations/src/app/ProductPositionEditor.tsx`;
- `apps/operations/src/app/ProductPositionEditor.test.tsx`;
- `apps/operations/src/styles/product-position-editor.test.ts` when it only protects the dead editor.

Remove legacy-only `product-card-reordering`, `product-card-dragging`, `product-card-grabbed`, and `product-reorder-*` selectors that are not reused by the new unified sortable implementation.

Do not restore `Manage order` or any second reorder entry point. Pencil remains the only Menu Edit entry point.

---

## 7. One shell-level unsaved-change guard

Create `unsavedChangesGuard.ts` for the reusable decision model and an accessible confirmation dialog in the shell integration. `ActiveShell` is the authority that owns pending protected transitions.

`OrdersWorkspace` reports Menu Edit exit state upward using a narrow callback/handle equivalent to:

```ts
export interface MenuLayoutExitState {
  readonly lifecycle: MenuLayoutEditorLifecycle;
  readonly dirty: boolean;
}

export interface MenuLayoutExitController {
  readonly state: MenuLayoutExitState;
  discard(): void;
}
```

The exact React wiring may use callbacks rather than an imperative handle, but `App.tsx` must have one reusable `requestProtectedTransition(action)` path for Orders Board, Expenses, Bulk Stock, Switch worker, Sign out, and End Day.

Rules:

- CLEAN/CLOSED: run requested transition immediately;
- DIRTY: queue exactly one transition and show `Discard menu changes?`;
- `Keep editing`: close dialog, clear queued transition, preserve draft exactly;
- `Discard changes`: cancel pickup, restore base/close editor, then run queued transition exactly once;
- `SAVING`: block protected transition until save resolves; do not queue an action that can race save completion.

Dialog accessibility:

- `role="dialog"`;
- `aria-modal="true"`;
- labelled title;
- initial focus on `Keep editing`;
- Escape is equivalent to Keep editing;
- backdrop click does not discard.

Register `beforeunload` only while editor state is DIRTY; remove it when no longer dirty. The browser owns the actual native unload message.

---

## 8. Worker identity binds the transaction

When Menu Edit opens, capture `openingShopId` and `openingWorkerId` from the active operator session.

A worker/session change invalidates the old transaction. Dirty worker switch first uses the shell discard guard. Clean edit may close deterministically before the switch. An active pickup is cancelled/rolled back before close.

While `SAVING`, worker switch/sign-out/navigation is blocked until the save resolves.

Every async save completion includes the opening identity and save token in the reducer event. A stale result from Worker A is ignored when Worker B is active or a newer transaction/save token exists. It must never update Worker B's `categoryPreference`, editor state, or visible layout.

The normal successful save path may update `categoryPreference` only after checking that the active session identity still matches the transaction identity whose save resolved.

---

## 9. Preference loading is explicit

Represent preference loading separately from preference value:

```ts
export type WorkerMenuPreferenceLoadState =
  | { readonly status: 'LOADING' }
  | { readonly status: 'READY'; readonly preference: WorkerUiPreferences | null }
  | { readonly status: 'ERROR'; readonly message: string };
```

`null` is valid only inside `READY` and means the worker intentionally has no saved preference record.

On worker/session change, enter `LOADING` before issuing `preferencesClient.load()`.

While LOADING:

- Orders remains usable;
- safe visible fallback ordering may render for cashier continuity;
- Menu Edit cannot begin.

On ERROR:

- keep Orders usable with safe visible fallback;
- show a visible non-blocking error that menu customization could not be loaded;
- show `Retry`;
- keep Menu Edit disabled;
- never call an update based on the error fallback.

Retry returns to LOADING and reloads for the still-active worker identity. A stale load result for a previous worker is ignored.

On READY, use the actual saved preference or intentional `null`, and enable Menu Edit.

---

## 10. Selected category visibility

Give each category tab a stable element ref keyed by category ID and the rail a container ref.

Call `scrollIntoView({ block: 'nearest', inline: 'nearest' })` for the selected tab only at these boundaries:

- entering Menu Edit;
- selected category changes;
- a responsive width change causes the selected tab to leave the visible rail;
- alignment-control/layout width change makes it non-visible.

Use `ResizeObserver` where supported with a window resize fallback if needed. Do not reset `scrollLeft` globally or scroll the rail on unrelated renders.

At 375 px, the selected category tab, alignment controls, Pencil/edit state, and sticky Save/Cancel controls remain reachable without document-level horizontal overflow.

---

## 11. Motion and visual stability

Preserve the approved Menu Edit visual language. Idle editable cards/categories may retain decorative jiggle only under `prefers-reduced-motion: no-preference`.

The active dragged item and DragOverlay must not jiggle. Sortable transforms/transitions must not create a native-hover feedback loop. Reduced Motion removes decorative jiggle and non-essential reorder animation while keeping all state readable through shape/text/border/focus semantics.

No POS redesign is authorized.

---

## 12. Behavioral verification authority

### Reducer/unit RED -> GREEN cases

At minimum cover:

1. product pickup -> move -> category switch rolls back pickup snapshot;
2. product pickup -> category pickup rolls back product pickup;
3. category pickup -> product pickup rolls back category pickup;
4. Escape pickup rollback;
5. Reset during pickup;
6. Cancel dirty edit;
7. worker identity invalidates old transaction;
8. stale save completion cannot mutate a new worker session;
9. dirty/clean lifecycle transitions;
10. preference load LOADING/READY/ERROR/Retry.

### Rendered Playwright cases

At minimum cover:

11. desktop pointer reorder + Save persistence;
12. real-touch reorder + Save persistence using a dedicated Chromium `hasTouch: true` project scoped to focused touch tests;
13. spatial keyboard reorder in desktop multi-column grid;
14. keyboard reorder in one-column mobile grid;
15. category horizontal keyboard reorder;
16. dirty editor -> Orders Board, Keep editing / Discard;
17. dirty editor -> worker switch, Keep editing / Discard;
18. dirty editor -> Sign out guard;
19. active pickup -> category change rollback;
20. selected category remains visible at 375 px;
21. save failure keeps exact draft;
22. save-in-flight freezes drag, touch, keyboard, alignment, Reset, Cancel, and protected navigation;
23. normal/edit Product Cards share approved core presentation geometry;
24. no isolated ProductPositionEditor / Manage order entry point exists.

Source architecture tests may enforce dead-code/native-drag/dependency boundaries but cannot substitute for behavior.

### Touch project

Add a focused Playwright project named `touch-mobile-browser-fallback` using Chromium, a mobile viewport, and `hasTouch: true`. Restrict it with `testMatch` to the dedicated touch acceptance file so the full Operations suite is not duplicated under touch.

### Rendered evidence

Capture evidence for desktop normal/edit/active drag/dirty guard/save error/selected-category visibility; mobile 375 edit/selected-category/touch drag/sticky controls/discard guard; tablet edit arrangement; and Reduced Motion edit state. The permanent CI artifact `operations-rendered-e2e` is the source of truth.

---

## 13. Existing contracts that must remain true

- Pencil is the only edit entry point.
- Categories and Product Cards edit in place.
- Search and family filter are unavailable during edit.
- One draft covers category order, category alignment, and product order.
- Reset affects the entire draft.
- Cancel discards the entire draft.
- Save persists once at the end.
- Save failure keeps the exact draft open.
- Saving disables every persisted-layout mutation.
- Worker-specific layout remains worker-specific.
- Reorder remains inside valid category boundaries.
- Reduced Motion removes decorative motion.
- Live ARIA announcements remain.
- Reorder cards have no cashier actions.
- System Color remains independent from menu-layout writes.

---

## 14. File boundaries

Expected Phase A additions:

- `apps/operations/src/app/menuLayoutEditorSession.ts`
- `apps/operations/src/app/menuLayoutEditorSession.test.ts`
- `apps/operations/src/app/ProductCardPresentation.tsx`
- `apps/operations/src/app/MenuEditProductCard.tsx`
- `apps/operations/src/app/MenuEditProductCard.test.tsx`
- `apps/operations/src/app/unsavedChangesGuard.ts`
- focused menu-layout Playwright files/helpers as needed.

Expected modifications:

- `apps/operations/src/app/OrdersWorkspace.tsx`
- `apps/operations/src/app/MenuProductCard.tsx`
- `apps/operations/src/app/App.tsx`
- `apps/operations/src/styles/final-pos-corrections.css` and/or existing Operations styles only where the current menu-edit selectors live
- `playwright.config.ts`
- relevant existing unit/source/E2E tests
- `apps/operations/package.json` and root `package-lock.json` for dnd-kit.

Expected deletions after final consumer search:

- `apps/operations/src/app/ProductPositionEditor.tsx`
- `apps/operations/src/app/ProductPositionEditor.test.tsx`
- `apps/operations/src/styles/product-position-editor.test.ts`

`OrdersWorkspace` must finish with less menu-edit transaction state/handler responsibility than the approved base.

---

## 15. Final verification and Phase A stop boundary

The exact final SHA must pass the permanent `TUX V2 CI / Required quality gate`, including locked install, format check, lint, unit/integration, strict TypeScript, production builds, provisioning safety, PostgreSQL migration-chain smoke, Deno Edge checks, rendered Playwright, and Windows x64 packaging.

Final repository audit must verify no production ProductPositionEditor consumer, no `Manage order`, no native HTML5 menu-edit sorting, no orphan pickup path, no silent dirty exit, no preference-load-error-as-null path, no cross-worker stale save application, no duplicate full Product Card presentation, no temporary workflow/test bypass, no unrelated changes, and no migration/Supabase remote operation.

Phase A stops with the PR Draft and unmerged. Phase B begins only after independent Planner approval.