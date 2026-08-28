import { parseSystemAccentColor } from '@tux/domain';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SystemColorPickerDialog } from './SystemColorPickerDialog';

describe('SystemColorPickerDialog', () => {
  it('renders the approved two-row native-picker and default-reset surface only', () => {
    const markup = renderToStaticMarkup(
      <SystemColorPickerDialog
        savedAccentColor={parseSystemAccentColor('#1E3A8A')}
        defaultPreviewColor={parseSystemAccentColor('#1F6B52')}
        saving={false}
        saveError={null}
        onPreview={() => undefined}
        onSave={async () => undefined}
        onCancel={() => undefined}
      />,
    );

    expect(markup).toContain('role="dialog"');
    expect(markup).toContain('aria-modal="true"');
    expect(markup).toContain('Choose system color');
    expect(markup).toContain('System Color');
    expect(markup).toContain('Default');
    expect(markup).toContain('type="color"');
    expect(markup).toContain('type="checkbox"');
    expect(markup).toContain('Cancel');
    expect(markup).toContain('Save');
    expect(markup).not.toContain('type="text"');
    expect(markup).not.toContain('HEX');
    expect(markup).not.toContain('Red');
    expect(markup).not.toContain('Green');
    expect(markup).not.toContain('Blue');
    expect(markup).not.toContain('Pick from screen');
  });

  it('shows Default selected when the persisted worker accent is null', () => {
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

    expect(markup).toMatch(/type="checkbox"[^>]*checked=""/);
  });
});
