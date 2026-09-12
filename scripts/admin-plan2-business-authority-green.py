from pathlib import Path

path = Path('apps/admin/server/settings/settingsService.ts')
source = path.read_text()

old_import = "import { requirePermission } from '../authorization';"
new_import = "import { requireBusinessWidePermission, requirePermission } from '../authorization';"
if source.count(old_import) != 1:
    raise SystemExit('settings service authorization import guard failed')
source = source.replace(old_import, new_import, 1)

old_call = """    ): Promise<SettingWriteResult> {
      requirePermission(principal, 'settings.manage', input.shopId);
      return store.upsertBusinessDefault({ employeeId: principal.employeeId, ...input });
    },

    async upsertShopOverride("""
new_call = """    ): Promise<SettingWriteResult> {
      requireBusinessWidePermission(principal, 'settings.manage', input.shopId);
      return store.upsertBusinessDefault({ employeeId: principal.employeeId, ...input });
    },

    async upsertShopOverride("""
if source.count(old_call) != 1:
    raise SystemExit('business default service guard failed')
source = source.replace(old_call, new_call, 1)

path.write_text(source)
