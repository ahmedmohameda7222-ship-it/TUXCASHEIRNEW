-- TUX Phase B canonical catalog Admin command authority.
-- Repository migration only. Do not apply remotely without explicit production authorization.

create table public.catalog_admin_command_receipts (
  shop_id uuid not null references public.shops(id) on delete restrict,
  command_id uuid not null,
  auth_user_id uuid not null,
  command_json jsonb not null,
  result_json jsonb not null,
  created_at timestamptz not null default now(),
  primary key (shop_id, command_id)
);

create index catalog_admin_command_receipts_user_idx
  on public.catalog_admin_command_receipts(auth_user_id, created_at desc);

create or replace function public.apply_catalog_admin_command_v1(
  p_auth_user_id uuid,
  p_shop_id uuid,
  p_command_id uuid,
  p_command jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_membership_role text;
  v_membership_active boolean;
  v_existing_command jsonb;
  v_existing_result jsonb;
  v_type text := p_command ->> 'type';
  v_patch jsonb;
  v_result jsonb;
  v_previous_image_key text;
  v_row_count integer;
begin
  if p_auth_user_id is null or p_shop_id is null or p_command_id is null then
    return jsonb_build_object('errorCode', 'invalid_request');
  end if;

  select sm.role, sm.active
    into v_membership_role, v_membership_active
  from public.shop_memberships sm
  where sm.shop_id = p_shop_id
    and sm.auth_user_id = p_auth_user_id;

  if not found then
    return jsonb_build_object('errorCode', 'membership_required');
  end if;
  if not v_membership_active then
    return jsonb_build_object('errorCode', 'membership_inactive');
  end if;
  if v_membership_role not in ('OWNER', 'ADMIN') then
    return jsonb_build_object('errorCode', 'role_forbidden');
  end if;

  -- Serialize retries for one command identity. The receipt makes CREATE and
  -- multi-row commands safe to retry without introducing an event-sourcing system.
  perform pg_advisory_xact_lock(hashtextextended(p_shop_id::text || ':' || p_command_id::text, 0));

  select r.command_json, r.result_json
    into v_existing_command, v_existing_result
  from public.catalog_admin_command_receipts r
  where r.shop_id = p_shop_id and r.command_id = p_command_id;

  if found then
    if v_existing_command is distinct from p_command then
      return jsonb_build_object('errorCode', 'command_conflict');
    end if;
    return v_existing_result || jsonb_build_object('idempotentReplay', true);
  end if;

  if v_type = 'category.create' then
    if exists(select 1 from public.menu_categories where id = (p_command #>> '{category,id}')::uuid) then
      return jsonb_build_object('errorCode', 'command_conflict');
    end if;
    insert into public.menu_categories(id, shop_id, slug, name, description, active, sort_order)
    values (
      (p_command #>> '{category,id}')::uuid,
      p_shop_id,
      p_command #>> '{category,slug}',
      p_command #>> '{category,name}',
      p_command #>> '{category,description}',
      coalesce((p_command #>> '{category,active}')::boolean, true),
      (p_command #>> '{category,sortOrder}')::integer
    );
    v_result := jsonb_build_object('status', 'applied', 'categoryId', p_command #>> '{category,id}');

  elsif v_type = 'category.update' then
    v_patch := p_command -> 'patch';
    update public.menu_categories c
    set slug = case when v_patch ? 'slug' then v_patch ->> 'slug' else c.slug end,
        name = case when v_patch ? 'name' then v_patch ->> 'name' else c.name end,
        description = case when v_patch ? 'description' then v_patch ->> 'description' else c.description end,
        active = case when v_patch ? 'active' then (v_patch ->> 'active')::boolean else c.active end,
        sort_order = case when v_patch ? 'sortOrder' then (v_patch ->> 'sortOrder')::integer else c.sort_order end,
        updated_at = now()
    where c.id = (p_command ->> 'categoryId')::uuid and c.shop_id = p_shop_id;
    get diagnostics v_row_count = row_count;
    if v_row_count <> 1 then return jsonb_build_object('errorCode', 'entity_not_found'); end if;
    v_result := jsonb_build_object('status', 'applied', 'categoryId', p_command ->> 'categoryId');

  elsif v_type = 'category.retire' then
    if not exists(
      select 1 from public.menu_categories c
      where c.id = (p_command ->> 'categoryId')::uuid and c.shop_id = p_shop_id
    ) then
      return jsonb_build_object('errorCode', 'entity_not_found');
    end if;
    update public.products p
      set active = false, updated_at = now()
    where p.shop_id = p_shop_id and p.category_id = (p_command ->> 'categoryId')::uuid;
    update public.menu_categories c
      set active = false, updated_at = now()
    where c.shop_id = p_shop_id and c.id = (p_command ->> 'categoryId')::uuid;
    v_result := jsonb_build_object('status', 'retired', 'categoryId', p_command ->> 'categoryId');

  elsif v_type = 'category.reorder' then
    update public.menu_categories c
      set sort_order = (p_command ->> 'sortOrder')::integer, updated_at = now()
    where c.id = (p_command ->> 'categoryId')::uuid and c.shop_id = p_shop_id;
    get diagnostics v_row_count = row_count;
    if v_row_count <> 1 then return jsonb_build_object('errorCode', 'entity_not_found'); end if;
    v_result := jsonb_build_object('status', 'applied', 'categoryId', p_command ->> 'categoryId');

  elsif v_type = 'product.create' then
    if exists(select 1 from public.products where id = (p_command #>> '{product,id}')::uuid) then
      return jsonb_build_object('errorCode', 'command_conflict');
    end if;
    if not exists(
      select 1 from public.menu_categories c
      where c.id = (p_command #>> '{product,categoryId}')::uuid and c.shop_id = p_shop_id
    ) then
      return jsonb_build_object('errorCode', 'entity_not_found');
    end if;
    if (p_command #>> '{product,imageKey}') is not null
       and (p_command #>> '{product,imageKey}') not like p_shop_id::text || '/%' then
      return jsonb_build_object('errorCode', 'image_key_forbidden');
    end if;
    insert into public.products(
      id, shop_id, category_id, slug, name, description, price_minor, image_key,
      best_seller, active, sold_out, is_combo, sort_order
    ) values (
      (p_command #>> '{product,id}')::uuid,
      p_shop_id,
      (p_command #>> '{product,categoryId}')::uuid,
      p_command #>> '{product,slug}',
      p_command #>> '{product,name}',
      p_command #>> '{product,description}',
      (p_command #>> '{product,priceMinor}')::bigint,
      p_command #>> '{product,imageKey}',
      (p_command #>> '{product,bestSeller}')::boolean,
      (p_command #>> '{product,active}')::boolean,
      (p_command #>> '{product,soldOut}')::boolean,
      (p_command #>> '{product,isCombo}')::boolean,
      (p_command #>> '{product,sortOrder}')::integer
    );
    v_result := jsonb_build_object('status', 'applied', 'productId', p_command #>> '{product,id}');

  elsif v_type = 'product.update' then
    v_patch := p_command -> 'patch';
    update public.products p
    set slug = case when v_patch ? 'slug' then v_patch ->> 'slug' else p.slug end,
        name = case when v_patch ? 'name' then v_patch ->> 'name' else p.name end,
        description = case when v_patch ? 'description' then v_patch ->> 'description' else p.description end,
        price_minor = case when v_patch ? 'priceMinor' then (v_patch ->> 'priceMinor')::bigint else p.price_minor end,
        best_seller = case when v_patch ? 'bestSeller' then (v_patch ->> 'bestSeller')::boolean else p.best_seller end,
        active = case when v_patch ? 'active' then (v_patch ->> 'active')::boolean else p.active end,
        sold_out = case when v_patch ? 'soldOut' then (v_patch ->> 'soldOut')::boolean else p.sold_out end,
        sold_out_updated_at = case when v_patch ? 'soldOut' then now() else p.sold_out_updated_at end,
        sold_out_by_worker_id = case when v_patch ? 'soldOut' then null else p.sold_out_by_worker_id end,
        is_combo = case when v_patch ? 'isCombo' then (v_patch ->> 'isCombo')::boolean else p.is_combo end,
        sort_order = case when v_patch ? 'sortOrder' then (v_patch ->> 'sortOrder')::integer else p.sort_order end,
        updated_at = now()
    where p.id = (p_command ->> 'productId')::uuid and p.shop_id = p_shop_id;
    get diagnostics v_row_count = row_count;
    if v_row_count <> 1 then return jsonb_build_object('errorCode', 'entity_not_found'); end if;
    v_result := jsonb_build_object('status', 'applied', 'productId', p_command ->> 'productId');

  elsif v_type = 'product.retire' then
    update public.products p
      set active = false, updated_at = now()
    where p.id = (p_command ->> 'productId')::uuid and p.shop_id = p_shop_id;
    get diagnostics v_row_count = row_count;
    if v_row_count <> 1 then return jsonb_build_object('errorCode', 'entity_not_found'); end if;
    v_result := jsonb_build_object('status', 'retired', 'productId', p_command ->> 'productId');

  elsif v_type = 'product.move' then
    if not exists(
      select 1 from public.menu_categories c
      where c.id = (p_command ->> 'categoryId')::uuid and c.shop_id = p_shop_id
    ) then
      return jsonb_build_object('errorCode', 'entity_not_found');
    end if;
    update public.products p
      set category_id = (p_command ->> 'categoryId')::uuid, updated_at = now()
    where p.id = (p_command ->> 'productId')::uuid and p.shop_id = p_shop_id;
    get diagnostics v_row_count = row_count;
    if v_row_count <> 1 then return jsonb_build_object('errorCode', 'entity_not_found'); end if;
    v_result := jsonb_build_object('status', 'applied', 'productId', p_command ->> 'productId');

  elsif v_type = 'product.reorder' then
    update public.products p
      set sort_order = (p_command ->> 'sortOrder')::integer, updated_at = now()
    where p.id = (p_command ->> 'productId')::uuid and p.shop_id = p_shop_id;
    get diagnostics v_row_count = row_count;
    if v_row_count <> 1 then return jsonb_build_object('errorCode', 'entity_not_found'); end if;
    v_result := jsonb_build_object('status', 'applied', 'productId', p_command ->> 'productId');

  elsif v_type = 'modifier.create' then
    if exists(select 1 from public.modifiers where id = (p_command #>> '{modifier,id}')::uuid) then
      return jsonb_build_object('errorCode', 'command_conflict');
    end if;
    insert into public.modifiers(id, shop_id, name, price_minor, active, sort_order)
    values (
      (p_command #>> '{modifier,id}')::uuid,
      p_shop_id,
      p_command #>> '{modifier,name}',
      (p_command #>> '{modifier,priceMinor}')::bigint,
      (p_command #>> '{modifier,active}')::boolean,
      (p_command #>> '{modifier,sortOrder}')::integer
    );
    v_result := jsonb_build_object('status', 'applied', 'modifierId', p_command #>> '{modifier,id}');

  elsif v_type = 'modifier.update' then
    v_patch := p_command -> 'patch';
    update public.modifiers m
    set name = case when v_patch ? 'name' then v_patch ->> 'name' else m.name end,
        price_minor = case when v_patch ? 'priceMinor' then (v_patch ->> 'priceMinor')::bigint else m.price_minor end,
        active = case when v_patch ? 'active' then (v_patch ->> 'active')::boolean else m.active end,
        sort_order = case when v_patch ? 'sortOrder' then (v_patch ->> 'sortOrder')::integer else m.sort_order end,
        updated_at = now()
    where m.id = (p_command ->> 'modifierId')::uuid and m.shop_id = p_shop_id;
    get diagnostics v_row_count = row_count;
    if v_row_count <> 1 then return jsonb_build_object('errorCode', 'entity_not_found'); end if;
    v_result := jsonb_build_object('status', 'applied', 'modifierId', p_command ->> 'modifierId');

  elsif v_type = 'modifier.retire' then
    update public.modifiers m
      set active = false, updated_at = now()
    where m.id = (p_command ->> 'modifierId')::uuid and m.shop_id = p_shop_id;
    get diagnostics v_row_count = row_count;
    if v_row_count <> 1 then return jsonb_build_object('errorCode', 'entity_not_found'); end if;
    v_result := jsonb_build_object('status', 'retired', 'modifierId', p_command ->> 'modifierId');

  elsif v_type = 'product_modifier_link.set' then
    if not exists(select 1 from public.products p where p.id = (p_command ->> 'productId')::uuid and p.shop_id = p_shop_id)
       or not exists(select 1 from public.modifiers m where m.id = (p_command ->> 'modifierId')::uuid and m.shop_id = p_shop_id) then
      return jsonb_build_object('errorCode', 'entity_not_found');
    end if;
    insert into public.product_modifiers(shop_id, product_id, modifier_id, max_quantity, sort_order)
    values (
      p_shop_id,
      (p_command ->> 'productId')::uuid,
      (p_command ->> 'modifierId')::uuid,
      (p_command ->> 'maxQuantity')::integer,
      (p_command ->> 'sortOrder')::integer
    )
    on conflict (product_id, modifier_id) do update
      set shop_id = excluded.shop_id,
          max_quantity = excluded.max_quantity,
          sort_order = excluded.sort_order;
    v_result := jsonb_build_object('status', 'applied');

  elsif v_type = 'product_modifier_link.remove' then
    delete from public.product_modifiers pm
    where pm.shop_id = p_shop_id
      and pm.product_id = (p_command ->> 'productId')::uuid
      and pm.modifier_id = (p_command ->> 'modifierId')::uuid;
    v_result := jsonb_build_object('status', 'applied');

  elsif v_type = 'combo_beverage_option.set' then
    if (p_command ->> 'comboProductId') = (p_command ->> 'beverageProductId') then
      return jsonb_build_object('errorCode', 'invalid_request');
    end if;
    if not exists(
      select 1 from public.products p
      where p.id = (p_command ->> 'comboProductId')::uuid and p.shop_id = p_shop_id and p.is_combo = true
    ) or not exists(
      select 1 from public.products p
      where p.id = (p_command ->> 'beverageProductId')::uuid and p.shop_id = p_shop_id
    ) then
      return jsonb_build_object('errorCode', 'entity_not_found');
    end if;
    insert into public.combo_beverage_options(shop_id, combo_product_id, beverage_product_id, sort_order)
    values (
      p_shop_id,
      (p_command ->> 'comboProductId')::uuid,
      (p_command ->> 'beverageProductId')::uuid,
      (p_command ->> 'sortOrder')::integer
    )
    on conflict (combo_product_id, beverage_product_id) do update
      set shop_id = excluded.shop_id, sort_order = excluded.sort_order;
    v_result := jsonb_build_object('status', 'applied');

  elsif v_type = 'combo_beverage_option.remove' then
    delete from public.combo_beverage_options cbo
    where cbo.shop_id = p_shop_id
      and cbo.combo_product_id = (p_command ->> 'comboProductId')::uuid
      and cbo.beverage_product_id = (p_command ->> 'beverageProductId')::uuid;
    v_result := jsonb_build_object('status', 'applied');

  elsif v_type = 'image.replace' then
    if (p_command ->> 'imageKey') not like p_shop_id::text || '/%' then
      return jsonb_build_object('errorCode', 'image_key_forbidden');
    end if;
    select p.image_key into v_previous_image_key
    from public.products p
    where p.id = (p_command ->> 'productId')::uuid and p.shop_id = p_shop_id
    for update;
    if not found then return jsonb_build_object('errorCode', 'entity_not_found'); end if;
    update public.products
      set image_key = p_command ->> 'imageKey', updated_at = now()
    where id = (p_command ->> 'productId')::uuid and shop_id = p_shop_id;
    v_result := jsonb_build_object(
      'status', 'applied',
      'productId', p_command ->> 'productId',
      'imageKey', p_command ->> 'imageKey',
      'previousImageKey', v_previous_image_key
    );

  elsif v_type = 'image.remove' then
    select p.image_key into v_previous_image_key
    from public.products p
    where p.id = (p_command ->> 'productId')::uuid and p.shop_id = p_shop_id
    for update;
    if not found then return jsonb_build_object('errorCode', 'entity_not_found'); end if;
    update public.products
      set image_key = null, updated_at = now()
    where id = (p_command ->> 'productId')::uuid and shop_id = p_shop_id;
    v_result := jsonb_build_object(
      'status', 'applied',
      'productId', p_command ->> 'productId',
      'imageKey', null,
      'previousImageKey', v_previous_image_key
    );

  else
    return jsonb_build_object('errorCode', 'invalid_request');
  end if;

  insert into public.catalog_admin_command_receipts(
    shop_id, command_id, auth_user_id, command_json, result_json
  ) values (
    p_shop_id, p_command_id, p_auth_user_id, p_command, v_result
  );

  return v_result;
exception
  when unique_violation then
    return jsonb_build_object('errorCode', 'command_conflict');
  when check_violation or invalid_text_representation or numeric_value_out_of_range then
    return jsonb_build_object('errorCode', 'invalid_request');
  when foreign_key_violation then
    return jsonb_build_object('errorCode', 'entity_not_found');
  when others then
    return jsonb_build_object('errorCode', 'command_failed');
end;
$$;

revoke all on function public.apply_catalog_admin_command_v1(uuid, uuid, uuid, jsonb) from public;

do $$
begin
  if exists(select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.apply_catalog_admin_command_v1(uuid, uuid, uuid, jsonb) to service_role';
  end if;
end $$;
