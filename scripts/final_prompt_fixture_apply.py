from pathlib import Path

path = Path('e2e/operations.e2e.ts')
text = path.read_text()


def replace_once(old: str, new: str) -> None:
    global text
    if old not in text:
        raise SystemExit(f'Expected final-evidence snippet not found: {old[:120]!r}')
    text = text.replace(old, new, 1)


replace_once(
    "  const products = [\n    ['Classic Smash', 12_000, 1, false, false],\n    ['Double Smash', 16_000, 1, false, false],\n    ['Triple Smash', 20_000, 1, false, false],\n    ['TUX Loaded Burger', 22_000, 1, false, false],\n    ['Crispy Chicken', 14_000, 1, false, false],\n    ['Spicy Chicken', 15_000, 1, false, false],\n    ['Combo Smash + Required Beverage', 19_000, 1, true, false],\n    ['Long Name Layout Stress Burger with Extra Description', 21_000, 1, false, false],\n    ['Sold Out Test Burger', 17_000, 1, false, true],\n    ['Fries', 5_000, 2, false, false],\n    ['Loaded Fries', 8_000, 2, false, false],\n    ['Onion Rings', 6_000, 2, false, false],\n    ['Cola', 3_000, 3, false, false],\n    ['Diet Cola', 3_000, 3, false, false],\n    ['Water', 2_000, 3, false, false],\n    ['Orange Soda', 3_000, 3, false, false],\n    ['Lemon Soda', 3_000, 3, false, false],\n    ['Iced Tea', 4_000, 3, false, false],\n  ].map(([name, priceMinor, categoryIndex, isCombo, soldOut], index) => ({",
    "  const products = [\n    ['Single Smashed Patty', 12_000, 1, false, false],\n    ['Double Smashed Patty', 16_000, 1, false, false],\n    ['Triple Smashed Patty', 20_000, 1, false, false],\n    ['TUX Quatro Smashed Patty', 22_000, 1, false, false],\n    ['Single TUXIFY', 14_000, 2, false, false],\n    ['Double TUXIFY', 15_000, 2, false, false],\n    ['Triple TUXIFY', 19_000, 2, true, false],\n    ['Quatro TUXIFY', 21_000, 2, false, false],\n    ['Chili Fries', 17_000, 2, false, true],\n    ['TUX Fries', 5_000, 2, false, false],\n    ['Doppy Fries', 8_000, 2, false, false],\n    [\"Johnny's\", 6_000, 1, false, false],\n    ['Soda', 3_000, 3, false, false],\n    ['Classic Hawawshi', 3_000, 1, false, false],\n    ['Water', 2_000, 3, false, false],\n    ['Classic Fries', 3_000, 2, false, false],\n    ['Potato Wedges', 3_000, 2, false, false],\n    ['TUX Hawawshi', 4_000, 1, false, false],\n  ].map(([name, priceMinor, categoryIndex, isCombo, soldOut], index) => ({",
)

replace_once(
    "    description:\n      index === 0\n        ? '1 smashed patty, cheese, TUX sauce, tomatoes, pickles, lettuce'\n        : index === 1\n          ? '2 smashed patties, cheese, TUX sauce, tomatoes, pickles, lettuce'\n          : index === 2\n            ? '3 smashed patties, cheese, TUX sauce, tomatoes, pickles, lettuce'\n            : index === 3\n              ? '4 smashed patties, cheese sauce, TUX sauce, pickles, caramelized onions, mushroom'\n              : index === 7\n                ? 'Development-only long text used to stress responsive menu layout.'\n                : index === 10\n                  ? 'Fries, smashed patty, cheese, pickles, caramelized onions, jalapeno, TUX sauce'\n                  : null,",
    "    description:\n      index === 0\n        ? '1 smashed patty, cheese, TUX sauce, tomatoes, pickles, lettuce'\n        : index === 1\n          ? '2 smashed patties, cheese, TUX sauce, tomatoes, pickles, lettuce'\n          : index === 2\n            ? '3 smashed patties, cheese, TUX sauce, tomatoes, pickles, lettuce'\n            : index === 3\n              ? '4 smashed patties, cheese sauce, TUX sauce, pickles, caramelized onions, mushroom'\n              : index === 4\n                ? 'Brioche bun, burger beef, American cheese, pickles, chopped onion, ketchup, TUXIFY sauce'\n                : index === 5\n                  ? 'Brioche bun, 2 burger beef, American cheese, pickles, chopped onion, ketchup, TUXIFY sauce'\n                  : index === 6\n                    ? 'Brioche bun, 3 burger beef, American cheese, pickles, chopped onion, ketchup, TUXIFY sauce'\n                    : index === 7\n                      ? 'Brioche bun, 4 burger beef, American cheese, pickles, chopped onion, ketchup, TUXIFY sauce'\n                      : index === 8\n                        ? 'Fries, cheese, chili sauce, jalapeno'\n                        : index === 9\n                          ? 'Fries, smashed patty, cheese, pickles, caramelized onions, jalapeno, TUX sauce'\n                          : index === 10\n                            ? 'Fries, smashed patty, bacon, cheese, caramelized onions, ranch sauce, nachos, chopped green onion'\n                            : index === 11\n                              ? \"2 large smashed patties, 2 bacon, cheese sauce, caramelized onion, Johnny's sauce. Served with potato wedges\"\n                              : index === 13\n                                ? 'Baladi bread, hawawshi meat, onion, TUX Hawawshi sauce'\n                                : index === 17\n                                  ? 'Baladi bread, hawawshi meat, onion, TUX Hawawshi sauce, mozzarella'\n                                  : null,",
)

replace_once(
    "        { id: category(1), shopId: SHOP, name: 'Burgers', sortOrder: 0, active: true },\n        { id: category(2), shopId: SHOP, name: 'Sides', sortOrder: 1, active: true },",
    "        { id: category(1), shopId: SHOP, name: 'TUX', sortOrder: 0, active: true },\n        { id: category(2), shopId: SHOP, name: 'TUXIFY', sortOrder: 1, active: true },",
)

for old, new in [
    ('TUX Loaded Burger', 'TUX Quatro Smashed Patty'),
    ('Classic Smash', 'Single Smashed Patty'),
    ('Double Smash', 'Double Smashed Patty'),
    ('Triple Smash', 'Triple Smashed Patty'),
    ('Spicy Chicken', 'Double TUXIFY'),
    ('Cola', 'Soda'),
    ('Burgers', 'TUX'),
    ('Sides', 'TUXIFY'),
]:
    text = text.replace(old, new)

path.write_text(text)
