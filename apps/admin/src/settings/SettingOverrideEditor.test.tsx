import { describe, expect, it } from 'vitest';

import { reconcileSettingEditorState } from './SettingOverrideEditor';

describe('SettingOverrideEditor CAS capture', () => {
  it('keeps the form-captured CAS version when a dirty editor receives a refreshed workspace', () => {
    const dirty = {
      raw: 'LOCAL-',
      baselineRaw: 'MD-',
      expectedVersion: 4,
    };

    const reconciled = reconcileSettingEditorState(dirty, 'REMOTE-', 5);

    expect(reconciled).toBe(dirty);
    expect(reconciled).toEqual({
      raw: 'LOCAL-',
      baselineRaw: 'MD-',
      expectedVersion: 4,
    });
  });

  it('syncs a pristine editor to the refreshed value and CAS version', () => {
    expect(
      reconcileSettingEditorState(
        {
          raw: 'MD-',
          baselineRaw: 'MD-',
          expectedVersion: 4,
        },
        'REMOTE-',
        5,
      ),
    ).toEqual({
      raw: 'REMOTE-',
      baselineRaw: 'REMOTE-',
      expectedVersion: 5,
    });
  });
});
