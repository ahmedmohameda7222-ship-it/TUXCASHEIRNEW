import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const catalogRoot = import.meta.dirname;

function source(file: string): string {
  return readFileSync(resolve(catalogRoot, file), 'utf8');
}

describe('Catalog Round 2 presentation contract', () => {
  it('keeps engineering vocabulary and raw identifiers out of primary catalog UI', () => {
    const catalog = source('CatalogPage.tsx');
    const publish = source('PublishReviewPage.tsx');
    const schedule = source('ScheduleEditor.tsx');
    const recurring = source('RecurringAvailabilityEditor.tsx');

    expect(catalog).not.toMatch(/Live version|Base v|draft\.id\.slice/);
    expect(publish).not.toMatch(
      /Canonical state|Draft r|Draft base version|Current catalog version|trusted draft|canonical Operations|Durable jobs|Target base version|lastError/,
    );
    expect(schedule).not.toMatch(/trusted scheduler|live-version fence|draft revision/);
    expect(recurring).not.toMatch(/version-fenced|Rule version/);
  });

  it('uses client-side links for catalog navigation', () => {
    expect(source('ProductEditor.tsx')).toContain('<Link');
    expect(source('PublishReviewPage.tsx')).toContain('<Link');
    expect(source('ProductEditor.tsx')).not.toMatch(
      /<a[^>]+href="\/catalog\/products\/publishing"/,
    );
    expect(source('PublishReviewPage.tsx')).not.toMatch(/<a[^>]+href="\/catalog\/products"/);
  });
});
