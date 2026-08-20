# TUX V2 Repository Governance

## Protected integration rule

`main` is the release/integration branch for the completed Operations line. Stabilization and future implementation work is performed on a branch and reviewed through a pull request. Direct feature commits to `main` are not the normal workflow.

The stable required status check is:

```text
TUX V2 CI / Required quality gate
```

It depends on:

- Linux locked install, formatting, lint, strict TypeScript, unit/integration tests and production builds;
- the repository PostgreSQL migration-chain smoke;
- current rendered Playwright browser-fallback E2E;
- independent Windows x64 NSIS packaging.

A PR must not be represented as release-green when any dependency is skipped, failing, or based only on old evidence.

## Merge policy

- Prefer squash merge for a reviewed stabilization/change branch.
- Do not merge a red or incomplete PR.
- Re-check the current `main` SHA immediately before final merge.
- If `main` advanced, reconcile/rebase/merge current main first and rerun the full green gate.
- Preserve narrow commits while debugging; the final merge may squash them.

## Evidence policy

PASS claims in compliance/docs must cite current code/tests or the current rendered/packaging gate. Old Phase evidence may remain as historical context but may not be the sole proof for a row whose relevant code changed.

Temporary workflow/bootstrap helpers are prohibited from the final branch. CI configuration itself must be permanent, deterministic, read-only except for generated workflow artifacts, and free of repository write tokens.

## Security and remote-data boundary

- No production Supabase credentials, printer secrets, production PINs, certificates or signing private keys in Git.
- No workflow applies repository migrations to a remote Supabase project.
- Renderer code does not receive raw SQLite, filesystem, Node or unrestricted IPC access.
- Development provisioning must be explicit, development-only and unable to run under `NODE_ENV=production`.

## External configuration

Branch-protection settings are a GitHub repository setting rather than application source. The target configuration is: require PR review/merge path and require `TUX V2 CI / Required quality gate` before merge to `main`. If the connected GitHub API cannot manage this setting, that fact is recorded as an external repository-configuration blocker rather than falsely claimed complete.
