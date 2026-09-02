# TUX Customer Web Order Bridge — Binding Design

Date: 2026-09-02
Status: Approved product design; implementation not started
Repository: `ahmedmohameda7222-ship-it/TUXCASHEIRNEW`
Base design SHA: `73a81ace5813fbaca2d1fc83b7dc906fcbe73ccb`
Related legacy storefront repo: `ahmedmohameda7222-ship-it/TUX-MENU`

## 1. Purpose

This design turns TUX-MENU from a standalone cart-to-WhatsApp message generator into a structured online-ordering storefront integrated with TUX Admin configuration, TUX WhatsApp, and TUX Operations.

The customer may still experience the order as a familiar WhatsApp-based flow, but TUX shall preserve structured cart/order-request data end to end instead of attempting to reconstruct an order from WhatsApp text.

The core authority model is:

- **TUX Admin** controls canonical menu and online-ordering configuration.
- **TUX-MENU** is the customer-facing storefront and creates structured web order requests.
- **WhatsApp** is the customer communication and confirmation channel.
- **TUX Operations** is the authority that reviews a request and converts it into an official order.

## 2. Existing behavior being replaced

The current TUX-MENU cart already has structured product/cart information and then formats that data into a prepared WhatsApp message that opens via `wa.me`.

The long-term integration shall preserve the good customer experience but change the authority path:

**Old model**

`Structured cart in browser -> format text -> WhatsApp -> store manually recreates order`

**Approved model**

`Structured cart -> TUX backend web-order request -> stable WEB reference -> WhatsApp handoff -> worker Review/Accept -> normal official Operations order`

WhatsApp text must never become the only durable representation of a website request.

## 3. Canonical configuration source

TUX-MENU must not own an independent long-term menu database or duplicated price/availability model.

The canonical store configuration shall be managed from TUX Admin and published through the shared TUX backend/configuration model used by Operations.

The shared configuration family includes, as applicable:

- menu categories;
- products;
- product descriptions/images;
- product prices;
- active/sold-out state;
- modifiers and allowed modifier relationships;
- combo configuration;
- order types;
- payment-method choices exposed to the customer;
- delivery zones;
- configured delivery fees;
- online-ordering availability controls.

A configuration update by Admin must flow to both Operations and the storefront from the same authoritative source rather than requiring independent manual edits.

## 4. Online-ordering controls in Admin

TUX Admin shall own at least these storefront controls:

- Online Ordering: enabled/disabled;
- Pickup: enabled/disabled;
- Delivery: enabled/disabled;
- normal online-ordering opening hours;
- temporary pause state;
- delivery-zone availability;
- delivery-zone configured fee;
- optional minimum delivery order per zone.

When a channel is disabled, TUX-MENU shall communicate that state before the customer submits a request. A disabled delivery channel must not merely fail after checkout.

The storefront may remain browsable while ordering is paused unless Admin explicitly disables browsing separately in a future feature.

## 5. Customer checkout model

TUX-MENU checkout shall collect enough structured information to create an order request without relying on free-text WhatsApp parsing.

The structured request may contain:

- selected products and stable product identifiers;
- quantities;
- modifiers/extras and stable modifier identifiers;
- combo selections where applicable;
- item notes;
- order-level note;
- customer display name;
- order type: Pickup or Delivery;
- delivery-area/zone choice when known;
- delivery address for Delivery;
- payment preference;
- customer-visible subtotal;
- customer-visible configured delivery fee when determinable;
- customer-visible estimated total when determinable;
- configuration/version information needed for later change detection.

The website must never claim that submission alone creates an official Operations order.

## 6. Customer messaging and request status language

Before Operations accepts the request, customer-facing copy must describe it as a request awaiting restaurant confirmation.

The website must not show `Order confirmed` immediately after preparing or sending the WhatsApp handoff.

Approved intent:

`طلبك جاهز للإرسال على واتساب. الطلب بيتأكد بعد مراجعة المطعم.`

Only after worker Review/Accept may TUX communicate that an official order was confirmed.

## 7. Web order request identity

Every structured checkout submission shall receive a stable, opaque public reference such as `WEB-A73K9`.

The reference is a correlation identifier, not an official Operations order number.

It shall be included in the prepared WhatsApp message so an inbound WhatsApp event can correlate the sender/conversation with the already-stored structured request.

The reference must be non-secret and safe to display to the customer, but possession of the reference alone must not authorize reading or mutating request details.

## 8. Request lifecycle

A website request shall have an explicit lifecycle separate from the official Order lifecycle.

The approved lifecycle is:

- `AWAITING_WHATSAPP` — structured request exists but no matching customer WhatsApp message has been observed yet;
- `RECEIVED` — the matching WhatsApp message/customer conversation has been correlated;
- `UNDER_REVIEW` — a worker has opened the review flow;
- `ACCEPTED` — converted exactly once into an official Operations order;
- `REJECTED` — worker explicitly declined/could not fulfill the request;
- `EXPIRED` — request aged out without acceptance according to the configured retention/expiry policy.

`ACCEPTED`, `REJECTED`, and `EXPIRED` are terminal for the web request.

The exact expiry duration is an operational configuration decision for implementation planning; the product invariant is that stale unaccepted requests cannot remain actionable forever.

## 9. WhatsApp handoff

After the structured request is created, the website opens the customer's WhatsApp experience with a prepared, human-readable summary that includes the stable WEB reference.

The customer remains responsible for pressing Send.

The message is a communication artifact, not the structured order authority.

If the customer never sends the WhatsApp message, the request remains `AWAITING_WHATSAPP` until it expires and must not appear as an official order.

If the customer already has a direct WhatsApp conversation with the store, the matching website request shall attach to that conversation when the sender identity and WEB reference correlate.

## 10. Review/Accept is mandatory

A structured website request must never enter Orders Board or become an official order automatically on receipt.

The worker must explicitly open `Review Order` and approve it.

Review creates or populates a normal TUX Order Draft through domain/application services rather than bypassing them.

On acceptance, the request is converted into exactly one official order and then follows the standard TUX path:

`Order Draft -> Place Order -> local transaction -> receipt/printing -> Orders Board -> stock/business effects -> outbox -> cloud sync`

No second website-specific official order engine shall exist.

## 11. Review-time revalidation

Review must revalidate the request against current canonical configuration before acceptance.

At minimum revalidation covers:

- product still exists and is active;
- product is not sold out;
- requested modifiers remain allowed and active;
- combo selections remain valid;
- current prices;
- order type remains enabled;
- delivery zone remains enabled where applicable;
- delivery minimum remains satisfied or is explicitly handled by worker policy;
- payment preference remains available/valid for the chosen order type;
- configured delivery fee is current.

The customer's earlier request values must remain visible for comparison when they differ from current values.

## 12. Price/configuration change warning

If any material customer-visible value changed between request creation and worker review, the worker must see the difference before acceptance.

Example:

- customer saw product price: 180 EGP;
- current price at review: 190 EGP;
- review UI shows a clear price-change warning and both values.

The change must never be applied silently.

Acceptance uses current validated official values unless a separately approved domain rule permits a controlled override.

The original customer-visible values remain part of the request audit snapshot.

## 13. Delivery architecture

### 13.1 Delivery zones

Admin controls structured delivery zones.

Each zone may have:

- stable zone ID;
- display name;
- enabled/disabled state;
- configured delivery fee;
- optional minimum delivery order.

TUX-MENU shall offer known enabled zones as customer choices.

### 13.2 Known zone

When the customer selects a known zone:

- TUX-MENU displays the configured delivery fee;
- the estimated total includes that fee;
- the request stores zone ID and the configured/customer-visible fee snapshot;
- Operations revalidates the zone and fee during Review.

### 13.3 Unknown/manual area

The storefront must provide an `Other / fee to be confirmed` path rather than forcing a false zone match.

For this path:

- the address is captured;
- delivery fee remains pending;
- final total remains pending confirmation;
- Operations chooses/confirms the appropriate zone or manual final fee during Review.

The website must never guess a delivery fee.

### 13.4 Delivery fee override

The worker is allowed to override the configured fee during Review.

TUX must retain both values:

- `configuredFee` — current configured zone fee at review;
- `finalFee` — fee accepted into the official order.

When the two differ, TUX records an auditable override with current worker, device, time, request/order identity, old configured fee, and final fee.

The review UI may offer an optional short reason. The reason is not mandatory because worker speed takes priority, but if entered it becomes part of the audit record.

### 13.5 Future geographic pricing

GPS/geofence/polygon-based automatic zone detection is intentionally deferred. The v1 data model shall not prevent it, but v1 uses explicit configured zone choice plus manual fallback.

## 14. Delivery minimum

Admin may configure a minimum delivery subtotal per zone.

When a known zone has a minimum, TUX-MENU shall show the requirement before submission and prevent a normal website Delivery request that does not satisfy it.

Example:

`Minimum delivery order for Nasr City is 200 EGP. Add 50 EGP more.`

The minimum applies to the qualifying merchandise subtotal according to the implementation plan's money rules; delivery fee itself must not be used to fake satisfaction of the minimum.

Manual/exception handling, if ever needed, belongs to a later explicit product rule and must not be silently inferred in v1.

## 15. Payment semantics

TUX-MENU payment selection is a **payment preference** until Operations accepts the request and establishes the official financial state.

This distinction is mandatory for Delivery when the final delivery fee may still change.

If final total is not known yet, the website must not represent a partial figure as the final amount due.

Example:

- food subtotal: 350 EGP;
- delivery: pending;
- final total: pending confirmation;
- payment preference: InstaPay.

After Review establishes final delivery fee and official total, the worker can send an approved deterministic payment-related quick reply through the WhatsApp inbox.

A screenshot/proof of payment sent through WhatsApp does not automatically confirm payment.

## 16. Customer identity

The provider-observed WhatsApp sender phone, normalized through the shared Egyptian phone-normalization domain, is the primary communication identity used to correlate the conversation with customer contacts.

The display name typed on TUX-MENU is not a secure identity proof and must not override a conflicting established customer identity by itself.

The website does not need to force the customer to type the same phone number twice when the WhatsApp channel can establish the sender during correlation.

## 17. Structured notes

TUX-MENU shall support structured item notes and an order-level note.

Examples:

- item note: `من غير بصل`;
- order note: `ياريت الاتصال قبل الوصول`.

These values flow into the normal Order Draft fields during Review. They must not depend on extracting text from the prepared WhatsApp message.

## 18. Rejection flow

The worker may reject a request when it cannot be fulfilled.

Rejection terminates the web request without creating an official order.

The WhatsApp conversation remains usable, and the worker may insert a deterministic Egyptian Arabic saved reply explaining that an item/request cannot currently be fulfilled and may offer the menu for a replacement request.

Rejection itself must not automatically send a customer message; Send remains an explicit worker action.

## 19. Post-acceptance rules

After `ACCEPTED`:

- an official Order ID exists;
- the web request remains immutable historical/audit context;
- subsequent order modifications occur only through the normal Operations order/business rules;
- the website request is not edited to mutate the official order;
- the WhatsApp conversation may show the linked official Order and its read-only operational context.

The web reference and official order number must remain distinct identifiers.

## 20. Customer confirmation after acceptance

After successful Review/Accept, TUX shall make a deterministic Egyptian Arabic confirmation reply available to the current worker, for example:

`تمام، تم تأكيد أوردر حضرتك رقم #143.`

Where appropriate, the quick reply may include the final total and delivery fee established by the accepted order.

The worker explicitly presses Send. Acceptance alone does not automatically send the message in v1.

## 21. Idempotency and exactly-once conversion

The bridge must protect against duplicate browser submissions, duplicate inbound WhatsApp/provider events, retries, page refreshes, and repeated worker actions.

A given web request can create at most one official Operations order.

The conversion requires a stable idempotency key that survives retry/restart and is enforced below the UI layer.

If an acceptance attempt succeeds locally but a later acknowledgement fails, retry must recover the same official order rather than create another one.

## 22. Audit and provenance

For every accepted website request, TUX must be able to reconstruct:

- WEB reference;
- originating shop;
- request creation time;
- request configuration/version snapshot;
- original selected products/modifiers/notes;
- customer-visible original prices;
- original configured/customer-visible delivery fee state;
- correlated WhatsApp conversation/sender;
- review start/current worker;
- any revalidation changes;
- any delivery-fee override and optional reason;
- acceptance worker/device/time;
- resulting official Order ID;
- terminal request state.

Official Orders created through this path shall carry a source marker such as `WEBSITE_WHATSAPP` so future Admin reporting can distinguish acquisition/ordering channels without schema redesign.

## 23. Metrics readiness

The system shall persist timestamps and source/provenance data needed for later Admin metrics such as:

- website requests created;
- requests whose WhatsApp handoff was observed;
- accepted requests;
- rejected requests;
- expired requests;
- conversion rate;
- average time to review/accept;
- delivery-fee override frequency;
- website-originated order revenue.

The Admin analytics UI is not part of this implementation scope; only data readiness is required.

## 24. Failure isolation

TUX-MENU/WhatsApp/backend integration failure must never compromise local Operations availability.

If the storefront or WhatsApp channel is unavailable:

- the worker can still create normal in-store/direct Orders;
- Business Day continues;
- local SQLite operations continue;
- printing and Orders Board continue;
- End Day continues according to existing rules.

Web-order requests require online backend availability to be created/correlated. Offline-first behavior for a customer's public website is not a requirement.

## 25. Admin / Operations separation

TUX Admin owns configuration and management.

TUX Operations owns worker Review/Accept and fulfillment.

TUX-MENU owns customer browsing/cart/checkout UX.

No Admin menu-management or delivery-zone-management UI shall be embedded into worker Operations as part of this feature.

## 26. Non-goals

The following are explicitly deferred or excluded:

- AI order parsing;
- chatbot;
- AI replies;
- automatic acceptance of website requests;
- GPS/polygon delivery-fee calculation;
- online card payment gateway;
- customer account/login system;
- coupons/promotions engine;
- loyalty program;
- scheduled/future orders;
- automatic payment confirmation from InstaPay screenshots;
- customer-facing live driver tracking;
- second official order engine specific to the website.

These require separate future design approval.

## 27. Acceptance-level product scenarios

The implementation plan must eventually prove at least these scenarios:

1. Admin disables Delivery; storefront no longer allows a normal Delivery checkout while Pickup can remain available.
2. Admin pauses online ordering; browsing can remain available but request submission is blocked with clear customer state.
3. Customer creates a structured Pickup request; a WEB reference is issued; WhatsApp is prepared; no official order exists yet.
4. Customer creates a known-zone Delivery request; configured delivery fee and estimated total are shown and snapshotted.
5. Customer selects manual/Other area; delivery fee and final total are shown as pending confirmation, not guessed.
6. Customer never sends WhatsApp; request stays non-official and later expires.
7. Matching WhatsApp message moves request from `AWAITING_WHATSAPP` to `RECEIVED` and attaches it to the correct conversation.
8. Worker opens Review; request becomes `UNDER_REVIEW` without creating an official order.
9. Product becomes sold out after request creation; Review blocks silent acceptance and surfaces the change.
10. Product price changes after request creation; Review shows old customer-visible price versus current price.
11. Known delivery fee changes after request creation; Review revalidates and shows the current configured fee.
12. Worker overrides configured delivery fee; both configured and final fee plus worker audit are retained.
13. Worker accepts; exactly one official normal Operations order is created and request becomes `ACCEPTED`.
14. Repeated Accept/retry cannot create a second official order.
15. Accepted order enters the existing local persistence, printing, Orders Board, Business Day, and sync pipeline.
16. Worker rejects a request; no official order is created and conversation remains usable.
17. Direct WhatsApp customer later uses TUX-MENU; website request attaches to the existing conversation instead of creating a duplicate conversation.
18. Item notes and order notes move into the normal Order Draft without parsing WhatsApp text.
19. Payment preference remains non-authoritative until the official order establishes the final total/payment state.
20. Failure of the website/WhatsApp integration does not prevent normal local Operations workflows.

## 28. Companion specification

The native worker messaging experience, direct WhatsApp customer flow, media, Egyptian quick replies, customer/order context, current-worker message attribution, and WhatsApp failure behavior are defined in:

`docs/superpowers/specs/2026-09-02-tux-operations-whatsapp-inbox-design.md`

The shared binding invariant is:

**TUX-MENU creates structured order requests; WhatsApp communicates them; the worker must Review/Accept; only Operations creates the official order.**
