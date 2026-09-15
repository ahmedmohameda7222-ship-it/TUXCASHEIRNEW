import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

function source(path: string): string {
  return readFileSync(new URL(path, import.meta.url), 'utf8');
}

function sourceOrEmpty(path: string): string {
  try {
    return source(path);
  } catch {
    return '';
  }
}

const hoursPrecisionMigrationPath =
  '../../../../supabase/migrations/20260910122100_admin_plan2_final_review_round7_hardening.sql';

describe('Plan 2 final review round 7 regressions', () => {
  it('captures weekly and special hour CAS fences when each editor begins', () => {
    const shops = source('./ShopsPage.tsx');

    expect(shops).toContain('function WeeklyHoursRowEditor');
    expect(shops).toContain('function SpecialHoursRowEditor');
    expect(shops.match(/const \[expectedSettingsVersion\] = useState\(settingsVersion\);/g)).toHaveLength(2);
    expect(shops).toContain('const [expectedRow] = useState<WeeklyHoursExpectedRow>');
    expect(shops).toContain('const [expectedRow] = useState<SpecialHoursExpectedRow>');
  });

  it('uses live special-hours form state when reopening an all-day closure', () => {
    const shops = source('./ShopsPage.tsx');

    expect(shops).toContain('const [closed, setClosed] = useState(hours.closed);');
    expect(shops).toContain('checked={closed}');
    expect(shops).toContain('onChange={(event) => setClosed(event.currentTarget.checked)}');
    expect(shops.match(/disabled=\{busy \|\| closed\}/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
  });

  it('adds a second-precision public service-hours migration instead of truncating to minutes', () => {
    const migration = sourceOrEmpty(hoursPrecisionMigrationPath).toLowerCase();

    expect(migration).toContain('catalog_public_online_ordering_open_v1');
    expect(migration).toContain('catalog_public_local_second_v1');
    expect(migration).toContain('v_second_of_day');
    expect(migration).toContain('extract(second from v_local)');
  });
});
