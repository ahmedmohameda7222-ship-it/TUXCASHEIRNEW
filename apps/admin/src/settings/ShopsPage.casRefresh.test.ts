import type {
  AdminSpecialHoursConfiguration,
  AdminWeeklyHoursConfiguration,
} from '@tux/admin-contracts';
import { describe, expect, it } from 'vitest';

import {
  reconcileSpecialHoursEditorState,
  reconcileWeeklyHoursEditorState,
} from './ShopsPage';

const weekly: AdminWeeklyHoursConfiguration = {
  id: '11111111-1111-4111-8111-111111111111',
  serviceKind: 'ONLINE',
  dayOfWeek: 1,
  timezone: 'Africa/Cairo',
  opensLocal: '09:00:00',
  closesLocal: '22:00:00',
  active: true,
};

const special: AdminSpecialHoursConfiguration = {
  id: '22222222-2222-4222-8222-222222222222',
  serviceDate: '2026-09-20',
  serviceKind: 'ONLINE',
  timezone: 'Africa/Cairo',
  closed: false,
  opensLocal: '10:00:00',
  closesLocal: '20:00:00',
  note: 'Original',
};

describe('service-hours editor reconciliation', () => {
  it('refreshes a pristine weekly editor when the canonical row changes without a settings-version bump', () => {
    const state = {
      expectedSettingsVersion: 7,
      expectedRow: {
        serviceKind: weekly.serviceKind,
        dayOfWeek: weekly.dayOfWeek,
        opensLocal: weekly.opensLocal,
        closesLocal: weekly.closesLocal,
        active: weekly.active,
      },
      form: {
        serviceKind: weekly.serviceKind,
        dayOfWeek: weekly.dayOfWeek,
        opensLocal: '09:00:00',
        closesLocal: '22:00:00',
        active: weekly.active,
      },
      dirty: false,
    } as const;

    const refreshed = reconcileWeeklyHoursEditorState(state, {
      ...weekly,
      opensLocal: '10:30:00',
      closesLocal: '23:15:00',
    }, 7);

    expect(refreshed.expectedSettingsVersion).toBe(7);
    expect(refreshed.expectedRow.opensLocal).toBe('10:30:00');
    expect(refreshed.form.opensLocal).toBe('10:30:00');
    expect(refreshed.form.closesLocal).toBe('23:15:00');
  });

  it('preserves a dirty weekly edit and its original CAS snapshot across a refresh', () => {
    const state = {
      expectedSettingsVersion: 7,
      expectedRow: {
        serviceKind: weekly.serviceKind,
        dayOfWeek: weekly.dayOfWeek,
        opensLocal: weekly.opensLocal,
        closesLocal: weekly.closesLocal,
        active: weekly.active,
      },
      form: {
        serviceKind: weekly.serviceKind,
        dayOfWeek: weekly.dayOfWeek,
        opensLocal: '08:30:00',
        closesLocal: '22:00:00',
        active: weekly.active,
      },
      dirty: true,
    } as const;

    expect(
      reconcileWeeklyHoursEditorState(state, { ...weekly, opensLocal: '10:30:00' }, 8),
    ).toBe(state);
  });

  it('refreshes a pristine special-hours editor when its row changes independently', () => {
    const state = {
      expectedSettingsVersion: 7,
      expectedRow: {
        serviceDate: special.serviceDate,
        serviceKind: special.serviceKind,
        closed: special.closed,
        opensLocal: special.opensLocal,
        closesLocal: special.closesLocal,
        note: special.note,
      },
      serviceDate: special.serviceDate,
      serviceKind: special.serviceKind,
      closed: special.closed,
      opensLocal: '10:00:00',
      closesLocal: '20:00:00',
      note: 'Original',
      dirty: false,
    } as const;

    const refreshed = reconcileSpecialHoursEditorState(
      state,
      { ...special, closed: true, opensLocal: null, closesLocal: null, note: 'Holiday' },
      7,
    );

    expect(refreshed.expectedSettingsVersion).toBe(7);
    expect(refreshed.expectedRow.closed).toBe(true);
    expect(refreshed.closed).toBe(true);
    expect(refreshed.opensLocal).toBe('');
    expect(refreshed.closesLocal).toBe('');
    expect(refreshed.note).toBe('Holiday');
  });
});
