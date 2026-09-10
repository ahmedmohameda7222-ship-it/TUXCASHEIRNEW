# TUX Admin — Full Business Admin Design Specification

**Date:** 2026-09-10  
**Status:** Approved product design, awaiting written-spec review before implementation planning  
**Repository:** `ahmedmohameda7222-ship-it/TUXCASHEIRNEW`  
**Target application:** `apps/admin`  
**Design authority:** TUX product requirements + Apple Human Interface Guidelines adapted for web  
**Business timezone:** `Africa/Cairo`  
**Default currency:** EGP  
**Language:** English only

---

## 1. Purpose

TUX Admin is the management and control plane for the TUX restaurant platform. It gives owners, admins, managers, and permitted staff a simple mobile-first interface for managing the business while preserving the authority and reliability of the existing Menu and Operations applications.

The governing product principle is:

> Complex business logic underneath. Very simple decisions on the screen.

TUX Admin is not another POS. It configures, supervises, reports, approves, and manages. TUX Operations remains responsible for live operational execution. TUX Menu remains responsible for the customer ordering experience.

This is the full approved Admin scope. Everything explicitly included in this specification is part of the implementation effort. Explicit exclusions are out of scope. There is no import functionality and no export functionality.

---

## 2. Existing System and Non-Negotiable Architecture

The canonical monorepo structure is:

```text
apps/operations
apps/operations-desktop
apps/menu
apps/admin              # new
packages/*
api/
server/
supabase/migrations/
```

The authority chain is:

```text
Menu / Admin / Operations
          ↓
transport + application contracts
          ↓
trusted server APIs / Edge Functions / RPC
          ↓
ONE canonical Supabase
```

Canonical Supabase remains the single business database. Admin must not create a parallel source of truth and must not expose unrestricted browser-side database mutation authority.

Existing production concepts must be preserved and extended, including shops, shop memberships, devices, workers, business days, worker sessions, categories, products, modifiers, product-modifier relations, combo beverage options, inventory items, recipe lines, order types, payment methods, delivery zones, customer contacts, orders, order items, payments, order status events, and expenses.

Existing Menu and Operations contracts must continue to work. Admin changes shared behavior only through compatible published configuration and trusted server commands.

The canonical current shop remains the existing TUX shop. Multi-shop support is introduced compatibly rather than by replacing existing shop-scoped operational contracts.

---

## 3. Product Ownership Boundaries

### 3.1 TUX Admin

Admin owns management and control workflows:

- business and shop configuration;
- catalog management and publishing;
- inventory supervision and adjustment;
- purchasing and suppliers;
- customer management, loyalty, promotions, and customer segments;
- staff, permissions, shifts, attendance, wage estimates, and staff payment records;
- delivery and checkout configuration;
- finance reporting, expenses, cash/bank management, reconciliation, and end-day history;
- approvals and immutable audit;
- device, printer, shop-health, opening/closing, and manager-log supervision;
- reports, alerts, targets, and owner summaries;
- WhatsApp business integration configuration and message-control surfaces.

### 3.2 TUX Operations

Operations remains authoritative for live store execution:

- live POS order creation and execution;
- live payment capture/recording;
- live business-day and worker-session execution;
- active order progression;
- device-bound operational behavior;
- live receipt/kitchen printing commands;
- online-order acceptance into the canonical operational order model.

Admin may supervise or issue controlled management commands, but it must not silently bypass Operations business rules.

### 3.3 TUX Menu

Menu remains authoritative for the customer-facing ordering experience. It consumes published catalog, pricing, availability, delivery, payment, and checkout configuration. It must never read Admin drafts.

---

## 4. Approved Technical Architecture

The approved architecture is a modular Admin application backed by trusted Admin APIs and the existing canonical Supabase:

```text
apps/admin
        ↓
Admin application contracts
        ↓
Trusted Admin APIs / Edge Functions / RPC commands
        ↓
Canonical Supabase
        ↓
Published configuration
   ↙                ↘
Menu             Operations
```

`apps/admin` stays in the same GitHub monorepo but is deployed as a separate Vercel project. The existing Operations deployment remains the Operations/backend surface. Menu remains its own deployment. All three share canonical backend authority.

Sensitive business logic must run server-side, including:

- Admin PIN verification and session creation;
- role, permission, and shop authorization;
- catalog validation and publishing;
- scheduled configuration activation;
- inventory reservations, adjustments, and stocktake posting;
- purchasing and receiving;
- refund/return approvals;
- financial adjustments and cash/bank movements;
- staff payment posting;
- audit creation;
- approval state transitions.

The browser may query through explicit read contracts and submit commands, but it must not possess service-role credentials or direct unrestricted database write access.

The Admin codebase should be modular by business domain, with shared contracts in packages. Expected domains are `auth`, `dashboard`, `orders`, `catalog`, `inventory`, `purchasing`, `customers`, `staff`, `delivery`, `finance`, `reports`, `alerts`, `operations-devices`, `settings`, `whatsapp`, and `audit`.

---

## 5. Business and Multi-Shop Model

TUX Admin is multi-shop ready from day one.

A business-level parent identity should group shops and hold global entities. Existing shop-scoped operational tables remain valid and are not replaced destructively.

### 5.1 Global business-level data

The business level owns:

- business identity and branding;
- master catalog definitions and images;
- canonical customer identity;
- canonical employee identity;
- supplier directory;
- role/permission presets;
- promotion definitions;
- default settings;
- global reason-code definitions;
- reusable report views/targets where appropriate.

### 5.2 Per-shop operational data

Each shop owns or overrides:

- prices and product availability;
- stock and stock movements;
- orders and payments;
- expenses;
- purchasing and receiving;
- delivery zones and routing;
- shifts and attendance;
- business days and cash reconciliation;
- receipt/order-number settings;
- payment methods and checkout rules;
- printers/devices;
- shop-specific rules and overrides.

Organization defaults are inherited until a shop overrides them. Admin must show whether a value is inherited or overridden and allow an authorized user to restore the inherited value.

Shop lifecycle is `ACTIVE → SUSPENDED → ARCHIVED`. Used shops are archived, never hard-deleted.

---

## 6. Design System and Adaptive UX

Apple Human Interface Guidelines are the design authority, adapted to the TUX brand and the constraints of a web/PWA business application. The Admin is not a literal macOS clone.

The interface must prioritize clarity, hierarchy, predictable navigation, accessibility, contrast, readable typography, and touch ergonomics. Material/Liquid-Glass treatment should be restrained to navigation, toolbars, popovers, modals, and control layers rather than applied to every content surface.

Both light and dark appearance are supported.

### 6.1 Mobile-first requirement

The phone experience is the primary design target because most admins are expected to use phones. Business capability must not be removed from mobile merely because desktop offers denser layouts.

Phone behavior:

- bottom navigation;
- full-screen task/detail flows;
- cards and lists rather than wide desktop tables;
- large touch targets following the approximate 44-point principle;
- bottom action areas for primary actions;
- short forms with progressive disclosure;
- critical state and action text visible without hover.

Tablet behavior:

- adaptive sidebar where useful;
- split list/detail views where space permits;
- touch-friendly controls.

Desktop behavior:

- full sidebar;
- denser tables/lists;
- right-side inspector/detail surfaces;
- keyboard productivity and search.

### 6.2 Simplicity rules

The interface must use progressive disclosure, smart defaults, one obvious primary action per screen, plain English, inline validation, search-first discovery, human-readable statuses, automatic calculations, and minimal data entry.

Role-based simplification is mandatory: users should not see irrelevant areas or actions.

Destructive and sensitive actions must be explicit and safe. Undo/reversal should be offered where the underlying business event is safely reversible. Critical actions must never be hidden only behind a gesture.

---

## 7. Navigation and Application Shell

### 7.1 Phone

Bottom navigation:

```text
Home
Orders
Catalog
Inventory
More
```

`More` contains permission-dependent access to:

- Customers;
- Purchasing;
- Staff;
- Delivery;
- Finance;
- Reports;
- Alerts;
- Devices / Operations;
- WhatsApp;
- Settings;
- Audit Log.

The top area includes TUX Admin identity, current shop, alerts, and the current page title.

### 7.2 Tablet and desktop

Tablet uses an adaptive sidebar. Desktop uses a full persistent sidebar when space permits.

The repeated management pattern is:

- phone: list → full-screen detail;
- tablet: list/detail split where useful;
- desktop: table/list → inspector or detail panel.

This pattern applies to Catalog, Customers, Staff, Suppliers, Inventory, Orders, and other entity-heavy modules.

### 7.3 Shop context

If the user has one authorized shop, Admin opens directly in that shop. With multiple shops, a current/default shop is shown with a shop switcher. OWNER may choose `All Shops` for supported views.

If an action requires a single shop while `All Shops` is selected, Admin must require the user to choose the target shop before the action can continue.

Public Admin routes should be clean application routes such as `/orders`, `/catalog/products`, and `/inventory`, rather than requiring an `/admin` URL prefix.

---

## 8. Admin Authentication, Sessions, Roles, and Permissions

### 8.1 PIN-only login

The approved login experience is:

```text
Open TUX Admin
→ Enter PIN
→ server identifies the person
→ server loads role, custom permissions, and assigned shops
→ secure Admin session
→ Dashboard
```

There is no email, username, user code, OTP, or Operations-device enrollment step in the normal Admin login flow.

Each active Admin-capable person has an individual numeric PIN. Exact duplicate active PINs must be rejected as a server-side invariant because PIN alone identifies the user. This uniqueness rule must not complicate the UI.

PINs are never stored in plaintext. Verification, rate limiting, temporary lock behavior, session creation, expiry, revocation, and logout are server-controlled. Browser sessions should use secure mechanisms appropriate for web/PWA use; credentials or privileged secrets must not be stored in ordinary client state.

Existing device-bound `worker-auth` must not be reused directly as the Admin login boundary. Admin needs a dedicated trusted `admin-auth` boundary, although proven hashing/rate-limit patterns may be reused internally.

### 8.2 Roles

Built-in role presets:

```text
OWNER
ADMIN
MANAGER
STAFF
```

OWNER has all shops and all permissions. Other users may be assigned selected shops and may have custom permission overrides.

The existing `OPERATIONS_DEVICE` membership concept remains operational infrastructure and must not be broken by the Admin role migration.

### 8.3 Permission model

Authorization is deny-by-default and enforced server-side for every protected read and command. Hiding a button is only a UX aid, never the authorization boundary.

The permission taxonomy should remain stable and grouped by domain, for example:

```text
orders.view
orders.manage
orders.cancel
orders.refund.request
orders.refund.approve
catalog.view
catalog.edit
catalog.publish
catalog.pricing
inventory.view
inventory.adjust
inventory.stocktake
purchasing.view
purchasing.manage
customers.view
customers.manage
staff.view
staff.manage
staff.payments
finance.view
finance.adjust
settings.manage
devices.manage
approvals.review
audit.view
```

Implementation may refine names, but the principles are domain-scoped permissions, server enforcement, and straightforward role presets with an optional `Advanced Permissions` editor.

### 8.4 Sensitive re-authentication and approval

Sensitive actions can require the acting user to re-enter their PIN. High-risk actions may also require second-person approval based on configurable thresholds.

Approved request flow:

```text
User starts sensitive action
→ reason is collected when required
→ request is created
→ authorized approver sees Approve / Reject
→ approver confirms with PIN
→ command executes once
→ immutable audit is recorded
```

---

## 9. Dashboard, Reports, Alerts, Targets, and Owner Summary

The dashboard adapts to role and shop scope rather than showing the same widgets to everyone.

### 9.1 OWNER / ADMIN dashboard

Primary business information includes:

- net sales;
- orders;
- estimated operating profit;
- average order value;
- low/out-of-stock status;
- cash difference;
- failed online orders;
- approvals requiring attention;
- sales trend;
- top products;
- POS vs ONLINE mix;
- shop comparison for `All Shops`.

### 9.2 MANAGER dashboard

Manager emphasis includes:

- current sales and orders;
- active operational issues;
- average order value;
- low stock;
- staff on shift;
- delivery status;
- cash reconciliation;
- approvals assigned to the manager.

STAFF sees only permitted operational/management information.

### 9.3 Reports

Reports remain inside Admin; there is no export functionality.

Supported reporting areas include:

- sales;
- estimated profit and COGS;
- product/category performance;
- inventory consumption, waste, and variance;
- purchasing and suppliers;
- customers, loyalty, promotions, and segments;
- payments, bank/cash, and cash reconciliation;
- staff and attendance;
- delivery;
- returns/refunds;
- expenses;
- shop comparison.

Reports support date/shop filters, comparison periods, saved views, drill-down from summary to underlying records, and role-based access. Report calculations must be authoritative server-side calculations rather than fragile client-only math.

### 9.4 Targets

Authorized users can define practical business targets such as sales, order count, food-cost percentage, waste, or other approved operating targets. Progress should be visible in dashboards/reports without turning Admin into a separate performance-management product.

### 9.5 Alerts

Alerts must be actionable and low-noise. Examples include:

- low or out-of-stock inventory;
- significant stock variance;
- cash variance;
- failed online order;
- large refund awaiting approval;
- overdue purchase order;
- critical device offline;
- attendance issue;
- scheduled publish failure;
- promotion activation failure;
- margin deterioration where configured.

Priority is deliberately simple:

```text
Critical
Needs Attention
Info
```

Users may reorder, resize, or hide noncritical dashboard widgets. Critical alerts cannot be hidden.

### 9.6 Daily owner summary

The system generates a concise daily owner summary server-side using the canonical business data. It should summarize key sales, orders, estimated profit, cash variance, stock issues, major refunds, online-order failures, and important operational exceptions. It is available inside Admin and may use enabled Admin notifications; it must not depend on WhatsApp production setup to exist.

---

## 10. Catalog, Pricing, Availability, and Publishing

### 10.1 Master catalog with shop overrides

Business-level catalog definitions include:

- product identity and name;
- description;
- image;
- category;
- modifier/extra structure;
- combo and drink-option structure;
- base recipe association.

Shop-level overrides include:

- price;
- availability;
- sold-out state;
- shop visibility;
- shop-specific recipe/availability behavior where explicitly supported;
- branch-specific catalog settings.

The current production catalog is shop-scoped. Therefore, the business-level master catalog must be introduced as a compatibility/control layer and safely projected/published into the existing shop-specific canonical catalog contracts used by Menu and Operations. Existing operational tables must not be abruptly replaced.

### 10.2 Catalog UX

Desktop uses a table/list plus a right-side inspector. Phone opens the product editor as a focused full-screen task. Tablet uses adaptive split view.

A product detail surface contains clearly grouped sections:

```text
General
Pricing
Availability
Images
Extras / Modifiers
Combo Options
Recipe / Inventory
Shop Overrides
History
```

High-impact bulk actions are supported where they reduce repetitive work, such as price changes, availability, category assignment, shop assignment, and publish selection. Bulk actions are not import/export.

Used catalog entities are archived/restored rather than hard deleted. An unused draft may be hard deleted before it has business history.

### 10.3 Availability model

Availability can be affected by:

- automatic stock-derived availability;
- manual `Sold Out` override;
- shop-level disabled/hidden status;
- scheduled visibility/availability rules.

The UI must show the human-readable reason a product is unavailable.

If an item is unavailable only because stock is insufficient, normal availability may return automatically when stock becomes available. A manual sold-out override remains active until explicitly removed or its approved schedule changes it.

### 10.4 Immediate controls vs draft publishing

Immediate operational controls include:

- Sold Out / Available;
- pause/resume online ordering;
- urgent stock adjustment;
- employee disable;
- delivery pause.

Catalog/configuration edits use:

```text
Draft
→ Validate
→ Preview
→ Publish atomically
→ Version history
→ controlled rollback
```

Draft-published content includes product names/descriptions, prices, categories, modifiers/extras, combos, images, menu structure, and checkout configuration.

A publish must never leave Menu and Operations on partially applied relationships. The server validates required references and writes/publishes one coherent version. If validation or persistence fails, no partial publish becomes active.

### 10.5 Versioning and historical correctness

Important business configuration is versioned. Historical orders preserve the values effective when the order was created, including applicable price, discount, recipe/cost snapshot, tax/service-charge, delivery fee, payment configuration, modifier/combo selections, and promotion effects.

Rollback creates a new active version based on a prior valid configuration; it does not erase historical versions.

### 10.6 Scheduled publishing

Authorized users may schedule high-value business changes for Egypt local time, including:

- prices;
- availability;
- category/menu visibility;
- promotions;
- delivery fees;
- opening/delivery hours;
- online-order pause/resume.

The server validates the proposed change before accepting the schedule. Activation happens server-side and atomically. Refunds, stock corrections, permissions, and historical financial corrections are not scheduled actions.

### 10.7 Concurrency

Catalog edits use version/concurrency fences. If another user changes an item after the current user opened it, Admin must not silently overwrite the newer state. The user is shown that the data changed and must reload/review before saving or publishing.

---

## 11. Inventory and Recipe Management

TUX already has `inventory_items` and `recipe_lines`. Admin extends this foundation; it must not create a second parallel inventory source of truth.

### 11.1 Hybrid inventory

Inventory supports both:

- recipe-tracked ingredients/raw materials;
- direct-stock products or packaged items.

Examples include ingredients measured by mass/volume and sellable bottles/packages counted directly.

### 11.2 Units and conversions

Each inventory item has a base unit suitable for accurate consumption, such as gram, milliliter, or piece. Purchasing may use kg, liter, case, box, bag, bottle, or other approved units.

Each item may define explicit purchase-to-base conversion, for example:

```text
1 case = 24 pieces
1 kg = 1000 grams
```

Conversions are validated server-side and used consistently in purchasing, receiving, recipe consumption, valuation, and stocktake.

### 11.3 Stock ledger

Inventory is event/ledger based. Relevant movement types include:

- purchase receipt;
- sale consumption;
- waste;
- manual adjustment;
- stocktake adjustment;
- branch transfer out/in;
- purchase return;
- reservation/release lifecycle where represented separately from physical movements.

The UI exposes understandable balances such as:

```text
On Hand
Reserved
Available
Consumed
Waste
Adjustments
Incoming
```

Historical ledger events are not rewritten to make current stock match. Corrections create new auditable movements.

### 11.4 Reservation lifecycle

Approved order/inventory behavior:

- online request before operational acceptance: no stock movement/reservation;
- accepted ONLINE order becomes a canonical operational order: reserve required stock;
- POS order creation: reserve required stock immediately;
- order `DONE`: reserved quantity becomes consumed;
- order `CANCELLED`: reservation is released;
- order `RETURNED`: financial return does not automatically put prepared ingredients back into stock.

Reusable returned stock may be corrected separately by an authorized manager through an audited adjustment.

Negative available stock is blocked by default. An OWNER-only emergency override may allow an exceptional negative movement with explicit reason and audit.

### 11.5 Costing

Inventory valuation uses weighted average cost per shop. Receiving updates weighted average unit cost using the accepted received quantity/cost. Transfers preserve the source cost so moving stock between branches does not create artificial profit or loss.

The system maintains enough information to calculate:

- on-hand inventory value;
- reserved value where useful;
- consumed COGS;
- waste cost;
- adjustment cost;
- recipe/product estimated cost;
- food-cost percentage;
- gross margin.

### 11.6 Par levels and reorder suggestions

Inventory items may have shop-specific par/reorder levels and practical supplier/replenishment settings. Admin can identify items below the configured level and calculate reorder suggestions from current stock, reservations, incoming stock, and target level.

Reorder suggestions remain recommendations; they do not automatically send supplier orders.

### 11.7 Actual vs theoretical usage

Admin compares theoretical inventory consumption derived from completed orders/recipes against actual ledger/stocktake results. This supports identifying waste, over-portioning, recording mistakes, or unexplained shrinkage.

### 11.8 Stocktake / physical count

Formal stocktake supports:

- shop selection;
- full or partial/category count;
- stable count snapshot/boundary;
- optional blind count;
- entered physical quantity;
- system quantity;
- quantity and value variance;
- recount;
- reason for significant differences;
- approval where required;
- posting one audited adjustment to reconcile the ledger.

Concurrent sales/receipts must not corrupt the comparison. Implementation must use a stable stocktake boundary/snapshot and account for movements occurring after that boundary.

Lot/batch/expiry tracking is not part of this restaurant-focused Admin unless a future separate requirement explicitly introduces it.

### 11.9 Start-of-day and end-day inventory controls

Where configured for a shop, Admin/Operations management views may expose opening inventory reference/snapshot information and end-day inventory usage/reconciliation. These controls use the canonical ledger; they do not create a second inventory balance or destructive daily reset.

---

## 12. Purchasing and Suppliers

Supplier identity is business-level. Purchase orders and receiving are shop-specific.

Supplier information includes name, contact details, notes, status, and relevant commercial references.

Purchase order lifecycle:

```text
DRAFT
→ ORDERED
→ PARTIALLY_RECEIVED
→ RECEIVED

or → CANCELLED
```

Purchasing supports:

- supplier selection;
- shop selection;
- line items and purchase units;
- expected quantities/costs;
- partial receiving;
- receiving discrepancies;
- stock posting from accepted received quantity;
- supplier invoice/reference/attachment;
- last purchase price;
- cost history;
- weighted average cost update;
- payment status;
- supplier balance/status;
- purchase return;
- overdue PO visibility.

Receiving is authoritative only after the server validates units, quantities, shop, permissions, and PO state.

Purchasing contributes to product/recipe cost and estimated margin reporting but does not become a full ERP or general ledger.

---

## 13. Orders and Operational History

Admin can view canonical POS and ONLINE orders together.

Search/filter dimensions include:

- shop;
- date/time;
- worker;
- customer;
- status;
- source;
- order/reference number.

Order details include items, modifiers, combos, discounts, promotions, payments, customer context, audit/status events, applicable inventory effects, and return/refund history.

Order status model remains compatible with the existing canonical values:

```text
ACTIVE
DONE
CANCELLED
RETURNED
```

Rules:

- ACTIVE orders may be viewed and, with permission, controlled through explicit cancellation/management commands;
- DONE orders are immutable as historical sales; corrections use refund/return flows rather than editing the sale;
- CANCELLED and RETURNED historical states are immutable;
- canonical orders are never hard-deleted;
- every sensitive management action records actor, shop, reason, time, and resulting state.

Admin is not used to manually edit finalized order line prices or settled payment history.

---

## 14. Customers, CRM, Loyalty, Promotions, and Segments

### 14.1 Canonical customer identity

Customer identity is business-level rather than duplicated per shop.

Normalized Egyptian phone number is the primary identity key. Equivalent forms such as `010...`, `+20...`, `0020...`, and `20...` must canonicalize consistently. Name similarity alone never merges customers.

The current `customer_contacts` model is shop-scoped. The Admin architecture therefore adds a business-level canonical customer layer with a safe mapping to existing shop-scoped/order references rather than breaking historical orders.

Customer profile includes:

- normalized phone;
- display name;
- multiple addresses;
- notes and tags;
- order history across shops;
- total spend;
- order count;
- average order value;
- last order;
- branch history;
- derived favorites where useful;
- loyalty state.

Duplicate merge is a sensitive confirmed action. It combines identities, addresses, loyalty, and future profile references while preserving original order/audit history.

### 14.2 Loyalty

Loyalty supports:

- points earning;
- points redemption;
- configurable earning/redemption rules;
- minimum redemption threshold;
- optional expiry policy;
- manual adjustment with permission, reason, and audit.

Historical loyalty events remain auditable.

### 14.3 Promotions

Promotion definitions can be business-level and assigned to selected shops/channels.

Supported promotion behavior includes:

- code-based promotions;
- fixed discount;
- percentage discount;
- free item;
- minimum order;
- shop/all-shop scope;
- start/end time;
- usage limit;
- per-customer usage limit;
- POS / ONLINE / BOTH applicability;
- interaction with checkout discount-stacking rules.

Promotion activation can be scheduled through the canonical publishing/scheduling mechanism.

### 14.4 Customer segments

Admin may define practical customer segments using canonical data, such as recent/frequent/high-value/lapsed customers or other approved rule-based groups. Segments support reporting and promotion targeting. They must not create destructive customer duplication or depend on external marketing automation.

---

## 15. Staff, Shifts, Attendance, and Staff Payments

Employee identity is business-level with shop assignments. Existing shop/worker operational identities remain compatible with Operations execution.

Staff profile supports:

- name;
- individual Admin/worker PIN as appropriate;
- role and custom permissions;
- assigned shops;
- active/suspended state;
- hire date;
- phone;
- notes.

Workforce features include:

- weekly schedule;
- shop assignment;
- shift start/end;
- breaks;
- clock-in/clock-out records;
- worked time;
- late/absent indicators;
- overtime estimate;
- leave types such as vacation, sick, and other;
- leave approve/reject;
- worker activity/log history where operationally available.

### 15.1 Wage tracking

Admin supports practical wage estimation for hourly and monthly staff:

- expected hours;
- worked hours;
- overtime;
- hourly/monthly basis;
- estimated payable amount.

It does not become a statutory payroll/tax engine.

### 15.2 Staff payment records

Authorized users can record a staff payment with:

- employee;
- period;
- expected amount;
- paid amount;
- payment account/method, such as cash or a configured bank account;
- payment date;
- note/reference where useful.

Posting the payment reduces the selected cash/bank balance through an auditable finance event and contributes to wage/salary expense reporting without pretending to perform full payroll accounting.

Disabling an employee, resetting a PIN, changing role/permissions, or moving shop assignments is audited and may require sensitive re-authentication/approval.

---

## 16. Delivery Management

Delivery is shop-aware and configuration-driven.

Delivery-zone configuration includes:

- zone name;
- area/map definition;
- fee;
- minimum order;
- ETA;
- enabled state;
- shop assignment;
- zone priority if areas overlap;
- delivery hours;
- temporary pause;
- maximum distance where used.

Online address handling follows:

```text
Customer address
→ resolve delivery zone
→ resolve/route to correct shop
→ calculate delivery fee + rules
→ submit order to that shop
```

Rider management supports name, phone, assigned shop, active status, and delivery assignment.

Delivery status flow:

```text
UNASSIGNED
→ ASSIGNED
→ OUT_FOR_DELIVERY
→ DELIVERED

or → FAILED / RETURNED
```

Live GPS tracking is not included.

---

## 17. Finance, Bank/Cash, Expenses, Reconciliation, and Profit

Operations owns live transactional payment execution and business-day cash activity. Admin supervises, reports, reconciles, and performs controlled management adjustments.

### 17.1 Financial dashboard/reporting

Admin reports:

- sales today/week/month/custom period;
- cash/card/other payment methods;
- POS vs ONLINE;
- refunds/returns/discounts;
- purchases;
- gross and net sales;
- COGS;
- gross profit;
- food-cost percentage;
- expenses;
- estimated operating profit;
- shop/worker/payment/product/category/time comparisons.

Estimated operating profit is defined clearly as:

```text
Net Sales - COGS - Expenses = Estimated Operating Profit
```

It is an operating estimate, not statutory accounting profit.

### 17.2 Expenses

Expense management supports:

- amount;
- date;
- shop;
- category;
- note;
- optional receipt attachment;
- one-time or recurring definition.

Core categories include rent, salaries/wages, utilities, maintenance, marketing, delivery, supplies, and other. Authorized configuration may add useful categories without turning the feature into a chart-of-accounts system.

Recurring expenses generate expected/recordable business expense events according to the configured schedule; they are auditable and editable prospectively rather than rewriting historical posted expenses.

### 17.3 Bank and cash accounts

Admin maintains simple money-position accounts such as shop cash and named bank accounts. It supports auditable balance-affecting events, including:

- operational cash movement summaries;
- bank deposit;
- bank withdrawal;
- transfer between configured internal money accounts where allowed;
- staff payment;
- expense payment;
- approved financial correction.

Every manual movement requires permission and appropriate reason/reference. Historical movements are not silently overwritten.

This feature is business cash/bank tracking, not bank-feed reconciliation and not double-entry accounting.

### 17.4 Cash reconciliation

Admin shows expected vs actual cash for the business day/shop and calculates over/short variance. A manager/owner may review, enter actual count, provide a reason for material variance, and approve/post the reconciliation.

Historical reconciliation is immutable. Corrections use an explicit adjustment event.

### 17.5 Opening, X, and End-Day Z history

Admin provides management visibility over opening/closing history and X/Z-style summaries without taking live Operations authority away from the POS flow.

- opening reference/status shows the active business-day context;
- X report is a non-closing current-period snapshot;
- End-Day Z history shows finalized business-day totals and reconciliation results;
- previous days remain immutable;
- corrections occur through authorized adjustment events, not report resets.

No destructive report reset/purge is allowed for canonical business history.

---

## 18. Payments, Checkout, Order Types, Receipts, and Reason Codes

### 18.1 Payment methods

Payment methods are fully editable per shop and may include Cash, Card, Online, Wallet, and Custom methods.

Configuration includes:

- enabled/disabled;
- POS / ONLINE / BOTH;
- display name;
- sort order;
- reference requirement;
- manual confirmation requirement;
- refund allowed;
- shop assignment.

Provider secrets stay server-side and are never displayed to ordinary Admin/browser code.

Historical settled payments preserve their original method/value even if the method configuration changes later.

### 18.2 Checkout rules

Shop-level checkout rules include:

- minimum order;
- service charge;
- tax/VAT configuration;
- delivery-fee behavior;
- discount-stacking rules;
- payment restrictions by shop/zone/channel.

Sensitive payment/tax configuration changes require appropriate permission and audit and use draft/publish semantics where they affect future order pricing.

### 18.3 Order types

Admin explicitly manages canonical order types such as:

```text
Dine In
Take Away
Delivery
Pickup
```

Order types may be enabled/disabled and scoped by shop/channel according to supported business rules. Historical orders retain the order type recorded at sale time.

### 18.4 Receipt and order-number settings

Each shop has one controlled receipt/order settings area containing:

- receipt business/shop name;
- address;
- phone;
- tax information where applicable;
- footer text;
- order-number sequence/prefix rules;
- printer assignment/routing reference.

Changes affect future receipts/orders only. Historical receipts/orders keep their original transaction data.

### 18.5 Central reason codes

Reason codes are centrally managed so reporting does not fragment equivalent reasons into free-text variants.

Reason families include:

- order cancellation;
- refund/return;
- discount/comp;
- waste;
- stock adjustment;
- cash variance;
- pay-in/pay-out;
- other approved sensitive adjustments.

The system provides sensible defaults and allows authorized custom reasons. A note may still be required for exceptional cases, but canonical reason codes are used for reporting and audit.

---

## 19. Shops, Devices, Printers, Shop Health, and Operations Management

### 19.1 Shop settings

Shop settings include:

- name;
- canonical address;
- phone;
- geographic coordinates/location where configured;
- opening hours;
- delivery hours;
- receipt info;
- order numbering;
- payment methods;
- checkout/tax/service-charge rules;
- delivery configuration;
- menu visibility;
- stock rules;
- printer/device settings;
- temporary close;
- pause online orders.

Business time is always `Africa/Cairo`; shop/business timestamps are rendered and scheduled in Egypt local time while database timestamps remain proper absolute timestamps.

### 19.2 One canonical shop contact/location authority

Shop identity data is stored once and reused consistently by:

- Menu;
- Delivery;
- Receipts;
- WhatsApp store-location messages;
- Shop Settings;
- other integrations that need the official shop contact/location.

Individual modules must not maintain conflicting copies of the shop address/phone/location.

### 19.3 Shop management

Authorized users can create/edit shops, temporarily suspend them, archive them, assign users, copy selected settings/catalog configuration, manage overrides, and inspect health.

Used shops are never hard deleted.

### 19.4 Operations devices

Admin can view and manage Operations devices with:

- device label;
- assigned shop;
- active/disabled state;
- last seen;
- current configuration version;
- application/build information where available;
- online/offline health.

Authorized actions include force configuration refresh, revoke/deactivate device, and enrollment management.

### 19.5 Printers

Printer management covers receipt/kitchen printers, routing, enable/disable, and safe test print. Admin does not expose dangerous remote control such as opening cash drawers remotely or creating live orders on behalf of Operations.

### 19.6 Shop Health

Shop Health provides a concise operational view such as:

- Operations device online/offline;
- last sync;
- active business-day status;
- active worker where applicable;
- configuration version current/stale;
- online-order health;
- printer health where available;
- WhatsApp integration status if configured.

### 19.7 Opening/closing and Manager Log

Admin provides management visibility over opening/closing records and a concise Manager Log for significant operational events, handover notes, exceptions, and review items. It complements, rather than replaces, canonical business-day/order/audit events.

---

## 20. WhatsApp Control Center

WhatsApp is represented in Admin as an integration/control surface but actual Meta provider connection and production acceptance are not blockers for Admin implementation.

The Admin may provide:

- configured/unconfigured connection state;
- server-side integration settings/status;
- message template/configuration controls that are safe for Admin users;
- automatic order-event message enable/disable rules;
- shop/contact/location information sourced from the canonical shop profile;
- operational health/error visibility;
- message history/status where supported by the backend.

Automatic order-event messages may cover approved customer events such as order acceptance/status changes when the provider is connected and the underlying production workflow supports them.

Meta access tokens, app secrets, webhook secrets, or provider credentials are server-only and must never be returned to the browser.

The existing WhatsApp implementation can remain `PENDING REAL META ACCEPTANCE` until a separate real-provider setup/acceptance exercise is completed. Admin must behave safely when WhatsApp is not configured.

---

## 21. Audit, Approvals, and Historical Immutability

### 21.1 Audit log

Sensitive and meaningful management actions produce immutable audit entries containing enough context to answer:

- who acted;
- their role/session;
- which shop/business scope;
- what entity/action;
- old value/state where relevant;
- new value/state;
- reason code/note where required;
- timestamp;
- device/session metadata where useful;
- approval request/result where applicable.

Audit records cannot be edited by normal Admin users.

### 21.2 Approval thresholds

Approval rules are configurable for high-risk actions such as:

- large refunds;
- large stock adjustments;
- large cash/financial corrections;
- permission/PIN reset changes;
- shop archive/suspension;
- sensitive payment/tax configuration;
- large price change;
- other explicitly configured risk thresholds.

The UI stays simple: request, one-tap approve/reject, PIN confirm, result.

### 21.3 Immutable history

Canonical historical business events are never silently edited or deleted. This includes finalized orders, payments, stock ledger movements, stocktakes, reconciliations, posted expenses, staff payments, published versions, and audit records.

Corrections are represented as new compensating/adjustment events.

---

## 22. Scheduling and Time Semantics

The business timezone is always `Africa/Cairo` and Admin is English-only.

Database timestamps remain absolute `timestamptz`-style values. Admin renders user-visible date/time in Egypt local time. Business-day boundaries and scheduled activation rules use `Africa/Cairo` semantics.

Scheduled changes are stored with validated intended local activation time plus an unambiguous canonical instant. The server scheduler activates due changes and records success/failure in audit/alerts.

Schedules may be used for approved configuration/promotion/hour changes and recurring operational/expense definitions, not for destructive historical rewrites.

---

## 23. PWA, Connectivity, and Offline Behavior

Admin is an installable mobile-first PWA.

Supported behavior includes:

- Add to Home Screen / installable shell;
- standalone display shell;
- app icon/splash metadata;
- secure remembered session behavior;
- cached application shell;
- update-available notification;
- optional web push for important Admin alerts where supported.

Admin writes are online-only.

If connectivity is lost, Admin may display a safe cached/current read view with a clear `OFFLINE` or `STALE` indication, but it must not queue sensitive mutations such as:

- stock changes;
- price changes;
- refunds;
- permission changes;
- publish operations;
- cash/financial adjustments.

This prevents replay, conflict, and double-posting problems in finance/inventory.

---

## 24. Data Contracts, Commands, and Server Boundaries

Admin should use explicit application contracts rather than component-specific database assumptions.

A useful contract pattern is:

```text
Query DTO / View Model
Command Request
Server authorization
Server validation
Transactional domain change
Audit event
Updated authoritative view/version
```

Commands that can create financial, inventory, publishing, approval, or identity side effects require server-generated idempotency handling where duplicate browser retries could otherwise double-apply an action.

Business commands must receive explicit shop/business context. The server validates that the session may act on that scope; it must never trust a browser-supplied `shop_id` solely because it exists in the request.

Server/RPC transactions should group logically atomic changes. Examples include:

- publish catalog version + active projection pointer/config snapshot;
- receive PO + inventory ledger movements + cost update;
- approve stocktake + adjustment posting;
- post staff payment + money-account movement + expense/reporting event;
- approve refund + financial event + order return/refund history.

---

## 25. Data-Model Evolution and Compatibility Strategy

The implementation plan should introduce schema changes incrementally and preserve production contracts.

### 25.1 Business-level layer

Add a business/organization parent concept and shop membership relation without removing existing `shops` or shop-scoped operational references.

Business-level entities should include or support:

- master catalog identity;
- canonical customers;
- canonical employees;
- suppliers;
- promotion definitions;
- role/permission presets;
- reason codes.

### 25.2 Catalog compatibility

Existing shop-scoped product/category/modifier/combo structures remain the published operational representation. The Admin master model publishes compatible shop-specific projections/snapshots.

### 25.3 Customer compatibility

A canonical business-level customer identity maps safely to existing shop-scoped customer contact/order references. Historical order foreign keys are not rewritten unnecessarily.

### 25.4 Staff compatibility

A business-level employee/person identity maps to shop assignments and any existing Operations worker identity needed for device/POS execution. Admin permissions are distinct from Operations-device membership.

### 25.5 Inventory extension

Extend existing inventory items/recipes with ledger, reservation, costing, purchasing, transfer, par-level, and stocktake structures. Do not duplicate inventory balances in a competing table model.

### 25.6 Roles

Extend current membership/authorization structures to support `MANAGER` and `STAFF` plus explicit permissions while preserving `OWNER`, `ADMIN`, and `OPERATIONS_DEVICE` behavior where already relied upon.

---

## 26. Concurrency, Idempotency, and Error Handling

### 26.1 Concurrency

Mutable configuration entities use version checks. A stale user cannot overwrite a newer edit without reviewing it.

Financial/inventory commands run transactionally and use appropriate locking/version rules so two admins cannot accidentally post incompatible changes to the same logical state.

### 26.2 Idempotency

Commands vulnerable to duplicate submission use idempotency keys or equivalent server-side uniqueness so browser retries, double taps, or network retries do not create duplicate receipts, stock movements, refunds, or financial adjustments.

### 26.3 Error UX

Errors must be written in plain English and tell the user what happened and what to do next.

Examples:

- `This product changed while you were editing it. Review the latest version before saving.`
- `The stock count could not be posted because another stocktake was finalized first.`
- `This refund was already processed.`
- `You no longer have permission for this shop.`
- `You are offline. Changes cannot be saved until the connection returns.`

Partial business changes must not be exposed as successful. If an atomic command fails, the UI remains on the prior authoritative state and may safely retry after the server confirms the failure.

---

## 27. Security Requirements

Security is primarily enforced in the trusted backend.

Required principles:

- no service-role/provider secrets in browser bundles;
- PINs stored only as secure hashes, never plaintext;
- rate-limited PIN verification and temporary abuse protection;
- secure session cookies/tokens and explicit revocation;
- server-side role/permission/shop authorization;
- deny-by-default access;
- re-PIN for configured sensitive actions;
- immutable audit for meaningful changes;
- attachment access controlled by authorization and signed/limited URLs where applicable;
- no user-supplied shop scope trusted without membership validation;
- input/schema validation on every command;
- server enforcement of allowed state transitions;
- secrets redacted from logs and API responses.

Public Menu access remains separate from authenticated Admin authority.

---

## 28. Testing Strategy

Implementation must use automated tests at contract/domain boundaries and critical UI flows.

### 28.1 Domain/contract tests

Cover at minimum:

- PIN login success/failure/rate limit/session expiry;
- role/shop authorization and deny-by-default behavior;
- catalog validation, draft/publish, rollback, schedule activation, and stale-version conflicts;
- master-to-shop catalog projection compatibility;
- order immutability/refund-return commands;
- inventory reservation lifecycle;
- weighted-average cost calculations;
- unit conversions;
- stocktake boundary/variance/posting;
- purchase partial receiving and returns;
- par/reorder calculations;
- actual-vs-theoretical inventory reporting;
- customer phone normalization and duplicate merge;
- loyalty/promotions;
- staff attendance/wage estimates/staff payment posting;
- cash/bank movements and reconciliation;
- recurring expenses;
- audit/approval thresholds;
- payment/order-type/receipt/reason configuration;
- shop/device authorization and health data;
- WhatsApp-safe behavior when unconfigured;
- scheduled actions across Cairo local-time transitions.

### 28.2 Integration tests

Critical integration flows include:

```text
Admin publish
→ canonical Supabase
→ Menu reads new published catalog
→ Operations receives matching config/version
```

```text
POS/accepted online order
→ reservation
→ DONE
→ consumption/COGS
→ dashboard/report update
```

```text
Purchase receipt
→ stock increase
→ weighted average cost update
→ recipe/product margin update
```

```text
Stocktake
→ stable comparison
→ approval if required
→ adjustment ledger
→ variance report/audit
```

```text
Staff payment
→ finance movement
→ salary/wage expense/reporting
→ audit
```

### 28.3 UI/end-to-end tests

Test priority paths on phone viewport first, then tablet/desktop:

- PIN login;
- shop switch;
- sold-out toggle;
- edit/preview/publish product;
- stock adjustment;
- stocktake;
- receive purchase order;
- search/view/refund order;
- customer lookup/merge protection;
- staff/permission change;
- cash reconciliation;
- bank/cash movement;
- approval request/review;
- schedule a price/promotion/hour change;
- offline read + blocked mutation;
- installable PWA shell.

Accessibility tests cover keyboard behavior on desktop, focus order, labels, touch target sizing, contrast, and screen-reader semantics for primary workflows.

---

## 29. Deployment and Operational Safety

`apps/admin` is deployed as a separate Vercel project from the same monorepo.

Deployment must not require moving Operations or Menu to a new repository. Environment variables are scoped to the Admin Vercel project and backend environment as appropriate.

Schema migrations must be backwards compatible with currently deployed Menu/Operations during rollout. New data structures should be additive first; destructive migrations are not acceptable while old production clients depend on existing contracts.

Feature/config rollout must preserve one canonical Supabase source of truth.

Admin production acceptance requires confirming:

- authentication and permission boundaries;
- shop scoping;
- catalog publish compatibility with Menu/Operations;
- inventory and financial atomicity;
- mobile workflows;
- audit creation;
- schedule activation;
- device/shop-health reads;
- PWA behavior;
- no browser exposure of server/provider secrets.

WhatsApp real Meta provider acceptance is a separate external integration acceptance item and is not required to consider Admin itself implemented correctly when the integration is configured as unavailable/pending.

---

## 30. Archive and Delete Policy

Deletion policy is consistent across the Admin:

```text
Unused draft with no business history → hard delete may be allowed
Used business entity               → archive / restore
Historical transaction/audit       → immutable; never delete through normal Admin
```

This applies to products, employees, suppliers, shops, promotions, configuration versions, and comparable entities according to their business history.

---

## 31. Explicitly Excluded Scope

The following are intentionally not part of this Admin design:

- import functionality;
- export functionality;
- restaurant reservations/table map;
- tip pooling;
- gift cards/store credit/customer debt;
- full accounting/general ledger/tax filing;
- statutory payroll/tax engine;
- direct bank feeds;
- automatic supplier ordering;
- live GPS rider tracking;
- AI marketing/generative campaign tooling;
- inventory lot/batch/expiry tracking;
- dangerous remote POS actions such as remote cash-drawer opening;
- actual Meta/WhatsApp provider setup as a blocker for Admin completion.

---

## 32. Completeness and Implementation Boundary

This written design captures the approved full TUX Admin product scope, including the previously discussed capabilities that could otherwise be missed:

- explicit Order Types management;
- receipt and order-number settings;
- central reason codes;
- one canonical shop contact/location authority;
- staff payment records tied to cash/bank and expenses;
- opening/closing, X/Z history, manager log, and non-destructive inventory/end-day reconciliation;
- par levels and reorder suggestions;
- actual-vs-theoretical inventory usage;
- margin/food-cost visibility and alerts;
- advanced report filters/comparison/saved views/drill-down;
- daily owner summary;
- recurring schedules where approved;
- customer segments;
- targets;
- Bank & Cash money-position management;
- WhatsApp control and automatic order-event message configuration;
- devices, printing, shop health, and online-order health controls.

There are no product-discovery placeholders in this specification. Implementation details that do not alter approved user-visible behavior may be selected during implementation planning, but they must respect the architecture, security, compatibility, mobile-first UX, historical immutability, and scope boundaries defined here.

The next process step after written-spec approval is to create the implementation plan. No implementation/scaffolding should begin before that plan is reviewed through the agreed Superpowers workflow.
