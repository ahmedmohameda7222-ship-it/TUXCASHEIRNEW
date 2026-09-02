# Supabase Remote Migration Ledger

## Purpose and authority

Environment: **Production**

Reviewed repository `main` SHA: `ebf48b4f8857805ab10ec1c15e5b46ced8a69f42`

The migration files under `supabase/migrations/` remain the schema source of truth. This ledger records the observed and independently reconciled Production deployment state of those repository migrations. It is **not** a migration engine, a substitute for the repository migration chain, or permission to replay SQL.

Operationally, this ledger is append-only. Future corrections or additional reconciliation evidence should be recorded as new notes or follow-up entries rather than silently rewriting historical observations into a cleaner story.

Supabase Dashboard SQL Editor execution can create a real schema or data effect without creating a corresponding row in `supabase_migrations.schema_migrations`. Therefore:

- missing remote migration-history metadata does **not** mean a migration must be rerun;
- a repository migration must never be blindly replayed merely because its history entry is absent;
- `supabase_migrations.schema_migrations` must not be casually or manually mutated to make history appear aligned;
- any history discrepancy must be reconciled deliberately against repository SQL and independently observed Production effects.

Exact Production application times were not established during this reconciliation. Every `applied_at` value below is therefore recorded as `unknown / not asserted` rather than inferred.

## Production reconciliation ledger

| # | Repository migration | Purpose / name | Production status | Observed remote history version | `applied_at` | Verification / evidence summary | Git blob SHA | Notes |
|---:|---|---|---|---|---|---|---|---|
| 1 | `20260817195000_operations_foundation.sql` | `operations_foundation` | **APPLIED — REMOTE HISTORY ALIGNED** | `20260817195000` | unknown / not asserted | Repository version/name aligns with observed Production migration history. | `177ed33d718145cba2bc99befd5efb2f2e3cfd3c` | Repository migration remains authoritative. |
| 2 | `20260817195500_tenant_integrity.sql` | `tenant_integrity` | **APPLIED — REMOTE HISTORY ALIGNED** | `20260817195500` | unknown / not asserted | Repository version/name aligns with observed Production migration history. | `2a949931db4b8a60a978fe4d594d69fdc8fa64f6` | Repository migration remains authoritative. |
| 3 | `20260820023000_operations_sync_domain_parity.sql` | `operations_sync_domain_parity` | **APPLIED — REMOTE HISTORY ALIGNED** | `20260820023000` | unknown / not asserted | Repository version/name aligns with observed Production migration history. | `c7043c2b36e96a4f7fed624f5c12f61fd670e776` | Repository migration remains authoritative. |
| 4 | `20260820093000_remove_redundant_unique_constraints.sql` | `remove_redundant_unique_constraints` | **APPLIED — REMOTE HISTORY ALIGNED** | `20260820093000` | unknown / not asserted | Repository version/name aligns with observed Production migration history. | `636a2c96c0f4229b34530ec6435d530cbead6bdd` | Repository migration remains authoritative. |
| 5 | `20260820102500_enable_pgcrypto.sql` | `enable_pgcrypto` | **APPLIED — REMOTE HISTORY ALIGNED** | `20260820102500` | unknown / not asserted | Repository version/name aligns with observed Production migration history. | `4e26b1791d122f610cfb67fb7aeb12f87829a4ed` | Repository migration remains authoritative. |
| 6 | `20260820103000_operations_device_auth_and_remote_gateway.sql` | `operations_device_auth_and_remote_gateway` | **APPLIED — REMOTE HISTORY ALIGNED** | `20260820103000` | unknown / not asserted | Repository version/name aligns with observed Production migration history. | `a6e5ca4cd7328fd023e3fe61b01e3bf8dda343e0` | Repository migration remains authoritative. |
| 7 | `20260820103500_remote_mutation_row_lock.sql` | `remote_mutation_row_lock` | **APPLIED — REMOTE HISTORY ALIGNED** | `20260820103500` | unknown / not asserted | Repository version/name aligns with observed Production migration history. | `54c90b8059d1ebe56b102dd773c61480f86fef9f` | Repository migration remains authoritative. |
| 8 | `20260820104000_operations_configuration_publish.sql` | `operations_configuration_publish` | **APPLIED — REMOTE HISTORY ALIGNED** | `20260820104000` | unknown / not asserted | Repository version/name aligns with observed Production migration history. | `d3ab9f0ea236e20281c01a936ede2431064342cf` | Repository migration remains authoritative. |
| 9 | `20260820105000_operations_remote_gateway_hardening.sql` | `operations_remote_gateway_hardening` | **APPLIED — REMOTE HISTORY ALIGNED** | `20260820105000` | unknown / not asserted | Repository version/name aligns with observed Production migration history. | `312d049a6edcd47ff3c5103e85c17a0bbb4f8d35` | Repository migration remains authoritative. |
| 10 | `20260820106000_remote_gateway_advisor_hardening.sql` | `remote_gateway_advisor_hardening` | **APPLIED — REMOTE HISTORY ALIGNED** | `20260820106000` | unknown / not asserted | Repository version/name aligns with observed Production migration history. | `b124511b58689370aaed9944620d5d83659bada3` | Repository migration remains authoritative. |
| 11 | `20260821002000_product_family.sql` | `product_family` | **APPLIED — REMOTE HISTORY ALIGNED** | `20260821002000` | unknown / not asserted | Repository version/name aligns with observed Production migration history. | `6ad6b6f679b1a09337f176e72895b61bc83c1c73` | Repository migration remains authoritative. |
| 12 | `20260821025500_worker_pin_bootstrap_rate_limit.sql` | `worker_pin_bootstrap_rate_limit` | **APPLIED — VERIFIED HISTORICAL VERSION ALIAS** | `20260821010705` | unknown / not asserted | Production SQL effect/content was independently reconciled to the repository migration despite the differing timestamp. | `635cb69eb87d6ffadbced895f48b4ef9287fd9b5` | Historical timestamp alias. **Do not rerun, rename, or rewrite** the repository migration to force metadata alignment. |
| 13 | `20260825030000_worker_ui_preferences.sql` | `worker_ui_preferences` | **APPLIED EFFECT VERIFIED — REMOTE HISTORY ENTRY NOT PRESENT** | not present | unknown / not asserted | `worker_ui_preferences` exists; expected grants, RLS, and policy were independently verified in Production. | `190e285783b291c02943628e6be05331fb9d19d3` | Missing history metadata is not evidence that SQL should be replayed. |
| 14 | `20260827010000_tux_menu_product_descriptions.sql` | `tux_menu_product_descriptions` | **APPLIED DATA + SNAPSHOT EFFECT VERIFIED — REMOTE HISTORY ENTRY NOT PRESENT** | not present | unknown / not asserted | Production reconciliation found 49 active / 49 total products, expected category/family counts, descriptions matching the intended current canonical products, and configuration snapshot version 3 carrying matching canonical descriptions. | `4da04c22f083f69661fb65a167445a65af0b041c` | Reconciled against the **current canonical catalog**. Current product names are not asserted to be byte-identical to the historical migration's original names. |
| 15 | `20260828060000_worker_ui_preferences_product_order.sql` | `worker_ui_preferences_product_order` | **APPLIED EFFECT VERIFIED — REMOTE HISTORY ENTRY NOT PRESENT** | not present | unknown / not asserted | Production `product_order` effect was independently verified. | `8cbacfb57dc13eb8d49cfae5debc7276f1eba642` | Missing history metadata is not evidence that SQL should be replayed. |
| 16 | `20260828150000_worker_ui_preferences_accent_color.sql` | `worker_ui_preferences_accent_color` | **APPLIED EFFECT VERIFIED — REMOTE HISTORY ENTRY NOT PRESENT** | not present | unknown / not asserted | Production accent-color constraint and relevant RPC overload behavior were independently verified. | `1b3f97666f7286d96fa566e5229c9b8bb10ef29d` | Missing history metadata is not evidence that SQL should be replayed. |
| 17 | `20260829130000_worker_ui_preferences_conflict_target.sql` | `worker_ui_preferences_conflict_target` | **APPLIED EFFECT VERIFIED — REMOTE HISTORY ENTRY NOT PRESENT** | not present | unknown / not asserted | Production RPC was independently verified to use `ON CONFLICT ON CONSTRAINT worker_ui_preferences_pkey`. | `7c8d0b30a22ca2f43fbf187f36015084edd1380e` | Missing history metadata is not evidence that SQL should be replayed. |
| 18 | `20260831183000_worker_menu_layouts.sql` | `worker_menu_layouts` | **APPLIED EFFECT VERIFIED — REMOTE HISTORY ENTRY NOT PRESENT** | not present | unknown / not asserted | Production verification covered `worker_menu_layouts`, its RLS/grants/policy, and `put_worker_menu_layout_v2`. | `e804f978221cfed998d2a14ef74a5daead0ff364` | Missing history metadata is not evidence that SQL should be replayed. |
| 19 | `20260901183000_bootstrap_request_provenance.sql` | `bootstrap_request_provenance` | **APPLIED + VERIFIED — REMOTE HISTORY ENTRY NOT PRESENT** | not present | unknown / not asserted | Manually applied through Supabase Dashboard SQL Editor and independently verified: nonce table, claimed-at index, nonce-claim RPC, anonymous/authenticated execution blocked, service-role execution allowed, first claim `true`, replay claim `false`. | `ed3d72abf9c7db27a70e6e7f80ef65d46bfb0842` | Do **not** manually insert a migration-history row. The verified schema/RPC effect is the Production reconciliation fact. |

## Remote history interpretation

Observed Production remote migration history contained repository-aligned entries for migrations #1–#11 and a historical timestamp alias for #12. It did not contain migration-history entries for #13–#19 even though the corresponding Production effects were independently reconciled as described above.

This distinction is intentional:

- **Repository migration truth** answers what schema/data evolution TUX defines.
- **Remote migration-history metadata** records only what the remote migration-history mechanism knows about.
- **Production effect verification** establishes independently observed schema/data behavior when history metadata is absent or historically inconsistent.

These are related records, not interchangeable sources of truth.

### Rules for Future Production Migrations

1. Author and review the migration in Git.
2. Keep the repository migration as the schema source of truth; do not rewrite historical migration meaning.
3. Obtain Planner approval for the exact migration to be applied.
4. Apply the approved migration manually through the authorized Supabase Dashboard workflow unless deployment policy changes later.
5. Independently verify the resulting remote schema/data effects.
6. Update this ledger with the observed evidence and any remote-history metadata that actually exists.
7. Reconcile history discrepancies deliberately. Never replay a migration merely because Supabase Dashboard migration history is absent, and never casually mutate `supabase_migrations.schema_migrations` to manufacture alignment.

## Change discipline

A future reconciliation correction should preserve the prior observation and append a dated or otherwise uniquely identifiable reconciliation note explaining what new evidence changed the understanding. Silent edits that erase a previously recorded Production observation defeat the purpose of this ledger.
