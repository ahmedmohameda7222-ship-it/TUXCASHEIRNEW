-- Canonical production relationship reconciliation for the TUX Menu.
-- Supabase remains the product/category business authority. This migration
-- materializes the user-approved modifier/combo-beverage relationships and
-- publishes the same relationship state through the existing Operations snapshot.
create extension if not exists "uuid-ossp" with schema extensions;

DO $$
DECLARE
  v_shop_id uuid := 'c5579c9a-b2f2-5aa2-b1ed-a3a9b2492b46';
  v_extra_category_id uuid := 'c55b48e4-4dec-5cfc-a179-ab93a911542b';
  v_drinks_category_id uuid := '26ecbec9-0883-5acf-a413-4ccdce760bd8';
  v_product_count integer;
  v_extra_count integer;
  v_eligible_count integer;
  v_combo_count integer;
  v_beverage_count integer;
  v_modifier_count integer;
  v_product_modifier_count integer;
  v_combo_option_count integer;
  v_actual_ids uuid[];
  v_snapshot_version integer;
  v_snapshot_bundle jsonb;
  v_snapshot_product_ids uuid[];
  v_snapshot_products jsonb;
  v_snapshot_modifiers jsonb;
  v_snapshot_product_modifier_links jsonb;
  v_snapshot_combo_beverage_options jsonb;
  v_snapshot_previous_updated_at timestamptz;
  v_snapshot_published_at timestamptz;
  v_expected_extra_ids uuid[] := ARRAY[
    '71712668-776b-5abc-a067-23581a97b46a'::uuid,
    'ea9e484b-b601-5906-94b6-0bb1b45891b9'::uuid,
    '6141f564-c0cb-584c-bcdd-e1fead46f71c'::uuid,
    'bc692aea-e690-53e5-844b-acf727c40d0f'::uuid,
    '2d0ee6eb-9503-525f-80fd-557049be6d74'::uuid,
    'a0f45823-99c2-5271-995b-79aac2599365'::uuid,
    '87ce3859-f50c-514a-96cb-510c729a1b46'::uuid,
    '152586f0-728a-54cc-a451-e5e993be14f6'::uuid,
    'af02f2b2-dd38-5ee7-bffd-f35fa3dec1ba'::uuid,
    '78a0c8e5-8ef5-5c3e-8c40-8c4934880680'::uuid,
    '2b492ea7-7faf-55be-829f-7a75393344d5'::uuid,
    '23639a0a-3cf6-5dc3-8964-5d5817663b7d'::uuid,
    '82192675-56a7-5dbe-a955-d33983ef87ea'::uuid
  ];
  v_expected_eligible_ids uuid[] := ARRAY[
    '02a78302-1db6-5a6b-a1f8-29143d4f95e6'::uuid,
    '042312ad-c335-52b4-ad55-3d34dce27dcc'::uuid,
    '08736363-f9e7-5f95-9060-2622e725452e'::uuid,
    '09c91a57-67d5-5f9b-9770-fdd90b2739a9'::uuid,
    '105132ac-a954-5eb6-88cd-48638f660b37'::uuid,
    '19964d60-21a0-5fb3-8e2d-c4ff1b104367'::uuid,
    '1d272aee-3b94-5e0a-898a-007a60121f60'::uuid,
    '352b11c1-16be-5ef3-99fc-f7f4e597d75d'::uuid,
    '3eb059e6-fc37-5307-9958-ae2f96fe87a1'::uuid,
    '55405c76-658a-5122-b8c4-e1d43dc3a201'::uuid,
    '5f13ba23-50f0-5f15-801d-b52163c7a1fa'::uuid,
    '67318a26-759b-5f8e-be0a-2ab3e75b0714'::uuid,
    '6c5ae9a0-b2b0-5f29-a39c-59f4bb44bb28'::uuid,
    '6dd049b4-adb6-575d-a14d-fab6e2fb9a33'::uuid,
    '6f7f8eb9-bdfa-586e-8858-9fc414900186'::uuid,
    '91a48376-82fa-5369-9f78-988aff038b62'::uuid,
    '91a8852a-1481-5a9c-a507-0b4f43ce8142'::uuid,
    '91cc63aa-d5f5-5c96-a2c6-3fb31d27d6a8'::uuid,
    '96d23d74-dc5d-5783-8795-1752608b8710'::uuid,
    '96f7b140-2b20-54bd-96f4-f7e7eecc8a95'::uuid,
    '97551ad6-03ea-56b8-96d5-b2be291e758f'::uuid,
    'a9ec16ef-1b5f-52fa-8062-c21742ede016'::uuid,
    'b3770ece-f855-5575-b913-22d8a1ba788c'::uuid,
    'c768950a-607f-56e4-8736-d20ff191b807'::uuid,
    'cd450b18-1e33-53ad-8c03-aa60ac6a4b2b'::uuid,
    'd577eb43-16f7-595a-ac06-9d3c86a8f7e8'::uuid,
    'd9c72a5a-c9b5-52c7-99d5-43a0c62b5bad'::uuid,
    'e1a78050-eb0d-5ea7-bd3e-6a659e3a5421'::uuid,
    'e2962ee4-cc06-59a5-95f0-999da6dcbdcc'::uuid,
    'e3ab3789-689f-597c-8e91-da968509d97e'::uuid,
    'e9f5e8f1-b4a2-54db-b3ca-b9b2609f0299'::uuid,
    'ec90971b-8ed5-58c1-a1f5-69cda223c22a'::uuid,
    'fb3bdb64-efdb-51a4-9ac4-fdd327295615'::uuid,
    'fd4800d7-e195-5e64-aa0a-02a5163ea057'::uuid,
    'fdb4cc09-a960-5ed1-8374-3e37a0e01857'::uuid,
    'ff3f4f4b-44f8-5b32-b2da-23f9b2dc0ad6'::uuid
  ];
  v_expected_combo_ids uuid[] := ARRAY[
    '67318a26-759b-5f8e-be0a-2ab3e75b0714'::uuid,
    'fd4800d7-e195-5e64-aa0a-02a5163ea057'::uuid,
    '91a48376-82fa-5369-9f78-988aff038b62'::uuid,
    '96f7b140-2b20-54bd-96f4-f7e7eecc8a95'::uuid,
    '042312ad-c335-52b4-ad55-3d34dce27dcc'::uuid
  ];
  v_expected_beverage_ids uuid[] := ARRAY[
    'd9c72a5a-c9b5-52c7-99d5-43a0c62b5bad'::uuid,
    '1d272aee-3b94-5e0a-898a-007a60121f60'::uuid
  ];
BEGIN
  -- The validation snapshot and the inserts must see one stable catalog state.
  LOCK TABLE public.menu_categories, public.products, public.modifiers, public.product_modifiers, public.combo_beverage_options IN SHARE ROW EXCLUSIVE MODE;

  -- This is production data, not schema seed data. Clean/local databases that
  -- do not contain the canonical production shop intentionally no-op. If the
  -- shop exists, every catalog and relationship fence below must run.
  IF NOT EXISTS (
    SELECT 1
    FROM public.shops
    WHERE id = v_shop_id
  ) THEN
    RETURN;
  END IF;

  SELECT count(*) INTO v_product_count
  FROM public.products
  WHERE shop_id = v_shop_id;
  IF v_product_count <> 49 THEN
    RAISE EXCEPTION 'catalog relationship inventory drift: expected 49 products, found %', v_product_count;
  END IF;

  SELECT array_agg(id ORDER BY id) INTO v_actual_ids
  FROM public.products
  WHERE shop_id = v_shop_id;
  IF v_actual_ids IS DISTINCT FROM (
    SELECT array_agg(id ORDER BY id)
    FROM unnest(v_expected_extra_ids || v_expected_eligible_ids) AS expected(id)
  ) THEN
    RAISE EXCEPTION 'catalog relationship product UUID inventory mismatch';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.menu_categories
    WHERE id = v_extra_category_id
      AND shop_id = v_shop_id
      AND slug = 'extras'
      AND active = true
  ) THEN
    RAISE EXCEPTION 'catalog relationship Extras category mismatch';
  END IF;

  SELECT count(*) INTO v_extra_count
  FROM public.products
  WHERE shop_id = v_shop_id
    AND category_id = v_extra_category_id;
  IF v_extra_count <> 13 THEN
    RAISE EXCEPTION 'catalog relationship inventory drift: expected 13 Extras, found %', v_extra_count;
  END IF;

  SELECT array_agg(id ORDER BY id) INTO v_actual_ids
  FROM public.products
  WHERE shop_id = v_shop_id
    AND category_id = v_extra_category_id;
  IF v_actual_ids IS DISTINCT FROM (
    SELECT array_agg(id ORDER BY id)
    FROM unnest(v_expected_extra_ids) AS expected(id)
  ) THEN
    RAISE EXCEPTION 'catalog relationship Extra UUID inventory mismatch';
  END IF;

  IF EXISTS (
    WITH expected(id, name, price_minor, active, sort_order) AS (
      VALUES
        ('71712668-776b-5abc-a067-23581a97b46a'::uuid, 'Extra Smashed Patty', 6000::bigint, true, 0),
        ('ea9e484b-b601-5906-94b6-0bb1b45891b9'::uuid, 'Bacon', 3000::bigint, true, 1),
        ('6141f564-c0cb-584c-bcdd-e1fead46f71c'::uuid, 'Cheese', 2500::bigint, true, 2),
        ('bc692aea-e690-53e5-844b-acf727c40d0f'::uuid, 'Ranch', 2000::bigint, true, 3),
        ('2d0ee6eb-9503-525f-80fd-557049be6d74'::uuid, 'Mushroom', 3000::bigint, true, 4),
        ('a0f45823-99c2-5271-995b-79aac2599365'::uuid, 'Caramelized Onion', 1000::bigint, true, 5),
        ('87ce3859-f50c-514a-96cb-510c729a1b46'::uuid, 'Jalapeno', 1000::bigint, true, 6),
        ('152586f0-728a-54cc-a451-e5e993be14f6'::uuid, 'Tux Sauce', 1000::bigint, true, 7),
        ('af02f2b2-dd38-5ee7-bffd-f35fa3dec1ba'::uuid, 'Extra Bun', 1000::bigint, true, 8),
        ('78a0c8e5-8ef5-5c3e-8c40-8c4934880680'::uuid, 'Pickle', 1000::bigint, true, 9),
        ('2b492ea7-7faf-55be-829f-7a75393344d5'::uuid, 'Mozzarella Cheese', 2500::bigint, true, 10),
        ('23639a0a-3cf6-5dc3-8964-5d5817663b7d'::uuid, 'Tux Hawawshi Sauce', 1000::bigint, true, 11),
        ('82192675-56a7-5dbe-a955-d33983ef87ea'::uuid, 'Cup BBQ / Ketchup / Sweet Chili / Hot Sauce', 2000::bigint, true, 12)
    ),
    actual AS (
      SELECT id, name, price_minor, active, sort_order
      FROM public.products
      WHERE shop_id = v_shop_id
        AND category_id = v_extra_category_id
    )
    SELECT 1 FROM (
      (SELECT * FROM expected EXCEPT SELECT * FROM actual)
      UNION ALL
      (SELECT * FROM actual EXCEPT SELECT * FROM expected)
    ) AS mismatch
  ) THEN
    RAISE EXCEPTION 'catalog relationship Extra business-field authority mismatch';
  END IF;

  SELECT count(*) INTO v_eligible_count
  FROM public.products
  WHERE shop_id = v_shop_id
    AND category_id <> v_extra_category_id;
  IF v_eligible_count <> 36 THEN
    RAISE EXCEPTION 'catalog relationship inventory drift: expected 36 non-Extra products, found %', v_eligible_count;
  END IF;

  SELECT array_agg(id ORDER BY id) INTO v_actual_ids
  FROM public.products
  WHERE shop_id = v_shop_id
    AND category_id <> v_extra_category_id;
  IF v_actual_ids IS DISTINCT FROM (
    SELECT array_agg(id ORDER BY id)
    FROM unnest(v_expected_eligible_ids) AS expected(id)
  ) THEN
    RAISE EXCEPTION 'catalog relationship eligible product UUID inventory mismatch';
  END IF;

  SELECT count(*) INTO v_combo_count
  FROM public.products
  WHERE shop_id = v_shop_id
    AND is_combo = true;
  IF v_combo_count <> 5 THEN
    RAISE EXCEPTION 'catalog relationship inventory drift: expected 5 combo products, found %', v_combo_count;
  END IF;

  SELECT array_agg(id ORDER BY id) INTO v_actual_ids
  FROM public.products
  WHERE shop_id = v_shop_id
    AND is_combo = true;
  IF v_actual_ids IS DISTINCT FROM (
    SELECT array_agg(id ORDER BY id)
    FROM unnest(v_expected_combo_ids) AS expected(id)
  ) THEN
    RAISE EXCEPTION 'catalog relationship combo UUID inventory mismatch';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.menu_categories
    WHERE id = v_drinks_category_id
      AND shop_id = v_shop_id
      AND slug = 'drinks'
      AND active = true
  ) THEN
    RAISE EXCEPTION 'catalog relationship Drinks category mismatch';
  END IF;

  SELECT count(*) INTO v_beverage_count
  FROM public.products
  WHERE shop_id = v_shop_id
    AND category_id = v_drinks_category_id;
  IF v_beverage_count <> 2 THEN
    RAISE EXCEPTION 'catalog relationship inventory drift: expected 2 beverage products, found %', v_beverage_count;
  END IF;

  SELECT array_agg(id ORDER BY id) INTO v_actual_ids
  FROM public.products
  WHERE shop_id = v_shop_id
    AND category_id = v_drinks_category_id;
  IF v_actual_ids IS DISTINCT FROM (
    SELECT array_agg(id ORDER BY id)
    FROM unnest(v_expected_beverage_ids) AS expected(id)
  ) THEN
    RAISE EXCEPTION 'catalog relationship beverage UUID inventory mismatch';
  END IF;

  SELECT count(*) INTO v_modifier_count
  FROM public.modifiers
  WHERE shop_id = v_shop_id;
  IF v_modifier_count <> 0 THEN
    RAISE EXCEPTION 'catalog relationship prestate mismatch: expected 0 modifiers, found %', v_modifier_count;
  END IF;

  SELECT count(*) INTO v_product_modifier_count
  FROM public.product_modifiers
  WHERE shop_id = v_shop_id;
  IF v_product_modifier_count <> 0 THEN
    RAISE EXCEPTION 'catalog relationship prestate mismatch: expected 0 product-modifier links, found %', v_product_modifier_count;
  END IF;

  SELECT count(*) INTO v_combo_option_count
  FROM public.combo_beverage_options
  WHERE shop_id = v_shop_id;
  IF v_combo_option_count <> 0 THEN
    RAISE EXCEPTION 'catalog relationship prestate mismatch: expected 0 combo beverage options, found %', v_combo_option_count;
  END IF;

  -- Operations devices consume complete immutable configuration snapshots, not
  -- the live relationship tables. Preserve the current published bundle and
  -- fail closed if it is not a complete baseline that can be safely patched.
  SELECT version, bundle_json
  INTO v_snapshot_version, v_snapshot_bundle
  FROM public.operations_configuration_snapshots
  WHERE shop_id = v_shop_id
  ORDER BY version DESC
  LIMIT 1;

  IF v_snapshot_version IS NULL OR v_snapshot_bundle IS NULL THEN
    RAISE EXCEPTION 'catalog relationship Operations snapshot missing';
  END IF;
  IF v_snapshot_version >= 2147483647 THEN
    RAISE EXCEPTION 'catalog relationship Operations snapshot version exhausted';
  END IF;

  IF jsonb_typeof(v_snapshot_bundle) IS DISTINCT FROM 'object'
     OR jsonb_typeof(v_snapshot_bundle -> 'inventoryItems') IS DISTINCT FROM 'array'
     OR jsonb_typeof(v_snapshot_bundle -> 'snapshot') IS DISTINCT FROM 'object'
     OR jsonb_typeof(v_snapshot_bundle #> '{snapshot,categories}') IS DISTINCT FROM 'array'
     OR jsonb_typeof(v_snapshot_bundle #> '{snapshot,products}') IS DISTINCT FROM 'array'
     OR jsonb_typeof(v_snapshot_bundle #> '{snapshot,modifiers}') IS DISTINCT FROM 'array'
     OR jsonb_typeof(v_snapshot_bundle #> '{snapshot,productModifierLinks}') IS DISTINCT FROM 'array'
     OR jsonb_typeof(v_snapshot_bundle #> '{snapshot,comboBeverageOptions}') IS DISTINCT FROM 'array'
     OR jsonb_typeof(v_snapshot_bundle #> '{snapshot,recipeLines}') IS DISTINCT FROM 'array'
     OR jsonb_typeof(v_snapshot_bundle #> '{snapshot,orderTypes}') IS DISTINCT FROM 'array'
     OR jsonb_typeof(v_snapshot_bundle #> '{snapshot,paymentMethods}') IS DISTINCT FROM 'array'
     OR jsonb_typeof(v_snapshot_bundle #> '{snapshot,deliveryZones}') IS DISTINCT FROM 'array'
  THEN
    RAISE EXCEPTION 'catalog relationship Operations snapshot bundle shape mismatch';
  END IF;

  IF v_snapshot_bundle #>> '{snapshot,shopId}' IS DISTINCT FROM v_shop_id::text
     OR v_snapshot_bundle #>> '{snapshot,version}' IS DISTINCT FROM v_snapshot_version::text
  THEN
    RAISE EXCEPTION 'catalog relationship Operations snapshot identity mismatch';
  END IF;

  v_snapshot_previous_updated_at := (v_snapshot_bundle #>> '{snapshot,updatedAt}')::timestamptz;
  IF v_snapshot_previous_updated_at IS NULL THEN
    RAISE EXCEPTION 'catalog relationship Operations snapshot updatedAt missing';
  END IF;

  IF jsonb_array_length(v_snapshot_bundle #> '{snapshot,modifiers}') <> 0
     OR jsonb_array_length(v_snapshot_bundle #> '{snapshot,productModifierLinks}') <> 0
     OR jsonb_array_length(v_snapshot_bundle #> '{snapshot,comboBeverageOptions}') <> 0
  THEN
    RAISE EXCEPTION 'catalog relationship Operations snapshot relationship prestate mismatch';
  END IF;

  SELECT array_agg((item ->> 'id')::uuid ORDER BY (item ->> 'id')::uuid)
  INTO v_snapshot_product_ids
  FROM jsonb_array_elements(v_snapshot_bundle #> '{snapshot,products}') AS source(item);

  IF jsonb_array_length(v_snapshot_bundle #> '{snapshot,products}') <> 49
     OR v_snapshot_product_ids IS DISTINCT FROM (
       SELECT array_agg(id ORDER BY id)
       FROM unnest(v_expected_extra_ids || v_expected_eligible_ids) AS expected(id)
     )
  THEN
    RAISE EXCEPTION 'catalog relationship Operations snapshot product inventory mismatch';
  END IF;

  -- Snapshot insertion runs the existing product-family materializer trigger.
  -- Patch only family metadata from the locked live product rows so publication
  -- cannot clear or regress family values while all other product JSON is kept.
  SELECT jsonb_agg(
    jsonb_set(
      source.item,
      '{family}',
      COALESCE(to_jsonb(product.family), 'null'::jsonb),
      true
    )
    ORDER BY source.ordinality
  )
  INTO v_snapshot_products
  FROM jsonb_array_elements(v_snapshot_bundle #> '{snapshot,products}')
    WITH ORDINALITY AS source(item, ordinality)
  JOIN public.products AS product
    ON product.shop_id = v_shop_id
   AND product.id = (source.item ->> 'id')::uuid;

  IF jsonb_array_length(v_snapshot_products) <> 49 THEN
    RAISE EXCEPTION 'catalog relationship Operations snapshot product family reconciliation mismatch';
  END IF;

  INSERT INTO public.modifiers (
    id,
    shop_id,
    name,
    price_minor,
    standalone_product_id,
    active,
    sort_order
  )
  SELECT
    extensions.uuid_generate_v5(v_shop_id, 'standalone-modifier:' || p.id::text),
    v_shop_id,
    p.name,
    p.price_minor,
    p.id,
    p.active,
    p.sort_order
  FROM public.products AS p
  WHERE p.shop_id = v_shop_id
    AND p.id = ANY(v_expected_extra_ids)
  ORDER BY p.sort_order, p.id;

  INSERT INTO public.product_modifiers (
    shop_id,
    product_id,
    modifier_id,
    max_quantity,
    sort_order
  )
  SELECT
    v_shop_id,
    p.id,
    m.id,
    1,
    m.sort_order
  FROM public.products AS p
  CROSS JOIN public.modifiers AS m
  WHERE p.shop_id = v_shop_id
    AND p.id = ANY(v_expected_eligible_ids)
    AND m.shop_id = v_shop_id
  ORDER BY p.id, m.sort_order, m.id;

  INSERT INTO public.combo_beverage_options (
    shop_id,
    combo_product_id,
    beverage_product_id,
    sort_order
  )
  SELECT
    v_shop_id,
    combo.id,
    beverage.id,
    beverage.sort_order
  FROM public.products AS combo
  CROSS JOIN public.products AS beverage
  WHERE combo.shop_id = v_shop_id
    AND combo.id = ANY(v_expected_combo_ids)
    AND beverage.shop_id = v_shop_id
    AND beverage.id = ANY(v_expected_beverage_ids)
  ORDER BY combo.sort_order, combo.id, beverage.sort_order, beverage.id;

  SELECT count(*) INTO v_modifier_count
  FROM public.modifiers
  WHERE shop_id = v_shop_id;
  SELECT count(*) INTO v_product_modifier_count
  FROM public.product_modifiers
  WHERE shop_id = v_shop_id;
  SELECT count(*) INTO v_combo_option_count
  FROM public.combo_beverage_options
  WHERE shop_id = v_shop_id;

  IF v_modifier_count <> 13 OR v_product_modifier_count <> 468 OR v_combo_option_count <> 10 THEN
    RAISE EXCEPTION 'post-migration verification failed: expected 13 modifiers, 468 links, 10 combo options; found %, %, %',
      v_modifier_count, v_product_modifier_count, v_combo_option_count;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.modifiers AS m
    JOIN public.products AS p
      ON p.shop_id = m.shop_id
     AND p.id = m.standalone_product_id
    WHERE m.shop_id = v_shop_id
      AND (
        m.id IS DISTINCT FROM extensions.uuid_generate_v5(v_shop_id, 'standalone-modifier:' || p.id::text)
        OR m.name IS DISTINCT FROM p.name
        OR m.price_minor IS DISTINCT FROM p.price_minor
        OR m.active IS DISTINCT FROM p.active
        OR m.sort_order IS DISTINCT FROM p.sort_order
      )
  ) THEN
    RAISE EXCEPTION 'post-migration verification failed: modifier fields do not match standalone Extra authority';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.product_modifiers AS pm
    WHERE pm.shop_id = v_shop_id
      AND (
        pm.product_id <> ALL(v_expected_eligible_ids)
        OR pm.max_quantity IS DISTINCT FROM 1
        OR NOT EXISTS (
          SELECT 1
          FROM public.modifiers AS m
          WHERE m.shop_id = v_shop_id
            AND m.id = pm.modifier_id
        )
      )
  ) THEN
    RAISE EXCEPTION 'post-migration verification failed: unexpected product-modifier relationship';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM unnest(v_expected_eligible_ids) AS product(id)
    CROSS JOIN public.modifiers AS m
    WHERE m.shop_id = v_shop_id
      AND NOT EXISTS (
        SELECT 1
        FROM public.product_modifiers AS pm
        WHERE pm.shop_id = v_shop_id
          AND pm.product_id = product.id
          AND pm.modifier_id = m.id
          AND pm.max_quantity = 1
      )
  ) THEN
    RAISE EXCEPTION 'post-migration verification failed: missing approved product-modifier relationship';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.combo_beverage_options AS option
    WHERE option.shop_id = v_shop_id
      AND (
        option.combo_product_id <> ALL(v_expected_combo_ids)
        OR option.beverage_product_id <> ALL(v_expected_beverage_ids)
      )
  ) THEN
    RAISE EXCEPTION 'post-migration verification failed: unexpected combo beverage relationship';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM unnest(v_expected_combo_ids) AS combo(id)
    CROSS JOIN unnest(v_expected_beverage_ids) WITH ORDINALITY AS beverage(id, ordinal)
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.combo_beverage_options AS option
      WHERE option.shop_id = v_shop_id
        AND option.combo_product_id = combo.id
        AND option.beverage_product_id = beverage.id
        AND option.sort_order = beverage.ordinal - 1
    )
  ) THEN
    RAISE EXCEPTION 'post-migration verification failed: missing approved combo beverage relationship';
  END IF;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', modifier.id,
        'shopId', modifier.shop_id,
        'name', modifier.name,
        'priceMinor', modifier.price_minor,
        'standaloneProductId', modifier.standalone_product_id,
        'active', modifier.active,
        'sortOrder', modifier.sort_order
      )
      ORDER BY modifier.sort_order, modifier.id
    ),
    '[]'::jsonb
  )
  INTO v_snapshot_modifiers
  FROM public.modifiers AS modifier
  WHERE modifier.shop_id = v_shop_id;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'shopId', link.shop_id,
        'productId', link.product_id,
        'modifierId', link.modifier_id,
        'maxQuantity', link.max_quantity,
        'sortOrder', link.sort_order
      )
      ORDER BY link.product_id, link.sort_order, link.modifier_id
    ),
    '[]'::jsonb
  )
  INTO v_snapshot_product_modifier_links
  FROM public.product_modifiers AS link
  WHERE link.shop_id = v_shop_id;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'shopId', option.shop_id,
        'comboProductId', option.combo_product_id,
        'beverageProductId', option.beverage_product_id,
        'sortOrder', option.sort_order
      )
      ORDER BY option.combo_product_id, option.sort_order, option.beverage_product_id
    ),
    '[]'::jsonb
  )
  INTO v_snapshot_combo_beverage_options
  FROM public.combo_beverage_options AS option
  WHERE option.shop_id = v_shop_id;

  IF jsonb_array_length(v_snapshot_modifiers) <> 13
     OR jsonb_array_length(v_snapshot_product_modifier_links) <> 468
     OR jsonb_array_length(v_snapshot_combo_beverage_options) <> 10
  THEN
    RAISE EXCEPTION 'post-migration verification failed: Operations relationship projection mismatch';
  END IF;

  v_snapshot_published_at := GREATEST(
    clock_timestamp(),
    v_snapshot_previous_updated_at + interval '1 microsecond'
  );
  v_snapshot_bundle := jsonb_set(
    v_snapshot_bundle,
    '{snapshot,products}',
    v_snapshot_products,
    false
  );
  v_snapshot_bundle := jsonb_set(
    v_snapshot_bundle,
    '{snapshot,modifiers}',
    v_snapshot_modifiers,
    false
  );
  v_snapshot_bundle := jsonb_set(
    v_snapshot_bundle,
    '{snapshot,productModifierLinks}',
    v_snapshot_product_modifier_links,
    false
  );
  v_snapshot_bundle := jsonb_set(
    v_snapshot_bundle,
    '{snapshot,comboBeverageOptions}',
    v_snapshot_combo_beverage_options,
    false
  );
  v_snapshot_bundle := jsonb_set(
    v_snapshot_bundle,
    '{snapshot,version}',
    to_jsonb(v_snapshot_version + 1),
    false
  );
  v_snapshot_bundle := jsonb_set(
    v_snapshot_bundle,
    '{snapshot,updatedAt}',
    to_jsonb(v_snapshot_published_at),
    false
  );

  INSERT INTO public.operations_configuration_snapshots (
    shop_id,
    version,
    bundle_json,
    published_at,
    published_by_auth_user_id
  )
  VALUES (
    v_shop_id,
    v_snapshot_version + 1,
    v_snapshot_bundle,
    v_snapshot_published_at,
    null
  );

  IF NOT EXISTS (
    SELECT 1
    FROM public.operations_configuration_snapshots AS snapshot
    WHERE snapshot.shop_id = v_shop_id
      AND snapshot.version = v_snapshot_version + 1
      AND snapshot.bundle_json #>> '{snapshot,shopId}' = v_shop_id::text
      AND snapshot.bundle_json #>> '{snapshot,version}' = (v_snapshot_version + 1)::text
      AND jsonb_array_length(snapshot.bundle_json #> '{snapshot,modifiers}') = 13
      AND jsonb_array_length(snapshot.bundle_json #> '{snapshot,productModifierLinks}') = 468
      AND jsonb_array_length(snapshot.bundle_json #> '{snapshot,comboBeverageOptions}') = 10
  ) THEN
    RAISE EXCEPTION 'post-migration verification failed: Operations snapshot publication mismatch';
  END IF;
END
$$;
