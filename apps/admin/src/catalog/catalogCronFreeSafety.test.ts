import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../../../..');
const file = (path: string) => readFileSync(resolve(root, path), 'utf8');

describe('Cron-free scheduler safety', () => {
  it('does not offer automatic catalog publication or recurring availability without a runner', () => {
    const review = file('apps/admin/src/catalog/PublishReviewPage.tsx');
    expect(review).not.toContain('<ScheduleEditor');
    expect(review).not.toContain('<RecurringAvailabilityEditor');
    expect(review).toContain('Automatic scheduling is unavailable');
    expect(review).toContain('Existing schedules');
  });

  it('does not accept new scheduled catalog, availability, or shop-settings commands', () => {
    const catalog = file('apps/admin/api/admin/catalog.ts');
    const settings = file('apps/admin/api/admin/settings-schedule.ts');
    expect(catalog).toContain("code: 'scheduler_unavailable'");
    expect(settings).toContain("error: 'scheduler_unavailable'");
  });

  it('exposes stored settings history without offering an unattended change', () => {
    const panel = file('apps/admin/src/settings/SettingsSchedulePanel.tsx');
    expect(panel).toContain('Automatic scheduling is unavailable');
    expect(panel).not.toContain('Schedule change');
  });

  it('does not depend on a Cron-specific HTTP bearer secret', () => {
    const scheduler = file('apps/admin/server/catalog/scheduler.ts');
    expect(scheduler).not.toContain('cronSecret');
    expect(scheduler).not.toContain('cron_secret_not_configured');
    expect(scheduler).not.toContain('handleCatalogSchedulerRequest');
  });
});
