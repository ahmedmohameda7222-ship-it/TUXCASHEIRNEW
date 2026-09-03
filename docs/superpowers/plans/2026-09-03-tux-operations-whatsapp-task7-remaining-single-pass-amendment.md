# TUX Operations WhatsApp Task 7 — Remaining Single-Pass Execution Amendment

Date: 2026-09-03
Status: Binding execution-cadence amendment
Parent plan: `docs/superpowers/plans/2026-09-03-tux-operations-whatsapp-worker-inbox-ui-task7.md`
Parent corrections: `docs/superpowers/plans/2026-09-03-tux-operations-whatsapp-worker-inbox-ui-task7-self-review-corrections.md`
Approved permanent implementation baseline for this amendment: `25ba4dc3d52c2905928d858577e19ad064029cc6`

## 1. Purpose

The user explicitly requested that the remaining Task 7 work be executed in one implementation pass rather than returning to Planner/Auditor after every remaining checkpoint.

This amendment changes **execution cadence only**. It does not change the approved Task 7 product design, architecture, security boundaries, file scopes, TDD requirements, or final verification gates.

Task 7A and Task 7B are already complete. The remaining sequence is:

```text
7C Workspace
→ commit
7D ACTIVE-shell integration
→ commit
7E full final verification
→ STOP before Task 8
```

The implementer may execute that entire remaining sequence in one Classic ChatGPT session and return one final Task 7 report.

## 2. Execution mode

Classic ChatGPT only.

Use:

```text
superpowers:executing-plans
```

No subagents.

The implementer MUST continue task-by-task internally. Single-pass execution does **not** mean one unstructured code change or one mixed commit.

For each implementation task, preserve:

```text
write failing test
→ run intended RED
→ minimal implementation
→ run GREEN
→ related typecheck/checks
→ commit that task separately
```

## 3. Superseded reviewer stops

The parent plan's mandatory Planner/Auditor STOP after Task 7C and after Task 7D is superseded.

After a compliant GREEN Task 7C commit, continue directly to Task 7D.

After a compliant GREEN Task 7D commit, continue directly to Task 7E final verification.

Do not wait for Planner/Auditor between these three remaining phases.

## 4. Stops that remain mandatory

The implementer MUST still STOP immediately and return evidence if any of the following occurs:

- an expected RED does not fail for the intended reason;
- an architecture/interface contradiction is discovered;
- an additional production/source file outside the approved Task 7 source scope appears necessary;
- a package dependency change appears necessary;
- any Supabase, SQLite, or IndexedDB migration appears necessary;
- provider/Meta configuration appears necessary;
- current-worker, tenant, provider, or order authority would need to move into the UI;
- media sending / `sendMedia` appears necessary;
- an existing Task 7A or Task 7B behavior must be materially rewritten rather than consumed;
- a final gate fails because of a real product/source defect that cannot be corrected within the already-authorized Task 7 files.

Do not guess around these conditions merely to finish the single pass.

## 5. Task 7C remains unchanged

Execute Task 7C exactly from the parent plan.

Authorized permanent files:

```text
apps/operations/src/app/WhatsAppWorkspace.tsx
apps/operations/src/app/WhatsAppWorkspace.test.tsx
apps/operations/src/styles/global.css
apps/operations/src/app/icons.tsx   # only if actually required by the existing icon pattern
```

Required RED remains:

```bash
npm test -- apps/operations/src/app/WhatsAppWorkspace.test.tsx
```

Expected failure: missing `./WhatsAppWorkspace`.

Required GREEN remains the parent-plan component suite plus Operations typecheck.

Commit Task 7C separately, suggested message:

```text
feat: add WhatsApp inbox workspace
```

After GREEN + commit, continue directly to Task 7D.

## 6. Task 7D remains unchanged

Execute Task 7D exactly from the parent plan.

Authorized permanent files:

```text
apps/operations/src/app/App.tsx
apps/operations/src/app/App.whatsapp.test.tsx
```

Task 7D may consume the Task 7C files committed immediately before it.

Required RED remains:

```bash
npm test -- apps/operations/src/app/App.whatsapp.test.tsx
```

The intended RED must prove missing WhatsApp ACTIVE-shell/navigation integration, not an unrelated broken App fixture.

Required GREEN remains the parent-plan shell/workspace/controller/view test set plus Operations typecheck.

Commit Task 7D separately, suggested message:

```text
feat: add WhatsApp to Operations navigation
```

After GREEN + commit, continue directly to Task 7E.

## 7. Task 7E final verification remains mandatory and complete

Run the complete Task 7E verification from the parent plan plus all binding self-review corrections.

At minimum this includes:

### Focused Task 7 / WhatsApp runtime suites

```bash
npm test -- \
  apps/operations/src/app/whatsappView.test.ts \
  apps/operations/src/app/whatsappInboxController.test.ts \
  apps/operations/src/app/WhatsAppWorkspace.test.tsx \
  apps/operations/src/app/App.whatsapp.test.tsx \
  apps/operations/src/app/sessionClient.whatsapp.test.ts \
  packages/application/src/whatsapp.test.ts \
  packages/application/src/whatsappWire.test.ts
```

### Existing Task 6/runtime regression suites

Run the exact parent-plan regression command covering browser remote, server device authority, server WhatsApp gateway, desktop remote, Electron IPC/preload, and Electron security/session regressions.

### Repository gates

```bash
npm run test:whatsapp-architecture
npm run typecheck
npm run lint
npm run format:check
npm run test:migrations
```

All must PASS before claiming Task 7 complete.

### Security/scope gates

Prove all parent-plan guards, including:

- `sendMedia` absent from Task 7 UI/controller/view;
- no attachment-send affordance;
- no privileged provider/service-role secrets in Task 7 UI files;
- no direct Meta path;
- no hard-coded production Egyptian quick-reply fallback list;
- no migration changes;
- no package manifest/lock changes;
- permanent Task 7 source scope contains only the approved files;
- no diagnostic workflow enters permanent Task 7 ancestry;
- working tree clean.

Also explicitly retain the Task 7B self-review evidence in the final report for:

- offline-start cache-capable initial load;
- exact 250 ms draft debounce;
- captured draft ownership;
- stale selection fencing;
- stale send-completion fencing;
- stable unchanged retry intent key;
- no automatic send replay on `online`.

## 8. Formatting/final-gate corrections

If `format:check` or lint requires a mechanical correction inside an already-authorized Task 7 source/test file, the implementer may make that narrow correction, rerun all affected focused tests and the complete final gates, and commit it separately.

A final-gate correction MUST NOT:

- add a new production file;
- change product behavior to make a test pass;
- modify migrations or manifests;
- weaken a security/scope check;
- promote a temporary verification workflow.

If any of those would be required, STOP and return to Planner/Auditor.

## 9. Production boundary

Still forbidden throughout the single pass:

- Supabase production SQL/apply;
- `whatsapp_channels` mutation;
- Meta credentials/configuration;
- Vercel production environment changes;
- Vercel deployment;
- Windows publication;
- any production mutation.

## 10. Final stop

After Task 7E passes, return one complete Task 7 report to Planner/Auditor and STOP.

Do NOT start Task 8.

The final report must include:

- existing approved 7A commit/evidence;
- existing approved 7B commit/evidence;
- 7C RED/GREEN/commit evidence;
- 7D RED/GREEN/commit evidence;
- 7E complete final verification counts/results;
- exact permanent Task 7 changed files from baseline `2a39d9bfaf8622907646294fba8515854d4c3834`;
- final branch HEAD and clean status;
- all production mutation fields = NO;
- `STOPPED BEFORE TASK 8: YES`.
