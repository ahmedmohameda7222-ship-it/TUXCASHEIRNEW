from pathlib import Path
import subprocess

BASELINE_CI_COMMIT = "6579e21c3c8f0224dc5c4bd1557b0d0c089b871c"

# Restore the permanent CI definition exactly as it stood at the valid C RED
# commit. The task-c jobs/scripts below were one-shot transport only and must
# not remain part of the final repository authority.
result = subprocess.run(
    ["git", "show", f"{BASELINE_CI_COMMIT}:.github/workflows/ci.yml"],
    check=True,
    capture_output=True,
    text=True,
)
Path(".github/workflows/ci.yml").write_text(result.stdout)

for path in (
    ".github/workflows/task-c-green.yml",
    "docs/superpowers/audits/task-c-green-trigger.tmp.md",
    "scripts/task-c-green.py",
    "scripts/task-c-green-v2.py",
):
    Path(path).unlink(missing_ok=True)
