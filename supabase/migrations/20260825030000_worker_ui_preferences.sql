-- TUX POS worker-scoped UI preferences.
-- This state is intentionally separate from the business-event outbox.

create table if not exists public.worker_ui_preferences (
  shop_id uuid not null references public.shops(id) on delete cascade,
  worker_id uuid not null references public.workers(id) on delete cascade,
  category_order jsonb not null default '[]'::jsonb,
  category_alignment text not null check (category_alignment in ('left','center','right')),
  server_version bigint not null default 1,
  updated_at timestamptz not null default now(),
  primary key (shop_id, worker_id)
);

alter table public.worker_ui_preferences enable row level security;

create policy worker_ui_preferences_device_select
  on public.worker_ui_preferences for select to authenticated
  using ((select private.is_active_operations_device(shop_id)));

grant select on public.worker_ui_preferences to authenticated;

create or replace function public.put_worker_ui_preferences(
  p_shop_id uuid,
  p_worker_id uuid,
  p_category_order jsonb,
  p_category_alignment text
)
returns table(
  shop_id uuid,
  worker_id uuid,
  category_order jsonb,
  category_alignment text,
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
  if p_category_alignment not in ('left', 'center', 'right') then
    raise exception 'TUX_WORKER_UI_PREFERENCES_ALIGNMENT_INVALID';
  end if;

  return query
  insert into public.worker_ui_preferences as preferences (
    shop_id,
    worker_id,
    category_order,
    category_alignment,
    server_version,
    updated_at
  )
  values (
    p_shop_id,
    p_worker_id,
    p_category_order,
    p_category_alignment,
    1,
    now()
  )
  on conflict (shop_id, worker_id) do update
    set category_order = excluded.category_order,
        category_alignment = excluded.category_alignment,
        server_version = preferences.server_version + 1,
        updated_at = now()
  returning
    preferences.shop_id,
    preferences.worker_id,
    preferences.category_order,
    preferences.category_alignment,
    preferences.server_version,
    preferences.updated_at;
end;
$$;

revoke all on function public.put_worker_ui_preferences(uuid, uuid, jsonb, text)
  from public, anon;
grant execute on function public.put_worker_ui_preferences(uuid, uuid, jsonb, text)
  to authenticated;
