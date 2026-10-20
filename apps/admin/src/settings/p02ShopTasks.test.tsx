import type { AdminSettingsWorkspace } from '@tux/admin-contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { ShopsPage } from './ShopsPage';

const shop = {
  id: 'shop-a',
  name: 'TUX Maadi',
  lifecycleState: 'ACTIVE',
  timezone: 'Africa/Cairo',
  temporaryClosed: false,
  onlineOrdersPaused: false,
  active: true,
} as AdminSettingsWorkspace['shop'];
const workspace = {
  shop,
  settingsVersion: 9,
  weeklyHours: [],
  specialHours: [],
} as unknown as AdminSettingsWorkspace;

describe('P02 shop task segmentation', () => {
  it('opens on identity and does not render emergency or lifecycle commands in routine editing', () => {
    const html = renderToStaticMarkup(
      <ShopsPage
        workspace={workspace}
        canManageLifecycle
        onDeleteOrArchive={vi.fn()}
        onUpdateOperationalState={vi.fn()}
        onUpdateIdentity={vi.fn()}
      />,
    );
    expect(html).toContain('Shop management tasks');
    expect(html).toContain('Identity &amp; contact');
    expect(html).toContain('TUX Maadi');
    expect(html).not.toContain('Temporarily close shop');
    expect(html).not.toContain('Delete unused shop');
    expect(html).not.toContain('Requester PIN');
  });
});
