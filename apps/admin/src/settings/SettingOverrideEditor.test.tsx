import type { AdminSettingsWorkspace } from '@tux/admin-contracts';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { SettingOverrideEditor } from './SettingOverrideEditor';

const shopId = '11111111-1111-4111-8111-111111111111';

function workspace(value: string, version: number): AdminSettingsWorkspace {
  return {
    shop: {
      id: shopId,
      name: 'TUX Maadi',
      lifecycleState: 'ACTIVE',
      active: true,
      address: null,
      contactPhone: null,
      latitude: null,
      longitude: null,
      timezone: 'Africa/Cairo',
      temporaryClosed: false,
      onlineOrdersPaused: false,
    },
    settingsVersion: 7,
    businessDefaults: [],
    shopOverrides: [{ key: 'receipt.orderPrefix', value, version }],
    orderTypes: [],
    paymentMethods: [],
    deliveryZones: [],
    reasonCodes: [],
    weeklyHours: [],
    specialHours: [],
  };
}

describe('SettingOverrideEditor CAS capture', () => {
  it('keeps the form-captured CAS version when a dirty editor receives a refreshed workspace', async () => {
    const onUpdate = vi.fn(async () => undefined);
    const view = render(
      <SettingOverrideEditor
        workspace={workspace('MD-', 4)}
        settingKey="receipt.orderPrefix"
        label="Order prefix"
        kind="text"
        updating={false}
        onUpdate={onUpdate}
      />,
    );

    fireEvent.change(screen.getByLabelText('Order prefix'), { target: { value: 'LOCAL-' } });
    view.rerender(
      <SettingOverrideEditor
        workspace={workspace('REMOTE-', 5)}
        settingKey="receipt.orderPrefix"
        label="Order prefix"
        kind="text"
        updating={false}
        onUpdate={onUpdate}
      />,
    );

    expect(screen.getByLabelText('Order prefix')).toHaveValue('LOCAL-');
    fireEvent.click(screen.getByRole('button', { name: 'Save Order prefix' }));

    await waitFor(() =>
      expect(onUpdate).toHaveBeenCalledWith({
        settingKey: 'receipt.orderPrefix',
        value: 'LOCAL-',
        expectedVersion: 4,
      }),
    );
  });

  it('syncs a pristine editor to the refreshed value and CAS version', async () => {
    const onUpdate = vi.fn(async () => undefined);
    const view = render(
      <SettingOverrideEditor
        workspace={workspace('MD-', 4)}
        settingKey="receipt.orderPrefix"
        label="Order prefix"
        kind="text"
        updating={false}
        onUpdate={onUpdate}
      />,
    );

    view.rerender(
      <SettingOverrideEditor
        workspace={workspace('REMOTE-', 5)}
        settingKey="receipt.orderPrefix"
        label="Order prefix"
        kind="text"
        updating={false}
        onUpdate={onUpdate}
      />,
    );

    await waitFor(() => expect(screen.getByLabelText('Order prefix')).toHaveValue('REMOTE-'));
    fireEvent.change(screen.getByLabelText('Order prefix'), { target: { value: 'NEXT-' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Order prefix' }));

    await waitFor(() =>
      expect(onUpdate).toHaveBeenCalledWith({
        settingKey: 'receipt.orderPrefix',
        value: 'NEXT-',
        expectedVersion: 5,
      }),
    );
  });
});
