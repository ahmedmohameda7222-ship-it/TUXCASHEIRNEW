import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, rgb, type PDFFont, type PDFPage } from 'pdf-lib';

import type { ReportExportData, ReportExportRow, ReportExportSection } from './reportPdfExport.js';

const require = createRequire(import.meta.url);
const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 38;
const TEXT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const BOTTOM = 56;

function money(minor: number | null): string {
  if (minor === null) return 'Unavailable - incomplete cost';
  const sign = minor < 0 ? '-' : '';
  return `EGP ${sign}${(Math.abs(minor) / 100).toFixed(2)}`;
}

function displayDate(iso: string): string {
  const parsed = new Date(iso);
  return Number.isFinite(parsed.getTime())
    ? new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Africa/Cairo',
        year: 'numeric',
        month: 'short',
        day: '2-digit',
      }).format(parsed)
    : 'Date unavailable';
}

function heading(area: string): string {
  return area
    .split('-')
    .map((word) => word[0]?.toUpperCase() + word.slice(1))
    .join(' ');
}

function fontForText(text: string, latin: PDFFont, arabic: PDFFont): PDFFont {
  return /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/.test(text) ? arabic : latin;
}

function splitWrapped(text: string, width: number, size: number, font: PDFFont): string[] {
  const lines: string[] = [];
  let current = '';
  const source = String(text).replace(/[\r\n\t]+/g, ' ').trim() || '-';
  for (const word of source.split(/\s+/)) {
    const next = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(next, size) <= width) {
      current = next;
      continue;
    }
    if (current) lines.push(current);
    current = '';
    for (const character of [...word]) {
      const attempt = current + character;
      if (font.widthOfTextAtSize(attempt, size) <= width) {
        current = attempt;
      } else {
        if (current) lines.push(current);
        current = character;
      }
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : ['-'];
}

/** Render a true, paginated PDF from complete server-authorized report data only. */
export async function renderReportPdf(data: ReportExportData): Promise<Buffer> {
  if (data.sections.length === 0) throw new Error('report_pdf_no_authorized_sections');

  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const [latin, arabic] = await Promise.all([
    pdf.embedFont(
      readFileSync(
        require.resolve(
          '@fontsource/noto-sans-arabic/files/noto-sans-arabic-latin-400-normal.woff',
        ),
      ),
      { subset: true },
    ),
    pdf.embedFont(
      readFileSync(
        require.resolve(
          '@fontsource/noto-sans-arabic/files/noto-sans-arabic-arabic-400-normal.woff',
        ),
      ),
      { subset: true },
    ),
  ]);
  const ink = rgb(0.13, 0.2, 0.17);
  const muted = rgb(0.39, 0.46, 0.42);
  const rule = rgb(0.84, 0.88, 0.85);
  const pages: PDFPage[] = [];
  let page: PDFPage;
  let y = 0;

  function drawLine(text: string, x: number, baseline: number, size = 9, color = ink): void {
    const font = fontForText(text, latin, arabic);
    page.drawText(text, { x, y: baseline, size, font, color });
  }

  function addPage(section: string): void {
    page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    pages.push(page);
    y = PAGE_HEIGHT - MARGIN;
    drawLine('TUX ADMIN / BUSINESS INTELLIGENCE', MARGIN, y, 10, ink);
    drawLine(section, PAGE_WIDTH - 255, y, 9, muted);
    y -= 19;
    page.drawLine({
      start: { x: MARGIN, y },
      end: { x: PAGE_WIDTH - MARGIN, y },
      thickness: 0.7,
      color: rule,
    });
    y -= 25;
  }

  function ensureRoom(required: number, section: string): void {
    if (y - required < BOTTOM) addPage(section);
  }

  function paragraph(text: string, size: number, color = muted): void {
    const font = fontForText(text, latin, arabic);
    const lines = splitWrapped(text, TEXT_WIDTH, size, font);
    for (const line of lines) {
      ensureRoom(size + 8, 'TUX Reports - continued');
      drawLine(line, MARGIN, y, size, color);
      y -= size + 7;
    }
  }

  function renderRow(row: ReportExportRow, sectionName: string): void {
    const labelFont = fontForText(row.label, latin, arabic);
    const labelLines = splitWrapped(row.label, 218, 9, labelFont);
    const height = Math.max(32, labelLines.length * 13 + 17);
    ensureRoom(height + 10, sectionName);
    const top = y;
    drawLine(displayDate(row.occurredAt), MARGIN, top, 8, muted);
    drawLine(row.sourceKind.replaceAll('-', ' '), 132, top, 8, muted);
    labelLines.forEach((part, index) => drawLine(part, 233, top - index * 13, 9));
    drawLine(money(row.amountMinor), 473, top, 8, ink);
    drawLine(`ID ${row.id} | Qty ${row.quantity}`, 233, top - labelLines.length * 13, 7, muted);
    if (row.costMissing) drawLine('Cost incomplete', MARGIN, top - 15, 7, muted);
    y -= height;
    page.drawLine({
      start: { x: MARGIN, y },
      end: { x: PAGE_WIDTH - MARGIN, y },
      thickness: 0.4,
      color: rule,
    });
    y -= 8;
  }

  function sectionContent(section: ReportExportSection, index: number): void {
    const name = heading(section.area);
    addPage(`${index + 1}. ${name}`);
    paragraph(`Report ${index + 1} of ${data.sections.length}: ${name}`, 16, ink);
    paragraph(
      `Period (Cairo calendar): ${data.fromDate} to ${data.toDate} | Shops: ${data.shopIds.length}`,
      9,
    );
    paragraph(
      `Source: ${data.source ?? 'All'} | Scope: ${data.shopIds.join(', ')}`,
      8,
    );
    if (data.kind === 'current' && Object.keys(data.context).length) {
      paragraph(`Filters: ${JSON.stringify(data.context)}`, 8);
    }
    if (data.kind === 'current' && data.comparison) {
      paragraph(
        `Comparison ${data.comparison.periodStart} to ${data.comparison.periodEnd}: ${money(data.comparison.summary.totalAmountMinor)} (${data.comparison.summary.eventCount} records)`,
        8,
      );
    }
    paragraph(
      `Recorded amount: ${money(section.summary.totalAmountMinor)} | Events: ${section.summary.eventCount} | Orders: ${section.summary.orderCount} | Quantity: ${section.summary.totalQuantity}`,
      9,
      ink,
    );
    if (section.summary.incompleteCostEvents > 0) {
      paragraph(
        `Cost information incomplete for ${section.summary.incompleteCostEvents} event(s). No unsupported profit estimate is included.`,
        8,
      );
    }
    if (section.summary.coverageNote) paragraph(section.summary.coverageNote, 8);
    y -= 10;
    paragraph(`Source records - ${section.rows.length} matching rows`, 10, ink);
    if (section.rows.length === 0) {
      paragraph('No matching source events for this date range and shop scope.', 9);
    }
    section.rows.forEach((row) => renderRow(row, `${name} (continued)`));
  }

  for (const [index, section] of data.sections.entries()) sectionContent(section, index);

  const generated = new Date().toISOString();
  for (const [index, printablePage] of pages.entries()) {
    page = printablePage;
    page.drawLine({
      start: { x: MARGIN, y: 43 },
      end: { x: PAGE_WIDTH - MARGIN, y: 43 },
      thickness: 0.6,
      color: rule,
    });
    drawLine(`Generated ${generated} | EGP amounts | Cairo calendar dates`, MARGIN, 29, 7, muted);
    drawLine(`Page ${index + 1} / ${pages.length}`, PAGE_WIDTH - 115, 29, 8, muted);
  }
  const recordCount = data.sections.reduce((sum, section) => sum + section.rows.length, 0);
  pdf.setTitle(`TUX Reports - ${data.kind === 'current' ? heading(data.sections[0]!.area) : 'All Authorized Reports'}`);
  pdf.setAuthor('TUX Admin');
  pdf.setSubject(`${recordCount} source records, ${data.sections.length} authorized sections of ${data.totalCanonicalAreas} canonical reports`);
  pdf.setCreationDate(new Date());
  return Buffer.from(await pdf.save());
}
