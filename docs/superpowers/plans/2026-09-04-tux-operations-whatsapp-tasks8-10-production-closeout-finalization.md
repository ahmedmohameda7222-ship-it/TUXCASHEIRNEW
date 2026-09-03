# TUX Operations WhatsApp Tasks 8–10 Plan Finalization

Date: 2026-09-04  
Status: Final binding plan authority  
Parent plan: `docs/superpowers/plans/2026-09-04-tux-operations-whatsapp-tasks8-10-production-closeout.md`  
Self-review corrections: `docs/superpowers/plans/2026-09-04-tux-operations-whatsapp-tasks8-10-production-closeout-self-review-corrections.md`  
Binding spec: `docs/superpowers/specs/2026-09-04-whatsapp-orders-media-production-closeout-design.md`  
Implementation baseline: `0684c49f3988545ea68efdfa1d0a1ce4de9e0cdc`

## Authority order

The implementer reads all four documents above. Authority order on conflict is:

1. binding design spec;
2. this finalization;
3. self-review corrections;
4. parent implementation plan.

This file closes the remaining generic/conditional wording found after the first self-review correction. It does not authorize any production mutation.

## 1. Free-form controls obey the server messaging target

The selected conversation always resolves `WhatsAppMessagingTarget` before presenting outbound controls.

### `FREE_FORM`

Enable:

- text composer;
- quick-reply insertion;
- `Send Menu`;
- image/document/audio send;
- Store Location/current-device location send.

### `TEMPLATE_ONLY`

Disable free-form text send and all free-form media/location sends. Show the server-returned approved starter templates as the only outbound actions. Keep existing draft text locally; do not discard it and do not auto-send it later.

### `BLOCKED`

Disable all outbound send actions and show the approved explanatory blocked state.

If a target was `FREE_FORM` in the UI but the server returns `FREE_FORM_WINDOW_CLOSED` because the window expired, the controller must:

1. preserve current draft/attachment state;
2. not retry automatically;
3. refresh `resolveMessagingTarget` once;
4. render the resulting `TEMPLATE_ONLY` or `BLOCKED` state.

`Send Menu` therefore never inserts a message in `TEMPLATE_ONLY`/`BLOCKED`; its button is disabled/hidden there. This supersedes any parent-plan interpretation that would create a known-doomed free-form send.

## 2. `server/whatsappServerConfig.ts` is not a conditional edit

Do **not** add media bucket or retention settings to environment config. Use exact server constants in the focused media modules:

```ts
export const WHATSAPP_MEDIA_BUCKET = 'tux-whatsapp-media';
export const WHATSAPP_MEDIA_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
```

Keep existing Meta/Supabase secrets in `server/whatsappServerConfig.ts` unchanged unless compilation requires importing its already-existing project URL/service-role values into the new modules. Do not add client-visible config.

The retention API reads `process.env.CRON_SECRET` directly, trims it, and fails closed as specified in the first correction.

## 3. The plain PostgreSQL migration harness must gain a Storage fixture

Task 9A **must** modify `scripts/test-migrations.mjs`; this is no longer conditional.

In the loopback-only reset bootstrap, after recreating `auth`, also recreate a minimal Storage schema sufficient to execute the repository migration chain:

```sql
drop schema if exists storage cascade;
create schema storage;
create table storage.buckets (
  id text primary key,
  name text not null unique,
  public boolean not null default false
);
```

The production migration inserts/updates only `id`, `name`, and `public` for `tux-whatsapp-media`, so the harness must not invent runtime Storage behavior beyond those columns.

The media migration smoke then asserts:

```sql
select id, name, public
from storage.buckets
where id = 'tux-whatsapp-media';
```

returns exactly one row and `public = false`.

## 4. Task 9B always modifies the repository and always creates the v2 materialization migration

Task 9B file list is exact:

- Modify `server/whatsappProviderGateway.ts`
- Modify `server/whatsappProviderGateway.test.ts`
- Modify `server/whatsappWebhook.ts`
- Modify `server/whatsappWebhook.test.ts`
- Modify `api/whatsapp-webhook.ts`
- Modify `server/whatsappOperationsRepository.ts`
- Modify `server/whatsappOperationsRepository.test.ts`
- Create `supabase/migrations/20260904011500_whatsapp_media_materialization.sql`
- Update `scripts/test-whatsapp-media-migration.mjs`

The repository owns invocation/parsing of the v2 materialization RPC. There is no execution-time choice about where this adapter lives.

## 5. Task 9C always creates explicit retry lineage

Supersede the first correction's conditional `20260904012000_whatsapp_media_outbound.sql` wording.

Task 9C always creates:

- `supabase/migrations/20260904012000_whatsapp_retry_lineage.sql`

It adds:

```sql
alter table public.whatsapp_messages
  add column retry_of_message_id uuid
  references public.whatsapp_messages(id) on delete restrict;
```

and creates service-role-only:

```sql
claim_tux_whatsapp_retry_intent_v1(
  p_shop_id uuid,
  p_business_day_id uuid,
  p_claimed_worker_id uuid,
  p_device_id uuid,
  p_failed_message_id uuid,
  p_outbound_intent_key text,
  p_initiated_at timestamptz
)
```

The function must:

1. resolve the same Current Operator/device authority as the existing v2 claim;
2. load the original message in the resolved shop;
3. require `direction = 'OUTBOUND'` and `status = 'FAILED'`;
4. copy the original conversation, kind, text, opaque media key/location metadata into a new `PENDING` attempt;
5. set `retry_of_message_id` to the original id;
6. use the new outbound intent key for idempotency;
7. on replay with the same intent key, return the same retry message only when every immutable copied field and authority identity matches;
8. reject `PENDING`, `SENT`, `DELIVERED`, or `READ` originals.

Binary retry reuses the existing canonical TUX media object if it is still `AVAILABLE`; if it is logically/physically expired, return a non-retriable media-expired error. It does **not** ask the renderer to re-upload the old file.

Location/text retry reconstructs content from the server-owned original message. The renderer sends only failed message id + new intent key; it does not resend trusted original content.

Add migration smoke assertions for the new column, FK, service-role-only function, same-shop fencing, FAILED-only behavior, and replay idempotency.

## 6. Existing generic outbound claim remains the canonical media/location claim

Do not invent separate normal-send media/location claim RPCs. The existing `claim_tux_whatsapp_outbound_intent_v2` already supports `TEXT`, `IMAGE`, `DOCUMENT`, `AUDIO`, and `LOCATION` with `media_ref`/`media_metadata`.

Use it for first-attempt text/media/location sends after server policy and media validation.

Use the new `claim_tux_whatsapp_retry_intent_v1` only for explicit retry of a prior definitive `FAILED` message.

Template start remains the dedicated Task 8D template claim because it may create/use a conversation by normalized phone before a normal conversation exists.

## 7. Task 10B does not modify the existing package-layering script

The existing `scripts/test-whatsapp-package-layering.mjs` recursively scans all persistence TypeScript files and already enforces `persistence -> application` separation.

Therefore Task 10B:

- does **not** modify `scripts/test-whatsapp-package-layering.mjs`;
- continues to run `npm run test:whatsapp-architecture`;
- adds the new independent `scripts/test-whatsapp-security.mjs` for the client/provider/media/authority fences.

If the existing architecture guard fails after Tasks 8–10, fix the violating source architecture; do not weaken or special-case the guard.

## 8. Electron permission wiring is exact

Task 9D modifies `apps/operations-desktop/src/main/security.ts`, its tests, and `apps/operations-desktop/src/main/index.ts`.

Create a helper that installs **both** Electron session handlers on the session used by the main Operations window:

- `session.setPermissionRequestHandler(...)`
- `session.setPermissionCheckHandler(...)`

The helper receives the trusted `WebContents` id and the trusted renderer origin/file context derived by the same main-window creation path.

Permission policy:

- `media`: allow only an audio-only request from the trusted top-level renderer; deny any request containing video.
- `geolocation`: allow only trusted top-level renderer.
- everything else: deny.

Request and check handlers use the same decision helper so one cannot grant what the other denies.

Tests cover production `file:` renderer and approved loopback development renderer, trusted main frame only, audio-only allowed, geolocation allowed, video denied, subframe denied, foreign WebContents denied, unrelated permission denied.

Do not add Chromium command-line flags that bypass permission prompts or weaken security.

## 9. Notification feed content is minimized server-side as well as OS-side

The device-authorized notification endpoint must not always return customer/message previews.

Add an exact server action such as `LOAD_NOTIFICATION_FEED` whose authority is the resolved device/shop. The repository determines whether that **same device** currently owns an active, non-ended worker session in the OPEN Business Day.

Response item has a discriminated safe shape:

```ts
export type WhatsAppNotificationFeedItem =
  | {
      readonly privacy: 'GENERIC';
      readonly messageId: string;
      readonly conversationId: string;
      readonly createdAt: string;
      readonly kind: 'TEXT' | 'IMAGE' | 'DOCUMENT' | 'AUDIO' | 'LOCATION';
    }
  | {
      readonly privacy: 'ACTIVE_OPERATOR';
      readonly messageId: string;
      readonly conversationId: string;
      readonly createdAt: string;
      readonly kind: 'TEXT' | 'IMAGE' | 'DOCUMENT' | 'AUDIO' | 'LOCATION';
      readonly preview: string | null;
      readonly customerName: string | null;
    };
```

When no active worker session exists for the resolved device/day, the server returns `GENERIC`; preview/customer fields are absent, not merely ignored by Electron.

Electron Main applies a second local-session privacy fence: if local session is not ACTIVE, it always renders generic notification even if a stale server response says `ACTIVE_OPERATOR`.

The notification endpoint never returns phone number, document filename, media caption, location label/address, provider ids, or media URLs in either variant.

## 10. E2E fake server file/globs are exact and dependency-free

Use only `e2e/whatsappFakeServer.mjs` as specified by the first correction.

Root scripts become exactly:

```json
"e2e:serve": "npm run build -w @tux/operations && node e2e/whatsappFakeServer.mjs",
"lint": "eslint \"{api,server,apps,packages,e2e}/**/*.{ts,tsx,mjs}\" playwright.config.ts --max-warnings 0"
```

and both Prettier E2E globs include `mjs`:

```text
e2e/**/*.{ts,tsx,mjs}
```

No new E2E runner dependency is added. Do not modify `package-lock.json` for Task 10A unless another task genuinely changed dependencies; if the lockfile is unchanged, omit it from the Task 10A commit.

## 11. Media provider send uses Meta media id only

For normal outbound IMAGE/DOCUMENT/AUDIO:

1. explicit Send creates a private quarantine upload URL;
2. client uploads bytes to that URL without TUX device bearer headers;
3. FINALIZE streams and validates the private object server-side;
4. valid object is moved to canonical private Storage and metadata is persisted;
5. server streams canonical bytes to Meta's media-upload endpoint for the resolved phone-number id;
6. Meta returns a provider media id;
7. server sends the WhatsApp message referencing that provider media id;
8. server stores provider ids only in privileged server-side fields and returns only the canonical TUX message shape.

Do **not** send a Supabase signed URL to Meta. Do **not** use a public bucket. Do **not** put the complete binary in `/api/whatsapp` JSON.

For explicit retry of an AVAILABLE prior binary message, steps 5–8 repeat from the already-canonical TUX object; there is no renderer re-upload.

## 12. Retention and Storage source files are exact

Task 9A modifies/creates all of:

- `packages/domain/src/whatsapp.ts`
- `packages/domain/src/index.ts`
- `packages/application/src/whatsappWire.ts`
- `packages/persistence/src/whatsappStore.ts`
- `packages/persistence/src/browser/IndexedDbWhatsAppStore.ts`
- `packages/persistence/src/sqlite/SqliteWhatsAppStore.ts`
- matching store/parser tests
- `server/whatsappMediaPolicy.ts`
- `server/whatsappMediaPolicy.test.ts`
- `server/whatsappMediaStorage.ts`
- `server/whatsappMediaStorage.test.ts`
- `server/whatsappMediaRetention.ts`
- `server/whatsappMediaRetention.test.ts`
- `api/whatsapp-media-retention.ts`
- `supabase/migrations/20260904011000_whatsapp_media_storage.sql`
- `scripts/test-whatsapp-media-migration.mjs`
- `scripts/test-migrations.mjs`
- `vercel.json`

Task 9A also switches `server/whatsappOperationsRepository.ts` + test to `get_tux_whatsapp_inbox_v2` for safe media/location projection after its migration is GREEN.

## 13. Final implementation evidence includes current-provider policy provenance

Because WhatsApp provider constraints are external and can change, final evidence must record that the implementation used the frozen policy in the final plan:

- image: JPEG/PNG, 5 MB;
- audio: AAC/AMR/MPEG/MP4/OGG-Opus, 16 MB;
- document: TXT/PDF/legacy Microsoft Office/OOXML, 100 MB.

If Meta's official provider endpoint rejects a type/limit during real-provider acceptance, production readiness remains pending and the discrepancy comes back to the planner for a new design correction. The implementer must not silently broaden or substitute media behavior.

## 14. Final no-placeholder execution rule

Words such as `if required`, `as appropriate`, or `only if` in the parent plan do not grant implementation discretion where this finalization supplies an exact rule.

In particular:

- modify `scripts/test-migrations.mjs` as specified;
- modify `server/whatsappOperationsRepository.ts` in Task 9B as specified;
- modify Electron permission policy as specified;
- do not modify `scripts/test-whatsapp-package-layering.mjs`;
- do not add a TypeScript runtime dependency for E2E;
- always create `20260904012000_whatsapp_retry_lineage.sql`;
- use the two-phase retention RPCs and daily authenticated cron;
- use Meta media upload + provider media id for binary provider send;
- enforce server-side and Electron-side generic notification privacy when no active operator exists.

The binding one-pass execution order is unchanged:

`8A → 8B → 8C → 8D → 8E → 9A → 9B → 9C → 9D → 9E → 10A → 10B → 10C`.
