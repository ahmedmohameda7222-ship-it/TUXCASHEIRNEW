from pathlib import Path


def replace(path: str, old: str, new: str) -> None:
    file = Path(path)
    source = file.read_text()
    count = source.count(old)
    if count != 1:
        raise SystemExit(f'{path}: expected exactly one match, found {count}: {old[:120]!r}')
    file.write_text(source.replace(old, new, 1))


replace(
    'apps/admin/server/settings/settingsService.ts',
    "import { requirePermission } from '../authorization';",
    "import { requireBusinessWidePermission, requirePermission } from '../authorization';",
)
replace(
    'apps/admin/server/settings/settingsService.ts',
    """    ): Promise<SettingWriteResult> {
      requirePermission(principal, 'settings.manage', input.shopId);
      return store.upsertBusinessDefault({ employeeId: principal.employeeId, ...input });
    },

    async upsertShopOverride(""",
    """    ): Promise<SettingWriteResult> {
      requireBusinessWidePermission(principal, 'settings.manage', input.shopId);
      return store.upsertBusinessDefault({ employeeId: principal.employeeId, ...input });
    },

    async upsertShopOverride(""",
)

replace(
    'packages/application/src/ordersBoard.ts',
    """    mode:
      configuration?.settings !== undefined && configuration?.settings !== null
        ? 'CONFIGURED'
        : 'LEGACY',
    reasons,
""",
    """    mode: reasons.length > 0 ? 'CONFIGURED' : 'LEGACY',
    reasons,
""",
)
