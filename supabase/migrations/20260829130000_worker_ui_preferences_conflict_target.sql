-- Correct the worker UI preference RPC conflict target.
--
-- The six-argument function returns columns named shop_id and worker_id. In
-- PL/pgSQL those output names are variables, so ON CONFLICT (shop_id, worker_id)
-- is ambiguous. Target the table's primary-key constraint explicitly instead.
--
-- This is a forward-only corrective migration. Keep both the canonical six-argument
-- RPC and the five-argument compatibility overload introduced by the prior migration.

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
  on conflict on constraint worker_ui_preferences_pkey do update
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
