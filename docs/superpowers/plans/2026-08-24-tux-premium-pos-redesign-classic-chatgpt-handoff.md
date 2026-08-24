# TUX Premium POS Redesign — Classic ChatGPT Implementation Handoff

## Role

You are the **implementation owner** for the approved TUX Operations premium POS redesign.

Repository: `ahmedmohameda7222-ship-it/TUXCASHEIRNEW`

Implementation branch: `ui/tux-premium-pos-redesign`

This is an **execution chat**, not a new design/planning chat.

## Required process

Use `@Superpowers` throughout this implementation.

1. Read the Superpowers `using-superpowers` instructions.
2. Because the design/spec/plan are already approved, use **Superpowers `executing-plans`** to execute the attached implementation plan task-by-task.
3. Do **not** invoke brainstorming or writing-plans again unless a genuine contradiction invalidates the approved plan.
4. Use test-driven development for behavior/interface changes and verification-before-completion before claiming a task is finished.
5. Work one task at a time. After every task, report files changed, tests/evidence actually run, commit SHA, and next task.

Do not re-audit the whole product and do not propose a different visual direction before starting.

## Read these sources before editing

```text
DESIGN.md
docs/superpowers/specs/2026-08-24-tux-premium-pos-redesign-design.md
docs/superpowers/plans/2026-08-24-tux-premium-pos-redesign.md
docs/TUX_V2_Operations_Master_Approved_Plan.md
docs/IMPLEMENTER_CONTEXT.md
docs/adr/0002-electron-security-boundary.md
docs/adr/0003-local-first-storage.md
docs/adr/0006-outbox-sync.md
docs/adr/0009-outbox-aggregate-dependency-and-monotonic-materialization.md
```

Read **all files** inside the attached Designer Skill ZIP before UI/UX changes. View the attached accepted laptop mock before styling.

## Authority order

1. latest explicit instruction from the user in the implementation chat;
2. `DESIGN.md`;
3. approved redesign spec;
4. attached implementation plan;
5. TUX V2 Master Approved Plan and established architecture/ADRs;
6. Designer Skill general heuristics;
7. accepted visual mock.

The mock guides composition and feel; it does not override business behavior.

## Non-negotiable visual direction

### Color

```text
Canvas                  #F8FAF9
Surface primary         #FFFFFF
Surface secondary       #F3F6F4
Text primary            #181A19
Text secondary          #707773
Border                  #E3E9E6
Action green            #1F6B52
Action hover            #195F48
Action pressed          #14533F
Action soft             #EAF4EF
Action hover-soft       #F3F8F5
Success                 #2B7A55
Warning                 #A86400
Error/destructive       #B42318
```

Action green means action/current selection/focus. Success uses its own semantic token. No beige, brown, bright emerald SaaS palette, gold, or decorative multicolor system.

### Typography

```css
font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
```

Do not bundle SF Pro or any Apple font. Follow the hierarchy in `DESIGN.md`; money/quantities use tabular numerals.

### Main header

- inset/floating;
- restrained premium rounded geometry;
- translucent material and subtle backdrop blur;
- this is the only primary glass layer;
- hairline and low elevation;
- canonical TUX logo leading;
- Orders / Orders Board / Expenses / Bulk Stock behavior unchanged;
- truthful sync state;
- operator menu trailing;
- Appearance System/Light/Dark inside operator menu, not icon-only.

### Category/search

- floating below header;
- mostly opaque, not another glass layer;
- text-first categories;
- Search trailing;
- no decorative category icons;
- compact All/TUX/TUXIFY family segmented control.

### Product cards

```text
┌──────────────────────────────────┐
│ [image]  Product name            │
│ [small]  Short real description  │
│                                  │
│ EGP 160.00             −  1  +   │
└──────────────────────────────────┘
```

Rules:
- compact landscape, not square and not long list bar;
- 80–96px image left;
- real name/description right;
- price bottom-left;
- stepper bottom-right;
- 12–16px radius;
- hairline, little/no shadow;
- 44px stepper targets;
- selected = subtle tint/hairline, never full green;
- no fake descriptions/photos;
- existing polished image fallback when needed.

The grid responds to product-pane width; a normal laptop with order rail open should naturally land near three columns rather than forcing three everywhere.

### Current Order

- persistent rail desktop; existing Review & pay overlay mobile;
- opaque structural surface, no glass;
- no nested cards;
- divider-separated lines;
- preserve order types, modifiers, notes, delivery, payment, totals and behavior;
- note/discount use inline progressive disclosure;
- Payment remains one-screen; no `Proceed to Payment` page;
- Place Order is the strongest action-green object.

### Motion/accessibility

- press 100–150ms;
- hover/selection 150–250ms;
- no decorative looping/bouncing;
- reduced motion;
- visible focus;
- no color-only state;
- 44×44px primary targets;
- no horizontal overflow at 375, 768 or 1440px.

## Canonical TUX logo

The user will attach the exact original `favicon.svg`. It is the only canonical logo.

If the exact SVG is unavailable:
- do not substitute, generate, scrape, redraw or use a raster screenshot;
- mark only the logo wiring task blocked;
- ask the user for the exact SVG;
- continue independent tasks.

## Sync-status rule

Do not fake `Synced`.

Reuse `packages/sync/src/syncHealth.ts` and `buildSyncHealth()` with existing states:

```text
LOCAL_ONLY
SYNC_PENDING
SYNCING
SYNCED
SYNC_RETRYING
SYNC_ISSUE
```

Renderer mapping:

```text
SYNCED        -> Synced
SYNCING       -> Syncing…
SYNC_PENDING  -> Syncing… after the approved delay
SYNC_RETRYING -> Offline
SYNC_ISSUE    -> Sync issue
LOCAL_ONLY    -> Local only
```

Add only minimum scheduler/IPC observability. Preserve 15-second cadence, retry behavior, outbox ordering, transport semantics, local transaction boundaries, quarantine/materialization, and Electron security. Delay visible `Syncing…` about 400ms to avoid flicker.

## Business behavior that must not change

Do not rewrite local-first durability, Orders domain logic, exact money, discounts, delivery/customer lookup, payment, modifier/customizer, printing, recovery/idempotency, inventory, Board, Expenses, Bulk Stock, End Day, Business Day identity, sessions, or remote gateway/Supabase architecture. Do not add Admin to Operations.

Preserve tested accessible labels wherever possible, including Current order, Review & pay, Cash, Instapay, Split payment, Phone, Customer name, Zone, Full address, Place Order, Orders Board, Expenses, Bulk Stock, and End Day entry.

## Git/deployment rules

- Work only on `ui/tux-premium-pos-redesign`.
- Never edit `main` directly.
- Commit after each plan task.
- Do not manually deploy the feature branch.
- Feature branches must create zero Vercel Preview Deploys.
- Do not merge until the user approves **actual rendered screenshots**.
- After approval, squash merge into `main`.
- Only `main` creates the Production deployment.

Production target: `https://tuxcasheirnew-three.vercel.app`

## Required evidence

The exact final branch head needs real evidence for:

```bash
npm run format:check
npm run lint
npm run typecheck
npm run test
npm run build
npm run test:migrations
npm run test:e2e
```

GitHub permanent gates also require development provisioning safety smoke, Deno Edge Function checks, and unsigned Windows x64 packaging. Never claim a pass without actual local or GitHub evidence.

## Visual QA gate

Before merge approval show real screenshots around 1440px, 768px, and 375px, plus light theme and dark-theme sanity view. Compare against `DESIGN.md`, approved spec, accepted mock, and Designer Skill. Functionally correct but visually generic/beige/excessively glassy/nested/oversized is not complete.

## Classic ChatGPT environment rule

This is **not Codex**.

If terminal/runtime tools exist, use them normally. If only GitHub connector access exists, inspect/edit through GitHub and use GitHub Actions as evidence. Never claim local commands ran if they did not. Never claim visual QA without real rendered screenshots. If the chat cannot render the UI, complete only truthfully verifiable work and state what execution-capable environment is still required.

## How to execute

Start at **Task 0** of the attached implementation plan.

Do not answer with another design audit. Do not produce another implementation plan. Do not skip ahead to merge/deploy.

After each completed task report:

```text
Task:
Status:
Files changed:
Tests/evidence:
Commit:
Next:
```

At the end perform the full quality/design audit, show rendered screenshots, and **wait for explicit user visual approval before merge**.
