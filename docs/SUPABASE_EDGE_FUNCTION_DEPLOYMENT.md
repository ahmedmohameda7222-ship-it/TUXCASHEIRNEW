# Supabase Edge Function manual deployment contract

This document is the manual Supabase Dashboard equivalent of the source-controlled Edge Function authentication policy in `supabase/config.toml`.

The repository configuration is the audited source of truth. When Functions are deployed manually through the Supabase Dashboard, the Dashboard settings must match this file after every deployment or redeployment.

No secret value belongs in this repository or in this document.

## Authentication matrix

| Function | Caller/authentication model | Dashboard JWT verification |
| --- | --- | --- |
| `device-bootstrap` | TUX Vercel server; HMAC-SHA256 provenance using `TUX_BOOTSTRAP_HMAC_SECRET`, timestamp, nonce, and signature | **OFF** |
| `device-enroll` | First-use provisioning client; one-time device enrollment code is validated by the function | **OFF** |
| `operations-config` | Enrolled Operations device with Supabase device-session bearer JWT | **ON** |
| `operations-sync` | Enrolled Operations device with Supabase device-session bearer JWT | **ON** |
| `worker-auth` | Enrolled Operations device with Supabase device-session bearer JWT | **ON** |

Do not disable JWT verification for an authenticated function merely to make the settings uniform.

## Required secret before deploying `device-bootstrap`

`device-bootstrap` and the TUX Vercel server must use the **same** `TUX_BOOTSTRAP_HMAC_SECRET` value. The implementation requires at least 32 UTF-8 bytes.

In the Supabase Dashboard:

1. Open the intended Supabase project.
2. Open **Edge Functions**.
3. Open **Secrets** / **Secrets Management**.
4. Add or update the key `TUX_BOOTSTRAP_HMAC_SECRET` with the production secret value and save it.
5. Independently configure the exact same secret value as `TUX_BOOTSTRAP_HMAC_SECRET` in the intended Vercel environment before enabling production traffic.

Never paste the secret into source control, PR comments, screenshots, CI logs, or this runbook.

## Dashboard deployment steps

For each Edge Function being manually deployed:

1. Open the intended Supabase project in the Dashboard.
2. Open **Edge Functions** and deploy/update the function using the reviewed repository source.
3. Open the deployed function's **Details** / **Function configuration** panel.
4. Set the Dashboard JWT verification control (currently shown as **Verify JWT with legacy secret**) to the value in the authentication matrix above:
   - `device-bootstrap`: **OFF**
   - `device-enroll`: **OFF**
   - `operations-config`: **ON**
   - `operations-sync`: **ON**
   - `worker-auth`: **ON**
5. Save/apply the function configuration.
6. Reopen the function configuration after deployment and verify the toggle still matches the matrix. Manual Dashboard deployments can drift from repository intent, so this post-deploy check is mandatory.

If the Dashboard wording changes, preserve the semantic setting: the Supabase platform-level JWT check must be disabled only for the two bootstrap/provisioning functions above and enabled for the three device-JWT functions.

## Why `device-bootstrap` has platform JWT verification disabled

The browser does not call Supabase `device-bootstrap` directly. The supported flow is:

```text
Browser
→ TUX Vercel server
→ HMAC-signed bootstrap request
→ Supabase device-bootstrap
```

The Vercel server sends the Supabase API key plus the TUX bootstrap timestamp, nonce, and HMAC signature. It intentionally does **not** send a user/device `Authorization: Bearer <JWT>` because the device does not yet have an authenticated Operations device session.

Therefore Supabase's platform JWT verification must be **OFF** for `device-bootstrap`; otherwise the platform can reject the request before the TUX HMAC verifier runs.

This does **not** make `device-bootstrap` unauthenticated at the application layer. The function independently authenticates the Vercel request using the TUX HMAC provenance contract. Unsigned requests, invalid signatures, stale timestamps, and replayed nonces are rejected before PIN bootstrap processing. The nonce is also claimed through the replay-protection database function before the PIN rate limiter is consumed.

## Why `device-enroll` also has platform JWT verification disabled

`device-enroll` is a first-use provisioning endpoint. The caller cannot present an Operations device JWT because successful enrollment is what creates the device identity and initial device session.

Its application-layer credential is the one-time enrollment code, which the function claims and validates before creating the device identity. Therefore the Supabase platform JWT check is **OFF** for this function as well.

## Authenticated device functions stay JWT-protected

`operations-config`, `operations-sync`, and `worker-auth` are not bootstrap endpoints. They require the enrolled Operations device bearer token and validate device/user authorization in function code. Their platform JWT verification setting remains **ON**.

In particular, `worker-auth` keeps the authenticated device-session/JWT model. Do not disable JWT verification for `worker-auth` as part of the bootstrap deployment procedure.

## Release order

The project owner performs production changes only after Planner approval. This PR does not deploy anything.

For the eventual manual release:

1. Apply the approved append-only Supabase migrations required by the reviewed release, including bootstrap nonce replay protection, using the project's approved manual migration procedure.
2. Configure `TUX_BOOTSTRAP_HMAC_SECRET` in both Supabase Edge Function Secrets and the matching Vercel environment.
3. Deploy/update the Supabase Edge Functions from the approved repository versions.
4. Apply and re-check the per-function Dashboard JWT settings from the matrix above.
5. Only after those prerequisites are correct should the corresponding Vercel release receive production traffic.

Do not use a remembered Dashboard toggle, a one-off `--no-verify-jwt` deployment flag, or an undocumented exception as the long-term contract. `supabase/config.toml` plus the permanent CI check define the repository's intended deployment policy.
