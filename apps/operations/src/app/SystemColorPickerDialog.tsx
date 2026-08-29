import { type SystemAccentColor } from '@tux/domain';
import { useEffect, useRef, useState } from 'react';
import {
  parseHexDraft,
  rgbToSystemAccentColor,
  systemAccentColorToRgb,
  type RgbColor,
} from './systemAccentTheme';

export interface SystemColorPickerDialogProps {
  readonly savedAccentColor: SystemAccentColor | null;
  readonly defaultPreviewColor: SystemAccentColor;
  readonly saving: boolean;
  readonly saveError: string | null;
  readonly onPreview: (accentColor: SystemAccentColor | null) => void;
  readonly onSave: (accentColor: SystemAccentColor | null) => Promise<void>;
  readonly onCancel: () => void;
}

type RgbDraft = {
  readonly r: string;
  readonly g: string;
  readonly b: string;
};

type EyeDropperConstructor = new () => {
  open(): Promise<{ readonly sRGBHex: string }>;
};

function rgbDraft(color: SystemAccentColor): RgbDraft {
  const rgb = systemAccentColorToRgb(color);
  return { r: String(rgb.r), g: String(rgb.g), b: String(rgb.b) };
}

function parseRgbDraft(value: RgbDraft): RgbColor | null {
  const channels = [value.r, value.g, value.b].map((channel) => {
    if (!/^\d{1,3}$/.test(channel)) return null;
    const parsed = Number(channel);
    return Number.isInteger(parsed) && parsed >= 0 && parsed <= 255 ? parsed : null;
  });
  if (channels.some((channel) => channel === null)) return null;
  return { r: channels[0]!, g: channels[1]!, b: channels[2]! };
}

function eyeDropperConstructor(): EyeDropperConstructor | null {
  if (typeof window === 'undefined') return null;
  const candidate = (window as Window & { EyeDropper?: EyeDropperConstructor }).EyeDropper;
  return typeof candidate === 'function' ? candidate : null;
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
  const initialColor = savedAccentColor ?? defaultPreviewColor;
  const [draftAccentColor, setDraftAccentColor] = useState<SystemAccentColor | null>(
    savedAccentColor,
  );
  const [pickerColor, setPickerColor] = useState<SystemAccentColor>(initialColor);
  const [hexInput, setHexInput] = useState(initialColor);
  const [rgbInput, setRgbInput] = useState<RgbDraft>(() => rgbDraft(initialColor));
  const [hexError, setHexError] = useState<string | null>(null);
  const [rgbError, setRgbError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const pickerRef = useRef<HTMLInputElement>(null);
  const EyeDropper = eyeDropperConstructor();

  useEffect(() => {
    const returnFocusTarget = document.querySelector<HTMLElement>('.operator-trigger');
    pickerRef.current?.focus();
    return () => returnFocusTarget?.focus();
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

  function syncCustomColor(color: SystemAccentColor): void {
    setPickerColor(color);
    setDraftAccentColor(color);
    setHexInput(color);
    setRgbInput(rgbDraft(color));
    setHexError(null);
    setRgbError(null);
    onPreview(color);
  }

  function cancel(): void {
    if (saving) return;
    onPreview(savedAccentColor);
    onCancel();
  }

  function chooseNativeColor(value: string): void {
    if (saving) return;
    const color = parseHexDraft(value);
    if (color !== null) syncCustomColor(color);
  }

  function chooseHex(value: string): void {
    if (saving) return;
    setHexInput(value);
    const color = parseHexDraft(value);
    if (color === null) {
      setHexError('Enter a valid 3- or 6-digit HEX color.');
      return;
    }
    syncCustomColor(color);
  }

  function chooseRgb(channel: keyof RgbDraft, value: string): void {
    if (saving) return;
    const next = { ...rgbInput, [channel]: value };
    setRgbInput(next);
    const parsed = parseRgbDraft(next);
    if (parsed === null) {
      setRgbError('RGB channels must be whole numbers from 0 to 255.');
      return;
    }
    syncCustomColor(rgbToSystemAccentColor(parsed));
  }

  function resetToDefault(): void {
    if (saving) return;
    setPickerColor(defaultPreviewColor);
    setDraftAccentColor(null);
    setHexInput(defaultPreviewColor);
    setRgbInput(rgbDraft(defaultPreviewColor));
    setHexError(null);
    setRgbError(null);
    onPreview(null);
  }

  async function pickFromScreen(): Promise<void> {
    if (saving || EyeDropper === null) return;
    try {
      const result = await new EyeDropper().open();
      const color = parseHexDraft(result.sRGBHex);
      if (color === null) {
        setHexError('The selected screen color is not a valid HEX color.');
        return;
      }
      syncCustomColor(color);
    } catch {
      // EyeDropper cancellation leaves the current draft unchanged.
    }
  }

  const hasValidationError = hexError !== null || rgbError !== null;
  const previewLabel =
    draftAccentColor === null ? `TUX default · ${defaultPreviewColor}` : pickerColor;

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

        <div className="system-color-editor">
          <div
            className="system-color-preview"
            aria-label={`Current color ${previewLabel}`}
          >
            <span
              className="system-color-preview-swatch"
              style={{ backgroundColor: pickerColor }}
              aria-hidden="true"
            />
            <span>
              <strong>Current color</strong>
              <span className="system-color-preview-value">{previewLabel}</span>
            </span>
          </div>

          <label className="system-color-field" htmlFor="system-color-native-picker">
            <span>Visual picker</span>
            <input
              ref={pickerRef}
              id="system-color-native-picker"
              className="system-color-native-picker"
              type="color"
              value={pickerColor}
              disabled={saving}
              onInput={(event) => chooseNativeColor(event.currentTarget.value)}
              aria-label="System Color"
            />
          </label>

          <label className="system-color-field" htmlFor="system-color-hex">
            <span>HEX</span>
            <input
              id="system-color-hex"
              type="text"
              value={hexInput}
              disabled={saving}
              spellCheck={false}
              autoComplete="off"
              aria-invalid={hexError !== null}
              aria-describedby={hexError === null ? undefined : 'system-color-hex-error'}
              onChange={(event) => chooseHex(event.currentTarget.value)}
            />
          </label>
          {hexError === null ? null : (
            <p id="system-color-hex-error" className="system-color-validation">
              {hexError}
            </p>
          )}

          <fieldset
            className="system-color-rgb"
            aria-describedby={rgbError === null ? undefined : 'system-color-rgb-error'}
          >
            <legend>RGB</legend>
            <label htmlFor="system-color-red">
              <span>Red</span>
              <input
                id="system-color-red"
                type="number"
                min="0"
                max="255"
                step="1"
                value={rgbInput.r}
                disabled={saving}
                aria-invalid={rgbError !== null}
                onChange={(event) => chooseRgb('r', event.currentTarget.value)}
              />
            </label>
            <label htmlFor="system-color-green">
              <span>Green</span>
              <input
                id="system-color-green"
                type="number"
                min="0"
                max="255"
                step="1"
                value={rgbInput.g}
                disabled={saving}
                aria-invalid={rgbError !== null}
                onChange={(event) => chooseRgb('g', event.currentTarget.value)}
              />
            </label>
            <label htmlFor="system-color-blue">
              <span>Blue</span>
              <input
                id="system-color-blue"
                type="number"
                min="0"
                max="255"
                step="1"
                value={rgbInput.b}
                disabled={saving}
                aria-invalid={rgbError !== null}
                onChange={(event) => chooseRgb('b', event.currentTarget.value)}
              />
            </label>
          </fieldset>
          {rgbError === null ? null : (
            <p id="system-color-rgb-error" className="system-color-validation">
              {rgbError}
            </p>
          )}

          <div className="system-color-secondary-actions">
            <button
              type="button"
              className="quiet-action"
              disabled={saving || EyeDropper === null}
              aria-disabled={EyeDropper === null}
              title={
                EyeDropper === null ? 'Screen color picking is not supported here.' : undefined
              }
              onClick={() => void pickFromScreen()}
            >
              Pick from screen
            </button>
            <button
              type="button"
              className="quiet-action"
              disabled={saving}
              onClick={resetToDefault}
            >
              Reset to TUX default
            </button>
          </div>
        </div>

        {saveError === null ? null : (
          <p id="system-color-error" className="form-error" role="alert">
            {saveError}
          </p>
        )}

        <footer className="system-color-actions">
          <button
            type="button"
            className="quiet-action"
            disabled={saving}
            onClick={cancel}
          >
            Cancel
          </button>
          <button
            type="button"
            className="primary-action"
            disabled={saving || hasValidationError}
            onClick={() => void onSave(draftAccentColor)}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </footer>
      </section>
    </div>
  );
}
