# TUX Operations WhatsApp Inbox — Binding Design

Date: 2026-09-02
Status: Approved product design; implementation not started
Repository: `ahmedmohameda7222-ship-it/TUXCASHEIRNEW`
Base design SHA: `73a81ace5813fbaca2d1fc83b7dc906fcbe73ccb`

## 1. Purpose

TUX Operations shall provide a native business WhatsApp inbox inside the Operations application so the signed-in worker can receive, read, and reply to store WhatsApp conversations without leaving TUX. The feature is a first-class Operations subsystem, not an embedded WhatsApp Web page and not a launcher for the external WhatsApp Desktop application.

The design targets the current store topology: one Operations laptop per store, multiple workers over the course of a Business Day, and exactly one current signed-in worker at a time on that laptop.

## 2. Product position

TUX Operations is the worker-facing operating system. WhatsApp is one operational channel inside it.

The worker navigation may expose a `WhatsApp` destination alongside the approved Operations destinations. The feature must not introduce TUX Admin into Operations.

The worker shall be able to remain inside TUX for the normal shift workflow:

- create and manage Orders;
- manage Orders Board;
- handle customer WhatsApp conversations;
- record Expenses;
- manage Bulk Stock;
- End Day.

## 3. Explicit decisions

The following decisions are binding:

- Use the official WhatsApp Business Platform / Cloud API integration model through a TUX-controlled backend gateway.
- Do not embed `web.whatsapp.com` in the Operations Electron renderer.
- Do not depend on the external WhatsApp Desktop application for the worker workflow.
- Do not expose WhatsApp provider credentials or long-lived access tokens to the Operations laptop.
- All workers assigned to the shop are allowed to use the WhatsApp inbox; there is no per-worker WhatsApp permission model in v1.
- One store laptop is in scope. Multi-laptop worker coordination is out of scope for v1.
- One current worker session at a time is authoritative for outgoing-message attribution.
- No AI, chatbot, AI extraction, AI reply generation, or automatic AI response is in scope.
- Quick replies are deterministic saved text, not generated text.
- Egyptian Arabic is the default quick-reply language.
- Arabic RTL and mixed Arabic/English message direction must render correctly.

## 4. System boundaries

### 4.1 WhatsApp provider boundary

TUX shall communicate with the official WhatsApp business messaging platform through a backend component called the **TUX WhatsApp Gateway**.

Inbound provider events flow into the gateway through provider webhooks. Outbound worker messages flow from Operations to the TUX backend and then to the provider API.

The provider is not a source of truth for TUX order state. TUX Orders remain authoritative for order lifecycle and financial state.

### 4.2 Operations boundary

Operations owns the worker experience for:

- inbox;
- conversation list;
- unread state;
- message composer;
- media handling;
- customer and order context;
- worker attribution;
- links from chat to Orders;
- links from Orders to chat.

Operational order mutations such as place, cancel, return, mark done, payment, or End Day remain in the existing Orders / Orders Board / End Day domain flows. The WhatsApp screen may navigate to those flows but must not duplicate their business logic.

### 4.3 Admin boundary

Future TUX Admin owns management-oriented configuration and reporting, including store WhatsApp onboarding/configuration, saved reply administration, template administration where required, conversation analytics, and historical reporting.

Operations shall not grow an Admin area to manage these concerns.

## 5. Core worker capabilities

The WhatsApp inbox shall support:

- conversation list;
- unread badges and unread filter;
- message history;
- direct incoming and outgoing text messages;
- images;
- documents;
- audio / voice-note media where supported by the provider channel;
- location messages where supported by the provider channel;
- message delivery/read state where supplied by the provider;
- search by customer name, normalized phone, order number, and indexed message text;
- mark unread;
- follow-up / important flag;
- archive while retaining searchable history;
- persistent unsent message drafts;
- explicit retry for failed outbound messages;
- Windows notification and an Operations unread badge for new inbound messages;
- attachment preview appropriate to supported safe media types.

WhatsApp availability must never block Orders, Orders Board, Expenses, Bulk Stock, printing, Business Day, End Day, or local persistence.

## 6. Egyptian worker UX

### 6.1 Quick replies

Default saved replies shall be natural Egyptian Arabic, not formal Arabic. Examples include:

- `أوردر حضرتك بيتجهز دلوقتي.`
- `أوردر حضرتك جاهز.`
- `الأوردر خرج مع الدليفري.`
- `ممكن تأكدلنا العنوان لو سمحت؟`
- `ممكن تبعتلنا اللوكيشن؟`
- `الدليفري في الطريق لحضرتك.`
- `تمام، هنعدل الأوردر لحضرتك.`
- `شكراً لحضرتك.`

Quick replies shall be grouped by operational category, such as preparation, delivery, address, payment, delay/apology, and thanks.

Selecting a quick reply inserts it into the composer. The worker may edit it before pressing Send. Selection alone must never send a message.

The system may order saved replies by deterministic usage frequency; this is not AI.

### 6.2 RTL and mixed direction

Each message bubble must render based on message text direction rather than forcing the entire conversation into one direction. Arabic messages use RTL presentation; English messages use LTR; mixed text must remain legible.

### 6.3 Egyptian phone normalization

Customer identity matching must normalize common Egyptian phone forms so semantically identical numbers map to the same customer identity, including equivalent forms such as local `01...`, international `+20...`, and `0020...` representation.

The exact normalization implementation belongs in the shared customer/phone domain, not in WhatsApp UI components.

## 7. Worker attribution and audit

Every outbound message initiated from Operations must record the current worker identity at send intent time.

At minimum the durable audit record shall make it possible to answer:

- which shop conversation the message belongs to;
- which current worker initiated it;
- which device initiated it;
- when the worker initiated it;
- provider message identifier after acceptance by the provider;
- send/delivery/read/failure status transitions when available.

Worker sign-out and subsequent worker sign-in during the same Business Day do not merge attribution. Each outgoing message is attributed to the worker who was current for that message.

## 8. Customer and order context

### 8.1 Automatic customer match

For every inbound conversation, TUX shall normalize the sender phone and attempt to match the existing customer-contact record.

If a customer exists, Operations may show customer name, normalized/display phone, and relevant saved delivery context already authorized by the existing Orders domain.

If no customer exists, the conversation is still fully usable and is shown as an unknown/new customer until the worker creates or confirms customer context through normal order workflows.

### 8.2 Automatic order context

If the normalized phone has exactly one relevant active order, the conversation may show that order as contextual information with a `View Order` action.

If multiple active orders are plausible, TUX must display the candidates and require the worker to choose. It must not silently guess the intended order.

If no active order exists, prior order history may be shown as read-only context.

### 8.3 Manual link

The worker shall be able to link a conversation to an order manually when automatic matching is insufficient, such as when a customer messages from a different number.

The link creates contextual association only. It does not alter the official order lifecycle.

### 8.4 Order to chat

A customer-bearing Order may expose `WhatsApp Customer`. This opens the matching conversation inside TUX Operations. It must not launch an external WhatsApp application.

### 8.5 New Order from Chat

A direct chat may expose `Create Order from Chat`.

This action transfers customer context only, such as normalized phone, known customer name, and eligible known delivery context. It opens the normal TUX Orders flow with an empty cart. The worker manually selects products/modifiers and confirms the order using existing order rules.

Free-form chat text must not be parsed into order lines automatically.

## 9. Direct WhatsApp Customer Flow

Customers may contact the store WhatsApp number directly without using TUX-MENU.

A direct inbound conversation shall appear in the TUX inbox immediately as a normal conversation. It has no web-order reference unless the customer later creates a structured TUX-MENU request.

The worker may:

- reply directly;
- inspect matched customer/order context;
- create a normal Order from customer context;
- send the TUX-MENU link through a deterministic saved reply.

The inbox shall visually distinguish at least these conversation contexts:

1. **Direct WhatsApp** — no web request is attached.
2. **Website Order Request** — a structured request is awaiting review or has a lifecycle state.
3. **Existing Order Chat** — the conversation is linked to an official Operations order.

A direct conversation may later receive a structured website order request from the same customer. The system shall attach that request to the existing conversation when the provider sender identity and web-order reference establish the match; it shall not create a duplicate customer conversation solely because the website was used later.

## 10. TUX-MENU handoff inside chat

The worker shall have a `Send Menu` action that inserts a saved Egyptian Arabic response containing the public TUX-MENU URL.

Example intent:

`تقدر تختار الأوردر من المنيو هنا، وبعد ما تخلص ابعتهولنا على واتساب.`

The worker presses Send explicitly. The action must not create an order by itself.

When a customer completes a structured TUX-MENU request, the Web Order Bridge described in the companion design spec owns request creation, reference generation, validation, and Review/Accept conversion.

## 11. Order-event context in conversation

TUX may show internal system timeline entries inside the conversation view for worker context, such as:

- website request created;
- website request accepted/rejected/expired;
- official order created;
- order marked done;
- delivery returned;
- order cancelled;
- relevant payment state transitions.

These internal timeline entries are not WhatsApp messages and must never be sent to the customer unless the worker explicitly chooses a corresponding saved message/template and presses Send.

## 12. Offline and failure behavior

### 12.1 POS independence

If internet connectivity or the WhatsApp provider is unavailable:

- the WhatsApp section clearly shows offline/unavailable state;
- cached conversation history already stored locally may remain readable if available;
- Orders and all local-first Operations functionality continue normally.

### 12.2 Outbound messages while offline

An outbound message created while delivery is unavailable may be represented locally as pending/failed according to the implementation plan, but TUX must not blindly transmit stale messages hours later without revalidating provider messaging rules that may have changed with time.

Retry must be explicit or policy-driven only where the provider rules make deterministic retry safe.

Duplicate delivery must be prevented through stable outbound intent/idempotency identifiers.

### 12.3 Provider errors

Provider/API errors must be translated into worker-readable state. Generic failures must not corrupt Orders or customer records.

If a free-form outbound message is not permitted under the provider's current messaging-window/template rules, TUX shall present the permitted path rather than silently failing or bypassing provider requirements.

## 13. Message/media storage

TUX shall persist the minimum durable metadata needed for conversation continuity, audit, search, and provider reconciliation.

Media retention shall be policy-driven. The system must not cache downloaded media indefinitely on the Operations laptop without an explicit retention rule. Provider media identifiers, durable TUX metadata, and local cache state must be separable so cache eviction does not destroy conversation audit history.

## 14. Security boundary

Provider secrets and long-lived provider credentials are server-side only.

Operations uses existing authenticated device/shop/worker boundaries to access its WhatsApp data. The WhatsApp subsystem must preserve Electron's existing hardened renderer boundary and must not require enabling embedded webviews, arbitrary navigation, or Node integration in the Operations renderer.

Inbound provider webhooks must be authenticated/verified according to the provider contract before any event is accepted into TUX state.

Webhook processing and provider status callbacks must be idempotent because delivery can be retried or arrive more than once.

## 15. Single-laptop scope

The v1 design assumes one Operations laptop per shop.

Therefore the following are explicitly excluded from v1:

- cross-laptop typing indicators;
- conversation locking across multiple Operations devices;
- multi-device presence;
- cross-device draft conflict resolution.

The data model should still avoid assumptions that make a future second Operations device impossible, but no user-facing multi-device coordination shall be built now.

## 16. Non-goals

The following are not part of this feature:

- AI assistant;
- chatbot;
- AI message classification;
- automatic natural-language order extraction;
- consumer WhatsApp clone features such as Status/Stories, Channels, Communities, or general social functionality;
- WhatsApp voice/video calling;
- Admin screens inside Operations;
- automatic order mutation from incoming chat text;
- automatic payment confirmation from screenshots or media.

A payment screenshot may be shown as conversation media and associated with an order for context, but it is not payment truth.

## 17. Acceptance-level product scenarios

The implementation plan must eventually prove at least these scenarios:

1. New direct customer message appears in Operations inbox with unread count.
2. Current worker replies from TUX; customer receives the WhatsApp message; worker attribution is durable.
3. Worker signs out, another worker signs in, and the next reply is attributed to the second worker.
4. Known customer phone automatically shows the relevant active order context.
5. Multiple active orders require worker selection; TUX does not guess.
6. Worker opens an Order from chat and opens the matching chat from an Order.
7. `Create Order from Chat` transfers customer context but does not parse chat text into cart lines.
8. `Send Menu` inserts a deterministic Egyptian Arabic saved reply and requires explicit Send.
9. Voice/image/document/location media supported by the selected provider path render correctly where applicable.
10. Network/provider outage leaves all non-WhatsApp Operations functionality usable.
11. Duplicate webhook delivery does not duplicate messages or status transitions.
12. Duplicate/retried outbound intent does not send the same customer message twice.
13. A structured website request can attach to an already-existing direct conversation.
14. Arabic RTL, English LTR, and mixed-direction messages remain readable.
15. Egyptian phone normalization maps equivalent number formats to one customer identity.

## 18. Companion specification

Structured online ordering, TUX-MENU integration, web-order request lifecycle, Review/Accept, Admin-controlled menu/delivery configuration, and conversion into an official Operations order are defined in:

`docs/superpowers/specs/2026-09-02-tux-customer-web-order-bridge-design.md`

The two designs share one invariant: **WhatsApp is the communication channel; structured TUX data is the authority for website order requests; Operations is the authority that converts an approved request into an official order.**
