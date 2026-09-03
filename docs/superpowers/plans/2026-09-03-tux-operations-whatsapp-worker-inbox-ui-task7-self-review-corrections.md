# TUX Operations WhatsApp Worker Inbox UI — Task 7 Plan Self-Review Corrections

Date: 2026-09-03
Status: Binding corrections to the Task 7 implementation plan
Parent plan: `docs/superpowers/plans/2026-09-03-tux-operations-whatsapp-worker-inbox-ui-task7.md`

This file records corrections found during mandatory plan self-review. It is binding wherever it conflicts with the parent plan. No product scope is expanded.

## 1. Offline startup must still perform one cache-capable load

The parent plan incorrectly said `start()` should perform the initial `loadInbox()` only when standard network state is online.

That conflicts with the approved spec, which requires an immediate ACTIVE-shell load and permits the application layer to satisfy `loadInbox()` from local cache when the remote path is unavailable.

Binding behavior:

- `start()` always triggers exactly one initial `refresh()`, even if `environment.isOnline() === false`;
- standard network offline state still sets `networkOffline = true` so the UI can show the advisory;
- periodic 15-second polling remains paused while offline;
- visibility-triggered periodic refresh remains paused while offline;
- `online` triggers one coalesced refresh;
- `onAreaSelected()` triggers a coalesced refresh when online; when offline it triggers one refresh only if there is no successful snapshot yet, allowing a cache-capable initial/read path without turning offline state into a retry loop.

The controller MUST NOT infer provider status from the result.

Add/retain these tests:

```ts
it('attempts one initial cache-capable load even when navigator state starts offline', async () => { ... });
it('does not run periodic 15-second refreshes while offline', async () => { ... });
it('online transition triggers one coalesced refresh and never replays a send', async () => { ... });
```

## 2. Draft persistence uses an exact 250 ms scheduler contract

The parent plan left draft debounce scheduling partly open-ended. That is not binding enough for race-safe implementation.

Extend `WhatsAppInboxControllerEnvironment` with:

```ts
readonly setTimeout: (callback: () => void, delayMs: number) => unknown;
readonly clearTimeout: (handle: unknown) => void;
```

`createBrowserWhatsAppInboxEnvironment()` MUST be implemented in:

`apps/operations/src/app/whatsappInboxController.ts`

No extra environment file is authorized.

The browser environment binds:

- `window.setInterval` / `window.clearInterval`;
- `window.setTimeout` / `window.clearTimeout`;
- `document.hidden`;
- `navigator.onLine`;
- `visibilitychange`;
- `online`;
- `offline`;
- `crypto.randomUUID()` for opaque intent keys.

Draft debounce is exactly **250 ms**.

Controller fields:

```ts
#draftTimer: unknown | null = null;
#pendingDraft: {
  readonly conversationId: string;
  readonly text: string;
} | null = null;
```

`setComposerText(text)`:

1. updates UI state immediately;
2. clears the current send attempt when text no longer matches that attempt;
3. captures `{ conversationId, text }` in `#pendingDraft`;
4. cancels the previous draft timeout;
5. schedules exactly one 250 ms save for the captured conversation/text.

The timeout callback MUST save the captured `conversationId` and `text`. It MUST NOT read the controller's then-current selected conversation as draft ownership.

Before any of these transitions, flush the pending draft synchronously through the async API and await it where the public method is async:

- switching to another conversation;
- explicit `sendCurrentText()`;
- controller `stop()` uses a best-effort non-throwing flush and clears the timer.

A draft persistence error:

- sets only the safe application error message;
- does not change conversation selection;
- does not send anything;
- does not clear the composer.

Add tests:

```ts
it('debounces draft persistence to one write after 250 ms', async () => { ... });
it('captures draft ownership so a delayed save cannot write text to a newer selected conversation', async () => { ... });
it('flushes the old conversation draft before switching conversations', async () => { ... });
it('flushes the current draft before explicit send', async () => { ... });
```

## 3. Conversation-selection async results must be generation-fenced

The parent plan needs explicit protection against this race:

1. worker selects conversation A;
2. A `loadConversation/getDraft` are slow;
3. worker selects conversation B;
4. B resolves first;
5. A resolves later and overwrites B UI state.

Add a monotonic selection generation:

```ts
#selectionGeneration = 0;
```

Each `selectConversation(conversationId)` increments and captures its generation before starting async reads.

Only publish loaded messages/draft/error if both remain true when the async result completes:

```ts
generation === this.#selectionGeneration
&& this.#state.selectedConversationId === conversationId
```

Stale completion from an older selection is ignored completely.

When refresh/filter/search causes automatic selection change, it MUST go through the same generation-fenced selection path rather than manually publishing another conversation's messages/draft.

Add test:

```ts
it('ignores stale conversation A load/draft results after conversation B becomes current', async () => { ... });
```

## 4. Send completion must not clobber a newer conversation or edited composer

The send path must capture the exact attempt:

```ts
const attempt = {
  conversationId,
  text,
  outboundIntentKey,
};
```

`sendCurrentText()` calls the existing public `sendText` with exactly that captured attempt.

After the promise resolves, clear the composer/send attempt only when the current UI still represents the same unsent attempt:

```ts
this.#state.selectedConversationId === attempt.conversationId
&& this.#state.composerText === attempt.text
&& this.#sendAttempt?.outboundIntentKey === attempt.outboundIntentKey
```

If the worker changes conversation or edits text while the request is in flight:

- the remote result remains valid for the captured send;
- success still triggers one inbox refresh;
- the newer conversation/text MUST NOT be cleared or overwritten;
- failure from the stale visual context MUST NOT overwrite a newer successful interaction's composer state;
- no second send is generated automatically.

`sendBusy` is scoped to the active request, but UI state publication must not replace newer composer content.

Add tests:

```ts
it('does not clear a newer edited composer when an older send succeeds', async () => { ... });
it('does not clear conversation B composer when a conversation A send resolves later', async () => { ... });
it('preserves the same intent key for an unchanged explicit retry after failure', async () => { ... });
```

## 5. Automatic selection uses the same safe path

The parent plan says refresh/filter/search should choose the first visible conversation when the old selection is no longer visible.

Binding implementation detail:

- state recomputation decides the target conversation ID;
- if target differs from current selection, schedule/call the same `selectConversation(target)` method;
- if target is null, increment `#selectionGeneration`, clear selected messages/composer/send attempt, cancel/flush pending draft ownership safely;
- do not duplicate message/draft loading logic in refresh/filter/search code.

This keeps one selection authority path and avoids divergent races.

## 6. No additional files or scope

These corrections do not authorize extra production files.

`createBrowserWhatsAppInboxEnvironment()` lives in `whatsappInboxController.ts`.

The permanent Task 7 source-scope list in the parent plan remains binding.

No migration, package dependency, provider configuration, order-context logic, media sending, notification logic, or production deployment is authorized.

## 7. Final verification additions

Task 7 final focused evidence must explicitly report PASS/FAIL for:

- offline-start cache-capable initial load;
- 250 ms draft debounce;
- draft ownership across conversation switches;
- stale selection result fencing;
- stale send completion fencing;
- stable unchanged retry intent key;
- no automatic resend on `online`;
- no extra environment/helper source file.

All other parent-plan final gates remain binding.
