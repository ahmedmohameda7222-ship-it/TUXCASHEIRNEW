# TUX Admin — Full Business Admin Design Specification

**Date:** 2026-09-10  
**Status:** Approved design captured for user review before implementation planning  
**Repository:** `ahmedmohameda7222-ship-it/TUXCASHEIRNEW`  
**Target application:** `apps/admin`  
**Design authority:** TUX product requirements + Apple Human Interface Guidelines adapted for web  
**Business timezone:** `Africa/Cairo`  
**Default currency:** EGP  
**Language:** English only

---

## 1. Purpose

TUX Admin is the management and control plane for the TUX restaurant platform. It must give owners, admins, managers, and permitted staff a simple mobile-first interface for managing the business while preserving the authority and reliability of the existing Menu and Operations applications.

The governing product principle is:

> Complex business logic underneath. Very simple decisions on the screen.

The Admin is not another POS. It configures, supervises, reports, approves, and manages. TUX Operations remains responsible for live operational execution; TUX Menu remains responsible for the customer ordering experience.

This is a full business Admin design. Everything explicitly approved in this specification is in scope for the implementation effort. Features explicitly excluded in this document are out of scope. There is no import functionality and no export functionality.

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

---

## 3. Product Ownership Boundaries

### TUX Admin

Admin owns management and control workflows:

- business and shop configuration;
- catalog management and publishing;
- inventory supervision and adjustment;
- purchasing and suppliers;
- customer management, loyalty, and promotions;
- staff, permissions, shifts, attendance, and wage estimates;
- delivery and checkout configuration;
- finance reporting, expenses, and reconciliation;
- approvals and audit;
- device and shop health supervision;
- reports and alerts.

### TUX Operations

Operations remains the authority for:

- live POS/order execution;
- operational worker activity;
- business-day execution;
- live payment execution;
- accepted online-order execution;
- operational device behavior.

### TUX Menu

Menu remains the authority for:

- customer-facing catalog rendering;
- cart and checkout interaction;
- online-order intake.

### Canonical Supabase

Supabase remains the canonical data authority. Frontend state is never business authority.

---

## 4. Deployment Architecture

`apps/admin` stays in the same GitHub monorepo but receives its own Vercel project.

```text
GitHub monorepo
    ├── Operations Vercel project
    ├── Menu Vercel project
    └── Admin Vercel project
```

All applications use the same canonical Supabase/backend authority.

Admin production deployment must come from `main`. Browser-safe configuration only may be exposed to the Admin client. Service-role keys, payment-provider secrets, Meta/WhatsApp secrets, webhook secrets, and similar privileged credentials remain server-side.

WhatsApp provider setup is not required for Admin completion. Admin may show WhatsApp integration status as `Not Configured` until real Meta setup is completed.

---

## 5. Multi-Shop Business Model

TUX Admin is multi-shop ready from the first implementation.

The approved model is **Global Business Identity + Per-Shop Operational Data**.

### Business-level data

Business-level entities include:

- master product identity and definition;
- canonical customer identity;
- loyalty account and business loyalty rules;
- employee identity;
- role and permission presets;
- supplier identity;
- promotion definitions;
- business settings and defaults.

### Shop-level data

Shop-scoped operational data includes:

- prices and branch overrides;
- availability and stock;
- orders and payments;
- expenses;
- purchasing and receiving;
- delivery zones;
- shifts and attendance context;
- cash and business days;
- devices;
- branch-specific settings and rules.

Business defaults are inherited by shops unless a permitted branch override exists. The UI must clearly show whether a value is inherited or overridden and allow a one-action return to the business default.

Used business records are archived, not hard-deleted. Unused drafts may be deleted.

---

## 6. Admin Authentication, Roles, Permissions, and Shop Access

### PIN-only login

The approved login experience is:

```text
Open TUX Admin
→ enter personal PIN
→ server identifies user
→ server loads role, permissions, assigned shops
→ secure Admin session
→ dashboard
```

There is no email, username, user code, OTP, or Operations device-enrollment requirement in the normal Admin login flow.

Each active Admin-capable person has a personal numeric PIN. Exact duplicate active PINs must be rejected as a technical invariant because PIN alone identifies the user. PINs are stored only as secure hashes. The server performs verification, rate limiting, temporary lock behavior, session issuance, session expiry, and audit attribution.

Admin authentication must use its own trusted server boundary. Existing Operations worker-auth patterns for secure hashing and rate limiting may be reused conceptually, but Admin authentication must not depend on an Operations device identity.

### Roles

Approved role presets:

- `OWNER`
- `ADMIN`
- `MANAGER`
- `STAFF`

Existing `OPERATIONS_DEVICE` semantics must remain intact in the current system and must not be conflated with human Admin roles.

`OWNER` has all shops and all permissions. Other users may be assigned selected shops and may receive a role preset plus custom per-user permission overrides.

### Permission model

Permissions are deny-by-default and enforced on the server. Hiding UI controls is only a usability feature, never the security boundary.

Stable permission families should cover at least:

```text
orders.*
catalog.*
inventory.*
purchasing.*
customers.*
loyalty.*
promotions.*
staff.*
finance.*
delivery.*
devices.*
settings.*
audit.*
approvals.*
reports.*
```

The implementation plan may refine the exact permission identifiers, but the taxonomy must remain stable and domain-based rather than ad hoc per screen.

### Shop selection

If a user has one shop, Admin opens directly into that shop. If the user has multiple shops, the current shop is always visible and switchable. Owners may select `All Shops` for aggregate reporting.

When `All Shops` is selected, any mutation that requires a specific shop must first require an explicit shop choice.

### Sensitive actions

Sensitive actions may require re-entry of the user PIN. Threshold-based actions may require a second authorized approval.

---

## 7. Admin Shell and Navigation

### Phone

The mobile-first bottom navigation is:

```text
Home
Orders
Catalog
Inventory
More
```

`More` contains, according to permission:

```text
Customers
Purchasing
Staff
Delivery
Finance
Reports
Alerts
Devices
Settings
Audit Log
```

### Tablet

Tablet uses an adaptive sidebar and split-view list/detail layouts where useful.

### Desktop

Desktop uses a full sidebar, tables/lists, right-side inspector/detail views, toolbar search, shop context, alerts, and user controls.

The same routes, permissions, domain logic, and APIs power all breakpoints. This is one adaptive application, not separate phone/tablet/desktop products.

---

## 8. Dashboard, Reports, and Alerts

The dashboard is role-adaptive.

### Owner/Admin dashboard

Typical primary metrics:

- net sales;
- order count;
- estimated operating profit;
- average order value;
- low-stock count;
- cash variance;
- failed online orders;
- pending approvals.

Useful analytical blocks include sales trend, top products, POS vs ONLINE mix, and shop comparison.

### Manager dashboard

Focuses on the selected shop and operational responsibility:

- sales and orders;
- active orders;
- average order value;
- low stock;
- staff on shift;
- delivery status;
- cash reconciliation;
- pending approvals within authority.

### Staff dashboard

Shows only widgets permitted by that user's role and permissions.

### All Shops view

Owner aggregate mode shows total sales, total orders, estimated profit, shop ranking, cash variances, critical stock, purchasing concerns, and online-order failures.

### Reports

Reports remain inside Admin. No import or export functionality is included.

Reporting domains:

- sales;
- profit and COGS;
- product performance;
- inventory and waste;
- purchasing and suppliers;
- customers, loyalty, and promotions;
- payment and cash reconciliation;
- staff and attendance;
- delivery;
- refunds/returns;
- expenses.

Reports support date and shop filters and use server-side aggregation.

### Alerts

Alerts must be actionable and low-noise. Priority labels are:

```text
Critical
Needs Attention
Info
```

Examples include low/out-of-stock items, large stock variances, cash variances, failed online orders, approval requests, overdue purchase orders, critical device outages, attendance issues, and scheduled publish failures.

Users may reorder, hide noncritical widgets, resize where useful, and reset layouts. Critical alerts cannot be silently hidden from roles responsible for them.

---

## 9. Catalog, Pricing, Availability, and Publishing

### Master Catalog + shop overrides

Each product has one business-level identity and definition:

- name;
- description;
- image;
- category;
- type;
- modifiers/extras;
- combo structure;
- recipe association;
- active/archive status.

Shop-specific overrides may include:

- price;
- availability;
- Sold Out state;
- visibility;
- permitted branch-specific settings;
- recipe override only where intentionally supported.

Because the current canonical catalog is physically shop-scoped, the implementation must introduce a compatibility/control layer that can represent master identity while publishing safe shop-specific canonical projections. It must not replace working Menu/Operations contracts with an incompatible model.

### Product types

UI may expose simple types such as:

```text
Standard Product
Combo
Direct-Stock Product
```

Irrelevant fields are hidden through progressive disclosure.

### Pricing

Pricing supports:

- business default/base price;
- per-shop override;
- scheduled future price;
- high-impact bulk actions such as percentage/absolute price changes, category reassignment, availability changes, shop assignment, and publish.

There is no import/export workflow.

### Availability

Final availability is derived from independent business facts:

```text
manual override
+ stock-based availability
+ shop-enabled state
```

Admin must show a human-readable reason such as `Out of Beef` or `Manually marked Sold Out`.

Automatic stock unavailability may clear when stock returns. Manual Sold Out remains until explicitly removed.

### Images

Admins may take/select/upload an image, crop/preview it, and save the draft. Image optimization and storage details are automatic and hidden.

### Draft and publish model

Structural/business catalog changes use:

```text
Edit
→ Save Draft
→ Preview
→ Publish
```

Publish is atomic. Menu and Operations must never observe a partially updated configuration.

Immediate operational actions may bypass draft/publish when intentional, including Sold Out/Available, urgent item pause, and emergency hide.

### Scheduled publishing

Scheduled activation is allowed for high-value business configuration:

- prices;
- availability;
- category/menu visibility;
- promotions;
- delivery fees;
- opening/delivery hours;
- online-order pause/resume.

Schedules are entered and interpreted in `Africa/Cairo`; server activation is atomic and audited.

### Version history and rollback

Published catalog/configuration versions are retained. Rollback creates a new published version based on a previous one; it never erases history.

A stale draft cannot silently overwrite a newer live version. Conflict review is required.

---

## 10. Inventory, Recipes, Costing, and Stock Lifecycle

TUX must extend the existing inventory foundation rather than create a parallel inventory system.

### Inventory item model

Each item has:

- name;
- base unit;
- purchase-unit conversions;
- tracking behavior;
- low-stock threshold;
- on-hand quantity;
- reserved quantity;
- available quantity;
- weighted-average unit cost;
- inventory value.

Human-facing item types remain simple, such as Ingredient and Direct-stock item.

### Units and conversion

Each item has one canonical base unit such as gram, milliliter, or piece. Purchase units such as kg, liter, case, box, bag, or bottle map through configured conversions.

### Recipes

Recipes define ingredient consumption per product. Admin automatically calculates estimated product cost, food cost percentage, and gross margin estimates.

Recipe changes are versioned so historical orders keep their historical cost basis.

### Reservation lifecycle

Approved order/inventory behavior:

```text
Online request before accepted order → no stock movement
Accepted ONLINE order              → reserve stock
POS order created                  → reserve stock immediately
DONE                               → reserved becomes consumed
CANCELLED                          → release reservation
RETURNED                           → financial reversal; no automatic food-stock restoration
```

Reusable returned stock requires a separate authorized inventory adjustment.

### Negative stock

Negative available stock is disallowed by default. An authorized owner may perform an explicit audited emergency correction when the recorded inventory itself is wrong.

### Inventory ledger

Admins do not directly overwrite stock quantities as historical truth. Quantity changes create ledger movements such as:

- receiving;
- sale consumption;
- reservation;
- reservation release;
- waste;
- manual adjustment;
- transfer;
- stocktake adjustment;
- purchase return.

A performant current-stock projection may be maintained, but the ledger remains the historical explanation of stock state.

### Waste

Waste entry captures item, quantity, reason, shop, actor, and cost impact. Reports may show waste quantity/value by item/shop/time.

### Stocktake

Formal physical stock count supports:

- full shop count;
- category/partial count;
- blind count where configured;
- recount;
- system-vs-actual variance quantity and value;
- reason for significant differences;
- approval where required;
- audited ledger adjustment.

Stocktake uses a stable inventory boundary/snapshot so concurrent sales or receiving do not corrupt the comparison.

### Transfers

Branch transfer lifecycle:

```text
REQUESTED
→ SENT
→ RECEIVED
```

Destination stock appears only after receipt confirmation. Variances are recorded with reason. Transfer cost preserves source inventory cost so inter-branch movement does not generate artificial profit/loss.

### Costing

Weighted Average Cost is the approved costing method. It powers inventory valuation, recipe cost, COGS, and waste/adjustment cost reporting.

Batch/lot tracking, expiry-per-batch tracking, warehouse bin locations, barcode warehouse picking, and automated supplier replenishment are excluded.

---

## 11. Suppliers and Purchasing

Supplier identity is business-level; purchasing and receiving are shop-specific.

Supplier profiles contain practical contact information, supplied items, notes, and active/archive state.

Purchase order lifecycle:

```text
DRAFT
→ ORDERED
→ PARTIALLY_RECEIVED
→ RECEIVED
```

or `CANCELLED`.

Receiving is distinct from ordering. A receipt updates inventory only for quantities actually received, updates weighted average cost, updates purchase-order status, and creates audit records in one transaction.

Purchasing supports:

- partial receiving;
- unit cost;
- last purchase price;
- cost history;
- supplier invoice/reference/attachment;
- simple supplier payment status;
- purchase returns.

Supplier payment state may be Unpaid, Partially Paid, or Paid with basic amount/date/method/reference tracking. TUX does not become a full accounts-payable or accounting platform.

---

## 12. Orders

Admin is a supervisory/control interface over canonical POS and ONLINE orders.

Admin may:

- view/search/filter all authorized orders;
- inspect items/modifiers/discounts/payments/customer/delivery/inventory effects/history;
- cancel ACTIVE orders with permission and reason;
- initiate controlled refund/return workflows;
- inspect audit history.

Search/filter dimensions include shop, date, worker, customer, status, source, payment method, and order number.

Order status remains compatible with the current canonical model:

```text
ACTIVE
DONE
CANCELLED
RETURNED
```

Completed, cancelled, and returned business history is immutable. Admin does not directly edit a completed order.

Cancelling an ACTIVE order releases its inventory reservation. A refund/return creates a new financial/business event rather than rewriting the original payment or order history.

---

## 13. Customers, Canonical Identity, Loyalty, and Promotions

### Canonical customer identity

The existing shop-scoped `customer_contacts` model must be extended with a business-level customer identity layer without breaking existing order references.

Normalized Egyptian phone number is the primary identity key. Equivalent forms such as `010...`, `+20...`, `0020...`, and `20...` must canonicalize consistently.

Same phone means same customer. Same name alone does not.

Customer profile supports:

- name;
- canonical phone;
- multiple addresses;
- order history across shops;
- total spend;
- order count;
- average order value;
- last order;
- notes/tags;
- loyalty balance/history;
- branch activity.

Changing the canonical phone is sensitive and must check for an existing identity.

### Duplicate merge

Duplicate merge is a confirmed, audited operation. It combines orders, addresses, loyalty, and identity links safely without deleting historical order snapshots.

### Loyalty

Loyalty supports:

- configurable earn rules;
- redemption rules;
- minimum redemption;
- optional expiry;
- shop applicability;
- manual adjustments with reason and audit.

### Promotions

Promotion types:

- percentage discount;
- fixed discount;
- free product.

Promotion rules may include code, start/end, minimum order, total usage limit, per-customer limit, selected/all shops, POS/ONLINE/BOTH, and selected products/categories.

The UI must show a plain-English summary of the resulting rule.

Default stacking behavior: only one order-level promotion applies to an order. Product-specific pricing/discount rules may remain independent where explicitly modeled.

Server validation prevents expired use, usage-limit violations, invalid shop/channel use, and negative totals.

A complex CRM sales pipeline is excluded.

---

## 14. Staff, Shifts, Attendance, and Wage Estimates

### Employee identity

One business-level employee identity represents one person even when assigned to multiple shops.

Employee data includes:

- name;
- personal PIN;
- role;
- custom permissions;
- assigned shops;
- phone;
- active/suspended/archived state;
- hire date;
- pay type/rate;
- notes.

The design must reconcile this business identity with existing Operations worker/session authority rather than create unrelated duplicate people.

### Scheduling

Shift scheduling supports employee, shop, day/date, start/end, breaks, and repeated weekly planning. `Copy Previous Week` is included because it materially reduces repeated manager work.

Each shift is explicitly shop-specific.

### Attendance

Attendance states may represent Clocked In, On Break, and Clocked Out. Admin may derive lateness, possible absence, early departure, and overtime from scheduled-vs-actual timing.

Manual corrections preserve original values and create audited corrective history rather than rewriting the evidence.

### Leave

Simple leave types include Vacation, Sick, Unpaid, and Other with Approve/Reject behavior.

### Wage estimates

Supported pay styles:

- hourly;
- monthly.

Admin may calculate worked hours, overtime, expected wage, and configured attendance adjustments. This remains operational wage estimation, not statutory payroll/tax processing.

No arbitrary employee score/ranking is included. Factual performance metrics such as orders handled, sales handled, cancellations/refunds initiated, AOV, attendance, and late shifts may be shown where permitted.

Recruitment, CV management, LMS/training, formal performance-review workflows, tax payroll filing, bank salary transfer, and biometric hardware integration are excluded.

---

## 15. Delivery, Opening Hours, Checkout, and Payment Methods

### Delivery zones

Each shop may define delivery zones with:

- name;
- supported geography/boundary;
- fee;
- minimum order;
- estimated delivery time;
- enabled state;
- service hours;
- assigned shop.

Address → zone → shop routing is authoritative. If overlapping shops exist, priority/fallback behavior must be explicitly configured rather than silently rerouting orders.

### Online operational controls

Admins with permission may immediately control:

- online ordering on/off;
- delivery on/off;
- pickup on/off;
- temporary pause;
- temporary shop closure.

### Hours

Weekly opening hours and delivery hours are shop-specific. Special-date hours override normal schedules. Business interpretation is always `Africa/Cairo`.

### Riders

Simple rider management supports name, phone, shop, active state, assignment, and delivery lifecycle:

```text
UNASSIGNED
→ ASSIGNED
→ OUT_FOR_DELIVERY
→ DELIVERED
```

with `FAILED` and `RETURNED` exception states.

Live rider GPS tracking is excluded.

### Payment methods

Payment methods are fully editable per shop and may be enabled for POS, ONLINE, or BOTH. Configuration includes display name, sort order, reference requirement, manual confirmation behavior, and whether refund is supported.

A small stable technical classification should exist underneath custom display names, such as Cash, Card, Digital, and Other.

Historical settled payment snapshots are immutable. Renaming or changing a payment method affects future behavior only.

### Checkout rules

Per-shop checkout configuration may include:

- minimum order;
- service charge;
- tax/VAT configuration;
- delivery fee behavior;
- available payment methods;
- discount compatibility;
- payment restrictions by shop/zone;
- online-order availability.

The trusted server revalidates prices, discounts, minimums, payment method eligibility, delivery zone, service charge, and tax. Browser-provided totals are never final authority.

---

## 16. Finance, Expenses, COGS, and Cash Reconciliation

Operations continues to own live payment and business-day execution. Admin supervises and reports.

### Profit model

Admin calculates:

```text
Gross Sales
- Discounts
- Refunds / Returns
= Net Sales

Net Sales
- COGS
= Gross Profit

Gross Profit
- Operating Expenses
= Estimated Operating Profit
```

The UI must call the final number `Estimated Operating Profit`, not accounting net profit.

### COGS

COGS derives from completed-order recipe consumption and the historical weighted-average cost basis used at that point in time. Future supplier-price changes must not rewrite historical order profitability.

### Expenses

Expense management captures:

- amount;
- date;
- shop;
- category;
- note/description;
- optional receipt attachment;
- one-time or recurring behavior.

Default practical categories may include Rent, Salaries/Wages, Utilities, Marketing, Maintenance, Supplies, Delivery, Fees, and Other. Custom categories are allowed.

Recurring expense rules may create expected recurring expense occurrences for fixed costs such as rent, internet, cleaning, or subscriptions.

Purchasing is not immediately counted as full COGS: purchased inventory first affects stock valuation and becomes COGS when consumed.

### Cash reconciliation

At business-day close, Admin compares expected cash with actual counted cash and records the variance, reason, actor, shop, and timestamp.

Expected cash is never silently edited to match the physical count. Corrections create adjustment events.

### Financial adjustments

Historical finance records are immutable. Legitimate correction creates a new adjustment with reason, permission checks, possible approval, and audit.

### Supplier payment state

Basic payment state for purchase orders is supported without building full accounting.

Excluded finance scope includes double-entry accounting, tax filing, VAT return submission, bank-feed reconciliation, balance sheet, depreciation, accounting-year close, and statutory payroll.

---

## 17. Shops, Business Settings, Devices, and Shop Health

### Business defaults

Business-level settings may include:

- business name;
- logo/branding;
- EGP default currency;
- `Africa/Cairo` timezone;
- global catalog defaults;
- payment defaults;
- checkout defaults;
- role presets;
- inventory defaults;
- business contact information.

### Shop settings

A shop includes:

- name;
- address;
- phone;
- canonical coordinates where useful;
- status;
- opening/delivery hours;
- order types;
- payment methods;
- delivery zones;
- tax/service-charge rules;
- online ordering;
- catalog overrides;
- inventory rules;
- staff assignment;
- devices;
- receipt/customer-facing information.

New shop setup may copy suitable configuration from an existing shop, but never copies operational history such as orders, inventory quantities, business days, cash records, attendance, or expenses.

Shop lifecycle:

```text
ACTIVE
→ SUSPENDED
→ ARCHIVED
```

No hard delete after business history exists.

### Devices

Admin manages existing Operations device authority with practical data such as:

- label;
- assigned shop;
- active/disabled state;
- last seen;
- configuration version;
- application/build version;
- online/offline status.

Permitted actions include configuration refresh, rename, shop reassignment, disable/revoke, and enrollment workflow where supported. Dangerous remote-control actions such as remote cash drawer operation are excluded.

### Printers

Admin may configure required receipt/kitchen printers, enable/disable them, assign them to shop/device, configure supported routing, and trigger test print where Operations supports the contract.

### Shop Health

Shop Health gives an actionable summary of:

- Operations device status;
- current business-day status;
- online-order health;
- current config version;
- low-stock state;
- unresolved cash variance;
- active worker context where useful;
- WhatsApp status if configured.

Technical error codes are translated into plain-English actions.

---

## 18. Audit, Sensitive Approval, and Activity History

Important business mutations generate immutable audit events.

Audit includes:

- actor;
- role;
- shop;
- action;
- entity;
- old value;
- new value;
- reason where required;
- timestamp;
- session/device context;
- approval state.

Do not log low-value noise such as merely opening a page.

### Approval flow

Approved simple flow:

```text
user requests sensitive action
→ server determines approval requirement
→ authorized approver receives request
→ approver sees action/value/reason/shop/requester
→ Approve or Reject
→ approver confirms PIN
→ action executes once if approved
→ audit event written
```

Configurable threshold examples include large refunds and high-value stock adjustments. Permission changes, PIN reset, shop archive, important financial adjustments, and similarly sensitive configuration may always require elevated authority.

Approval execution must be idempotent. Rejection never executes the original action. Approved actions execute once.

Audit events are immutable. Correcting a mistake creates a new corrective event.

---

## 19. Drafting, Versioning, Scheduling, and Historical Immutability

TUX uses a hybrid configuration model.

### Immediate operational actions

Examples:

- Sold Out / Available;
- pause Online Orders;
- stock adjustment;
- employee suspension;
- delivery pause;
- urgent operational shop controls.

### Draft → Preview → Publish

Used for configuration with broader consequences:

- product identity/content;
- prices;
- categories;
- modifiers/extras;
- combos;
- images;
- menu structure;
- recipes;
- checkout configuration;
- other publishable business rules.

Publish is atomic and produces a consistent version consumed by Menu and Operations.

### Versioning

Important business rules retain versioned history. Historical orders retain the actual values used at the time of execution, including price, modifiers, recipe/cost basis, delivery fees, tax/service charge, discount values, payment display values, and promotion effects where applicable.

### Scheduled changes

Only appropriate configuration is schedulable. Refunds, stock adjustments, permission changes, and financial corrections are not scheduled mutations.

### Concurrency

All important editable records carry a version/revision fence. A stale client cannot silently overwrite a newer server value. Conflicts are shown in plain English and require reload/review or safe field-level resolution.

---

## 20. PWA, Sessions, Connectivity, and Reliability

### PWA

Admin is an installable mobile-first Progressive Web App with app icon, standalone shell, safe shell caching, update notification, and optional push notifications for important alerts.

There is one web application, not separate native iOS/Android applications.

### Sessions

Normal use requires PIN login once per valid session. Sensitive actions may require re-PIN. Session expiry returns the user to PIN entry and should preserve safe navigation context where practical.

### Offline behavior

Admin writes are online-only.

When offline, the app may continue showing safe cached/current information with a clear `Offline` or `May be outdated` indication. Mutating actions such as Save, Publish, Refund, stock adjustment, permissions change, receiving, or approval execution are disabled.

No offline queue exists for financial, inventory, permission, or publishing mutations.

### Idempotency

Critical server commands are idempotent so duplicate taps/retries cannot create duplicate refunds, receives, publishes, adjustments, or equivalent side effects.

### Atomicity

Multi-write business actions execute transactionally. Examples include receiving, stocktake, transfer, publish, customer merge, refund, approval execution, and permission changes. Either the complete valid change commits or nothing commits.

### Error handling

User-facing errors are plain English and state whether anything changed and what the user can do next. Technical diagnostics remain in server logs/monitoring.

### Background refresh

While Admin is open, important data such as orders, alerts, shop health, inventory availability, and approvals may refresh efficiently without reloading the whole application.

---

## 21. Apple-HIG-Informed Design System

Apple Human Interface Guidelines are the design authority, adapted to TUX branding and web platform constraints. The Admin must not become a literal macOS/iOS clone.

### Mobile-first principles

- phone is the primary design target;
- one obvious primary action per screen;
- large, comfortable touch targets following the approximately 44-point interaction principle;
- lists/cards rather than dense tables;
- full-screen detail/edit flows;
- bottom sheets for quick actions;
- bottom action areas for important form actions;
- progressive disclosure;
- minimal typing;
- smart defaults;
- inline validation;
- role-based simplification;
- search-first management experiences;
- clear current-shop context;
- useful empty/loading/error states;
- no critical feature available only through an undiscoverable gesture.

### Adaptive layouts

Phone uses bottom navigation, lists/cards, full-screen detail and quick sheets. Tablet uses adaptive sidebar and optional split views. Desktop adds tables, right inspectors, bulk actions, and keyboard productivity.

### Visual system

TUX branding remains identifiable but restrained. Semantic color is reserved for success/warning/critical/information and is never the only status signal.

Subtle material/glass effects may be used for navigation, toolbars, popovers, sheets, and control layers. Core content such as forms, financial data, tables, and inventory details remains clean and highly readable.

Light and dark modes are supported with System, Light, and Dark preferences.

### Language

UI language is plain English. Internal enum/database terminology is not shown to normal admins.

### Confirmation and undo

Routine actions do not receive repetitive confirmation dialogs. Confirmation is reserved for consequential actions such as refund, archive, large adjustment, permission change, publish, and customer merge.

Safe reversible actions may expose Undo. Financial and inventory transactions use corrective events rather than casual Undo.

---

## 22. Search and Management Interaction Pattern

Search is first-class for products, orders, customers, staff, inventory, and suppliers.

Consistent responsive management pattern:

```text
Phone   → list → full-screen detail
Tablet  → list/detail split where useful
Desktop → table/list → right inspector/detail
```

Navigation state should preserve useful context such as current filters, search, and scroll position when returning from detail screens.

Current shop must always be visible on operational screens and repeated inside sensitive action flows.

---

## 23. Data Model Strategy

Exact table names are implementation details, but the following domain boundaries are required.

Likely new/extended areas include:

```text
business employee identity
admin sessions / Admin PIN auth
role presets + permissions + shop assignment
master catalog identity / shop projections
catalog drafts / published versions
inventory ledger / reservations
stocktakes / stocktake lines
stock transfers
suppliers
purchase orders / lines / receiving
business-level customer identity
loyalty accounts / loyalty movements
promotions
expense categories / recurring expense rules
approval requests
audit events
scheduled changes
reporting projections
```

Existing canonical entities are reused where they are already correct. Do not create `admin_products`, `admin_orders`, or similarly duplicated canonical business tables merely because the Admin needs an interface.

### Multi-shop integrity

Every shop-scoped record must be protected against accidental cross-shop references through server validation and database constraints where practical.

Example: a Nasr City order cannot reference a New Cairo delivery zone. A branch transfer explicitly identifies both source and destination shops as part of its own domain model.

### Timestamps

Database timestamps remain absolute (`timestamptz`-equivalent semantics). User-facing business interpretation, business days, schedules, promotions, shifts, and special hours use `Africa/Cairo` rather than hardcoded UTC offsets.

### Reporting

Large reports use indexed queries, server-side aggregation, views, or reporting projections/materialization where justified. Optimization must not create a second source of transactional truth.

---

## 24. Trusted Server Modules

Admin browser mutations flow through trusted domain commands/APIs rather than arbitrary direct table writes.

Recommended server/domain boundaries:

```text
Admin Auth
Catalog
Orders
Inventory
Purchasing
Customers
Loyalty / Promotions
Staff
Delivery / Checkout
Finance
Reporting
Approvals
Audit
Shop Configuration
Operations Devices
Scheduling
```

These modules may share infrastructure and deployment, but each owns a coherent business responsibility.

Shared types/contracts used across Menu, Operations, and Admin belong in `packages/*` rather than being independently duplicated in each app.

---

## 25. Critical Server Validation Pattern

For every sensitive command, the server determines:

```text
Who is requesting?
Which business/shop is in scope?
Does the actor have permission?
Is the current record version still valid?
Is approval required?
Are business invariants satisfied?
Has the idempotency key already executed?
What audit entry must be created?
```

Only after those checks does the server commit the complete transaction.

The browser may display a proposed total, stock amount, role, price, or availability state, but the server remains the final authority.

---

## 26. Testing Strategy

Admin acceptance is based on business correctness, not only visual completion.

### Command tests

Trusted Admin commands need coverage for:

- authorized actor;
- unauthorized actor;
- wrong shop;
- missing permission;
- stale version;
- duplicate/idempotent request;
- invalid input;
- approval-required path;
- successful transaction;
- transaction rollback/failure.

### High-risk end-to-end flows

Strong integration/E2E coverage is required for:

- PIN login;
- role and permission enforcement;
- shop isolation;
- catalog draft/preview/publish;
- scheduled publish;
- Menu/Operations receiving the same published version;
- stock reservation/consumption/release;
- receiving;
- stock transfer;
- stocktake;
- customer merge;
- refund;
- cash reconciliation;
- employee suspension/PIN/permission changes;
- approval execution;
- shop archive.

### Regression protection

Changes to shared contracts/configuration must continue to run relevant Menu, Operations, Online Order, shared contract, and Admin tests.

A critical cross-app acceptance flow is:

```text
Admin publishes price/configuration
→ Menu observes the new valid version
→ Operations observes the same valid version
→ online-order validation uses the same authority
```

---

## 27. Mobile and Accessibility Acceptance

Production acceptance must include real mobile browser/device testing where practical, particularly iPhone/Safari and Android/Chrome.

Critical mobile acceptance flows include PIN login, shop switching, dashboard, product edit, Sold Out, price change, inventory adjustment, receiving, purchase order, refund approval, expense entry, staff edit, reports, PWA install/use, and push notification behavior.

Accessibility checks include readable contrast in light/dark mode, large touch targets, keyboard navigation on desktop, visible focus, accessible labels, status not represented by color alone, and usable browser text scaling.

A technically functional but confusing flow is not accepted.

---

## 28. Migration Strategy

Admin migrations must preserve real production data and historical references.

The implementation should use domain-oriented migrations rather than one giant migration. Areas should be sequenced so dependencies are explicit, for example:

```text
Admin auth / permissions
business-level identities
catalog master + drafts/versioning
inventory ledger/reservations
purchasing
customers/loyalty/promotions
staff scheduling/attendance
checkout/delivery extensions
finance/expenses
approvals/audit
scheduling/reporting projections
```

Each migration must be tested both on a clean database and as an upgrade from the existing TUX schema.

Existing production products, orders, customers, workers, inventory foundation, and related identities must be adopted/reconciled. No destructive recreation of working catalog or order history is acceptable.

---

## 29. Production Rollout and Acceptance

Recommended controlled rollout:

```text
1. Deploy backend contracts and migrations
2. Verify existing Menu + Operations remain healthy
3. Deploy apps/admin to its separate Vercel project
4. Create the first OWNER PIN/account
5. Verify role/shop access and isolation
6. Run read-only production checks
7. Test a safe catalog draft + atomic publish
8. Test an inventory workflow
9. Test an expense
10. Test a staff/permission workflow
11. Test an approval workflow
12. Verify multi-shop isolation
13. Complete real mobile/PWA acceptance
14. Run final engineering review
```

Production acceptance cannot be replaced by mocks alone. Real deployment must prove Vercel configuration, Supabase migrations, data preservation, PWA/mobile behavior, and actual Menu/Operations consumption of Admin-published configuration.

---

## 30. Explicitly Excluded Scope

The following are intentionally not part of this Admin design:

- import functionality;
- export functionality;
- full accounting / general ledger / double-entry bookkeeping;
- tax filing or VAT return submission;
- bank-feed reconciliation;
- statutory payroll/tax processing;
- recruitment/applicant tracking;
- employee CV management;
- LMS/training workflows;
- formal corporate performance-review workflows;
- biometric staff hardware integration;
- live rider GPS tracking;
- batch/lot tracking;
- per-batch expiry tracking;
- warehouse bin management;
- barcode warehouse picking;
- complex procurement approval chains;
- supplier portal;
- automated supplier ordering;
- complex multi-level corporate approval workflow;
- dangerous remote POS/device control such as opening a cash drawer;
- offline queued financial/inventory/configuration mutations;
- separate native iOS and Android Admin apps;
- actual Meta/WhatsApp production setup as an Admin completion blocker.

---

## 31. Completion Criteria

TUX Admin is complete only when the approved business scope is implemented and production-verified.

### Architecture

- one canonical Supabase remains the business truth;
- no duplicate Admin-specific canonical order/product/payment system exists;
- multi-shop isolation is proven;
- Menu and Operations contracts remain compatible.

### Security

- PIN-only Admin authentication works;
- PIN hashes and sessions are server-controlled;
- role/custom permission enforcement is server-side;
- shop boundaries are enforced;
- sensitive re-PIN/approval paths work;
- privileged secrets remain server-only.

### Business capabilities

- dashboard/reports/alerts;
- catalog/pricing/publishing;
- inventory/recipes/stocktake/transfers;
- suppliers/purchasing/receiving;
- orders/refund controls;
- customers/loyalty/promotions;
- staff/shifts/attendance/wage estimates;
- delivery/checkout/payment configuration;
- finance/expenses/reconciliation;
- shops/settings/devices/shop health;
- approvals/audit/version history.

### Integration

- Admin publication reaches Menu and Operations consistently;
- online ordering remains valid;
- order inventory lifecycle is correct;
- historical snapshots remain immutable.

### UX

- mobile-first flows pass real-device acceptance;
- tablet and desktop layouts adapt correctly;
- Apple-HIG-informed design is consistent;
- critical workflows are understandable without specialist training.

### Reliability

- concurrency protection works;
- critical commands are idempotent;
- complex writes are atomic;
- production failures are observable;
- failed actions never masquerade as successful changes.

### Production

- Admin Vercel project is production-ready;
- migrations are verified against the canonical Supabase;
- production smoke tests pass;
- no unresolved serious engineering-review finding remains.

---

## 32. Implementation Planning Gate

This design document is the approved product/architecture basis for `apps/admin`.

No implementation should start from this document until the user reviews the written specification and explicitly approves it. After that approval, the next step is to create the implementation plan using the Superpowers writing-plans workflow, then execute through the normal branch/TDD/review/CI process.
