from pathlib import Path
p=Path('e2e/operations.e2e.ts')
s=p.read_text()
old="  let extras = page.getByRole('dialog', { name: 'Single Smashed Patty' });"
new="  const extras = page.getByRole('dialog', { name: 'Single Smashed Patty' });"
if s.count(old)!=1: raise SystemExit(f'expected 1 lint target, got {s.count(old)}')
p.write_text(s.replace(old,new,1))
print('fixed evidence prefer-const')
