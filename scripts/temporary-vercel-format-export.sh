#!/usr/bin/env bash
set -euo pipefail
npm run format
echo '=== TUX PRETTIER DIFF START ==='
git --no-pager diff -- apps/operations/src/app/App.tsx apps/operations/src/app/browserRemote.ts apps/operations/src/app/sessionClient.ts packages/sync/src/supabaseDeviceSession.ts
echo '=== TUX PRETTIER DIFF END ==='
npm run build -w @tux/operations
