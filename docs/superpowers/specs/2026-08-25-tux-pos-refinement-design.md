# TUX Operations POS Refinement Design

## Status

Approved design refinement following the premium green POS redesign merged in PR #26. This document narrows and extends the existing `DESIGN.md`; it does not reopen the core visual direction.

## Goal

Improve cashier speed, legibility, personalization, and checkout clarity without changing the one-screen POS architecture or the established premium green design system.

The refinement has five product goals:

1. make the header/navigation more balanced and readable;
2. make category navigation faster to scan, search, and personalize;
3. simplify split payment around the actual cashier mental model;
4. let each cashier choose a comfortable Current Order width on each physical device;
5. finish the visual issues identified in the post-implementation Designer Skill review.

## Scope

This refinement changes presentation plus two narrowly scoped preference behaviors:

- worker-specific category layout preferences, synced across devices;
- device-local Current Order width preference.

It also changes split-payment interaction semantics so split cash amounts represent the amount allocated to that method, not cash tender/change entry.

All pricing, order totals, payment method definitions, delivery logic, persistence durability, printing, modifiers, inventory, Orders Board, Expenses, Bulk Stock, End Day, and remote gateway architecture remain unchanged unless explicitly described below.

## 1. Header refinement

### Navigation placement

`Orders`, `Orders Board`, `Expenses`, and `Bulk Stock` must be visually centered in the true horizontal center of the floating header, independent of the width of the logo/status/operator zones.

Use a three-zone header structure:

- leading: canonical TUX logo;
- center: Operations navigation;
- trailing: sync status + operator menu.

The center zone must not drift when the trailing content width changes.

### Logo

Use the canonical original TUX SVG unchanged. Increase its rendered presence by roughly 15–25% from the current implementation while preserving aspect ratio and without recoloring or redrawing it.

## 2. Category/navigation refinement

### Default category bar

The current persistent search field is removed from the default category state.

The category bar contains:

- category buttons;
- trailing Edit Categories action;
- trailing Search action.

The bar remains primarily opaque and uses the approved premium-neutral material system. It is not a second glass layer.

### Category typography and hit area

Categories must be clearly readable at normal cashier distance:

- text: 15–16px;
- normal: Medium;
- active: Semibold;
- minimum interaction height: 44px;
- horizontal padding: approximately 14–18px, adapted to viewport density.

Buttons should feel comfortably clickable but must not become oversized pills.

### Search progressive disclosure

Use one coherent outline icon family. Approved references from Supericons:

- search: `iconoir:search`;
- category edit: `iconoir:edit-pencil`.

The default toolbar shows only the Search icon rather than a full input.

When Search is activated:

- the search field expands inline within the category/navigation surface;
- focus moves immediately into the input;
- the worker can type without another click;
- `Ctrl/Cmd + K` and `/` must open/focus the same search state;
- Escape closes the field when appropriate;
- clearing search returns the bar to its compact state.

The accessible input label remains `Search menu`/`Search products` as required by the existing application contract; the label may be visually hidden.

## 3. Editable category layout

### Worker-specific preference model

Category layout is a personal worker preference, not shop configuration and not a device setting.

Persist a separate UI preference record keyed by worker identity. It contains at minimum:

- worker ID;
- ordered category ID list;
- alignment: `left | center | right`;
- update/version timestamp required by the local-first synchronization mechanism.

Do not store this preference inside core worker business/profile data.

### Cross-device behavior

Preferences are **per worker and synced across devices**.

If the same worker signs into another enrolled POS, their category ordering and alignment should follow them once the preference snapshot is available.

The preference participates in the established local-first model:

1. UI change commits locally first;
2. the worker can continue operating offline;
3. preference is queued/synced remotely;
4. other devices receive the newer preference according to the repository's existing monotonic/last-known-good synchronization rules.

Do not weaken business outbox ordering or existing sync safety to implement this preference.

### Default and reconciliation behavior

If no saved preference exists, use current configured category sort order.

When shop configuration changes:

- category IDs still present in the preference preserve their worker-defined order;
- newly configured active categories not yet present in the preference append after the saved categories using configuration order;
- removed/inactive categories are not rendered and should not block preference parsing;
- `Reset to default` discards the worker override and returns to configuration order/alignment.

### Edit mode

Selecting the Edit Categories action transforms the category surface into an inline edit mode rather than opening a separate modal.

Edit mode provides:

- reorder categories by direct drag/reorder interaction;
- keyboard-accessible reorder alternative (`Move left` / `Move right` or equivalent accessible controls);
- alignment segmented control: Left / Center / Right;
- `Reset to default` secondary action;
- `Done` primary completion action.

Drag-and-drop must never be the only way to reorder.

Search and category edit modes are mutually exclusive to keep the toolbar predictable.

## 4. Split payment correction

### Cashier mental model

Split payment exists to allocate the order total across two payment methods.

Example:

- total: EGP 400;
- customer gives EGP 320 using Method A (Cash);
- remaining EGP 80 is paid using Method B (for example Instapay).

Therefore the split editor does **not** ask for `Cash received A`, `Cash received B`, or calculate per-split cash change.

### Interaction model

For split payment:

- Method A: selectable payment method;
- Amount A: cashier-entered allocation;
- Method B: selectable different payment method;
- Amount B: automatic remainder = total − Amount A.

The normal all-cash single-payment flow retains `Cash received` and `Change`, because tender/change is meaningful when the entire order is processed as a single cash payment.

### Validation

Preserve exact-money integer arithmetic.

Validation must reject:

- Amount A < 0;
- Amount A > total;
- identical Method A and Method B if the existing payment model forbids it;
- any state where the two allocations do not exactly resolve to total.

No floating-point currency arithmetic is introduced.

## 5. Resizable Current Order rail

### Behavior

On desktop/laptop, the worker can resize the Current Order / checkout rail by dragging its left boundary horizontally.

The resizing changes presentation only. It must not change order/business state.

Suggested limits, to be finalized against actual rendered breakpoints:

- minimum about 360px;
- default about 420–440px;
- maximum about 600px or 45% of the viewport, whichever is smaller.

The product grid responds naturally to the remaining product-pane width.

### Persistence

Cart/checkout width is **per device only**.

Persist the width locally on that browser/desktop device (for example localStorage or an equivalent renderer preference store). Do not sync it through Supabase and do not attach it to the worker profile.

Rationale: the same worker may use a 14-inch laptop and a 24-inch POS, where the comfortable checkout width differs.

### Accessibility

The resize affordance should have a visible pointer target without becoming visually heavy.

Provide a keyboard-accessible alternative when the handle is focused, such as arrow-key resizing in defined increments, and expose an accessible name such as `Resize Current Order`.

Mobile keeps the existing `Review & pay` overlay and has no resizable rail.

## 6. Required visual corrections from the Designer Skill review

The following previously identified issues remain required and are part of this refinement:

### Product cards

- Render real `product.description` when available; never synthesize copy.
- Clamp descriptions to about two lines while keeping 13–14px readable text.
- Remove or greatly soften the strong internal horizontal divider so the card reads as one cohesive product surface.
- Keep compact landscape anatomy: image left, name/description beside it, price lower-left, stepper lower-right.
- Improve the initials/media fallback treatment without inventing product images.
- Preserve the subtle selected border/tint and explicit quantity state.

### Typography hierarchy

Reduce the current excessive boldness.

Use the hierarchy from `DESIGN.md`:

- product names/headings: Semibold;
- controls/prices: Medium/Semibold;
- descriptions/body/labels: Regular/Medium;
- Bold reserved for final-total/emphasis cases.

The category text is intentionally increased as specified above.

### Category/search density

The default navigation area must be materially shorter than the current implementation because the full search input is hidden until invoked. Remove empty vertical whitespace and keep the family selector compact.

### Current Order hierarchy

- strengthen `Current Order` heading slightly;
- keep item actions visually attached to the item they affect;
- use divider-separated rows rather than nested cards;
- do not allow `Edit` / decrement controls to appear visually detached from the line during scroll.

### Payment composition

Even after the split-payment behavior change, payment should read as a checkout surface rather than a settings form:

- flatter grouping;
- less bold label noise;
- tighter vertical rhythm;
- clear Method A/Amount A and Method B/Amount B grouping;
- no unnecessary boxes.

### Checkout footer blocker

The totals/Place Order area must never overlay or obscure payment inputs.

Use structural layout rather than an overlapping sticky layer, e.g.:

- cart header;
- `minmax(0, 1fr)` independently scrollable body;
- normal footer row containing totals + Place Order.

The user must always be able to reach and read the last payment field.

## 7. Icon system

Use the verified Iconoir outline pair for these new controls:

- `iconoir:edit-pencil` for category editing;
- `iconoir:search` for search.

Use inline SVG/component assets from the verified icon source or the project's established icon pipeline. Do not add a full icon package solely for two icons if that increases bundle/dependency cost unnecessarily.

Both controls require accessible names/tooltips because they are icon-only actions.

## 8. Preference architecture boundaries

Worker category preferences are durable cross-device UI data and therefore require a small persistence/sync extension.

The implementation should prefer an isolated preference aggregate/store/service over embedding behavior in `OrdersWorkspace` or the worker authentication model.

Expected logical units:

- `WorkerUiPreferences` domain/value contract;
- local persistence store;
- application service to load/update/reset preferences;
- remote representation/API/sync path consistent with repository architecture;
- renderer hook/controller that merges preferences with current category configuration.

The exact file names are deferred to the implementation plan after repository inspection, but the boundary is not optional: UI rendering must not own remote persistence concerns.

Current Order width is deliberately excluded from this aggregate and remains device-local presentation state.

## 9. Error and offline behavior

### Category preference save

Local preference updates must take effect immediately after local persistence succeeds.

If remote sync is unavailable:

- do not block category editing;
- keep the locally saved preference;
- let normal sync retry later;
- do not show a modal interruption for a background sync failure.

If local persistence fails:

- do not pretend the preference was saved;
- revert or keep edit mode active with a concise non-destructive error;
- do not affect the active order draft.

### New categories/config changes

Preference reconciliation must be deterministic and safe even if a second device has an older category set.

## 10. Testing requirements

### Split payment

Test at minimum:

- total 400, Method A cash 320 → Method B remainder 80;
- Method A amount changes recompute remainder exactly;
- all-cash single payment still supports Cash received + Change;
- split mode has no Cash received A/B fields;
- split validation rejects amount above total;
- order placement still produces valid payment parts totaling exactly the order total.

### Category preferences

Test:

- worker A and worker B can have different order/alignment;
- worker A preference appears on a second device after sync/materialization;
- worker B is unaffected;
- offline edit persists locally and later syncs;
- new category appends correctly;
- removed category is ignored safely;
- Reset to default restores configuration order;
- keyboard reorder works;
- alignment Left/Center/Right renders correctly.

### Search/category toolbar

Test:

- search field is collapsed by default;
- search icon opens/focuses it;
- keyboard shortcuts open/focus the same field;
- Escape/clear restores compact state;
- category Edit and Search modes do not conflict.

### Current Order resizing

Test:

- mouse/pointer resize within min/max;
- keyboard resize;
- width survives reload on same device;
- width does not follow a worker to a second device;
- product grid reflows without horizontal overflow;
- mobile overlay remains unchanged.

### Visual regression/QA

At 375px, 768px, and 1440px verify:

- centered top navigation;
- increased canonical logo presence;
- readable category text and hit targets;
- compact toolbar with icon search;
- product descriptions and cohesive cards;
- Current Order line/action grouping;
- no checkout-footer overlap;
- split payment visual simplification;
- resized rail behavior on desktop;
- no horizontal overflow;
- light/dark/reduced-motion behavior remains coherent.

## 11. Deployment and workflow

Use a dedicated feature branch. Feature/fix branches must generate zero Vercel Preview Deploys. Do not manually deploy the feature branch.

Preserve the project workflow:

1. implementation on feature branch;
2. tests and rendered QA;
3. PR and permanent GitHub quality gate;
4. user reviews actual rendered screenshots;
5. only after explicit visual approval, squash merge to `main`;
6. exactly one production deployment from `main`;
7. production smoke verification.

## Non-goals

This refinement does not:

- redesign the established premium green palette;
- build TUX Admin;
- let workers edit canonical shop category definitions/names;
- add worker-controlled category hiding in this phase;
- sync Current Order width across devices;
- add a separate checkout page;
- add fake product content or images;
- change single-payment cash tender/change semantics;
- change order totals, tax/pricing policy, inventory, printing, or delivery business rules.

## Success criteria

The refinement is successful when:

- top navigation is truly centered and branding has appropriate presence;
- category controls are larger, denser, searchable on demand, and worker-personalizable;
- each worker receives their category order/alignment across devices;
- split payment matches the intended allocation mental model and removes irrelevant cash-received/change fields;
- Current Order width is comfortably resizable and remembered per device;
- all previously identified visual defects are resolved;
- no business workflow or local-first invariant regresses;
- the final rendered implementation passes Designer Skill review and receives explicit user visual approval before merge.