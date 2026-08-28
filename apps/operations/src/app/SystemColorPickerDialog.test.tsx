import { readFileSync } from 'node:fs';
import { parseSystemAccentColor } from '@tux/domain';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SystemColorPickerDialog } from './SystemColorPickerDialog';

const source = readFileSync(new URL('./SystemColorPickerDialog.tsx', import.meta.url), 'utf8');

describe('SystemColorPickerDialog', () => {
  it('renders the approved two-row native color and Default transaction surface', () => {
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
    expect(markup.match(/class="system-color-row"/g)).toHaveLength(2);
    expect(markup.match(/type="color"/g)).toHaveLength(1);
    expect(markup.match(/type="checkbox"/g)).toHaveLength(1);
    expect(markup).toContain('Cancel');
    expect(markup).toContain('Save');
    expect(markup).not.toContain('type="text"');
    expect(markup).not.toContain('type="number"');
    expect(markup).not.toContain('HEX');
    expect(markup).not.toContain('RGB');
    expect(markup).not.toContain('Pick from screen');
    expect(markup).not.toContain('Reset to TUX default');
  });

  it('checks Default when the worker has no persisted accent', () => {
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

    expect(markup).toContain('type="checkbox"');
    expect(markup).toContain('checked=""');
    expect(markup).toContain('value="#1F6B52"');
  });

  it('returns focus to the persistent operator trigger when the modal closes', () => {
    expect(source).toContain("document.querySelector<HTMLElement>('.operator-trigger')");
    expect(source).toMatch(/return \(\) => returnFocusTarget\?\.focus\(\);/);
  });
});
