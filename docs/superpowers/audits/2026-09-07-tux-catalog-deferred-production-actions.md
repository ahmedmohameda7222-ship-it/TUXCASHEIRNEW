# TUX Phase B — Deferred Production Actions

Date: 2026-09-07

Authority: `work/catalog-authority-contracts`

This document records actions that are intentionally **not executed during Phase B**. They require later explicit authorization and, where applicable, architecture review of the completed Phase B repository implementation.

It is not a parking place for unfinished Phase B coding. The Phase B repository artifacts, contracts, migrations, tests, public read boundary, Admin command boundary, mapping design, image ownership rules, referential policy, architecture guards, and CI integration are implemented on the Phase B branch.

## Production Supabase actions

The following are deferred until an explicitly authorized production operation:

- apply the approved canonical catalog migrations from `supabase/migrations/` to the intended production Supabase project;
- deploy `catalog-public` with its audited unauthenticated platform-JWT policy (`verify_jwt = false`);
- deploy `catalog-admin` with its audited authenticated platform-JWT policy (`verify_jwt = true`);
- verify the production `catalog-product-images` bucket configuration, including customer-readability, file-size limits, and allowed MIME types;
- configure only the runtime environment values required by the Edge Functions using the deployment platform's secret/configuration mechanism;
- verify production RLS/grants/function execution behavior against the intended Supabase roles after deployment.

Phase B does **not** authorize any of those actions and does not apply them remotely.

## Catalog data migration

The deterministic legacy mapping is a repository-owned dry-run design. Production data migration is deferred.

A later explicitly authorized migration operation must:

- identify the exact target shop UUID;
- use the committed legacy identity manifest and deterministic mapping rules;
- preserve stable public slugs and canonical UUID identities;
- convert legacy EGP major-unit prices to validated integer minor units;
- reject duplicate identifiers, unknown references, malformed prices, and manifest/source drift;
- account for every legacy source row with an explicit disposition;
- perform an independent pre-write dry run and review its deterministic output;
- write only to the explicitly authorized production shop;
- verify row counts, references, ordering, availability semantics, and customer-visible parity after migration.

No production catalog row is written during Phase B.

## Product image materialization

Legacy bundled assets, legacy storage paths, and legacy URLs are migration inputs rather than canonical runtime authority after cutover.

A later authorized image migration must:

- materialize approved product images into the canonical shop-scoped namespace under `catalog-product-images`;
- preserve the mapping between canonical product UUID and `products.image_key`;
- prevent cross-shop object ownership;
- verify object existence before committing canonical keys;
- avoid deleting any object still referenced by another product;
- report storage cleanup failures explicitly rather than silently treating them as successful rollback.

No production storage object is created, replaced, or deleted during Phase B.

## Phase C — standalone Admin

Phase C is not authorized by completion of this document.

After architecture review explicitly approves Phase B and authorizes Phase C, the standalone Admin may be built against `catalog-admin` and `@tux/catalog-contracts`. The existing legacy Admin remains available until that later Admin is accepted.

Phase C must not reintroduce direct privileged browser CRUD or browser-held service-role credentials.

## Phase D — Menu cutover

Menu runtime cutover is deferred to Phase D and requires separate authorization.

The current Menu continues to use its legacy runtime authority/fallback path during Phase B. A later Phase D cutover may consume `catalog-public` only after the canonical production data and image materialization have been independently accepted.

The old TUX-MENU authority/history is not retired by Phase B.

## Retirement and cleanup

Removal or retirement of legacy runtime paths is deferred until the corresponding replacement has been accepted in its later phase. This includes:

- legacy `/admin` removal;
- legacy Menu runtime/fallback removal;
- retirement of legacy catalog tables or compatibility data, if ever approved;
- retirement of the original TUX-MENU repository/history.

Historical catalog rows referenced by durable business records remain subject to the canonical retire/deactivate policy; they must not be hard-deleted merely as cleanup.

## Explicit Phase B non-actions

Phase B performs none of the following:

- production Supabase migration application;
- production Edge Function deployment;
- production catalog data migration;
- production Storage mutation;
- production auth-user mutation;
- Meta/WhatsApp production mutation;
- Menu runtime cutover;
- standalone Admin UI extraction;
- legacy `/admin` removal;
- TUX-MENU retirement;
- merge to `main`.

Any later production or phase-transition action requires its own explicit authorization and verification plan.
