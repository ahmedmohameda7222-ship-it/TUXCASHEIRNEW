from pathlib import Path


def append_section(path: str, sentinel: str, section: str) -> None:
    file = Path(path)
    text = file.read_text().rstrip()
    if sentinel not in text:
        file.write_text(text + "\n\n" + section.strip() + "\n")


append_section(
    "docs/ARCHITECTURE.md",
    "## Automatic outbox synchronization boundary",
    """
## Automatic outbox synchronization boundary

Phase 9 introduces `@tux/sync` as a transport-agnostic delivery layer for business events that were already committed locally. The sync engine never participates in the original Orders, Board, Expenses, Bulk Stock, or End Day transaction. Those commands acknowledge success from durable local state only.

`OutboxSyncService` reads the oldest eligible pending events, invokes an `OutboxTransport`, and writes `deliveredAt` only after the transport reports remote success. A delivery failure changes only retry metadata (`attemptCount`, `nextAttemptAt`, `lastError`) using capped exponential backoff; it cannot mutate or roll back the original business fact. The current batch stops at the first failed event so later events do not overtake an older failed event.

Delivery is deliberately at-least-once. If a remote endpoint accepts an event but the process fails before the local delivered marker is committed, the same immutable event can be sent again. The HTTP transport therefore forwards both the durable event ID and outbox `idempotencyKey`; remote ingestion must deduplicate that key.

Browser and Electron runtimes start `AutomaticOutboxScheduler` automatically only when an endpoint is configured. They share the normal application command coordinator so sync metadata writes do not race operational writes. There is no worker-facing manual Sync API/button. With no endpoint configured, Operations remains honestly local-only and pending events remain pending.
""",
)

append_section(
    "docs/DATA_MODEL.md",
    "## Outbox delivery lifecycle",
    """
## Outbox delivery lifecycle

`OutboxEvent` is the immutable synchronization unit created by local business transactions. Phase 9 preserves event identity, aggregate identity, event type, payload version, payload, creation time, and idempotency key across every delivery attempt.

Only delivery metadata changes after the originating business commit:

- `deliveredAt` becomes non-null only after remote transport success;
- `attemptCount` increments after delivery failure;
- `nextAttemptAt` records the next retry eligibility using exponential capped backoff;
- `lastError` stores a bounded diagnostic string.

A retry does not manufacture a replacement business event. It resends the same immutable event/idempotency identity. This is the basis for remote idempotent ingestion when the production backend is connected later.
""",
)

append_section(
    "docs/OFFLINE_AND_SYNC.md",
    "## Automatic outbox delivery",
    """
## Automatic outbox delivery

Phase 9 implements the automatic delivery loop for the durable outbox already written by Operations commands.

```text
local business transaction succeeds
→ immutable outbox event is pending
→ configured scheduler runs automatically
→ oldest eligible event is sent with event ID + idempotency key
→ remote success: mark delivered locally
→ remote/network failure: record retry metadata only
→ retry later automatically with the same immutable event
```

The worker never presses a Sync button and local business success never waits for a network response. The retry delay starts at two seconds, doubles per failed attempt, and is capped at five minutes. A failed oldest event stops the current batch so later events do not overtake it.

The HTTP transport requires HTTPS outside loopback development. `TUX_SYNC_ENDPOINT` / `VITE_TUX_SYNC_ENDPOINT` are optional configuration. Empty configuration starts no scheduler and does not falsely mark events delivered. The repository intentionally contains no production endpoint or credential. Live Supabase/backend ingestion remains a post-planner deployment/configuration step; the user will manually apply the versioned Supabase migrations after repository-side implementation is complete.
""",
)

append_section(
    "docs/TEST_STRATEGY.md",
    "## Phase 9 automatic sync coverage",
    """
## Phase 9 automatic sync coverage

Automated Phase 9 coverage protects:

- oldest-first eligible outbox processing;
- `deliveredAt` remaining null until transport success;
- failure changing retry metadata only;
- first failure stopping the current ordered batch;
- exponential retry delay with a five-minute cap;
- retry eligibility preventing resend before `nextAttemptAt`;
- later retry delivering the same event/idempotency key;
- immutable SQLite outbox payload and identity surviving failed and successful attempts;
- HTTP event/idempotency headers and payload version forwarding;
- non-2xx HTTP responses remaining delivery failures;
- HTTPS enforcement outside loopback development;
- automatic browser/Electron scheduler wiring through strict TypeScript and production builds.

A live production remote ingestion endpoint is intentionally outside repository CI while the V2 backend/Supabase project remains unlinked. Repository tests therefore prove delivery protocol, retry durability and idempotency contract without falsely claiming production cloud acceptance.
""",
)

append_section(
    "docs/IMPLEMENTATION_LOG.md",
    "## 2026-08-18 — Phase 9 automatic outbox synchronization",
    """
## 2026-08-18 — Phase 9 automatic outbox synchronization

- Implemented `@tux/sync` on `feat/ops-09-sync`, stacked on the completed Phase 8 End Day branch.
- Added oldest-first automatic outbox processing, delivered-only-after-remote-success semantics, and capped exponential retry metadata.
- Added explicit at-least-once behavior: retries reuse the same immutable event ID/idempotency key and remote ingestion is responsible for deduplication.
- Added HTTPS JSON transport with event/idempotency headers; non-2xx/network failures remain pending locally.
- Added automatic browser and Electron schedulers under the shared application command coordinator. No worker manual Sync command/button exists.
- Endpoint configuration is optional. With no endpoint configured, Operations remains local-only and never pretends data reached a server.
- Added unit tests for ordering, retry/backoff and HTTP protocol plus real SQLite integration coverage for pending → failure/backoff → early skip → later delivery while preserving immutable event/payload identity.
- Full repository validation passed locked install, Prettier, ESLint, strict TypeScript, all tests, and browser/Electron builds before documentation closeout.
- Production Supabase/backend remains intentionally unlinked. Versioned migrations stay in the repository for the user to apply manually after planner completion.
""",
)

# Update only sync/outbox requirements that can be classified unambiguously by their text.
matrix = Path("docs/OPERATIONS_COMPLIANCE_MATRIX.md")
lines = matrix.read_text().splitlines()
out = []
for line in lines:
    if not line.startswith("| ") or line.startswith("| ID ") or line.startswith("|---"):
        out.append(line)
        continue
    parts = [part.strip() for part in line.split("|")]
    if len(parts) < 9:
        out.append(line)
        continue
    requirement = parts[2].lower()
    area = parts[3].lower()
    haystack = requirement + " " + area
    status = None
    note = None
    evidence = None

    if "manual sync" in requirement or ("sync" in requirement and "button" in requirement):
        status = "PASS"
        evidence = "`@tux/sync`; browser/Electron automatic scheduler wiring"
        note = "No worker-facing manual Sync command/button exists; configured schedulers start automatically."
    elif "idempot" in requirement and ("sync" in haystack or "outbox" in haystack):
        status = "PASS"
        evidence = "`OutboxSyncService`; `HttpOutboxTransport`"
        note = "Retries reuse the immutable outbox event ID/idempotency key and the transport forwards that key for remote deduplication."
    elif ("retry" in requirement or "backoff" in requirement) and ("sync" in haystack or "outbox" in haystack):
        status = "PASS"
        evidence = "`OutboxSyncService`; SQLite outbox metadata"
        note = "Delivery failures preserve the business event and persist attempt count, next retry time and error with capped exponential backoff."
    elif "automatic" in requirement and "sync" in haystack:
        status = "PASS"
        evidence = "`AutomaticOutboxScheduler`; browser/Electron automatic runtimes"
        note = "Automatic outbox scheduling is implemented and starts whenever an endpoint is configured; no worker action is required."
    elif "outbox" in requirement and ("durable" in requirement or "pending" in requirement or "delivery" in requirement):
        status = "PASS"
        evidence = "`OutboxSyncService`; SQLite integration tests"
        note = "Durable pending events are processed oldest-first, marked delivered only after transport success, and retained with retry metadata on failure."
    elif ("cloud" in requirement or "remote" in requirement or "supabase" in requirement) and "sync" in haystack:
        status = "IMPLEMENTED_NOT_VALIDATED"
        evidence = "`HttpOutboxTransport`; automatic schedulers"
        note = "Repository delivery protocol is implemented, but live production ingestion is intentionally not validated/configured because the V2 backend remains unlinked until the user's manual post-planner setup."

    if status is None:
        out.append(line)
        continue
    parts[4] = evidence
    parts[5] = "Durable outbox delivery metadata"
    parts[6] = "Sync unit + SQLite integration tests; strict typecheck/build"
    parts[7] = status
    parts[8] = note
    out.append("| " + " | ".join(parts[1:-1]) + " |")

matrix.write_text("\n".join(out) + "\n")
