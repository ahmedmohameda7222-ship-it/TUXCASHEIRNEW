import { readdirSync, readFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const stylesDirectory = fileURLToPath(new URL('.', import.meta.url));
const DEFAULT_ACCENT_LITERALS = [
  '#1f6b52',
  '#195f48',
  '#14533f',
  '#eaf4ef',
  '#5fae8a',
  '#6dba98',
  '#4f9b7a',
  '#173429',
] as const;

describe('system accent token audit', () => {
  it('keeps default brand accent literals out of Operations app CSS', () => {
    const bypasses: string[] = [];

    for (const file of readdirSync(stylesDirectory)) {
      if (extname(file) !== '.css') continue;
      const source = readFileSync(join(stylesDirectory, file), 'utf8').toLowerCase();
      for (const literal of DEFAULT_ACCENT_LITERALS) {
        if (source.includes(literal)) bypasses.push(`${basename(file)}:${literal}`);
      }
    }

    expect(bypasses).toEqual([]);
  });

  it('keeps interactive Operations styling routed through semantic accent tokens', () => {
    const premium = readFileSync(new URL('./premium.css', import.meta.url), 'utf8');
    const systemColor = readFileSync(new URL('./system-color-picker.css', import.meta.url), 'utf8');

    expect(premium).toContain('var(--tux-accent');
    expect(premium).toContain('var(--tux-positive');
    expect(systemColor).toContain('var(--tux-accent');
    expect(systemColor).not.toContain('#1F6B52');
  });
});
