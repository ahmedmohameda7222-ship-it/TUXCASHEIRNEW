-- Extend worker-scoped UI preferences with the synced system accent color.
-- This migration is committed for manual Supabase application by the operator.
-- Do not apply this migration from the implementation workflow.
--
-- Rollout compatibility: deploy this schema migration before deploying clients that
-- send p_accent_color. The deployed five-argument RPC remains available during the
-- transition and preserves the row's existing accent_color when layout-only clients
-- update preferences. After all deployed clients use the six-argument contract, the
-- compatibility overload can be retired in a later migration.

alter table public.worker_ui_preferences
  add column if not exists accent_color text;

alter table public.worker_ui_preferences
  drop constraint if exists worker_ui_preferences_accent_color_check;

alter table public.worker_ui_preferences
  add constraint worker_ui_preferences_accent_color_check
  check (accent_color is null or accent_color ~ '^#[0-9A-F]{6}$');

create or replace function public.put_worker_ui_preferences(
  p_shop_id uuid,
  p_worker_id uuid,
  p_category_order jsonb,
  p_category_alignment text,
  p_product_order jsonb,
  p_accent_color text
)
returns table(
  shop_id uuid,
  worker_id uuid,
  category_order jsonb,
  category_alignment text,
  product_order jsonb,
  accent_color text,
  server_version bigint,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
begin
  if not (select private.is_active_operations_device(p_shop_id)) then
    raise exception 'TUX_WORKER_UI_PREFERENCES_UNAUTHORIZED';
  end if;
  if not exists (
    select 1
    from public.workers worker
    where worker.id = p_worker_id
      and worker.shop_id = p_shop_id
      and worker.active
  ) then
    raise exception 'TUX_WORKER_UI_PREFERENCES_WORKER_INVALID';
  end if;
  if jsonb_typeof(p_category_order) <> 'array' then
    raise exception 'TUX_WORKER_UI_PREFERENCES_CATEGORY_ORDER_INVALID';
  end if;
  if jsonb_typeof(p_product_order) <> 'array' then
    raise exception 'TUX_WORKER_UI_PREFERENCES_PRODUCT_ORDER_INVALID';
  end if;
  if p_category_alignment not in ('left', 'center', 'right') then
    raise exception 'TUX_WORKER_UI_PREFERENCES_ALIGNMENT_INVALID';
  end if;
  if p_accent_color is not null and p_accent_color !~ '^#[0-9A-F]{6}$' then
    raise exception 'TUX_WORKER_UI_PREFERENCES_ACCENT_INVALID';
  end if;

  return query
  insert into public.worker_ui_preferences as preferences (
    shop_id,
    worker_id,
    category_order,
    category_alignment,
    product_order,
    accent_color,
    server_version,
    updated_at
  )
  values (
    p_shop_id,
    p_worker_id,
    p_category_order,
    p_category_alignment,
    p_product_order,
    p_accent_color,
    1,
    now()
  )
  on conflict (shop_id, worker_id) do update
    set category_order = excluded.category_order,
        category_alignment = excluded.category_alignment,
        product_order = excluded.product_order,
        accent_color = excluded.accent_color,
        server_version = preferences.server_version + 1,
        updated_at = now()
  returning
    preferences.shop_id,
    preferences.worker_id,
    preferences.category_order,
    preferences.category_alignment,
    preferences.product_order,
    preferences.accent_color,
    preferences.server_version,
    preferences.updated_at;
end;
$$;

revoke all on function public.put_worker_ui_preferences(uuid, uuid, jsonb, text, jsonb, text)
  from public, anon;
grant execute on function public.put_worker_ui_preferences(uuid, uuid, jsonb, text, jsonb, text)
  to authenticated;

create or replace function public.put_worker_ui_preferences(
  p_shop_id uuid,
  p_worker_id uuid,
  p_category_order jsonb,
  p_category_alignment text,
  p_product_order jsonb
)
returns table(
  shop_id uuid,
  worker_id uuid,
  category_order jsonb,
  category_alignment text,
  product_order jsonb,
  server_version bigint,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_accent_color text;
begin
  if not (select private.is_active_operations_device(p_shop_id)) then
    raise exception 'TUX_WORKER_UI_PREFERENCES_UNAUTHORIZED';
  end if;

  select preferences.accent_color
    into v_accent_color
  from public.worker_ui_preferences preferences
  where preferences.shop_id = p_shop_id
    and preferences.worker_id = p_worker_id;

  return query
  select
    updated.shop_id,
    updated.worker_id,
    updated.category_order,
    updated.category_alignment,
    updated.product_order,
    updated.server_version,
    updated.updated_at
  from public.put_worker_ui_preferences(
    p_shop_id,
    p_worker_id,
    p_category_order,
    p_category_alignment,
    p_product_order,
    v_accent_color
  ) updated;
end;
$$;

revoke all on function public.put_worker_ui_preferences(uuid, uuid, jsonb, text, jsonb)
  from public, anon;
grant execute on function public.put_worker_ui_preferences(uuid, uuid, jsonb, text, jsonb)
  to authenticated;
