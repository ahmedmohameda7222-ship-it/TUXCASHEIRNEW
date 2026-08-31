-- Dedicated worker-scoped Menu Layout persistence for TUX Operations.
-- Additive/rollback-safe: worker_ui_preferences and all existing RPC overloads remain intact.
-- Repository migration only. Do not apply to a remote project from automated implementation tooling.

create table public.worker_menu_layouts (
  shop_id uuid not null references public.shops(id) on delete cascade,
  worker_id uuid not null references public.workers(id) on delete cascade,
  category_order jsonb not null default '[]'::jsonb,
  category_alignment text not null check (category_alignment in ('left', 'center', 'right')),
  product_order_by_category jsonb not null default '{}'::jsonb,
  layout_version bigint not null default 1 check (layout_version > 0),
  updated_at timestamptz not null default now(),
  primary key (shop_id, worker_id)
);

alter table public.worker_menu_layouts enable row level security;

create policy worker_menu_layouts_device_select
  on public.worker_menu_layouts for select to authenticated
  using ((select private.is_active_operations_device(shop_id)));

grant select on public.worker_menu_layouts to authenticated;

-- Convert the legacy global product order into per-category order while preserving
-- the legacy relative order inside each real, active catalog category. Stale,
-- inactive, malformed, and foreign-shop IDs are ignored. Accent color is untouched.
insert into public.worker_menu_layouts (
  shop_id,
  worker_id,
  category_order,
  category_alignment,
  product_order_by_category,
  layout_version,
  updated_at
)
select
  preferences.shop_id,
  preferences.worker_id,
  coalesce(valid_categories.category_order, '[]'::jsonb),
  preferences.category_alignment,
  coalesce(valid_products.product_order_by_category, '{}'::jsonb),
  greatest(preferences.server_version, 1),
  preferences.updated_at
from public.worker_ui_preferences preferences
left join lateral (
  select jsonb_agg(to_jsonb(category.id::text) order by requested.ordinality) as category_order
  from jsonb_array_elements_text(preferences.category_order) with ordinality
    as requested(category_id, ordinality)
  join public.menu_categories category
    on category.id::text = requested.category_id
   and category.shop_id = preferences.shop_id
   and category.active
) valid_categories on true
left join lateral (
  select jsonb_object_agg(grouped.category_id::text, grouped.product_ids) as product_order_by_category
  from (
    select
      product.category_id,
      jsonb_agg(to_jsonb(product.id::text) order by requested.ordinality) as product_ids
    from jsonb_array_elements_text(preferences.product_order) with ordinality
      as requested(product_id, ordinality)
    join public.products product
      on product.id::text = requested.product_id
     and product.shop_id = preferences.shop_id
     and product.active
    join public.menu_categories category
      on category.id = product.category_id
     and category.shop_id = preferences.shop_id
     and category.active
    group by product.category_id
  ) grouped
) valid_products on true
on conflict on constraint worker_menu_layouts_pkey do nothing;

create or replace function public.put_worker_menu_layout_v2(
  p_shop_id uuid,
  p_worker_id uuid,
  p_category_order jsonb,
  p_category_alignment text,
  p_product_order_by_category jsonb,
  p_expected_layout_version bigint
)
returns table(
  shop_id uuid,
  worker_id uuid,
  category_order jsonb,
  category_alignment text,
  product_order_by_category jsonb,
  layout_version bigint,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_category_text text;
  v_category_id uuid;
  v_category_key text;
  v_product_array jsonb;
  v_product_text text;
  v_product_id uuid;
  v_current_version bigint;
  v_seen_categories uuid[] := array[]::uuid[];
  v_seen_products uuid[] := array[]::uuid[];
  v_category_count integer := 0;
  v_product_count integer := 0;
begin
  if not (select private.is_active_operations_device(p_shop_id)) then
    raise exception 'TUX_WORKER_MENU_LAYOUT_UNAUTHORIZED';
  end if;

  if not exists (
    select 1
    from public.workers worker
    where worker.id = p_worker_id
      and worker.shop_id = p_shop_id
      and worker.active
  ) then
    raise exception 'TUX_WORKER_MENU_LAYOUT_WORKER_INVALID';
  end if;

  if p_category_alignment not in ('left', 'center', 'right') then
    raise exception 'TUX_WORKER_MENU_LAYOUT_ALIGNMENT_INVALID';
  end if;

  if p_category_order is null or jsonb_typeof(p_category_order) <> 'array' then
    raise exception 'TUX_WORKER_MENU_LAYOUT_CATEGORY_ORDER_INVALID';
  end if;
  if octet_length(p_category_order::text) > 32768 then
    raise exception 'TUX_WORKER_MENU_LAYOUT_CATEGORY_ORDER_TOO_LARGE';
  end if;
  if jsonb_array_length(p_category_order) > 256 then
    raise exception 'TUX_WORKER_MENU_LAYOUT_CATEGORY_COUNT_EXCEEDED';
  end if;

  for v_category_text in select value from jsonb_array_elements_text(p_category_order)
  loop
    if v_category_text is null or v_category_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
      raise exception 'TUX_WORKER_MENU_LAYOUT_CATEGORY_ID_INVALID';
    end if;
    v_category_id := v_category_text::uuid;
    if v_category_id = any(v_seen_categories) then
      raise exception 'TUX_WORKER_MENU_LAYOUT_CATEGORY_DUPLICATE';
    end if;
    v_seen_categories := array_append(v_seen_categories, v_category_id);
    if not exists (
      select 1 from public.menu_categories category
      where category.id = v_category_id
        and category.shop_id = p_shop_id
        and category.active
    ) then
      raise exception 'TUX_WORKER_MENU_LAYOUT_CATEGORY_REFERENCE_INVALID';
    end if;
  end loop;

  if p_product_order_by_category is null or jsonb_typeof(p_product_order_by_category) <> 'object' then
    raise exception 'TUX_WORKER_MENU_LAYOUT_PRODUCT_ORDER_INVALID';
  end if;
  if octet_length(p_product_order_by_category::text) > 262144 then
    raise exception 'TUX_WORKER_MENU_LAYOUT_PRODUCT_ORDER_TOO_LARGE';
  end if;

  select count(*) into v_category_count
  from jsonb_object_keys(p_product_order_by_category);
  if v_category_count > 256 then
    raise exception 'TUX_WORKER_MENU_LAYOUT_PRODUCT_CATEGORY_COUNT_EXCEEDED';
  end if;

  for v_category_key, v_product_array in
    select key, value from jsonb_each(p_product_order_by_category)
  loop
    if v_category_key !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
      raise exception 'TUX_WORKER_MENU_LAYOUT_PRODUCT_CATEGORY_ID_INVALID';
    end if;
    v_category_id := v_category_key::uuid;
    if not exists (
      select 1 from public.menu_categories category
      where category.id = v_category_id
        and category.shop_id = p_shop_id
        and category.active
    ) then
      raise exception 'TUX_WORKER_MENU_LAYOUT_PRODUCT_CATEGORY_REFERENCE_INVALID';
    end if;
    if jsonb_typeof(v_product_array) <> 'array' then
      raise exception 'TUX_WORKER_MENU_LAYOUT_PRODUCT_CATEGORY_VALUE_INVALID';
    end if;
    if jsonb_array_length(v_product_array) > 4096 then
      raise exception 'TUX_WORKER_MENU_LAYOUT_PRODUCT_CATEGORY_TOO_LARGE';
    end if;

    for v_product_text in select value from jsonb_array_elements_text(v_product_array)
    loop
      v_product_count := v_product_count + 1;
      if v_product_count > 4096 then
        raise exception 'TUX_WORKER_MENU_LAYOUT_PRODUCT_COUNT_EXCEEDED';
      end if;
      if v_product_text is null or v_product_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
        raise exception 'TUX_WORKER_MENU_LAYOUT_PRODUCT_ID_INVALID';
      end if;
      v_product_id := v_product_text::uuid;
      if v_product_id = any(v_seen_products) then
        raise exception 'TUX_WORKER_MENU_LAYOUT_PRODUCT_DUPLICATE';
      end if;
      v_seen_products := array_append(v_seen_products, v_product_id);
      if not exists (
        select 1 from public.products product
        where product.id = v_product_id
          and product.shop_id = p_shop_id
          and product.category_id = v_category_id
          and product.active
      ) then
        raise exception 'TUX_WORKER_MENU_LAYOUT_PRODUCT_REFERENCE_INVALID';
      end if;
    end loop;
  end loop;

  select layout.layout_version
    into v_current_version
  from public.worker_menu_layouts layout
  where layout.shop_id = p_shop_id
    and layout.worker_id = p_worker_id
  for update;

  if found then
    if p_expected_layout_version is null or p_expected_layout_version <> v_current_version then
      raise exception 'TUX_WORKER_MENU_LAYOUT_VERSION_CONFLICT' using errcode = '40001';
    end if;

    return query
    update public.worker_menu_layouts layout
      set category_order = p_category_order,
          category_alignment = p_category_alignment,
          product_order_by_category = p_product_order_by_category,
          layout_version = layout.layout_version + 1,
          updated_at = now()
      where layout.shop_id = p_shop_id
        and layout.worker_id = p_worker_id
      returning
        layout.shop_id,
        layout.worker_id,
        layout.category_order,
        layout.category_alignment,
        layout.product_order_by_category,
        layout.layout_version,
        layout.updated_at;
    return;
  end if;

  if p_expected_layout_version is not null then
    raise exception 'TUX_WORKER_MENU_LAYOUT_VERSION_CONFLICT' using errcode = '40001';
  end if;

  begin
    return query
    insert into public.worker_menu_layouts as layout (
      shop_id,
      worker_id,
      category_order,
      category_alignment,
      product_order_by_category,
      layout_version,
      updated_at
    ) values (
      p_shop_id,
      p_worker_id,
      p_category_order,
      p_category_alignment,
      p_product_order_by_category,
      1,
      now()
    )
    returning
      layout.shop_id,
      layout.worker_id,
      layout.category_order,
      layout.category_alignment,
      layout.product_order_by_category,
      layout.layout_version,
      layout.updated_at;
  exception
    when unique_violation then
      raise exception 'TUX_WORKER_MENU_LAYOUT_VERSION_CONFLICT' using errcode = '40001';
  end;
end;
$$;

revoke all on function public.put_worker_menu_layout_v2(uuid, uuid, jsonb, text, jsonb, bigint)
  from public, anon;
grant execute on function public.put_worker_menu_layout_v2(uuid, uuid, jsonb, text, jsonb, bigint)
  to authenticated;
