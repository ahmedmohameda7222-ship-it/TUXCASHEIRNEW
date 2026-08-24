# TUX Premium POS Redesign Design Spec

**Date:** 2026-08-24  
**Status:** Ready for user review  
**Design authority:** `DESIGN.md`

## 1. Goal

Redesign the TUX Operations POS shell and Orders experience into a premium, restrained, Apple-derived interface while preserving all existing business logic and cashier workflows.

The redesign must improve scan speed, visual hierarchy, state clarity, perceived quality, and responsive behavior without turning the product into a generic SaaS dashboard or decorative glass interface.

## 2. Scope

### Full redesign scope

- Main TUX Operations app shell/header
- Orders screen toolbar, category navigation, family segmented control, search, product grid, product cards, and Current Order rail
- Orders mobile presentation where it intersects with the same visual system
- Real sync-state presentation in the main shell
- TUX brand-mark usage
- Shared design tokens that affect global visual consistency

### Global visual changes

The following system-level changes may also appear on Orders Board, Expenses, and Bulk Stock because they are shared shell/system primitives:

- canonical TUX logo
- floating main navigation
- typography baseline
- neutral/premium-green token system
- focus/interaction styling
- sync status

### Explicitly out of scope

Do not redesign the internal content architecture of:

- Orders Board
- Expenses
- Bulk Stock
- End Day

Do not rewrite or alter:

- Supabase/Vercel gateway architecture
- local-first persistence semantics
- order domain logic
- pricing logic
- discount calculations
- delivery calculations
- payment calculations
- modifier/customizer logic
- receipt printing
- recovery/idempotency
- inventory business logic
- worker/session behavior

## 3. Visual direction

The approved visual direction is a high-density restaurant POS with premium restraint.

Apple is used as a design-principle reference only. The implementation should borrow:

- restrained floating material for top-level navigation
- precise spacing
- system typography hierarchy
- subtle hairlines and depth
- clear active/selected states
- direct-manipulation feedback
- progressive disclosure
- restrained motion

It must not copy Apple branding, proprietary font files, or literal component appearance.

The interface remains recognizably TUX through the canonical logo, premium botanical green accent, restaurant imagery, dense POS layout, and existing ordering workflow.

## 4. Canonical brand mark

The exact user-provided `favicon.svg` is the canonical TUX mark.

Implementation requirements:

- Add that exact asset to the application without redrawing it.
- Replace typed `TUX` brand marks in app-shell and bootstrap/sign-in surfaces.
- Preserve original proportions and artwork.
- Do not recolor unless the asset itself is designed to inherit color and the result is visually identical to the approved mark.
- Use the same canonical asset for the browser favicon.

## 5. Color system

All colors must resolve through semantic design tokens defined from `DESIGN.md`.

### Approved light palette

- Canvas: `#F8FAF9`
- Surface primary: `#FFFFFF`
- Surface secondary: `#F3F6F4`
- Text primary: `#181A19`
- Text secondary: `#707773`
- Border: `#E3E9E6`
- Primary action green: `#1F6B52`
- Primary hover: `#195F48`
- Primary pressed: `#14533F`
- Primary soft: `#EAF4EF`
- Primary hover-soft: `#F3F8F5`
- Success: `#2B7A55`
- Warning: `#A86400`
- Error/destructive: `#B42318`

The product remains visually white, but the page canvas is near-white rather than literal `#FFFFFF`. White surfaces sit above the canvas with hairlines and restrained depth.

### Dark palette

Dark/system theme support must remain coherent using the semantic values defined in `DESIGN.md`. Dark mode is not a separate elaborate visual concept; it is a first-class token mapping of the same component architecture.

## 6. Typography

Use Apple HIG-derived system typography through the system font stack:

```css
font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
```

Do not bundle SF Pro or other Apple font files.

Use the hierarchy in `DESIGN.md`:

- Section title: 22px/26px Semibold
- Product name: 15–16px/20px Semibold
- Navigation: 14px/18px Medium
- Body: 14px/19px Regular
- Product description: 13–14px/18px Regular
- Price: 14–15px/18px Semibold
- Button/segmented control: 14px/18px Medium or Semibold
- Secondary metadata: 12px/16px Regular
- Total: 20–22px/26px Semibold or Bold

All monetary and quantity values use tabular numerals.

## 7. Main floating header

### Structure

The existing main shell navigation remains functionally intact:

- TUX logo
- Orders
- Orders Board
- Expenses
- Bulk Stock
- sync status
- operator menu

### Presentation

The header becomes an inset floating navigation layer rather than an edge-to-edge strip.

Required characteristics:

- visible outer margin from viewport top and sides
- rounded top-level geometry
- restrained translucent white material in light theme
- backdrop blur only on this top-level navigation layer
- hairline border
- soft low-elevation shadow
- opaque fallback under reduced-transparency conditions
- compact height appropriate to a productivity tool

The active navigation item uses a subtle premium-green soft state, not a heavy filled button.

### Theme control

The current visible `Theme: Light`-style control should not remain as persistent header text.

Appearance selection should move into the operator/account menu as a clearly labeled control such as `Appearance: System / Light / Dark`. Do not replace it with an unexplained icon-only sun/moon button.

## 8. Sync status

Replace the static `Local-first` label with truthful user-facing sync state.

Approved visible states:

- `Synced`
- `Syncing…`
- `Offline`

State presentation must include text plus a meaningful icon; color is supporting information only.

### Semantics

- `Synced`: most recent automatic sync cycle completed successfully with no transient delivery failure.
- `Syncing…`: an automatic cycle is actively running. To avoid a distracting 15-second flicker, delay rendering this label for approximately 400ms; fast successful cycles remain visually `Synced`.
- `Offline`: browser/network or transient transport failure prevents current synchronization.

Permanent/quarantined domain delivery errors must continue through existing error handling and must not be falsely represented as ordinary connectivity `Offline`.

The existing local-first architecture remains unchanged; only its status observability becomes user-facing.

## 9. Category and search navigation

Below the main header, render a second floating navigation surface containing:

- active menu categories
- product search at the trailing edge

This surface is primarily opaque `Surface primary`/`Surface secondary`, not another full glass layer.

### Category behavior

- Preserve existing category filtering behavior.
- Use text-first category labels.
- Do not add decorative icons to every category unless a future usability decision proves they improve recognition.
- Selected category uses a restrained premium-green active state.

### Search

- Preserve search behavior and keyboard shortcuts, including `Ctrl/Cmd + K` and `/`.
- Search remains visually integrated with the category surface.
- Focus state must be obvious and keyboard accessible.

## 10. Product-family segmented control

The dynamic product-family control (`All`, plus configured families such as `TUX` and `TUXIFY`) remains.

Presentation:

- compact segmented control
- content-width, not full-width
- positioned directly below or visually attached to the category/search region
- selected state uses soft action-green treatment
- 44px minimum interactive target height/area where practical

## 11. Product-card anatomy

This is the primary approved card pattern.

Each card is a compact landscape product unit, not a square tile and not a long list bar.

### Layout

```text
┌──────────────────────────────────┐
│ [image]  Product name            │
│ [small]  Short real description  │
│                                  │
│ EGP 160.00             −  1  +   │
└──────────────────────────────────┘
```

### Required anatomy

- small product image on the left, approximately 80–96px depending on responsive width
- product name to the right of the image
- real product description beneath the name, max two lines
- price anchored bottom-left
- direct `− quantity +` stepper anchored bottom-right
- card radius between 12px and 16px
- hairline border
- little or no shadow
- true-white product surface in light theme

### Description rules

- Render `product.description` when provided.
- Never invent placeholder marketing copy.
- If description is null, retain layout stability without fake text.

### Image rules

- Continue supporting the existing `imageKey` mechanism.
- Continue supporting a polished fallback when an image is absent or fails.
- Do not fabricate production product photography in code or seed data without explicit approval.

### Selected state

When quantity > 0:

- keep the card predominantly white/neutral
- use a subtle action-green hairline/soft tint
- quantity value must visibly communicate state
- do not fill the full card green

### Sold-out state

- remain clearly disabled
- retain explicit text/state, not color-only communication
- preserve accessibility semantics and disabled behavior

## 12. Product-grid responsiveness

The product grid responds to the width of the product pane, not to a hard-coded aesthetic rule.

Target container behavior:

- <600px: 1 column
- 600–899px: 2 columns
- 900–1279px: 3 columns
- >=1280px: 4 columns only if the product pane actually has sufficient width

A normal 14–16 inch laptop with the Current Order rail open should resolve naturally to approximately three columns.

The grid must never create horizontal overflow.

## 13. Current Order rail

The Current Order remains a persistent right-side rail on desktop and a review/pay overlay on mobile.

### Structural treatment

- opaque secondary/primary surface
- clear separation from product pane
- rounded outer boundary where appropriate
- no glass
- no nested-card stack
- restrained border/elevation only where needed to separate regions

### Header

Contains:

- `Current Order`
- item count
- `Clear`

### Order type

Keep the existing configured order-type options, such as:

- Take Away
- Dine In
- Delivery

Use a compact segmented control.

### Cart lines

Replace card-inside-card styling with divider-separated rows.

Each row presents:

- quantity
- product name
- modifier/combo/note metadata when present
- line total
- secondary actions such as Edit and remove/decrement

Preserve all existing line-editing behavior and accessible controls.

## 14. Notes and discount

Secondary order editing uses progressive disclosure.

Default presentation should resemble compact rows such as:

- `Add order note`
- `Discount · EGP 0`

Activation reveals the existing editor/input in place or in a tightly anchored disclosure region.

Do not keep large textarea/money-input blocks permanently consuming rail space when they are unused.

## 15. Delivery workflow

Delivery functionality remains fully intact.

When Delivery is selected, expose the existing fields in the Current Order rail:

- Phone
- Customer name
- Zone
- Full address
- Delivery fee
- existing reference/customer lookup information where applicable

The section must remain easy to scan and must preserve current validation and lookup behavior.

## 16. Payment workflow

Payment remains in the same one-screen order rail; do not introduce a new `Proceed to Payment` page.

Preserve existing support for:

- Cash
- Instapay/digital payment
- split payment
- amount tendered
- change calculation
- tender suggestions

The visual treatment may become more compact, but labels, interaction semantics, and tested behavior must remain intact.

## 17. Totals and primary action

The bottom of the order rail remains sticky and contains the financial summary plus the single dominant action.

Hierarchy:

```text
Subtotal                 EGP xxx
Discount                 EGP xxx
Delivery                 EGP xxx

Total                    EGP xxx

[ Place Order · EGP xxx ]
```

Requirements:

- Total receives strong typographic emphasis.
- `Place Order` is the strongest action-green object in the view.
- White text on light-theme `#1F6B52` is permitted because the contrast ratio is sufficient for normal text.
- Dark theme uses its dedicated action foreground defined in `DESIGN.md`.
- No competing secondary action may visually rival Place Order.

## 18. Motion and feedback

- Press feedback: 100–150ms
- Hover/selection transitions: 150–250ms
- No bouncing or looping decorative motion
- No hover transformations that shift layout
- Respect `prefers-reduced-motion`
- Product quantity and segmented-control changes should feel direct and immediate

## 19. Accessibility

The redesign must preserve or improve:

- semantic roles
- keyboard access
- visible focus
- accessible control names
- 44×44px primary interaction targets
- WCAG AA contrast for functional text and controls
- non-color state cues
- disabled/sold-out semantics
- responsive zoom/text behavior

Existing E2E selectors based on accessible labels should be preserved wherever possible. Change them only when the visible/accessible language is intentionally redesigned and the tests are updated in the same task.

## 20. Responsive behavior

### Desktop / laptop

- floating main header
- floating category/search surface
- product-family segmented control
- responsive product grid
- persistent Current Order rail

### Tablet

- product grid reduces column count based on product-pane width
- header/navigation compresses without overlapping
- Current Order may remain persistent only when width permits; otherwise use the existing overlay pattern

### Mobile

- preserve the current `Review & pay` trigger and cart overlay workflow
- use the same typography, tokens, cart-row design, and action hierarchy
- do not force the desktop rail beside the menu

Verification widths:

- 375px
- 768px
- 1440px

No horizontal page overflow is acceptable.

## 21. Component boundaries

The implementation plan should favor targeted component boundaries without unrelated architectural churn.

Expected design units:

- canonical `BrandLogo` component
- sync-status presentation/state adapter
- app-shell navigation styling
- Orders category/search toolbar
- Orders product card
- product-grid layout
- Current Order rail presentation
- progressive note/discount editors

Existing business-state ownership in `OrdersWorkspace` and `OrdersCart` remains unless extracting a presentational component clearly reduces complexity without changing state contracts.

## 22. Existing implementation areas expected to change

The plan should account for at least these current areas:

- `apps/operations/src/app/App.tsx`
- `apps/operations/src/app/BrowserBootstrapGate.tsx`
- `apps/operations/src/app/OrdersWorkspace.tsx`
- `apps/operations/src/app/OrdersCart.tsx`
- `apps/operations/src/app/automaticSync.ts`
- `packages/sync/src/scheduler.ts`
- `apps/operations/src/styles/premium.css`
- `apps/operations/index.html`
- relevant unit/integration tests
- `e2e/operations.e2e.ts`

The implementation plan may split presentational components into focused files when this improves readability and testability.

## 23. Sync implementation constraint

The scheduler currently reports only completed results. The implementation may add a minimal lifecycle callback such as `onStart` so the UI can observe an active sync cycle.

This is an observability/interface extension only. It must not change:

- sync scheduling cadence
- retry behavior
- outbox ordering
- transport semantics
- local transaction boundaries
- delivery/quarantine logic

The UI adapter should delay visible `Syncing…` state by about 400ms so normal fast cycles do not cause periodic flicker.

## 24. Testing and verification requirements

The implementation plan must include tests for both behavior preservation and new presentation contracts.

Required gates:

- formatting
- lint
- typecheck
- unit/integration tests
- production build
- existing provisioning/migration smoke tests where part of CI
- Deno/server function checks where part of CI
- Playwright desktop checkout flows
- Playwright mobile checkout flows
- no console/page errors
- no horizontal overflow
- sync-status state tests
- visual QA at the accepted laptop target plus 375px, 768px, and 1440px
- light/dark theme sanity check
- reduced-motion check

Existing tested flows that must remain operational include:

- product add/customize
- sold-out behavior
- mobile Review & pay
- Cash
- Instapay
- split payment
- Delivery fields
- Place Order
- Orders Board navigation
- Expenses navigation
- Bulk Stock navigation
- End Day/operator menu

## 25. Deployment workflow

Implementation must follow the repository's existing deployment constraint:

1. Work only on a feature branch.
2. Feature/fix branches must generate zero Vercel Preview Deploys.
3. Run CI and visual/functional QA on the branch.
4. Open/review the PR.
5. Squash merge into `main` only after all gates pass.
6. Exactly one production deployment should come from `main`.
7. Verify production readiness and HTTP success after merge.

No manual feature-branch Vercel deployment is permitted.

## 26. Acceptance criteria

The redesign is accepted only when all of the following are true:

- the exact canonical TUX logo is used
- the brown/beige visual system is removed from the redesigned shell/Orders experience
- the approved premium-green token system is applied correctly
- main navigation feels floating/premium without excessive glass
- category/search navigation is distinct but primarily opaque
- product cards match the approved compact landscape anatomy
- real descriptions display when available
- price and quantity controls occupy predictable bottom positions
- typical laptop layout resolves to approximately three product columns without hard-coding the entire app to three columns
- Current Order uses flat divider-separated rows instead of nested cards
- notes and discount use progressive disclosure
- delivery and payment behavior remain intact
- Place Order is the single dominant CTA
- `Local-first` is no longer shown to cashiers
- real `Synced / Syncing… / Offline` status is surfaced truthfully
- keyboard shortcuts remain functional
- dark/system theme remains coherent
- reduced motion is respected
- no horizontal overflow exists at required widths
- existing business tests and checkout E2E flows remain green

## 27. Non-goals

This redesign does not attempt to:

- redesign every non-Orders content screen
- change order/payment business rules
- add new product photography
- invent product descriptions
- introduce a new icon library solely for aesthetics
- copy Apple UI literally
- create a second checkout screen
- replace the persistence/sync architecture
- change deployment policy
