# TUX Operations WhatsApp Worker UI Design

Date: 2026-09-04
Status: Approved design direction; binding for Task 8E/9D UI implementation after user review of this written spec
Platform: Windows-primary Electron desktop; browser fallback

## 1. Design intent

TUX Operations WhatsApp must feel premium, fast, calm, and operationally efficient for a restaurant worker. It may use Apple Human Interface Guidelines as an information-architecture and interaction-quality reference even though the primary platform is Windows. The UI must not imitate macOS chrome or Liquid Glass. TUX keeps its own visual language and Windows-primary execution model.

The worker must be able to understand the active conversation, customer/order context, messaging eligibility, and next action at a glance without leaving TUX or opening external WhatsApp.

## 2. Primary layout

Use a two-pane desktop split layout:

- Left pane: conversation inbox/navigation rail.
- Right pane: selected conversation detail.
- Do not use a permanently visible third inspector pane.
- Order/customer context appears as a compact contextual card inside the conversation pane.

Target conversation rail width: approximately 320–360 px on normal laptop displays, with a practical lower bound around 300 px. The message pane receives the remaining width.

This layout is preferred over a three-pane design because TUX Operations is Windows laptop/POS software and must preserve message history and composer space on common 1366–1440 px displays.

## 3. Conversation rail

Top-to-bottom hierarchy:

1. `WhatsApp` title and subtle refresh/offline state.
2. Search field with persistent visibility.
3. Compact filter control for All / Unread / Follow-up / Archived.
4. Scrollable conversation list.

Each conversation row shows only worker-useful information:

- customer name when known, otherwise formatted phone;
- context label such as Direct Chat / Order Chat;
- latest message preview;
- latest message time;
- unread count;
- follow-up indicator when applicable.

Selection must be visually obvious with a strong but restrained selected-row treatment. Rows must remain legible under both Arabic and English content and use `dir="auto"` for user-generated text.

Avoid oversized avatars or decorative imagery. If an identity marker is used, prefer a compact initials treatment that does not compete with operational information.

## 4. Conversation header

The selected conversation header contains:

- customer/display name;
- formatted phone number;
- context label (`DIRECT CHAT`, `ORDER CHAT`, or approved future context label);
- linked-order indicator when applicable;
- only the highest-value immediate action(s).

Do not show Follow-up, Archive, and Mark unread as three equally prominent large buttons. Keep the header disciplined:

- Follow-up may remain a visible secondary action if worker testing shows it is frequent enough.
- Archive and Mark unread belong in an overflow `…` action menu unless product usage proves otherwise.

The header must not become a toolbar full of unrelated controls.

## 5. Customer / Order context card

When customer/order context is available, show one compact card immediately below the conversation header.

The card may show:

- customer name;
- active order number(s);
- order status/type where useful;
- linked state;
- `View Order`;
- `Link` / `Unlink`;
- `Create Order from Chat`.

Rules:

- One active order may be presented directly.
- Multiple active orders must be shown as explicit candidates; never auto-select one.
- No raw UUID should be used as the primary worker-facing order identifier.
- Creating an order transfers customer context only; it never parses free text into products.
- The card must stay compact and must not steal the message-history area.

## 6. Message history

Message history is the visual center of the screen and gets the largest area.

Message presentation:

- inbound and outbound alignment must be immediately distinguishable;
- bubbles remain restrained, with premium spacing and typography rather than exaggerated colors;
- system events use a separate low-emphasis centered treatment;
- outbound status appears subtly as Sending / Sent / Delivered / Read / Failed;
- failed messages expose explicit Retry only where retry is allowed;
- PENDING/uncertain never exposes blind retry;
- timestamps and metadata must remain secondary to content.

Media rendering:

- Image: inline preview when available.
- Document: safe filename with explicit open/download action.
- Audio: native compact playback controls.
- Location: structured label/address/coordinates presentation without provider map-image dependency.
- Expired binary media: inline `Media expired` state; history remains visible.
- Payment screenshots must never be labeled as paid/confirmed automatically.

## 7. Composer

The composer is sticky at the bottom of the conversation pane.

Recommended structure:

- compact quick-reply row above the field;
- `Send Menu` as an explicit quick action that inserts text only;
- attachment `+` action;
- multiline text composer;
- voice-record action;
- Send button.

The visual hierarchy must make the Send button obvious without making the composer visually heavy.

Quick Replies:

- horizontal compact chips/buttons;
- active replies only;
- no auto-send;
- clicking inserts/replaces text according to the approved controller semantics.

Send Menu inserts exactly:

```text
منيو TUX 👇
<canonical storefront URL>
```

It never sends automatically.

## 8. Messaging policy states

### FREE_FORM

Normal composer, quick replies, Send Menu, media, voice, and location actions are enabled subject to their own availability.

### TEMPLATE_ONLY

- Preserve any existing free-form draft text.
- Disable free-form send without deleting the draft.
- Present server-approved starter templates clearly near the composer.
- Template cards/buttons should show human preview text and not expose provider template identifiers.

### BLOCKED

- Keep the conversation history visible.
- Replace/disable outbound controls with a clear explanation that no approved template is available.
- Do not obscure history with a modal.

A stale client receiving `FREE_FORM_WINDOW_CLOSED` must preserve draft/attachment state and refresh target policy once.

## 9. Create Order from Chat conflict

If the current Orders draft is empty, navigate directly to Orders with customer prefill.

If the current Orders draft is meaningful, show a focused confirmation choice with only the required decision:

- `Keep current order`
- `Start new order for <customer>`

Do not use generic warning text or nested modals. If the worker chooses Start new, use the approved atomic park-and-replace behavior.

## 10. Internal navigation

All navigation stays inside TUX Operations.

- `View Order` → Orders Board with typed focus intent.
- `Create Order from Chat` → Orders with typed customer prefill.
- `WhatsApp Customer` from an eligible delivery order → WhatsApp with typed open intent.

Do not launch `wa.me`, WhatsApp Web, or WhatsApp Desktop.

## 11. Offline and error presentation

WhatsApp failures must never visually dominate or block POS work.

Use inline, non-modal status banners for:

- network offline;
- stale cached inbox;
- recoverable fetch errors.

The copy must explicitly communicate that POS continues normally when appropriate.

Authentication/authority failures are not shown as offline fallback states.

## 12. Premium visual language

Premium quality should come from hierarchy and restraint, not decorative effects.

Use:

- consistent spacing rhythm;
- clear typography scale;
- restrained borders and elevation;
- subtle surface separation;
- precise selected/hover/focus states;
- compact controls sized for fast worker use;
- deliberate whitespace;
- minimal animation with functional purpose only.

Avoid:

- macOS window chrome imitation;
- excessive translucent/glass effects;
- oversized cards;
- dense toolbar icon rows;
- decorative gradients that reduce legibility;
- consumer-social-app clutter;
- unnecessary profile imagery.

The screen should read as a premium operations tool, not a WhatsApp clone.

## 13. Windows-primary ergonomics

The implementation is Windows-primary even when borrowing Apple interaction principles.

Requirements:

- keyboard-focus visibility on every interactive control;
- mouse-friendly and touch-tolerant hit areas;
- stable layout at common laptop sizes;
- no hover-only critical action;
- no gesture-only interaction;
- native-feeling scrolling and text selection;
- predictable `Esc`, Enter, and tab-order behavior where applicable;
- avoid platform-specific affordances that only make sense on macOS.

## 14. Arabic / English handling

TUX worker UI chrome may remain English per the current application language, while customer content can be Arabic or English.

Requirements:

- `dir="auto"` for message text, previews, names, addresses, and draft content where appropriate;
- mixed Arabic/English/phone-number content must remain readable;
- fixed operational labels must not flip unpredictably based on message direction;
- phone numbers remain visually stable and selectable.

## 15. Accessibility and clarity

- visible keyboard focus;
- sufficient contrast for selected rows, unread counts, failed states, and disabled composer states;
- do not encode status by color alone;
- buttons use text labels or accessible names;
- unread and status indicators expose readable labels;
- confirmation wording must state the exact consequence.

## 16. Scope by task

### Task 8E

Implements the structural UI:

- two-pane inbox/conversation layout refinement;
- disciplined header actions;
- customer/order context card;
- link/unlink;
- Create Order from Chat;
- parked-order interactions;
- Send Menu;
- template-only/blocked states;
- internal Order ↔ WhatsApp navigation.

### Task 9D

Adds media interaction without redesigning the information architecture:

- attachment selection;
- image/document/audio rendering;
- direct voice recording with Preview → Send / Cancel;
- Store Location;
- Current Location;
- explicit failed retry;
- media expired presentation.

## 17. Non-goals

Do not add:

- AI/chatbot features;
- message-to-order parsing;
- customer status/stories;
- calls;
- communities;
- WhatsApp Web embedding;
- card/payment confirmation from screenshots;
- multi-device coordination UI;
- management analytics inside the worker inbox.

## 18. Acceptance criteria

The UI is acceptable only if a worker can quickly answer all of these without leaving the screen:

1. Who am I talking to?
2. Is there an order/customer context?
3. What is the latest conversation state?
4. Can I send free-form, must I use a template, or am I blocked?
5. How do I reply, send the menu, attach media, record voice, or send location?
6. How do I create/view/link an order without guessing?
7. Is WhatsApp offline/failed without affecting POS?
8. Did my outbound message send/deliver/read/fail?

The final UI should look premium because it is calm, precise, information-dense without clutter, and optimized for worker action speed.