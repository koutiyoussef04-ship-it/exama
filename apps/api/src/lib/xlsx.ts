/**
 * A minimal .xlsx writer: one sheet of text cells, a bold header row, column widths and wrapped text. Enough for
 * the question-bank export, with no dependency: a workbook is a ZIP of XML parts (ECMA-376), and Node's zlib
 * provides the deflate and CRC-32 the ZIP container needs (lib/pptx.ts reads the same container format).
 *
 * Cells are inline strings, so nothing in them is ever evaluated as a formula (unlike CSV, where a leading `=`
 * has to be defused). Characters XML cannot carry (control characters) are dropped.
 */
import { crc32, deflateRawSync } from 'node:zlib';

export type XlsxColumn = { header: string; width: number };

const esc = (s: string) =>
  s
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/** A1, B1, … AA1 */
export const cellRef = (col: number, row: number) => {
  let c = '';
  for (let n = col + 1; n > 0; n = Math.floor((n - 1) / 26)) c = String.fromCharCode(65 + ((n - 1) % 26)) + c;
  return `${c}${row}`;
};

const cell = (col: number, row: number, text: string, style: number) =>
  text === '' ? '' : `<c r="${cellRef(col, row)}" t="inlineStr" s="${style}"><is><t xml:space="preserve">${esc(text)}</t></is></c>`;

function sheetXml(columns: XlsxColumn[], rows: string[][]): string {
  const cols = columns.map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.width}" customWidth="1"/>`).join('');
  const header = `<row r="1">${columns.map((c, i) => cell(i, 1, c.header, 1)).join('')}</row>`;
  const body = rows.map((r, ri) => `<row r="${ri + 2}">${columns.map((_, ci) => cell(ci, ri + 2, r[ci] ?? '', 2)).join('')}</row>`).join('');
  const last = cellRef(columns.length - 1, Math.max(1, rows.length + 1));
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<dimension ref="A1:${last}"/>` +
    `<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` +
    `<sheetFormatPr defaultRowHeight="15"/>` +
    `<cols>${cols}</cols>` +
    `<sheetData>${header}${body}</sheetData>` +
    `<autoFilter ref="A1:${last}"/>` +
    `<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>` +
    `</worksheet>`
  );
}

// Style 0: default. 1: bold header, grey fill. 2: body text, wrapped, top-aligned.
const STYLES =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
  `<fonts count="2"><font><sz val="11"/><name val="Calibri"/><family val="2"/></font><font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font></fonts>` +
  `<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFEDEDF5"/><bgColor indexed="64"/></patternFill></fill></fills>` +
  `<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>` +
  `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
  `<cellXfs count="3">` +
  `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>` +
  `<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center"/></xf>` +
  `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>` +
  `</cellXfs>` +
  `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>` +
  `</styleSheet>`;

const CONTENT_TYPES =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
  `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
  `<Default Extension="xml" ContentType="application/xml"/>` +
  `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
  `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` +
  `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
  `<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>` +
  `<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>` +
  `</Types>`;

const ROOT_RELS =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
  `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
  `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>` +
  `<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>` +
  `</Relationships>`;

const WORKBOOK_RELS =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
  `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>` +
  `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
  `</Relationships>`;

const workbookXml = (sheetName: string) =>
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
  `<sheets><sheet name="${esc(sheetName.slice(0, 31))}" sheetId="1" r:id="rId1"/></sheets>` +
  `</workbook>`;

const coreXml = (title: string, created: Date) =>
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">` +
  `<dc:title>${esc(title)}</dc:title><dc:creator>Exama</dc:creator>` +
  `<dcterms:created xsi:type="dcterms:W3CDTF">${created.toISOString()}</dcterms:created>` +
  `</cp:coreProperties>`;

const APP_XML =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Exama</Application></Properties>`;

// ---------------------------------------------------------------- ZIP container (stored entries are never needed)

const u16 = (n: number) => Buffer.from([n & 0xff, (n >> 8) & 0xff]);
const u32 = (n: number) => Buffer.from([n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff]);
/** MS-DOS date/time pair (what ZIP stores), in UTC. */
function dosDateTime(d: Date): { date: number; time: number } {
  const year = Math.max(1980, d.getUTCFullYear());
  return {
    date: ((year - 1980) << 9) | ((d.getUTCMonth() + 1) << 5) | d.getUTCDate(),
    time: (d.getUTCHours() << 11) | (d.getUTCMinutes() << 5) | (d.getUTCSeconds() >> 1),
  };
}

export function zip(entries: { name: string; data: Buffer }[], now = new Date()): Buffer {
  const { date, time } = dosDateTime(now);
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8');
    const packed = deflateRawSync(e.data, { level: 6 });
    const crc = crc32(e.data);
    // version needed 2.0 · flags: UTF-8 names (bit 11) · method 8 (deflate)
    const common = Buffer.concat([u16(0x0800), u16(8), u16(time), u16(date), u32(crc), u32(packed.length), u32(e.data.length), u16(name.length)]);
    const local = Buffer.concat([u32(0x04034b50), u16(20), common, u16(0), name, packed]);
    central.push(Buffer.concat([u32(0x02014b50), u16(20), u16(20), common, u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), name]));
    locals.push(local);
    offset += local.length;
  }
  const dir = Buffer.concat(central);
  const end = Buffer.concat([u32(0x06054b50), u16(0), u16(0), u16(entries.length), u16(entries.length), u32(dir.length), u32(offset), u16(0)]);
  return Buffer.concat([...locals, dir, end]);
}

/** The whole workbook as bytes. `rows[i][j]` is the text of column j (missing = empty cell). */
export function xlsx(opts: { sheetName: string; title: string; columns: XlsxColumn[]; rows: string[][]; now?: Date }): Buffer {
  const now = opts.now ?? new Date();
  const text = (s: string) => Buffer.from(s, 'utf8');
  return zip(
    [
      { name: '[Content_Types].xml', data: text(CONTENT_TYPES) },
      { name: '_rels/.rels', data: text(ROOT_RELS) },
      { name: 'docProps/core.xml', data: text(coreXml(opts.title, now)) },
      { name: 'docProps/app.xml', data: text(APP_XML) },
      { name: 'xl/workbook.xml', data: text(workbookXml(opts.sheetName)) },
      { name: 'xl/_rels/workbook.xml.rels', data: text(WORKBOOK_RELS) },
      { name: 'xl/styles.xml', data: text(STYLES) },
      { name: 'xl/worksheets/sheet1.xml', data: text(sheetXml(opts.columns, opts.rows)) },
    ],
    now,
  );
}
