import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationPath = resolve(
  process.cwd(),
  'supabase/migrations/20260828150000_worker_ui_preferences_accent_color.sql',
);

describe('worker UI preference accent-color migration', () => {
  it('adds canonical nullable accent storage and upgrades the authorized RPC contract', () => {
    expect(existsSync(migrationPath)).toBe(true);
    if (!existsSync(migrationPath)) return;

    const sql = readFileSync(migrationPath, 'utf8');
    expect(sql).toContain('add column if not exists accent_color text');
    expect(sql).toContain('worker_ui_preferences_accent_color_check');
    expect(sql).toContain("accent_color is null or accent_color ~ '^#[0-9A-F]{6}$'");
    expect(sql).toContain(
      'drop function if exists public.put_worker_ui_preferences(uuid, uuid, jsonb, text, jsonb)',
    );
    expect(sql).toContain('p_accent_color text');
    expect(sql).toContain('TUX_WORKER_UI_PREFERENCES_ACCENT_INVALID');
    expect(sql).toContain('accent_color = excluded.accent_color');
    expect(sql).toContain('preferences.accent_color');
    expect(sql).toContain(
      'grant execute on function public.put_worker_ui_preferences(uuid, uuid, jsonb, text, jsonb, text)',
    );
  });
});
