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

describe('Plan 2 final Codex review regressions', () => {
  it('rebases scheduled drafts only across recurring availability versions and preserves live transient sold-out state', () => {
    const migration = sourceOrEmpty(
      '../../../../supabase/migrations/20260910121700_admin_plan2_final_codex_hardening.sql',
    );

    expect(migration).toContain('publish_catalog_draft_scheduled_v1');
    expect(migration).toContain("source_kind <> 'RECURRING_AVAILABILITY'");
    expect(migration).toContain("'{soldOut}'");
    expect(migration).toContain('base_publish_version = v_current_publish_version');
  });

  it('claims adjacent recurring EXIT before ENTER even at the scheduler limit boundary', () => {
    const migration = sourceOrEmpty(
      '../../../../supabase/migrations/20260910121700_admin_plan2_final_codex_hardening.sql',
    );

    expect(migration).toContain("payload_json ->> 'transition' = 'EXIT'");
    expect(migration).toContain("payload_json ->> 'transition' = 'ENTER'");
    expect(migration).toContain('transition_priority');
  });

  it('provides trusted immediate Admin controls for temporary closure and online-order pause', () => {
    const contracts = source('../../../../packages/admin-contracts/src/settings.ts');
    const operationalStateService = source('../../server/settings/settingsOperationalState.ts');
    const hook = source('../settings/useSettings.ts');
    const shopsPage = source('../settings/ShopsPage.tsx');
    const migration = sourceOrEmpty(
      '../../../../supabase/migrations/20260910121700_admin_plan2_final_codex_hardening.sql',
    );

    expect(contracts).toContain("type: 'shop.operational-state.update'");
    expect(operationalStateService).toContain('updateShopOperationalState');
    expect(operationalStateService).toContain('update_admin_shop_operational_state_v1');
    expect(hook).toContain('updateOperationalState');
    expect(shopsPage).toContain('Temporarily close shop');
    expect(shopsPage).toContain('Pause online orders');
    expect(migration).toContain('update_admin_shop_operational_state_v1');
    expect(migration).toContain('publish_shop_settings_v1');
  });

  it('allows removing inactive advanced relations without allowing new inactive relations', () => {
    const editor = source('./ProductEditor.tsx');

    expect(editor).toContain('!modifier.active && !linked');
    expect(editor).toContain('!option.active && !selected');
    expect(editor).toContain("!item.active && quantity === ''");
  });
});
