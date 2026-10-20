import type { AdminSettingsWorkspace } from '@tux/admin-contracts';
import { useEffect, useRef, useState, type FormEvent } from 'react';

import { resolveWorkspaceSetting, settingSourceLabel } from './settingsModel';
import type { SettingOverrideUpdateDraft, SettingRestoreDraft } from './useSettings';

type SettingEditorKind = 'text' | 'integer' | 'boolean';

type SettingOverrideEditorProps = {
  workspace: AdminSettingsWorkspace;
  settingKey: string;
  label: string;
  kind: SettingEditorKind;
  help?: string;
  min?: number;
  max?: number;
  step?: number | 'any';
  inputMode?: 'decimal' | 'numeric';
  formatValue?(value: unknown): string;
  parseInput?(raw: string): unknown;
  updating: boolean;
  scope?: 'shop' | 'business';
  onUpdate(draft: SettingOverrideUpdateDraft): void | Promise<void>;
  onRestore?: ((draft: SettingRestoreDraft) => void | Promise<void>) | undefined;
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
  step,
  inputMode,
  formatValue,
  parseInput,
  updating,
  scope = 'shop',
  onUpdate,
  onRestore,
}: SettingOverrideEditorProps) {
  const resolved = resolveWorkspaceSetting(workspace, settingKey);
  const resolvedRaw = formatValue ? formatValue(resolved.value) : initialText(resolved.value, kind);
  const resolvedExpectedVersion =
    resolved.source === (scope === 'business' ? 'business' : 'shop') ? resolved.version : null;
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
      const value = parseInput ? parseInput(editor.raw) : parseValue(editor.raw, kind, min, max);
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

  async function restoreInherited() {
    if (!onRestore || editor.expectedVersion === null || updating) return;
    setError(null);
    try {
      await onRestore({ settingKey, expectedVersion: editor.expectedVersion });
      const inheritedValue = workspace.businessDefaults.find(
        (row) => row.key === settingKey,
      )?.value;
      const raw = formatValue ? formatValue(inheritedValue) : initialText(inheritedValue, kind);
      setEditor({ raw, baselineRaw: raw, expectedVersion: null });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to restore inheritance.');
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
          <p className="admin-catalog-editor__eyebrow">
            Current effective source: {scope === 'business' ? 'Business default' : settingSourceLabel(resolved.source)}
          </p>
          <h3>{label}</h3>
        </div>
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
            inputMode={inputMode ?? (kind === 'integer' ? 'numeric' : undefined)}
            min={min}
            max={max}
            step={step ?? (kind === 'integer' ? 1 : undefined)}
            value={editor.raw}
            disabled={updating}
            onChange={(event) => setEditor((current) => ({ ...current, raw: event.target.value }))}
          />
        </label>
      )}

      <p className="admin-field__help" data-setting-effective>
        Effective value: <strong>{resolvedRaw || 'Not configured'}</strong>. Source:{' '}
        {settingSourceLabel(resolved.source)}. Editing below does not update the live
        checkout until the required publication or approval completes.
      </p>
      {editor.raw !== editor.baselineRaw ? (
        <p className="admin-field__help" role="status">Unsaved local edit</p>
      ) : (
        <p className="admin-field__help">Current editable draft loaded</p>
      )}
      {help ? <p className="admin-field__help">{help}</p> : null}
      {error ? <p className="admin-field__error">{error}</p> : null}
      <button className="admin-secondary-button" type="submit" disabled={updating}>
        {updating
          ? 'Saving…'
          : scope === 'business'
            ? `Save business default draft: ${label}`
            : `Save unpublished draft: ${label}`}
      </button>
      {scope === 'shop' && resolved.source === 'shop' && onRestore ? (
        <button
          className="admin-secondary-button"
          type="button"
          disabled={updating}
          onClick={() => void restoreInherited()}
        >
          Restore inherited value: {label}
        </button>
      ) : null}
    </form>
  );
}
