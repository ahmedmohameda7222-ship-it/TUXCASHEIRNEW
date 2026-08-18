from pathlib import Path
import json


def patch_package(path: str, additions: dict[str, str]) -> None:
    file = Path(path)
    data = json.loads(file.read_text())
    deps = data.setdefault("dependencies", {})
    deps.update(additions)
    data["dependencies"] = dict(sorted(deps.items()))
    file.write_text(json.dumps(data, indent=2) + "\n")


patch_package("apps/operations/package.json", {"@tux/sync": "*"})
patch_package("apps/operations-desktop/package.json", {"@tux/sync": "*"})

# Browser: automatic scheduler starts after all local stores and the shared coordinator exist.
p = Path("apps/operations/src/app/sessionClient.ts")
text = p.read_text()
if "startBrowserAutomaticSync" not in text:
    marker = "import { BrowserOrderPrinter } from './browserOrderPrinter';\n"
    if marker not in text:
        raise SystemExit("Browser OrderPrinter import marker missing")
    text = text.replace(marker, "import { startBrowserAutomaticSync } from './automaticSync';\n" + marker, 1)

runtime_marker = """      const runtime = {
        now: () => instant(new Date()),
        createUuid: () => crypto.randomUUID(),
      };
      return {
"""
if "startBrowserAutomaticSync({" not in text:
    if runtime_marker not in text:
        raise SystemExit("Browser runtime marker missing")
    text = text.replace(
        runtime_marker,
        """      const runtime = {
        now: () => instant(new Date()),
        createUuid: () => crypto.randomUUID(),
      };
      startBrowserAutomaticSync({ database, coordinator, now: runtime.now });
      return {
""",
        1,
    )
p.write_text(text)

# Electron: keep scheduler handle and stop it before closing local stores.
p = Path("apps/operations-desktop/src/main/index.ts")
text = p.read_text()
if "AutomaticOutboxScheduler" not in text:
    marker = "import { app, BrowserWindow, ipcMain } from 'electron';\n"
    if marker not in text:
        raise SystemExit("Electron import marker missing")
    text = text.replace(marker, "import type { AutomaticOutboxScheduler } from '@tux/sync';\n" + marker, 1)
if "startDesktopAutomaticSync" not in text:
    marker = "import { BulkStockIpcRuntime } from './bulkStockIpc';\n"
    if marker not in text:
        raise SystemExit("BulkStock IPC import marker missing")
    text = text.replace(marker, "import { startDesktopAutomaticSync } from './automaticSync';\n" + marker, 1)
if "let automaticSyncScheduler" not in text:
    marker = "let endDayIpcRuntime: EndDayIpcRuntime | null = null;\n"
    if marker not in text:
        raise SystemExit("End Day runtime variable marker missing")
    text = text.replace(marker, marker + "let automaticSyncScheduler: AutomaticOutboxScheduler | null = null;\n", 1)

end_day_init = """  endDayIpcRuntime = await EndDayIpcRuntime.create({
    databasePath,
    database: operationsDatabase,
    readModel: operatorReadModel,
    draftStore: orderDraftStore,
    runtime,
    coordinator,
  });
"""
if "automaticSyncScheduler = startDesktopAutomaticSync" not in text:
    if end_day_init not in text:
        raise SystemExit("End Day initialization marker missing")
    text = text.replace(
        end_day_init,
        end_day_init
        + """  automaticSyncScheduler = startDesktopAutomaticSync({
    database: operationsDatabase,
    coordinator,
    now: runtime.now,
  });
""",
        1,
    )
if "automaticSyncScheduler?.stop();" not in text:
    marker = "app.on('before-quit', () => {\n"
    if marker not in text:
        raise SystemExit("before-quit marker missing")
    text = text.replace(marker, marker + "  automaticSyncScheduler?.stop();\n", 1)
if "automaticSyncScheduler = null;" not in text:
    marker = "  endDayIpcRuntime = null;\n"
    if marker not in text:
        raise SystemExit("End Day cleanup marker missing")
    text = text.replace(marker, "  automaticSyncScheduler = null;\n" + marker, 1)
p.write_text(text)

# Configuration only; credentials/endpoints remain empty in repository.
p = Path(".env.example")
text = p.read_text().rstrip()
if "TUX_SYNC_ENDPOINT=" not in text:
    text += """

# Optional automatic outbox endpoint. Leave empty for honest local-only Operations.
TUX_SYNC_ENDPOINT=
TUX_SYNC_BEARER_TOKEN=
VITE_TUX_SYNC_ENDPOINT=
"""
p.write_text(text + "\n")
