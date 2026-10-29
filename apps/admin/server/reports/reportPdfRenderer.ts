import { REPORT_LABELS } from '../../src/reports/reportLabels.js';
import type { AuthorizedExport, ExportFact, ExportSummary } from './reportPdfExport.js';

type PdfOptions = {
  generatedAt: string;
  shopNames: Readonly<Record<string, string>>;
};
const LINE_WIDTH = 90;
const LINES_PER_PAGE = 56;
const MAX_PDF_BYTES = 12 * 1024 * 1024;

function ascii(value: string): string {
  // Do not silently corrupt Arabic/CJK names with the Latin-only core font.
  if (/[^\x20-\x7e]/.test(value)) throw new Error('report_export_font_unsupported');
  return value;
}
function escapePdf(value: string): string {
  return ascii(value).replaceAll('\\', '\\\\').replaceAll('(', '\\(').replaceAll(')', '\\)');
}
function money(minor: number | null): string {
  if (minor === null) return 'Cost data incomplete / unavailable';
  if (!Number.isSafeInteger(minor)) throw new Error('report_export_amount_invalid');
  return (minor < 0 ? '-' : '') + (Math.abs(minor) / 100).toFixed(2) + ' EGP';
}
function sourceRows(row: ExportFact, index: number, shop: string): string[] {
  return [
    String(index + 1) +
      '. ' +
      row.occurredAt.slice(0, 10) +
      ' | ' +
      row.sourceKind +
      ' | ' +
      shop +
      ' | ' +
      money(row.amountMinor) +
      ' | Qty ' +
      row.quantity,
    '    ' + row.label,
    '    Reference: ' + row.id + (row.costMissing ? ' | Cost data incomplete' : ''),
  ];
}
function summarize(summary: ExportSummary): string[] {
  return [
    'Recorded amount: ' + money(summary.totalAmountMinor),
    'Source events: ' +
      summary.eventCount +
      ' | Orders: ' +
      summary.orderCount +
      ' | Quantity: ' +
      summary.totalQuantity,
    'Missing costs: ' +
      summary.incompleteCostEvents +
      (summary.incompleteCostEvents > 0 ? ' - Cost data incomplete' : ''),
    ...(summary.coverageNote ? ['Coverage: ' + summary.coverageNote] : []),
  ];
}
function wrapped(line: string): string[] {
  let rest = ascii(line);
  const result: string[] = [];
  while (rest.length > LINE_WIDTH) {
    const gap = rest.lastIndexOf(' ', LINE_WIDTH);
    const pos = gap > LINE_WIDTH / 2 ? gap : LINE_WIDTH;
    result.push(rest.slice(0, pos));
    rest = rest.slice(pos).trimStart();
  }
  result.push(rest);
  return result;
}

/** Portable text PDF built only from pre-authorized, fully paginated report data. */
export function renderAuthorizedReportPdf(
  exportData: AuthorizedExport,
  options: PdfOptions,
): Buffer {
  if (exportData.sections.length === 0) throw new Error('report_export_no_sections');
  const pages: string[][] = [];
  let current: string[] = [];
  const newPage = () => {
    if (current.length > 0) pages.push(current);
    current = [];
  };
  const addLine = (line: string) => {
    for (const part of wrapped(line)) {
      if (current.length === LINES_PER_PAGE) newPage();
      current.push(part);
    }
  };
  const scope = exportData.selectedShops.map((id) => options.shopNames[id] ?? id).join(', ');
  for (const [i, section] of exportData.sections.entries()) {
    if (i > 0) newPage();
    addLine('TUX Admin - ' + REPORT_LABELS[section.area]);
    addLine('Report ' + (i + 1) + ' of ' + exportData.sections.length);
    addLine(
      exportData.sections.length + ' authorized sections of ' + exportData.requestedAreaCount,
    );
    addLine('Period (Africa/Cairo): ' + exportData.fromDate + ' to ' + exportData.toDate);
    addLine('Shop scope: ' + scope);
    if (exportData.appliedFilters) {
      addLine('Source filter: ' + (exportData.appliedFilters.source ?? 'All sources'));
      for (const [key, value] of Object.entries(exportData.appliedFilters.context)) {
        addLine('Context filter - ' + key + ': ' + value);
      }
    }
    addLine('Generated UTC: ' + options.generatedAt);
    addLine('-------------------------------------------------------------------');
    summarize(section.summary).forEach(addLine);
    if (section.comparison) {
      addLine(
        'Comparison period: ' +
          section.comparison.periodStart +
          ' to ' +
          section.comparison.periodEnd,
      );
      addLine('Previous period amount: ' + money(section.comparison.summary.totalAmountMinor));
      addLine('Previous period source events: ' + section.comparison.summary.eventCount);
    }
    addLine('-------------------------------------------------------------------');
    addLine('All ' + section.rows.length + ' matching authorized source records:');
    if (section.rows.length === 0) addLine('No matching source events in this period.');
    section.rows.forEach((row, index) => {
      const shop = options.shopNames[row.shopId] ?? row.shopId;
      sourceRows(row, index, shop).forEach(addLine);
    });
  }
  newPage();
  if (pages.length > 200) throw new Error('report_export_too_large');

  const objects: Buffer[] = [];
  const put = (value: string) => {
    objects.push(Buffer.from(value, 'latin1'));
    return objects.length;
  };
  const fontId = put('<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>');
  const pagesId = put('');
  const pageIds: number[] = [];
  pages.forEach((lines, pageIndex) => {
    const commands = lines.map(
      (line, index) =>
        'BT /F1 9 Tf 36 ' + (797 - 13 * index) + ' Td (' + escapePdf(line) + ') Tj ET',
    );
    commands.push(
      'BT /F1 9 Tf 36 27 Td (Page ' + (pageIndex + 1) + ' / ' + pages.length + ') Tj ET',
    );
    const stream = commands.join('\n') + '\n';
    const streamId = put(
      '<< /Length ' + Buffer.byteLength(stream, 'latin1') + ' >>\nstream\n' + stream + 'endstream',
    );
    pageIds.push(
      put(
        '<< /Type /Page /Parent ' +
          pagesId +
          ' 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ' +
          fontId +
          ' 0 R >> >> /Contents ' +
          streamId +
          ' 0 R >>',
      ),
    );
  });
  objects[pagesId - 1] = Buffer.from(
    '<< /Type /Pages /Count ' +
      pageIds.length +
      ' /Kids [' +
      pageIds.map((id) => id + ' 0 R').join(' ') +
      '] >>',
    'ascii',
  );
  const catalogId = put('<< /Type /Catalog /Pages ' + pagesId + ' 0 R >>');
  const chunks: Buffer[] = [Buffer.from('%PDF-1.4\n%binary\n', 'latin1')];
  const offsets: number[] = [];
  let position = chunks[0]!.length;
  objects.forEach((object, i) => {
    offsets.push(position);
    const bytes = Buffer.concat([
      Buffer.from(i + 1 + ' 0 obj\n'),
      object,
      Buffer.from('\nendobj\n'),
    ]);
    chunks.push(bytes);
    position += bytes.length;
  });
  const xref = [
    'xref',
    '0 ' + (objects.length + 1),
    '0000000000 65535 f ',
    ...offsets.map((at) => String(at).padStart(10, '0') + ' 00000 n '),
    'trailer',
    '<< /Size ' + (objects.length + 1) + ' /Root ' + catalogId + ' 0 R >>',
    'startxref',
    String(position),
    '%%EOF',
    '',
  ].join('\n');
  chunks.push(Buffer.from(xref, 'ascii'));
  const result = Buffer.concat(chunks);
  if (result.byteLength > MAX_PDF_BYTES) throw new Error('report_export_too_large');
  return result;
}
