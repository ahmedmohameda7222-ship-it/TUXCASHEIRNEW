import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

describe('precise rendered Inventory formatting capture', () => {
  it('records the canonical repo Prettier output in bounded CI chunks', () => {
    const path = 'e2e/admin-inventory.spec.ts';
    const formatted = execFileSync('node_modules/.bin/prettier', [path], {
      encoding: 'utf8',
      maxBuffer: 5 * 1024 * 1024,
    });
    for (let offset = 0, part = 0; offset < formatted.length; offset += 680, part++) {
      console.log('TUXINVFMT|' + part + '|' + JSON.stringify(formatted.slice(offset, offset + 680)));
    }
    console.log('TUXINVFMT_END|' + Math.ceil(formatted.length / 680));
    expect(formatted).toContain('360, 1100');
  });
});
