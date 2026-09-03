# TUX Operations WhatsApp Tasks 8–10 Plan Self-Review Corrections

Date: 2026-09-04  
Status: Binding execution correction  
Parent plan: `docs/superpowers/plans/2026-09-04-tux-operations-whatsapp-tasks8-10-production-closeout.md`  
Binding spec: `docs/superpowers/specs/2026-09-04-whatsapp-orders-media-production-closeout-design.md`  
Implementation baseline: `0684c49f3988545ea68efdfa1d0a1ce4de9e0cdc`

## Authority

This document is the final self-review correction authority for the parent Tasks 8–10 implementation plan. Read both documents before execution. Where this correction conflicts with the parent plan, this correction wins. All parent-plan requirements not changed here remain binding.

The corrections remove execution-time ambiguity found during plan self-review. They do not expand scope beyond the approved Tasks 8–10 design and do not authorize production mutations.

## 1. Reuse the existing link/unlink API instead of inventing another unlink method

At the implementation baseline, the existing WhatsApp `linkOrder` path already carries `linked?: boolean` through platform contract, IPC, and server gateway. Therefore:

- `linked: true` means link/reactivate the requested conversation/order relationship.
- `linked: false` means explicit unlink.
- Do **not** add a second `unlinkOrder` platform method solely for Task 8.
- Extend the backend/RPC only if the existing authorized link RPC cannot correctly persist the `linked:false` transition; keep the renderer-facing method `linkOrder` either way.

Task 8 UI calls:

```ts
await client.linkOrder({ conversationId, orderId, linked: true });
await client.linkOrder({ conversationId, orderId, linked: false });
```

Both operations remain contextual metadata only and must not mutate order lifecycle/payment state.

## 2. Final `TuxWhatsAppApi` composition is explicit

Do not make the platform contract another large concrete service class. Keep the existing methods and compose the two focused application capabilities:

```ts
export type TuxWhatsAppApi = Pick<
  OperationsWhatsAppService,
  | 'loadInbox'
  | 'loadConversation'
  | 'sendText'
  | 'markUnread'
  | 'archive'
  | 'setFollowUp'
  | 'linkOrder'
  | 'saveDraft'
  | 'getDraft'
> &
  Pick<OperationsWhatsAppOrderContextService, 'resolveCustomerOrderContext'> &
  Pick<
    OperationsWhatsAppMessagingService,
    | 'resolveMessagingTarget'
    | 'sendTemplate'
    | 'sendMedia'
    | 'sendLocation'
    | 'retryFailedMessage'
    | 'getMediaAccess'
  >;
```

Browser and Electron expose this same semantic surface. If TypeScript declaration-file import constraints require interface expansion instead of this literal alias, method names and signatures remain exactly equivalent.

## 3. Safe message content shape for binary media and location is explicit

Task 9A must extend the domain message with safe, durable presentation metadata. Provider ids, Storage object paths, and signed URLs are not part of this shape.

Define before `WhatsAppMessage`:

```ts
export interface WhatsAppMediaDescriptor {
  readonly mediaKey: string;
  readonly kind: 'IMAGE' | 'DOCUMENT' | 'AUDIO';
  readonly mimeType: string;
  readonly fileName: string | null;
  readonly byteSize: number;
  readonly storedAt: Instant;
  readonly expiresAt: Instant;
  readonly availability: 'AVAILABLE' | 'EXPIRED';
}

export interface WhatsAppLocationPayload {
  readonly latitude: number;
  readonly longitude: number;
  readonly name: string | null;
  readonly address: string | null;
}
```

Extend `WhatsAppMessage` with:

```ts
readonly media: WhatsAppMediaDescriptor | null;
readonly location: WhatsAppLocationPayload | null;
```

Keep `mediaRef` only as the opaque TUX `mediaKey` for binary media. Enforce these invariants in parser/tests:

- `TEXT`: non-empty `text`; `mediaRef`, `media`, `location` are null.
- `IMAGE | DOCUMENT | AUDIO`: `media` is non-null; `mediaRef === media.mediaKey`; `location` is null.
- `LOCATION`: `location` is non-null; `mediaRef` and `media` are null.
- `SYSTEM`: non-empty `text`; `mediaRef`, `media`, `location` are null.

Local SQLite/IndexedDB WhatsApp caches persist these safe descriptors/location values only. They never persist signed access URLs, Meta media ids, Supabase object paths, or provider download URLs.

## 4. Add a safe inbox RPC version instead of leaking server media metadata

Task 9A adds service-role-only:

```sql
get_tux_whatsapp_inbox_v2(p_shop_id uuid, p_cursor text default null)
```

It becomes the repository read path after Task 9A. It returns the same inbox semantics as v1 plus the safe `media` and `location` fields required by the domain shape above.

For binary messages, the RPC may join `whatsapp_media_objects` but its returned JSON must omit:

- `provider_media_id`
- `bucket_id`
- `object_path`
- raw Storage metadata
- any signed URL

For location messages it returns only validated latitude, longitude, optional name, and optional address derived from the existing message metadata.

`availability` is computed as `EXPIRED` when `deleted_at is not null` or `expires_at <= now()`, otherwise `AVAILABLE`.

Keep `get_tux_whatsapp_inbox_v1` unchanged for migration immutability; switch server repository code to v2 only after the v2 migration test is GREEN.

## 5. Media types and limits are frozen for this plan

The parent plan's image `image/webp` allowance is superseded. For WhatsApp Cloud API media messages in this scope, use these exact limits and MIME types:

```ts
export const WHATSAPP_MEDIA_LIMITS = {
  IMAGE: 5 * 1024 * 1024,
  AUDIO: 16 * 1024 * 1024,
  DOCUMENT: 100 * 1024 * 1024,
} as const;

export const WHATSAPP_MEDIA_MIME_TYPES = {
  IMAGE: ['image/jpeg', 'image/png'],
  AUDIO: ['audio/aac', 'audio/amr', 'audio/mpeg', 'audio/mp4', 'audio/ogg'],
  DOCUMENT: [
    'text/plain',
    'application/pdf',
    'application/msword',
    'application/vnd.ms-excel',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  ],
} as const;
```

`image/webp` is sticker media, not an image-message MIME in this scope, so reject it.

For `audio/ogg`, accept only OGG/Opus. The validator must inspect the OGG container sufficiently to establish Opus (`OpusHead`) rather than accepting arbitrary OGG/Vorbis from the MIME string alone.

Magic/content validation requirements:

- JPEG: validate JPEG signature.
- PNG: validate PNG signature.
- PDF: validate `%PDF-` signature.
- OGG audio: Ogg container plus Opus header.
- OOXML: ZIP container plus the relevant Office content-type/package entries.
- legacy Office formats: validate Compound File Binary signature before accepting the declared Word/Excel/PowerPoint MIME.
- `text/plain`: reject binary/NUL-heavy payloads using a bounded text validation pass.

Tests must lock exact byte-boundary behavior: `limit` accepted, `limit + 1` rejected.

These values were verified during plan self-review against the Meta WhatsApp Business Platform media reference available on 2026-09-04; implementation may re-check documentation, but it must not silently broaden this frozen allowlist or exceed these limits.

## 6. Inbound and outbound binary processing is streaming and bounded

Do not load a 100 MB document fully into a Node `Buffer`, application state, or renderer JSON payload.

### Inbound

For IMAGE/DOCUMENT/AUDIO webhook events:

1. Fetch Meta media metadata server-side.
2. Open the provider download response as a stream.
3. Read only the bounded prefix/container material required for validation while streaming the complete payload through SHA-256 computation into private Supabase Storage.
4. If validation fails, delete the temporary object and do not materialize a client-visible media message.
5. If validation succeeds, finalize the canonical private object and materialize message + media metadata idempotently.

The webhook/API implementation may spool to bounded server temporary storage if required by the runtime/library, but it must not serialize the complete binary into JSON/base64.

### Outbound

The explicit-send upload flow uses a private quarantine object:

```text
CREATE_MEDIA_UPLOAD
  → signed upload to quarantine/<shopId>/<mediaKey>
  → FINALIZE_MEDIA_SEND
  → server streams quarantine object and validates/hash-checks it
  → move/copy to media/<shopId>/<mediaKey>
  → upload canonical bytes to Meta /{phone-number-id}/media
  → Meta returns provider media id
  → send WhatsApp message referencing that Meta media id
  → attach provider message id
  → remove quarantine object
```

`mediaKey` remains deterministic from the server-resolved shop and outbound intent key. The renderer never chooses the final object path.

The Meta provider gateway therefore gains an exact server-only operation equivalent to:

```ts
uploadMedia(input: {
  readonly providerPhoneNumberId: string;
  readonly kind: 'IMAGE' | 'DOCUMENT' | 'AUDIO';
  readonly mimeType: string;
  readonly fileName: string | null;
  readonly body: ReadableStream<Uint8Array> | NodeJS.ReadableStream;
}): Promise<{ readonly providerMediaId: string }>;
```

and `sendMessage` for binary media references that provider media id. Do not give Meta a Supabase signed download URL and do not expose the Meta media id to the renderer.

## 7. Retention cleanup uses an exact two-phase server protocol and a Vercel cron

Replace the parent plan's mark-before-delete `expire_tux_whatsapp_media_v1` concept with two service-role-only RPCs:

```sql
list_tux_whatsapp_expired_media_v1(
  p_now timestamptz,
  p_limit integer
)
-- returns media_key, bucket_id, object_path for rows with
-- deleted_at is null and expires_at <= p_now in deterministic order

mark_tux_whatsapp_media_deleted_v1(
  p_media_key text,
  p_deleted_at timestamptz
)
-- idempotently sets deleted_at after successful/confirmed-absent object deletion
```

The server cleanup algorithm is:

1. request a batch of at most 100 expired rows;
2. delete each private Storage object;
3. Storage `not found` is treated as already deleted;
4. only after delete/confirmed-absent, call `mark_tux_whatsapp_media_deleted_v1`;
5. a delete failure leaves `deleted_at` null so the next run retries it;
6. never delete the `whatsapp_messages` row.

Add these exact files in Task 9A:

- Create `server/whatsappMediaRetention.ts`
- Create `server/whatsappMediaRetention.test.ts`
- Create `api/whatsapp-media-retention.ts`
- Modify `vercel.json`

The Vercel function accepts `GET` only. Authentication is fail-closed:

- if `CRON_SECRET` is absent/blank in server environment: return 503 and perform no cleanup;
- if `Authorization !== Bearer <CRON_SECRET>`: return 401 and perform no cleanup;
- otherwise run one bounded batch and return counts only, never object paths or message/customer data.

Add exactly this repository schedule to the existing `vercel.json`:

```json
"crons": [
  {
    "path": "/api/whatsapp-media-retention",
    "schedule": "17 3 * * *"
  }
]
```

This is one daily production invocation and remains valid on Vercel Hobby/Pro/Enterprise scheduling limits. No production deployment or environment mutation is authorized by this plan. `CRON_SECRET` configuration is a production acceptance prerequisite and must be listed as pending until configured and verified.

Task 9A focused tests must include:

```bash
npm test -- server/whatsappMediaPolicy.test.ts server/whatsappMediaStorage.test.ts server/whatsappMediaRetention.test.ts
```

Task 10 security checks must assert the retention endpoint fails closed when `CRON_SECRET` is missing.

## 8. Direct voice/current-location Electron permissions are mandatory, scoped, and tested

Remove the parent plan's conditional wording about whether Electron permission handling is needed. Task 9D **must** add a focused permission policy in `apps/operations-desktop/src/main/security.ts` and wire it in Electron Main.

Permit only from the trusted main TUX renderer WebContents/origin:

- audio capture for the `media` permission when the request is audio-only;
- `geolocation` for Share Current Location.

Deny:

- video/camera capture;
- MIDI, HID, serial, USB, notifications-from-renderer, clipboard-read, openExternal-style permissions, or any unrelated permission;
- any request from a subframe or untrusted origin/WebContents.

Configure both Electron permission request and permission check handlers consistently where Electron exposes both paths. Tests must prove allowed audio-only/geolocation and denied video/untrusted/unrelated requests while preserving `contextIsolation:true`, `nodeIntegration:false`, `sandbox:true`, `webSecurity:true`, and `webviewTag:false`.

Windows notifications continue to originate from Electron Main; renderer notification permission is not required.

## 9. E2E API harness uses Node core JavaScript; no new runner dependency

Supersede every parent-plan reference to `e2e/whatsappFakeServer.ts`, `node --import tsx`, or an undecided runner.

Create exactly:

- `e2e/whatsappFakeServer.mjs`

Implement it with Node core modules (`node:http`, `node:fs`, `node:path`, `node:url`, `node:crypto`) only. It serves `apps/operations/dist` with SPA fallback and the contract-faithful fake API/upload routes.

Set the root script exactly to:

```json
"e2e:serve": "npm run build -w @tux/operations && node e2e/whatsappFakeServer.mjs"
```

No `tsx` dependency is added.

Extend formatting/lint globs so the test server is covered:

```json
"lint": "eslint \"{api,server,apps,packages,e2e}/**/*.{ts,tsx,mjs}\" playwright.config.ts --max-warnings 0"
```

and change both `format` and `format:check` E2E globs from `e2e/**/*.{ts,tsx}` to `e2e/**/*.{ts,tsx,mjs}`.

Task 10A file list and commit command use `e2e/whatsappFakeServer.mjs`, not `.ts`.

## 10. Inbound v2 materialization and retry migrations are append-only

Task 9A commits `20260904011000_whatsapp_media_storage.sql`. After that commit, Task 9B must create exactly:

- `supabase/migrations/20260904011500_whatsapp_media_materialization.sql`

This migration provides the v2 inbound materialization RPC that atomically associates an already-validated canonical `mediaKey` with the deduplicated inbound message/media metadata. It leaves v1 untouched.

If Task 9C requires database support for retry lineage or finalized outbound media claims that cannot be represented by the committed 9A/9B schema, create exactly:

- `supabase/migrations/20260904012000_whatsapp_media_outbound.sql`

Do not modify either previously committed migration.

Migration tests must add every new file to the immutability/source chain and verify service-role-only execution.

## 11. Binary media availability must not depend on the cleanup cron having already run

The server/API computes user-visible availability from time as well as deletion state:

```text
EXPIRED when deleted_at != null OR expires_at <= serverNow
AVAILABLE otherwise
```

Therefore a message becomes inaccessible immediately at the 30-day boundary even if the daily cleanup cron has not physically deleted the object yet. `getMediaAccess` must refuse to sign/read an expired object based on server time.

This closes the interval between logical expiration and physical cleanup.

## 12. Add explicit production acceptance prerequisites introduced by these corrections

`docs/WHATSAPP_PRODUCTION_ACCEPTANCE.md` must include these prerequisites before the 22 behavioral checks:

- private bucket `tux-whatsapp-media` exists from the applied migration and remains non-public;
- `CRON_SECRET` is configured as a server-only Vercel environment variable;
- Vercel shows `/api/whatsapp-media-retention` scheduled once daily from repository `vercel.json`;
- at least one active `whatsapp_shop_messaging_config` row has the canonical HTTPS storefront URL;
- Store Location latitude/longitude are configured if `Send Store Location` is expected to be available;
- approved starter template records correspond to templates that Meta reports as approved for the resolved WhatsApp channel;
- real Meta credentials remain server-only and are never pasted into the checklist.

Production readiness remains withheld until those prerequisites and real-provider checks pass.

## 13. Self-review completion result

After applying this correction authority, execution has no open implementation-choice placeholders for:

- unlink API shape;
- `TuxWhatsAppApi` composition;
- safe binary/location message fields;
- inbox media metadata projection;
- MIME allowlist/size limits;
- outbound provider media strategy;
- retention deletion ordering;
- retention scheduling/authentication;
- Electron microphone/geolocation permissions;
- E2E server runtime;
- append-only follow-up migration names.

The one-pass cadence remains exactly:

`8A → 8B → 8C → 8D → 8E → 9A → 9B → 9C → 9D → 9E → 10A → 10B → 10C`

with strict RED → verified failure → minimal GREEN → focused verification → commit/checkpoint, and no reviewer STOP until the complete Tasks 8–10 evidence packet is ready.