import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('order-intake paged catalog authority', () => {
  it('uses deterministic unique ordering before every catalog range page', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'supabase/functions/order-intake/index.ts'),
      'utf8',
    );

    expect(source).toMatch(
      /from\('menu_categories'\)[\s\S]*?eq\('shop_id', shopId\)[\s\S]*?order\('id', \{ ascending: true \}\)[\s\S]*?range\(from, to\)/,
    );
    expect(source).toMatch(
      /from\('products'\)[\s\S]*?eq\('shop_id', shopId\)[\s\S]*?order\('id', \{ ascending: true \}\)[\s\S]*?range\(from, to\)/,
    );
    expect(source).toMatch(
      /from\('modifiers'\)[\s\S]*?eq\('shop_id', shopId\)[\s\S]*?order\('id', \{ ascending: true \}\)[\s\S]*?range\(from, to\)/,
    );
    expect(source).toMatch(
      /from\('product_modifiers'\)[\s\S]*?eq\('shop_id', shopId\)[\s\S]*?order\('product_id', \{ ascending: true \}\)[\s\S]*?order\('modifier_id', \{ ascending: true \}\)[\s\S]*?range\(from, to\)/,
    );
    expect(source).toMatch(
      /from\('combo_beverage_options'\)[\s\S]*?eq\('shop_id', shopId\)[\s\S]*?order\('combo_product_id', \{ ascending: true \}\)[\s\S]*?order\('beverage_product_id', \{ ascending: true \}\)[\s\S]*?range\(from, to\)/,
    );
  });
});
