-- Preserve immutable CASH_VARIANCE reason-code identity in remote reconciliation history.
alter table public.reconciliation_lines
  add column variance_reason_code_snapshot jsonb
    check (
      variance_reason_code_snapshot is null
      or jsonb_typeof(variance_reason_code_snapshot) = 'object'
    );
