import { readFileSync } from 'node:fs';
import { parseSystemAccentColor } from '@tux/domain';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SystemColorPickerDialog } from './SystemColorPickerDialog';

const source = readFileSync(new URL('./SystemColorPickerDialog.tsx', import.meta.url), 'utf8');

function renderDialog(saving = false) {
  return renderToStaticMarkup(
    <SystemColorPickerDialog
      savedAccentColor={parseSystemAccentColor('#1E3A8A')}
      defaultPreviewColor={parseSystemAccentColor('#1F6B52')}
      saving={saving}
      saveError={null}
      onPreview={() => undefined}
      onSave={async () => undefined}
      onCancel={() => undefined}
    />,
  );
}

describe('SystemColorPickerDialog', () => {
  it('renders the binding native, HEX, RGB, preview, eyedropper, reset, cancel, and save surface', () => {
    const markup = renderDialog();

    expect(markup).toContain('role="dialog"');
    expect(markup).toContain('aria-modal="true"');
    expect(markup).toContain('Choose system color');
    expect(markup.match(/type="color"/g)).toHaveLength(1);
    expect(markup.match(/type="text"/g)).toHaveLength(1);
    expect(markup.match(/type="number"/g)).toHaveLength(3);
    expect(markup).toContain('HEX');
    expect(markup).toContain('Red');
    expect(markup).toContain('Green');
    expect(markup).toContain('Blue');
    expect(markup).toContain('Current color');
    expect(markup).toContain('#1E3A8A');
    expect(markup).toContain('Pick from screen');
    expect(markup).toContain('Reset to TUX default');
    expect(markup).toContain('Cancel');
    expect(markup).toContain('Save');
    expect(markup).not.toContain('type="checkbox"');
  });

  it('disables every mutating control while saving and keeps Escape guarded in flight', () => {
    const markup = renderDialog(true);

    expect(markup.match(/disabled=""/g)?.length ?? 0).toBeGreaterThanOrEqual(7);
    expect(markup).toContain('<fieldset class="system-color-rgb-fieldset" disabled="">');
    expect(source).toContain('<fieldset className="system-color-rgb-fieldset" disabled={saving}>');
    expect(markup).toContain('Saving…');
    expect(source).toMatch(/if \(saving\) return;/);
    expect(source).toMatch(/event\.key === 'Escape'/);
  });

  it('uses one synchronized draft for native, HEX, RGB, reset, and eyedropper changes', () => {
    expect(source).toContain('parseHexDraft');
    expect(source).toContain('rgbToSystemAccentColor');
    expect(source).toContain('systemAccentColorToRgb');
    expect(source).toContain('EyeDropper');
    expect(source).toContain('setDraftAccentColor(null)');
    expect(source).toContain('onPreview(null)');
  });

  it('returns focus to the persistent operator trigger when the modal closes', () => {
    expect(source).toContain("document.querySelector<HTMLElement>('.operator-trigger')");
    expect(source).toMatch(/return \(\) => returnFocusTarget\?\.focus\(\);/);
  });
});
