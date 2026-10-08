-- TUX Admin Plan 7: additive finance/report persistence and truthful actor provenance.
-- No finance account, payment mapping, or historical fact is synthesized.
-- Operations alone owns business_days status and closer metadata.

alter table public.expenses
  alter column created_by_worker_id drop not null,
  add column created_by_employee_id uuid,
  add constraint expenses_creator_provenance_ck
    check ((created_by_worker_id is null) <> (created_by_employee_id is null)),
  add constraint expenses_created_by_employee_fkey
    foreign key (created_by_employee_id)
    references public.business_employees(id) on delete restrict;

create or replace function private.enforce_plan7_expense_employee_scope_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
begin
  if new.created_by_employee_id is not null and not exists (
    select 1
    from public.business_employees e
    join public.business_shops bs on bs.business_id = e.business_id
    where e.id = new.created_by_employee_id and bs.shop_id = new.shop_id
  ) then
    raise exception using errcode = '23514', message = 'TUX_EXPENSE_EMPLOYEE_SCOPE_INVALID';
  end if;
  return new;
end;
$$;

create trigger expenses_plan7_employee_scope
before insert or update of created_by_employee_id, shop_id
on public.expenses
for each row execute function private.enforce_plan7_expense_employee_scope_v1();

alter table public.finance_movements
  alter column actor_employee_id drop not null,
  add column actor_worker_id uuid,
  add constraint finance_movements_actor_provenance_ck
    check (
      ((actor_employee_id is null) <> (actor_worker_id is null))
      and (actor_worker_id is null or shop_id is not null)
    ),
  add constraint finance_movements_actor_worker_shop_fkey
    foreign key (shop_id, actor_worker_id)
    references public.workers(shop_id, id) on delete restrict;

create table public.expense_categories (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  shop_id uuid,
  name text not null check (btrim(name) <> ''),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint expense_categories_business_shop_fkey
    foreign key (business_id, shop_id)
    references public.business_shops(business_id, shop_id) on delete restrict,
  constraint expense_categories_business_id_id_key unique (business_id, id),
  constraint expense_categories_scope_name_unique unique nulls not distinct (business_id, shop_id, name)
);

create table public.recurring_expense_rules (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  shop_id uuid not null,
  category_id uuid,
  description text not null check (btrim(description) <> ''),
  amount_minor bigint not null check (amount_minor > 0),
  cadence text not null check (cadence in ('DAILY', 'WEEKLY', 'MONTHLY')),
  next_due_date date not null,
  active boolean not null default true,
  version bigint not null default 1 check (version > 0),
  created_by_employee_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint recurring_expense_rules_business_shop_fkey
    foreign key (business_id, shop_id)
    references public.business_shops(business_id, shop_id) on delete restrict,
  constraint recurring_expense_rules_category_fkey
    foreign key (business_id, category_id)
    references public.expense_categories(business_id, id) on delete restrict,
  constraint recurring_expense_rules_actor_fkey
    foreign key (business_id, created_by_employee_id)
    references public.business_employees(business_id, id) on delete restrict
);

create table public.payment_settlements (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  shop_id uuid not null,
  source_account_id uuid not null,
  destination_account_id uuid not null,
  gross_minor bigint not null check (gross_minor > 0),
  fee_minor bigint not null check (fee_minor >= 0),
  net_minor bigint not null check (net_minor > 0),
  settled_on date not null,
  reference text,
  command_id text not null check (btrim(command_id) <> ''),
  request_fingerprint text not null check (request_fingerprint ~ '^[0-9a-f]{64}$'),
  created_by_employee_id uuid not null,
  created_at timestamptz not null default now(),
  constraint payment_settlements_business_shop_fkey
    foreign key (business_id, shop_id)
    references public.business_shops(business_id, shop_id) on delete restrict,
  constraint payment_settlements_source_fkey
    foreign key (business_id, source_account_id)
    references public.finance_accounts(business_id, id) on delete restrict,
  constraint payment_settlements_destination_fkey
    foreign key (business_id, destination_account_id)
    references public.finance_accounts(business_id, id) on delete restrict,
  constraint payment_settlements_actor_fkey
    foreign key (business_id, created_by_employee_id)
    references public.business_employees(business_id, id) on delete restrict,
  constraint payment_settlements_distinct_accounts_ck
    check (source_account_id <> destination_account_id),
  constraint payment_settlements_gross_net_fee_ck
    check (gross_minor = net_minor + fee_minor),
  constraint payment_settlements_command_unique unique (business_id, command_id)
);

create table public.end_day_financial_snapshots (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  shop_id uuid not null,
  business_day_id uuid not null,
  snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object'),
  request_fingerprint text not null check (request_fingerprint ~ '^[0-9a-f]{64}$'),
  finalization_command_id text not null check (btrim(finalization_command_id) <> ''),
  finalized_by_employee_id uuid not null,
  finalized_at timestamptz not null default now(),
  constraint end_day_financial_snapshots_business_shop_fkey
    foreign key (business_id, shop_id)
    references public.business_shops(business_id, shop_id) on delete restrict,
  constraint end_day_financial_snapshots_business_day_fkey
    foreign key (shop_id, business_day_id)
    references public.business_days(shop_id, id) on delete restrict,
  constraint end_day_financial_snapshots_finalizer_fkey
    foreign key (business_id, finalized_by_employee_id)
    references public.business_employees(business_id, id) on delete restrict,
  constraint end_day_financial_snapshots_one_per_day unique (business_id, shop_id, business_day_id),
  constraint end_day_financial_snapshots_business_shop_id_key unique (business_id, shop_id, id),
  constraint end_day_financial_snapshots_command_unique unique (business_id, finalization_command_id)
);

create table public.cashier_reconciliations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  shop_id uuid not null,
  business_day_id uuid not null,
  cashier_worker_id uuid not null,
  expected_minor bigint not null,
  actual_minor bigint not null check (actual_minor >= 0),
  variance_minor bigint generated always as (actual_minor - expected_minor) stored,
  variance_reason text,
  reviewed_by_employee_id uuid not null,
  posted_at timestamptz not null default now(),
  constraint cashier_reconciliations_business_shop_fkey
    foreign key (business_id, shop_id)
    references public.business_shops(business_id, shop_id) on delete restrict,
  constraint cashier_reconciliations_day_fkey
    foreign key (shop_id, business_day_id)
    references public.business_days(shop_id, id) on delete restrict,
  constraint cashier_reconciliations_worker_fkey
    foreign key (shop_id, cashier_worker_id)
    references public.workers(shop_id, id) on delete restrict,
  constraint cashier_reconciliations_reviewer_fkey
    foreign key (business_id, reviewed_by_employee_id)
    references public.business_employees(business_id, id) on delete restrict,
  constraint cashier_reconciliations_variance_reason_ck
    check (actual_minor = expected_minor or nullif(btrim(variance_reason), '') is not null),
  constraint cashier_reconciliations_one_per_day_cashier
    unique (business_id, shop_id, business_day_id, cashier_worker_id)
);

create table public.financial_adjustments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  shop_id uuid not null,
  snapshot_id uuid not null,
  amount_minor bigint not null check (amount_minor <> 0),
  reason text not null check (btrim(reason) <> ''),
  command_id text not null check (btrim(command_id) <> ''),
  created_by_employee_id uuid not null,
  created_at timestamptz not null default now(),
  constraint financial_adjustments_snapshot_fkey
    foreign key (business_id, shop_id, snapshot_id)
    references public.end_day_financial_snapshots(business_id, shop_id, id) on delete restrict,
  constraint financial_adjustments_actor_fkey
    foreign key (business_id, created_by_employee_id)
    references public.business_employees(business_id, id) on delete restrict,
  constraint financial_adjustments_command_unique unique (business_id, command_id)
);

create table public.saved_report_views (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  owner_employee_id uuid not null,
  shop_id uuid,
  name text not null check (btrim(name) <> ''),
  report_area text not null check (btrim(report_area) <> ''),
  filters jsonb not null default '{}'::jsonb check (jsonb_typeof(filters) = 'object'),
  layout jsonb not null default '{}'::jsonb check (jsonb_typeof(layout) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint report_views_business_employee_fkey
    foreign key (business_id, owner_employee_id)
    references public.business_employees(business_id, id) on delete cascade,
  constraint saved_report_views_business_shop_fkey
    foreign key (business_id, shop_id)
    references public.business_shops(business_id, shop_id) on delete restrict
);

create table public.report_targets (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  shop_id uuid not null,
  metric text not null check (metric in ('NET_SALES', 'ORDER_COUNT', 'FOOD_COST_PERCENT', 'WASTE')),
  period_start date not null,
  period_end date not null check (period_end >= period_start),
  target_value bigint not null check (target_value >= 0),
  updated_by_employee_id uuid not null,
  updated_at timestamptz not null default now(),
  constraint report_targets_business_shop_fkey
    foreign key (business_id, shop_id)
    references public.business_shops(business_id, shop_id) on delete restrict,
  constraint report_targets_actor_fkey
    foreign key (business_id, updated_by_employee_id)
    references public.business_employees(business_id, id) on delete restrict,
  constraint report_targets_scope_unique unique (business_id, shop_id, metric, period_start, period_end)
);

create table public.daily_owner_summaries (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  shop_id uuid not null,
  business_day_id uuid not null,
  summary jsonb not null check (jsonb_typeof(summary) = 'object'),
  source_fingerprint text not null check (source_fingerprint ~ '^[0-9a-f]{64}$'),
  generated_at timestamptz not null default now(),
  constraint daily_owner_summaries_business_shop_fkey
    foreign key (business_id, shop_id)
    references public.business_shops(business_id, shop_id) on delete restrict,
  constraint daily_owner_summaries_day_fkey
    foreign key (shop_id, business_day_id)
    references public.business_days(shop_id, id) on delete restrict,
  constraint daily_owner_summaries_one_per_day
    unique (business_id, shop_id, business_day_id)
);

-- Immutable posted records; corrections are separate financial_adjustments, never snapshot rewrites.
create or replace function private.prevent_plan7_immutable_fact_mutation()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  raise exception using errcode = '55000', message = 'TUX_PLAN7_FINANCIAL_FACT_IMMUTABLE';
end;
$$;

create trigger payment_settlements_immutable
before update or delete on public.payment_settlements
for each row execute function private.prevent_plan7_immutable_fact_mutation();
create trigger end_day_financial_snapshots_immutable
before update or delete on public.end_day_financial_snapshots
for each row execute function private.prevent_plan7_immutable_fact_mutation();
create trigger cashier_reconciliations_immutable
before update or delete on public.cashier_reconciliations
for each row execute function private.prevent_plan7_immutable_fact_mutation();
create trigger financial_adjustments_immutable
before update or delete on public.financial_adjustments
for each row execute function private.prevent_plan7_immutable_fact_mutation();
create trigger daily_owner_summaries_immutable
before update or delete on public.daily_owner_summaries
for each row execute function private.prevent_plan7_immutable_fact_mutation();

-- Default deny: only trusted server-side service role has table access.
-- Privileged business commands must provide their own permission and concurrency checks.
alter table public.expense_categories enable row level security;
alter table public.recurring_expense_rules enable row level security;
alter table public.payment_settlements enable row level security;
alter table public.end_day_financial_snapshots enable row level security;
alter table public.cashier_reconciliations enable row level security;
alter table public.financial_adjustments enable row level security;
alter table public.saved_report_views enable row level security;
alter table public.report_targets enable row level security;
alter table public.daily_owner_summaries enable row level security;

revoke all on public.expense_categories from public, anon, authenticated;
revoke all on public.recurring_expense_rules from public, anon, authenticated;
revoke all on public.payment_settlements from public, anon, authenticated;
revoke all on public.end_day_financial_snapshots from public, anon, authenticated;
revoke all on public.cashier_reconciliations from public, anon, authenticated;
revoke all on public.financial_adjustments from public, anon, authenticated;
revoke all on public.saved_report_views from public, anon, authenticated;
revoke all on public.report_targets from public, anon, authenticated;
revoke all on public.daily_owner_summaries from public, anon, authenticated;

grant select, insert, update on public.expense_categories to service_role;
grant select, insert, update on public.recurring_expense_rules to service_role;
grant select, insert on public.payment_settlements to service_role;
grant select, insert on public.end_day_financial_snapshots to service_role;
grant select, insert on public.cashier_reconciliations to service_role;
grant select, insert on public.financial_adjustments to service_role;
grant select, insert, update, delete on public.saved_report_views to service_role;
grant select, insert, update on public.report_targets to service_role;
grant select, insert on public.daily_owner_summaries to service_role;

revoke all on function private.enforce_plan7_expense_employee_scope_v1()
  from public, anon, authenticated;
revoke all on function private.prevent_plan7_immutable_fact_mutation()
  from public, anon, authenticated;
