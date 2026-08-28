import { expect, it } from 'vitest';

it('exports category-scoped product movement', async () => {
  const module = await import('./menuProductOrder');
  expect('moveProductWithinCategory' in module).toBe(true);
});
