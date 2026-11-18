// تنظيم — رسم البطاقة (الباج) من تصميم JSON: SVG للمعاينة والطباعة من المتصفح، وZPL لطابعات Zebra.
// الوحدات بالملّيمتر. يستخدمه المحرر والكشك والخادم معاً.
import QRCode from 'qrcode';

export const SIZES = { CR80: [85.6, 54], CR80_PORTRAIT: [54, 85.6], A6: [105, 148], BADGE_4x3: [101.6, 76.2] };
export const CATEGORY_COLORS = { vip: '#9a3412', guest: '#0f6e56', student: '#1d4ed8', staff: '#475569', media: '#7c3aed', speaker: '#b45309', contractor: '#0e7490' };
export const FIELDS = ['name_ar', 'name_en', 'org_name', 'job_title', 'category_label', 'event_title', 'event_date'];

export function defaultDesign(w = 54, h = 85.6) {
    return {
        bg: '#ffffff',
        elements: [
            { id: 'band', type: 'band', x: 0, y: 0, w, h: 14, color: 'category' },
            { id: 'logo', type: 'logo', x: 3, y: 2, w: 10, h: 10 },
            { id: 'ev', type: 'field', field: 'event_title', x: 14, y: 3, w: w - 17, h: 8, size: 8, bold: true, color: '#ffffff', align: 'right' },
            { id: 'photo', type: 'photo', x: (w - 20) / 2, y: 17, w: 20, h: 24, radius: 2 },
            { id: 'name', type: 'field', field: 'name_ar', x: 3, y: 43, w: w - 6, h: 8, size: 13, bold: true, color: '#111827', align: 'center' },
            { id: 'name_en', type: 'field', field: 'name_en', x: 3, y: 50, w: w - 6, h: 5, size: 7, color: '#4b5563', align: 'center' },
            { id: 'org', type: 'field', field: 'org_name', x: 3, y: 55, w: w - 6, h: 5, size: 8, color: '#374151', align: 'center' },
            { id: 'qr', type: 'qr', x: (w - 20) / 2, y: 61, w: 20, h: 20 },
            { id: 'cat', type: 'field', field: 'category_label', x: 0, y: h - 4.5, w, h: 4.5, size: 7, bold: true, color: '#ffffff', bg: 'category', align: 'center' },
        ],
    };
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const PT = 0.3528; // نقطة → ملّيمتر
const colorOf = (c, data) => (c === 'category' ? CATEGORY_COLORS[data.category] || '#0f6e56' : c || '#000000');
const isArabic = (s) => /[؀-ۿ]/.test(String(s || ''));

/** رسم QR كمسار واحد (دقيق في الطباعة). */
function qrPath(text, x, y, size) {
    const qr = QRCode.create(String(text || ' '), { errorCorrectionLevel: 'M' });
    const n = qr.modules.size;
    const quiet = 1;
    const cell = size / (n + quiet * 2);
    let d = '';
    for (let r = 0; r < n; r++) {
        for (let c = 0; c < n; c++) {
            if (qr.modules.get(r, c)) d += `M${(x + (c + quiet) * cell).toFixed(3)} ${(y + (r + quiet) * cell).toFixed(3)}h${cell.toFixed(3)}v${cell.toFixed(3)}h-${cell.toFixed(3)}z`;
        }
    }
    return `<rect x="${x}" y="${y}" width="${size}" height="${size}" fill="#fff"/><path d="${d}" fill="#000"/>`;
}

/**
 * data: { name_ar, name_en, org_name, job_title, category, category_label, event_title, event_date, qr, photo (url/dataURL), logo (url/dataURL) }
 * opts: { selected: id, showBounds }
 */
export function renderSvg(design, width, height, data = {}, opts = {}) {
    const els = design?.elements || [];
    let body = `<rect x="0" y="0" width="${width}" height="${height}" fill="${esc(design?.bg || '#fff')}"/>`;
    let defs = '';
    for (const el of els) {
        const { x = 0, y = 0, w = 10, h = 10 } = el;
        if (el.type === 'band' || el.type === 'rect') {
            body += `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${el.radius || 0}" fill="${esc(colorOf(el.color, data))}"/>`;
        } else if (el.type === 'field' || el.type === 'text') {
            const text = el.type === 'text' ? el.text : data[el.field];
            if (el.bg) body += `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${esc(colorOf(el.bg, data))}"/>`;
            if (text) {
                const size = (el.size || 10) * PT;
                const anchor = el.align === 'center' ? 'middle' : el.align === 'left' ? 'start' : 'end';
                const tx = el.align === 'center' ? x + w / 2 : el.align === 'left' ? x + 0.5 : x + w - 0.5;
                const ty = y + h / 2 + size * 0.36;
                const est = String(text).length * size * (isArabic(text) ? 0.5 : 0.56);
                const fit = est > w - 1 ? ` textLength="${(w - 1).toFixed(2)}" lengthAdjust="spacingAndGlyphs"` : '';
                body += `<text x="${tx.toFixed(2)}" y="${ty.toFixed(2)}" font-size="${size.toFixed(2)}" font-weight="${el.bold ? 700 : 400}" fill="${esc(colorOf(el.color, data))}" text-anchor="${anchor}" font-family="IBM Plex Sans Arabic, Tahoma, Arial, sans-serif"${fit}>${esc(text)}</text>`;
            }
        } else if (el.type === 'qr') {
            const s = Math.min(w, h);
            body += data.qr ? qrPath(data.qr, x, y, s) : `<rect x="${x}" y="${y}" width="${s}" height="${s}" fill="#e5e7eb"/><text x="${x + s / 2}" y="${y + s / 2 + 1}" font-size="3" text-anchor="middle" fill="#6b7280">QR</text>`;
        } else if (el.type === 'photo' || el.type === 'logo') {
            const src = el.type === 'photo' ? data.photo : data.logo;
            const id = `clip-${el.id}`;
            defs += `<clipPath id="${esc(id)}"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${el.radius || 0}"/></clipPath>`;
            if (src) body += `<image href="${esc(src)}" x="${x}" y="${y}" width="${w}" height="${h}" preserveAspectRatio="xMidYMid ${el.type === 'photo' ? 'slice' : 'meet'}" clip-path="url(#${esc(id)})"/>`;
            else if (el.type === 'photo') body += `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${el.radius || 0}" fill="#e5e7eb"/><circle cx="${x + w / 2}" cy="${y + h * 0.4}" r="${w * 0.2}" fill="#cbd5e1"/><rect x="${x + w * 0.2}" y="${y + h * 0.65}" width="${w * 0.6}" height="${h * 0.3}" rx="${w * 0.2}" fill="#cbd5e1"/>`;
        }
        if (opts.showBounds || opts.selected === el.id) {
            body += `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="${opts.selected === el.id ? '#2563eb' : '#94a3b8'}" stroke-width="${opts.selected === el.id ? 0.4 : 0.15}" stroke-dasharray="${opts.selected === el.id ? '' : '0.8 0.6'}" data-id="${esc(el.id)}" pointer-events="none"/>`;
        }
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}mm" height="${height}mm"><defs>${defs}</defs>${body}</svg>`;
}

/** ZPL لطابعات Zebra (203dpi = 8 نقاط/مم). العربية تحتاج خطاً TrueType محمّلاً على الطابعة (FONT في الإعدادات). */
export function renderZpl(design, width, height, data = {}, { dpmm = 8, font = 'E:TT0003M_.TTF' } = {}) {
    const d = (mm) => Math.round(mm * dpmm);
    const out = ['^XA', '^CI28', `^PW${d(width)}`, `^LL${d(height)}`, '^LH0,0'];
    for (const el of design?.elements || []) {
        const { x = 0, y = 0, w = 10, h = 10 } = el;
        if (el.type === 'band' || el.type === 'rect' || ((el.type === 'field' || el.type === 'text') && el.bg)) {
            out.push(`^FO${d(x)},${d(y)}^GB${d(w)},${d(h)},${Math.min(d(w), d(h))},B,0^FS`);
        }
        if (el.type === 'field' || el.type === 'text') {
            const text = el.type === 'text' ? el.text : data[el.field];
            if (!text) continue;
            const hDots = Math.round((el.size || 10) * PT * dpmm);
            const just = el.align === 'center' ? 'C' : el.align === 'left' ? 'L' : 'R';
            const reverse = el.bg || el.color === '#ffffff' ? '^FR' : '';
            const f = isArabic(text) ? `^A@N,${hDots},${hDots},${font}` : `^A0N,${hDots},${hDots}`;
            out.push(`^FO${d(x)},${d(y + h / 2) - Math.round(hDots / 2)}${f}^FB${d(w)},1,0,${just},0${reverse}^FD${String(text).replace(/[\^~]/g, ' ')}^FS`);
        } else if (el.type === 'qr' && data.qr) {
            const n = QRCode.create(String(data.qr), { errorCorrectionLevel: 'M' }).modules.size;
            const mag = Math.max(1, Math.min(10, Math.floor(d(Math.min(w, h)) / (n + 2))));
            out.push(`^FO${d(x)},${d(y)}^BQN,2,${mag}^FDMA,${data.qr}^FS`);
        }
    }
    out.push('^PQ1', '^XZ');
    return out.join('\n');
}

export const CATEGORY_LABELS = {
    ar: { vip: 'كبار الضيوف', guest: 'ضيف', student: 'طالب', staff: 'منسوب', media: 'إعلام', speaker: 'متحدث', contractor: 'مقاول' },
    en: { vip: 'VIP', guest: 'Guest', student: 'Student', staff: 'Staff', media: 'Media', speaker: 'Speaker', contractor: 'Contractor' },
};
