import { describe, expect, it } from 'vitest';

import { bootstrapOwner, OwnerBootstrapError } from './bootstrapOwner';

describe('first Admin OWNER bootstrap', () => {
  it('submits only one-way credential material to the service-role bootstrap dependency', async () => {
    const calls: Array<Record<string, string>> = [];
    const result = await bootstrapOwner(
      { displayName: 'Primary Owner', pin: '482731' },
      {
        pinLookupSecret: 'test-owner-bootstrap-secret',
        async createOwner(input) {
          calls.push(input);
          return 'employee-1';
        },
      },
    );

    expect(result.employeeId).toBe('employee-1');
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ displayName: 'Primary Owner' });
    expect(calls[0]?.pinLookupHash).toMatch(/^[0-9a-f]{64}$/);
    expect(calls[0]?.pinHash).toMatch(/^pbkdf2-sha256\$210000\$/);
    expect(JSON.stringify(calls[0])).not.toContain('482731');
  });

  it('surfaces the one-time owner-already-exists condition without retrying', async () => {
    let attempts = 0;
    await expect(
      bootstrapOwner(
        { displayName: 'Second Owner', pin: '593842' },
        {
          pinLookupSecret: 'test-owner-bootstrap-secret',
          async createOwner() {
            attempts += 1;
            throw new OwnerBootstrapError('owner_already_exists');
          },
        },
      ),
    ).rejects.toMatchObject({ code: 'owner_already_exists' });
    expect(attempts).toBe(1);
  });
});
