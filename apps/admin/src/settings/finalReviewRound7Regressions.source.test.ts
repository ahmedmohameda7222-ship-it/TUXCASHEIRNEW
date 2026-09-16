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
  it('captures service-hour row CAS while refreshing pristine editors from canonical rows', () => {
    const shops = source('./ShopsPage.tsx');

    expect(shops).toContain('WeeklyHoursRowEditor');
    expect(shops).toContain('SpecialHoursRowEditor');
    expect(shops).toContain('reconcileWeeklyHoursEditorState');
    expect(shops).toContain('reconcileSpecialHoursEditorState');
    expect(shops).toContain('if (current.dirty) return current;');
    expect(shops).toContain('expectedSettingsVersion: settingsVersion');
    expect(shops).toContain('expectedRow: weeklyExpectedRow(hours)');
    expect(shops).toContain('expectedRow: specialExpectedRow(hours)');
    expect(shops).toContain('weeklyRemoteFingerprint(hours, settingsVersion)');
    expect(shops).toContain('specialRemoteFingerprint(hours, settingsVersion)');
  });

  it('uses live closed state when reopening a special date', () => {
    const shops = source('./ShopsPage.tsx');

    expect(shops).toContain('closed: hours.closed');
    expect(shops).toContain('checked={editor.closed}');
    expect(shops).toContain('closed: value');
    expect(shops).toContain('disabled={busy || editor.closed}');
  });

  it('uses second precision in the public hours authority', () => {
    const migration = sourceOrEmpty(migrationPath).toLowerCase();

    expect(migration).toContain('catalog_public_online_ordering_open_v1');
    expect(migration).toContain('catalog_public_local_second_v1');
    expect(migration).toContain('v_second_of_day');
    expect(migration).toContain('extract(second from v_local)');
  });
});
