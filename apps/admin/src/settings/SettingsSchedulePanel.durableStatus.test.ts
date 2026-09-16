import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

const contracts = fs.readFileSync('packages/admin-contracts/src/settings.ts', 'utf8');
const service = fs.readFileSync('apps/admin/server/settings/settingsService.ts', 'utf8');
const panel = fs.readFileSync('apps/admin/src/settings/SettingsSchedulePanel.tsx', 'utf8');

describe('durable SHOP_CONFIG schedule outcomes', () => {
  it('projects durable SHOP_CONFIG jobs through the settings workspace', () => {
    expect(contracts).toContain('AdminShopConfigSchedule');
    expect(contracts).toContain('shopConfigSchedules');
    expect(service).toContain("'scheduled_config_changes'");
    expect(service).toContain("change_kind: 'eq.SHOP_CONFIG'");
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
