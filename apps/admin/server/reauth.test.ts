import { describe, expect, it } from 'vitest';

import { hashPin } from './pin';
import { reauthenticateAdminSession } from './reauth';

describe('Admin sensitive reauthentication', () => {
  it('updates only reauthenticated_at after the acting employee confirms the correct PIN', async () => {
    const pinHash = await hashPin('482731');
    const updates: Date[] = [];
    const now = new Date('2026-09-10T20:30:00.000Z');

    await reauthenticateAdminSession(
      { sessionId: 'session-1', employeeId: 'employee-1', pinHash },
      '482731',
      {
        now: () => now,
        markReauthenticated: async (sessionId, at) => {
          expect(sessionId).toBe('session-1');
          updates.push(at);
        },
      },
    );

    expect(updates).toEqual([now]);
  });

  it('rejects a wrong PIN without touching session reauthentication state', async () => {
    const pinHash = await hashPin('482731');
    let updated = false;

    await expect(
      reauthenticateAdminSession(
        { sessionId: 'session-1', employeeId: 'employee-1', pinHash },
        '482732',
        {
          now: () => new Date(),
          markReauthenticated: async () => {
            updated = true;
          },
        },
      ),
    ).rejects.toThrow(/invalid_pin/);

    expect(updated).toBe(false);
  });
});
