create temporary table tux_category_public_identity (
  id uuid primary key,
  slug text not null unique
);

insert into tux_category_public_identity(id, slug) values
  ('dac1ac74-aa52-5804-966c-cef65d196fd4'::uuid, 'burgers'::text),
  ('89346cad-bf3a-5682-a426-292d6e2017e4'::uuid, 'combos'::text),
  ('677f5b6a-1be0-5345-8afa-cfd8e0eec7e4'::uuid, 'fries'::text),
  ('05a318bf-cefa-5149-aae6-fd5d94138943'::uuid, 'hawawshi'::text),
  ('a0263027-0afa-52bf-9f34-e27ec77136b8'::uuid, 'zalabia'::text),
  ('c55b48e4-4dec-5cfc-a179-ab93a911542b'::uuid, 'extras'::text),
  ('26ecbec9-0883-5acf-a413-4ccdce760bd8'::uuid, 'drinks'::text);

create temporary table tux_product_public_identity (
  id uuid primary key,
  category_id uuid not null,
  slug text not null unique
);

insert into tux_product_public_identity(id, category_id, slug) values
  ('91a8852a-1481-5a9c-a507-0b4f43ce8142'::uuid, 'dac1ac74-aa52-5804-966c-cef65d196fd4'::uuid, 'single-tux-burger'::text),
  ('105132ac-a954-5eb6-88cd-48638f660b37'::uuid, 'dac1ac74-aa52-5804-966c-cef65d196fd4'::uuid, 'double-tux-burger'::text),
  ('e3ab3789-689f-597c-8e91-da968509d97e'::uuid, 'dac1ac74-aa52-5804-966c-cef65d196fd4'::uuid, 'triple-tux-burger'::text),
  ('d577eb43-16f7-595a-ac06-9d3c86a8f7e8'::uuid, 'dac1ac74-aa52-5804-966c-cef65d196fd4'::uuid, 'tux-quatro'::text),
  ('55405c76-658a-5122-b8c4-e1d43dc3a201'::uuid, 'dac1ac74-aa52-5804-966c-cef65d196fd4'::uuid, 'johnnys'::text),
  ('cd450b18-1e33-53ad-8c03-aa60ac6a4b2b'::uuid, 'dac1ac74-aa52-5804-966c-cef65d196fd4'::uuid, 'single-tuxify'::text),
  ('352b11c1-16be-5ef3-99fc-f7f4e597d75d'::uuid, 'dac1ac74-aa52-5804-966c-cef65d196fd4'::uuid, 'double-tuxify'::text),
  ('09c91a57-67d5-5f9b-9770-fdd90b2739a9'::uuid, 'dac1ac74-aa52-5804-966c-cef65d196fd4'::uuid, 'triple-tuxify'::text),
  ('c768950a-607f-56e4-8736-d20ff191b807'::uuid, 'dac1ac74-aa52-5804-966c-cef65d196fd4'::uuid, 'quatro-tuxify'::text),
  ('67318a26-759b-5f8e-be0a-2ab3e75b0714'::uuid, '89346cad-bf3a-5682-a426-292d6e2017e4'::uuid, 'single-double'::text),
  ('fd4800d7-e195-5e64-aa0a-02a5163ea057'::uuid, '89346cad-bf3a-5682-a426-292d6e2017e4'::uuid, 'double-double'::text),
  ('91a48376-82fa-5369-9f78-988aff038b62'::uuid, '89346cad-bf3a-5682-a426-292d6e2017e4'::uuid, 'twowawshi'::text),
  ('96f7b140-2b20-54bd-96f4-f7e7eecc8a95'::uuid, '89346cad-bf3a-5682-a426-292d6e2017e4'::uuid, 'quadtower'::text),
  ('042312ad-c335-52b4-ad55-3d34dce27dcc'::uuid, '89346cad-bf3a-5682-a426-292d6e2017e4'::uuid, 'quad-4'::text),
  ('e9f5e8f1-b4a2-54db-b3ca-b9b2609f0299'::uuid, '677f5b6a-1be0-5345-8afa-cfd8e0eec7e4'::uuid, 'classic-fries'::text),
  ('3eb059e6-fc37-5307-9958-ae2f96fe87a1'::uuid, '677f5b6a-1be0-5345-8afa-cfd8e0eec7e4'::uuid, 'cheese-fries'::text),
  ('6dd049b4-adb6-575d-a14d-fab6e2fb9a33'::uuid, '677f5b6a-1be0-5345-8afa-cfd8e0eec7e4'::uuid, 'chili-fries'::text),
  ('6f7f8eb9-bdfa-586e-8858-9fc414900186'::uuid, '677f5b6a-1be0-5345-8afa-cfd8e0eec7e4'::uuid, 'tux-fries'::text),
  ('02a78302-1db6-5a6b-a1f8-29143d4f95e6'::uuid, '677f5b6a-1be0-5345-8afa-cfd8e0eec7e4'::uuid, 'doppy-fries'::text),
  ('e1a78050-eb0d-5ea7-bd3e-6a659e3a5421'::uuid, '677f5b6a-1be0-5345-8afa-cfd8e0eec7e4'::uuid, 'extra-tux-fries'::text),
  ('fdb4cc09-a960-5ed1-8374-3e37a0e01857'::uuid, '677f5b6a-1be0-5345-8afa-cfd8e0eec7e4'::uuid, 'extra-doppy-fries'::text),
  ('a9ec16ef-1b5f-52fa-8062-c21742ede016'::uuid, '677f5b6a-1be0-5345-8afa-cfd8e0eec7e4'::uuid, 'extra-wedges'::text),
  ('19964d60-21a0-5fb3-8e2d-c4ff1b104367'::uuid, '05a318bf-cefa-5149-aae6-fd5d94138943'::uuid, 'classic-hawawshi'::text),
  ('91cc63aa-d5f5-5c96-a2c6-3fb31d27d6a8'::uuid, '05a318bf-cefa-5149-aae6-fd5d94138943'::uuid, 'tux-hawawshi'::text),
  ('08736363-f9e7-5f95-9060-2622e725452e'::uuid, 'a0263027-0afa-52bf-9f34-e27ec77136b8'::uuid, 'zalabia-sugar-honey-small'::text),
  ('e2962ee4-cc06-59a5-95f0-999da6dcbdcc'::uuid, 'a0263027-0afa-52bf-9f34-e27ec77136b8'::uuid, 'zalabia-sugar-honey-large'::text),
  ('96d23d74-dc5d-5783-8795-1752608b8710'::uuid, 'a0263027-0afa-52bf-9f34-e27ec77136b8'::uuid, 'zalabia-chocolate-small'::text),
  ('b3770ece-f855-5575-b913-22d8a1ba788c'::uuid, 'a0263027-0afa-52bf-9f34-e27ec77136b8'::uuid, 'zalabia-chocolate-large'::text),
  ('6c5ae9a0-b2b0-5f29-a39c-59f4bb44bb28'::uuid, 'a0263027-0afa-52bf-9f34-e27ec77136b8'::uuid, 'zalabia-pistachio-small'::text),
  ('ec90971b-8ed5-58c1-a1f5-69cda223c22a'::uuid, 'a0263027-0afa-52bf-9f34-e27ec77136b8'::uuid, 'zalabia-pistachio-large'::text),
  ('ff3f4f4b-44f8-5b32-b2da-23f9b2dc0ad6'::uuid, 'a0263027-0afa-52bf-9f34-e27ec77136b8'::uuid, 'zalabia-lotus-small'::text),
  ('5f13ba23-50f0-5f15-801d-b52163c7a1fa'::uuid, 'a0263027-0afa-52bf-9f34-e27ec77136b8'::uuid, 'zalabia-lotus-large'::text),
  ('97551ad6-03ea-56b8-96d5-b2be291e758f'::uuid, 'a0263027-0afa-52bf-9f34-e27ec77136b8'::uuid, 'zalabia-lotus-chocolate-mix'::text),
  ('fb3bdb64-efdb-51a4-9ac4-fdd327295615'::uuid, 'a0263027-0afa-52bf-9f34-e27ec77136b8'::uuid, 'zalabia-lotus-pistachio-chocolate-mix-large'::text),
  ('71712668-776b-5abc-a067-23581a97b46a'::uuid, 'c55b48e4-4dec-5cfc-a179-ab93a911542b'::uuid, 'extra-smashed-patty'::text),
  ('ea9e484b-b601-5906-94b6-0bb1b45891b9'::uuid, 'c55b48e4-4dec-5cfc-a179-ab93a911542b'::uuid, 'extra-bacon'::text),
  ('6141f564-c0cb-584c-bcdd-e1fead46f71c'::uuid, 'c55b48e4-4dec-5cfc-a179-ab93a911542b'::uuid, 'extra-cheese'::text),
  ('bc692aea-e690-53e5-844b-acf727c40d0f'::uuid, 'c55b48e4-4dec-5cfc-a179-ab93a911542b'::uuid, 'extra-ranch'::text),
  ('2d0ee6eb-9503-525f-80fd-557049be6d74'::uuid, 'c55b48e4-4dec-5cfc-a179-ab93a911542b'::uuid, 'extra-mushroom'::text),
  ('a0f45823-99c2-5271-995b-79aac2599365'::uuid, 'c55b48e4-4dec-5cfc-a179-ab93a911542b'::uuid, 'extra-caramelized-onion'::text),
  ('87ce3859-f50c-514a-96cb-510c729a1b46'::uuid, 'c55b48e4-4dec-5cfc-a179-ab93a911542b'::uuid, 'extra-jalapeno'::text),
  ('152586f0-728a-54cc-a451-e5e993be14f6'::uuid, 'c55b48e4-4dec-5cfc-a179-ab93a911542b'::uuid, 'extra-tux-sauce'::text),
  ('af02f2b2-dd38-5ee7-bffd-f35fa3dec1ba'::uuid, 'c55b48e4-4dec-5cfc-a179-ab93a911542b'::uuid, 'extra-bun'::text),
  ('78a0c8e5-8ef5-5c3e-8c40-8c4934880680'::uuid, 'c55b48e4-4dec-5cfc-a179-ab93a911542b'::uuid, 'extra-pickle'::text),
  ('2b492ea7-7faf-55be-829f-7a75393344d5'::uuid, 'c55b48e4-4dec-5cfc-a179-ab93a911542b'::uuid, 'extra-mozarella'::text),
  ('23639a0a-3cf6-5dc3-8964-5d5817663b7d'::uuid, 'c55b48e4-4dec-5cfc-a179-ab93a911542b'::uuid, 'extra-tux-hawawshi-sauce'::text),
  ('82192675-56a7-5dbe-a955-d33983ef87ea'::uuid, 'c55b48e4-4dec-5cfc-a179-ab93a911542b'::uuid, 'extra-sauce-selection'::text),
  ('d9c72a5a-c9b5-52c7-99d5-43a0c62b5bad'::uuid, '26ecbec9-0883-5acf-a413-4ccdce760bd8'::uuid, 'vcola'::text),
  ('1d272aee-3b94-5e0a-898a-007a60121f60'::uuid, '26ecbec9-0883-5acf-a413-4ccdce760bd8'::uuid, 'water'::text);

do $$
declare
  v_shop_id constant uuid := 'c5579c9a-b2f2-5aa2-b1ed-a3a9b2492b46';
  v_category_count integer;
  v_product_count integer;
begin
  if (select count(*) from pg_temp.tux_category_public_identity) <> 7 then
    raise exception 'category identity manifest count mismatch';
  end if;
  if (select count(*) from pg_temp.tux_product_public_identity) <> 49 then
    raise exception 'product identity manifest count mismatch';
  end if;
  if exists (
    select 1
    from pg_temp.tux_product_public_identity as product_identity
    left join pg_temp.tux_category_public_identity as category_identity
      on category_identity.id = product_identity.category_id
    where category_identity.id is null
  ) then
    raise exception 'product identity manifest contains an unknown category UUID';
  end if;

  -- This is production data, not schema seed data. Clean/local databases that
  -- do not contain the canonical production shop intentionally no-op.
  if not exists (select 1 from public.shops where id = v_shop_id) then
    raise notice 'canonical production shop absent; public identity reconciliation skipped';
    return;
  end if;

  select count(*) into v_category_count
  from public.menu_categories
  where shop_id = v_shop_id;
  if v_category_count <> 7 then
    raise exception 'category inventory mismatch: expected 7 canonical rows, found %', v_category_count;
  end if;

  select count(*) into v_product_count
  from public.products
  where shop_id = v_shop_id;
  if v_product_count <> 49 then
    raise exception 'product inventory mismatch: expected 49 canonical rows, found %', v_product_count;
  end if;

  if exists (
    select 1
    from pg_temp.tux_category_public_identity as identity
    left join public.menu_categories as category
      on category.shop_id = v_shop_id
     and category.id = identity.id
    where category.id is null
  ) or exists (
    select 1
    from public.menu_categories as category
    left join pg_temp.tux_category_public_identity as identity
      on identity.id = category.id
    where category.shop_id = v_shop_id
      and identity.id is null
  ) then
    raise exception 'category UUID inventory mismatch: canonical identity set drifted';
  end if;

  if exists (
    select 1
    from pg_temp.tux_product_public_identity as identity
    left join public.products as product
      on product.shop_id = v_shop_id
     and product.id = identity.id
    where product.id is null
       or product.category_id is distinct from identity.category_id
  ) or exists (
    select 1
    from public.products as product
    left join pg_temp.tux_product_public_identity as identity
      on identity.id = product.id
    where product.shop_id = v_shop_id
      and identity.id is null
  ) then
    raise exception 'product UUID/category inventory mismatch: canonical identity set drifted';
  end if;

  if exists (
    select 1
    from public.menu_categories as category
    join pg_temp.tux_category_public_identity as identity on identity.id = category.id
    where category.shop_id = v_shop_id
      and category.slug is not null
      and category.slug is distinct from identity.slug
  ) or exists (
    select 1
    from public.menu_categories as category
    join pg_temp.tux_category_public_identity as identity on identity.slug = category.slug
    where category.shop_id = v_shop_id
      and category.id is distinct from identity.id
  ) then
    raise exception 'conflicting category slug detected; migration refuses to overwrite public identity';
  end if;

  if exists (
    select 1
    from public.products as product
    join pg_temp.tux_product_public_identity as identity on identity.id = product.id
    where product.shop_id = v_shop_id
      and product.slug is not null
      and product.slug is distinct from identity.slug
  ) or exists (
    select 1
    from public.products as product
    join pg_temp.tux_product_public_identity as identity on identity.slug = product.slug
    where product.shop_id = v_shop_id
      and product.id is distinct from identity.id
  ) then
    raise exception 'conflicting product slug detected; migration refuses to overwrite public identity';
  end if;
end
$$;

update public.menu_categories as category
set slug = identity.slug
from pg_temp.tux_category_public_identity as identity
where category.shop_id = 'c5579c9a-b2f2-5aa2-b1ed-a3a9b2492b46'::uuid
  and category.id = identity.id;

update public.products as product
set slug = identity.slug
from pg_temp.tux_product_public_identity as identity
where product.shop_id = 'c5579c9a-b2f2-5aa2-b1ed-a3a9b2492b46'::uuid
  and product.id = identity.id
  and product.category_id = identity.category_id;

do $$
declare
  v_shop_id constant uuid := 'c5579c9a-b2f2-5aa2-b1ed-a3a9b2492b46';
begin
  if not exists (select 1 from public.shops where id = v_shop_id) then
    return;
  end if;

  if exists (
    select 1
    from pg_temp.tux_category_public_identity as identity
    left join public.menu_categories as category
      on category.shop_id = v_shop_id
     and category.id = identity.id
     and category.slug = identity.slug
    where category.id is null
  ) then
    raise exception 'post-update verification failed for canonical category public identities';
  end if;

  if exists (
    select 1
    from pg_temp.tux_product_public_identity as identity
    left join public.products as product
      on product.shop_id = v_shop_id
     and product.id = identity.id
     and product.category_id = identity.category_id
     and product.slug = identity.slug
    where product.id is null
  ) then
    raise exception 'post-update verification failed for canonical product public identities';
  end if;
end
$$;

drop table pg_temp.tux_product_public_identity;
drop table pg_temp.tux_category_public_identity;
