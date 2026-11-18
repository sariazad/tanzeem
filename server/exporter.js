// تنظيم — تصدير الجداول: CSV (UTF-8 مع BOM ليفتح بالعربية في Excel) وExcel (xlsx من اليمين لليسار).
// كاتب xlsx مدمج صغير (OOXML + ZIP) بلا اعتماديات خارجية، فلا تدخل مكتبة تحليل ملفات إلى الخادم.
import zlib from 'node:zlib';
import { toCsv } from './http.js';

const xml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
const colName = (i) => { let s = ''; i++; while (i) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };

function sheetXml(header, rows, rtl, widths) {
    const cell = (v, r, c, style = 0) => {
        const ref = `${colName(c)}${r}`;
        if (v == null || v === '') return '';
        if (typeof v === 'number' && Number.isFinite(v)) return `<c r="${ref}"${style ? ` s="${style}"` : ''}><v>${v}</v></c>`;
        let s = String(v);
        if (/^[=+\-@]/.test(s)) s = `'${s}`; // منع حقن الصيغ
        return `<c r="${ref}" t="inlineStr"${style ? ` s="${style}"` : ''}><is><t xml:space="preserve">${xml(s)}</t></is></c>`;
    };
    const out = [`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"${rtl ? ' rightToLeft="1"' : ''}><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>`,
        `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols><sheetData>`,
        `<row r="1">${header.map((h, c) => cell(h, 1, c, 1)).join('')}</row>`];
    rows.forEach((row, i) => out.push(`<row r="${i + 2}">${row.map((v, c) => cell(v, i + 2, c)).join('')}</row>`));
    out.push(`</sheetData><autoFilter ref="A1:${colName(Math.max(0, header.length - 1))}${rows.length + 1}"/></worksheet>`);
    return out.join('');
}

function zip(files) {
    const local = [], central = [];
    let offset = 0;
    for (const [name, content] of files) {
        const data = Buffer.from(content, 'utf8');
        const comp = zlib.deflateRawSync(data);
        const crc = zlib.crc32(data);
        const nameBuf = Buffer.from(name, 'utf8');
        const h = Buffer.alloc(30);
        h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x0800, 6); h.writeUInt16LE(8, 8); h.writeUInt32LE(0, 10);
        h.writeUInt32LE(crc >>> 0, 14); h.writeUInt32LE(comp.length, 18); h.writeUInt32LE(data.length, 22); h.writeUInt16LE(nameBuf.length, 26); h.writeUInt16LE(0, 28);
        local.push(h, nameBuf, comp);
        const c = Buffer.alloc(46);
        c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8); c.writeUInt16LE(8, 10); c.writeUInt32LE(0, 12);
        c.writeUInt32LE(crc >>> 0, 16); c.writeUInt32LE(comp.length, 20); c.writeUInt32LE(data.length, 24); c.writeUInt16LE(nameBuf.length, 28);
        c.writeUInt32LE(offset, 42);
        central.push(c, nameBuf);
        offset += 30 + nameBuf.length + comp.length;
    }
    const cd = Buffer.concat(central);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
    return Buffer.concat([...local, cd, end]);
}

export function writeXlsx(header, rows, { rtl = true, sheet = 'data' } = {}) {
    const widths = header.map((h, i) => Math.min(48, Math.max(9, String(h).length + 3, ...rows.slice(0, 200).map((r) => String(r[i] ?? '').length + 2))));
    return zip([
        ['[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>'],
        ['_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
        ['xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${xml(sheet.slice(0, 31))}" sheetId="1" r:id="rId1"/></sheets><definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">'${xml(sheet.slice(0, 31))}'!$A$1:$${colName(Math.max(0, header.length - 1))}$${rows.length + 1}</definedName></definedNames></workbook>`],
        ['xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'],
        ['xl/styles.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF0F6E56"/></patternFill></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="2"><xf/><xf fontId="1" fillId="2" applyFont="1" applyFill="1"/></cellXfs></styleSheet>'],
        ['xl/worksheets/sheet1.xml', sheetXml(header, rows, rtl, widths)],
    ]);
}

export function makeExporter() {
    function file(format, name, cols, rows, { rtl = true, sheet = 'data' } = {}) {
        const stamp = new Date().toISOString().slice(0, 10);
        if (format === 'xlsx') {
            const body = writeXlsx(cols.map((c) => c.label), rows.map((r) => cols.map((c) => r[c.key] ?? '')), { rtl, sheet });
            return { filename: `${name}-${stamp}.xlsx`, mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', body };
        }
        return { filename: `${name}-${stamp}.csv`, mime: 'text/csv; charset=utf-8', body: Buffer.from(toCsv(cols, rows), 'utf8') };
    }
    return { file };
}
