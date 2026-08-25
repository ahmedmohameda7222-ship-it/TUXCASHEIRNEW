from pathlib import Path
import re

path = Path('e2e/operations.e2e.ts')
text = path.read_text()

start = text.index('  const products = [')
end = text.index('  const inventoryItems = [', start)
products_block = r'''  const productRows = [
    {
      name: 'Single Smashed Patty',
      priceMinor: 12_000,
      categoryIndex: 1,
      family: 'TUX',
      isCombo: false,
      soldOut: false,
      description: '1 smashed patty, cheese, TUX sauce, tomatoes, pickles, lettuce',
    },
    {
      name: 'Double Smashed Patty',
      priceMinor: 16_000,
      categoryIndex: 1,
      family: 'TUX',
      isCombo: false,
      soldOut: false,
      description: '2 smashed patties, cheese, TUX sauce, tomatoes, pickles, lettuce',
    },
    {
      name: 'Triple Smashed Patty',
      priceMinor: 20_000,
      categoryIndex: 1,
      family: 'TUX',
      isCombo: false,
      soldOut: false,
      description: '3 smashed patties, cheese, TUX sauce, tomatoes, pickles, lettuce',
    },
    {
      name: 'TUX Quatro Smashed Patty',
      priceMinor: 25_000,
      categoryIndex: 1,
      family: 'TUX',
      isCombo: false,
      soldOut: true,
      description: '4 smashed patties, cheese sauce, TUX sauce, pickles, caramelized onions, mushroom',
    },
    {
      name: 'Single TUXIFY',
      priceMinor: 14_000,
      categoryIndex: 1,
      family: 'TUXIFY',
      isCombo: false,
      soldOut: false,
      description: 'Brioche bun, burger beef, American cheese, pickles, chopped onion, ketchup, TUXIFY sauce',
    },
    {
      name: 'Double TUXIFY',
      priceMinor: 18_000,
      categoryIndex: 1,
      family: 'TUXIFY',
      isCombo: false,
      soldOut: false,
      description: 'Brioche bun, 2 burger beef, American cheese, pickles, chopped onion, ketchup, TUXIFY sauce',
    },
    {
      name: 'Triple TUXIFY',
      priceMinor: 22_000,
      categoryIndex: 1,
      family: 'TUXIFY',
      isCombo: false,
      soldOut: false,
      description: 'Brioche bun, 3 burger beef, American cheese, pickles, chopped onion, ketchup, TUXIFY sauce',
    },
    {
      name: 'Quatro TUXIFY',
      priceMinor: 26_000,
      categoryIndex: 1,
      family: 'TUXIFY',
      isCombo: false,
      soldOut: false,
      description: 'Brioche bun, 4 burger beef, American cheese, pickles, chopped onion, ketchup, TUXIFY sauce',
    },
    {
      name: 'Johnny’s',
      priceMinor: 33_000,
      categoryIndex: 1,
      family: null,
      isCombo: false,
      soldOut: false,
      description: '2 large smashed patties, 2 bacon, cheese sauce, caramelized onion, Johnny’s sauce. Served with potato wedges',
    },
    {
      name: 'Classic Fries',
      priceMinor: 3_000,
      categoryIndex: 3,
      family: null,
      isCombo: false,
      soldOut: false,
      description: null,
    },
    {
      name: 'Potato Wedges',
      priceMinor: 4_000,
      categoryIndex: 3,
      family: null,
      isCombo: false,
      soldOut: false,
      description: null,
    },
    {
      name: 'Chili Fries',
      priceMinor: 7_000,
      categoryIndex: 3,
      family: null,
      isCombo: false,
      soldOut: false,
      description: 'Fries, cheese, chili sauce, jalapeno',
    },
    {
      name: 'TUX Fries',
      priceMinor: 9_500,
      categoryIndex: 3,
      family: null,
      isCombo: false,
      soldOut: false,
      description: 'Fries, smashed patty, cheese, pickles, caramelized onions, jalapeno, TUX sauce',
    },
    {
      name: 'Doppy Fries',
      priceMinor: 12_500,
      categoryIndex: 3,
      family: null,
      isCombo: false,
      soldOut: false,
      description: 'Fries, smashed patty, bacon, cheese, caramelized onions, ranch sauce, nachos, chopped green onion',
    },
    {
      name: 'Classic Hawawshi',
      priceMinor: 10_500,
      categoryIndex: 4,
      family: null,
      isCombo: false,
      soldOut: false,
      description: 'Baladi bread, hawawshi meat, onion, TUX Hawawshi sauce',
    },
    {
      name: 'TUX Hawawshi',
      priceMinor: 12_500,
      categoryIndex: 4,
      family: null,
      isCombo: false,
      soldOut: false,
      description: 'Baladi bread, hawawshi meat, onion, TUX Hawawshi sauce, mozzarella',
    },
    {
      name: 'Soda',
      priceMinor: 2_000,
      categoryIndex: 7,
      family: null,
      isCombo: false,
      soldOut: false,
      description: null,
    },
    {
      name: 'Water',
      priceMinor: 1_000,
      categoryIndex: 7,
      family: null,
      isCombo: false,
      soldOut: false,
      description: null,
    },
    {
      name: 'Combo Smash + Required Beverage',
      priceMinor: 19_000,
      categoryIndex: 2,
      family: null,
      isCombo: true,
      soldOut: false,
      description: null,
    },
  ] as const;
  const products = productRows.map((item, index) => ({
    id: product(index + 1),
    shopId: SHOP,
    categoryId: category(item.categoryIndex),
    name: item.name,
    description: item.description,
    priceMinor: item.priceMinor,
    imageKey: null,
    active: true,
    soldOut: item.soldOut,
    family: item.family,
    isCombo: item.isCombo,
    sortOrder: index,
  }));
'''
text = text[:start] + products_block + text[end:]

old_combo = '''      comboBeverageOptions: [13, 14, 15, 16, 17, 18].map((beverageIndex, sortOrder) => ({
        shopId: SHOP,
        comboProductId: product(7),
        beverageProductId: product(beverageIndex),
        sortOrder,
      })),'''
new_combo = '''      comboBeverageOptions: [17, 18].map((beverageIndex, sortOrder) => ({
        shopId: SHOP,
        comboProductId: product(19),
        beverageProductId: product(beverageIndex),
        sortOrder,
      })),'''
if old_combo not in text:
    raise SystemExit('Expected combo beverage fixture block not found')
text = text.replace(old_combo, new_combo, 1)

# Product 5 is now a beef TUXIFY burger, not chicken.
old_recipe = '''        {
          shopId: SHOP,
          productId: product(5),
          inventoryItemId: inventory(2),
          quantityMicros: 1_000_000,
        },'''
new_recipe = '''        {
          shopId: SHOP,
          productId: product(5),
          inventoryItemId: inventory(1),
          quantityMicros: 1_000_000,
        },'''
if old_recipe not in text:
    raise SystemExit('Expected product 5 recipe block not found')
text = text.replace(old_recipe, new_recipe, 1)

# Explicit legacy product-selector migrations. Category labels are intentionally untouched.
for old, new in [
    ('Classic Smash', 'Single Smashed Patty'),
    ('Double Smash', 'Double Smashed Patty'),
    ('Triple Smash', 'Triple Smashed Patty'),
    ('Long Name Layout Stress Burger with Extra Description', 'Johnny’s'),
    ('Sold Out Test Burger', 'TUX Quatro Smashed Patty'),
]:
    text = text.replace(old, new)

text = text.replace("name: 'Add one TUX Loaded Burger'", "name: 'Add one Triple TUXIFY'")
text = text.replace("name: 'Add one Spicy Chicken'", "name: 'Add one Double TUXIFY'")
text = text.replace("name: 'Add one Cola'", "name: 'Add one Soda'")
text = text.replace("label: 'Cola'", "label: 'Soda'")

path.write_text(text)
