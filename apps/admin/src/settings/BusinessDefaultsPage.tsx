import type { AdminSettingsWorkspace } from '@tux/admin-contracts';

import { CheckoutPage } from './CheckoutPage';
import { ReceiptsPage } from './ReceiptsPage';
import type { SettingOverrideUpdateDraft } from './useSettings';

export function BusinessDefaultsPage({
  workspace,
  onUpdate,
  updating,
}: {
  workspace: AdminSettingsWorkspace;
  onUpdate(draft: SettingOverrideUpdateDraft): void | Promise<void>;
  updating: boolean;
}) {
  // A default editor must never use a shop override as its input or expected version.
  const defaultsWorkspace = { ...workspace, shopOverrides: [] };
  return (
    <section className="admin-settings-section" aria-labelledby="settings-business-defaults-title">
      <div className="admin-settings-section__header">
        <div>
          <p className="admin-settings-kicker">Business-wide configuration</p>
          <h2 id="settings-business-defaults-title">Business defaults</h2>
        </div>
      </div>
      <p className="admin-field__help">
        These defaults apply to shops that have not configured an override. Save changes here,
        then publish settings for each affected shop before future orders use them.
      </p>
      <CheckoutPage workspace={defaultsWorkspace} onUpdate={onUpdate} updating={updating} scope="business" />
      <ReceiptsPage workspace={defaultsWorkspace} onUpdate={onUpdate} updating={updating} scope="business" />
    </section>
  );
}
