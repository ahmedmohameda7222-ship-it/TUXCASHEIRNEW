# TUX Operations WhatsApp Worker Inbox UI — Spec Self-Review Corrections

Date: 2026-09-03
Status: Binding correction to written Task 7 spec
Parent spec: `docs/superpowers/specs/2026-09-03-whatsapp-worker-inbox-ui-design.md`

This file records two corrections found during the mandatory written-spec self-review. It is binding wherever it conflicts with the parent spec.

## 1. Availability/offline semantics correction

The completed Task 6 public boundary must remain unchanged in Task 7.

`OperationsWhatsAppService.loadInbox()` currently behaves as follows:

- remote load succeeds → returns `ok(snapshot)`;
- remote returns `REMOTE_UNAVAILABLE` and a local shop/cache is available → returns `ok(cachedSnapshot)`;
- authoritative device/session invalidation → returns an application error;
- local cache failure → returns an application error.

Therefore a successful `TuxWhatsAppApi.loadInbox()` result does **not** carry a reliable bit that says whether it came from remote data or cached fallback.

Task 7 MUST NOT infer provider availability from hidden lower-layer behavior and MUST NOT expand `TuxWhatsAppApi` merely to expose an availability flag.

### 1.1 Controller state

Replace the parent-spec controller responsibility `remote-unavailable state` with:

- browser/renderer network advisory state from the standard online/offline event surface;
- last safe WhatsApp application error;
- latest successful snapshot and its refresh timestamp.

The controller may display a network advisory when the renderer reports offline, for example:

`Network offline — cached WhatsApp may be stale. POS continues normally.`

This is explicitly a **network advisory**, not proof that Meta/provider delivery is unavailable.

### 1.2 Successful cached fallback

If `loadInbox()` returns `ok(snapshot)`, Task 7 treats it as a usable snapshot regardless of whether the application layer obtained it remotely or from cache.

The UI MUST NOT label that successful result `provider offline`, because the public API does not support that conclusion.

### 1.3 Error results

If `loadInbox()` returns an application error:

- preserve the last successful snapshot;
- surface the safe `ApplicationError.message` in the WhatsApp UI;
- do not inspect or expose raw `cause` objects;
- do not classify errors by parsing hidden server/provider details in React.

A device/session-invalid message therefore remains distinguishable through the safe application message without adding a new renderer authority path.

### 1.4 Poll triggers

The parent-spec refresh trigger on the standard `online` event remains valid.

While standard network state is offline:

- periodic remote refresh attempts may pause;
- cached conversation rendering remains available from the latest successful snapshot;
- no outbound message is auto-queued or auto-replayed.

When `online` fires, trigger one coalesced refresh.

### 1.5 Acceptance correction

Task 7 acceptance requires:

- a non-blocking network-offline advisory based only on standard renderer network state;
- safe application-error presentation;
- preservation of the last successful inbox snapshot during refresh errors;
- POS independence.

Task 7 does **not** require provider-outage detection from a successful cached `loadInbox()` result.

A future availability/status signal may be added only through a separately reviewed application/API contract if product requirements need provider-specific status.

## 2. Quick-reply insertion correction

The parent spec left behavior ambiguous when the composer already contains text.

Task 7 uses one deterministic rule:

- if the composer is empty, selecting a quick reply sets the composer to the quick-reply text;
- if the composer is non-empty, selecting a quick reply appends the quick-reply text after exactly one newline;
- selecting a quick reply never sends;
- selecting a quick reply never clears or silently replaces existing worker text;
- the worker may freely edit the resulting composer before explicit Send.

This avoids an extra confirmation modal and prevents silent draft loss while remaining deterministic and testable.

Tests must cover both empty-composer and non-empty-composer insertion and prove zero `sendText` calls occur on selection alone.

## 3. No other changes

All other sections of the parent Task 7 written spec remain binding, including:

- App-owned shared inbox controller;
- visible-only 15-second polling with single-flight/coalescing;
- nav unread badge from the shared snapshot;
- deterministic filters/sorting/search;
- `dir="auto"` bidi handling;
- canonical snapshot quick replies only;
- stable outbound intent key for unchanged failed attempts;
- no automatic replay;
- no outbound media/sendMedia;
- no order-context Task 8 behavior;
- no schema/migration changes;
- no production mutation.
