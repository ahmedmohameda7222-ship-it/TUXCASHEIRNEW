import { type SystemAccentColor } from '@tux/domain';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  parseHexDraft,
  rgbToSystemAccentColor,
  systemAccentColorToRgb,
  type RgbColor,
} from './systemAccentTheme';

interface EyeDropperResult {
  readonly sRGBHex: string;
}

interface EyeDropperLike {
  open(): Promise<EyeDropperResult>;
}

export type EyeDropperFactory = () => EyeDropperLike;

export interface SystemColorPickerDialogProps {
  readonly savedAccentColor: SystemAccentColor | null;
  readonly defaultPreviewColor: SystemAccentColor;
  readonly saving: boolean;
  readonly saveError: string | null;
  readonly eyeDropperFactory?: EyeDropperFactory | null;
  readonly onPreview: (accentColor: SystemAccentColor | null) => void;
  readonly onSave: (accentColor: SystemAccentColor | null) => Promise<void>;
  readonly onCancel: () => void;
}

function browserEyeDropperFactory(): EyeDropperFactory | null {
  if (typeof window === 'undefined') return null;
  const EyeDropperConstructor = (
    window as typeof window & { EyeDropper?: new () => EyeDropperLike }
  ).EyeDropper;
  if (EyeDropperConstructor === undefined) return null;
  return () => new EyeDropperConstructor();
}

function rgbStrings(color: SystemAccentColor): Record<keyof RgbColor, string> {
  const rgb = systemAccentColorToRgb(color);
  return { r: String(rgb.r), g: String(rgb.g), b: String(rgb.b) };
}

function parseRgbDraft(values: Record<keyof RgbColor, string>): RgbColor | null {
  const channels = [values.r, values.g, values.b].map((value) => Number(value));
  if (
    channels.some(
      (value) => !Number.isInteger(value) || !Number.isFinite(value) || value < 0 || value > 255,
    )
  ) {
    return null;
  }
  return { r: channels[0]!, g: channels[1]!, b: channels[2]! };
}

export function SystemColorPickerDialog({
  savedAccentColor,
  defaultPreviewColor,
  saving,
  saveError,
  eyeDropperFactory,
  onPreview,
  onSave,
  onCancel,
}: SystemColorPickerDialogProps) {
  const initialVisibleColor = savedAccentColor ?? defaultPreviewColor;
  const [draftAccentColor, setDraftAccentColor] = useState<SystemAccentColor | null>(
    savedAccentColor,
  );
  const [hexDraft, setHexDraft] = useState<string>(initialVisibleColor);
  const [rgbDraft, setRgbDraft] = useState<Record<keyof RgbColor, string>>(
    rgbStrings(initialVisibleColor),
  );
  const [hexError, setHexError] = useState<string | null>(null);
  const [rgbError, setRgbError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const hexRef = useRef<HTMLInputElement>(null);
  const runtimeEyeDropperFactory = useMemo(
    () => (eyeDropperFactory === undefined ? browserEyeDropperFactory() : eyeDropperFactory),
    [eyeDropperFactory],
  );
  const visibleColor = draftAccentColor ?? defaultPreviewColor;

  useEffect(() => {
    hexRef.current?.focus();
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

  function syncVisibleColor(color: SystemAccentColor): void {
    setHexDraft(color);
    setRgbDraft(rgbStrings(color));
    setHexError(null);
    setRgbError(null);
  }

  function applyDraftColor(color: SystemAccentColor): void {
    if (saving) return;
    setDraftAccentColor(color);
    syncVisibleColor(color);
    onPreview(color);
  }

  function cancel(): void {
    if (saving) return;
    onPreview(savedAccentColor);
    onCancel();
  }

  function changeHex(value: string): void {
    if (saving) return;
    setHexDraft(value);
    const color = parseHexDraft(value);
    if (color === null) {
      setHexError('Enter a valid 3- or 6-digit HEX color.');
      return;
    }
    applyDraftColor(color);
  }

  function changeRgb(channel: keyof RgbColor, value: string): void {
    if (saving) return;
    const next = { ...rgbDraft, [channel]: value };
    setRgbDraft(next);
    const rgb = parseRgbDraft(next);
    if (rgb === null) {
      setRgbError('RGB values must be whole numbers from 0 to 255.');
      return;
    }
    applyDraftColor(rgbToSystemAccentColor(rgb));
  }

  function resetToDefault(): void {
    if (saving) return;
    setDraftAccentColor(null);
    syncVisibleColor(defaultPreviewColor);
    onPreview(null);
  }

  async function pickFromScreen(): Promise<void> {
    if (saving || runtimeEyeDropperFactory === null) return;
    try {
      const result = await runtimeEyeDropperFactory().open();
      const color = parseHexDraft(result.sRGBHex);
      if (color === null) {
        setHexError('The picked color was not a valid RGB color.');
        return;
      }
      applyDraftColor(color);
    } catch {
      // EyeDropper cancellation is non-destructive and leaves the draft unchanged.
    }
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

        <div className="system-color-preview" aria-live="polite">
          <span
            className="system-color-preview-swatch"
            style={{ backgroundColor: visibleColor }}
            aria-hidden="true"
          />
          <div>
            <span className="system-color-preview-label">Current color</span>
            <output className="system-color-preview-value">{visibleColor}</output>
          </div>
        </div>

        <div className="system-color-fields">
          <label className="system-color-field" htmlFor="system-color-native-picker">
            <span>Visual picker</span>
            <input
              id="system-color-native-picker"
              className="system-color-native-picker"
              type="color"
              value={visibleColor}
              disabled={saving}
              onInput={(event) => {
                const color = parseHexDraft(event.currentTarget.value);
                if (color !== null) applyDraftColor(color);
              }}
              aria-label="Visual color picker"
            />
          </label>

          <label className="system-color-field" htmlFor="system-color-hex">
            <span>HEX</span>
            <input
              ref={hexRef}
              id="system-color-hex"
              className="system-color-hex-input"
              type="text"
              value={hexDraft}
              disabled={saving}
              autoComplete="off"
              spellCheck={false}
              aria-invalid={hexError !== null}
              aria-describedby={hexError === null ? undefined : 'system-color-hex-error'}
              onChange={(event) => changeHex(event.currentTarget.value)}
            />
          </label>
          {hexError === null ? null : (
            <p id="system-color-hex-error" className="system-color-validation" role="alert">
              {hexError}
            </p>
          )}

          <fieldset className="system-color-rgb-fieldset">
            <legend>RGB</legend>
            <div className="system-color-rgb-grid">
              {(
                [
                  ['r', 'Red'],
                  ['g', 'Green'],
                  ['b', 'Blue'],
                ] as const
              ).map(([channel, label]) => (
                <label key={channel} className="system-color-rgb-field">
                  <span>{label}</span>
                  <input
                    type="number"
                    min={0}
                    max={255}
                    step={1}
                    inputMode="numeric"
                    value={rgbDraft[channel]}
                    disabled={saving}
                    aria-invalid={rgbError !== null}
                    aria-describedby={rgbError === null ? undefined : 'system-color-rgb-error'}
                    onChange={(event) => changeRgb(channel, event.currentTarget.value)}
                  />
                </label>
              ))}
            </div>
          </fieldset>
          {rgbError === null ? null : (
            <p id="system-color-rgb-error" className="system-color-validation" role="alert">
              {rgbError}
            </p>
          )}

          <div className="system-color-secondary-actions">
            {runtimeEyeDropperFactory === null ? null : (
              <button
                type="button"
                className="quiet-action"
                disabled={saving}
                onClick={() => void pickFromScreen()}
              >
                Pick from screen
              </button>
            )}
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
          <button type="button" className="quiet-action" disabled={saving} onClick={cancel}>
            Cancel
          </button>
          <button
            type="button"
            className="primary-action"
            disabled={saving || hexError !== null || rgbError !== null}
            onClick={() => void onSave(draftAccentColor)}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </footer>
      </section>
    </div>
  );
}
