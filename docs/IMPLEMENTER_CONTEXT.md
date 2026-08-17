# TUX V2 Implementer Context

## Repository identity

- New long-term repository: `ahmedmohameda7222-ship-it/TUXCASHEIRNEW`.
- Legacy repository: `ahmedmohameda7222-ship-it/Tuxcashier`, read-only reference only.
- Current product scope: **TUX Operations V2**.
- Future product: **TUX Admin**, separate application; do not add an Admin tab to Operations.
- Canonical Operations behavior: `docs/TUX_V2_Operations_Master_Approved_Plan.md`.

## Engineering invariants

- Strict TypeScript; business rules must not live in React JSX.
- Exact-money semantics; floating point is not the accounting model.
- Business Day is a durable entity, not a calendar-date filter.
- Local durable transaction precedes cloud acknowledgement for critical business actions.
- Offline operation, idempotency, immutable history, auditability, and crash recovery are required.
- Electron renderer has no unrestricted Node, filesystem, SQLite, shell, or raw IPC access.
- Remote Supabase is currently unconfigured. Repository migrations may be authored later, but no remote project may be targeted without explicit authorization.
- Legacy V1 architecture is not a migration template.

## Git workflow

```text
main
└── integration/tux-operations-v2
    └── feat/ops-XX-...
```

Each validated phase is squash-merged into the integration branch. The final integration branch must not be merged to `main` without explicit user approval.

## Current implementation state

- Phase 0: PASS — repository governance/specification baseline.
- Phase 1: PASS — TypeScript/React/Electron engineering foundation and CI.
- Phase 2 is next: domain + persistence + local/remote migration foundation.
