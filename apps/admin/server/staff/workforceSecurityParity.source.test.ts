import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  new URL(
    '../../../../supabase/migrations/20261015013000_admin_workforce_security_parity.sql',
    import.meta.url,
  ),
  'utf8',
).toLowerCase();

describe('Plan 6 deployed workforce security parity', () => {
  it('requires privileged new employees to be promoted through role approvals', () => {
    expect(sql).toContain('create or replace function public.create_employee_v1');
    expect(sql).toContain("if p_role <> 'staff' then");
    expect(sql).toContain('initial_role_requires_promotion');
    expect(sql).toContain('role_escalation_forbidden');
  });

  it('fingerprints inactive linked workers, not only active workers', () => {
    expect(sql).toContain('private.workforce_worker_state_fingerprint_v1');
    expect(sql).toContain('w.active or l.employee_id = p_employee_id');
  });

  it('retains service-role-only exposure for the trusted writer', () => {
    expect(sql).toContain('revoke all on function public.create_employee_v1');
    expect(sql).toContain('grant execute on function public.create_employee_v1');
    expect(sql).toContain('to service_role');
    expect(sql).not.toContain('drop table');
    expect(sql).not.toContain('update public.business_employees');
  });
});
