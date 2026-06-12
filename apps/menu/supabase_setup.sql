-- =======================================================
-- TUX BURGER SUPABASE SETUP SCRIPT v2
-- Run this in the Supabase SQL Editor
-- =======================================================

-- 1. Create product_sections table (Categories)
CREATE TABLE IF NOT EXISTS product_sections (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  description TEXT,
  sort_order INTEGER NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. Create products table
CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  section_id TEXT NOT NULL REFERENCES product_sections(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  price NUMERIC NOT NULL DEFAULT 0,
  image_url TEXT,
  image_path TEXT, -- Used to track the exact file path in Supabase Storage for deletion
  is_best_seller BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 3. Create website_settings table (Optional for future use)
CREATE TABLE IF NOT EXISTS website_settings (
  id TEXT PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  value JSONB NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 3b. Migrate existing tables from older setup versions
-- CREATE TABLE IF NOT EXISTS does not add missing columns to existing tables.
ALTER TABLE product_sections
ADD COLUMN IF NOT EXISTS slug TEXT,
ADD COLUMN IF NOT EXISTS description TEXT,
ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();

ALTER TABLE products
ADD COLUMN IF NOT EXISTS section_id TEXT,
ADD COLUMN IF NOT EXISTS description TEXT,
ADD COLUMN IF NOT EXISTS price NUMERIC NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS image_url TEXT,
ADD COLUMN IF NOT EXISTS image_path TEXT,
ADD COLUMN IF NOT EXISTS is_best_seller BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();

UPDATE product_sections
SET slug = id
WHERE slug IS NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'products'
      AND column_name = 'category_id'
  ) THEN
    EXECUTE 'UPDATE products SET section_id = category_id WHERE section_id IS NULL';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'products'
      AND column_name = 'is_available'
  ) THEN
    EXECUTE 'UPDATE products SET is_active = is_available';
  END IF;
END $$;

-- 4. Initial Sections Data (Migration from old menu-data)
INSERT INTO product_sections (id, name, slug, sort_order) VALUES
('tux-burger', 'Tux Burger', 'tux-burger', 1),
('tuxify', 'Tuxify Burger', 'tuxify', 2),
('hawawshi', 'Hawawshi', 'hawawshi', 3),
('fries', 'Fries', 'fries', 4),
('combos', 'Combos', 'combos', 5),
('drinks', 'Drinks', 'drinks', 6)
ON CONFLICT (id) DO NOTHING;

-- 5. Row Level Security (RLS) configuration

ALTER TABLE product_sections ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE website_settings ENABLE ROW LEVEL SECURITY;

-- Allow ANYONE to read active sections and products
DROP POLICY IF EXISTS "Allow public read access to active sections" ON product_sections;
CREATE POLICY "Allow public read access to active sections" ON product_sections FOR SELECT USING (is_active = true);

DROP POLICY IF EXISTS "Allow public read access to active products" ON products;
CREATE POLICY "Allow public read access to active products" ON products FOR SELECT USING (is_active = true);

-- Allow Admin full access
DROP POLICY IF EXISTS "Allow admin full access to sections" ON product_sections;
CREATE POLICY "Allow admin full access to sections" ON product_sections FOR ALL USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Allow admin full access to products" ON products;
CREATE POLICY "Allow admin full access to products" ON products FOR ALL USING (auth.role() = 'authenticated');

-- 6. Setup Supabase Storage Bucket for Product Images

-- Create the bucket if it doesn't exist (Requires superuser / Postgres permissions)
INSERT INTO storage.buckets (id, name, public) 
VALUES ('product-images', 'product-images', true)
ON CONFLICT (id) DO NOTHING;

-- Storage Policies
-- Allow public read access to files
DROP POLICY IF EXISTS "Public Access" ON storage.objects;
DROP POLICY IF EXISTS "Allow public read product images" ON storage.objects;
CREATE POLICY "Allow public read product images"
ON storage.objects
FOR SELECT
USING (bucket_id = 'product-images');

-- Allow authenticated admins to upload, replace, and delete product images
DROP POLICY IF EXISTS "Admin Access" ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated upload product images" ON storage.objects;
CREATE POLICY "Allow authenticated upload product images"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'product-images');

DROP POLICY IF EXISTS "Allow authenticated update product images" ON storage.objects;
CREATE POLICY "Allow authenticated update product images"
ON storage.objects
FOR UPDATE
TO authenticated
USING (bucket_id = 'product-images')
WITH CHECK (bucket_id = 'product-images');

DROP POLICY IF EXISTS "Allow authenticated delete product images" ON storage.objects;
CREATE POLICY "Allow authenticated delete product images"
ON storage.objects
FOR DELETE
TO authenticated
USING (bucket_id = 'product-images');
