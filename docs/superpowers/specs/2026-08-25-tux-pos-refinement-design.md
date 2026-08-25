# TUX Operations POS Refinement Design

## Status

Design decisions approved in chat. This written spec is ready for final user review before the implementation-plan stage.

This refinement follows the premium green POS redesign merged in PR #26. It narrows and extends `DESIGN.md`; it does not reopen the established palette, material system, or one-screen POS direction.

## Goal

Improve cashier speed, legibility, personalization, welcome-state clarity, product customization, and checkout flow without weakening local-first guarantees or existing business rules.

The refinement has these product goals:

1. balance and clarify the header/navigation;
2. make category navigation faster to scan, search, and personalize;
3. simplify cash and split-payment interaction around the cashier mental model;
4. reorder Current Order around the real transaction workflow;
5. surface existing Extras/modifier capability directly from menu cards and cart lines;
6. make the welcome state intentional rather than transient;
7. let each device keep a comfortable Current Order width;
8. resolve the visual issues identified in the post-implementation Designer Skill review.

## Scope and architecture boundaries

This refinement changes presentation plus four narrowly scoped behavior areas:

- worker-specific category layout preferences, synced across devices;
- device-local Current Order width preference;
- payment-entry semantics for optional cash tender and split allocations;
- welcome-state and modifier-entry interaction.

Existing modifier/pricing configuration remains the source of truth for Extras. Do not create a second extras/pricing subsystem.

All order pricing remains integer-minor-unit arithmetic. Inventory, printing, Orders Board, Expenses, Bulk Stock, End Day, delivery pricing policy, and canonical shop configuration remain unchanged unless explicitly described below.

---

## 1. Header refinement

### Navigation placement

`Orders`, `Orders Board`, `Expenses`, and `Bulk Stock` must be visually centered in the true horizontal center of the floating header, independent of logo and trailing-action widths.

Use a three-zone structure:

- leading: canonical TUX logo;
- center: Operations navigation;
- trailing: sync status + operator menu.

At narrower widths, collision avoidance outranks mathematical centering; the normal desktop/laptop state should remain truly centered.

### Logo

Use the canonical original TUX SVG unchanged. Increase rendered presence roughly 15–25% from the current implementation, preserving exact aspect ratio and colors.

---

## 2. Approved typography and control sizing

The Apple Docs review and Designer Skill review agree on the direction: **slightly larger, materially less bold, and more consistent**.

Use the system stack only; do not bundle SF Pro:

```css
font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
```

Approved hierarchy:

- final monetary amount: **22px / 26px Bold**;
- Current Order title: **17px / 22px Semibold**;
- primary action text: **16px / 20px Semibold**;
- product/cart item names: **15px / 20px Semibold**;
- top navigation/categories: **15px / 20px Medium**, active/selected Semibold;
- standard controls/prices: **14px / 18px Medium**;
- body/product descriptions/input values/payment values: **14px / 18px Regular**;
- operational metadata/form labels: **13px / 16px Regular or Medium**;
- tertiary hints only: **12px / 15–16px Regular**.

Specific rules:

- product description: 14/18 Regular, max about two lines;
- product price: 14/18 Medium;
- quantity value: 14–15/18 Semibold;
- subsection headings such as `Payment` and `Notes & discount`: 14/18 Semibold;
- form labels: 13/16 Medium;
- subtotal labels: 14/18 Regular;
- subtotal values: 14/18 Medium;
- final Total label: 18/22 Semibold;
- Place Order: 16/20 Semibold, minimum 48px visible height.

Supporting metadata such as `3 items` is Regular by default; use Medium only when needed for operational emphasis.

Use tabular numerals for prices, quantities, discounts, tenders, payment allocations, change, and totals:

```css
font-variant-numeric: tabular-nums;
```

Do not use a full monospace font for monetary labels.

High-frequency controls use at least a 44×44px effective target: categories, search/edit icon buttons, product steppers, repeated payment controls, and comparable actions.

---

## 3. Category/search refinement

### Default category bar

Remove the persistent search input from the default state.

The category surface contains:

- category buttons;
- trailing Edit Categories icon action;
- trailing Search icon action.

It remains primarily opaque, not a second glass layer.

### Category sizing

- label: 15/20 Medium;
- active: 15/20 Semibold;
- minimum target height: 44px;
- horizontal padding: about 14–18px.

### Search progressive disclosure

Approved Supericons references:

- search: `iconoir:search`;
- category edit: `iconoir:edit-pencil`.

Search behavior:

- default state shows only the icon;
- activation expands the input inline and immediately focuses it;
- `Ctrl/Cmd + K` and `/` open/focus the same state;
- Escape closes when appropriate;
- clear resets the query and collapses the search surface;
- Search and Edit Categories modes are mutually exclusive.

The accessible label remains `Search menu` or `Search products` as required by the existing application contract.

---

## 4. Editable category layout

### Preference ownership

Category layout is a **per-worker preference synced across devices**.

Persist an isolated worker UI-preference record containing at minimum:

- worker ID;
- ordered category ID list;
- alignment: `left | center | right` (logical CSS start/center/end is acceptable internally);
- update/version timestamp required by the existing local-first synchronization model.

Do not embed this inside core worker business/profile data.

### Reconciliation

If no preference exists, use configured category order.

When configuration changes:

- still-active saved category IDs keep worker order;
- newly active categories append after saved categories in configuration order;
- removed/inactive categories are ignored safely;
- `Reset to default` removes the override and restores configuration order/alignment.

### Edit mode

Edit Categories transforms the existing category surface inline; no separate modal.

Provide:

- direct drag/reorder;
- keyboard-accessible Move left / Move right equivalent;
- alignment segmented control: Left / Center / Right;
- Reset to default;
- Done.

Drag must never be the only reorder mechanism.

### Sync behavior

Preference changes commit locally first, remain usable offline, and sync later through a dedicated preference persistence/sync boundary. UI rendering must not own remote persistence concerns.

---

## 5. Money-input behavior

Zero-valued optional money fields must not display `0.00` as editable content.

When the logical value is zero and the field has no explicit user-entered amount:

- render the input text empty;
- show placeholder `0` only;
- clicking/focusing lets the worker type immediately without first deleting `0.00`;
- leaving the optional field empty resolves to logical zero;
- non-zero values render normally.

Apply this behavior where zero is a valid empty/default state, including Cash received, Discount, Split Amount A, and comparable optional money-entry surfaces. Required money fields may keep explicit validation rules.

Do not use placeholder `0.00`.

---

## 6. Welcome screen after successful PIN

### Persistent welcome state

The current auto-dismiss timer is removed.

After every successful worker PIN entry, show the welcome state and keep it visible until the worker explicitly activates the primary welcome action. There is no 1.25-second automatic transition.

The button is a UI transition into Operations. It must not imply a second business-day start or a second authentication event.

### Time-aware greeting

Use the local device time:

- 00:00–11:59 → `Good morning, {name}.`;
- 12:00–17:59 → `Good afternoon, {name}.`;
- 18:00–23:59 → `Good evening, {name}.`.

Do not use `Good night` as the login greeting.

`Glad you made it in safely.` remains the stable supporting line.

### Motivational copy shuffle

At each successful PIN, independently select one motivational line and one primary-button label from the approved local copy pools below.

Motivational lines:

1. `Let’s make today a great one.`
2. `You’ve got this.`
3. `Make today count.`
4. `Let’s make it a great one.`
5. `Own the day.`
6. `Ready to make it happen?`
7. `Bring your best.`
8. `Let’s make today a win.`
9. `Here’s to a great day ahead.`
10. `Make today a good one.`
11. `Here’s to a smooth one.`
12. `Good things ahead.`
13. `Ready when you are.`

Primary button labels:

1. `I’m Ready`
2. `Let’s Do This`
3. `Get Going`
4. `Start Strong`
5. `Make It Happen`
6. `On We Go`
7. `Here We Go`
8. `I’m In`
9. `Let’s Begin`
10. `Go`
11. `Let’s Roll`

Rules:

- the two selections are independent;
- there is no fixed phrase/button pairing and no fixed sequence;
- avoid immediately repeating the same motivational line or button label on two consecutive successful PIN entries within the running app session;
- the copy pool is product UI copy, not shop/business configuration and does not require remote sync.

---

## 7. Single-cash payment semantics

### Cash received is optional

For a single Cash payment, `Cash received` is a cashier calculator helper, not a required business input.

If the worker selects Cash and leaves Cash received empty:

- treat received amount as exactly the allocated/order total;
- persisted/prepared cash part resolves to `received = allocated` and `change = 0`;
- Place Order remains valid.

If the worker explicitly enters Cash received:

- received must be >= allocated total;
- calculate change = received − allocated;
- show the helper change result.

Do not show a misleading Change row merely because an empty Cash received field is normalized to exact payment internally.

### Smart tender suggestions

Tender suggestions must help with Egyptian note-size rounding, including 10 and 20 EGP steps rather than only 50/100/200.

Use candidate rounding steps:

- 10 EGP;
- 20 EGP;
- 50 EGP;
- 100 EGP;
- 200 EGP.

The suggestion set is:

1. exact total first;
2. each unique rounded-up amount from the configured steps;
3. sorted ascending;
4. duplicates removed.

Examples:

- total 705 → `705`, `710`, `720`, `750`, `800`;
- total 715 → `715`, `720`, `750`, `800`;
- total 763 → `763`, `770`, `780`, `800`.

Exact total is explicitly labeled/understood as exact payment and does not need to be representable as a single denomination.

---

## 8. Split payment correction

Split payment allocates the total across two methods; it is not a tender/change editor.

Example:

- total EGP 400;
- Method A Cash = EGP 320;
- Method B Instapay = EGP 80 remainder.

Split UI:

- Method A;
- Amount A, cashier-entered;
- Method B, different method;
- Amount B, automatic remainder = total − Amount A.

Remove `Cash received A`, `Cash received B`, and per-leg Change from split mode.

Domain normalization for a Cash split leg is:

- allocated = that leg’s allocation;
- received = allocated;
- change = 0.

This is a domain-contract change, not merely hiding fields. Remove split cash-received fields from `PaymentDraft` and update parsing/validation/preparation/tests accordingly. Single-cash optional tender semantics remain separate as defined above.

Validation rejects Amount A < 0, Amount A > total, unavailable/identical methods where forbidden, and any allocation state that does not resolve exactly to total.

No floating-point money arithmetic.

---

## 9. Current Order workflow and line actions

### Section order

Reorder the right rail to follow the transaction mental model:

1. **Items**;
2. **Order type** (`Take Away`, `Dine In`, `Delivery`, etc.);
3. **Delivery details** immediately under Order type only when Delivery is selected;
4. **Notes & discount**;
5. **Payment**;
6. totals + Place Order footer.

### Item-line controls

Keep actions visually attached to the line they affect.

Every cart line provides compact direct controls:

- `−1`;
- `+1`;
- `Edit`.

`+1` means **add one identical unit of this cart line**, preserving that line’s optional modifiers/extras, note, and required configuration. Implementation may increase quantity when safe or add a new equivalent line where the domain requires per-unit configuration; the semantic result must be one additional identical unit.

The menu-card `+` remains a fresh/default add. For products with mandatory configuration such as combo drinks, it may still open the required customizer; “default” means no optional extras unless selected.

### General Edit versus Extra shortcut

`Edit` remains the general full-item customization action for notes, required combo choices, and extras.

A separate contextual Extra shortcut may open the same existing ProductCustomizer focused on the Extras section. Do not duplicate the modifier editor.

---

## 10. Extras/modifier entry from menu cards

The repository already has modifier configuration, modifier pricing, product-modifier links, and `ProductCustomizer`. Reuse them.

### Product card action

For products with at least one active allowed modifier, show a compact Extra action near the price/footer controls.

Approved Supericons:

- add extras: `iconoir:plus-circle` + text `Extra`;
- edit existing extras: `iconoir:edit-pencil` + text `Extra`.

Do not use an abstract package/cart icon for this action.

Activating `Extra` opens the existing ProductCustomizer directly at/focused on Extras for a new single unit.

The worker can select multiple different extras and quantities, subject to existing link/maxQuantity rules. Modifier prices add to the product line total through existing pricing logic.

### Reset after customized add

After a customized item is successfully added and the customizer closes, the next fresh product-card add starts from default optional extras again. The previous extra selection must not leak into the next sandwich/item.

### Product quantity badge/state

When a product exists in Current Order, show its aggregate current-order quantity clearly on the product card (for example a compact badge near the top edge). The count includes plain and customized lines for the same product ID.

The existing direct quantity controls remain available; the badge is a fast scan cue for cart presence.

### Current Order Extra shortcut

For cart lines whose product supports modifiers:

- no selected modifiers → show `plus-circle Extra`;
- one or more selected modifiers → show `edit-pencil Extra`.

Both open the same ProductCustomizer on that existing line, focused on Extras. The normal `Edit` action remains available for full customization.

Modifier names and prices shown in Current Order come from the existing line snapshots; do not synthesize extra names/prices.

---

## 11. Resizable Current Order rail

On desktop/laptop, resize the Current Order rail by dragging its left edge.

Target range:

- minimum about 360px;
- default about 420–440px;
- maximum about 600px or 45vw, whichever is lower.

The product grid must reflow naturally based on remaining container width.

### Persistence

Cart width is **per-device only**. Store it locally on the browser/desktop device. Do not sync it or attach it to the worker profile.

### Accessibility

Provide a usable pointer hit target and keyboard resizing when focused, with an accessible name such as `Resize Current Order`. Mobile keeps the Review & pay overlay and no resizable rail.

---

## 12. Required visual corrections from the Designer Skill review

### Product cards

- render real `product.description` when available; never synthesize copy;
- omit description space when none exists rather than inserting fake text;
- clamp descriptions to about two lines at 14/18 Regular;
- remove/greatly soften the strong internal divider;
- preserve compact landscape anatomy: image left, copy beside it, price and actions at the bottom;
- improve initials/media fallback without inventing images;
- preserve subtle selected border/tint and explicit quantity state.

The Quick Info surface must also avoid fake description copy such as “No product description has been added yet.” when the product has no description.

### Weight hierarchy

Reduce excessive Bold/Semibold usage. Regular is the default for body, descriptions, input/payment values, and metadata. Medium is the default for controls/prices/labels. Semibold is for selected navigation, product/cart names, section anchors, and primary actions. Bold is exceptional, primarily the final Total amount.

### Category/search density

The default category/navigation surface should be materially shorter after search becomes progressive. Remove empty vertical whitespace and keep product-family segmentation compact.

### Current Order hierarchy

- strengthen Current Order to 17/22 Semibold;
- keep line actions and Extra shortcuts visually attached to each item;
- use divider-separated rows rather than nested cards;
- never let actions appear detached because of scrolling or spacing.

### Payment composition

Payment should read like checkout rather than a settings form: flatter grouping, less label weight, tighter rhythm, and clear allocation/tender hierarchy.

### Checkout footer blocker

Totals/Place Order must never overlay payment fields.

Use structural layout:

- cart header;
- independently scrollable body using `minmax(0, 1fr)` or equivalent;
- normal footer row for totals + Place Order.

The last payment field must always be fully reachable and readable.

---

## 13. Icon system

Use one Iconoir outline language for the new compact controls:

- Search: `iconoir:search`;
- Edit Categories: `iconoir:edit-pencil`;
- Add Extra: `iconoir:plus-circle` + visible `Extra` label;
- Edit Extra: `iconoir:edit-pencil` + visible `Extra` label.

Use verified inline SVG/component assets or the established project icon pipeline. Do not add a large icon dependency solely for these icons.

Icon-only Search/Edit Categories controls need explicit accessible names and tooltips. Extra controls include visible text plus accessible names.

Use literal `−1` and `+1` for cart line decrement/increment because they communicate quantity change faster than decorative iconography.

---

## 14. Error and offline behavior

### Worker category preferences

If remote sync is unavailable, locally saved preferences remain active and sync later. Do not block ordering or show a modal for background preference sync failure.

If local preference persistence fails, do not pretend it saved; keep/revert edit state with a concise non-destructive error. Never affect the active order draft.

### Money/tender input

- empty optional Cash received is valid exact payment;
- explicit invalid numeric text remains a field error;
- explicit received < allocation is a payment validation error;
- split Amount A remains validated independently.

### Extras

If modifier configuration changes while an order is open, existing snapshot behavior and current domain validation remain authoritative. Do not silently invent unavailable modifiers.

---

## 15. Testing requirements

### Welcome

Test:

- successful PIN enters persistent Greeting state;
- no auto-dismiss timer remains;
- primary welcome action enters Operations;
- morning/afternoon/evening boundaries;
- motivational phrase and button label are independently selected;
- no immediate same-phrase/same-button repeat in consecutive successful PIN events during the running app session;
- all approved copy strings are reachable.

### Money input and single Cash

Test:

- zero optional field renders empty with placeholder `0`;
- first keystroke enters directly without clearing `0.00`;
- blank optional Cash received places an exact Cash payment;
- explicit 500 on total 400 produces change 100;
- explicit received below total is rejected;
- prepared/persisted exact Cash normalizes received=allocated and change=0.

### Smart tender suggestions

Test examples exactly:

- 705 → 705, 710, 720, 750, 800;
- 715 → 715, 720, 750, 800;
- 763 → 763, 770, 780, 800;
- suggestions are unique, ascending, and never below total.

### Split payment

Test:

- total 400, Method A Cash 320 → Method B remainder 80;
- split mode contains no Cash received A/B state or UI;
- Cash split legs normalize received=allocated/change=0;
- Amount A recomputes remainder exactly;
- Amount A above total is rejected;
- payment parts exactly total the order.

### Current Order workflow

Test:

- Items renders before Order type;
- Delivery details appear directly after Order type when selected;
- Notes & discount precedes Payment;
- each line has −1, +1, Edit;
- +1 adds one identical configured unit;
- line actions remain associated with the correct line.

### Extras

Test:

- Extra action only appears for products with active allowed modifiers;
- multiple extras and modifier quantities can be selected;
- modifier price affects line/order total through existing pricing logic;
- customized add is followed by clean/default optional-extra state for the next new add;
- product aggregate badge/count includes plain and customized instances;
- product-card + adds a fresh/default unit;
- cart `plus-circle Extra` becomes `edit-pencil Extra` when modifiers exist;
- Extra shortcut and general Edit both reuse ProductCustomizer rather than separate modifier state;
- maxQuantity and inactive/unavailable modifier rules remain enforced.

### Category preferences/search

Test worker isolation, cross-device sync, offline save/retry, configuration reconciliation, reset, keyboard reorder, alignment, search progressive disclosure, shortcuts, and mutually exclusive edit/search modes.

### Current Order resizing

Test pointer and keyboard resize, min/max clamp, same-device reload persistence, non-sync across devices, product-grid reflow, mobile behavior, and no horizontal overflow.

### Typography/visual QA

At 375px, 768px, and 1440px verify:

- true centered desktop navigation;
- larger canonical logo;
- approved 15/20 nav/category sizing and 44px targets;
- operational metadata is not below the approved hierarchy unless tertiary;
- product descriptions and Extra action fit without card bloat;
- Current Order line grouping and new section order;
- no checkout-footer overlap;
- split/single-cash clarity;
- resizable desktop rail;
- light/dark/reduced-motion coherence;
- no horizontal overflow.

---

## 16. Deployment and workflow

Use the existing dedicated feature branch. Feature/fix branches must generate zero Vercel Preview Deploys and must not be manually deployed.

Workflow:

1. implementation on feature branch;
2. tests and rendered QA;
3. PR and permanent GitHub quality gate;
4. user reviews actual rendered screenshots;
5. only after explicit visual approval, squash merge to `main`;
6. exactly one production deployment from `main`;
7. production smoke verification.

---

## Non-goals

This refinement does not:

- redesign the premium green palette;
- build TUX Admin;
- let workers rename canonical shop categories;
- add worker category hiding in this phase;
- sync Current Order width;
- create a separate checkout page;
- create a second Extras/modifier/pricing model;
- add fake product descriptions or images;
- change inventory or printing semantics;
- turn welcome copy into attendance/time-clock logic;
- persist motivational copy choices remotely.

## Success criteria

The refinement is successful when:

- header navigation is truly centered and branding has appropriate presence;
- Apple-reviewed typography is more readable and less uniformly bold;
- category controls are searchable on demand and personalized per worker across devices;
- zero money fields no longer force deletion of `0.00`;
- the welcome state remains until worker intent and uses fresh approved motivational copy;
- single Cash can be completed without Cash received while still offering fast tender/change assistance;
- split payment reflects allocation rather than per-leg tender entry;
- Current Order follows Items → Order type/Delivery → Notes & discount → Payment;
- cart lines have fast −1/+1/Edit controls;
- Extras are available directly from menu cards and cart lines through the existing modifier system;
- Current Order width is resizable and remembered per device;
- all identified visual defects are resolved;
- no local-first or business invariant regresses;
- final rendered implementation passes Designer Skill review and explicit user visual approval before merge.
