# TUX PR #119 — Post-Merge Edge Deployment and QA Evidence

## Edge parity deployment + controlled QA batch — 2026-10-17

Canonical project: `awpdcsayuwbsruwvaosg`. GitHub source baseline: merged PR #119 main `f26b4eb040050226412668d84461dd4697d1069b`. All updates below were deployment-only; no source implementation changes or SQL migrations.

| Function | Previous -> current | verify_jwt retained | Observed deployment state |
|---|---|---|---|
| worker-auth | 1 -> 2 | true | ACTIVE; 2/2 files exact |
| catalog-public | 4 -> 5 | false | ACTIVE; 4/4 introspection files exact; extended dependency upload |
| online-order-operations | 1 -> 2 | true | ACTIVE; 3/3 files exact |
| catalog-admin | 3 -> 4 | true | ACTIVE; 4/4 files exact |
| operations-sync | 3 -> 4 | true | ACTIVE; 2/2 files exact |
| order-intake | 3 -> 4 | false | ACTIVE; 15/15 returned files exact; 20 files uploaded including dependencies |
| device-bootstrap | remains 3 | false | DEPLOY BLOCKED by tool safety check; current deployed logic not replaced |

Pre-deploy recovery copies of each of the seven originally drifted bundles are stored in the adjacent seven `.json` snapshots, with deployed files and previous `verify_jwt` settings.
An initial worker-auth attempt was rejected because it reused the old absolute import map path; retry with explicit `import_map_path=deno.json` succeeded. The device-bootstrap deployment was blocked by tool safety checks; source code was not published.

Controlled QA dataset: same existing test business, new closed `TUX_QA_20261017_SHOP_B` (`a331d74d-97f8-4c0b-8d6c-9eb833ee0ace`). Created through trusted `create_admin_shop_v1` using existing active OWNER staff authority. Idempotent replay produced `idempotentReplay=true`; conflicting command payload returned `idempotency_conflict`. Original catalog baseline remained 49 products and 7 categories, QA shop initially has zero products/categories, and temporaryClosed/onlineOrdersPaused are true.

Created QA-only STAFF employee `01da13a2-d20d-4178-b735-2bf4ba4903ba` in QA shop using `create_employee_v1`; identical command replay returned `replayed=true`. Protected `provision_employee_operations_worker_v1` returned expected `employee_pin_setup_required`: no worker was provisioned and no PIN verifier was bypassed. These are **database command-path fixture/integration checks**, NOT authenticated browser E2E.

Remaining: device-bootstrap deployment, complete HTTP/authenticated Menu/ONLINE/Operations E2E, actual worker PIN onboarding, recipe/inventory/COGS, approval second-person flow, finance/payout protections, role/cross-business tests. No genuine Menu Items were modified, no external payment action initiated. No QA fixture cleanup performed (retain isolated fixtures for continuation). Supabase Edge logs queried after deployments showed no function traffic in the inspected window; ACTIVE is not request-level proof.
