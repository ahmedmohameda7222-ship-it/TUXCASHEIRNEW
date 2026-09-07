# TUX Operations WhatsApp Production Acceptance

Status: **PENDING REAL META ACCEPTANCE**

Repository-side PR #54 governance authority: `docs/superpowers/specs/2026-09-08-whatsapp-pr54-closeout-authority.md`.

This runbook is the production-acceptance authority for the implemented TUX Operations WhatsApp subsystem after repository CI is GREEN. Fake-provider tests, migration smoke, rendered E2E, and package/security gates are necessary but are not sufficient to classify the subsystem as production-ready. A real Meta Business Platform acceptance pass is required.

Do not record access tokens, app secrets, Supabase service-role keys, worker PINs, real customer phone numbers, template secrets, signed media URLs, provider media IDs, or other credentials in this document or its evidence.

## Preconditions

Before starting the real-provider pass, verify all of the following:

- A Meta test business phone number/channel is configured for the intended TUX shop.
- Server-side Meta/Supabase configuration is present in the production server environment and absent from renderer/browser/client bundles.
- The canonical HTTPS storefront URL and canonical store location configuration are present for the shop.
- The private Supabase Storage bucket `tux-whatsapp-media` exists and is not public.
- The required WhatsApp migration chain has been applied through `20260904012000_whatsapp_retry_lineage.sql`, including:
  - `20260904010000_whatsapp_messaging_policy.sql`
  - `20260904011000_whatsapp_media_storage.sql`
  - `20260904011500_whatsapp_media_materialization.sql`
  - `20260904012000_whatsapp_retry_lineage.sql`
- Webhook/channel configuration is installed for the same resolved shop/channel authority used by the TUX server.
- A real browser and/or approved Windows Operations runtime is available for media, microphone, geolocation, offline/reconnect, and OS-notification checks.
- The build under test is identified by an exact repository SHA.
- Current-provider policy provenance for this implementation remains:
  - image: JPEG/PNG, maximum 5 MB;
  - audio: AAC/AMR/MPEG/MP4/OGG-Opus, maximum 16 MB;
  - document: TXT/PDF/legacy Microsoft Office/OOXML, maximum 100 MB.

If Meta rejects any frozen supported type/limit during this pass, keep production readiness pending and return the discrepancy for a new design correction. Do not silently broaden, substitute, or weaken provider/media policy.

## Evidence record

Record the following for each acceptance session without including secrets or customer-sensitive data:

- Date/time:
- Tester:
- Build SHA:
- Environment:
- Meta test-number alias (non-secret label only):
- Browser / Windows build and OS:
- Shop alias:
- Result: PASS / FAIL / BLOCKED
- Evidence reference: screenshot/video/log artifact identifier with secrets redacted
- Notes / observed discrepancy:

## Mandatory real-provider checks

Every item below must be explicitly executed and recorded.

1. **Meta webhook verification succeeds.** Complete the real provider webhook verification flow against the deployed TUX endpoint.

2. **Real inbound text appears exactly once in the intended shop.** Send a real inbound text through Meta and verify one canonical TUX message, correct shop scoping, and no duplicate materialization.

3. **Real outbound free-form text succeeds inside the open 24-hour customer-service window.** Verify the server-authorized `FREE_FORM` path and provider delivery.

4. **Outside the free-form window, template behavior is deterministic.** If an approved configured starter template exists, verify the template-only path works. If no approved template exists, verify server and UI reject outbound messaging deterministically rather than attempting a doomed free-form send.

5. **Image send works.** Send an allowed real image through the private-media flow and verify provider delivery plus canonical TUX history.

6. **Document send works.** Send an allowed real document/PDF through the private-media flow and verify provider delivery plus canonical TUX history.

7. **Audio-file send works.** Select an allowed real audio file, send explicitly, and verify provider delivery plus canonical TUX history.

8. **Voice recording send works on an allowed browser/device.** Record through the approved microphone capability, preview, explicitly send, and verify provider delivery. Permission denial/unavailability must remain recoverable and must not affect POS/text messaging.

9. **Current Location works on an allowed browser/device.** Grant the trusted geolocation capability, send structured current coordinates, and verify provider delivery. Denial must remain recoverable.

10. **Store Location works regardless of geolocation denial.** Deny device geolocation and verify the canonical configured Store Location can still be sent as a structured location payload.

11. **Linked order appears in WhatsApp and remains correctly scoped.** Explicitly link an eligible order to the conversation and verify the intended shop/conversation/order context only.

12. **Unlink works and is correctly scoped.** Explicitly unlink the conversation/order association and verify no unrelated shop or order state changes.

13. **Delivery receipt progression is visible.** Verify a provider delivery receipt moves the canonical outbound message through the expected delivery state without duplication.

14. **Read receipt progression is visible.** Verify a provider read receipt updates the canonical message to the expected read state without duplication.

15. **Provider-definitive failure becomes `FAILED`, and explicit Retry creates one new attempt.** Retry only after a definitive provider failure; verify the new attempt is linked to the original failed message and repeated retry intent cannot create uncontrolled duplicate sends.

16. **`PENDING`/uncertain delivery has no blind retry or duplicate send.** Create/observe delivery uncertainty and verify TUX exposes no automatic replay and no unsafe resend path that treats uncertainty as definitive failure.

17. **Renderer/browser/desktop shows WhatsApp outage while POS remains usable.** Make WhatsApp remote delivery unavailable and verify cached history/stale state presentation as applicable while normal POS operations remain usable.

18. **Reconnect does not duplicate send or auto-replay.** Restore connectivity and verify state refresh occurs without replaying stale outbound intents automatically.

19. **Inbound image/document/audio materializes to private canonical storage and remains viewable after provider CDN expiry.** Receive real binary media, verify server-side copy into TUX-controlled private storage, and verify history no longer depends on provider CDN lifetime.

20. **No public bucket/object URL works; cross-shop/cross-device media access is denied.** Verify `tux-whatsapp-media` is private, permanent public-object access is unavailable, and TUX authorization prevents unauthorized tenant/device media access.

21. **Media binary expires/deletes at 30 days while message metadata/history remains.** Verify retention behavior using an approved safe test method/evidence: canonical binary becomes unavailable/deleted at the retention boundary while the message record and non-secret history remain visible as expired/unavailable media.

22. **OS notification privacy is correct.** With an identified active worker, notification content is limited to sender/customer-safe preview data. With no worker/day authority, notification is generic (for example, `New WhatsApp message`). Notifications must never expose order/payment content, phone numbers, media secrets, signed URLs, provider IDs, document filenames, or location details.

## Acceptance decision

The subsystem remains **PENDING REAL META ACCEPTANCE** until all 22 checks are executed against the real provider and every required item is PASS.

Any provider discrepancy, tenant/authority leak, unsafe retry behavior, public-media exposure, retention failure, notification privacy leak, or POS-blocking WhatsApp failure keeps the subsystem non-production-ready and must be returned for engineering/design correction before production classification changes.

Repository CI success alone must never be used to replace this real-provider pass.
