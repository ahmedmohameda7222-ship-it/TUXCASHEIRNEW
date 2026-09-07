# TUX Operations WhatsApp PR #54 Closeout Authority

Status: **REPOSITORY CLOSEOUT AUTHORITY — REAL META ACCEPTANCE PENDING**

This document is a newly authorized PR #54 closeout authority.
It is not a reconstruction of the unavailable September 4 documents
and makes no claim of byte/content equivalence to them.

## A. Authority / Provenance

- Repository: `ahmedmohameda7222-ship-it/TUXCASHEIRNEW`
- Pull request: `#54`
- Branch: `work/operations-whatsapp-inbox-live`
- Pre-closeout implementation SHA: `f6c770ad55ddd489e09508c93fa55678ecfbd37b`

The following earlier referenced September 4 closeout documents could not be recovered from the available repository history, PR body, PR comments, reviews, or review comments and therefore are not being reconstructed:

- `2026-09-04-whatsapp-orders-media-production-closeout-design.md`
- `2026-09-04-whatsapp-orders-media-production-closeout.md`
- `2026-09-04-whatsapp-orders-media-production-closeout-self-review-corrections.md`
- `2026-09-04-whatsapp-orders-media-production-closeout-finalization.md`

This newly authorized document governs PR #54 repository closeout from this point forward. It resolves current governance ambiguity without rewriting or claiming recovery of unavailable historical authority.

## B. Product Scope

PR #54 owns the implemented TUX Operations WhatsApp subsystem proven by repository code and automated tests. The bound repository-side scope is:

- WhatsApp inbox;
- inbound messages;
- outbound messages;
- `FREE_FORM` customer-service-window behavior;
- template-only and blocked messaging-policy behavior;
- image;
- document/PDF;
- audio file;
- voice recording;
- current location;
- store location;
- customer context;
- active-order context;
- order link;
- order unlink;
- delivery/read status;
- `FAILED` explicit retry;
- no blind `PENDING` retry;
- offline/reconnect behavior;
- private canonical media storage;
- inbound media materialization;
- 30-day media-retention architecture;
- OS notification privacy;
- shop/tenant isolation;
- device authority; and
- current-worker authority.

This authority does not add capabilities beyond the implementation and evidence already present in PR #54.

## C. Trust Boundary

The bound trust path is:

```text
Operations renderer
        ↓
trusted Operations boundary
        ↓
server resolves shop/device/worker/channel authority
        ↓
WhatsApp application/server services
        ↓
canonical Supabase
        ↓
Meta provider
```

The renderer/browser must not become authority for:

- shop identity;
- device authority;
- worker authority;
- WhatsApp channel authority;
- Meta secrets; or
- Supabase service-role credentials.

Repository enforcement/evidence includes:

- `server/whatsappOperationsGateway.ts`, which rejects client-supplied trusted authority fields and resolves server-side authority;
- `server/operationsDeviceAuthority.ts` and `server/whatsappChannelResolver.ts`;
- `scripts/test-whatsapp-security.mjs`, which forbids Meta/service-role secrets and trusted authority request fields in renderer/desktop production source and requires `/api/whatsapp` as the request boundary; and
- `scripts/test-whatsapp-package-layering.mjs`, which protects the package-layering boundary.

## D. Phone Identity Contract

Canonical Egyptian customer identity is the local normalized form:

```text
01XXXXXXXXX
```

Example:

```text
01001234567
```

The display/international representation is distinct:

```text
+201001234567
```

Equivalent supported user/provider representations normalize to the same logical customer identity under the current domain behavior. Canonical customer/order lookup identity and display representation are separate concepts and must not be substituted for one another.

Repository evidence includes `packages/domain/src/phone.ts`, `packages/domain/src/phone.test.ts`, `packages/application/src/whatsappOrderContext.ts`, and `packages/application/src/whatsappOrderContext.phoneIdentity.regression.test.ts`.

## E. Retry Contract

The repository binds retry behavior as follows:

```text
Definitive provider failure
→ FAILED
→ explicit Retry may create a new linked attempt

PENDING / uncertain provider state
→ no blind automatic retry
→ no unsafe automatic duplicate send
```

Retry lineage is persisted by `supabase/migrations/20260904012000_whatsapp_retry_lineage.sql`. Existing `PENDING` state is uncertainty, not permission to replay a provider send.

## F. Media Contract

The frozen provider/media policy implemented in `server/whatsappMediaPolicy.ts` is:

- image: JPEG/PNG, maximum 5 MB;
- audio: AAC/AMR/MPEG/MP4/OGG-Opus, maximum 16 MB; and
- documents: supported TXT/PDF/legacy Microsoft Office/OOXML types, maximum 100 MB.

The canonical storage contract is:

- private canonical storage in bucket `tux-whatsapp-media`;
- no permanent public media URL;
- tenant/device authorization controls media access;
- provider CDN media is not permanent history authority;
- binary retention is exactly 30 days; and
- message/history metadata remains after binary expiry/deletion.

Repository evidence includes `server/whatsappMediaStorage.ts`, `server/whatsappMediaRetention.ts`, `supabase/migrations/20260904011000_whatsapp_media_storage.sql`, `supabase/migrations/20260904011500_whatsapp_media_materialization.sql`, and `supabase/migrations/20260904012000_whatsapp_retry_lineage.sql`.

## G. Order Context Contract

WhatsApp customer/order context may:

- resolve customer identity;
- find eligible active delivery order(s);
- link a conversation to an eligible order; and
- unlink that association,

while preserving shop scoping and server-resolved worker/device authority.

Repository evidence includes `packages/application/src/whatsappOrderContext.ts`, `server/whatsappOperationsRepository.ts`, `server/whatsappOperationsGateway.ts`, and `supabase/migrations/20260902220000_whatsapp_inbox.sql`.

```text
Menu → Online Order → Operations
is a separate later integration phase.
```

PR #54 does not claim customer Menu online-order intake.

## H. Verification Authority

The accepted pre-closeout implementation authority was verified by both direct branch-head CI and PR integration CI:

```text
Raw branch CI:
TUX V2 CI
Run #2832
Run ID 34168897951
SHA f6c770ad55ddd489e09508c93fa55678ecfbd37b
SUCCESS

PR integration CI:
TUX V2 CI
Run #2833
Run ID 34168900699
SHA f6c770ad55ddd489e09508c93fa55678ecfbd37b
SUCCESS
```

At that implementation SHA, the permanent verification set was green for:

- format;
- lint;
- unit/integration tests;
- WhatsApp architecture;
- WhatsApp security;
- typecheck;
- production builds;
- migration-chain smoke;
- rendered browser E2E;
- edge-security;
- Windows packaging; and
- Required quality gate.

A later documentation-only closeout commit must receive its own fresh exact-head branch and PR CI before repository closeout is final.

## I. Real Provider Status

```text
Repository implementation:
AUTOMATED-CLOSEOUT VERIFIED

Real Meta acceptance:
PENDING
```

This document does not classify the subsystem as production ready, real-provider accepted, or fully production verified. Those classifications remain prohibited until the live 22-check Meta/WhatsApp acceptance pass in `docs/WHATSAPP_PRODUCTION_ACCEPTANCE.md` is explicitly executed and passes under separate controller authorization.
