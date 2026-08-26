from pathlib import Path

root = Path.cwd()

premium_path = root / 'apps/operations/src/styles/premium.css'
premium = premium_path.read_text()
old_title = '''.product-copy strong {
  display: -webkit-box;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  font-size: var(--tux-font-size-sm);
  line-height: 1.28;
}'''
new_title = '''.product-copy strong {
  display: block;
  overflow: visible;
  font-size: var(--tux-font-size-sm);
  line-height: 1.28;
}'''
if premium.count(old_title) != 1:
    raise SystemExit(f'product title clamp block mismatch: {premium.count(old_title)}')
premium_path.write_text(premium.replace(old_title, new_title, 1))

e2e_path = root / 'e2e/operations.e2e.ts'
e2e = e2e_path.read_text()
old_dec = "getByRole('button', { name: '−1', exact: true })"
old_inc = "getByRole('button', { name: '+1', exact: true })"
if e2e.count(old_dec) < 2:
    raise SystemExit(f'expected stale decrement locators, got {e2e.count(old_dec)}')
if e2e.count(old_inc) < 2:
    raise SystemExit(f'expected stale increment locators, got {e2e.count(old_inc)}')
e2e = e2e.replace(old_dec, "getByRole('button', { name: /Decrease .* quantity/ })")
e2e = e2e.replace(old_inc, "getByRole('button', { name: /Increase .* quantity/ })")
old_loop = """  for (const name of ['−1', '+1']) {
    const box = await line.getByRole('button', { name, exact: true }).boundingBox();
    expect(box).not.toBeNull();
    expect(Math.round(box!.width)).toBe(44);
    expect(Math.round(box!.height)).toBe(44);
  }"""
new_loop = """  for (const name of [/Decrease .* quantity/, /Increase .* quantity/]) {
    const box = await line.getByRole('button', { name }).boundingBox();
    expect(box).not.toBeNull();
    expect(Math.round(box!.width)).toBe(44);
    expect(Math.round(box!.height)).toBe(44);
  }"""
if e2e.count(old_loop) != 1:
    raise SystemExit(f'cart geometry loop mismatch: {e2e.count(old_loop)}')
e2e_path.write_text(e2e.replace(old_loop, new_loop, 1))

print('final recovered CSS/E2E fixes applied')
