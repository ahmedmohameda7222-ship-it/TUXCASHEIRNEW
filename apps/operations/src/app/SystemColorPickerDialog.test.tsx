import { parseSystemAccentColor } from '@tux/domain';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SystemColorPickerDialog } from './SystemColorPickerDialog';

const supportedEyeDropper = () => ({
  open: async () => ({ sRGBHex: '#7E22CE' }),
});

describe('SystemColorPickerDialog', () => {
  it('renders the approved native, HEX, RGB, eyedropper, reset, and save transaction surface', () => {
    const markup = renderToStaticMarkup(
      <SystemColorPickerDialog
        savedAccentColor={parseSystemAccentColor('#1E3A8A')}
        defaultPreviewColor={parseSystemAccentColor('#1F6B52')}
        saving={false}
        saveError={null}
        eyeDropperFactory={supportedEyeDropper}
        onPreview={() => undefined}
        onSave={async () => undefined}
        onCancel={() => undefined}
      />,
    );

    expect(markup).toContain('role="dialog"');
    expect(markup).toContain('aria-modal="true"');
    expect(markup).toContain('Choose system color');
    expect(markup).toContain('Current color');
    expect(markup).toContain('#1E3A8A');
    expect(markup).toContain('type="color"');
    expect(markup).toContain('HEX');
    expect(markup).toContain('type="text"');
    expect(markup).toContain('Red');
    expect(markup).toContain('Green');
    expect(markup).toContain('Blue');
    expect(markup.match(/type="number"/g)).toHaveLength(3);
    expect(markup.match(/min="0"/g)).toHaveLength(3);
    expect(markup.match(/max="255"/g)).toHaveLength(3);
    expect(markup).toContain('Pick from screen');
    expect(markup).toContain('Reset to TUX default');
    expect(markup).toContain('Cancel');
    expect(markup).toContain('Save');
    expect(markup).not.toContain('type="checkbox"');
  });

  it('shows the exact TUX default as the visible draft when the persisted worker accent is null', () => {
    const markup = renderToStaticMarkup(
      <SystemColorPickerDialog
        savedAccentColor={null}
        defaultPreviewColor={parseSystemAccentColor('#1F6B52')}
        saving={false}
        saveError={null}
        onPreview={() => undefined}
        onSave={async () => undefined}
        onCancel={() => undefined}
      />,
    );

    expect(markup).toContain('Current color');
    expect(markup).toContain('#1F6B52');
    expect(markup).toContain('Reset to TUX default');
  });
});
