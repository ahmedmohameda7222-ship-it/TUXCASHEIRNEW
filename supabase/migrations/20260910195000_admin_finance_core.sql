-- TUX Admin Plan 6: minimal shared Finance core.
-- Amount convention: positive values are account inflows; negative values are account outflows.
-- This migration intentionally creates no accounts, balances, payment mappings, settlements, or End Day state.

create table public.finance_accounts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  shop_id uuid,
  account_type text not null check (account_type in ('CASH', 'BANK', 'WALLET', 'PENDING_SETTLEMENT')),
  name text not null check (btrim(name) <> ''),
  active boolean not null default true,
  opening_balance_minor bigint not null default 0,
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint finance_accounts_business_id_fkey
    foreign key (business_id) references public.businesses(id) on delete restrict,
  constraint finance_accounts_business_shop_fkey
    foreign key (business_id, shop_id)
    references public.business_shops(business_id, shop_id) on delete restrict,
  constraint finance_accounts_business_id_id_key unique (business_id, id)
);

create table public.finance_movements (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  shop_id uuid,
  finance_account_id uuid not null,
  movement_type text not null check (
    movement_type in (
      'OPENING_FLOAT',
      'SALE',
      'REFUND',
      'PAY_IN',
      'PAY_OUT',
      'EXPENSE',
      'BANK_DEPOSIT',
      'TRANSFER_IN',
      'TRANSFER_OUT',
      'SETTLEMENT',
      'BANK_FEE',
      'OWNER_CONTRIBUTION',
      'OWNER_WITHDRAWAL',
      'STAFF_PAYMENT',
      'ADJUSTMENT'
    )
  ),
  amount_minor bigint not null check (amount_minor <> 0),
  command_id text not null check (btrim(command_id) <> ''),
  command_effect text not null default 'PRIMARY' check (btrim(command_effect) <> ''),
  request_fingerprint text not null check (request_fingerprint ~ '^[0-9a-f]{64}$'),
  actor_employee_id uuid not null,
  source_kind text,
  source_id text,
  source_effect text,
  created_at timestamptz not null default now(),
  constraint finance_movements_source_fields_check check (
    (source_kind is null and source_id is null and source_effect is null)
    or
    (
      source_kind is not null and btrim(source_kind) <> ''
      and source_id is not null and btrim(source_id) <> ''
      and source_effect is not null and btrim(source_effect) <> ''
    )
  ),
  constraint finance_movements_business_id_fkey
    foreign key (business_id) references public.businesses(id) on delete restrict,
  constraint finance_movements_business_shop_fkey
    foreign key (business_id, shop_id)
    references public.business_shops(business_id, shop_id) on delete restrict,
  constraint finance_movements_account_fkey
    foreign key (business_id, finance_account_id)
    references public.finance_accounts(business_id, id) on delete restrict,
  constraint finance_movements_actor_fkey
    foreign key (business_id, actor_employee_id)
    references public.business_employees(business_id, id) on delete restrict,
  constraint finance_movements_command_unique unique (business_id, command_id, command_effect)
);

create unique index finance_movements_source_unique
  on public.finance_movements (business_id, source_kind, source_id, source_effect)
  where source_kind is not null;

create index finance_movements_account_created_idx
  on public.finance_movements (business_id, finance_account_id, created_at desc, id);

create index finance_movements_shop_created_idx
  on public.finance_movements (business_id, shop_id, created_at desc, id);

create table public.payment_method_finance_accounts (
  business_id uuid not null,
  shop_id uuid not null,
  payment_method_id uuid not null,
  finance_account_id uuid not null,
  active boolean not null default true,
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (business_id, shop_id, payment_method_id),
  constraint payment_method_finance_accounts_business_shop_fkey
    foreign key (business_id, shop_id)
    references public.business_shops(business_id, shop_id) on delete restrict,
  constraint payment_method_finance_accounts_payment_method_fkey
    foreign key (shop_id, payment_method_id)
    references public.payment_methods(shop_id, id) on delete restrict,
  constraint payment_method_finance_accounts_account_fkey
    foreign key (business_id, finance_account_id)
    references public.finance_accounts(business_id, id) on delete restrict
);

create index payment_method_finance_accounts_account_idx
  on public.payment_method_finance_accounts (business_id, finance_account_id)
  where active;

create or replace function private.enforce_payment_method_finance_account_scope_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_account public.finance_accounts%rowtype;
begin
  select *
  into v_account
  from public.finance_accounts
  where business_id = new.business_id
    and id = new.finance_account_id
  for update;

  if not found then
    raise exception using errcode = '23503', message = 'TUX_FINANCE_ACCOUNT_SCOPE_INVALID';
  end if;
  if not v_account.active then
    raise exception using errcode = '23514', message = 'TUX_FINANCE_ACCOUNT_INACTIVE';
  end if;
  if v_account.shop_id is not null and v_account.shop_id <> new.shop_id then
    raise exception using errcode = '23514', message = 'TUX_FINANCE_ACCOUNT_SHOP_SCOPE_INVALID';
  end if;

  return new;
end;
$$;

create trigger payment_method_finance_accounts_scope
before insert or update of business_id, shop_id, payment_method_id, finance_account_id, active
on public.payment_method_finance_accounts
for each row
execute function private.enforce_payment_method_finance_account_scope_v1();

create or replace function private.prevent_active_finance_account_mapping_break_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
begin
  if old.active and not new.active
     and exists (
       select 1
       from public.payment_method_finance_accounts m
       where m.business_id = old.business_id
         and m.finance_account_id = old.id
         and m.active
     ) then
    raise exception using errcode = '23514', message = 'TUX_FINANCE_ACCOUNT_HAS_ACTIVE_MAPPING';
  end if;
  return new;
end;
$$;

create trigger finance_accounts_active_mapping_guard
before update of active
on public.finance_accounts
for each row
execute function private.prevent_active_finance_account_mapping_break_v1();

create or replace function private.prevent_finance_movement_mutation_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  raise exception using errcode = '55000', message = 'TUX_FINANCE_MOVEMENT_IMMUTABLE';
end;
$$;

create trigger finance_movements_immutable
before update or delete
on public.finance_movements
for each row
execute function private.prevent_finance_movement_mutation_v1();

create or replace function public.post_finance_movement_v1(
  p_employee_id uuid,
  p_shop_id uuid,
  p_finance_account_id uuid,
  p_movement_type text,
  p_amount_minor bigint,
  p_command_id text,
  p_source_kind text default null,
  p_source_id text default null,
  p_source_effect text default null,
  p_command_effect text default 'PRIMARY'
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private, extensions
as $$
declare
  v_authorized boolean;
  v_business_id uuid;
  v_account public.finance_accounts%rowtype;
  v_existing public.finance_movements%rowtype;
  v_movement_id uuid;
  v_required_permission text;
  v_source_kind text := nullif(btrim(p_source_kind), '');
  v_source_id text := nullif(btrim(p_source_id), '');
  v_source_effect text := nullif(btrim(p_source_effect), '');
  v_command_id text := nullif(btrim(p_command_id), '');
  v_command_effect text := nullif(btrim(p_command_effect), '');
  v_payload jsonb;
  v_fingerprint text;
begin
  if p_employee_id is null or p_shop_id is null or p_finance_account_id is null then
    return jsonb_build_object('ok', false, 'code', 'finance_scope_required');
  end if;
  if v_command_id is null or char_length(v_command_id) > 200 then
    return jsonb_build_object('ok', false, 'code', 'finance_command_invalid');
  end if;
  if v_command_effect is null or char_length(v_command_effect) > 80 then
    return jsonb_build_object('ok', false, 'code', 'finance_command_effect_invalid');
  end if;
  if p_movement_type not in (
    'OPENING_FLOAT','SALE','REFUND','PAY_IN','PAY_OUT','EXPENSE','BANK_DEPOSIT',
    'TRANSFER_IN','TRANSFER_OUT','SETTLEMENT','BANK_FEE','OWNER_CONTRIBUTION',
    'OWNER_WITHDRAWAL','STAFF_PAYMENT','ADJUSTMENT'
  ) then
    return jsonb_build_object('ok', false, 'code', 'finance_movement_type_invalid');
  end if;
  if p_amount_minor = 0 then
    return jsonb_build_object('ok', false, 'code', 'finance_amount_invalid');
  end if;

  -- Positive means money entering an account; negative means money leaving it.
  if (
    p_movement_type in ('OPENING_FLOAT','SALE','PAY_IN','BANK_DEPOSIT','TRANSFER_IN','OWNER_CONTRIBUTION')
    and p_amount_minor < 0
  ) or (
    p_movement_type in ('REFUND','PAY_OUT','EXPENSE','BANK_FEE','TRANSFER_OUT','OWNER_WITHDRAWAL','STAFF_PAYMENT')
    and p_amount_minor > 0
  ) then
    return jsonb_build_object('ok', false, 'code', 'finance_amount_sign_invalid');
  end if;

  if ((v_source_kind is null)::int + (v_source_id is null)::int + (v_source_effect is null)::int) not in (0, 3) then
    return jsonb_build_object('ok', false, 'code', 'finance_source_invalid');
  end if;

  v_required_permission :=
    case when p_movement_type = 'STAFF_PAYMENT' then 'staff.payments' else 'finance.adjust' end;

  select a.authorized, a.business_id
  into v_authorized, v_business_id
  from public.resolve_admin_authorization_v1(p_employee_id, p_shop_id, v_required_permission) a;

  if coalesce(v_authorized, false) is not true or v_business_id is null then
    return jsonb_build_object('ok', false, 'code', 'permission_forbidden');
  end if;

  v_payload := jsonb_build_object(
    'employeeId', p_employee_id,
    'shopId', p_shop_id,
    'accountId', p_finance_account_id,
    'movementType', p_movement_type,
    'amountMinor', p_amount_minor,
    'commandEffect', v_command_effect,
    'sourceKind', v_source_kind,
    'sourceId', v_source_id,
    'sourceEffect', v_source_effect
  );
  v_fingerprint := encode(extensions.digest(convert_to(v_payload::text, 'UTF8'), 'sha256'), 'hex');

  perform pg_advisory_xact_lock(
    hashtextextended(v_business_id::text || ':finance-command:' || v_command_id || ':' || v_command_effect, 0)
  );

  select *
  into v_existing
  from public.finance_movements
  where business_id = v_business_id
    and command_id = v_command_id
    and command_effect = v_command_effect;

  if found then
    if v_existing.request_fingerprint <> v_fingerprint then
      return jsonb_build_object('ok', false, 'code', 'finance_command_conflict');
    end if;
    return jsonb_build_object(
      'ok', true,
      'replayed', true,
      'movementId', v_existing.id,
      'businessId', v_existing.business_id,
      'shopId', v_existing.shop_id,
      'financeAccountId', v_existing.finance_account_id,
      'movementType', v_existing.movement_type,
      'amountMinor', v_existing.amount_minor
    );
  end if;

  select *
  into v_account
  from public.finance_accounts
  where business_id = v_business_id
    and id = p_finance_account_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'finance_account_forbidden');
  end if;
  if not v_account.active then
    return jsonb_build_object('ok', false, 'code', 'finance_account_inactive');
  end if;
  if v_account.shop_id is not null and v_account.shop_id <> p_shop_id then
    return jsonb_build_object('ok', false, 'code', 'finance_account_shop_forbidden');
  end if;

  if v_source_kind is not null then
    perform pg_advisory_xact_lock(
      hashtextextended(
        v_business_id::text || ':finance-source:' || v_source_kind || ':' || v_source_id || ':' || v_source_effect,
        0
      )
    );
    if exists (
      select 1
      from public.finance_movements
      where business_id = v_business_id
        and source_kind = v_source_kind
        and source_id = v_source_id
        and source_effect = v_source_effect
    ) then
      return jsonb_build_object('ok', false, 'code', 'finance_source_conflict');
    end if;
  end if;

  insert into public.finance_movements (
    business_id,
    shop_id,
    finance_account_id,
    movement_type,
    amount_minor,
    command_id,
    command_effect,
    request_fingerprint,
    actor_employee_id,
    source_kind,
    source_id,
    source_effect
  )
  values (
    v_business_id,
    p_shop_id,
    p_finance_account_id,
    p_movement_type,
    p_amount_minor,
    v_command_id,
    v_command_effect,
    v_fingerprint,
    p_employee_id,
    v_source_kind,
    v_source_id,
    v_source_effect
  )
  returning id into v_movement_id;

  return jsonb_build_object(
    'ok', true,
    'replayed', false,
    'movementId', v_movement_id,
    'businessId', v_business_id,
    'shopId', p_shop_id,
    'financeAccountId', p_finance_account_id,
    'movementType', p_movement_type,
    'amountMinor', p_amount_minor
  );
end;
$$;

alter table public.finance_accounts enable row level security;
alter table public.finance_movements enable row level security;
alter table public.payment_method_finance_accounts enable row level security;

revoke all on public.finance_accounts from public, anon, authenticated;
revoke all on public.finance_movements from public, anon, authenticated;
revoke all on public.payment_method_finance_accounts from public, anon, authenticated;

grant select on public.finance_accounts to service_role;
grant select on public.finance_movements to service_role;
grant select on public.payment_method_finance_accounts to service_role;

revoke all on function private.enforce_payment_method_finance_account_scope_v1() from public, anon, authenticated;
revoke all on function private.prevent_active_finance_account_mapping_break_v1() from public, anon, authenticated;
revoke all on function private.prevent_finance_movement_mutation_v1() from public, anon, authenticated;

revoke all on function public.post_finance_movement_v1(uuid, uuid, uuid, text, bigint, text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.post_finance_movement_v1(uuid, uuid, uuid, text, bigint, text, text, text, text, text)
  to service_role;

comment on table public.finance_accounts is
  'Plan 6/7 shared finance account identity. No fictional/default accounts are seeded.';
comment on table public.finance_movements is
  'Immutable account events. Signed convention: positive inflow, negative outflow.';
comment on table public.payment_method_finance_accounts is
  'Explicit shop payment-method to finance-account mapping; unmapped methods remain reconciliation gaps.';
