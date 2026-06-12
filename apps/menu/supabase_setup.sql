-- =======================================================
-- TUX BURGER SUPABASE SETUP SCRIPT
-- Run this in the Supabase SQL Editor
-- =======================================================

-- 1. Create categories table
CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  sort_order INTEGER NOT NULL
);

-- 2. Create products table
CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  price NUMERIC NOT NULL DEFAULT 0,
  image_url TEXT,
  is_best_seller BOOLEAN NOT NULL DEFAULT false,
  is_available BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL
);

-- 3. Insert Initial Categories
INSERT INTO categories (id, name, slug, sort_order) VALUES
('tux-burger', 'Tux Burger', 'tux-burger', 1),
('tuxify', 'Tuxify Burger', 'tuxify', 2),
('hawawshi', 'Hawawshi', 'hawawshi', 3),
('fries', 'Fries', 'fries', 4),
('combos', 'Combos', 'combos', 5),
('drinks', 'Drinks', 'drinks', 6)
ON CONFLICT (id) DO NOTHING;

-- 4. Insert Initial Products
INSERT INTO products (id, category_id, name, description, price, image_url, is_best_seller, is_available, sort_order) VALUES
('single-tux-burger', 'tux-burger', 'Single Tux Burger', 'The classic Tux. 150g pure beef patty, melted cheddar, crisp lettuce, fresh tomato, onions, and our signature Tux sauce on a toasted brioche bun.', 190, '/src/assets/tuxlogo.jpg', true, true, 1),
('double-tux-burger', 'tux-burger', 'Double Tux Burger', 'Double the pleasure. Two 150g beef patties stacked with double cheddar, crisp lettuce, fresh tomato, onions, and signature Tux sauce.', 250, '/src/assets/tuxlogo.jpg', false, true, 2),
('triple-tux-burger', 'tux-burger', 'Triple Tux Burger', 'For the truly hungry. Three 150g beef patties, triple cheddar, crisp lettuce, fresh tomato, onions, and signature Tux sauce.', 310, '/src/assets/tuxlogo.jpg', false, true, 3),
('tux-quatro', 'tux-burger', 'TUX Quatro', 'The ultimate mountain of meat. Four 150g beef patties, melted cheese layers, and our signature Tux sauce.', 360, '/src/assets/tuxlogo.jpg', true, true, 4),
('single-tuxify', 'tuxify', 'Single Tuxify', 'Premium single patty with our rich Tuxify sauce, caramelized onions, and premium cheddar on a soft brioche bun.', 180, '/src/assets/tuxify_single.png', false, true, 1),
('double-tuxify', 'tuxify', 'Double Tuxify', 'Double patty goodness with double cheddar, caramelized onions, and our signature Tuxify sauce.', 240, '/src/assets/tuxify_double.png', true, true, 2),
('triple-tuxify', 'tuxify', 'Triple Tuxify', 'Three layers of premium beef, melted cheddar, sweet caramelized onions, and rich Tuxify sauce.', 300, '/src/assets/tuxify_triple.png', false, true, 3),
('quatro-tuxify', 'tuxify', 'Quatro Tuxify', 'Four premium patties, layers of melted cheddar, caramelized onions, and abundant Tuxify sauce.', 360, '/src/assets/tuxify_quatro.png', false, true, 4),
('classic-hawawshi', 'hawawshi', 'Classic Hawawshi', 'Authentic Egyptian Hawawshi with premium spiced minced meat baked to crispy perfection.', 120, '/src/assets/tuxlogo.jpg', false, true, 1),
('tux-hawawshi', 'hawawshi', 'TUX Hawawshi', 'Our signature Hawawshi loaded with extra premium meat, special spices, and melted cheese.', 150, '/src/assets/tuxlogo.jpg', true, true, 2),
('classic-fries-small', 'fries', 'Classic Fries Small', 'Crispy golden French fries, perfectly salted.', 30, '/src/assets/tuxlogo.jpg', false, true, 1),
('classic-fries-large', 'fries', 'Classic Fries Large', 'A large portion of our crispy golden French fries.', 45, '/src/assets/tuxlogo.jpg', false, true, 2),
('cheese-fries', 'fries', 'Cheese Fries', 'Crispy fries smothered in rich, creamy melted cheese sauce.', 60, '/src/assets/tuxlogo.jpg', true, true, 3),
('chili-fries', 'fries', 'Chili Fries', 'Crispy fries topped with our spicy chili con carne.', 75, '/src/assets/tuxlogo.jpg', false, true, 4),
('tux-fries', 'fries', 'TUX Fries', 'Our signature fries loaded with cheese, jalapenos, and special TUX sauce.', 85, '/src/assets/tuxlogo.jpg', true, true, 5),
('doppy-fries', 'fries', 'Doppy Fries', 'Crispy fries with our unique doppy seasoning and sauce blend.', 90, '/src/assets/tuxlogo.jpg', false, true, 6),
('single-combo', 'combos', 'Single Combo', 'Add small fries and a soda to any single burger.', 60, '/src/assets/tuxlogo.jpg', false, true, 1),
('double-combo', 'combos', 'Double Combo', 'Add large fries and a soda to any double burger.', 80, '/src/assets/tuxlogo.jpg', false, true, 2),
('tuxify-combo', 'combos', 'Tuxify Combo', 'The ultimate Tuxify experience with cheese fries and a drink.', 100, '/src/assets/tuxlogo.jpg', true, true, 3),
('family-combo', 'combos', 'Family Combo', '4 single burgers, 2 large fries, and 4 sodas.', 650, '/src/assets/tuxlogo.jpg', false, true, 4),
('soda', 'drinks', 'Soda', 'Ice cold carbonated drink.', 25, '/src/assets/tuxlogo.jpg', false, true, 1),
('water', 'drinks', 'Water', 'Refreshing bottled water.', 10, '/src/assets/tuxlogo.jpg', false, true, 2)
ON CONFLICT (id) DO NOTHING;


-- 5. Row Level Security (RLS) configuration

-- Enable Row Level Security
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;

-- Allow ANYONE to read the categories and products
-- We drop the policy first in case you run this script multiple times
DROP POLICY IF EXISTS "Allow public read access to categories" ON categories;
CREATE POLICY "Allow public read access to categories" ON categories FOR SELECT USING (true);

DROP POLICY IF EXISTS "Allow public read access to products" ON products;
CREATE POLICY "Allow public read access to products" ON products FOR SELECT USING (true);

-- Allow ONLY authenticated users (Admins) to update/insert/delete products
DROP POLICY IF EXISTS "Allow authenticated full access to products" ON products;
CREATE POLICY "Allow authenticated full access to products" ON products FOR ALL USING (auth.role() = 'authenticated');
