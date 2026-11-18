// تنظيم — رسم رمز QR كـ SVG (بلا اتصال خارجي).
import QRCode from 'qrcode';
import { h } from './dom.js';

export function qrSvg(text, size = 200) {
    const q = QRCode.create(String(text), { errorCorrectionLevel: 'M' });
    const n = q.modules.size, m = 2, cell = size / (n + m * 2);
    let d = '';
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.modules.get(r, c)) d += `M${((c + m) * cell).toFixed(2)} ${((r + m) * cell).toFixed(2)}h${cell.toFixed(2)}v${cell.toFixed(2)}h-${cell.toFixed(2)}z`;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" aria-label="QR"><rect width="${size}" height="${size}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}
export const qrEl = (text, size = 200) => h('div', { style: { width: `${size}px`, height: `${size}px`, background: '#fff', borderRadius: '10px', overflow: 'hidden', display: 'inline-block' }, html: qrSvg(text, size) });
