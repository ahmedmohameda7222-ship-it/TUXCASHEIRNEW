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

const migrationPath =
  '../../../../supabase/migrations/20260910122100_admin_plan2_final_review_round7_hardening.sql';

describe('Plan 2 final review round 7 regressions', () => {
  it('captures service-hour row snapshots while refreshing the workspace settings CAS token', () => {
    const shops = source('./ShopsPage.tsx');

    expect(shops).toContain('WeeklyHoursRowEditor');
    expect(shops).toContain('SpecialHoursRowEditor');
    expect(shops).toContain(
      'const [expectedSettingsVersion, setExpectedSettingsVersion] = useState(settingsVersion)',
    );
    expect(shops.match(/setExpectedSettingsVersion\(settingsVersion\)/g)?.length).toBe(2);
    expect(shops).toContain('useState<WeeklyHoursExpectedRow>');
    expect(shops).toContain('useState<SpecialHoursExpectedRow>');
  });

  it('uses live closed state when reopening a special date', () => {
    const shops = source('./ShopsPage.tsx');

    expect(shops).toContain('useState(hours.closed)');
    expect(shops).toContain('checked={closed}');
    expect(shops).toContain('setClosed(event.currentTarget.checked)');
    expect(shops).toContain('disabled={busy || closed}');
  });

  it('uses second precision in the public hours authority', () => {
    const migration = sourceOrEmpty(migrationPath).toLowerCase();

    expect(migration).toContain('catalog_public_online_ordering_open_v1');
    expect(migration).toContain('catalog_public_local_second_v1');
    expect(migration).toContain('v_second_of_day');
    expect(migration).toContain('extract(second from v_local)');
  });
});
