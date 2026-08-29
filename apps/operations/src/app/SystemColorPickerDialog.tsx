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
  const [hexInput, setHexInput] = useState<string>(initialColor);
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
      const parsed = parseHexDraft(result.sRGBHex);
      if (parsed !== null) syncCustomColor(parsed);
    } catch {
      // User cancellation and unsupported screen-pick states leave the current draft untouched.
    }
  }

  const invalidDraft = hexError !== null || rgbError !== null;

  return (
    <div className="system-color-dialog-backdrop" role="presentation">
      <section
        ref={dialogRef}
        className="system-color-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="system-color-dialog-title"
      >
        <div className="system-color-dialog-header">
          <div>
            <h2 id="system-color-dialog-title">Choose system color</h2>
            <p>Preview locally, then save this worker&apos;s color.</p>
          </div>
        </div>

        <div className="system-color-current" aria-label="Current color">
          <span className="system-color-current-copy">
            <strong>Current color</strong>
            <span>{draftAccentColor ?? 'TUX default'}</span>
          </span>
          <span
            className="system-color-current-swatch"
            style={{ backgroundColor: pickerColor }}
            aria-hidden="true"
          />
        </div>

        <div className="system-color-editor">
          <label className="system-color-native-field">
            <span>Visual picker</span>
            <input
              ref={pickerRef}
              type="color"
              value={pickerColor}
              disabled={saving}
              onInput={(event) => chooseNativeColor(event.currentTarget.value)}
              onChange={(event) => chooseNativeColor(event.currentTarget.value)}
            />
          </label>

          <label className="system-color-hex-field">
            <span>HEX</span>
            <input
              type="text"
              value={hexInput}
              disabled={saving}
              aria-invalid={hexError !== null}
              aria-describedby={hexError === null ? undefined : 'system-color-hex-error'}
              onChange={(event) => chooseHex(event.currentTarget.value)}
            />
          </label>

          <fieldset className="system-color-rgb-fieldset" disabled={saving}>
            <legend>RGB</legend>
            {(['r', 'g', 'b'] as const).map((channel) => (
              <label key={channel}>
                <span>{channel === 'r' ? 'Red' : channel === 'g' ? 'Green' : 'Blue'}</span>
                <input
                  type="number"
                  min={0}
                  max={255}
                  step={1}
                  value={rgbInput[channel]}
                  aria-invalid={rgbError !== null}
                  aria-describedby={rgbError === null ? undefined : 'system-color-rgb-error'}
                  onChange={(event) => chooseRgb(channel, event.currentTarget.value)}
                />
              </label>
            ))}
          </fieldset>
        </div>

        {hexError !== null ? (
          <p className="system-color-validation" id="system-color-hex-error">
            {hexError}
          </p>
        ) : null}
        {rgbError !== null ? (
          <p className="system-color-validation" id="system-color-rgb-error">
            {rgbError}
          </p>
        ) : null}
        {saveError !== null ? (
          <p className="system-color-validation" role="alert" aria-live="polite">
            {saveError}
          </p>
        ) : null}

        <div className="system-color-dialog-actions">
          <button type="button" disabled={saving || EyeDropper === null} onClick={pickFromScreen}>
            Pick from screen
          </button>
          <button type="button" disabled={saving} onClick={resetToDefault}>
            Reset to TUX default
          </button>
          <span className="system-color-action-spacer" />
          <button type="button" disabled={saving} onClick={cancel}>
            Cancel
          </button>
          <button
            type="button"
            className="system-color-save-action"
            disabled={saving || invalidDraft}
            onClick={() => void onSave(draftAccentColor)}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </section>
    </div>
  );
}
