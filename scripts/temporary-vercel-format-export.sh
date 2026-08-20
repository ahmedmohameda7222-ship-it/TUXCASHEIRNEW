#!/usr/bin/env bash
set -euo pipefail
npm run format
npm run build -w @tux/operations
mkdir -p apps/operations/dist/_formatted
cp apps/operations/src/app/App.tsx apps/operations/dist/_formatted/App.txt
cp apps/operations/src/app/browserRemote.ts apps/operations/dist/_formatted/browserRemote.txt
cp apps/operations/src/app/sessionClient.ts apps/operations/dist/_formatted/sessionClient.txt
cp packages/sync/src/supabaseDeviceSession.ts apps/operations/dist/_formatted/supabaseDeviceSession.txt
