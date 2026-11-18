// تنظيم — تصميم البطاقات: محرر سحب وإفلات للعناصر (الاسم، الجهة، الصورة، الشعار، QR، الفئة، لون حسب الفئة)،
// معاينة بالمقاس الحقيقي (CR80 ومقاسات مخصصة)، حفظ القوالب وإعادة استخدامها وربطها بالفعاليات.
import { h, icon, clear } from '../../core/dom.js';
import { t, fmtNum, opt } from '../../core/i18n.js';
import { api, post, put, del } from '../../core/api.js';
import { toast, errText, confirm, empty, mount, dialog } from '../../core/ui.js';
import { renderSvg, defaultDesign, SIZES, FIELDS, CATEGORY_COLORS } from '../../../../shared/badge.js';
import { getBranding } from '../../core/theme.js';
import { printSvg } from '../../core/printing.js';
import { pageHead } from '../main.js';

const SAMPLE = (cat) => ({ name_ar: 'عبدالله بن محمد القحطاني', name_en: 'Abdullah Alqahtani', org_name: 'هيئة الحكومة الرقمية', job_title: 'مدير إدارة', category: cat, category_label: { vip: 'كبار الضيوف · VIP', guest: 'ضيف · Guest', student: 'طالب · Student', staff: 'منسوب · Staff', media: 'إعلام · Media', speaker: 'متحدث · Speaker', contractor: 'مقاول · Contractor' }[cat], event_title: 'ملتقى التحول الرقمي 2026', event_date: '15 ديسمبر 2026', qr: 'TZ1.sample.AAAAAAAAAAAAAAAAAAAAAA' });

export default async function badges(ctx) {
    if (ctx.params[0]) return designer(ctx, ctx.params[0]);
    const { root, can, navigate } = ctx;
    const grid = h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '16px' } });
    root.append(pageHead(t('nav.badges'), t('badges.subtitle'), [can('badges', 'create') ? h('a.btn.primary', { href: '/app/badges/new' }, icon('plus'), t('badges.new')) : null]), grid);
    const load = () => mount(grid, () => Promise.all([api('badge_templates', { query: { size: 100 } }), api('events', { query: { size: 500 } })]), async ([r, evs]) => {
        if (!r.rows.length) return empty(t('badges.empty'));
        const cards = await Promise.all(r.rows.map(async (tp) => {
            const full = await api(`badge_templates/${tp.id}`);
            const design = JSON.parse(full.design || '{}');
            const used = evs.rows.filter((e) => e.badge_template_id === tp.id).length;
            return h('div.card', { style: { overflow: 'hidden' } },
                h('a', { href: `/app/badges/${tp.id}`, style: { display: 'grid', placeItems: 'center', padding: '18px', background: 'var(--surface-2)', height: '230px' } },
                    h('div', { style: { height: '190px', aspectRatio: `${tp.width_mm}/${tp.height_mm}`, maxWidth: '100%', boxShadow: 'var(--shadow-lg)', borderRadius: '6px', overflow: 'hidden', background: '#fff' }, html: fit(renderSvg(design, tp.width_mm, tp.height_mm, { ...SAMPLE('vip'), logo: getBranding().logo })) })),
                h('div.card-b', h('div', { style: { display: 'flex', justifyContent: 'space-between', gap: '8px' } }, h('b', tp.name), tp.is_default ? h('span.badge.primary', t('badges.default')) : null),
                    h('div.small.muted', `${tp.width_mm} × ${tp.height_mm} mm · ${t('badges.used_by', { n: fmtNum(used) })}`),
                    h('div.actions', { style: { marginTop: '10px' } },
                        h('a.btn.sm', { href: `/app/badges/${tp.id}` }, icon('edit'), t('common.edit')),
                        can('badges', 'create') ? h('button.btn.sm', { type: 'button', on: { click: async () => { const c = await post('badge_templates', { name: `${tp.name} (${t('badges.copy')})`, width_mm: tp.width_mm, height_mm: tp.height_mm, design }); navigate(`/app/badges/${c.id}`); } } }, icon('copy'), t('badges.duplicate')) : null,
                        can('badges', 'delete') && !tp.is_default ? h('button.btn.sm.ghost.danger.icon', { type: 'button', 'aria-label': t('common.delete'), on: { click: async () => { if (await confirm(t('common.delete_confirm'), { danger: true })) { await del(`badge_templates/${tp.id}`); load(); } } } }, icon('trash')) : null)));
        }));
        return h('div', { style: { display: 'contents' } }, cards);
    });
    load();
}
const fit = (svg) => svg.replace(/width="[\d.]+mm" height="[\d.]+mm"/, 'width="100%" height="100%"');

async function designer({ root, can, navigate }, idParam) {
    const isNew = idParam === 'new';
    const tpl = isNew ? { name: t('badges.untitled'), width_mm: 54, height_mm: 85.6, design: defaultDesign(54, 85.6), is_default: 0 } : await api(`badge_templates/${idParam}`).then((r) => ({ ...r, design: JSON.parse(r.design || '{}') }));
    const st = { sel: null, cat: 'vip', zoom: 5 };
    const canEdit = can('badges', isNew ? 'create' : 'update');
    const canvasBox = h('div', { style: { display: 'grid', placeItems: 'center', padding: '28px', background: 'repeating-conic-gradient(var(--surface-2) 0% 25%, var(--surface) 0% 50%) 50% / 20px 20px', borderRadius: '12px', minHeight: '520px', overflow: 'auto' } });
    const props = h('div');
    const layers = h('div');
    const nameInput = h('input.input', { value: tpl.name, 'aria-label': t('f.name'), style: { maxWidth: '320px' } });
    root.append(pageHead(t('badges.designer'), t('badges.designer_hint'), [
        nameInput,
        h('button.btn', { type: 'button', on: { click: () => printSvg(renderSvg(tpl.design, tpl.width_mm, tpl.height_mm, { ...SAMPLE(st.cat), logo: getBranding().logo }), tpl.width_mm, tpl.height_mm) } }, icon('printer'), t('badges.test_print')),
        h('button.btn', { type: 'button', on: { click: showZpl } }, icon('file-text'), 'ZPL'),
        canEdit ? h('button.btn.primary', { type: 'button', on: { click: save } }, icon('save'), t('common.save')) : null,
    ], [{ label: t('nav.badges'), href: '/app/badges' }, { label: tpl.name }]),
    h('div.grid', { style: { gridTemplateColumns: '220px minmax(0,1fr) 280px', alignItems: 'start' } },
        h('div.card', h('div.card-h', h('h2', t('badges.elements'))), h('div.card-b', { style: { display: 'grid', gap: '6px' } },
            [['field', 'type', 'badges.add_field'], ['text', 'type', 'badges.add_text'], ['qr', 'qr', 'badges.add_qr'], ['photo', 'user', 'badges.add_photo'], ['logo', 'image', 'badges.add_logo'], ['band', 'square', 'badges.add_band'], ['rect', 'square', 'badges.add_rect']].map(([type, ic, k]) => h('button.btn.sm', { type: 'button', disabled: !canEdit, style: { justifyContent: 'flex-start' }, on: { click: () => add(type) } }, icon(ic), t(k))),
            h('hr', { style: { border: 0, borderTop: '1px solid var(--border)', width: '100%' } }), h('div.label', t('badges.layers')), layers)),
        h('div.card', h('div.toolbar',
            h('select.select', { 'aria-label': t('badges.size'), disabled: !canEdit, on: { change: (e) => { if (!e.target.value) return; const [w, hh] = SIZES[e.target.value]; resize(w, hh); } } }, h('option', { value: '' }, t('badges.size')), Object.keys(SIZES).map((k) => h('option', { value: k }, `${t(`badges.size_${k}`)} (${SIZES[k][0]}×${SIZES[k][1]})`))),
            h('input.input', { type: 'number', step: '0.1', value: tpl.width_mm, style: { width: '84px' }, 'aria-label': t('f.width_mm'), disabled: !canEdit, on: { change: (e) => resize(Number(e.target.value), tpl.height_mm) } }), '×',
            h('input.input', { type: 'number', step: '0.1', value: tpl.height_mm, style: { width: '84px' }, 'aria-label': t('f.height_mm'), disabled: !canEdit, on: { change: (e) => resize(tpl.width_mm, Number(e.target.value)) } }), 'mm',
            h('select.select', { 'aria-label': t('f.category'), on: { change: (e) => { st.cat = e.target.value; draw(); } } }, Object.keys(CATEGORY_COLORS).map((c) => h('option', { value: c }, `${t('badges.preview_as')}: ${opt('category', c)}`))),
            h('input', { type: 'range', min: 3, max: 9, step: 0.5, value: st.zoom, 'aria-label': t('badges.zoom'), on: { input: (e) => { st.zoom = Number(e.target.value); draw(); } } }),
            h('label.check', { style: { marginInlineStart: 'auto' } }, h('input', { type: 'checkbox', checked: !!tpl.is_default, disabled: !canEdit, on: { change: (e) => { tpl.is_default = e.target.checked ? 1 : 0; } } }), t('badges.set_default'))), canvasBox),
        h('div.card', h('div.card-h', h('h2', t('badges.properties'))), h('div.card-b', props))));

    function resize(w, hh) {
        if (!(w >= 20 && hh >= 20)) return;
        const sx = w / tpl.width_mm, sy = hh / tpl.height_mm;
        for (const el of tpl.design.elements) { el.x *= sx; el.w *= sx; el.y *= sy; el.h *= sy; }
        tpl.width_mm = w; tpl.height_mm = hh;
        draw();
    }
    function add(type) {
        const id = `${type}-${Date.now().toString(36)}`;
        const base = { id, type, x: 4, y: 4, w: Math.min(30, tpl.width_mm - 8), h: type === 'qr' || type === 'photo' || type === 'logo' ? 18 : 7 };
        if (type === 'field') Object.assign(base, { field: 'name_ar', size: 10, bold: true, color: '#111827', align: 'center' });
        if (type === 'text') Object.assign(base, { text: t('badges.sample_text'), size: 9, color: '#111827', align: 'center' });
        if (type === 'band') Object.assign(base, { x: 0, y: 0, w: tpl.width_mm, h: 10, color: 'category' });
        if (type === 'rect') Object.assign(base, { color: '#e5e7eb', radius: 1 });
        if (type === 'photo') base.radius = 2;
        tpl.design.elements.push(base);
        st.sel = id;
        draw();
    }
    function draw() {
        const z = st.zoom;
        const svgStr = renderSvg(tpl.design, tpl.width_mm, tpl.height_mm, { ...SAMPLE(st.cat), logo: getBranding().logo }, { selected: st.sel, showBounds: true }).replace(/width="[\d.]+mm" height="[\d.]+mm"/, `width="${tpl.width_mm * z}" height="${tpl.height_mm * z}"`);
        const wrap = h('div', { style: { boxShadow: 'var(--shadow-lg)', borderRadius: '4px', overflow: 'hidden', position: 'relative', direction: 'ltr', touchAction: 'none' }, html: svgStr });
        // طبقة تفاعل للسحب: مستطيل شفاف لكل عنصر
        const svg = wrap.querySelector('svg');
        const NS = 'http://www.w3.org/2000/svg';
        tpl.design.elements.forEach((el) => {
            const r = document.createElementNS(NS, 'rect');
            Object.entries({ x: el.x, y: el.y, width: el.w, height: el.h, fill: 'transparent', style: canEdit ? 'cursor:move' : '' }).forEach(([k, v]) => r.setAttribute(k, v));
            r.addEventListener('pointerdown', (e) => startDrag(e, el, svg, 'move'));
            svg.appendChild(r);
            if (st.sel === el.id && canEdit) {
                const hd = document.createElementNS(NS, 'rect');
                Object.entries({ x: el.x + el.w - 1.6, y: el.y + el.h - 1.6, width: 3.2, height: 3.2, fill: '#2563eb', rx: 0.6, style: 'cursor:nwse-resize' }).forEach(([k, v]) => hd.setAttribute(k, v));
                hd.addEventListener('pointerdown', (e) => startDrag(e, el, svg, 'resize'));
                svg.appendChild(hd);
            }
        });
        clear(canvasBox, wrap);
        drawLayers();
        drawProps();
    }
    function startDrag(e, el, svg, mode) {
        e.preventDefault();
        st.sel = el.id;
        if (!canEdit) return draw();
        const inv = svg.getScreenCTM().inverse();
        const pt = svg.createSVGPoint();
        const toMm = (ev) => { pt.x = ev.clientX; pt.y = ev.clientY; return pt.matrixTransform(inv); };
        const s0 = toMm(e);
        const o = { x: el.x, y: el.y, w: el.w, h: el.h };
        const snap = (v) => Math.round(v * 2) / 2;
        const move = (ev) => {
            const p = toMm(ev);
            if (mode === 'move') { el.x = snap(Math.max(0, Math.min(tpl.width_mm - el.w, o.x + p.x - s0.x))); el.y = snap(Math.max(0, Math.min(tpl.height_mm - el.h, o.y + p.y - s0.y))); }
            else { el.w = snap(Math.max(2, o.w + p.x - s0.x)); el.h = snap(Math.max(2, o.h + p.y - s0.y)); }
            draw();
        };
        const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
        draw();
    }
    function drawLayers() {
        clear(layers, ...tpl.design.elements.slice().reverse().map((el) => h('button', { type: 'button', style: { display: 'flex', gap: '6px', alignItems: 'center', width: '100%', border: 0, borderRadius: '7px', padding: '6px 8px', cursor: 'pointer', background: st.sel === el.id ? 'var(--primary-50)' : 'transparent', fontSize: '12.5px', textAlign: 'start' }, on: { click: () => { st.sel = el.id; draw(); } } },
            icon({ field: 'type', text: 'type', qr: 'qr', photo: 'user', logo: 'image', band: 'square', rect: 'square' }[el.type]), el.type === 'field' ? t(`badges.f_${el.field}`) : el.type === 'text' ? el.text : t(`badges.t_${el.type}`))));
    }
    function drawProps() {
        const el = tpl.design.elements.find((x) => x.id === st.sel);
        if (!el) return clear(props, h('div', { style: { display: 'grid', gap: '10px' } }, h('div.muted.small', t('badges.select_hint')), h('div.field', h('label', t('badges.bg')), h('input.input', { type: 'color', value: tpl.design.bg || '#ffffff', disabled: !canEdit, on: { input: (e) => { tpl.design.bg = e.target.value; draw(); } } }))));
        const num = (k, label, step = 0.5) => h('div.field', h('label', label), h('input.input', { type: 'number', step, value: Math.round(el[k] * 10) / 10, disabled: !canEdit, on: { change: (e) => { el[k] = Number(e.target.value); draw(); } } }));
        const colorField = (k, label, allowCat = true) => h('div.field', h('label', label), h('div', { style: { display: 'flex', gap: '6px', alignItems: 'center' } },
            h('input.input', { type: 'color', value: el[k] && el[k] !== 'category' ? el[k] : '#0f6e56', disabled: !canEdit || el[k] === 'category', style: { width: '60px', padding: '2px' }, on: { input: (e) => { el[k] = e.target.value; draw(); } } }),
            allowCat ? h('label.check.small', h('input', { type: 'checkbox', checked: el[k] === 'category', disabled: !canEdit, on: { change: (e) => { el[k] = e.target.checked ? 'category' : '#0f6e56'; draw(); } } }), t('badges.by_category')) : null));
        clear(props, h('div', { style: { display: 'grid', gap: '10px' } },
            h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' } }, num('x', 'X (mm)'), num('y', 'Y (mm)'), num('w', t('f.width_mm')), num('h', t('f.height_mm'))),
            el.type === 'field' ? h('div.field', h('label', t('badges.data_field')), h('select.select', { disabled: !canEdit, on: { change: (e) => { el.field = e.target.value; draw(); } } }, FIELDS.map((f) => h('option', { value: f, selected: f === el.field }, t(`badges.f_${f}`))))) : null,
            el.type === 'text' ? h('div.field', h('label', t('badges.text')), h('input.input', { value: el.text, disabled: !canEdit, on: { input: (e) => { el.text = e.target.value; draw(); } } })) : null,
            ['field', 'text'].includes(el.type) ? [
                h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' } }, num('size', t('badges.font_size'), 0.5),
                    h('div.field', h('label', t('badges.align')), h('select.select', { disabled: !canEdit, on: { change: (e) => { el.align = e.target.value; draw(); } } }, ['right', 'center', 'left'].map((a) => h('option', { value: a, selected: (el.align || 'right') === a }, t(`badges.align_${a}`)))))),
                h('label.check', h('input', { type: 'checkbox', checked: !!el.bold, disabled: !canEdit, on: { change: (e) => { el.bold = e.target.checked; draw(); } } }), t('badges.bold')),
                colorField('color', t('badges.color'), false),
                h('label.check', h('input', { type: 'checkbox', checked: !!el.bg, disabled: !canEdit, on: { change: (e) => { el.bg = e.target.checked ? 'category' : undefined; draw(); } } }), t('badges.with_bg'))] : null,
            ['band', 'rect'].includes(el.type) ? colorField('color', t('badges.color')) : null,
            ['photo', 'rect'].includes(el.type) ? num('radius', t('badges.radius')) : null,
            canEdit ? h('div.actions', h('button.btn.sm', { type: 'button', on: { click: () => { const i = tpl.design.elements.indexOf(el); if (i < tpl.design.elements.length - 1) { tpl.design.elements.splice(i, 1); tpl.design.elements.splice(i + 1, 0, el); draw(); } } } }, icon('chevron-up'), t('badges.forward')),
                h('button.btn.sm', { type: 'button', on: { click: () => { const i = tpl.design.elements.indexOf(el); if (i > 0) { tpl.design.elements.splice(i, 1); tpl.design.elements.splice(i - 1, 0, el); draw(); } } } }, icon('chevron-down'), t('badges.backward')),
                h('button.btn.sm.danger', { type: 'button', on: { click: () => { tpl.design.elements = tpl.design.elements.filter((x) => x !== el); st.sel = null; draw(); } } }, icon('trash'), t('common.delete'))) : null));
    }
    async function save() {
        try {
            const body = { name: nameInput.value.trim() || tpl.name, width_mm: tpl.width_mm, height_mm: tpl.height_mm, design: tpl.design, is_default: tpl.is_default ? 1 : 0 };
            const r = isNew ? await post('badge_templates', body) : await put(`badge_templates/${tpl.id}`, body);
            toast(t('common.saved'), 'ok');
            if (isNew) navigate(`/app/badges/${r.id}`, { replace: true });
        } catch (e) { toast(errText(e), 'bad'); }
    }
    async function showZpl() {
        const r = await post('badges/preview', { design: tpl.design, width_mm: tpl.width_mm, height_mm: tpl.height_mm, category: st.cat });
        dialog({ title: t('badges.zpl'), size: 'wide', body: h('div', h('div.hint-box', { style: { marginBottom: '10px' } }, icon('info'), t('badges.zpl_hint')), h('pre.mono', { style: { background: 'var(--surface-2)', padding: '12px', borderRadius: '10px', maxHeight: '400px', overflow: 'auto', fontSize: '12px' } }, r.zpl)) });
    }
    draw();
}
