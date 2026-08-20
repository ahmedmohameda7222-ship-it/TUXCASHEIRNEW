# TUX V2 — OPERATIONS MASTER APPROVED PRODUCT & IMPLEMENTATION PLAN

**Status:** Binding approved plan for TUX Operations V2  
**Date frozen:** 2026-08-16  
**Planning baseline repo:** `ahmedmohameda7222-ship-it/Tuxcashier`  
**Planning baseline commit:** `14e6bd0effd8172ad2b2beb1a3c479800dffe319`

---

# 0. DOCUMENT AUTHORITY

This document is the canonical master plan for **TUX Operations V2**.

It contains the approved decisions for:

1. Operations application scope and navigation.
2. Start/locked screen and operator entry.
3. Orders.
4. Orders Board.
5. Expenses.
6. Bulk Stock.
7. End Day and Reconciliation.
8. Business Day lifecycle.
9. Cross-cutting data-integrity, offline, audit, and future-readiness requirements.
10. Explicitly removed or deferred Operations functionality.
11. The boundary between TUX Operations and the separate TUX Admin application.

This is **not a short summary**. It is intended to be detailed enough to become the implementation contract.

Where an older design/spec conflicts with a later explicitly approved decision, the **later decision in this master document wins**.

No implementation chat should silently reinterpret these decisions for convenience.

---

# 1. PRODUCT SPLIT — APPROVED

TUX V2 is not one application with an Admin tab hidden behind a PIN.

It is planned as **two separate applications**:

```text
TUX Operations
TUX Admin
```

## 1.1 TUX Operations

Primary environment:

- worker-facing;
- Windows laptop first;
- eventual Electron `.exe`;
- React/TypeScript renderer;
- mobile/browser fallback where appropriate;
- offline-first operation.

Operations exists for fast real-world shift execution.

Final approved worker-facing operational areas are:

```text
Orders
Orders Board
Expenses
Bulk Stock
```

`End Day` exists inside the operator/profile menu and launches the mandatory closing workflow.

## 1.2 TUX Admin

Admin is a separate browser management application.

**Admin must not appear as a tab inside TUX Operations.**

The worker should not see an `Admin` navigation item and should not have to look at management functionality during normal order work.

The detailed TUX Admin information architecture will be designed separately after Operations is frozen.

---

# 2. FINAL OPERATIONS NAVIGATION — APPROVED

Final top-level navigation:

```text
Orders
Orders Board
Expenses
Bulk Stock
```

Explicit removals from Operations navigation:

```text
Inventory Usage   REMOVED
Reconcile         REMOVED AS TAB
Admin             REMOVED / SEPARATE APP
Bulk Inventory    RENAMED + REFRAMED TO Bulk Stock
```

## 2.1 Why Inventory Usage is removed

Inventory Usage is analytics/management information, not a worker task that deserves permanent Operations navigation.

The underlying data and calculations must not be deleted.

Future location:

```text
TUX Admin
→ Reports / Inventory Analytics
```

Potential future report capabilities can include:

- usage by Business Day;
- usage by week;
- usage by month;
- ingredient consumption;
- product/recipe consumption.

But none of that creates an Operations top-level tab.

## 2.2 Why Reconcile is removed as a tab

Reconciliation is not an all-day destination.

It is a mandatory closing step in:

```text
Profile
→ End Day
→ Reconciliation
```

The worker must not reconcile mid-shift and then continue taking orders against stale reconciliation values.

## 2.3 Why Admin is removed

TUX Admin is a separate product.

Operations does not show:

- Admin tab;
- Admin settings;
- Reports;
- historical management;
- menu editing;
- worker management;
- device management;
- database/system configuration.

---

# 3. GLOBAL OPERATIONS HEADER — APPROVED

The Operations header is compact and work-focused.

Concept:

```text
TUX / Logo
Orders
Orders Board
Expenses
Bulk Stock

                         Sync Status   Theme   Ahmed ▾
```

The header must not become a dashboard.

Avoid:

- giant date/time;
- giant shift timer;
- large status cards;
- management metrics;
- manual Sync to Cloud buttons;
- stale `Live Orders` checkboxes;
- Admin navigation.

The Current Operator/Profile control is the entry point for infrequent session actions.

Conceptual menu:

```text
Ahmed
Shift started: 15:00

Switch / Sign in worker
Sign out

────────────
End Day
```

`End Day` belongs here, not as a permanent high-emphasis header button.

---

# 4. BUSINESS DAY MODEL — APPROVED GLOBAL RULE

A TUX Business Day is **not a calendar date**.

Example:

```text
Business Day starts: 16/08 15:00
Business Day ends:   17/08 02:30
```

That is one Business Day.

Midnight must have zero effect on:

- order identity;
- display order numbering;
- Orders Board membership;
- current Expenses;
- reconciliation;
- worker/session ownership;
- current Business Day state.

Every operational record that belongs to a shift must be linked to an immutable `businessDayId`.

Conceptual Business Day identity:

```ts
BusinessDay {
  id: UUID
  shopId: UUID
  status: "OPEN" | "CLOSED"
  startedAt: Instant
  endedAt: Instant | null
  startedByWorkerId: UUID
  endedByWorkerId: UUID | null
  lastAllocatedDisplayOrderNo: number
}
```

A new Business Day receives a new immutable ID.

Closed Business Days remain historical records.

---

# 5. START / LOCKED SCREEN — APPROVED

When there is no active Business Day, Operations does not pretend that a shift is active.

The screen is intentionally simple:

```text
        TUX LOGO

     TUX Operations

No active Business Day

[ Enter PIN to Start Day ]
```

Requirements:

- TUX logo above the title;
- clean premium composition;
- no dashboard;
- no old orders;
- no management controls;
- no automatic new Business Day;
- worker PIN is required to start a new Business Day.

A successful PIN when there is no active day:

1. creates/opens the new Business Day;
2. assigns that worker as Current Operator;
3. initializes the new Business Day operational views;
4. starts display order numbering at `#1`;
5. transitions through the approved greeting;
6. loads `Orders`.

If a Business Day is already open, a valid worker PIN joins/signs the worker into that existing Business Day and must **not** create a duplicate Business Day.

---

# 6. APPROVED WORKER GREETING TRANSITION

After a successful worker PIN and before Orders loads, show a short greeting transition.

Typical 3 PM example:

```text
          TUX LOGO

   Good afternoon, Ahmed.

   Glad you made it in safely.
      Have a great shift.
```

Exact approved copy pattern:

```text
Good afternoon, {WorkerName}.

Glad you made it in safely.
Have a great shift.
```

Greeting is time-aware:

- morning → `Good morning, {WorkerName}.`
- afternoon → `Good afternoon, {WorkerName}.`
- evening → `Good evening, {WorkerName}.`

The normal worker schedule is usually from around 3 PM, so `Good afternoon` will commonly be the displayed greeting, but the implementation remains time-aware.

Transition behavior:

- roughly `1–1.5 seconds`;
- calm transition;
- then navigate directly to Orders.

Do not add:

- fake loading spinner;
- motivational paragraph;
- long animation;
- intermediate dashboard;
- `Continue` button;
- artificial progress indicators.

---

# 7. CURRENT OPERATOR — APPROVED CORE MODEL

The worker who successfully entered a PIN becomes Current Operator.

Current Operator persists during normal order work.

Orders do not ask the worker to choose themselves again on every checkout.

Placed order attribution uses the Current Operator at the successful durable checkout commit.

Operator changes are intentional and PIN-based.

End Day is available through the profile/operator menu.

The application may retain detailed audit attribution internally without adding repetitive PIN prompts to routine operational actions.

---

# 8. ORDERS — FULL APPROVED SPECIFICATION

The complete approved Orders specification is included later in this file under:

**Appendix A — TUX V2 Orders Page Final Implementation Specification**

That appendix is binding except where this Master Plan explicitly overrides later navigation or End Day placement decisions.

The most important approved Orders contracts are also restated here so cross-page implementation cannot miss them.

## 8.1 Desktop layout

Desktop uses a two-panel workspace:

- menu/product workspace about `65–70%`;
- persistent cart about `30–35%`;
- practical cart width around `380–420px`;
- independent scrolling;
- category/search row sticky;
- totals/payment/checkout stable at bottom.

Mobile is a separate responsive composition rather than a crushed desktop layout.

## 8.2 Categories

Approved category behavior:

```text
Burgers
Combo
Fries
Hawawshi
Zalabia
Extras
Drinks
```

Categories are dynamic Admin data.

Admin must eventually support:

- add;
- rename;
- reorder;
- activate/deactivate.

Orders behavior:

- first active category is selected on app restart;
- current category remains while operating during the same session;
- no permanent `All` category as default.

## 8.3 Product interaction

No legacy `select → Add to Cart` workflow.

Product cards use direct quantity controls:

```text
[-]  qty  [+]
```

Product card contains:

- optional product image;
- product name;
- price;
- quantity controls;
- Sold Out/Low status where relevant.

Approved card intent:

- compact;
- roughly `110–125px` target height depending on content;
- image left;
- name next to image;
- price lower-left;
- quantity controls lower-right;
- effective action target approximately `40–44px`;
- selected state uses restrained border treatment;
- no legacy per-product custom colors.

## 8.4 Images

Product image:

- optional;
- Admin upload;
- 1:1 source/crop intent;
- `contain`, not destructive crop;
- image absence must not break layout.

## 8.5 Quick Info / Description

Each product has one Admin-managed Description field.

Quick Info opens a restrained popover/drawer containing that description.

Do not turn product cards into long text blocks.

## 8.6 Quantity behavior

`+` adds/increments directly.

`−` decrements.

At quantity `1`, pressing `−` removes the item and provides short Undo behavior.

No separate Add to Cart button.

## 8.7 Extras

Extras can be:

- standalone sellable items;
- modifiers attached to products where permitted.

Customization UI is shown only when needed.

## 8.8 Combo beverages

A combo beverage selection is **required per combo unit**.

The system must not allow ambiguous quantity semantics where multiple combos share one unspecified beverage choice.

## 8.9 Notes

Two separate note concepts exist:

- item note → belongs to a specific cart line;
- order note → belongs to the whole order.

They must not be merged into one ambiguous field.

## 8.10 Cart

Persistent cart structure:

1. order type;
2. cart lines/configuration;
3. notes/discount;
4. totals;
5. payment;
6. full-width Place Order.

When cart is empty, irrelevant checkout forms must not dominate the interface.

`Clear Cart`:

- confirmation;
- optional short Undo;
- clears draft transaction data only;
- must never touch placed orders/history.

## 8.11 Order types

Order types are dynamic configuration.

Approved operational types include:

- Take Away;
- Dine In;
- Delivery.

After each successful placed order:

- order type resets to the first active configured type;
- Current Operator remains;
- category remains;
- payment selection resets.

## 8.12 Customer data

Customer Name and Phone are **Delivery only**.

Take Away:

- no customer fields.

Dine In:

- no customer fields.

There is no `Add Customer` workflow for non-delivery checkout.

Customer contacts are learned from successful Delivery orders only.

## 8.13 Delivery required fields

Delivery requires:

- Phone;
- Customer Name;
- Delivery Zone;
- full address.

All must validate before commit.

## 8.14 Egyptian phone behavior

Egyptian phone numbers must be normalized for:

- matching;
- search;
- autofill;
- duplicate avoidance.

Display formatting can differ from canonical storage.

## 8.15 Delivery Zone and Fee

Delivery Zone is mandatory.

Selecting a Zone:

- auto-populates the configured fee.

Worker may manually edit the fee without manager/PIN override.

Order snapshot stores both:

- configured zone fee/reference;
- final fee charged.

## 8.16 Switching away from Delivery

If worker temporarily changes from Delivery to Take Away/Dine In:

- Delivery UI hides;
- fee no longer contributes to total;
- draft delivery data may be retained temporarily so switching back restores it.

If final placed order is non-delivery:

- customer/delivery fields must not persist in the final order.

## 8.17 Discount

Discount is a fixed amount.

Worker can apply it directly.

No manager PIN or percentage limit is required for the approved current workflow.

Discount applies to:

```text
items subtotal
```

It does **not** discount:

```text
Delivery Fee
```

## 8.18 Money

Business money logic must not depend on unsafe floating-point arithmetic.

Use exact minor-unit/decimal semantics.

No business-critical reliance on JS `Number(...).toFixed()` as the accounting model.

## 8.19 Payment methods

Payment methods are dynamic Admin configuration with a stable internal logic type:

```ts
type PaymentLogicType =
  | "CASH"
  | "CARD"
  | "DIGITAL"
  | "OTHER";
```

Display name is renameable independently.

Example:

```text
Display name: Instapay
Logic type: DIGITAL
```

Renaming a method must never break:

- Cash Received;
- Change;
- reconciliation;
- reporting.

## 8.20 Payment reset

Payment method is selected fresh for every successful new order.

It does not silently carry over from the previous customer.

## 8.21 Cash Received and Change

For `CASH`:

```text
Cash Received >= Order Total
Change = Cash Received - Order Total
```

Insufficient received cash blocks checkout.

## 8.22 Smart tender suggestions

Cash tender suggestions are generated around common Egyptian notes, especially:

```text
50
100
200
```

The algorithm should suggest useful minimal/common bundles above the order total, not hard-coded arbitrary values.

## 8.23 Split payment

Maximum two payment methods.

Approved rule:

- Method A selected;
- worker enters Amount A;
- Method B selected;
- Amount B auto-calculates as remainder;
- methods must be distinct;
- total allocation must equal exact order total.

## 8.24 Checkout validation

All validation occurs **before any durable business mutation**.

No inventory changes, order state changes, customer history changes, or print action may happen before checkout is valid.

Validation is source-local in the interface.

No browser `alert()` as the normal validation UX.

## 8.25 Checkout durable commit

Approved ordering:

```text
Validate everything
→ build immutable order snapshot
→ one durable local commit
→ required inventory/order/outbox effects exactly once
→ print
→ clear/reset successful transaction draft
→ cloud sync can happen afterward
```

If durable local save fails:

- checkout is not successful;
- cart remains;
- no print;
- no inventory mutation;
- no customer contact mutation;
- no success feedback.

## 8.26 Idempotency

Double click, retry, app crash, outbox retry, or network retry must not create duplicate orders.

Every placed order has:

- immutable global ID;
- Business Day ID;
- display order number;
- idempotency key.

## 8.27 Printing

Save first, print second.

Printer failure does not undo a successfully durable order.

The worker receives a retry/reprint path.

## 8.28 Offline checkout

Cloud connectivity is not required to take an order.

Successful local durable commit counts as successful checkout.

Cloud work queues for later sync.

## 8.29 Draft persistence

Active cart/draft must be recoverable enough that an app restart/crash does not silently destroy meaningful work.

Draft has no inventory/reporting effect until successful checkout.

## 8.30 End Day with draft

If End Day is attempted while an unfinished order draft exists:

```text
You have an unfinished order.

[ Return to Order ]
[ Discard Draft & Continue ]
```

No silent draft loss.

## 8.31 Sold Out / Low

`Sold Out` is the human-controlled sellability block.

Low stock:

- informational/subtle;
- does not block order entry.

Calculated inventory shortage alone does **not** block checkout.

## 8.32 Inventory timing

Cart additions do not mutate inventory.

Failed checkout does not mutate inventory.

A successfully placed order creates its required inventory effect exactly once.

## 8.33 Immutability

Placed orders are financially immutable historical facts.

Do not edit old product price/payment/items in place as a “correction”.

Corrections use explicit audited state/actions.

## 8.34 Cancel

Cancel logic asks:

```text
Was food already prepared?
```

If:

```text
No
→ Restore Stock
```

If:

```text
Yes
→ Don't Restore Stock
```

Cancellation preserves the historical order and audit.

## 8.35 Return

TUX `Return` has a specific approved meaning:

```text
Delivery Failed
```

It is **not** a retail return/refund workflow.

Rules:

- Delivery only;
- customer did not receive the food;
- no money collected;
- food was prepared;
- inventory is not restored;
- order status becomes RETURNED.

Returned Delivery financial treatment:

- original order total remains visible as historical reference;
- recognized revenue = `0`;
- collected payment = `0`;
- excluded from expected payment reconciliation.

It creates a locked system Expenses record:

```text
type: DELIVERY_FAILED
amount: null
orderId/orderNo
description/items
reason
timestamp
worker
```

That record:

- appears in Expenses;
- has no amount;
- does not contribute to Total Expenses;
- does not contribute to profit/margin arithmetic;
- requires no sandwich-cost/manual cost.

---

# 9. ORDERS BOARD — FULL APPROVED CONTRACT

## 9.1 Purpose

Orders Board is the current Business Day operational queue.

It is not a kitchen-display Kanban with many cooking stages.

Approved normal lifecycle:

```text
ACTIVE → DONE
```

Exceptional terminal states:

```text
CANCELLED
RETURNED
```

Do not introduce:

```text
New → Preparing → Cooking → Ready → Served
```

## 9.2 State transitions

Approved transition graph:

```text
ACTIVE → DONE
ACTIVE → CANCELLED
DONE Delivery → RETURNED
```

`CANCELLED` and `RETURNED` are terminal.

There is no general Reopen feature.

## 9.3 Mark Done semantics

Meaning of `DONE`:

### Take Away

Done when order is handed over/completed.

### Dine In

Done when order is completed/served.

### Delivery

Done when food is handed to the delivery person / leaves the location.

It does **not** wait for confirmation that customer received it.

If delivery fails afterward:

```text
DONE → RETURNED
```

This keeps Active focused on work still physically requiring action at the location.

## 9.4 Current Business Day only

Orders Board shows only the current open Business Day.

It does not use “today” as a calendar filter.

A Business Day crossing midnight stays on the same Board.

A new Business Day starts with a clean operational Board.

Old orders remain in historical storage/Reports.

## 9.5 Status tabs

Approved conceptual views:

```text
[ Active 4 ] [ Done 27 ] [ Cancelled 1 ] [ Returned 2 ]
```

`Active` is default.

No source-specific `On-site orders` sub-tab.

## 9.6 Active sort

Active queue is:

```text
oldest first
```

New orders append after older orders by order chronology/age.

Old orders must never become buried by new ones.

Display waiting age, for example:

```text
11 min
```

Done list is:

```text
newest first
```

## 9.7 Active layout

Active uses responsive order cards.

Desktop:

- usually 2–3 columns depending on available width;
- ordering reads left-to-right, row-by-row;
- oldest first;
- card height follows contents;
- no giant fixed-height cards.

Mobile:

- natural one-column list.

Do not use a status-column Kanban layout.

## 9.8 Active card content

Active card directly shows what worker needs to prepare:

- order number;
- waiting age;
- order type;
- items;
- quantities;
- customizations;
- item/order notes where relevant;
- Mark Done.

Worker should not have to open Details just to know what to prepare.

Less urgent fields belong in Details.

## 9.9 Delivery card content

For Active Delivery, card also shows:

- Customer Name;
- Zone.

Keep these in Details, not card:

- phone;
- full address;
- Delivery Fee;
- payment details.

## 9.10 Mark Done interaction

No confirmation modal for routine `Mark Done`.

After Mark Done:

- order leaves Active;
- short Undo shown for about `5–8 seconds`;
- Undo returns it to ACTIVE;
- once window expires, no Reopen.

Mark Done/Undo:

- changes operational status only;
- must not alter payment;
- must not create inventory movement.

## 9.11 Search

Compact search by:

```text
Order #
```

only.

Search spans current Business Day across:

- Active;
- Done;
- Cancelled;
- Returned.

No customer/product advanced search in current Operations scope.

## 9.12 Details Drawer

Clicking a card/history row opens:

- right-side drawer on desktop;
- full-height sheet on mobile.

Drawer contains:

- order #;
- order type;
- status;
- items;
- quantities;
- customizations;
- item notes;
- order note;
- Delivery name/phone/zone/address/fee when relevant;
- payment;
- total;
- worker;
- created timestamp;
- Preview Receipt;
- Reprint where appropriate;
- state-specific actions.

## 9.13 Actions by state

### ACTIVE

Allowed:

- Mark Done;
- Cancel.

### DONE

Allowed:

- Preview/Reprint;
- if Delivery, Return/Delivery Failed.

### CANCELLED

Show:

- cancellation state/details;
- prepared/restock decision;
- reason/audit.

### RETURNED

Show:

- Delivery Failed details;
- historical order total as reference;
- zero recognized revenue/collection semantics.

## 9.14 Cancel eligibility

Cancel is only available for ACTIVE orders.

No Cancel after Done.

Reason:

- Take Away/Dine In Done already means operational completion;
- Delivery Done means food has left;
- a later failed Delivery uses Return.

Cancel uses the approved question:

```text
Was food already prepared?
```

Then:

```text
No → Restore Stock
Yes → Don't Restore Stock
```

## 9.15 History views

Only Active uses rich preparation cards.

Done/Cancelled/Returned use compact dense rows.

Example:

```text
#31   Take Away   E£420   08:37   Mohamed   >
```

Click row → same Details Drawer.

History is reference material and should not consume the same visual space as active preparation work.

## 9.16 Returned Delivery finances

If a Delivery order total was `E£450` but became RETURNED because customer never received it and no money was collected:

```text
Historical order total: E£450
Recognized revenue:      E£0
Payment collected:       E£0
Expected reconciliation: excluded
Inventory restored:      No
Delivery Failed expense: amount = null
```

This rule must be shared with Reports/Reconciliation.

## 9.17 Source/channel UI

Current workflow is one laptop taking orders.

Do not show:

- `On-site orders` source tab;
- unused POS/Online filters;
- new-order sound controls;
- worker-facing realtime toggles.

Keep `source/channel` internally future-ready so future Online Orders can be added without corrupting the core order model.

If Online Orders are introduced later, source filters/notifications can be designed then.

## 9.18 Sync responsibility

Normal worker is not responsible for cloud synchronization.

Do not expose legacy manual sync controls as part of Orders Board workflow.

Realtime/cloud status can exist at system/header level, but order handling remains local-first.

---

# 10. EXPENSES — FULL APPROVED CONTRACT

## 10.1 Purpose

Expenses is an operational ledger for the **current Business Day**.

It is not:

- Purchases;
- inventory receiving;
- a historical report page;
- a management analytics dashboard.

## 10.2 Manual expense shape

The current legacy `unit + qty + unitPrice` concept is removed from manual Expenses.

Manual Expense requires:

```text
Description
Amount
Paid From
Optional Note
```

Approved UI concept:

```text
Description: Taxi
Amount: E£150
Paid From: [ Cash ] [ Other ]
Note: optional

[ Add Expense ]
```

Purchasing quantities/units/unit prices belong in future Purchases/Admin inventory workflows.

## 10.3 Paid From

Every manual financial expense records:

```text
Paid From:
- Cash
- Other
```

### Cash

If expense was paid from the cash drawer:

- it counts as an Expense;
- it reduces Expected Cash during End Day reconciliation.

Example:

```text
Cash Sales       E£5,000
Cash Expense      -E£150
────────────────────────
Expected Cash    E£4,850
```

### Other

If expense was paid externally, for example owner money/account transfer outside the drawer:

- it still counts as an Expense;
- it affects business profit/reporting;
- it does not reduce Expected Cash in the drawer.

## 10.4 Delivery Failed special record

A `Delivery Failed` record is system-generated, not a normal manual financial Expense.

It has:

```text
amount = null
Paid From = not applicable
```

It:

- appears in the Expenses list;
- remains locked;
- cannot be manually edited/deleted;
- does not count in Total Expenses;
- does not alter Expected Cash;
- exists as an operational/historical exception record.

## 10.5 Current Business Day editing

Manual expenses in the current open Business Day may be:

- edited;
- deleted if entered incorrectly.

Editable fields include:

- Description;
- Amount;
- Paid From;
- Note.

System should preserve audit information internally.

Delivery Failed system records remain locked.

## 10.6 End Day behavior

At End Day:

- current Business Day Expenses leave the operational Expenses page;
- they become historical records attached to that Business Day;
- the next Business Day starts with an empty Expenses operational view.

This is **not destructive deletion**.

Records remain in database/history and are later visible in Admin Reports for that Business Day.

## 10.7 Expense total

Show a clear top-level total for the current Business Day.

Concept:

```text
Total Expenses
E£430
```

The total includes only financial expenses with real amounts.

It excludes:

```text
Delivery Failed amount:null
```

Semantic scope is the **current Business Day**, even if the shift crosses midnight.

## 10.8 Page layout

Expenses should be a simple current-shift ledger, not a dashboard.

Approved concept:

```text
EXPENSES

Total Expenses                         E£430

┌ Add Expense ──────────────────────────────┐
│ Description   Amount   Paid From          │
│ Taxi          E£150    [Cash] [Other]     │
│ Note (optional)                           │
│                              [Add Expense] │
└───────────────────────────────────────────┘

CURRENT BUSINESS DAY EXPENSES

09:02   Taxi               Cash       E£150   ⋯
07:41   Cleaning supplies  Cash        E£80   ⋯
06:55   Internet           Other      E£200   ⋯
06:20   Delivery Failed #24             —    >
```

Ordering:

```text
newest first
```

Manual row:

- time;
- description;
- Paid From;
- amount;
- edit/delete affordance.

Delivery Failed row:

- visibly system-generated;
- no amount;
- no Paid From;
- opens details/reference.

No oversized cards.

No charts.

No expense categories have been approved for the worker-facing page.

---

# 11. INVENTORY USAGE — EXPLICITLY REMOVED FROM OPERATIONS

`Inventory Usage` does not remain as an Operations page.

Reason:

Worker primarily needs operational sellability/stock awareness, not:

- weekly ingredient analytics;
- monthly usage;
- historical consumption analysis.

The old WEEK/MONTH usage UI must not survive merely because it already exists.

Underlying inventory movements/usage data must continue to exist.

Future analytics belong in Admin/Reports.

This removal is a navigation/product decision, not permission to destroy data.

---

# 12. BULK STOCK — FULL APPROVED CONTRACT

## 12.1 Name

Worker-facing name is:

```text
Bulk Stock
```

not:

```text
Bulk Inventory
```

Reason:

`Bulk Inventory` sounds like full inventory administration.

`Bulk Stock` communicates a narrow operational question:

> How many whole bulk units are physically available right now?

## 12.2 Purpose and distinction

Recipe-tracked Inventory and Bulk Stock serve different operational tracking modes.

### Recipe-tracked Inventory examples

```text
Beef patties
Cheese slices
Cans
Buns
```

POS/recipes can infer consumption automatically per order.

### Bulk Stock examples

```text
Fries bags
Oil bottles
Sauce containers
Packaging boxes
Gas cylinders
```

The POS cannot reliably infer fractional real-world use of a whole bulk container.

A worker provides human input when a whole bulk unit is finished or when new stock physically arrives.

Long-term domain architecture may represent both inside one inventory domain using a tracking mode such as:

```ts
trackingMode:
  | "RECIPE_TRACKED"
  | "BULK_MANUAL"
```

But the worker-facing workflow remains distinct.

## 12.3 Operations placement

Bulk Stock **does remain in TUX Operations**.

Final top-level nav includes:

```text
Bulk Stock
```

This is justified because the worker performs the real-world stock event.

## 12.4 Worker-facing simplicity

Operations Bulk Stock is not a management screen.

Concept:

```text
Bulk Stock

Fries Bags
Current Stock                         7 bags
[ Finished 1 ]                    [ Add Stock ]

Oil Bottles
Current Stock                      4 bottles
[ Finished 1 ]                    [ Add Stock ]
```

Worker can perform only the daily operational actions they actually need.

## 12.5 Finished 1 semantics

The decrement action means the whole tracked bulk unit has actually finished.

Approved wording:

```text
Finished 1
```

Example:

```text
Fries Bags: 6
worker finishes one complete bag
→ Finished 1
→ Fries Bags: 5
```

Do **not** decrement when the bag is merely opened.

Do not model fractional bag usage in this worker workflow.

Ledger event concept:

```text
-1 BULK_UNIT_FINISHED
```

## 12.6 Add Stock

When stock physically arrives:

```text
Add Stock
```

Worker enters received quantity.

Example:

```text
Current: 4 bags
Add Stock: +3
New balance: 7 bags
```

Ledger event concept:

```text
+3 STOCK_RECEIVED
```

`Add Stock` updates physical stock.

It does **not automatically mean a financial Purchase record has been created**.

Stock receiving and financial purchasing are separate concepts.

Future Admin/Purchases design may link them carefully to avoid duplicate entry, but that integration has not yet been frozen.

## 12.7 Ledger, not direct overwrite

Current stock is the result of movement history.

Never implement worker actions as a blind overwrite of:

```text
stock = 7
```

Approved movement approach:

```text
+3 STOCK_RECEIVED
-1 BULK_UNIT_FINISHED
-1 BULK_UNIT_FINISHED
```

Resulting balance is derived/maintained from valid movements.

Each movement should preserve:

- immutable movement ID;
- item ID;
- quantity delta;
- movement type;
- timestamp;
- Business Day ID where applicable;
- worker/operator attribution;
- idempotency/retry protection.

## 12.8 Worker permissions

Operations worker does **not**:

- create new Bulk Stock item;
- rename item;
- edit unit;
- edit low-stock threshold;
- delete item;
- delete movement history;
- reset all stock;
- directly type a replacement balance;
- perform destructive historical cleanup.

Those are Admin responsibilities.

## 12.9 Continuous balance across Business Days

Bulk Stock does **not reset at End Day**.

Example:

```text
Start:
Fries Bags = 10

During Business Day:
Finished 1
Finished 1
Add Stock +3

End:
Fries Bags = 11
```

Next Business Day starts with:

```text
Fries Bags = 11
```

not zero.

Business Day boundaries segment movement reporting; they do not erase physical inventory.

## 12.10 No Operations Reset

No `Reset Stock` button in Operations.

No `Reset All Bulk Inventory`.

No destructive worker action.

If a physical count is wrong and needs formal correction after the short Undo window, use future Admin `Stock Adjustment`.

## 12.11 Short Undo

After a newly recorded movement, show a short Undo.

Example:

```text
Fries Bags
7 → 6 bags

Finished 1 bag
[ Undo ]
```

Undo does **not delete the original movement**.

It creates a compensating movement.

Example:

```text
-1 BULK_UNIT_FINISHED
+1 UNDO_BULK_UNIT_FINISHED
```

If Add Stock `+5` was a mistake:

```text
+5 STOCK_RECEIVED
-5 UNDO_STOCK_RECEIVED
```

This preserves auditability.

After the short Undo window expires:

- worker cannot rewrite/delete history;
- correction is handled through future Admin Stock Adjustment.

---

# 13. RECONCILIATION — PART OF END DAY, NOT A TAB

Reconciliation is a mandatory End Day step.

It does not exist as a normal top-level destination.

Approved concept:

```text
Profile
→ End Day
→ Unresolved work checks
→ Reconciliation
→ Final Closing Summary
→ Close Business Day
```

---

# 14. CURRENT PAYMENT METHODS FOR RECONCILIATION

Current real operational payment methods are:

```text
Cash
Instapay
```

Card is **not currently used**.

Therefore current End Day UI should not show a Card field merely because the system can support Card in the future.

Architecture remains dynamic:

- if a future active payment method requires reconciliation, it can be included without redesigning the entire workflow;
- stable internal payment logic type remains separate from display name.

Current worker experience:

```text
Cash
Instapay
```

---

# 15. NO OPENING CASH / FLOAT — APPROVED

There is no normal opening cash float/change fund at the start of the shift.

Therefore Start Day does **not** ask:

```text
Opening Cash
```

Current Expected Cash formula is conceptually:

```text
Cash collected from valid orders
− Expenses paid from Cash
= Expected Cash
```

No artificial starting balance is added.

---

# 16. BLIND RECONCILIATION — APPROVED

The worker must enter actual values **before** seeing the system Expected values.

This prevents “matching the screen” instead of actually checking reality.

## 16.1 Cash

Step:

```text
Count the cash currently in the drawer

Actual Cash
E£ [ ______ ]

[ Continue ]
```

Only after actual cash is committed for the step, reveal comparison:

```text
Expected Cash       E£4,850
Counted Cash        E£4,830
Difference           -E£20
```

## 16.2 Instapay

The same blind principle applies.

Worker checks actual received Instapay total externally and enters it before Expected is shown.

Concept:

```text
Instapay received
E£ [ ______ ]

[ Continue ]
```

Then reveal:

```text
Expected Instapay   E£1,300
Actual Instapay     E£1,300
Difference              E£0
```

## 16.3 Future payment methods

Future methods may define their own actual-verification semantics:

- CASH → physical drawer count;
- DIGITAL → actual received amount;
- CARD → terminal settlement/total if introduced;
- OTHER → configured behavior.

But no unused Card UI now.

---

# 17. EXPECTED PAYMENT RULES — APPROVED

## 17.1 Cash

Concept:

```text
Eligible Cash collected
− manual Expenses with Paid From = Cash
= Expected Cash
```

## 17.2 Instapay

Concept:

```text
Eligible Instapay collected
= Expected Instapay
```

unless future explicit digital adjustments are introduced.

## 17.3 Returned Delivery

Returned Delivery with no collection is excluded.

Example:

```text
Order historical total: E£450
Status: RETURNED / DELIVERY_FAILED
Recognized revenue: E£0
Collected payment: E£0
```

It must not inflate:

- Expected Cash;
- Expected Instapay;
- recognized revenue.

## 17.4 Cancelled orders

Cancelled order handling must use the final valid financial status and must not remain counted as collected revenue unless a separate explicit financial event says money was actually retained.

The implementation must preserve the approved immutable/audited correction model.

---

# 18. CASH / PAYMENT VARIANCE — APPROVED

A difference does **not** block End Day.

Example:

```text
Expected Cash     E£4,850
Counted Cash      E£4,830
Difference          -E£20
```

The system must not force worker to type a false matching value.

If:

```text
Difference = 0
```

worker continues normally.

If:

```text
Difference != 0
```

a reason is required.

Example:

```text
Reason for difference *
[ Customer change mistake ]
```

Store:

- payment method;
- Expected;
- Actual;
- Difference;
- reason where required;
- Business Day ID;
- worker;
- timestamp.

Variance is its own accounting/reconciliation fact.

Do **not automatically convert variance into**:

- Expense;
- Revenue;
- Purchase;
- inventory adjustment.

---

# 19. END DAY ENTRY POINT — APPROVED

`End Day` is inside the Current Operator/Profile menu.

It is not a dedicated top-level tab.

It is not a permanent primary header CTA.

Concept:

```text
Ahmed ▾
```

opens:

```text
Ahmed
Shift started: 15:00

Switch / Sign in worker
Sign out

────────────
End Day
```

End Day launches the closing workflow.

---

# 20. END DAY — ACTIVE ORDER HARD BLOCK

If any Orders remain ACTIVE, End Day cannot proceed to reconciliation.

Example:

```text
End Day

3 active orders still need action:

#41   Take Away   18 min
#44   Delivery    11 min
#46   Dine In      4 min

[ Return to Orders Board ]
```

ACTIVE is a hard block.

Every active order must resolve to a valid terminal operational outcome before closing:

```text
DONE
CANCELLED
```

A previously DONE Delivery can later be:

```text
RETURNED
```

where applicable.

The closing flow must not silently force statuses.

---

# 21. END DAY — ACTIVE DRAFT HANDLING

An unplaced cart draft is different from an ACTIVE placed order.

If a draft exists:

```text
You have an unfinished order.

[ Return to Order ]
[ Discard Draft & Continue ]
```

Requirements:

- never silently discard;
- Return to Order preserves draft;
- Discard Draft explicitly clears only draft state;
- draft has no placed-order/inventory/report effect.

---

# 22. END DAY WORKFLOW — APPROVED ORDER

The approved conceptual sequence is:

```text
Profile
→ End Day
→ Check unresolved ACTIVE orders
→ Resolve/discard active draft choice
→ Blind Cash actual entry
→ Blind Instapay actual entry
→ Reveal Expected / Actual / Difference
→ Require variance reason(s) where needed
→ Final Closing Summary
→ Close Business Day
→ Durable local close commit
→ Queue cloud sync
→ End Current Operator session
→ Locked / No active Business Day screen
```

Exact UI may break blind reconciliation into multiple screens/steps, but the behavioral ordering may not be violated.

---

# 23. FINAL CLOSING SUMMARY — APPROVED

Before final Close, show a concise review.

Approved concept:

```text
End Day — Final Review

Orders
Completed             42
Cancelled               2
Returned                1

Payments
Cash Expected       E£4,850
Cash Counted        E£4,830
Cash Difference       -E£20

Instapay Expected   E£1,300
Instapay Actual     E£1,300
Difference              E£0

Expenses
Total Expenses        E£430
Cash Expenses         E£230

Cash Variance Reason
"Customer change mistake"

[ Back ]        [ Close Business Day ]
```

The actual summary is derived from immutable Business Day data.

Do **not** add worker-facing management calculations here such as:

- Profit;
- Margin;
- COGS;
- historical trends;
- inventory analytics.

Those belong in Admin/Reports.

---

# 24. CLOSED BUSINESS DAY IS FINAL IN OPERATIONS

After successful close:

```text
BusinessDay.status = CLOSED
```

Operations cannot:

- Reopen Day;
- edit old orders;
- edit old expenses;
- change old reconciliation;
- restart the old sequence;
- reattach new orders to that closed day.

If historical correction is ever required, it belongs in TUX Admin with a deliberate audited correction model.

Do not give Operations a `Reopen Day` escape hatch.

---

# 25. END DAY MUST WORK OFFLINE — APPROVED

Internet/Supabase is **not** required to close a Business Day.

Approved logic:

```text
Reconciliation complete
→ Confirm Close
→ durable local closing transaction succeeds
→ Business Day becomes CLOSED locally
→ cloud sync queued
```

If cloud is unavailable:

```text
Day closed successfully
Cloud sync pending
```

Cloud failure:

- does not block closing.

Local durable save failure:

- **does block closing**.

If local persistence cannot guarantee the final closing state, do not show success and do not clear current operational state.

## 25.1 Idempotency

Close must be idempotent.

Double-click/retry/restart cannot create:

- duplicate archives;
- duplicate closing records;
- duplicate reconciliation;
- duplicate generated accounting events;
- duplicate Business Days.

If app crashes after local close but before cloud sync:

- restart must recognize the Business Day is already CLOSED;
- it must not reopen it;
- pending cloud work retries safely.

---

# 26. NO AUTOMATIC END DAY PDF / PRINT — APPROVED

End Day does not depend on:

- PDF generation;
- printer availability;
- automatic report download.

Closing is a data-integrity transaction, not a report-rendering transaction.

Approved close responsibilities:

```text
Validate
→ durable local close
→ status CLOSED
→ queue sync
→ success state
```

Future TUX Admin Reports owns:

```text
Business Day Report
[ View ]
[ Export PDF ]
[ Print ]
```

Printer/PDF failure must never create a half-closed Business Day.

---

# 27. POST-END-DAY APPLICATION STATE — APPROVED

After successful Close:

1. Business Day is CLOSED.
2. Current Operator session ends.
3. Operations does **not** automatically start another Business Day.
4. App returns to the locked/start state.

Screen:

```text
        TUX LOGO

     TUX Operations

No active Business Day

[ Enter PIN to Start Day ]
```

Next worker PIN creates the next Business Day.

The new Business Day gets:

- new immutable Business Day ID;
- display Order # starts at `1`;
- empty operational Orders Board;
- empty current Expenses;
- no stale order draft;
- Current Operator = worker who started it.

Bulk Stock is **not reset** and keeps its continuous physical balance.

---

# 28. BUSINESS DAY ORDER NUMBERING — APPROVED

Display order number is scoped to Business Day.

Example:

```text
Business Day A
#1 ... #52

End Day

Business Day B
#1 ...
```

This is safe because the technical identity is not the display number.

Every order requires:

```ts
id: UUID
businessDayId: UUID
displayOrderNo: number
idempotencyKey: string
```

Conceptual uniqueness:

```text
(shop_id, business_day_id, display_order_no)
```

Display number may repeat across different Business Days.

Global immutable order ID never repeats/resets.

Midnight does not reset order numbering.

Future multi-device allocation must prioritize uniqueness/safety over perfectly gapless numbers.

---

# 29. END DAY EFFECT ON EACH OPERATIONS AREA

## 29.1 Orders

Placed orders are archived historically by Business Day.

No destructive delete is used to get a clean next shift.

## 29.2 Orders Board

Current Board becomes historical.

Next Business Day begins with no current-day orders.

## 29.3 Expenses

Current expenses move out of Operations view into Business Day history.

Next Business Day Expenses page is empty.

## 29.4 Bulk Stock

No reset.

Physical balance continues.

Movement history remains.

## 29.5 Reconciliation

Final reconciliation is attached immutably to the closed Business Day.

It becomes a reporting/history record.

---

# 30. REPORTING DATA THAT END DAY MUST PRESERVE

Even though Reports is not in Operations, closing must preserve enough data for future Admin Reports.

At minimum, Business Day reporting must be able to reconstruct/show:

- Business Day identity;
- start/end timestamps;
- starting/ending worker;
- orders;
- order statuses;
- returned/cancelled details;
- recognized sales;
- payment breakdown;
- expected payments;
- actual reconciliation values;
- variances;
- variance reasons;
- manual Expenses;
- Expenses Paid From;
- Delivery Failed non-financial events;
- Bulk Stock movements;
- inventory movements;
- worker/session data;
- audit timestamps.

Do not make Reports depend on mutable live state that disappears after End Day.

---

# 31. LOCAL-FIRST / CLOUD SYNC OPERATIONS PRINCIPLES — APPROVED

Normal worker actions are local-first.

For business-critical writes:

1. validate;
2. durably persist locally;
3. acknowledge success;
4. synchronize cloud afterward.

Cloud outage must not destroy valid local Operations work.

Cloud sync should be automatic.

Worker should not have to understand:

- outbox;
- Supabase;
- realtime subscriptions;
- manual cloud upload;
- retry internals.

Header may show restrained sync health/status.

Do not add a worker responsibility to “remember to sync”.

---

# 32. AUDIT / IMMUTABILITY PRINCIPLES — APPROVED

Important business records should not be casually overwritten or deleted.

Use immutable facts plus explicit transitions/compensating movements where appropriate.

Examples:

- placed order → immutable snapshot;
- Cancel → explicit state/action;
- Return → explicit Delivery Failed state/action;
- Bulk Stock Undo → compensating movement;
- End Day → immutable close/reconciliation record;
- historical Expenses → preserved after close.

Every critical state transition should preserve enough information for future Admin audit.

---

# 33. HUMAN-ERROR DESIGN PRINCIPLES — APPROVED

Operational UI should prevent common mistakes without adding constant friction.

Approved examples:

- payment resets after successful order;
- order type resets after successful order;
- Current Operator persists;
- Mark Done has short Undo, no confirmation;
- Bulk Stock movement has short Undo;
- Clear Cart has confirmation/optional Undo;
- active draft at End Day is never silently lost;
- ACTIVE order blocks End Day;
- blind reconciliation prevents copying Expected;
- variance reason records reality instead of forcing a match;
- no destructive Bulk Stock reset;
- no historical reopening from Operations.

---

# 34. CURRENT OPERATIONS UI STYLE — APPROVED DIRECTION

The product should feel like professional commercial operations software, not a generic AI dashboard.

Visual direction:

- restrained;
- compact;
- premium;
- warm-neutral where appropriate;
- high information clarity;
- limited radii;
- no glassmorphism;
- no giant gradients;
- no decorative analytics cards;
- no fake KPI dashboard;
- no excessive shadows;
- no huge empty margins;
- no cartoonish POS styling.

Routine worker actions should be obvious without being visually loud.

Desktop laptop usability is primary.

Mobile behavior must be deliberately responsive, not a simple scaled desktop.

---

# 35. EXPLICITLY NOT IN OPERATIONS V2

The following must not reappear merely because legacy code contains them:

```text
Admin tab
Inventory Usage tab
Reconcile tab
On-site orders tab
manual Sync to Cloud workflow
Live Orders Board realtime checkbox
automatic End Day PDF
automatic End Day print
general Done → Active Reopen
multi-stage kitchen Kanban
Opening Cash field
Card reconciliation field while Card is not used
Bulk Stock Reset All
Bulk Stock item deletion by worker
historical Expense editing after End Day
worker-facing Profit/Margin/COGS at End Day
```

---

# 36. FUTURE-READY BUT NO UNUSED UI NOW

The architecture should remain extensible for:

- Online Orders/source channel;
- new-order notifications for remote/online sources;
- Card or other payment methods;
- multi-device operation;
- richer Admin Inventory;
- Purchases integration;
- advanced Reports;
- historical corrections in Admin;
- additional worker roles.

But current Operations UI must not expose dormant controls for hypothetical features.

---

# 37. OPERATIONS DEFINITION OF DONE — MASTER

TUX Operations V2 is not complete merely because the pages render.

It is complete when all approved contracts in this document are implemented and validated, including:

- final navigation;
- separate Admin boundary;
- start/locked screen;
- greeting transition;
- Orders workflow;
- Orders Board lifecycle;
- Expenses workflow;
- Bulk Stock workflow;
- End Day/Reconciliation workflow;
- Business Day identity;
- exact money;
- idempotency;
- local durability;
- offline behavior;
- immutable/audited history;
- responsive behavior;
- removal of obsolete worker UI.

Implementation must explicitly test the integrated scenario:

```text
No active Business Day
→ worker PIN
→ greeting
→ Orders
→ multiple Cash/Instapay orders
→ Delivery order
→ Expense paid from Cash
→ Expense paid from Other
→ Bulk Stock Finished 1
→ Bulk Stock Add Stock
→ Mark orders Done
→ Delivery becomes Returned
→ End Day
→ blind Cash count
→ blind Instapay count
→ variance reason if needed
→ Final Closing Summary
→ local durable Close while online or offline
→ locked screen
→ next PIN
→ new Business Day starts at Order #1
→ Bulk Stock balance carries forward
→ old Business Day remains reportable
```

---

# APPENDIX A — TUX V2 ORDERS PAGE FINAL IMPLEMENTATION SPECIFICATION

The complete approved Orders-page specification follows.

**Master-plan precedence rule:** the global Operations navigation/header and End Day placement in this Master Plan supersede any older navigation wording that existed before the later approvals. The embedded version below has already been updated to the final approved Operations header.

---

# TUX V2 — Orders Page Final Implementation Specification

**Status:** FULLY APPROVED  
**Scope:** TUX Operations — Orders / Checkout flow  
**Repository:** `ahmedmohameda7222-ship-it/Tuxcashier`  
**Audited baseline HEAD:** `14e6bd0effd8172ad2b2beb1a3c479800dffe319` — `Remove stale shift realtime order guard`  
**Architecture target:** TUX V2 / TypeScript / Operations-first / Electron-ready / offline-capable / long-term safe  
**Document authority:** This specification supersedes earlier Orders-page drafts wherever a conflict exists.

---

# 0. Implementation mandate

The implementation chat must treat this document as a **binding product + UX + data-integrity contract**, not as loose inspiration.

Do not:

- redesign the approved Orders UX from scratch;
- reintroduce legacy interactions because tests currently expect them;
- preserve known unsafe mutation ordering;
- use browser `alert()` for normal validation;
- make order identity depend on display order number;
- reset business identity at midnight;
- silently mutate historical placed orders;
- allow duplicate order creation from double-click, retry, refresh, sync retry, crash recovery, or multi-device replay;
- merge Delivery Return with generic Refund semantics;
- collect customer data for Take Away or Dine In;
- silently discard a draft when End Day is requested;
- silently update open-cart prices after an Admin price change;
- rely on payment display names such as `"Cash"` for business logic;
- reintroduce generic AI-dashboard visual patterns.

Implementation sequence:

1. Audit current dependent logic.
2. Define V2 domain types and migrations.
3. Build/verify pricing and order-domain functions.
4. Build durable local transaction boundary.
5. Build sync/idempotency boundary.
6. Implement Orders desktop UX.
7. Implement responsive/mobile composition.
8. Rewrite semantic tests.
9. Test migration/backward compatibility.
10. Validate End Day, reconciliation, inventory, printing, reports, customer contacts, and Order Board integration.
11. Only then integrate.

---

# 1. Product intent

TUX Operations is counter-service / food-truck POS software.

The Orders page must optimize for:

- rapid order entry;
- low operator error;
- clear payment handling;
- dependable shift attribution;
- Delivery-specific customer handling;
- reliable operation through weak or absent internet;
- strong data integrity;
- compact laptop-first layout;
- touch-capable controls for mobile use;
- calm, professional commercial-product visual quality.

The page must not feel like:

- a generic admin dashboard;
- a SaaS analytics page;
- a student POS;
- a table-service restaurant product;
- a Canva/AI-generated interface;
- a collection of oversized cards and decorative effects.

---

# 2. TUX Operations context

TUX V2 is planned as two applications:

## TUX Operations

Primary usage:

- restaurant / food-truck staff;
- Windows laptop;
- eventual Electron `.exe`;
- browser/mobile fallback where appropriate.

Operations owns:

- order creation;
- checkout;
- order board;
- active shift/operator workflow;
- operational expenses;
- reconciliation;
- relevant inventory visibility;
- printing;
- offline operation.

## TUX Admin

Separate browser-based management application.

Admin owns configuration such as:

- menu;
- product categories;
- descriptions;
- images;
- product ordering;
- recipes;
- payment methods;
- order types;
- delivery zones/fees;
- worker configuration;
- reporting and management tools.

Shared domain logic must live in shared packages/modules rather than being duplicated between the two apps.

---

# 3. Orders desktop information architecture

Desktop is a two-panel workspace.

Recommended composition:

```text
┌────────────────────────────────────────────────────────────────────────────┐
│ TUX    Orders | Order Board | Expenses | ...          Sync   Operator      │
├───────────────────────────────────────────────────┬────────────────────────┤
│ Categories                                 Search │ YOUR ORDER             │
│                                                   │ Order type             │
│ Product grid                                      │                        │
│                                                   │ Cart lines             │
│                                                   │                        │
│                                                   │                        │
│                                                   ├────────────────────────┤
│                                                   │ Totals                 │
│                                                   │ Payment                │
│                                                   │ PLACE ORDER            │
└───────────────────────────────────────────────────┴────────────────────────┘
```

Desktop proportions:

- Menu/workspace: approximately `65–70%`.
- Persistent Cart: approximately `30–35%`.
- Cart practical target width: roughly `380–420px` minimum on normal laptop layouts.
- Full application window should be used efficiently.
- Avoid large centered web-page margins.

Scrolling:

- Header remains fixed.
- Category/search row remains sticky within the menu area.
- Product grid scrolls independently.
- Cart item list scrolls independently when necessary.
- Cart totals/payment/checkout remain reachable and stable at the bottom.

At smaller widths, do not squeeze the desktop layout until unusable. Switch to the mobile/tablet composition.

---

# 4. Global Operations header — MASTER APPROVED OVERRIDE

The final approved TUX Operations top-level navigation is deliberately minimal:

```text
Orders
Orders Board
Expenses
Bulk Stock
```

The following are explicitly **not** top-level Operations tabs:

- `Inventory Usage` — removed from Operations. Usage data still exists and belongs in future Admin/Reports analytics.
- `Reconcile` — removed as a standalone tab. Reconciliation is a mandatory step inside the End Day workflow.
- `Admin` — must not appear in TUX Operations at all. TUX Admin is a separate management application.
- `Bulk Inventory` — renamed/reframed as `Bulk Stock` for the worker-facing operational workflow.

Header direction:

```text
TUX / Logo
Orders
Orders Board
Expenses
Bulk Stock

right:
Sync status
Theme
Current Operator / Profile
```

The `Current Operator / Profile` control owns infrequent operator/session actions, including `End Day`.
`End Day` must not be a permanent high-emphasis button competing with normal order entry.

Requirements:

- compact;
- fixed;
- visually subordinate to actual order work;
- no giant date/time;
- small time only if still useful;
- no Admin navigation or Admin PIN gate inside Operations;
- no worker-facing manual cloud-sync controls;
- no worker-facing stale realtime toggles;
- no `On-site orders` source tab;
- source/channel support may remain in the data model for future online ordering without adding unused UI now.

---

# 5. Shift and Current Operator model

## 5.1 Starting work

If there is no active Business Day / shift:

- Orders is gated by a simple Start Shift flow.
- A valid worker PIN starts the Business Day.
- That worker immediately becomes the Current Operator.

If a Business Day is already active:

- entering another worker PIN joins/signs that worker into the active shift;
- it must not start a second Business Day accidentally.

## 5.2 Current Operator

Checkout does **not** use the legacy per-order worker button grid.

Instead:

- Current Operator is persistent;
- switching operator is intentional and PIN-based;
- every successful order stores the operator responsible at Place Order time.

Operator control should expose, as appropriate:

- current operator;
- business-day start time;
- active workers;
- sign in another worker;
- switch operator;
- sign out;
- End Day.

End Day is infrequent and should not visually compete with normal order creation.

## 5.3 Attribution invariant

The operator attached to the final order is the operator at successful checkout commit time.

Draft creation must not prematurely lock the worker if the operator is later switched before Place Order.

---

# 6. Business Day — critical long-term identity rule

## 6.1 Business Day is not a calendar day

TUX must use a dedicated **Business Day** entity.

```text
Business Day starts 16/08 16:00
Business Day ends   17/08 05:00
```

That remains one Business Day.

Midnight has **zero effect** on order numbering or identity.

A second shift can start later on the same calendar date:

```text
Business Day A
startedAt: 16/08 16:00
endedAt:   17/08 05:00
last order: #24

Business Day B
startedAt: 17/08 16:00
endedAt:   18/08 05:00
first order: #1
```

Both may contain orders whose wall-clock date is `17/08`. This is valid.

## 6.2 Required Business Day identity

Conceptual model:

```ts
BusinessDay {
  id: UUID
  shopId: UUID
  startedAt: Instant
  endedAt: Instant | null
  startedByWorkerId: UUID
  endedByWorkerId: UUID | null
  status: "OPEN" | "CLOSED"
  lastAllocatedDisplayOrderNo: number
}
```

Exact schema naming may differ, but identity semantics may not.

## 6.3 End Day behavior

End Day:

- closes the current Business Day permanently;
- records its final sequence state;
- does **not** redefine historical identity;
- does **not** depend on calendar-date change;
- does **not** reuse the old Business Day ID;
- does **not** delete historical orders merely to obtain a fresh counter.

Next Start Shift:

- creates a new Business Day ID;
- display order numbering starts from `1`.

---

# 7. Order identity and display numbering — critical

Every placed order must have separate:

1. **immutable global identity**, and
2. **human-facing display order number**.

Conceptual example:

```ts
Order {
  id: UUID                    // permanent technical identity
  businessDayId: UUID         // permanent parent shift
  displayOrderNo: number      // #1, #2, #3...
  idempotencyKey: string      // retry protection
  shopId: UUID
  createdAt: Instant
}
```

## 7.1 Display order number

Rules:

- begins from `1` for every new Business Day;
- remains simple for staff/customer use;
- may repeat across different Business Days;
- must never be treated as global identity.

Example:

```text
BusinessDay A / Order #1
BusinessDay B / Order #1
```

These are two unrelated orders with two unique technical IDs.

## 7.2 Database uniqueness

Database-level protection must conceptually enforce:

```text
UNIQUE(shop_id, business_day_id, display_order_no)
```

And also a globally unique immutable order ID.

Idempotency must prevent a retry from creating a second order.

The current repository already contains `order_key` / `idem_key` concepts. V2 should migrate/adapt these deliberately rather than discard their protection.

## 7.3 Counter architecture

Do not implement a destructive global `nextOrderNo = 1` reset as the source of truth.

Number allocation belongs to the Business Day.

The allocation mechanism must be atomic at the durable data boundary.

For current normal single-device operation, the local durable transaction can safely allocate the next number.

For future concurrent multi-device operation:

- number allocation must use a coordination mechanism;
- online allocation can be atomic server-side;
- concurrent offline devices require safe pre-reservation/range allocation or another explicitly safe strategy.

The product must **never promise gapless numbering at the expense of uniqueness**.

Uniqueness and durability are higher priority than cosmetically gapless numbers.

---

# 8. Product categories

Initial approved categories:

```text
Burgers
Combo
Fries
Hawawshi
Zalabia
Extras
Drinks
```

These are data, not hardcoded UI constants.

Admin capabilities:

- add;
- rename;
- reorder;
- active/inactive;
- assign products.

Deleting a category that still contains products must not silently orphan them. Require move/archive handling.

Orders behavior:

- open the first active category after a fresh restart;
- during the current session remember the last category;
- after successful checkout remain on the current category;
- no default `All Products` tab.

UI:

- compact segmented/horizontal category bar;
- text only;
- neutral;
- active state subtly raised/selected;
- no decorative per-category color coding;
- horizontally scrollable at narrow width.

---

# 9. Search

Search sits on the same working row as categories, aligned toward the right.

Behavior:

- searches products across all categories by name;
- results use the same product cards and order logic;
- optional aliases can be added by Admin later without changing search architecture;
- live filtering;
- Escape clears;
- after clearing, restore previous category and reasonable scroll position.

Keyboard:

- `/` or `Ctrl+K` may focus search;
- Escape closes/clears contextual surfaces;
- Enter behavior must be explicit and safe;
- logical Tab order.

Do not turn search into a command palette or add recent-history clutter.

---

# 10. Product cards

Product card direction:

```text
┌─────────────────────────────┐
│ [image]  Double Smash       │
│                             │
│ E£160             [-] 2 [+] │
└─────────────────────────────┘
```

Requirements:

- neutral card;
- compact;
- product image left;
- product name adjacent;
- price bottom-left;
- quantity control bottom-right;
- approximate card height `110–125px` on normal laptop layouts;
- enough density for at least 2–3 meaningful rows on a 1366×768 laptop viewport;
- no permanent product description;
- no giant hero photography;
- no legacy per-product background color.

Quantity controls:

- visible `− qty +`;
- no separate `Add to Cart`;
- at least approximately `40–44px` effective pointer/touch target;
- `+` uses the controlled primary brand/action accent;
- `−` uses a darker/muted neutral, not destructive red;
- enough separation to prevent accidental taps;
- clear keyboard focus.

Selected state:

- subtle accent border when total quantity > 0;
- no glow;
- no saturated fill.

Hover/feedback:

- restrained elevation/border;
- fast `~120–180ms` interaction feedback;
- no ornamental motion.

---

# 11. Product images

Image system requirements:

- optional;
- uploaded/configured by Admin;
- consistent crop/frame;
- `1:1` source preference;
- `object-fit: contain`;
- neutral frame;
- fallback placeholder;
- client-side/server-side image processing should prevent huge originals from hurting performance;
- reasonable resize/compression/cache pipeline.

Product image factual integrity remains important: image must correspond to the real sellable item and must not become a source of recipe truth.

Legacy `color` data must be migrated/retired deliberately. Do not keep dead color architecture purely because current normalization defaults to `#ffffff`.

---

# 12. Product description / Quick Info

Only one optional `Description` field is needed.

Do not create separate short/long description complexity.

Clicking the non-control area of a product card:

- desktop: small Quick Info popover;
- mobile: compact bottom sheet.

Contains:

- product name;
- full Description.

The card click itself does **not** add the product.

`+ / −` operate independently and must not accidentally open Quick Info.

Historical placed orders store sufficient product snapshots so later Admin description/name changes do not rewrite history.

---

# 13. Product quantity semantics

There is no selection-first / Add-to-Cart workflow.

`+` adds immediately.

`−` removes immediately.

Rules:

- every product has independent quantity;
- extras can also be independently sold;
- extras-only cart remains valid;
- same product with different customizations becomes separate Cart lines.

Product card quantity represents the **total units of that product across all configurations in the current draft**.

Example:

```text
Double Smash / no onion     x1
Double Smash / bacon        x2

Product card quantity = 3
```

Default `+`:

- adds a unit with the default configuration.

Card-level `−`:

- removes the most recently added unit for that product using deterministic draft ordering.

Exact configured-line removal is available in Cart.

Combo exception:

- each new combo unit requires its included beverage selection;
- do not create an invalid combo unit that silently lacks a required beverage.

---

# 14. Extras and customization

Extras have two valid roles:

1. standalone sellable products under Extras;
2. product modifiers.

These roles must share data deliberately without collapsing their semantics.

Customization:

- initiated from `Edit` on a Cart line;
- opens a small side drawer over/adjacent to Cart on desktop;
- mobile uses an appropriate sheet;
- not a huge blocking modal.

Drawer contains as relevant:

- product name;
- quantity;
- allowed extras;
- extra quantities;
- required combo beverage selection;
- optional item note;
- Done.

Allowed extras:

- defined by Admin at product/category level;
- avoid presenting every irrelevant extra to every burger.

Same product + different modifier configuration = distinct Cart lines.

---

# 15. Combo beverage rules

Combo rules are first-class domain logic.

Each combo unit requires an included beverage.

Requirements:

- Admin defines allowed beverages for that combo;
- sold-out beverages unavailable;
- included beverage is not charged as a separate paid line unless product configuration says otherwise;
- beverage usage still affects relevant inventory logic;
- order snapshot preserves the relationship.

Multiple combo units may have different included beverage choices.

Do not flatten the combo/beverage relationship into a single display string that cannot be reliably reported or migrated.

---

# 16. Item note vs order note

Two different concepts:

## Item note

Applies to a specific configured Cart line.

Examples:

```text
No onions
Extra crispy
```

## Order note

Applies to the entire order.

Example:

```text
Call on arrival
```

UI uses compact actions such as:

```text
+ Add note
```

Order Board and receipt should distinguish line notes from order-level note.

Migration:

- legacy single `order.note` should map to the V2 order-level note;
- do not reinterpret old note content as item notes.

---

# 17. Cart desktop structure

Approved conceptual Cart:

```text
YOUR ORDER

[ Take Away ][ Dine In ][ Delivery ]

─────────────────────────────
Double Smash             E£320
Bacon • Cheese
[-] 2 [+]                Edit

Fries                     E£60
[-] 1 [+]                Edit

+ Add order note
+ Add discount

                   Clear Cart
─────────────────────────────
Subtotal                  E£380
Discount                  -E£20
Delivery                   E£30
TOTAL                     E£390
─────────────────────────────
PAYMENT
[ Cash ][ Card ][ ... ][ Split ]

...
─────────────────────────────
[ PLACE ORDER • E£390 ]
```

Cart hierarchy:

1. Order Type
2. Cart lines
3. notes/discount
4. clear cart
5. totals
6. payment
7. checkout CTA

---

# 18. Empty Cart

When empty:

```text
No items yet
Choose a product to start an order.
```

Hide unnecessary transaction forms while empty:

- payment;
- Delivery details;
- discount state;
- totals noise.

Order Type may remain visible if that improves initial flow, but avoid displaying irrelevant forms.

`Clear Cart` is hidden/disabled when empty.

---

# 19. Cart quantity/removal

Cart line uses exact configuration.

`−` at quantity `1` removes the line.

Do not show a confirmation modal for normal one-line removal.

Provide short Undo where useful.

Undo restores only the draft. Because the order has not been placed, this has no revenue/report/inventory effect.

---

# 20. Clear Cart

`Clear Cart` is a secondary action.

It should not visually compete with Place Order.

Clear Cart:

- requires an intentional confirmation;
- clears:
  - items;
  - line customization;
  - customer/delivery draft data;
  - discount;
  - payment;
  - notes;
- does **not** clear:
  - Current Operator;
  - active Business Day;
  - product/category configuration.

Short Undo may restore the previous draft.

Before checkout, no inventory/revenue/reporting mutation exists, therefore Undo is purely draft-state restoration.

---

# 21. Order Types

Order types are dynamic Admin-managed data.

Initial normal examples:

```text
Take Away
Dine In
Delivery
```

Do not hardcode exactly three forever.

Design comfortably for approximately 2–4 active types.

Admin may:

- add;
- rename;
- activate/deactivate;
- reorder.

No separate “Default Order Type” setting is needed.

## 21.1 Reset after successful checkout

After every successful placed order:

- reset Order Type to the **first active Order Type in Admin ordering**.

Normally this should be Take Away if Admin orders it first.

Reason:

- prevents a previous Delivery state/fee/customer workflow leaking into the next order.

Do not retain Delivery automatically for the next transaction.

---

# 22. Customer data — Delivery only

This is a final superseding rule.

**Customer Name and Phone exist in the new Orders flow only when Order Type = Delivery.**

Take Away:

- no customer fields;
- no `+ Add customer`.

Dine In:

- no customer fields;
- no `+ Add customer`.

Historical old orders that already contain non-delivery customer data remain readable in database/reports for compatibility, but new Orders must not collect it.

Customer Contacts growth in the new flow is derived from successful Delivery orders.

---

# 23. Delivery flow

Required Delivery fields:

```text
Phone
Name
Zone
Address
Delivery Fee
```

Zone is mandatory.

Recommended interaction sequence:

1. Phone first.
2. Normalize/search existing customer.
3. Existing customer may autofill:
   - name;
   - latest address;
   - latest zone.
4. Worker may edit for the current order.
5. Customer/profile updates happen only after successful order commit.

Historical order stores transaction snapshots.

Later Customer profile changes must not rewrite the original Delivery order.

---

# 24. Egyptian phone normalization

The existing Egyptian-phone normalization concept should be preserved/migrated.

Requirements:

- normalize supported Egyptian phone input consistently;
- validate clearly near the field;
- customer lookup uses normalized form;
- database/customer uniqueness strategy must not depend on cosmetic phone formatting.

Do not use a generic browser alert for invalid phone.

---

# 25. Delivery Zone and Delivery Fee

Delivery Zone is mandatory.

Selecting a zone:

- auto-populates its configured Delivery Fee.

The worker is allowed to manually change Delivery Fee during the Delivery order.

Do not add manager approval or a heavy override workflow for this.

Order snapshot must store enough information to preserve history, conceptually:

```ts
delivery: {
  zoneId: UUID
  zoneNameSnapshot: string
  configuredZoneFeeSnapshot: Money
  finalDeliveryFee: Money
  customerNameSnapshot: string
  phoneSnapshot: string
  addressSnapshot: string
}
```

Exact field names may vary.

If the Admin later changes a zone fee, old orders must remain unchanged.

---

# 26. Switching away from Delivery

If the worker starts a Delivery draft, fills customer data, then switches to Take Away or Dine In:

- remove Delivery Fee immediately from pricing;
- hide Delivery form;
- retain the Delivery draft fields temporarily in the local draft so switching back restores work;
- the final non-Delivery order must not persist Delivery/customer fields.

No confirmation is needed for simply switching order type.

---

# 27. Pricing model

Pricing must be centralized in domain logic.

The same pricing calculation must drive:

- Orders UI;
- receipt;
- Order Board;
- Reports;
- Reconciliation;
- relevant Admin summaries.

Do not duplicate formulas in components.

Conceptual calculation:

```text
Items Subtotal
- Discount
+ Delivery Fee
= Order Total
```

Only non-zero informational rows need to be shown.

`TOTAL` is visually strongest.

---

# 28. Discount rule

Worker may enter a fixed monetary discount.

No manager PIN/limit is required for the current product.

Validation:

- amount >= 0;
- amount <= items subtotal.

**Discount applies only to the items subtotal.**

It does **not** discount Delivery Fee.

Example:

```text
Items        E£200
Discount     -E£50
Delivery      E£30
------------------
Total         E£180
```

If free/reduced delivery is needed, the worker can edit Delivery Fee separately.

Store:

- discount amount;
- responsible worker;
- time/audit metadata as appropriate.

Workers cannot manually override individual product prices.

---

# 29. Money architecture

Do not continue casual floating-point financial logic as the core model.

Use an exact money representation.

For EGP where the current operation normally displays whole pounds, preferred domain representation is integer minor units or another exact decimal representation.

Requirements:

- one Money type / value object;
- one formatter;
- one arithmetic boundary;
- no repeated `.toFixed()` business calculations spread through components;
- no binary-float rounding surprises;
- currency configuration centralized.

Display convention:

```text
E£160
```

Do not show unnecessary decimals unless business configuration genuinely requires them.

Future tax/service-charge capability should be explicit rather than hidden inside subtotal logic.

---

# 30. Payment methods — stable logic type

Payment methods are dynamic Admin-configured data.

They require both:

- mutable display name;
- stable logic type.

Conceptual model:

```ts
PaymentMethod {
  id: UUID
  name: string        // e.g. "Cash Payment"
  type: "CASH" | "CARD" | "DIGITAL" | "OTHER"
  active: boolean
  sortOrder: number
}
```

Business logic must use `type`, never exact display-name equality.

Admin can rename:

```text
Cash
Cash Payment
نقدي
```

without breaking:

- cash received;
- change;
- tender suggestions;
- reconciliation categorization.

Initial stable types:

```text
CASH
CARD
DIGITAL
OTHER
```

---

# 31. Payment selection reset

After every successful order:

- clear selected payment method;
- clear split configuration;
- clear cash received;
- clear calculated change.

New order begins with no selected payment method.

The worker must intentionally select payment for every order.

Reason: preventing previous-order payment leakage into reconciliation.

Current Operator remains unchanged.

---

# 32. Single payment

For a normal non-split order:

- choose one active payment method;
- if non-cash, no Received/Change flow is shown;
- if Cash, show cash tender flow.

Payment validation must finish before any inventory/financial mutation.

---

# 33. Cash received and change

Manual cash received is always possible.

Rules:

```text
Received >= Total
Change = Received - Total
```

If Received < Total:

- Place Order cannot commit;
- show field-level/near-source validation;
- do not mutate inventory or save a partial sale.

Revenue is the Order Total, **not** the Received amount.

Change is stored/derived separately as appropriate.

---

# 34. Egyptian cash tender suggestions

Tender suggestion logic is an independent domain/helper module, not UI-hardcoded.

Common notes currently emphasized:

```text
50
100
200
```

`Exact` may be presented separately.

A suggested bundle must:

1. be sufficient to pay the total;
2. be minimal in the approved sense that removing any one note would make the remaining bundle insufficient.

Examples:

```text
Total 180
200 accepted
250 rejected because 200 alone is sufficient
```

```text
Total 230
250 = 200 + 50
300 = 200 + 100
400 = 200 + 200
350 rejected because subset 300 is sufficient
```

```text
Total 370
400 accepted
450 / 500 rejected as redundant
```

```text
Total 410
450 = 200 + 200 + 50
500 = 200 + 200 + 100
600 = 200 + 200 + 200
400 insufficient
```

```text
Total 620
650 accepted
700 accepted
800 accepted
750 rejected because 700 subset is sufficient
850 rejected because 800 subset is sufficient
```

```text
Total 760
800 accepted
higher redundant suggestions rejected
```

The denomination configuration should be extensible later without rewriting Cart UI.

---

# 35. Split payment

Initial V2 Split supports maximum two payment methods.

Interaction:

- choose Method A;
- enter Method A amount;
- Method B receives the remaining amount automatically.

Do not require the worker to manually type both sides.

Requirements:

- two methods must be distinct;
- amount A >= 0;
- remaining amount valid;
- combined parts equal exact Order Total;
- if Method A or B has type `CASH`, cash-received/change applies only to its relevant cash portion;
- no reliance on display name `"Cash"`.

Store payment parts structurally, not only as a formatted string.

---

# 36. Checkout CTA

Persistent strongest action:

```text
[ PLACE ORDER • E£580 ]
```

Requirements:

- full Cart width;
- clear primary accent;
- live total;
- stable location;
- no generic confirm modal before every sale.

If Cash:

```text
Change: E£20
[ PLACE ORDER • E£580 ]
```

If exact:

```text
Change: E£0
```

For Card/Digital without cash component, hide Change.

---

# 37. Validation UX

The current app relies heavily on browser `alert()`.

V2 must not.

Validation must be proactive and local.

Examples:

- missing combo beverage → mark/edit the affected line;
- missing Delivery phone → highlight Phone;
- missing Delivery Zone → highlight Zone;
- invalid split → mark split payment section;
- cash received too low → mark Received;
- no current operator → operator control;
- no active Business Day → shift gate;
- empty Cart → Place Order disabled / explanatory state;
- local durable storage unavailable → explicit blocking system state.

Use:

- inline messages;
- compact banners where cross-cutting;
- focus first invalid field/control;
- accessible error association.

Do not show generic “Something went wrong” if a specific reason is known.

---

# 38. Checkout commit — critical transaction invariant

Current legacy checkout mutation ordering is unsafe because inventory ledger mutation can begin before all split-payment validation completes.

V2 must use strict staged processing.

Conceptual phases:

## Phase A — pure validation

Validate all of:

- active Business Day;
- Current Operator;
- non-empty Cart;
- product/config validity;
- combo beverage;
- order type;
- Delivery fields/phone/zone/address if Delivery;
- discount;
- payment method;
- split logic;
- cash received;
- pricing consistency;
- durable local storage availability.

No durable inventory, order, customer, report, bank, or financial state mutation may happen in this phase.

## Phase B — prepare immutable order snapshot

Create:

- order ID;
- Business Day link;
- idempotency key;
- display number allocation request;
- line snapshots;
- prices;
- Delivery snapshot;
- payment parts;
- operator snapshot/reference;
- timestamps.

## Phase C — one durable local commit boundary

Atomically, or with equivalent recoverable transaction semantics:

- allocate/confirm display order number;
- save order;
- save required inventory movements;
- save required local outbox/sync record;
- save any other required order-coupled local records.

If the durable transaction fails:

- order is not considered placed;
- Cart remains;
- user sees a specific persistence error;
- printing does not start.

## Phase D — post-commit effects

After durable success:

- update derived customer profile for successful Delivery;
- trigger print if configured;
- clear/reset draft according to approved rules;
- show success;
- sync to cloud asynchronously.

Cloud failure after local durable commit is **not** checkout failure.

---

# 39. Idempotency and duplicate prevention

The following must not create duplicate placed orders:

- double-click;
- Enter + mouse click together;
- renderer lag;
- refresh;
- browser retry;
- network retry;
- Supabase retry;
- Electron renderer restart;
- outbox replay;
- app crash after local commit but before UI reset.

Requirements:

- Place Order enters Processing/locked state immediately;
- order intent gets an idempotency identity;
- durable local store enforces uniqueness;
- cloud write uses stable order identity/idempotency;
- replay/upsert strategy recognizes already-committed order.

Never generate a new order ID for a retry of the same already-committed checkout intent.

---

# 40. Printing ordering

**Save first. Print second.**

Print is a post-commit side effect.

If printing fails:

```text
Order #24 created
Print failed
[ Retry Print ]
```

Do not:

- cancel the order;
- duplicate it;
- rollback inventory;
- re-run checkout;
- create a second order number.

Reprint from Order Board uses the same order identity/display number.

Auto Print remains Admin-configurable.

Receipt template/printer configuration should be centralized.

---

# 41. Checkout success/reset

Successful order flow:

```text
Place Order
→ Processing
→ durable order committed
→ Order #24 created
→ optional auto-print
→ Cart resets for next order
```

Optional short-lived actions:

- View Order;
- Reprint.

After successful order:

- Cart items cleared;
- customization cleared;
- notes cleared;
- discount cleared;
- Delivery draft cleared;
- payment cleared;
- cash received/change cleared;
- Order Type resets to first active type;
- Current Operator remains;
- active Business Day remains;
- current product category remains.

---

# 42. Offline checkout

Offline is a normal operating condition, not an error state, provided trusted local data/storage are available.

If local durable save succeeds while cloud is unavailable:

```text
Order saved • Waiting to sync
```

Do not label that sale as failed.

Header status examples:

```text
Synced
Syncing
Offline • 3 pending
Sync issue
```

Keep sync information compact.

Local persistence failure is different:

- checkout must block;
- do not pretend order was saved;
- keep Cart intact.

---

# 43. Startup / cached menu

Startup is local-first.

If trusted local catalog/pricing exists:

- render immediately;
- begin cloud synchronization;
- avoid menu flicker;
- do not show partial mixed-version menu.

First-ever device with no valid local catalog:

- must obtain valid data before checkout;
- if cloud unavailable, checkout remains unavailable.

If cached data is corrupted or pricing incomplete:

- block sale rather than invent values.

---

# 44. Draft persistence and crash recovery

Cart/draft must autosave continuously in the durable local layer appropriate to the final Electron/browser architecture.

Draft includes:

- items/configurations;
- quantities;
- notes;
- discount;
- Order Type;
- hidden retained Delivery draft fields;
- payment draft as appropriate.

Draft identity is tied to:

- active Business Day;
- device/session context.

Requirements:

- refresh/crash/restart recovers draft when safe;
- checkout clears committed draft;
- no inventory/report/revenue effect before placement;
- avoid accidental multiple-window draft overwrite.

Tab navigation away from Orders preserves draft.

No “Hold Order” feature is required now.

---

# 45. End Day with active draft

End Day must never silently destroy an active draft.

If active non-empty draft exists:

```text
Active order draft detected.

[ Return to Order ]
[ Discard Draft & Continue ]
```

Rules:

- Return to Order cancels End Day request.
- Discard Draft is explicit.
- discarded draft has no inventory/revenue/report effect.
- after explicit discard, End Day may continue through its normal validation/lifecycle.

---

# 46. Product/Admin changes while draft is open

Open draft must not silently reprice.

When an item is added:

- capture its effective draft price snapshot.

If Admin changes the product price afterward:

- existing draft line retains its snapshot;
- new addition uses the current defined price according to implementation policy;
- never silently alter an already-visible Cart total without operator action.

Placed order snapshots final names/prices/configuration.

If product becomes inactive or Sold Out while it already exists in a draft:

- do not silently delete existing line;
- no new units may be added after the availability update;
- existing unit may be completed according to approved operational policy.

---

# 47. Sold Out and Low Stock

These are separate concepts.

## Sold Out

- temporary operational state;
- product remains visible;
- disabled for new addition;
- suitable authorized operator/manager may toggle in Operations;
- Admin may also manage;
- record actor/time;
- no automatic shift reset.

## Low / At Risk

- subtle warning;
- does not block checkout;
- compact header indicator such as:

```text
Low stock • 4
```

Click can show affected items.

Do not place inventory management inside the Orders page.

Inventory quantities must not automatically force Sold Out. Human confirmation controls sellability.

---

# 48. Inventory shortage behavior

Final product decision:

- insufficient calculated inventory does **not** automatically block sale;
- Sold Out is the sellability block;
- stock values can be imperfect in real operation.

The implementation must preserve the real order usage event without introducing distracting negative-stock UX into Orders.

Detailed discrepancy/internal-ledger handling is an implementation concern and must not become an operator-facing Orders workflow unless future evidence requires it.

Do not resurrect a separate negative-stock product decision in the Orders UI.

---

# 49. Inventory mutation timing

Cart activity:

- no inventory mutation.

Failed checkout:

- no inventory mutation.

Successful durable placed order:

- apply/persist usage movements exactly once.

Print failure:

- no inventory rollback.

Cloud sync failure:

- no inventory rollback.

Cancellation stock behavior is defined separately below.

---

# 50. Placed orders are immutable

Once a successful durable order is committed, its commercial snapshot is immutable.

Do not edit in-place:

- products;
- quantities;
- original prices;
- discount;
- payment;
- Delivery Fee;
- customer Delivery snapshot.

Allowed evolution:

- status transitions;
- audit events;
- print/reprint metadata;
- cancellation/return records.

Corrections happen through explicit domain actions, not by rewriting history.

Example:

```text
Order #24
Total: E£350
Status: CANCELLED

Order #25
Total: E£310
Status: COMPLETED
```

Do not mutate #24 into E£310.

---

# 51. Cancel / Void behavior

Cancel is distinct from Delivery Return.

When cancelling a placed order, ask one materially important operational question:

```text
Cancel Order #24

Was the food already prepared?

[ No — Restore Stock ]
[ Yes — Don't Restore Stock ]
```

Rules:

## Food not prepared

- order becomes cancelled;
- relevant sale/payment effect is reversed/excluded according to reporting model;
- inventory usage is compensated/restored.

## Food already prepared

- order becomes cancelled;
- inventory is **not** restored because ingredients were consumed/prepared.

Store audit:

- order ID;
- cancellation status/event;
- worker;
- timestamp;
- optional reason;
- `restoreStock: true/false` or equivalent immutable event semantics.

Do not use destructive deletion.

---

# 52. Delivery Return — TUX-specific meaning

In TUX, `Return` does **not** mean retail refund.

It means:

**Delivery failed / customer did not receive the prepared order.**

Therefore Return is available only for Delivery orders.

Example:

```text
Delivery Order #24
Customer did not receive
Food was already prepared
→ RETURNED
```

Rules:

- no Refund workflow;
- no automatic stock restoration;
- no per-product cost configuration required;
- original order remains;
- order status becomes `RETURNED`;
- record worker/time/reason;
- create an automatic system-generated entry in Expenses for operational visibility.

---

# 53. Delivery Return entry in Expenses

The automatic entry is a **non-financial operational record**.

Example display:

```text
DELIVERY FAILED
Order #24
Double Smash ×2
Fries ×1
Reason: Customer didn't receive
Time: 02:14
Worker: Ahmed
```

No price/cost/amount is required.

Database semantics must distinguish “no amount exists” from “amount equals zero”.

Conceptually:

```ts
ExpenseRecord {
  type: "DELIVERY_FAILED"
  amount: null
  orderId: UUID
  ...
}
```

Do **not** store `0` if the actual meaning is “not a financial amount record”.

This record:

- appears in Expenses;
- is system-generated;
- is locked against normal worker edit/delete;
- is linked to original order;
- does not contribute to Total Expenses;
- does not distort Profit/Margin;
- contains order/description/reason/operator/time context.

No sandwich cost-entry workflow is required from Admin.

---

# 54. Order Board compatibility

Orders V2 must preserve/increase compatibility with Order Board.

Order Board needs enough structured data to show:

- display order number;
- source/type;
- status;
- payment;
- split parts;
- Delivery snapshot;
- cart lines;
- combo beverage;
- item notes;
- order note;
- cancellation;
- Delivery Return;
- print/reprint.

Current online-order normalization/adapters must be audited before changing order schema.

Do not let a new Orders renderer silently break older/online/imported order shapes.

---

# 55. Customer Contacts update timing

Customer profile/contact mutation must happen **only after successful durable Delivery order commit**.

Do not:

- create/update customer during partially validated checkout;
- create customer from failed transaction;
- create customer from Take Away/Dine In.

Order itself stores the immutable Delivery snapshot.

Customer profile may store latest useful details for future autofill.

---

# 56. Notifications and feedback

Do not toast every normal action.

No toast needed for:

- normal `+`;
- normal `−`;
- changing category;
- selecting payment.

Use direct UI feedback.

Appropriate transient feedback:

- order created;
- item/cart clear Undo;
- print failed + Retry;
- sync/offline compact status.

Blocking validation belongs near the source.

Notifications must not cover critical Cart/Checkout controls.

---

# 57. Responsive/mobile composition

Mobile is not a shrunk desktop.

Recommended structure:

- compact header;
- horizontally scrollable categories;
- search;
- likely 2-column product grid depending on width;
- sticky bottom Cart summary:

```text
4 items • E£420     View Cart
```

Cart opens as:

- full-height drawer/sheet;
- includes order type, lines, Delivery, payment, customization;
- sticky Place Order.

Requirements:

- no horizontal page scroll;
- controls remain touch-safe;
- same business/domain logic as desktop;
- different composition is allowed.

Breakpoints are determined by layout capacity, not arbitrary device names.

---

# 58. Accessibility and human-error prevention

Required:

- approximately 40–44px effective touch targets for frequent controls;
- clear visible keyboard focus;
- sufficient color contrast;
- controls not communicated by color alone;
- logical tab order;
- Escape behavior for drawers/popovers;
- labels/error association for form fields;
- no destructive action placed too close to the primary checkout action;
- no tiny payment/category targets.

Dense does not mean cramped.

---

# 59. Visual design system

Visual character:

- professional;
- mature;
- precise;
- warm-neutral light theme;
- corresponding controlled dark theme;
- compact;
- calm;
- commercial POS quality.

Avoid:

- pure white/pure black extremes;
- glassmorphism;
- gradients as decoration;
- neon;
- giant rounded cards;
- excessive shadow;
- decorative icon fields;
- huge whitespace;
- fake metrics;
- per-product rainbow cards.

Menu surface:

- near-flat;
- subtle borders;
- restrained radii.

Cart:

- visually separate, calm surface.

Brand accent:

- reserved for:
  - `+`;
  - active/selected states where useful;
  - Place Order;
  - truly important status/action.

Checkout is the strongest visual action.

Light/Dark:

- same design system;
- remember last device choice;
- no arbitrary custom theme colors.

---

# 60. Required V2 domain boundaries

Orders implementation must not become another monolithic `AppCore.js`.

At minimum separate responsibilities conceptually into:

```text
domain/
  order
  pricing
  payment
  cashTender
  delivery
  catalog
  businessDay
  inventoryMovement
  cancellation
  deliveryReturn

application/
  createOrder
  cancelOrder
  returnDelivery
  manageDraft
  startBusinessDay
  endBusinessDay

persistence/
  localDatabase
  migrations
  orderRepository
  businessDayRepository
  outboxRepository

sync/
  pushOrder
  reconcileOrder
  idempotency

ui/
  OrdersPage
  ProductGrid
  ProductCard
  Cart
  Checkout
  DeliveryFields
  PaymentPanel
  CustomizationDrawer
```

Exact folder structure may differ, but business logic must not be duplicated inside React components.

---

# 61. TypeScript requirements

V2 domain code must use strict TypeScript.

Requirements:

- `strict: true`;
- no architecture built around `any`;
- discriminated unions where statuses/types differ;
- branded/value types where useful for IDs/Money;
- runtime validation at external boundaries;
- normalize legacy data at adapters, not throughout UI.

Examples of candidate stable enums/unions:

```ts
PaymentMethodType =
  | "CASH"
  | "CARD"
  | "DIGITAL"
  | "OTHER"

OrderStatus =
  | "COMPLETED"
  | "CANCELLED"
  | "RETURNED"

BusinessDayStatus =
  | "OPEN"
  | "CLOSED"
```

Exact status model may include additional internal states, but placed historical state transitions must remain explicit.

---

# 62. Local database requirement

Because TUX Operations is intended for Electron and reliable offline financial operation, the local durable storage choice must be treated as architecture, not incidental browser cache.

Implementation must audit:

- IndexedDB current behavior;
- SQLite suitability in Electron;
- migration/versioning;
- transaction support;
- backup/recovery;
- crash consistency;
- renderer/main-process boundaries.

Do not switch storage casually inside an Orders UI PR.

If SQLite is chosen for the final Electron architecture:

- renderer must not receive unrestricted filesystem/Node access;
- use a narrow preload/IPC API;
- migrations are versioned;
- durable transaction semantics protect checkout.

If IndexedDB remains for an interim phase:

- it still must provide explicit durable failure handling;
- no console-warning-only persistence failure.

---

# 63. Cloud/Supabase boundary

Current broad browser anon CRUD and PIN-based app permissions are not sufficient as long-term security boundaries.

Orders V2 must be compatible with the future proper model:

- authenticated application/user/device context;
- RLS;
- shop scoping;
- role/capability enforcement;
- audited privileged operations.

Do not encode the future security model into UI-only flags.

The Orders page should use repositories/services rather than calling arbitrary Supabase operations directly from UI components.

---

# 64. Migration requirements

This is not a clean-sheet database.

Migration must preserve historical behavior/data.

Required compatibility audits include:

- `orders`;
- `pos_state`;
- counters;
- devices;
- `order_key`;
- `idem_key`;
- worker/session records;
- delivery fields;
- existing optional non-Delivery customer data;
- notes;
- combo beverage representation;
- discount;
- split payment;
- inventory usage/ledger;
- returned-order expense records;
- historical order numbers;
- End Day archives.

Migration rules:

- never rewrite old non-Delivery customer data out of history;
- new flow simply stops collecting it;
- legacy `note` maps to order note;
- legacy payment strings map through a compatibility adapter to stable payment types;
- legacy product colors are intentionally retired;
- existing order identities remain resolvable;
- no historical order-number collision is “fixed” by destructive renumbering.

---

# 65. End Day integration — preserve lifecycle safely

Current End Day is high-risk and coupled to multiple systems.

V2 work must preserve intended business effects while redesigning unsafe identity/purge mechanics.

End Day must continue to validate/coordinate:

- active Business Day;
- unresolved order constraints;
- reconciliation requirement;
- report generation;
- closing worker sessions;
- financial/report archival semantics;
- bank/day margin behavior where still part of approved system;
- new Business Day readiness.

But it must no longer depend on destructive identity reset or historical deletion to obtain `Order #1` for the next Business Day.

Before merging Orders V2, test End Day across a shift that crosses midnight.

Mandatory scenario:

```text
16/08 16:00  Start Business Day A
17/08 02:00  Place Order #24
17/08 05:00  End Business Day A

17/08 16:00  Start Business Day B
17/08 16:05  Place Order #1
```

Database must contain both safely and unambiguously.

---

# 66. Required test strategy

Legacy UI tests that click Select + Add to Cart must not force preservation of obsolete UX.

Rewrite tests around approved semantics.

## 66.1 Product/cart tests

Must cover:

- direct `+`;
- direct `−`;
- independent quantities;
- extras-only order;
- same product different configurations = separate lines;
- card quantity aggregates configurations;
- card `−` deterministic most-recent removal;
- item note vs order note;
- Clear Cart + Undo;
- draft restore.

## 66.2 Combo tests

Must cover:

- beverage required per combo unit;
- different beverages per units;
- sold-out beverage cannot be newly selected;
- relationship survives durable save and sync adapter.

## 66.3 Delivery tests

Must cover:

- Take Away has no customer fields;
- Dine In has no customer fields;
- Delivery requires phone/name/zone/address;
- zone auto fee;
- manual fee edit;
- discount does not reduce Delivery Fee;
- switch Delivery → Take Away removes fee from calculation;
- switch back restores draft Delivery fields;
- final non-Delivery snapshot excludes customer/delivery data;
- successful Delivery updates customer contacts after durable commit only.

## 66.4 Payment tests

Must cover:

- payment required every order;
- payment resets after success;
- display-name rename does not break Cash behavior;
- CASH type drives Received/Change;
- Received < Total blocks;
- Split A + automatic remainder B;
- exact total required;
- methods distinct;
- cash component change only applies to cash portion.

## 66.5 Cash suggestion tests

Unit-test the approved denomination minimality examples exactly.

Do not validate this only through screenshots/UI.

## 66.6 Pricing tests

Must cover:

- exact money arithmetic;
- discount cap = items subtotal;
- Delivery Fee separate;
- receipt/reports use same pricing source;
- no float drift.

## 66.7 Idempotency tests

Must simulate:

- Place Order double click;
- local commit success + UI crash before clear;
- cloud retry;
- outbox replay;
- duplicate network response;
- same idempotency key reused intentionally.

Expected: one durable order.

## 66.8 Order-number tests

Must cover:

- starts #1 for new Business Day;
- increments within Business Day;
- midnight does not reset;
- End Day closes sequence;
- next Business Day starts #1;
- same display number across two Business Days valid;
- duplicate display number inside same Business Day rejected;
- global order IDs remain unique.

## 66.9 Persistence-failure tests

If durable local write fails:

- no print;
- no inventory movement;
- no customer update;
- no Cart clear;
- no success message.

## 66.10 Cancel tests

Food not prepared:

- cancelled;
- compensating inventory movement/restoration.

Food prepared:

- cancelled;
- no inventory restoration.

Both audited.

## 66.11 Delivery Return tests

Must cover:

- Return unavailable for non-Delivery;
- Delivery Return changes status to RETURNED;
- inventory not restored;
- Expenses system record created exactly once;
- `amount = null` or equivalent non-financial semantics;
- record excluded from Total Expenses;
- record locked;
- retry does not duplicate the expense record.

## 66.12 End Day tests

Must cover:

- active draft blocks silent End Day;
- Return to Order;
- Discard Draft & Continue;
- business day crossing midnight;
- two Business Days on same calendar date;
- historical IDs/orders preserved.

---

# 67. Observability and audit

Important mutations should leave enough trace to debug production issues without exposing sensitive internals in normal UI.

Audit-worthy events include:

- Business Day start/end;
- worker sign-in/switch;
- placed order;
- cancellation;
- cancellation stock-restoration choice;
- Delivery Return;
- Sold Out changes;
- manual inventory adjustments;
- important sync conflict resolution;
- Delivery Fee final snapshot.

Do not use uncontrolled console logs as the only production diagnostic mechanism.

---

# 68. Performance expectations

Orders page should feel immediate on normal laptop hardware.

Goals:

- local catalog render without waiting for cloud;
- quantity action updates immediately;
- no full-page rerender jank from a single quantity change;
- product images lazy/efficient;
- Cart calculation deterministic and cheap;
- checkout durable commit clearly communicates Processing but avoids unnecessary delay;
- large historical order datasets must not be loaded into Orders unnecessarily.

Avoid premature micro-optimization, but do not keep one 18k-line stateful component architecture.

---

# 69. Electron readiness

Orders UI must be safe to wrap in Electron.

Security direction:

```text
renderer
  ↓ narrow typed preload API
IPC
  ↓
main/local services
```

Do not enable unrestricted Node APIs in the renderer.

Printing, local DB, filesystem backup, and updates must be behind narrow capabilities.

Renderer compromise must not automatically imply unrestricted machine access.

---

# 70. Acceptance criteria — desktop

Orders desktop is accepted only when:

- two-panel layout works at common laptop resolutions;
- Cart remains usable without scrolling the entire page to checkout;
- categories/search remain accessible;
- at least 2–3 product rows are visible on 1366×768 under realistic data;
- direct +/- works;
- no Add to Cart button;
- customization drawer works;
- Delivery-only customer flow works;
- payment selection/reset works;
- cash tender works;
- Place Order remains primary;
- no browser alert validation;
- dark/light both intentional;
- keyboard focus visible;
- no accidental horizontal overflow.

---

# 71. Acceptance criteria — mobile

Mobile is accepted only when:

- product grid remains readable;
- categories horizontally scroll;
- View Cart sticky summary works;
- Cart sheet contains full checkout flow;
- Place Order remains reachable;
- no desktop side-by-side squeeze;
- touch targets are safe;
- no horizontal page scroll;
- Delivery/customer/payment/customization all remain operational;
- same domain logic/tests are reused.

---

# 72. Acceptance criteria — data integrity

Implementation is not accepted if any of the following is possible:

- duplicate placed order from double-click/retry;
- inventory mutation on failed payment validation;
- print before durable save;
- Cart clear after failed durable save;
- calendar midnight resets numbering;
- End Day causes historical order identity loss;
- two Business Days with `#1` collide;
- old orders change when Admin changes menu price;
- placed order edited in place to “correct” history;
- Delivery Return counted as monetary expense despite no amount;
- non-Delivery new order persists Delivery customer fields;
- payment rename breaks Cash/change logic;
- cloud outage destroys a locally committed sale.

---

# 73. Final approved behavior summary

The final Orders V2 contract is:

```text
BUSINESS DAY
Start Shift → Business Day opens
Midnight → nothing special
End Day → Business Day closes
Next Start Shift → new Business Day
```

```text
ORDER IDENTITY
Global immutable ID → never resets
Idempotency key → duplicate protection
Display Order No → starts at 1 per Business Day
```

```text
ORDER ENTRY
Categories → dynamic
Product card → direct + / -
No Add to Cart
Extras → standalone + modifiers
Combo → required beverage
```

```text
CUSTOMER
Take Away → no customer data
Dine In → no customer data
Delivery → phone + name + zone + address
```

```text
DELIVERY
Zone required
Fee auto-filled
Worker may manually edit fee
Final fee snapshotted
```

```text
DISCOUNT
Fixed amount
Items subtotal only
Does not discount Delivery Fee
```

```text
PAYMENT
Stable method type
Payment selected fresh every order
Cash → Received >= Total
Change = Received - Total
Split → A entered, B auto remainder
```

```text
CHECKOUT
Validate everything first
Durable local commit
Inventory movement exactly once
Then print
Then clear/reset
Cloud sync can happen afterward
```

```text
CANCEL
Ask: food prepared?
No → restore stock
Yes → don't restore stock
Historical order remains
```

```text
RETURN
Delivery only
Means failed delivery
No refund workflow
No stock restore
Creates locked non-financial Expenses record
No amount/cost required
```

```text
END DAY + DRAFT
Never silently discard
Return to Order
or
Discard Draft & Continue
```

---

# 74. Implementation-chat starting instruction

Use the following instruction at the top of the implementation session:

> Implement TUX V2 Orders against `TUX_V2_Orders_Final_Implementation_Spec.md`. Treat every approved product rule and data-integrity invariant as binding. First audit the current code paths and schema dependencies affected by Orders, End Day, Order Board, inventory, customer contacts, printing, reconciliation, and sync. Produce a concise implementation plan before editing. Do not preserve obsolete legacy UI merely because old tests depend on it; rewrite tests to preserve business semantics. Do not perform destructive migrations without a rollback/backward-compatibility plan. Build strict TypeScript domain boundaries and ensure checkout is idempotent and durably local-first before changing the visible workflow. Validate desktop, mobile, offline, crash recovery, and the midnight-crossing Business Day scenario before integration.

---

# 75. Definition of Done

Orders V2 is not “done” when the page looks correct.

It is done when:

- approved UX is implemented;
- TypeScript/domain separation is real;
- exact-money calculations are tested;
- Business Day identity is durable;
- order numbering is safe;
- retries cannot duplicate orders;
- local persistence failure is correctly blocking;
- cloud outage is non-destructive;
- printing is post-commit;
- Delivery Return semantics are correct;
- cancellation inventory choice is correct;
- historical data remains readable;
- End Day across midnight is safe;
- responsive behavior is validated;
- current legacy tests are replaced/updated by semantic tests;
- no known data-corruption path was accepted merely to match the old implementation.

**Orders Page status after this document: FULLY APPROVED FOR IMPLEMENTATION.**

---

# APPENDIX B — FINAL APPROVED OPERATIONS DECISION REGISTER

This register is included as a quick implementation checklist, but it does not replace the detailed sections above.

## Operations shell

- [APPROVED] Separate TUX Operations and TUX Admin applications.
- [APPROVED] Admin does not appear inside Operations.
- [APPROVED] Final Operations nav: Orders / Orders Board / Expenses / Bulk Stock.
- [APPROVED] Inventory Usage removed from Operations.
- [APPROVED] Reconcile removed as standalone tab and moved into End Day.
- [APPROVED] Bulk Inventory worker-facing name becomes Bulk Stock.
- [APPROVED] End Day lives in operator/profile menu.

## Start / operator

- [APPROVED] No active day screen has TUX logo, `TUX Operations`, `No active Business Day`, `Enter PIN to Start Day`.
- [APPROVED] PIN starts new Business Day only when none is active.
- [APPROVED] Current Operator becomes the worker who authenticated.
- [APPROVED] Greeting transition before Orders.
- [APPROVED] Approved greeting copy: `Good afternoon, {name}. Glad you made it in safely. Have a great shift.` with time-aware salutation.
- [APPROVED] Greeting duration about 1–1.5 seconds, then Orders.

## Orders

- [APPROVED] Two-panel desktop layout with persistent cart.
- [APPROVED] Dynamic categories.
- [APPROVED] Direct +/- product quantities.
- [APPROVED] No Add to Cart button.
- [APPROVED] Optional product image.
- [APPROVED] Quick Info description.
- [APPROVED] Extras standalone + modifiers.
- [APPROVED] Required combo beverage per combo unit.
- [APPROVED] Item note and order note separate.
- [APPROVED] Delivery-only customer fields.
- [APPROVED] Delivery requires phone/name/zone/address.
- [APPROVED] Egyptian phone normalization/autofill.
- [APPROVED] Zone auto fee + worker can manually edit fee.
- [APPROVED] Fixed discount applies to items subtotal only.
- [APPROVED] Exact money semantics.
- [APPROVED] Payment method has stable logic type separate from label.
- [APPROVED] Payment selection resets every successful order.
- [APPROVED] Order type resets to first active configured type after success.
- [APPROVED] Current Operator persists.
- [APPROVED] Split payment max 2; second amount is remainder.
- [APPROVED] Cash Received / Change behavior.
- [APPROVED] Smart tender suggestions.
- [APPROVED] Validate all before mutations.
- [APPROVED] Durable local commit before print.
- [APPROVED] Local failure blocks checkout and keeps cart.
- [APPROVED] Offline local save counts as success and queues cloud.
- [APPROVED] Idempotent duplicate prevention.
- [APPROVED] Business Day, not calendar date, owns display order numbering.
- [APPROVED] Global immutable order ID never resets.
- [APPROVED] Draft never silently disappears at End Day.
- [APPROVED] Calculated inventory shortage alone does not block checkout.
- [APPROVED] Sold Out blocks sellability.
- [APPROVED] Placed orders immutable.
- [APPROVED] Cancel asks whether food was prepared.
- [APPROVED] Return means Delivery Failed only.
- [APPROVED] Returned Delivery: no stock restore, zero recognized revenue, zero collected payment.
- [APPROVED] Delivery Failed Expenses event has amount null.

## Orders Board

- [APPROVED] Lifecycle ACTIVE → DONE, with CANCELLED and RETURNED terminal exceptions.
- [APPROVED] No multi-stage kitchen workflow.
- [APPROVED] No general Reopen.
- [APPROVED] Active oldest first.
- [APPROVED] Done newest first.
- [APPROVED] Waiting age displayed.
- [APPROVED] Active rich order-card grid.
- [APPROVED] Done/Cancelled/Returned compact rows.
- [APPROVED] Current Business Day only.
- [APPROVED] Delivery Done when order leaves location.
- [APPROVED] Short Mark Done Undo about 5–8 seconds.
- [APPROVED] Search Order # only across current Business Day statuses.
- [APPROVED] Details drawer/sheet.
- [APPROVED] Cancel ACTIVE only.
- [APPROVED] DONE Delivery may become RETURNED.
- [APPROVED] Active Delivery card shows Customer Name + Zone.
- [APPROVED] No On-site orders tab.
- [APPROVED] No current new-order sound.
- [APPROVED] Keep source/channel future-ready without unused UI.

## Expenses

- [APPROVED] Current Business Day operational ledger.
- [APPROVED] Manual Expense = Description + Amount + Paid From + optional Note.
- [APPROVED] Paid From = Cash / Other.
- [APPROVED] Cash expense reduces Expected Cash.
- [APPROVED] Other expense does not change drawer Expected Cash.
- [APPROVED] Manual current-day expense editable/deletable.
- [APPROVED] Delivery Failed record locked and non-financial.
- [APPROVED] Show Total Expenses for current Business Day.
- [APPROVED] Newest-first compact list.
- [APPROVED] End Day clears Expenses from operational view and archives them to Reports/history.
- [APPROVED] No destructive database deletion.

## Bulk Stock

- [APPROVED] Bulk Stock remains in Operations.
- [APPROVED] Purpose is manual tracking of whole bulk units the POS cannot infer.
- [APPROVED] Worker action is `Finished 1` when whole unit actually finishes.
- [APPROVED] Do not decrement merely when opening a unit.
- [APPROVED] Worker can `Add Stock` when physical stock arrives.
- [APPROVED] Add Stock is not automatically a financial Purchase.
- [APPROVED] Stock uses movement ledger, not direct overwrite.
- [APPROVED] Worker cannot create/rename/delete/configure/reset items.
- [APPROVED] Bulk Stock balance persists across Business Days.
- [APPROVED] No End Day reset.
- [APPROVED] Short Undo creates compensating movement.
- [APPROVED] Later correction belongs in Admin Stock Adjustment.

## End Day / Reconciliation

- [APPROVED] Reconciliation mandatory inside End Day.
- [APPROVED] End Day launched from profile/operator menu.
- [APPROVED] Current real payment methods: Cash + Instapay.
- [APPROVED] No Card reconciliation UI now.
- [APPROVED] No Opening Cash/Float.
- [APPROVED] Blind actual entry before Expected values are revealed.
- [APPROVED] Cash expected = eligible Cash collected − Cash-paid Expenses.
- [APPROVED] Returned Delivery excluded from expected payment collection.
- [APPROVED] Variance does not block closing.
- [APPROVED] Non-zero variance requires reason.
- [APPROVED] Variance remains its own reconciliation fact, not automatic Expense/Revenue.
- [APPROVED] ACTIVE orders hard-block End Day.
- [APPROVED] Draft requires Return to Order or Discard Draft & Continue.
- [APPROVED] Final Closing Summary before final close.
- [APPROVED] No Profit/Margin/COGS in worker closing summary.
- [APPROVED] Closed Business Day cannot be reopened from Operations.
- [APPROVED] End Day works offline.
- [APPROVED] Cloud failure does not block close.
- [APPROVED] Local durable save failure blocks close.
- [APPROVED] Close is idempotent.
- [APPROVED] No automatic End Day PDF.
- [APPROVED] No automatic End Day print.
- [APPROVED] Reports/export/print move to Admin Reports.
- [APPROVED] After close, Current Operator session ends.
- [APPROVED] App returns to No Active Business Day screen.
- [APPROVED] No automatic next Business Day.
- [APPROVED] Next Business Day order display number starts at #1.
- [APPROVED] Bulk Stock carries forward unchanged except for recorded movements.

---

# FINAL IMPLEMENTATION INSTRUCTION

When implementation starts, use this master file as the binding Operations plan.

The implementation workflow must be:

```text
Audit current code + schema
→ identify legacy behaviors that conflict with this plan
→ produce implementation plan
→ implement in TypeScript/domain boundaries
→ add migrations/adapters where required
→ validate desktop/mobile
→ validate offline/crash/idempotency
→ validate End Day and next Business Day
→ validate historical/report data preservation
→ remove obsolete worker UI
→ integrate only after acceptance criteria pass
```

Do not preserve a legacy UI or data behavior merely because it already exists if it conflicts with an explicit APPROVED rule above.
