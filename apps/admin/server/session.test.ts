import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import {
  adminSessionCookie,
  createSessionMaterial,
  requireRecentReauth,
} from './session';

describe('Admin session security', () => {
  it('creates opaque session and CSRF tokens while persisting only hashes', () => {
    const material = createSessionMaterial(new Date('2026-09-10T20:00:00.000Z'));

    expect(material.token).toMatch(/^[0-9a-f]{64}$/);
    expect(material.csrfToken).toMatch(/^[0-9a-f]{64}$/);
    expect(material.tokenHash).toBe(createHash('sha256').update(material.token).digest('hex'));
    expect(material.csrfTokenHash).toBe(
      createHash('sha256').update(material.csrfToken).digest('hex'),
    );
    expect(material.tokenHash).not.toBe(material.token);
    expect(material.csrfTokenHash).not.toBe(material.csrfToken);
    expect(material.expiresAt.getTime()).toBeGreaterThan(
      new Date('2026-09-10T20:00:00.000Z').getTime(),
    );
  });

  it('uses an HttpOnly SameSite=Lax cookie and Secure outside local development', () => {
    const production = adminSessionCookie('a'.repeat(64), {
      secure: true,
      maxAgeSeconds: 3600,
    });
    expect(production).toContain('tux_admin_session=');
    expect(production).toContain('HttpOnly');
    expect(production).toContain('SameSite=Lax');
    expect(production).toContain('Path=/');
    expect(production).toContain('Secure');

    const local = adminSessionCookie('a'.repeat(64), {
      secure: false,
      maxAgeSeconds: 3600,
    });
    expect(local).not.toContain('Secure');
  });

  it('requires reauthentication no older than the configured sensitive-action age', () => {
    const now = new Date('2026-09-10T20:10:00.000Z');
    expect(() =>
      requireRecentReauth({ reauthenticatedAt: null }, 300, now),
    ).toThrow(/reauthentication_required/);
    expect(() =>
      requireRecentReauth(
        { reauthenticatedAt: new Date('2026-09-10T20:04:59.000Z') },
        300,
        now,
      ),
    ).toThrow(/reauthentication_required/);
    expect(() =>
      requireRecentReauth(
        { reauthenticatedAt: new Date('2026-09-10T20:05:01.000Z') },
        300,
        now,
      ),
    ).not.toThrow();
  });
});
