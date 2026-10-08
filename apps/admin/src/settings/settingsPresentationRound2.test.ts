import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  formatBasisPointsAsPercent,
  formatMinorAsEgp,
  parseEgpToMinor,
  parsePercentToBasisPoints,
  sortOrderAfterMove,
} from './settingsModel';

const settingsDirectory = dirname(fileURLToPath(import.meta.url));

function source(file: string): string {
  return readFileSync(join(settingsDirectory, file), 'utf8');
}

describe('settings business presentation', () => {
  it('converts EGP and percentage inputs at the settings boundary', () => {
    expect(formatMinorAsEgp(3050)).toBe('30.50');
    expect(parseEgpToMinor('30.50')).toBe(3050);
    expect(formatBasisPointsAsPercent(1425)).toBe('14.25');
    expect(parsePercentToBasisPoints('14.25')).toBe(1425);
    expect(() => parseEgpToMinor('1.001')).toThrow('two decimal places');
    expect(() => parsePercentToBasisPoints('100.01')).toThrow('between 0 and 100');
  });

  it('moves business rows across their adjacent display position', () => {
    const rows = [
      { id: 'first', sortOrder: 10 },
      { id: 'second', sortOrder: 20 },
      { id: 'third', sortOrder: 30 },
    ];
    expect(sortOrderAfterMove(rows, 'second', 'up')).toBe(9);
    expect(sortOrderAfterMove(rows, 'second', 'down')).toBe(31);
    expect(sortOrderAfterMove(rows, 'first', 'up')).toBe(10);
  });

  it('keeps implementation language out of settings presentation', () => {
    const visibleSources = [
      'SettingsPage.tsx',
      'ShopsPage.tsx',
      'OrderTypesPage.tsx',
      'PaymentsPage.tsx',
      'CheckoutPage.tsx',
      'ReceiptsPage.tsx',
      'ReasonCodesPage.tsx',
      'SettingsSchedulePanel.tsx',
      'SettingOverrideEditor.tsx',
    ]
      .map(source)
      .join('\n');

    expect(visibleSources).not.toMatch(
      /Canonical|minor units|\(bps\)|Stable key|Last error:|attempt \{/,
    );
    expect(source('OrderTypesPage.tsx')).not.toMatch(/Sort order|sort \{/);
    expect(source('PaymentsPage.tsx')).not.toMatch(/Operational type:|Sort order|>POS<|>Both</);
    expect(source('ReasonCodesPage.tsx')).not.toMatch(/<dt>Version<\/dt>|<dd>v\{/);
  });

  it('uses named weekdays and hides location coordinates under an advanced disclosure', () => {
    const shops = source('ShopsPage.tsx');
    expect(shops).toContain('Monday');
    expect(shops).toContain('Sunday');
    expect(shops).toContain('<details');
    expect(shops).toContain('Advanced location');
  });
});
