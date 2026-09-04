# TUX Operations WhatsApp Premium Worker UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task inside the existing Tasks 8–10 execution. Do not dispatch subagents and do not stop for reviewer approval between 8E and 9D.

**Goal:** Implement the approved premium worker-facing WhatsApp UI for TUX Operations while preserving the existing Tasks 8–10 architecture, Windows-primary ergonomics, and strict TDD flow.

**Architecture:** Keep the existing two-pane inbox/detail structure and application-owned navigation. Task 8E upgrades information hierarchy, order context, policy states, and navigation; Task 9D extends the same composer/history surfaces for media, voice, location, and explicit retry. Apple HIG is an interaction-quality reference only; the result remains TUX-branded Windows Electron software, not a macOS or WhatsApp clone.

**Tech Stack:** TypeScript 6, React 19, Electron 43, existing TUX Operations CSS system, Vitest 4, Playwright 1.62.

**Spec:** `docs/superpowers/specs/2026-09-04-whatsapp-worker-premium-ui-design.md`

## Global Constraints

- Working implementation branch remains `work/operations-whatsapp-inbox-live` through Task 10C.
- GitHub remains the durable implementation source of truth; meaningful WIP is committed/published to the working branch continuously.
- Preserve the approved two-pane layout: conversation rail left, selected conversation detail right; no permanent third inspector pane.
- Conversation rail target width is approximately 320–360 px on normal laptop displays, with practical lower bound around 300 px.
- Do not imitate macOS window chrome, Liquid Glass, or consumer WhatsApp styling.
- Premium quality comes from hierarchy, typography, spacing, surfaces, restrained elevation, precise selection/focus states, and low visual noise.
- Worker-critical actions must remain visible and fast; secondary actions belong in overflow rather than crowding the header.
- `dir="auto"` is required for customer-generated/mixed Arabic-English text where appropriate.
- No hover-only critical action, no gesture-only action, and keyboard focus must remain visible.
- Messaging policy remains server-authoritative; UI only renders `FREE_FORM`, `TEMPLATE_ONLY`, and `BLOCKED` states.
- `Send Menu` inserts deterministic text only; it never auto-sends.
- Multiple active orders are never auto-selected.
- Payment screenshots are never auto-labelled paid/confirmed.
- Offline/recoverable WhatsApp status remains inline and never blocks POS.
- No production Supabase, Meta, or Vercel mutation is authorized by this UI plan.

---

### Task UI-1: Lock the two-pane worker hierarchy in Task 8E

**Files:**
- Modify: `apps/operations/src/app/WhatsAppWorkspace.tsx`
- Modify: `apps/operations/src/app/WhatsAppWorkspace.test.tsx`
- Modify: `apps/operations/src/styles/global.css`
- Modify: `apps/operations/src/app/whatsappView.ts` only if a pure display helper is required
- Test: `apps/operations/src/app/WhatsAppWorkspace.test.tsx`

**Interfaces:**
- Consumes: existing `WhatsAppInboxUiState`, selected conversation, visible conversations, composer state, and Task 8E messaging-target/order-context state.
- Produces: stable two-pane worker layout used unchanged as the shell for Task 9D media features.

- [ ] **Step 1: Add RED structure tests**

Add assertions that rendered WhatsApp contains exactly one conversation rail and one conversation detail pane; the rail contains title, persistent search, compact filters, conversation list; the detail pane contains header, optional compact context region, message history, and sticky composer region. Assert no permanent third inspector region exists.

- [ ] **Step 2: Run RED**

Run:

```bash
npm test -- apps/operations/src/app/WhatsAppWorkspace.test.tsx
```

Expected: FAIL on the new premium hierarchy/accessibility selectors until the structure is implemented.

- [ ] **Step 3: Implement the two-pane hierarchy without changing business logic**

Keep conversation rail width controlled in CSS around `clamp(300px, 26vw, 360px)` and let the conversation pane consume the remainder. Keep message history as the dominant flexible region and composer pinned to the bottom of the detail pane.

- [ ] **Step 4: Implement premium rail rows**

Each row shows display name/phone fallback, context label, preview, time, unread count, follow-up indicator, and a strong restrained selected treatment. Do not add oversized avatars; if initials are used, keep them compact and decorative-only.

- [ ] **Step 5: Run GREEN**

Run the same test command and require PASS.

- [ ] **Step 6: Publish WIP to the working GitHub branch**

Commit the exact tested tree to `work/operations-whatsapp-inbox-live` with a message such as:

```bash
git commit -m "wip(task8e): establish premium WhatsApp split layout"
```

Verify the remote branch contains the tested tree before continuing.

---

### Task UI-2: Implement disciplined conversation header and order context card

**Files:**
- Create/Modify: `apps/operations/src/app/whatsappOrderContext.ts`
- Test: `apps/operations/src/app/whatsappOrderContext.test.ts`
- Modify: `apps/operations/src/app/WhatsAppWorkspace.tsx`
- Modify: `apps/operations/src/app/WhatsAppWorkspace.test.tsx`
- Modify: `apps/operations/src/styles/global.css`

**Interfaces:**
- Consumes: `WhatsAppCustomerOrderContext`, selected conversation, linked-order state, typed navigation intents from the approved Task 8E plan.
- Produces: compact worker-facing context model and actions without exposing raw UUIDs as primary labels.

- [ ] **Step 1: Write RED helper tests**

Cover zero/one/many active orders, human order-number presentation, linked/unlinked states, and multiple-order explicit candidate presentation. Assert no helper auto-selects among multiple active orders.

- [ ] **Step 2: Run RED**

```bash
npm test -- apps/operations/src/app/whatsappOrderContext.test.ts apps/operations/src/app/WhatsAppWorkspace.test.tsx
```

Expected: FAIL on missing/updated presentation behavior.

- [ ] **Step 3: Implement the compact context card**

Place it immediately below the conversation header. Keep customer/order information compact and expose only relevant actions: `View Order`, `Link`/`Unlink`, and `Create Order from Chat`. One active order may be shown directly; multiple active orders render explicit candidates.

- [ ] **Step 4: Reduce header action clutter**

Keep identity, phone, context label, linked indicator, and highest-value immediate action(s) visible. Move `Archive` and `Mark unread` into an accessible overflow `…` menu. Keep `Follow-up` visible only as a secondary action if it remains frequent in the current flow.

- [ ] **Step 5: Run GREEN and publish**

Run the focused tests again. Commit/publish the exact tested tree to the same working branch and verify it remotely.

---

### Task UI-3: Implement policy-aware premium composer and Task 8E navigation

**Files:**
- Modify: `apps/operations/src/app/whatsappInboxController.ts`
- Test: `apps/operations/src/app/whatsappInboxController.test.ts`
- Modify: `apps/operations/src/app/WhatsAppWorkspace.tsx`
- Test: `apps/operations/src/app/WhatsAppWorkspace.test.tsx`
- Modify: `apps/operations/src/app/App.tsx`
- Test: `apps/operations/src/app/App.whatsapp.test.tsx`
- Modify: `apps/operations/src/app/OrdersWorkspace.tsx`
- Modify: `apps/operations/src/app/OrdersBoardWorkspace.tsx`
- Modify: `apps/operations/src/styles/global.css`
- Modify: `apps/operations/src/styles/orders.css`

**Interfaces:**
- Consumes: Task 8D `WhatsAppMessagingTarget`, server-returned canonical storefront URL, approved templates, `OrdersPrefillIntent`, `WhatsAppOpenIntent`.
- Produces: worker-facing FREE_FORM/TEMPLATE_ONLY/BLOCKED composer states and internal TUX navigation.

- [ ] **Step 1: Write RED controller tests**

Assert `Send Menu` inserts exactly:

```text
منيو TUX 👇
<canonical storefront URL>
```

and never sends automatically. Assert stale policy refresh preserves composer text.

- [ ] **Step 2: Write RED workspace/App tests**

Cover FREE_FORM normal composer, TEMPLATE_ONLY preserving free-form draft while disabling free-form send and presenting approved templates, BLOCKED retaining history with a clear no-template explanation, `View Order`, `Create Order from Chat`, and `WhatsApp Customer` staying inside TUX navigation.

- [ ] **Step 3: Run RED**

```bash
npm test -- apps/operations/src/app/whatsappInboxController.test.ts apps/operations/src/app/WhatsAppWorkspace.test.tsx apps/operations/src/app/App.whatsapp.test.tsx apps/operations/src/app/OrdersWorkspace.test.ts apps/operations/src/app/OrdersBoardWorkspace.test.ts
```

Expected: FAIL on missing Task 8E policy/navigation behavior.

- [ ] **Step 4: Implement sticky composer hierarchy**

Use a compact quick-reply row above the field, explicit `Send Menu`, text composer, and Send button. Reserve attachment/voice affordance slots so Task 9D extends the same shell rather than redesigning it.

- [ ] **Step 5: Implement policy states without modals**

`FREE_FORM` keeps normal controls. `TEMPLATE_ONLY` preserves draft text, disables free-form sending, and renders server-approved template choices near the composer. `BLOCKED` leaves history visible and replaces outbound controls with explanatory inline state.

- [ ] **Step 6: Implement Create Order conflict decision**

When Orders draft is meaningful, present only `Keep current order` and `Start new order for <customer>` using the approved atomic park-and-replace path. Do not add generic nested warning modals.

- [ ] **Step 7: Run Task 8E focused GREEN**

Run the Task 8E focused suite from the main Tasks 8–10 plan plus:

```bash
npm run typecheck
npm run lint
npm run format:check
```

Require all PASS.

- [ ] **Step 8: Publish Task 8E GREEN to the working branch**

Commit/publish the exact tested tree to `work/operations-whatsapp-inbox-live` and verify remote HEAD/tree before Task 9A begins.

---

### Task UI-4: Extend the same shell for Task 9D media, voice, location, and retry

**Files:**
- Create: `apps/operations/src/app/whatsappMediaComposer.ts`
- Test: `apps/operations/src/app/whatsappMediaComposer.test.ts`
- Modify: `apps/operations/src/app/whatsappInboxController.ts`
- Test: `apps/operations/src/app/whatsappInboxController.test.ts`
- Modify: `apps/operations/src/app/WhatsAppWorkspace.tsx`
- Test: `apps/operations/src/app/WhatsAppWorkspace.test.tsx`
- Modify: `apps/operations/src/styles/global.css`
- Modify: `apps/operations-desktop/src/main/security.ts` only where microphone/geolocation permissions require it
- Test: `apps/operations-desktop/src/main/security.test.ts`

**Interfaces:**
- Consumes: approved Task 9C `sendMedia`, `sendLocation`, `retryFailedMessage`, `getMediaAccess`, messaging target config/store location, and transient `WhatsAppMediaComposerState`.
- Produces: premium in-thread media presentation and explicit-send composer extensions without changing the two-pane hierarchy.

- [ ] **Step 1: Write media-composer RED tests**

Cover image/document/audio file selection, unsupported rejection, voice permission denied, recording stop→preview, Send/Cancel, object URL cleanup, current-location success/denial, Store Location availability, and no persistence across restart.

- [ ] **Step 2: Run RED**

```bash
npm test -- apps/operations/src/app/whatsappMediaComposer.test.ts
```

Expected: FAIL because Task 9D behavior is absent.

- [ ] **Step 3: Implement transient composer extension**

Add compact attachment `+`, voice action, preview state, Send/Cancel, Store Location, and Current Location without enlarging the composer into a permanent panel. Selected binaries and recordings remain transient until explicit Send.

- [ ] **Step 4: Implement message media presentation**

Image renders inline through short-lived media access; document shows safe filename and explicit open/download; audio uses compact native playback controls; location shows structured label/address/coordinates; expired binary renders inline `Media expired` while keeping history.

- [ ] **Step 5: Implement retry presentation**

FAILED may expose explicit Retry when server/application policy permits. PENDING/uncertain must never expose blind retry. Status must not rely on color alone.

- [ ] **Step 6: Add Electron permission RED/GREEN only where required**

Trusted TUX renderer may request audio capture and geolocation only; unrelated permissions, camera/video, subframes, and untrusted origins remain denied according to the binding security plan.

- [ ] **Step 7: Run Task 9D GREEN**

```bash
npm test -- apps/operations/src/app/whatsappMediaComposer.test.ts apps/operations/src/app/whatsappInboxController.test.ts apps/operations/src/app/WhatsAppWorkspace.test.tsx apps/operations-desktop/src/main/security.test.ts
npm run typecheck
npm run lint
npm run format:check
```

Require all PASS.

- [ ] **Step 8: Publish exact GREEN tree**

Commit/publish the tested Task 9D tree to `work/operations-whatsapp-inbox-live` and verify remote state before Task 9E.

---

### Task UI-5: Visual acceptance gate before Task 10C completion

**Files:**
- Test: `e2e/whatsapp-inbox.e2e.ts`
- Modify: existing Task 10A fake server/fixtures only as required by the approved main plan

**Interfaces:**
- Consumes: complete Task 8E + 9D worker UI.
- Produces: deterministic rendered evidence that the premium hierarchy remains operational under core flows.

- [ ] **Step 1: Add rendered acceptance assertions**

In addition to the main Task 10A functional matrix, assert the two-pane shell remains stable, selected conversation is obvious, order context does not become a permanent third pane, composer remains visible at the bottom, TEMPLATE_ONLY/BLOCKED do not hide history, and critical actions remain keyboard reachable.

- [ ] **Step 2: Run focused rendered E2E**

```bash
npx playwright test e2e/whatsapp-inbox.e2e.ts --project=desktop-browser-fallback
```

Require PASS with no `/api/whatsapp` 404.

- [ ] **Step 3: Run full rendered E2E and repository gates**

Follow Task 10C exactly. Do not claim UI completion from unit tests alone.

## Plan Self-Review

- Spec coverage: two-pane hierarchy, conversation rail, disciplined header, compact order context, message history, sticky composer, FREE_FORM/TEMPLATE_ONLY/BLOCKED, order conflict decision, internal navigation, offline inline status, premium Windows ergonomics, Arabic/English handling, accessibility, media/voice/location/retry, and rendered acceptance are all mapped to implementation tasks.
- Placeholder scan: no TBD/TODO or undefined implementation step remains.
- Type consistency: this plan intentionally reuses the existing Task 8E/9D domain/application contracts rather than inventing parallel UI-only business types.
- Scope: no TUX-MENU Web Order Bridge, production deployment, or unrelated visual-system refactor is introduced.