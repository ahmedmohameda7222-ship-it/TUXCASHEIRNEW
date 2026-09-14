import type { AdminSettingsWorkspace } from '@tux/admin-contracts';
import { useEffect, useRef, useState, type FormEvent } from 'react';

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

export type SettingEditorState = {
  raw: string;
  baselineRaw: string;
  expectedVersion: number | null;
};

function initialText(value: unknown, kind: SettingEditorKind): string {
  if (kind === 'boolean') return value === true ? 'true' : 'false';
  if (value === null || value === undefined) return '';
  return String(value);
}

function parseValue(raw: string, kind: SettingEditorKind, min?: number, max?: number): unknown {
  if (kind === 'boolean') return raw === 'true';
  if (kind === 'text') return raw;

  const value = Number(raw);
  if (!Number.isSafeInteger(value)) throw new Error('Enter a whole number.');
  if (min !== undefined && value < min) throw new Error(`Minimum is ${min}.`);
  if (max !== undefined && value > max) throw new Error(`Maximum is ${max}.`);
  return value;
}

export function reconcileSettingEditorState(
  current: SettingEditorState,
  resolvedRaw: string,
  resolvedExpectedVersion: number | null,
): SettingEditorState {
  if (current.raw !== current.baselineRaw) return current;
  if (
    current.raw === resolvedRaw &&
    current.baselineRaw === resolvedRaw &&
    current.expectedVersion === resolvedExpectedVersion
  ) {
    return current;
  }
  return {
    raw: resolvedRaw,
    baselineRaw: resolvedRaw,
    expectedVersion: resolvedExpectedVersion,
  };
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
  const resolvedRaw = initialText(resolved.value, kind);
  const resolvedExpectedVersion = resolved.source === 'shop' ? resolved.version : null;
  const latestResolvedRef = useRef({
    raw: resolvedRaw,
    expectedVersion: resolvedExpectedVersion,
  });
  latestResolvedRef.current = {
    raw: resolvedRaw,
    expectedVersion: resolvedExpectedVersion,
  };

  const [editor, setEditor] = useState<SettingEditorState>(() => ({
    raw: resolvedRaw,
    baselineRaw: resolvedRaw,
    expectedVersion: resolvedExpectedVersion,
  }));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setEditor((current) =>
      reconcileSettingEditorState(current, resolvedRaw, resolvedExpectedVersion),
    );
  }, [resolvedExpectedVersion, resolvedRaw]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    try {
      const value = parseValue(editor.raw, kind, min, max);
      await onUpdate({ settingKey, value, expectedVersion: editor.expectedVersion });
      setEditor((current) => ({
        raw: current.raw,
        baselineRaw: current.raw,
        expectedVersion: latestResolvedRef.current.expectedVersion,
      }));
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
            value={editor.raw}
            disabled={updating}
            onChange={(event) => setEditor((current) => ({ ...current, raw: event.target.value }))}
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
            value={editor.raw}
            disabled={updating}
            onChange={(event) => setEditor((current) => ({ ...current, raw: event.target.value }))}
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
