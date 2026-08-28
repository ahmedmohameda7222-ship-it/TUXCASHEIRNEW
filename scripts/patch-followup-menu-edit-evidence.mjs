import fs from 'node:fs';

const path = 'e2e/operations.e2e.ts';
let source = fs.readFileSync(path, 'utf8');

const before = `  await page.getByRole('button', { name: 'Edit categories' }).click();\n  await expect(page.getByLabel('Edit categories')).toBeVisible();\n  await shot('followup-03-orders-category-edit-1440.png');\n  await page.getByRole('button', { name: 'Done', exact: true }).click();`;
const after = `  const editMenu = page.getByRole('button', { name: 'Edit menu' });\n  await editMenu.click();\n  await expect(editMenu).toHaveAttribute('aria-pressed', 'true');\n  await expect(page.getByLabel('Menu edit actions')).toBeVisible();\n  await shot('followup-03-orders-menu-edit-1440.png');\n  await page.getByRole('button', { name: 'Cancel', exact: true }).click();`;

const first = source.indexOf(before);
if (first < 0) throw new Error('stale category-edit evidence sequence not found');
if (source.indexOf(before, first + before.length) >= 0) {
  throw new Error('stale category-edit evidence sequence was not unique');
}
source = `${source.slice(0, first)}${after}${source.slice(first + before.length)}`;

if (source.includes("getByRole('button', { name: 'Edit categories' }).click()")) {
  throw new Error('another clickable Edit categories path remains in operations E2E');
}

fs.writeFileSync(path, source);
