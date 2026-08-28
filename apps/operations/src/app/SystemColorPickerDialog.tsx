import { parseSystemAccentColor, type SystemAccentColor } from '@tux/domain';
import { useEffect, useRef, useState } from 'react';

export interface SystemColorPickerDialogProps {
  readonly savedAccentColor: SystemAccentColor | null;
  readonly defaultPreviewColor: SystemAccentColor;
  readonly saving: boolean;
  readonly saveError: string | null;
  readonly onPreview: (accentColor: SystemAccentColor | null) => void;
  readonly onSave: (accentColor: SystemAccentColor | null) => Promise<void>;
  readonly onCancel: () => void;
}

export function SystemColorPickerDialog({
  savedAccentColor,
  defaultPreviewColor,
  saving,
  saveError,
  onPreview,
  onSave,
  onCancel,
}: SystemColorPickerDialogProps) {
  const [draftAccentColor, setDraftAccentColor] = useState<SystemAccentColor | null>(
    savedAccentColor,
  );
  const [pickerColor, setPickerColor] = useState(savedAccentColor ?? defaultPreviewColor);
  const dialogRef = useRef<HTMLElement>(null);
  const pickerRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    pickerRef.current?.focus();
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (saving) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        onPreview(savedAccentColor);
        onCancel();
        return;
      }
      if (event.key !== 'Tab') return;
      const dialog = dialogRef.current;
      if (dialog === null) return;
      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>('input:not(:disabled), button:not(:disabled)'),
      );
      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onCancel, onPreview, savedAccentColor, saving]);

  function cancel(): void {
    if (saving) return;
    onPreview(savedAccentColor);
    onCancel();
  }

  function chooseColor(value: string): void {
    if (saving) return;
    const color = parseSystemAccentColor(value);
    setPickerColor(color);
    setDraftAccentColor(color);
    onPreview(color);
  }

  function toggleDefault(checked: boolean): void {
    if (saving) return;
    if (checked) {
      setDraftAccentColor(null);
      onPreview(null);
      return;
    }
    setDraftAccentColor(pickerColor);
    onPreview(pickerColor);
  }

  return (
    <div className="system-color-backdrop" role="presentation" onMouseDown={cancel}>
      <section
        ref={dialogRef}
        className="system-color-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="system-color-title"
        aria-describedby={saveError === null ? undefined : 'system-color-error'}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="system-color-heading">
          <h2 id="system-color-title">Choose system color</h2>
        </header>

        <div className="system-color-rows">
          <label className="system-color-row" htmlFor="system-color-native-picker">
            <span>System Color</span>
            <input
              ref={pickerRef}
              id="system-color-native-picker"
              className="system-color-native-picker"
              type="color"
              value={pickerColor}
              disabled={saving}
              onInput={(event) => chooseColor(event.currentTarget.value)}
              aria-label="System Color"
            />
          </label>

          <label className="system-color-row" htmlFor="system-color-default">
            <span>Default</span>
            <input
              id="system-color-default"
              className="system-color-default-checkbox"
              type="checkbox"
              checked={draftAccentColor === null}
              disabled={saving}
              onChange={(event) => toggleDefault(event.target.checked)}
            />
          </label>
        </div>

        {saveError === null ? null : (
          <p id="system-color-error" className="form-error" role="alert">
            {saveError}
          </p>
        )}

        <footer className="system-color-actions">
          <button type="button" className="quiet-action" disabled={saving} onClick={cancel}>
            Cancel
          </button>
          <button
            type="button"
            className="primary-action"
            disabled={saving}
            onClick={() => void onSave(draftAccentColor)}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </footer>
      </section>
    </div>
  );
}
