# TUX V2 Supabase

This directory is the authoritative remote Postgres/Supabase schema and Edge Function source for TUX V2.

## Current state

An authorized, dedicated **TUX V2** Supabase project now exists and the repository migration chain is applied through:

`20260820106000_remote_gateway_advisor_hardening.sql`

The legacy Tuxcashier Supabase project remains out of scope and must never be linked, migrated in place, or mutated by this repository.

The live V2 backend currently contains the schema/auth/sync/configuration infrastructure only. No production shop, worker, menu, price, inventory configuration, device enrollment, order, expense, reconciliation, or historical financial data is seeded by these migrations. Business configuration must be migrated or provisioned deliberately from an approved source of truth.

## Remote architecture

Operations remains local-first. A successful sale is committed to the local transactional database before remote delivery. Durable outbox events are delivered automatically to the authenticated remote receiver; cloud availability is not a prerequisite for local financial success.

The deployed backend boundary is:

- `device-enroll` — first-run one-time device enrollment. Gateway JWT verification is intentionally disabled because no device JWT exists yet; the endpoint validates a short-lived one-time enrollment code and creates the device Auth identity through trusted server-side credentials.
- `operations-config` — JWT-required read endpoint for complete versioned Operations configuration. Access is bound to the authenticated Auth user, device ID, active device record, shop membership, and RLS.
- `operations-sync` — JWT-required outbox receiver. It executes the canonical deep V1 sync parser/materializer before calling the service-role-only Postgres ingest RPC.

Operations clients never receive a service-role key and do not write operational fact tables directly. Financial/operational tables remain RLS deny-by-default for client roles; trusted receiver RPCs are the remote write boundary.

## Device enrollment

A trusted administrator/backend process creates a short-lived enrollment code with `create_tux_device_enrollment`. Only a SHA-256 digest of the code is stored. The device exchanges the one-time code for a dedicated Supabase Auth session, and the refresh token is stored by the Electron main process using Electron `safeStorage`.

Enrollment claims are retry-safe: an incomplete, unexpired claim can be released if Auth/session creation fails. Completed codes cannot be reused.

Worker PINs remain local operational identity and are not the remote authorization boundary. Plaintext production PINs must never be committed to source control or stored in normal durable records.

## Configuration delivery

`publish_tux_operations_configuration` is service-role-only until the separate Admin product exists. Publishing a new version validates the complete bundle, materializes configuration tables atomically, preserves historical referenced identities, replaces relationship tables from the complete snapshot, and records the immutable versioned configuration snapshot.

Operations downloads only a complete validated configuration for its enrolled shop. Invalid, stale, cross-shop, or unavailable remote configuration must leave the last known-good local snapshot unchanged.

## Sync integrity

`operations-sync` uses the canonical TypeScript V1 envelope parser and remote materializer pinned to a reviewed repository commit. The Edge import map explicitly resolves canonical `.ts` modules so the same source graph works under Supabase Edge Runtime resolver semantics.

The Postgres ingest boundary enforces:

- authenticated active device + shop membership;
- event receipt idempotency and conflicting-replay rejection;
- aggregate serialization;
- stable conflict-identity row serialization for monotonic lifecycle guards;
- dependency failures as retryable ordering failures;
- shop identity checks before remote mutation;
- service-role-only execution of trusted materialization RPCs.

## Validation

Permanent CI validates formatting, lint, strict TypeScript, unit/integration tests, production builds, development provisioning safety, the complete migration chain on fresh PostgreSQL, Edge Function typechecking using Deno 1.46 resolver semantics, rendered browser E2E, and the unsigned Windows x64 package.

After remote DDL changes, run Supabase security advisors. Operational tables intentionally showing `RLS Enabled No Policy` at INFO level are deny-by-default by design; do not add permissive policies merely to silence the advisory. Material WARN/ERROR findings must be resolved before release.

## Secrets and repository safety

Do not commit or document live project refs, project URLs, publishable keys, service-role keys, access tokens, refresh tokens, enrollment codes, database passwords, or production PINs in Git.

Runtime values belong in the deployment/device environment or platform secret store. Desktop production integration uses `TUX_SUPABASE_URL` and `TUX_SUPABASE_PUBLISHABLE_KEY`; first enrollment additionally uses the one-time `TUX_DEVICE_ENROLLMENT_CODE`, stable `TUX_DEVICE_ID`, and optional `TUX_DEVICE_LABEL`.
