import type { AdminSettingsWorkspace } from '@tux/admin-contracts';
import { useState, type FormEvent } from 'react';

import { resolveWorkspaceSetting, settingSourceLabel } from './settingsModel';
import type { SettingOverrideUpdateDraft } from './useSettings';

type SettingEditorKind = 'text' | 'integer' | 'boolean';

type SettingOverrideEditorProps = {
  workspace: AdminSettingsWorkspace;
  settingKey: string;
  label: string;
  kind: SettingEditorKind;
  help?: string;
  min?: number;
  max?: number;
  updating: boolean;
  onUpdate(draft: SettingOverrideUpdateDraft): void | Promise<void>;
};

function initialText(value: unknown, kind: SettingEditorKind): string {
  if (kind === 'boolean') return value === true ? 'true' : 'false';
  if (value === null || value === undefined) return '';
  return String(value);
}

function parseValue(
  raw: string,
  kind: SettingEditorKind,
  min?: number,
  max?: number,
): unknown {
  if (kind === 'boolean') return raw === 'true';
  if (kind === 'text') return raw;

  const value = Number(raw);
  if (!Number.isSafeInteger(value)) throw new Error('Enter a whole number.');
  if (min !== undefined && value < min) throw new Error(`Minimum is ${min}.`);
  if (max !== undefined && value > max) throw new Error(`Maximum is ${max}.`);
  return value;
}

export function SettingOverrideEditor({
  workspace,
  settingKey,
  label,
  kind,
  help,
  min,
  max,
  updating,
  onUpdate,
}: SettingOverrideEditorProps) {
  const resolved = resolveWorkspaceSetting(workspace, settingKey);
  const [raw, setRaw] = useState(() => initialText(resolved.value, kind));
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    try {
      const value = parseValue(raw, kind, min, max);
      await onUpdate({ settingKey, value });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to save this setting.');
    }
  }

  return (
    <form
      className="admin-catalog-editor__section is-compact"
      data-setting-key={settingKey}
      onSubmit={(event) => void submit(event)}
    >
      <div className="admin-catalog-editor__section-heading">
        <div>
          <p className="admin-catalog-editor__eyebrow">{settingSourceLabel(resolved.source)}</p>
          <h3>{label}</h3>
        </div>
        {resolved.source === 'shop' && resolved.version !== null ? (
          <span className="admin-status-pill">v{resolved.version}</span>
        ) : null}
      </div>

      {kind === 'boolean' ? (
        <label className="admin-field">
          <span>{label}</span>
          <select
            aria-label={label}
            value={raw}
            disabled={updating}
            onChange={(event) => setRaw(event.target.value)}
          >
            <option value="false">Disabled</option>
            <option value="true">Enabled</option>
          </select>
        </label>
      ) : (
        <label className="admin-field">
          <span>{label}</span>
          <input
            aria-label={label}
            type={kind === 'integer' ? 'number' : 'text'}
            inputMode={kind === 'integer' ? 'numeric' : undefined}
            min={min}
            max={max}
            step={kind === 'integer' ? 1 : undefined}
            value={raw}
            disabled={updating}
            onChange={(event) => setRaw(event.target.value)}
          />
        </label>
      )}

      {help ? <p className="admin-field__help">{help}</p> : null}
      {error ? <p className="admin-field__error">{error}</p> : null}
      <button className="admin-secondary-button" type="submit" disabled={updating}>
        {updating ? 'Saving…' : `Save ${label}`}
      </button>
    </form>
  );
}
