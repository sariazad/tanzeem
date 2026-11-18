// تنظيم — خريطة الفعالية: مخطط SVG تفاعلي (خلفية قابلة للرفع) للمناطق مع مؤشر كثافة ملوّن وتنبيه عند تجاوز السعة.
// وضع التحرير: سحب المناطق وتغيير حجمها، إضافة/تعديل منطقة، ورفع مخطط SVG أو صورة.
import { h, icon, clear, readFileAsDataUrl } from '../../../core/dom.js';
import { t, fmtNum, pick, opt } from '../../../core/i18n.js';
import { api, put, del } from '../../../core/api.js';
import { toast, errText, empty, confirm } from '../../../core/ui.js';
import { densityColor } from '../../../core/charts.js';
import { editResource } from '../../components/form.js';

const NS = 'http://www.w3.org/2000/svg';
const s = (tag, attrs = {}) => { const el = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) if (v != null) el.setAttribute(k, v); return el; };

export default async function map({ root, event, eventId, can, ws }) {
    const canEdit = can('events', 'update');
    if (!event.venue_id) { root.append(empty(t('map.no_venue'), t('map.no_venue_hint'))); return; }
    const st = { edit: false, sel: null, dirty: false, venue: null, zones: [], occ: new Map() };
    const head = h('div.page-head');
    const stage = h('div.map-wrap');
    const side = h('div');
    root.append(head, h('div.grid.g-main', h('div.card', h('div.card-b', stage)), side));

    async function load() {
        const [m, hm] = await Promise.all([api(`venues/${event.venue_id}/map`), api(`events/${eventId}/heatmap`)]);
        st.venue = m.venue; st.zones = m.zones; st.occ = new Map(hm.zones.map((z) => [z.id, z.inside]));
        draw();
    }
    function drawHead() {
        clear(head, h('div', h('h2', t('event.tabs.map')), h('p', `${pick(st.venue, 'name')} — ${st.edit ? t('map.edit_hint') : t('map.view_hint')}`)), canEdit ? h('div.actions',
            st.edit ? [
                h('label.btn', { tabindex: '0' }, icon('upload'), t('map.upload_bg'), h('input', { type: 'file', accept: 'image/svg+xml,image/png,image/jpeg', style: { display: 'none' }, on: { change: uploadBg } })),
                h('button.btn', { type: 'button', on: { click: addZone } }, icon('plus'), t('map.add_zone')),
                h('button.btn', { type: 'button', on: { click: () => { st.edit = false; st.sel = null; load(); } } }, t('common.cancel')),
                h('button.btn.primary', { type: 'button', on: { click: save } }, icon('save'), t('common.save')),
            ] : h('button.btn', { type: 'button', on: { click: () => { st.edit = true; draw(); } } }, icon('edit'), t('map.edit'))) : null);
    }
    function draw() {
        drawHead();
        const W = st.venue.map_w, H = st.venue.map_h;
        const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': t('event.tabs.map') });
        if (st.venue.map_bg) svg.append(s('image', { href: st.venue.map_bg, x: 0, y: 0, width: W, height: H, preserveAspectRatio: 'xMidYMid meet' }));
        else svg.append(s('rect', { x: 0, y: 0, width: W, height: H, fill: 'var(--surface-2)' }));
        for (const z of st.zones) {
            const inside = st.occ.get(z.id) || 0;
            const r = z.capacity ? inside / z.capacity : 0;
            const g = s('g', { tabindex: '0', role: 'button', 'aria-label': `${pick(z, 'name')}: ${inside}/${z.capacity}` });
            const color = st.edit ? (z.color || 'var(--primary)') : densityColor(r);
            const rect = s('rect', { x: z.x, y: z.y, width: z.w, height: z.h, rx: 10, fill: color, 'fill-opacity': st.edit ? 0.18 : 0.28 + Math.min(r, 1) * 0.45, stroke: st.sel === z.id ? 'var(--info)' : color, 'stroke-width': st.sel === z.id ? 4 : 2, class: 'zone-rect' });
            const label = s('text', { x: z.x + z.w / 2, y: z.y + z.h / 2 - 4, 'text-anchor': 'middle', 'font-size': Math.max(12, Math.min(22, z.w / 9)), fill: 'var(--text)', class: 'zone-label' });
            label.textContent = pick(z, 'name');
            const sub = s('text', { x: z.x + z.w / 2, y: z.y + z.h / 2 + 18, 'text-anchor': 'middle', 'font-size': Math.max(11, Math.min(16, z.w / 12)), fill: 'var(--muted)', class: 'zone-label', direction: 'ltr', 'unicode-bidi': 'isolate' });
            sub.textContent = st.edit ? `${opt('zone_kind', z.kind)} · ${fmtNum(z.capacity)}` : `${fmtNum(inside)} / ${fmtNum(z.capacity)}${r >= 1 ? ' ⚠' : ''}`;
            g.append(rect, label, sub);
            if (st.edit) {
                const handle = s('rect', { x: z.x + z.w - 14, y: z.y + z.h - 14, width: 14, height: 14, rx: 3, fill: 'var(--info)', style: 'cursor:nwse-resize' });
                g.append(handle);
                drag(svg, rect, z, 'move');
                drag(svg, handle, z, 'resize');
            }
            g.addEventListener('click', () => { st.sel = z.id; drawSide(); if (st.edit) draw(); });
            g.addEventListener('keydown', (e) => { if (e.key === 'Enter') { st.sel = z.id; drawSide(); } });
            svg.append(g);
        }
        clear(stage, svg);
        drawSide();
    }
    function drag(svg, el, z, mode) {
        el.style.cursor = mode === 'move' ? 'move' : 'nwse-resize';
        el.addEventListener('pointerdown', (e) => {
            e.preventDefault();
            e.stopPropagation();
            st.sel = z.id;
            const pt = svg.createSVGPoint();
            const inv = svg.getScreenCTM().inverse(); // ثابت أثناء السحب (الرسم يُعاد بعناصر جديدة)
            const toSvg = (ev) => { pt.x = ev.clientX; pt.y = ev.clientY; return pt.matrixTransform(inv); };
            const start = toSvg(e);
            const o = { x: z.x, y: z.y, w: z.w, h: z.h };
            const move = (ev) => {
                const p = toSvg(ev);
                const dx = p.x - start.x, dy = p.y - start.y;
                if (mode === 'move') { z.x = Math.max(0, Math.min(st.venue.map_w - z.w, Math.round(o.x + dx))); z.y = Math.max(0, Math.min(st.venue.map_h - z.h, Math.round(o.y + dy))); }
                else { z.w = Math.max(60, Math.round(o.w + dx)); z.h = Math.max(40, Math.round(o.h + dy)); }
                st.dirty = true;
                draw();
            };
            const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
            window.addEventListener('pointermove', move);
            window.addEventListener('pointerup', up);
        });
    }
    function drawSide() {
        const over = st.zones.filter((z) => z.capacity && (st.occ.get(z.id) || 0) >= z.capacity);
        const z = st.zones.find((x) => x.id === st.sel);
        clear(side, h('div', { style: { display: 'grid', gap: '16px' } },
            over.length ? h('div.hint-box.bad', icon('alert'), h('div', h('b', t('map.over_capacity')), h('div', over.map((x) => pick(x, 'name')).join(t('common.sep'))))) : null,
            h('div.card', h('div.card-h', h('h2', t('map.legend'))), h('div.card-b', h('div.legend', { style: { flexDirection: 'column', gap: '8px' } },
                [[0.2, 'map.d_normal'], [0.6, 'map.d_moderate'], [0.85, 'map.d_busy'], [1, 'map.d_full']].map(([r, k]) => h('span', h('i', { style: { background: densityColor(r) } }), t(k)))))),
            z ? h('div.card', h('div.card-h', h('h2', pick(z, 'name')), canEdit ? h('div.actions',
                h('button.btn.xs.ghost.icon', { type: 'button', 'aria-label': t('common.edit'), on: { click: async () => { const r = await editResource('zones', z); if (r) { Object.assign(z, r); draw(); } } } }, icon('edit')),
                h('button.btn.xs.ghost.icon', { type: 'button', 'aria-label': t('common.delete'), on: { click: async () => { if (await confirm(t('common.delete_confirm'), { danger: true })) { await del(`zones/${z.id}`); st.sel = null; load(); } } } }, icon('trash'))) : null),
            h('div.card-b', h('dl.kv', h('dt', t('f.kind')), h('dd', opt('zone_kind', z.kind)), h('dt', t('f.capacity')), h('dd', fmtNum(z.capacity)), h('dt', t('common.inside')), h('dd', fmtNum(st.occ.get(z.id) || 0))))) : h('div.card', h('div.card-b.muted', t('map.pick_zone'))),
            h('div.card', h('div.card-h', h('h2', t('map.zones'))), h('div.list', st.zones.map((x) => {
                const inside = st.occ.get(x.id) || 0;
                return h('button.list-item', { type: 'button', style: { border: 0, background: x.id === st.sel ? 'var(--primary-50)' : 'none', cursor: 'pointer', textAlign: 'start', width: '100%' }, on: { click: () => { st.sel = x.id; draw(); } } },
                    h('span.dot', { style: { background: densityColor(x.capacity ? inside / x.capacity : 0) } }), h('span', { style: { flex: 1 } }, pick(x, 'name')), h('span.small.num.muted', `${fmtNum(inside)}/${fmtNum(x.capacity)}`));
            })))));
    }
    async function uploadBg(e) {
        const f = e.target.files[0];
        if (!f) return;
        if (f.size > 1_400_000) return toast(t('errors.too_big'), 'bad');
        st.venue.map_bg = await readFileAsDataUrl(f, f.type === 'image/svg+xml' ? 0 : 2000);
        if (f.type !== 'image/svg+xml') {
            const img = new Image();
            img.onload = () => { st.venue.map_w = Math.min(5000, img.width); st.venue.map_h = Math.min(5000, img.height); st.bgChanged = true; draw(); };
            img.src = st.venue.map_bg;
        } else { st.bgChanged = true; draw(); }
    }
    async function addZone() {
        const r = await editResource('zones', null, { defaults: { venue_id: st.venue.id, x: 30, y: 30, w: 220, h: 110 } });
        if (r) { st.zones.push(r); st.sel = r.id; draw(); }
    }
    async function save() {
        try {
            await put(`venues/${st.venue.id}/map`, { zones: st.zones.map((z) => ({ id: z.id, x: z.x, y: z.y, w: z.w, h: z.h })), ...(st.bgChanged ? { map_bg: st.venue.map_bg, map_w: st.venue.map_w, map_h: st.venue.map_h } : {}) });
            toast(t('common.saved'), 'ok');
            st.edit = false; st.dirty = false; st.bgChanged = false;
            load();
        } catch (e) { toast(errText(e), 'bad'); }
    }
    await load();
    ws.sub(`event:${eventId}`);
    let tmr;
    const off = ws.on('attendance', (a) => { if (a.subject.id === eventId && !st.edit) { clearTimeout(tmr); tmr = setTimeout(load, 1200); } });
    return () => { off(); clearTimeout(tmr); };
}
