# TUX V2 Supabase migrations

This directory is the authoritative remote Postgres/Supabase schema history for TUX V2.

## Current state

The dedicated TUX V2 Supabase project is live and uses this repository migration chain as its canonical schema history. Project credentials and project references are intentionally not committed to Git.

The approved Operations menu baseline is published as a versioned configuration snapshot. It contains the current user-approved TUX menu data and the approved top-level navigation structure. Product families are configuration metadata inside a category (for example `TUX` / `TUXIFY` inside `Burgers`), not extra top-level categories.

Do not:

- link this repository to the legacy Tuxcashier Supabase project;
- add a project ref, URL, anon key, service-role key, access token, enrollment code, device credential, or database password to Git;
- bypass the migration chain by editing the remote schema directly;
- migrate legacy orders, financial history, worker PINs, delivery zones, inventory recipes, or modifier relationships merely because they exist in V1.

## Configuration ownership

The V1 migration boundary is intentionally narrow: the approved real menu is the baseline source brought forward into V2. Current Operations order-type/payment choices required by that menu workflow are also present.

Workers/PINs, delivery zones/fees, inventory/recipes, modifier relationships, and other future operational configuration are to be created and managed through the V2 Admin product rather than copied wholesale from the legacy application. This keeps V2 configuration clean and prevents legacy structure from becoming an accidental long-term contract.

## Security posture

Operational fact tables keep Row Level Security enabled with deny-by-default access. Trusted mutations flow through the reviewed authenticated gateway / service-role-only database functions rather than permissive direct client table writes.

Worker PIN identity is operational identity and is not the remote authorization boundary. Plaintext production PINs do not belong in source control or durable normal records.

## Validation status

The complete repository migration chain is exercised against fresh PostgreSQL in CI. The Supabase integration validates the Edge Function import graph, rendered Operations browser workflow, and unsigned Windows x64 packaging before merge. Remote schema changes must be represented by a repository migration and rechecked with Supabase security/performance advisors after application.
