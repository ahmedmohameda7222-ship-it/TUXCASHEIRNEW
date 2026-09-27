import { describe, expect, it } from 'vitest';

import { hashPin } from './pin';
import { reauthenticateAdminSession, requireRecentReauth } from './reauth';

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

  it('rejects a wrong PIN as an authentication failure without touching session state', async () => {
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
    ).rejects.toMatchObject({ code: 'invalid_pin', status: 401 });

    expect(updated).toBe(false);
  });
  it('requires a re-PIN within the configured sensitive-action window', () => {
    const now = new Date('2026-09-27T14:30:00.000Z');

    expect(() =>
      requireRecentReauth(
        { reauthenticated_at: '2026-09-27T14:26:00.000Z' },
        300,
        now,
      ),
    ).not.toThrow();

    expect(() =>
      requireRecentReauth(
        { reauthenticated_at: '2026-09-27T14:24:59.000Z' },
        300,
        now,
      ),
    ).toThrowError('reauthentication_required');

    expect(() =>
      requireRecentReauth({ reauthenticated_at: null }, 300, now),
    ).toThrowError('reauthentication_required');
  });

});
