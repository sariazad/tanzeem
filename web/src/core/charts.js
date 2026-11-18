// تنظيم — رسوم SVG خفيفة: خطي (مع مؤشر وتلميح)، أعمدة، أشرطة أفقية، حلقة. ألوان السلاسل بترتيب ثابت من --s1..--s8.
import { h } from './dom.js';
import { fmtNum } from './i18n.js';

const NS = 'http://www.w3.org/2000/svg';
const s = (tag, attrs = {}, ...kids) => { const el = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) if (v != null) el.setAttribute(k, v); kids.flat().forEach((c) => c && el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c)); return el; };
export const SERIES = (i) => `var(--s${(i % 8) + 1})`;
const niceMax = (v) => { if (v <= 5) return 5; const p = 10 ** Math.floor(Math.log10(v)); const n = v / p; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p; };

function legend(series) {
    if (series.length < 2) return null;
    return h('div.legend', { style: { marginBottom: '8px' } }, series.map((x, i) => h('span', h('i', { style: { background: x.color || SERIES(i) } }), x.name)));
}
function tipBox() { return h('div.chart-tip', { role: 'presentation' }); }
function placeTip(tip, box, x, y) {
    tip.style.display = 'block';
    const bw = box.clientWidth, tw = tip.offsetWidth;
    tip.style.left = `${Math.min(Math.max(4, x + 12), bw - tw - 4)}px`;
    tip.style.top = `${Math.max(0, y - 10)}px`;
}

/** خطي: labels[], series[{name, values[], color}] */
export function lineChart({ labels, series, height = 220, area = true, ariaLabel = '' }) {
    const W = 640, H = height, pl = 36, pr = 10, pt = 10, pb = 26;
    const max = niceMax(Math.max(1, ...series.flatMap((x) => x.values)));
    const X = (i) => pl + (i * (W - pl - pr)) / Math.max(1, labels.length - 1);
    const Y = (v) => pt + (H - pt - pb) * (1 - v / max);
    const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img', 'aria-label': ariaLabel, direction: 'ltr' });
    for (let k = 0; k <= 4; k++) {
        const v = (max * k) / 4;
        svg.append(s('line', { x1: pl, x2: W - pr, y1: Y(v), y2: Y(v), stroke: k ? 'var(--grid)' : 'var(--axis)', 'stroke-width': 1 }), s('text', { x: pl - 6, y: Y(v) + 4, 'text-anchor': 'end' }, fmtNum(v)));
    }
    const step = Math.ceil(labels.length / 8);
    labels.forEach((l, i) => { if (i % step === 0) svg.append(s('text', { x: X(i), y: H - 8, 'text-anchor': 'middle' }, l)); });
    series.forEach((ser, si) => {
        const c = ser.color || SERIES(si);
        const pts = ser.values.map((v, i) => `${X(i).toFixed(1)},${Y(v).toFixed(1)}`);
        if (area) svg.append(s('path', { d: `M${X(0)},${Y(0)} L${pts.join(' L')} L${X(ser.values.length - 1)},${Y(0)} Z`, fill: c, opacity: 0.08 }));
        svg.append(s('polyline', { points: pts.join(' '), fill: 'none', stroke: c, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
    });
    const cross = s('line', { y1: pt, y2: H - pb, stroke: 'var(--axis)', 'stroke-dasharray': '3 3', visibility: 'hidden' });
    const dots = series.map((ser, si) => s('circle', { r: 4, fill: ser.color || SERIES(si), stroke: 'var(--surface)', 'stroke-width': 2, visibility: 'hidden' }));
    svg.append(cross, ...dots);
    const tip = tipBox();
    const box = h('div.chart-box', legend(series), svg, tip);
    svg.addEventListener('mousemove', (e) => {
        const r = svg.getBoundingClientRect();
        const x = ((e.clientX - r.left) / r.width) * W;
        const i = Math.max(0, Math.min(labels.length - 1, Math.round(((x - pl) / (W - pl - pr)) * (labels.length - 1))));
        cross.setAttribute('x1', X(i)); cross.setAttribute('x2', X(i)); cross.setAttribute('visibility', 'visible');
        dots.forEach((d, si) => { d.setAttribute('cx', X(i)); d.setAttribute('cy', Y(series[si].values[i])); d.setAttribute('visibility', 'visible'); });
        tip.replaceChildren(h('b', labels[i]), ...series.map((ser, si) => h('div', h('i', { style: { background: ser.color || SERIES(si) } }), `${ser.name}: ${fmtNum(ser.values[i])}`)));
        placeTip(tip, box, ((X(i) / W) * r.width), e.clientY - box.getBoundingClientRect().top);
    });
    svg.addEventListener('mouseleave', () => { tip.style.display = 'none'; cross.setAttribute('visibility', 'hidden'); dots.forEach((d) => d.setAttribute('visibility', 'hidden')); });
    return box;
}

/** أعمدة مجمّعة: labels[], series[{name, values[]}] */
export function barChart({ labels, series, height = 220, ariaLabel = '' }) {
    const W = 640, H = height, pl = 36, pr = 10, pt = 10, pb = 26;
    const max = niceMax(Math.max(1, ...series.flatMap((x) => x.values)));
    const Y = (v) => pt + (H - pt - pb) * (1 - v / max);
    const band = (W - pl - pr) / labels.length;
    const bw = Math.max(3, Math.min(28, (band - 6) / series.length - 2));
    const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img', 'aria-label': ariaLabel, direction: 'ltr' });
    for (let k = 0; k <= 4; k++) { const v = (max * k) / 4; svg.append(s('line', { x1: pl, x2: W - pr, y1: Y(v), y2: Y(v), stroke: k ? 'var(--grid)' : 'var(--axis)' }), s('text', { x: pl - 6, y: Y(v) + 4, 'text-anchor': 'end' }, fmtNum(v))); }
    const tip = tipBox();
    const box = h('div.chart-box', legend(series), svg, tip);
    const step = Math.ceil(labels.length / 12);
    labels.forEach((l, i) => {
        const gx = pl + i * band + (band - series.length * (bw + 2)) / 2;
        series.forEach((ser, si) => {
            const v = ser.values[i] || 0, x = gx + si * (bw + 2), y = Y(v), hh = Y(0) - y;
            const r = Math.min(4, bw / 2, hh);
            const d = hh <= 0 ? '' : `M${x},${Y(0)} V${y + r} Q${x},${y} ${x + r},${y} H${x + bw - r} Q${x + bw},${y} ${x + bw},${y + r} V${Y(0)} Z`;
            if (d) svg.append(s('path', { d, fill: ser.color || SERIES(si) }));
        });
        const hit = s('rect', { x: pl + i * band, y: pt, width: band, height: H - pt - pb, fill: 'transparent' });
        hit.addEventListener('mousemove', (e) => { tip.replaceChildren(h('b', l), ...series.map((ser, si) => h('div', h('i', { style: { background: ser.color || SERIES(si) } }), `${ser.name}: ${fmtNum(ser.values[i] || 0)}`))); placeTip(tip, box, e.clientX - box.getBoundingClientRect().left, e.clientY - box.getBoundingClientRect().top); });
        hit.addEventListener('mouseleave', () => { tip.style.display = 'none'; });
        svg.append(hit);
        if (i % step === 0) svg.append(s('text', { x: pl + i * band + band / 2, y: H - 8, 'text-anchor': 'middle' }, l));
    });
    return box;
}

/** أشرطة أفقية بأسماء وقيم (HTML لتنعكس مع RTL): items[{label, value}] */
export function hbars(items, { max, format = fmtNum } = {}) {
    const m = max || Math.max(1, ...items.map((x) => x.value));
    return h('div.hbar', items.flatMap((x) => [h('div', { title: x.label, style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, x.label), h('div', h('div.bar', { style: { width: `${(x.value / m) * 100}%`, background: x.color || 'var(--seq)' } })), h('div.num.muted', format(x.value))]));
}

/** حلقة: items[{label, value}] مع وسيلة إيضاح */
export function donut(items, { size = 150, center } = {}) {
    const total = items.reduce((a, b) => a + b.value, 0) || 1;
    const R = 60, r = 42, C = 75;
    const svg = s('svg', { viewBox: '0 0 150 150', width: size, height: size, role: 'img' });
    let a0 = -Math.PI / 2;
    items.forEach((it, i) => {
        if (!it.value) return;
        const a1 = a0 + (it.value / total) * Math.PI * 2 - (items.filter((x) => x.value).length > 1 ? 0.03 : 0);
        const large = a1 - a0 > Math.PI ? 1 : 0;
        const p = (rad, a) => `${C + rad * Math.cos(a)},${C + rad * Math.sin(a)}`;
        const d = Math.abs(a1 - a0) >= Math.PI * 2 - 0.01 ? `M${C - R},${C} a${R},${R} 0 1,0 ${2 * R},0 a${R},${R} 0 1,0 ${-2 * R},0 M${C - r},${C} a${r},${r} 0 1,1 ${2 * r},0 a${r},${r} 0 1,1 ${-2 * r},0` : `M${p(R, a0)} A${R},${R} 0 ${large} 1 ${p(R, a1)} L${p(r, a1)} A${r},${r} 0 ${large} 0 ${p(r, a0)} Z`;
        svg.append(s('path', { d, fill: it.color || SERIES(i), 'fill-rule': 'evenodd' }, s('title', {}, `${it.label}: ${fmtNum(it.value)}`)));
        a0 = a0 + (it.value / total) * Math.PI * 2;
    });
    if (center != null) svg.append(s('text', { x: C, y: C + 6, 'text-anchor': 'middle', style: 'font-size:20px;font-weight:700;fill:var(--text)' }, String(center)));
    return h('div', { style: { display: 'flex', gap: '18px', alignItems: 'center', flexWrap: 'wrap' } }, svg,
        h('div.legend', { style: { flexDirection: 'column', gap: '6px' } }, items.map((it, i) => h('span', h('i', { style: { background: it.color || SERIES(i) } }), `${it.label} — ${fmtNum(it.value)} (${Math.round((it.value / total) * 100)}%)`))));
}

/** لون تسلسلي (أحادي التدرج) لقيمة 0..1 — للخريطة الحرارية */
export const seqColor = (x) => `color-mix(in srgb, var(--seq) ${Math.round(8 + Math.max(0, Math.min(1, x)) * 82)}%, var(--surface))`;
/** لون الكثافة للمناطق: حالة (عادي/مزدحم/حرج) */
export const densityColor = (ratio) => (ratio >= 1 ? 'var(--bad)' : ratio >= 0.8 ? 'var(--warn)' : ratio >= 0.5 ? 'color-mix(in srgb, var(--warn) 45%, var(--ok))' : 'var(--ok)');
