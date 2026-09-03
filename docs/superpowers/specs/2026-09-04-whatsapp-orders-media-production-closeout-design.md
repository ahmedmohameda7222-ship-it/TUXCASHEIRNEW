# TUX Operations WhatsApp Tasks 8–10 Design

Date: 2026-09-04  
Status: Approved in chat; written-spec review pending  
Implementation baseline: `0684c49f3988545ea68efdfa1d0a1ce4de9e0cdc`  
Implementation branch: `feat/operations-whatsapp-inbox`  
Documentation branch: `docs/whatsapp-web-order-design`

## 1. Scope and authority

This document is the binding architecture/design authority for the remaining TUX Operations WhatsApp Inbox work corresponding to corrected Tasks 8, 9, and 10.

It supersedes stale portions of the original plan `docs/superpowers/plans/2026-09-02-tux-operations-whatsapp-inbox.md` where that plan conflicts with the runtime, transport, UI, persistence, and authority boundaries established by completed Tasks 5, 5.1, 6, and 7.

Existing approved authorities remain binding, including:

- `docs/superpowers/specs/2026-09-02-whatsapp-inbox-design.md`
- `docs/superpowers/specs/2026-09-03-whatsapp-runtime-transport-boundary-design.md`
- `docs/superpowers/specs/2026-09-03-whatsapp-worker-inbox-ui-design.md`
- the Task 7 self-review corrections and single-pass execution amendment

Where this document explicitly extends those authorities for Tasks 8–10, this document is final for that extension.

### In scope

- customer and active-order context inside WhatsApp
- explicit conversation ↔ order linking/unlinking
- Create Order from Chat with customer-prefill only
- safe handling of an existing non-empty Orders draft through Business-Day-scoped parked drafts
- Order → WhatsApp navigation entirely inside TUX
- messaging-window eligibility and approved starter-template fallback
- deterministic Send Menu insertion from canonical public configuration
- full WhatsApp image/document/audio/location send and receive
- direct voice-note recording plus audio-file selection
- Store Location plus optional current-device location
- private Supabase Storage media retention for 30 days
- explicit retry semantics without automatic stale replay
- offline-isolated WhatsApp behavior that never blocks POS
- Windows notification privacy and deduplication
- deterministic fake-provider integration/E2E coverage
- security, migration, CI, and production-acceptance gates

### Explicitly out of scope

- TUX-MENU Web Order Bridge / Web Order Request lifecycle
- AI, chatbot, LLM, OCR, automatic message-to-order parsing, automatic payment-proof interpretation
- embedded WhatsApp Web, `wa.me`, or launching WhatsApp Desktop for operational messaging
- multi-laptop coordination
- consumer WhatsApp social features such as calls, status, communities
- Operations-side quick-reply/template administration; future Admin remains the configuration owner
- permanent retention of media binaries
- automatic outbound replay after offline periods

## 2. Architectural choice

Use capability modules layered on top of the already-approved WhatsApp core rather than concentrating all new behavior in `packages/application/src/whatsapp.ts` or `WhatsAppWorkspace.tsx`.

The intended logical shape is:

```text
Operations UI
  ├─ WhatsApp Inbox Controller
  ├─ Customer/Order Context capability
  ├─ Media Composer capability
  ├─ Location capability
  └─ Voice Recorder capability
          │
          ▼
TuxWhatsAppApi / application boundary
          │
          ▼
Browser transport or hardened Electron bridge
          │
          ▼
TUX /api/whatsapp
  ├─ device authority
  ├─ current-worker authority where worker action is required
  ├─ messaging-window/template policy
  ├─ media gateway
  ├─ customer/order context gateway
  └─ Meta provider gateway
```

The renderer remains a presentation and user-intent layer. Provider credentials, service-role credentials, tenant authority, trusted worker authority, durable media storage administration, and provider-policy enforcement stay server-side.

## 3. Existing boundaries that must not regress

The following existing semantics remain mandatory:

- Browser uses the same-origin `/api/whatsapp` boundary.
- Windows renderer uses `window.tuxDesktop.whatsapp` through contextBridge/preload/trusted IPC.
- Electron Main talks to TUX server APIs; it does not talk directly to Meta for WhatsApp messaging.
- The renderer/browser must not call WhatsApp Supabase RPCs directly.
- The client never chooses trusted `shopId` or worker authority.
- Current Operator authority remains server-resolved from active worker session state.
- `REMOTE_UNAVAILABLE` is the only condition that permits cached inbox fallback.
- `DEVICE_AUTH_INVALID` is not treated as offline.
- no automatic outbound queue/reconnect replay exists.
- provider delivery uncertainty is not treated as safe failure and must not be blindly retried.
- WhatsApp remains inside the ACTIVE Operations shell for interactive worker use unless a later separately approved design changes that rule.

A generic background notification while no worker is active does not create interactive closed-day inbox authority and does not authorize outbound messaging.

## 4. Task 8 — customer/order context

### 4.1 Customer matching

Customer identity resolution is based on the canonical normalized Egyptian phone number. Free-text message content is never parsed to infer customer or order identity.

For the active conversation, the server/application context resolver returns an explicit typed result containing:

- normalized phone
- display phone
- matched customer identity if one exists
- customer name if authorized and available
- eligible saved delivery/address context if authorized by the Orders domain
- zero, one, or many active-order candidates
- any explicitly linked order
- human-facing order number for presentation where available

Unknown customers remain fully usable WhatsApp conversations.

### 4.2 Active-order candidate rules

- zero active orders: show no inferred active-order link
- exactly one active order: present it as the single candidate with `View Order`
- multiple active orders: present explicit candidates and require worker choice
- TUX must never guess among multiple candidates
- prior order history may be shown read-only only if existing Orders authority already exposes it safely; it is not required for acceptance of this scope

Global WhatsApp search by human order number remains deferred. Task 8 may display human order numbers in context/candidate cards but does not expand the Task 7 search contract.

### 4.3 Conversation ↔ order link semantics

Link and Unlink are explicit worker actions.

The link is contextual metadata only. It must not:

- place an order
- cancel an order
- change order state
- confirm payment
- move an order on the Orders Board

Link/unlink requires the same tenant/current-worker authority appropriate to existing WhatsApp order-link mutations. If unlink requires a new API/RPC because the existing nine-method API cannot express it, the contract must be extended coherently through domain/application/wire/browser/Electron/server layers rather than using a renderer-only workaround.

### 4.4 Create Order from Chat

`Create Order from Chat` produces a typed Orders prefill intent only. It transfers customer context, never product intent.

The prefill may contain:

- normalized phone
- display phone
- known customer name
- eligible saved address
- eligible delivery zone/context

The resulting new Orders draft must start with zero product lines. No WhatsApp message text, media, order-like sentence, or attachment may be converted into product lines.

### 4.5 Existing draft and parked drafts

The current application has one active draft scope per desktop main window/browser tab. Task 8 adds Business-Day-scoped parked drafts to prevent silent loss when `Create Order from Chat` is invoked while a non-empty draft already exists.

Behavior:

- if the current Orders draft is empty, apply the customer prefill directly to the fresh/empty draft
- if the current draft contains products or other meaningful draft data, present an explicit choice:
  - `Keep current order`
  - `Start new order for <customer>`
- `Keep current order` leaves the existing draft untouched and aborts the new-order transition
- `Start new order` must atomically persist the current draft as a parked draft and create/open a fresh empty draft with the selected customer prefill
- if parking fails, the existing active draft remains authoritative and unchanged

Parked drafts:

- are scoped to `businessDayId`
- survive navigation and application restart during the same Business Day
- appear in Orders as `Parked Orders`
- can be explicitly restored or discarded
- never silently carry into a later Business Day
- never get deleted automatically by End Day

Restoring a parked draft must never overwrite a non-empty active draft. If the active draft is non-empty, the same safe principle applies: either retain/park the active draft through an explicit worker choice or cancel the restore.

### 4.6 End Day gate

An OPEN Business Day with any parked draft is not closable.

End Day must be blocked by application/domain/persistence authority, not only by a disabled UI button. The worker must first restore/place the relevant draft or explicitly discard it. Discard is an auditable explicit action.

### 4.7 Order → WhatsApp

For an order with a valid normalized customer phone, expose `WhatsApp Customer` inside TUX.

The action must never open `wa.me`, WhatsApp Web, or external WhatsApp Desktop.

Server-resolved messaging capability determines the next state:

1. existing conversation with valid customer-service window: open the internal conversation and allow normal free-form composing
2. no usable free-form window: expose only server-returned approved starter templates
3. no approved starter template: show an explanatory blocked state; do not attempt a doomed free-form provider send

Provider eligibility is server authority. The renderer does not compute the 24-hour/service-window rule from local time and does not guess template eligibility.

### 4.8 Starter templates

Approved starter templates are server-side/channel-scoped configuration with provider approval state. Operations workers may choose and send approved templates but may not create/edit template definitions in Operations.

Template send remains explicit. The server validates that the selected template is allowed for the resolved channel and provider state before sending.

### 4.9 Send Menu

`Send Menu` reads a non-secret canonical public storefront URL from configuration. It must not hard-code the production TUX-MENU URL in UI code.

The action inserts a deterministic Egyptian-Arabic menu response plus the URL into the composer. It never auto-sends; the worker must still press Send.

Future Admin remains the owner of canonical public storefront configuration.

## 5. Task 9 — media architecture

### 5.1 Supported media

Workers can send and receive:

- image
- document/PDF
- audio/voice note
- location

Payment screenshots or documents remain ordinary media. They never prove or auto-confirm payment.

### 5.2 Canonical durable storage

Media binary source of truth after TUX ingestion is a private Supabase Storage bucket.

Postgres stores durable message/media metadata, including at minimum:

- message identity
- media kind
- content type/MIME classification
- safe filename/display name where applicable
- byte size
- private storage object path/key
- `storedAt`
- `expiresAt`
- provider media/message identifiers required for idempotency/audit
- retention/deletion state

Browser `localStorage` is never a media binary store.

Laptop-side binary data is only transient cache/temp data. It is never the canonical history source.

### 5.3 Retention

Media binary retention is 30 days from TUX durable ingestion:

`expiresAt = storedAt + 30 days`

After expiry:

- the private Storage object is deleted
- durable message history and non-secret metadata remain
- the UI shows an explicit expired/unavailable media state rather than a broken permanent URL

Retention cleanup is server-side recurring maintenance. It must be idempotent and safe to rerun. Cleanup failure is operationally visible but must not block POS or normal WhatsApp messaging.

No laptop timer is an authority for retention deletion.

### 5.4 Private media access

The renderer never receives:

- Supabase service-role credentials
- Meta access tokens
- permanent public Storage URLs
- bucket administration credentials

Media access is authorized by the TUX server and returned through either a server-streamed response or a short-lived signed private-object URL. Signed access must be short-lived and must not become persisted canonical application data.

### 5.5 Media validation

Server policy validates outbound and inbound media before durable exposure to the client.

Requirements:

- allowlisted message/media categories
- content sniffing or equivalent server-side validation rather than trusting client-declared MIME alone
- safe filename handling; filenames are display metadata, never trusted filesystem paths
- centralized per-kind size limits compatible with current Meta provider constraints and TUX safety policy
- deterministic rejection before provider send for unsupported/unsafe media

Exact byte limits are implementation policy constants and must be documented in code/tests against the provider policy used at implementation time; they are not renderer-configurable.

### 5.6 Outbound media flow

```text
Select or Record
  → local preview
  → explicit Send
  → TUX server validation
  → durable private media handling
  → provider send
  → message status updates
```

No server upload occurs merely because the worker selected a file. Explicit Send is the trigger for durable outbound handling.

Outbound status remains consistent with the established message model:

- PENDING
- SENT
- DELIVERED
- READ
- FAILED

### 5.7 Retry and uncertainty

No automatic retry/replay occurs after reconnect.

A provider-definitive retriable `FAILED` message may expose an explicit `Retry` action. Retry creates a new server-authorized attempt linked to the original failed message/intent and uses server idempotency so repeated clicks cannot create uncontrolled duplicate provider sends.

`PENDING` delivery uncertainty is not equivalent to FAILED. A message whose delivery outcome is uncertain must not expose blind resend behavior that can duplicate delivery.

### 5.8 Text and media drafts

Existing text composer drafts remain per conversation, survive navigation/restart, and are cleared only when the exact revision sent succeeds according to the existing controller semantics.

For v1, unsent binary selections and in-progress voice recordings do **not** receive durable cross-restart recovery. They remain transient local/session data and are discarded on restart. This avoids turning uncommitted customer media into a second durable storage system on the laptop.

No selected unsent binary is uploaded merely for draft persistence.

## 6. Voice-note design

Workers have both paths:

1. record directly from the microphone inside TUX
2. choose an existing audio file

Direct recording behavior:

- explicit Record
- visible recording state
- Stop; Pause/Resume may be exposed only where the runtime supports it cleanly without changing the core acceptance contract
- Preview before send
- explicit Send or Cancel

Microphone denial/unavailability is a recoverable UI state and does not affect POS or text messaging.

Electron remains hardened. Any Electron permission handler added for microphone use must allow only the trusted TUX app context and required audio-capture capability and must not broadly relax unrelated permissions, navigation, `webviewTag`, or web security.

## 7. Location design

Workers have both approved location paths:

### 7.1 Send Store Location

- primary/default choice
- uses canonical store latitude/longitude from configuration
- may include canonical label/address for presentation
- configuration is non-secret and future Admin-owned
- renderer cannot permanently alter canonical store coordinates through the Send Location UI

### 7.2 Share Current Location

- optional device-location path
- obtains current coordinates through a typed platform capability
- browser may use browser geolocation
- Electron may use an approved browser/OS-backed capability through the hardened platform boundary
- permission denial or unavailable location is recoverable
- current-device coordinates never overwrite Store Location

A sent WhatsApp location contains provider-supported latitude/longitude plus optional presentation label/address. A screenshot or map image is not a substitute for the structured location payload.

## 8. Offline behavior

WhatsApp availability never blocks POS.

When remote WhatsApp delivery is unavailable:

- cached conversations/history remain readable
- text drafts remain available
- already-cached media may remain viewable if the transient cache still has it and policy permits
- uncached remote media is shown as unavailable while offline
- inbound refresh is visibly stale/offline
- text/media/location/template sends require remote availability
- no outbound offline queue is created
- reconnect refreshes state but does not automatically replay stale outbound intent

Authentication/authority failure must not be mislabeled as offline.

## 9. Windows notifications

Windows notification handling is an Electron Main/OS capability, not React business logic.

Notifications are generated only for newly observed inbound unread messages when Operations is not already focused on that conversation. Re-observation of the same stable inbound provider/message identity must not create duplicate notifications.

### 9.1 ACTIVE Business Day with current worker

A notification may show a privacy-safe customer/message preview appropriate to the media kind.

### 9.2 No current worker or Business Day not ACTIVE

Only a generic notification is allowed, for example:

`New WhatsApp message`

It must not include customer name, phone number, message preview, document filename, media caption, or location details.

This background notification behavior does not grant interactive closed-day inbox access and does not authorize outbound messaging.

Notification delivery failure is non-fatal.

## 10. API and module extension principles

The existing `TuxWhatsAppApi` currently has the Task 6/7 contract. Tasks 8–9 may extend it only through typed, end-to-end coherent contracts.

Any new capability must be represented consistently across the layers it actually needs:

- domain/application types
- application service/capability
- wire contract
- browser remote/client
- Electron preload/contextBridge/main IPC as applicable
- server route/handler
- provider/storage gateway
- tests at each trust boundary

Do not create renderer-only pseudo-capabilities that bypass the established server authority.

Prefer focused modules such as customer/order context, media, location, and notification adapters rather than allowing `whatsapp.ts` or `WhatsAppWorkspace.tsx` to become cross-domain monoliths.

## 11. Task 10 — deterministic E2E and CI

### 11.1 E2E environment

The previously observed generic Vite-preview `/api/whatsapp` 404 is a test-harness boundary issue, not a reason to weaken production transport.

Task 10 must make the rendered E2E harness aware of the real `/api/whatsapp` contract by either:

- running an appropriate local server/API route, or
- injecting a deterministic contract-faithful fake at the server boundary

Do not mask the 404 with product code hacks, provider bypasses, or client-side silent success.

### 11.2 Required deterministic scenarios

Automated integration/E2E coverage must include at minimum:

- direct inbound fixture → unread badge
- open conversation → explicit text reply → fake provider observes exactly one send
- current worker attribution
- known customer with one active order
- multiple active orders require explicit worker selection
- Create Order from Chat transfers customer context only and starts with empty product lines
- non-empty active order draft can be parked without data loss
- parked draft survives navigation/restart for the same Business Day
- End Day is blocked while parked drafts exist
- Order → WhatsApp free-form eligible path
- Order → WhatsApp approved-template fallback path
- no-template blocked state
- Send Menu inserts canonical configured URL and does not auto-send
- image/document/audio/location send/receive contracts
- voice recording permission denial is non-fatal
- current-location denial falls back to Store Location availability where configured
- explicit FAILED retry without automatic replay
- delivery-uncertain state does not blindly resend
- offline POS remains usable
- reconnect does not duplicate inbound/outbound messages
- notification deduplication
- notification generic-only behavior without active worker/Business Day
- media-expired presentation after binary deletion

### 11.3 Security gates

CI/source gates must fail if client/runtime code introduces prohibited behavior, including:

- Meta access token/app secret in renderer/browser/Electron client boundary
- Supabase service-role key in client code
- direct `graph.facebook.com` use from renderer/browser/Desktop WhatsApp runtime
- embedded or launched `web.whatsapp.com` as the Operations messaging implementation
- `webviewTag` enabled
- renderer-selected trusted tenant/worker authority
- permanent public media bucket or permanent public media URL as canonical storage
- unguarded provider media URL exposure to renderer
- dangerous file-path trust derived from user filenames

Existing migration/security/Electron hardening gates remain in place.

### 11.4 Migration/storage gates

Any database or Storage metadata changes use new migrations only; existing migration files are immutable.

Tests/gates must establish:

- tenant isolation
- server-only privileged WhatsApp mutations
- link/unlink authorization
- Business-Day-scoped parked drafts
- End Day parked-draft blocking
- media metadata separated from binary object storage
- private media access
- deterministic 30-day `expiresAt`
- idempotent cleanup
- binary deletion leaves message history intact
- outbound text/media/template/location idempotency

## 12. Production acceptance

Code/fake-provider completion is not sufficient to declare the subsystem production-ready.

A real Meta Business Platform acceptance pass is required before final production-ready/frozen classification. The acceptance checklist must include at least:

1. real direct inbound customer message appears once in TUX
2. worker text reply reaches the customer once
3. delivered/read updates appear when Meta supplies them
4. worker A signs out, worker B signs in, later outbound attribution is worker B
5. known customer/order context opens the correct order
6. multiple active orders require worker choice
7. Order → WhatsApp uses free-form only when eligible
8. outside free-form eligibility, an approved starter template sends successfully
9. no-template state fails closed with an explanatory UI state
10. Send Menu uses canonical configured storefront URL and requires explicit Send
11. image/document/audio/location inbound render correctly
12. image/document/audio/location outbound reach the real customer once
13. direct microphone recording/preview/send works in the Windows target runtime
14. Store Location sends canonical configured coordinates
15. current-device location works when permission/capability is available and fails safely when denied
16. payment-proof media does not auto-confirm payment
17. loss of internet leaves POS fully usable
18. reconnect does not duplicate inbound/outbound messages
19. Windows notification privacy behavior matches active-worker vs generic-only rules
20. private media access does not leak long-lived credentials or permanent public URLs
21. retention/expiry mechanism can be verified safely without waiting 30 production days through controlled non-production acceptance or test clock/policy instrumentation
22. provider credentials do not appear in installer, renderer bundle, DevTools-accessible client configuration, or client API responses

If real Meta assets/credentials are unavailable at implementation time, implementation and deterministic tests may still complete. The final report must classify real-provider acceptance as an external/manual pending gate and must not claim production readiness.

## 13. One-pass execution authority

After this written design is approved and a detailed implementation plan is written, the implementation chat executes Tasks 8 → 9 → 10 in one continuous pass.

Binding cadence:

- exact implementation baseline: `0684c49f3988545ea68efdfa1d0a1ce4de9e0cdc`
- Task 8: strict TDD and commit
- Task 9: strict TDD with atomic logical commit(s)
- Task 10: strict TDD/gate work and final verification
- no review/STOP between Task 8 and Task 9
- no review/STOP between Task 9 and Task 10
- return once after the whole Tasks 8–10 scope is complete
- TUX-MENU Web Order Bridge must not begin in this pass

For each capability: RED → verify intended failure → minimal GREEN → focused gate → commit/checkpoint.

If a test or bug fails during implementation, root-cause/debugging is performed inline and execution continues. Stop early only for a genuinely new product decision not resolved by this spec or an external prerequisite that cannot be safely isolated.

## 14. Final implementation handoff evidence

The implementation chat returns one complete evidence packet containing:

- exact baseline SHA
- final HEAD SHA
- every implementation commit SHA and purpose
- exact permanent changed-file list / baseline-to-head compare
- RED evidence for each task/capability
- focused GREEN test commands/results and counts
- full repository tests
- typecheck
- lint
- format
- build
- migration tests and immutability gates
- WhatsApp security/source gates
- rendered E2E result
- Windows/Electron hardening/regression result
- CI run ID, job ID, conclusion
- clean `git status`
- any production mutations actually performed
- all manual/external acceptance still pending
- dependency vulnerability output if present, without hiding pre-existing findings

This planner/auditor chat then performs one independent comprehensive audit of Tasks 8–10 together.

## 15. Acceptance summary

This design is successful when:

- WhatsApp stays inside TUX and obeys the established browser/Electron/server authority boundaries
- customer/order integration navigates and transfers context without duplicating Orders business logic
- a worker can safely park an in-progress draft instead of losing it when starting an order from chat
- End Day cannot silently abandon parked drafts
- Order → WhatsApp obeys server-resolved provider messaging rules and approved templates
- Send Menu is canonical-config driven and explicit-send only
- image/document/audio/location messaging works in both directions
- direct voice recording and optional device location work without weakening Electron security
- media binaries are private, server-controlled, and removed after 30 days while message history remains
- offline WhatsApp never degrades POS and never causes blind replay
- notifications are useful during active work and privacy-preserving without an active worker/day
- deterministic CI/E2E and security gates cover the cross-boundary behavior
- production readiness is withheld until real-provider acceptance is complete
