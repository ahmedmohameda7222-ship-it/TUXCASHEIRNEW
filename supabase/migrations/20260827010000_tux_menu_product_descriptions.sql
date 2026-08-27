-- Persist the approved TUX menu descriptions as configuration data.
-- Repository migration only: do not apply to a remote Supabase project automatically.
--
-- The POS already renders Product.description in Quick Info. This migration keeps
-- Supabase/configuration as the source of truth, updates the current products rows,
-- and publishes one new configuration snapshot per affected shop so enrolled devices
-- discover a higher version and sync the descriptions through the existing pipeline.

with approved_descriptions(name, description) as (
  values
    ('Single Smashed Patty', '1 smashed patty, cheese, TUX sauce, tomatoes, pickles, lettuce'),
    ('Double Smashed Patty', '2 smashed patties, cheese, TUX sauce, tomatoes, pickles, lettuce'),
    ('Triple Smashed Patty', '3 smashed patties, cheese, TUX sauce, tomatoes, pickles, lettuce'),
    ('TUX Quatro Smashed Patty', '4 smashed patties, cheese sauce, TUX sauce, pickles, caramelized onions, mushroom'),
    ('Single TUXIFY', 'Brioche bun, burger beef, American cheese, pickles, chopped onion, ketchup, TUXIFY sauce'),
    ('Double TUXIFY', 'Brioche bun, 2 burger beef, American cheese, pickles, chopped onion, ketchup, TUXIFY sauce'),
    ('Triple TUXIFY', 'Brioche bun, 3 burger beef, American cheese, pickles, chopped onion, ketchup, TUXIFY sauce'),
    ('Quatro TUXIFY', 'Brioche bun, 4 burger beef, American cheese, pickles, chopped onion, ketchup, TUXIFY sauce'),
    ('Chili Fries', 'Fries, cheese, chili sauce, jalapeno'),
    ('TUX Fries', 'Fries, smashed patty, cheese, pickles, caramelized onions, jalapeno, TUX sauce'),
    ('Doppy Fries', 'Fries, smashed patty, bacon, cheese, caramelized onions, ranch sauce, nachos, chopped green onion'),
    ('Johnny’s', '2 large smashed patties, 2 bacon, cheese sauce, caramelized onion, Johnny’s sauce. Served with potato wedges'),
    ('Classic Hawawshi', 'Baladi bread, hawawshi meat, onion, TUX Hawawshi sauce'),
    ('TUX Hawawshi', 'Baladi bread, hawawshi meat, onion, TUX Hawawshi sauce, mozzarella')
)
update public.products product
set description = approved.description,
    updated_at = now()
from approved_descriptions approved
where product.name = approved.name
  and product.description is distinct from approved.description;

with approved_descriptions(name, description) as (
  values
    ('Single Smashed Patty', '1 smashed patty, cheese, TUX sauce, tomatoes, pickles, lettuce'),
    ('Double Smashed Patty', '2 smashed patties, cheese, TUX sauce, tomatoes, pickles, lettuce'),
    ('Triple Smashed Patty', '3 smashed patties, cheese, TUX sauce, tomatoes, pickles, lettuce'),
    ('TUX Quatro Smashed Patty', '4 smashed patties, cheese sauce, TUX sauce, pickles, caramelized onions, mushroom'),
    ('Single TUXIFY', 'Brioche bun, burger beef, American cheese, pickles, chopped onion, ketchup, TUXIFY sauce'),
    ('Double TUXIFY', 'Brioche bun, 2 burger beef, American cheese, pickles, chopped onion, ketchup, TUXIFY sauce'),
    ('Triple TUXIFY', 'Brioche bun, 3 burger beef, American cheese, pickles, chopped onion, ketchup, TUXIFY sauce'),
    ('Quatro TUXIFY', 'Brioche bun, 4 burger beef, American cheese, pickles, chopped onion, ketchup, TUXIFY sauce'),
    ('Chili Fries', 'Fries, cheese, chili sauce, jalapeno'),
    ('TUX Fries', 'Fries, smashed patty, cheese, pickles, caramelized onions, jalapeno, TUX sauce'),
    ('Doppy Fries', 'Fries, smashed patty, bacon, cheese, caramelized onions, ranch sauce, nachos, chopped green onion'),
    ('Johnny’s', '2 large smashed patties, 2 bacon, cheese sauce, caramelized onion, Johnny’s sauce. Served with potato wedges'),
    ('Classic Hawawshi', 'Baladi bread, hawawshi meat, onion, TUX Hawawshi sauce'),
    ('TUX Hawawshi', 'Baladi bread, hawawshi meat, onion, TUX Hawawshi sauce, mozzarella')
),
latest_snapshots as (
  select distinct on (snapshot.shop_id)
    snapshot.shop_id,
    snapshot.version,
    snapshot.bundle_json
  from public.operations_configuration_snapshots snapshot
  order by snapshot.shop_id, snapshot.version desc
),
candidate_snapshots as (
  select
    latest.shop_id,
    latest.version,
    latest.bundle_json,
    now() as published_at
  from latest_snapshots latest
  where jsonb_typeof(latest.bundle_json #> '{snapshot,products}') = 'array'
    and exists (
      select 1
      from jsonb_array_elements(latest.bundle_json #> '{snapshot,products}') product_json
      join approved_descriptions approved
        on product_json ->> 'name' = approved.name
      where product_json ->> 'description' is distinct from approved.description
    )
),
patched_snapshots as (
  select
    candidate.shop_id,
    candidate.version,
    candidate.bundle_json,
    candidate.published_at,
    (
      select jsonb_agg(
        case
          when approved.name is null then product_entry.item
          else jsonb_set(
            product_entry.item,
            '{description}',
            to_jsonb(approved.description),
            true
          )
        end
        order by product_entry.ordinality
      )
      from jsonb_array_elements(candidate.bundle_json #> '{snapshot,products}')
        with ordinality as product_entry(item, ordinality)
      left join approved_descriptions approved
        on product_entry.item ->> 'name' = approved.name
    ) as products_json
  from candidate_snapshots candidate
),
versioned_snapshots as (
  select
    patched.shop_id,
    patched.version + 1 as version,
    patched.published_at,
    jsonb_set(
      jsonb_set(
        jsonb_set(
          patched.bundle_json,
          '{snapshot,products}',
          patched.products_json,
          false
        ),
        '{snapshot,version}',
        to_jsonb(patched.version + 1),
        false
      ),
      '{snapshot,updatedAt}',
      to_jsonb(patched.published_at),
      false
    ) as bundle_json
  from patched_snapshots patched
)
insert into public.operations_configuration_snapshots(
  shop_id,
  version,
  bundle_json,
  published_at,
  published_by_auth_user_id
)
select
  versioned.shop_id,
  versioned.version,
  versioned.bundle_json,
  versioned.published_at,
  null
from versioned_snapshots versioned;
