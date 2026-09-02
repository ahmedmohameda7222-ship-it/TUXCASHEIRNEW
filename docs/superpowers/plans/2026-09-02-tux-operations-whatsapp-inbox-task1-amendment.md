# TUX Operations WhatsApp Inbox Task 1 Amendment

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans for Classic ChatGPT execution. This amendment supersedes **only Task 1** of `docs/superpowers/plans/2026-09-02-tux-operations-whatsapp-inbox.md`. After this amended Task 1 passes and is committed, resume the original plan at Task 2 without changing its order.

**Goal:** Add the WhatsApp domain model while preserving and consuming the repository's existing shared Egyptian phone-normalization contract.

**Architecture:** The existing `normalizeEgyptianPhone(raw): EgyptianPhoneNormalization` API remains authoritative across Orders, WhatsApp, and the Web Order Bridge. TUX customer matching uses the existing canonical local `normalizedPhone` (`01...`); UI may use `displayPhone` (`+20...`); Meta-specific recipient formatting stays at the provider gateway boundary.

**Tech Stack:** TypeScript 6, Vitest 4, existing `@tux/domain` package.

**Spec:** `docs/superpowers/specs/2026-09-02-tux-operations-whatsapp-inbox-design.md`

**Binding correction:** `docs/superpowers/specs/2026-09-02-whatsapp-phone-normalization-decision.md`

## Global Constraints

- Do not modify the signature or semantics of `normalizeEgyptianPhone` for this feature.
- Do not replace `packages/domain/src/phone.ts` or `packages/domain/src/phone.test.ts`.
- Existing valid equivalent Egyptian forms must continue resolving to one canonical local identity key.
- `normalizedPhone` is the TUX customer-match key; `displayPhone` is the international display form.
- Invalid provider/customer phone inputs must not silently create a customer identity.
- No AI, NLP, chatbot, or free-text order extraction.
- This amendment changes Task 1 only. Tasks 2-10 remain governed by the original WhatsApp Inbox plan.

---

### Amended Task 1: Add WhatsApp domain types while reusing shared Egyptian phone normalization

**Files:**
- Read-only baseline: `packages/domain/src/phone.ts`
- Read-only baseline: `packages/domain/src/phone.test.ts`
- Create: `packages/domain/src/whatsapp.ts`
- Create: `packages/domain/src/whatsapp.test.ts`
- Modify: `packages/domain/src/index.ts`

**Interfaces consumed:**

```ts
export interface EgyptianPhoneNormalization {
  readonly normalizedPhone: string;
  readonly displayPhone: string;
  readonly valid: boolean;
}

export function normalizeEgyptianPhone(raw: string): EgyptianPhoneNormalization;
```

**Interfaces produced:**

```ts
export type WhatsAppMessageStatus = 'PENDING' | 'SENT' | 'DELIVERED' | 'READ' | 'FAILED';
export type WhatsAppMessageDirection = 'INBOUND' | 'OUTBOUND';
export type WhatsAppMessageKind = 'TEXT' | 'IMAGE' | 'DOCUMENT' | 'AUDIO' | 'LOCATION' | 'SYSTEM';
export type WhatsAppConversationContext = 'DIRECT' | 'WEB_REQUEST' | 'ORDER_LINKED';

export interface WhatsAppConversation;
export interface WhatsAppMessage;
export interface WhatsAppQuickReply;
export function assertWhatsAppMessageInvariant(message: WhatsAppMessage): void;
```

Later WhatsApp/customer matching must call `normalizeEgyptianPhone(raw)` and use `result.normalizedPhone` only when `result.valid === true`.

- [ ] **Step 1: Verify the existing shared phone contract is green before feature work**

Run:

```bash
npm test -- packages/domain/src/phone.test.ts
```

Expected: PASS. This is a baseline guard, not the feature RED. If it fails on a clean checkout, STOP because the repository baseline is not healthy.

Also inspect `git status --short` and confirm `packages/domain/src/phone.ts` and `packages/domain/src/phone.test.ts` are unmodified.

- [ ] **Step 2: Write the failing WhatsApp-domain tests**

Create `packages/domain/src/whatsapp.test.ts` with the following tests:

```ts
import { describe, expect, it } from 'vitest';
import { normalizeEgyptianPhone } from './phone';
import {
  assertWhatsAppMessageInvariant,
  type WhatsAppMessage,
} from './whatsapp';

const validOutbound: WhatsAppMessage = {
  id: 'message-1',
  shopId: '11111111-1111-4111-8111-111111111111' as WhatsAppMessage['shopId'],
  conversationId: 'conversation-1',
  providerMessageId: null,
  outboundIntentKey: 'whatsapp-send:conversation-1:intent-1',
  direction: 'OUTBOUND',
  kind: 'TEXT',
  text: 'تمام، أوردر حضرتك بيتجهز دلوقتي.',
  mediaRef: null,
  status: 'PENDING',
  sentByWorkerId: '22222222-2222-4222-8222-222222222222' as NonNullable<
    WhatsAppMessage['sentByWorkerId']
  >,
  initiatedByDeviceId: '33333333-3333-4333-8333-333333333333' as NonNullable<
    WhatsAppMessage['initiatedByDeviceId']
  >,
  initiatedAt: '2026-09-02T19:00:00.000Z' as NonNullable<WhatsAppMessage['initiatedAt']>,
  createdAt: '2026-09-02T19:00:00.000Z' as WhatsAppMessage['createdAt'],
};

describe('WhatsApp message invariants', () => {
  it('accepts an attributed outbound intent', () => {
    expect(() => assertWhatsAppMessageInvariant(validOutbound)).not.toThrow();
  });

  it('rejects an outbound message without a durable intent key', () => {
    expect(() =>
      assertWhatsAppMessageInvariant({ ...validOutbound, outboundIntentKey: null }),
    ).toThrow('Outbound WhatsApp messages require a durable intent key.');
  });

  it('rejects outbound messages without current-worker attribution', () => {
    expect(() =>
      assertWhatsAppMessageInvariant({ ...validOutbound, sentByWorkerId: null }),
    ).toThrow('Outbound WhatsApp messages require worker, device, and initiation attribution.');
  });

  it('rejects inbound messages carrying outbound attribution', () => {
    expect(() =>
      assertWhatsAppMessageInvariant({
        ...validOutbound,
        direction: 'INBOUND',
        outboundIntentKey: null,
      }),
    ).toThrow('Inbound WhatsApp messages cannot carry outbound attribution.');
  });
});

describe('WhatsApp customer identity uses the shared Egyptian phone contract', () => {
  it.each([
    '01012345678',
    '+201012345678',
    '00201012345678',
    '201012345678',
    '1012345678',
  ])('maps %s to the same TUX customer key', (raw) => {
    const result = normalizeEgyptianPhone(raw);
    expect(result).toEqual({
      normalizedPhone: '01012345678',
      displayPhone: '+201012345678',
      valid: true,
    });
  });

  it('does not permit an unsupported international number to become a TUX customer key', () => {
    const result = normalizeEgyptianPhone('+491701234567');
    expect(result.valid).toBe(false);
  });
});
```

- [ ] **Step 3: Run the honest RED**

Run:

```bash
npm test -- packages/domain/src/whatsapp.test.ts
```

Expected: FAIL because `packages/domain/src/whatsapp.ts` does not exist. The existing phone module must remain green and unchanged.

- [ ] **Step 4: Implement the minimal WhatsApp domain model**

Create `packages/domain/src/whatsapp.ts`:

```ts
import { DomainInvariantError } from './errors';
import type { DeviceId, OrderId, ShopId, WorkerId } from './ids';
import type { Instant } from './time';

export type WhatsAppMessageStatus = 'PENDING' | 'SENT' | 'DELIVERED' | 'READ' | 'FAILED';
export type WhatsAppMessageDirection = 'INBOUND' | 'OUTBOUND';
export type WhatsAppMessageKind =
  | 'TEXT'
  | 'IMAGE'
  | 'DOCUMENT'
  | 'AUDIO'
  | 'LOCATION'
  | 'SYSTEM';
export type WhatsAppConversationContext = 'DIRECT' | 'WEB_REQUEST' | 'ORDER_LINKED';

export interface WhatsAppConversation {
  readonly id: string;
  readonly shopId: ShopId;
  readonly normalizedPhone: string;
  readonly displayPhone: string;
  readonly customerName: string | null;
  readonly context: WhatsAppConversationContext;
  readonly linkedOrderId: OrderId | null;
  readonly unreadCount: number;
  readonly archived: boolean;
  readonly followUp: boolean;
  readonly lastMessageAt: Instant | null;
}

export interface WhatsAppMessage {
  readonly id: string;
  readonly shopId: ShopId;
  readonly conversationId: string;
  readonly providerMessageId: string | null;
  readonly outboundIntentKey: string | null;
  readonly direction: WhatsAppMessageDirection;
  readonly kind: WhatsAppMessageKind;
  readonly text: string | null;
  readonly mediaRef: string | null;
  readonly status: WhatsAppMessageStatus;
  readonly sentByWorkerId: WorkerId | null;
  readonly initiatedByDeviceId: DeviceId | null;
  readonly initiatedAt: Instant | null;
  readonly createdAt: Instant;
}

export type WhatsAppQuickReplyCategory =
  | 'PREPARATION'
  | 'DELIVERY'
  | 'ADDRESS'
  | 'PAYMENT'
  | 'DELAY'
  | 'THANKS';

export interface WhatsAppQuickReply {
  readonly id: string;
  readonly shopId: ShopId;
  readonly category: WhatsAppQuickReplyCategory;
  readonly language: 'ar-EG' | 'en';
  readonly text: string;
  readonly usageCount: number;
  readonly active: boolean;
}

export function assertWhatsAppMessageInvariant(message: WhatsAppMessage): void {
  if (message.direction === 'INBOUND') {
    if (
      message.outboundIntentKey !== null ||
      message.sentByWorkerId !== null ||
      message.initiatedByDeviceId !== null ||
      message.initiatedAt !== null
    ) {
      throw new DomainInvariantError('Inbound WhatsApp messages cannot carry outbound attribution.');
    }
    return;
  }

  if (message.outboundIntentKey === null || message.outboundIntentKey.trim().length === 0) {
    throw new DomainInvariantError('Outbound WhatsApp messages require a durable intent key.');
  }

  if (
    message.sentByWorkerId === null ||
    message.initiatedByDeviceId === null ||
    message.initiatedAt === null
  ) {
    throw new DomainInvariantError(
      'Outbound WhatsApp messages require worker, device, and initiation attribution.',
    );
  }
}
```

Do not add a second phone-normalization implementation to this file.

- [ ] **Step 5: Export the WhatsApp domain surface without changing the phone export**

Modify `packages/domain/src/index.ts` by adding:

```ts
export {
  assertWhatsAppMessageInvariant,
  type WhatsAppConversation,
  type WhatsAppConversationContext,
  type WhatsAppMessage,
  type WhatsAppMessageDirection,
  type WhatsAppMessageKind,
  type WhatsAppMessageStatus,
  type WhatsAppQuickReply,
  type WhatsAppQuickReplyCategory,
} from './whatsapp';
```

Leave the existing export unchanged:

```ts
export { normalizeEgyptianPhone, type EgyptianPhoneNormalization } from './phone';
```

- [ ] **Step 6: Run GREEN and compatibility gates**

Run:

```bash
npm test -- packages/domain/src/whatsapp.test.ts packages/domain/src/phone.test.ts
```

Expected: PASS.

Run:

```bash
npm run typecheck -w @tux/domain
```

Expected: PASS.

Run:

```bash
git diff -- packages/domain/src/phone.ts packages/domain/src/phone.test.ts
```

Expected: no output. If either established phone file changed, revert those changes before proceeding.

- [ ] **Step 7: Commit only the amended Task 1 scope**

```bash
git add packages/domain/src/whatsapp.ts packages/domain/src/whatsapp.test.ts packages/domain/src/index.ts
git commit -m "feat: add WhatsApp domain model"
```

Then verify:

```bash
git status --short
git show --stat --oneline HEAD
```

Expected: no unintended phone-contract changes.

## Task 1 Acceptance Gate

Task 1 is complete only when all of the following are true:

- existing `phone.test.ts` remains green unchanged;
- new `whatsapp.test.ts` shows a real RED before `whatsapp.ts` exists and GREEN after implementation;
- WhatsApp types are exported from `@tux/domain`;
- inbound/outbound attribution invariants are runtime-tested;
- provider-form Egyptian numbers resolve through the existing shared normalizer to the same canonical TUX customer key;
- no duplicate normalization function exists;
- no production deployment or secret use occurred.

After this gate passes and the Task 1 commit exists, continue with **Task 2** in `docs/superpowers/plans/2026-09-02-tux-operations-whatsapp-inbox.md`.

## Self-Review Result

- Spec coverage repaired: Egyptian phone matching remains shared across Orders and WhatsApp; current-worker/device attribution is represented in the WhatsApp message model.
- Placeholder scan: no `TBD`, `TODO`, or undefined implementation instruction remains in this amendment.
- Type consistency: the amendment consumes the repository's actual `EgyptianPhoneNormalization` contract and does not redefine `normalizeEgyptianPhone`.
- TDD integrity: RED now comes from the genuinely missing `whatsapp.ts`, not from pretending the already-existing phone module is absent.
