import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

const contracts = fs.readFileSync('packages/admin-contracts/src/settings.ts', 'utf8');
const scheduleApi = fs.readFileSync('apps/admin/api/admin/settings-schedule.ts', 'utf8');
const settingsHook = fs.readFileSync('apps/admin/src/settings/useSettings.ts', 'utf8');
const panel = fs.readFileSync('apps/admin/src/settings/SettingsSchedulePanel.tsx', 'utf8');

describe('durable SHOP_CONFIG schedule outcomes', () => {
  it('projects durable SHOP_CONFIG jobs through the trusted settings workspace boundary', () => {
    expect(contracts).toContain('AdminShopConfigSchedule');
    expect(contracts).toContain('shopConfigSchedules');
    expect(scheduleApi).toContain("'scheduled_config_changes'");
    expect(scheduleApi).toContain("change_kind: 'eq.SHOP_CONFIG'");
    expect(scheduleApi).toContain(
      "requirePermission(context.principal, 'settings.manage', shopId)",
    );
    expect(scheduleApi).toContain('business_id: `eq.${context.principal.businessId}`');
    expect(scheduleApi).toContain('shop_id: `eq.${shopId}`');
    expect(settingsHook).toContain('/api/admin/settings-schedule?shopId=${encodedShopId}');
    expect(settingsHook).toContain('shopConfigSchedules: scheduleList.schedules');
  });

  it('renders durable terminal and retryable outcomes instead of relying on submit-local state', () => {
    expect(panel).toContain('workspace.shopConfigSchedules');
    expect(panel).toContain('terminalFailure');
    expect(panel).toContain('nextAttemptAt');
    expect(panel).toContain('lastError');
    expect(panel).toContain('Reschedule required');
    expect(panel).toContain('Retry queued');
  });
});
