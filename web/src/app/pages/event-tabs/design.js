// تنظيم — مصمم صفحة الفعالية والتسجيل: قوالب جاهزة، تحكم كامل بالقالب والألوان والخلفية والغلاف والأقسام والنموذج والحركة،
// مع معاينة حية (جوال/حاسب) تتحدث لحظياً دون حفظ، وتراجع/إعادة، ورابط الصفحة ورمز QR للمشاركة.
import './design.css';
import { h, icon, clear, readFileAsDataUrl } from '../../../core/dom.js';
import { t } from '../../../core/i18n.js';
import { api, put } from '../../../core/api.js';
import { toast, errText, confirm, copy } from '../../../core/ui.js';
import { qrEl, qrSvg } from '../../../core/qr.js';
import {
    DEFAULT_DESIGN, PRESETS, LAYOUTS, BG_KINDS, PATTERNS, MODES, HERO_HEIGHTS, ALIGNS, FORM_STYLES, BUTTONS, ENTRANCES, PAGE_FONTS, MAX_IMAGE_CHARS,
    normalizeDesign, mergeDesign,
} from '../../../../../shared/page-design.js';

const PRESET_SWATCH = { official: ['#0b2e59', '#b8862b'], students: ['#7c3aed', '#ec4899'], tech: ['#0b1220', '#06b6d4'], calm: ['#f6f4ef', '#0f6e56'] };

export default async function design({ root, eventId, event, can }) {
    const canEdit = can('events', 'update');
    const res = await api(`events/${eventId}/page`);
    let d = normalizeDesign(res.design);
    let saved = JSON.stringify(d);
    const history = [saved];
    let hIndex = 0;
    let device = 'phone';
    let frameReady = false;

    /* ───── المعاينة ───── */
    const frame = h('iframe.dz-frame', { src: `/m/r/${eventId}?preview=1`, title: t('design.preview'), loading: 'eager' });
    const stage = h('div.dz-stage', { class: 'phone' }, h('div.dz-device', frame));
    let raf = 0;
    const push = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => { if (frameReady) frame.contentWindow?.postMessage({ type: 'tz-design', design: normalizeDesign(d) }, location.origin); }); };
    const onMsg = (e) => { if (e.origin === location.origin && e.data?.type === 'tz-preview-ready' && e.source === frame.contentWindow) { frameReady = true; push(); } };
    addEventListener('message', onMsg);
    const fit = () => {
        if (device !== 'desktop') { frame.style.transform = ''; return; }
        const w = stage.querySelector('.dz-device').clientWidth;
        const s = Math.min(1, w / 1280);
        frame.style.transform = `scale(${s})`;
        stage.querySelector('.dz-device').style.height = `${Math.round(800 * s)}px`;
    };
    const ro = new ResizeObserver(fit); ro.observe(stage);

    /* ───── التغيير والتاريخ ───── */
    const status = h('span.dz-status');
    const saveBtn = h('button.btn.primary', { type: 'button', disabled: !canEdit, on: { click: save } }, icon('save'), t('common.save'));
    const undoBtn = h('button.btn.icon', { type: 'button', 'aria-label': t('design.undo'), title: t('design.undo'), on: { click: () => step(-1) } }, icon('refresh'));
    const redoBtn = h('button.btn.icon.flip', { type: 'button', 'aria-label': t('design.redo'), title: t('design.redo'), on: { click: () => step(1) } }, icon('refresh'));
    let commitTimer = 0;
    // لا نستبدل الكائن هنا: عناصر التحكم مربوطة بكائناته الداخلية. التحقق يتم عند الحفظ وفي المعاينة.
    function changed({ redraw = false, commitNow = false } = {}) {
        push();
        clearTimeout(commitTimer);
        const commit = () => { const s = JSON.stringify(d); if (s !== history[hIndex]) { history.splice(hIndex + 1); history.push(s); if (history.length > 60) history.shift(); hIndex = history.length - 1; } refreshBar(); };
        if (commitNow) commit(); else commitTimer = setTimeout(commit, 350);
        if (redraw) drawPanel();
        refreshBar();
    }
    function step(dir) {
        const i = hIndex + dir;
        if (i < 0 || i >= history.length) return;
        hIndex = i; d = JSON.parse(history[i]); push(); drawPanel(); refreshBar();
    }
    function refreshBar() {
        const dirty = JSON.stringify(normalizeDesign(d)) !== saved;
        status.textContent = dirty ? t('design.unsaved') : t('design.saved_state');
        status.className = `dz-status ${dirty ? 'dirty' : ''}`;
        saveBtn.disabled = !canEdit || !dirty;
        undoBtn.disabled = hIndex <= 0; redoBtn.disabled = hIndex >= history.length - 1;
    }
    async function save() {
        const body = JSON.stringify({ design: normalizeDesign(d) });
        if (body.length > 3_400_000) return toast(t('design.too_large'), 'bad', 6000);
        saveBtn.disabled = true;
        try { const r = await put(`events/${eventId}/page`, { design: normalizeDesign(d) }); d = normalizeDesign(r.design); saved = JSON.stringify(d); toast(t('common.saved'), 'ok'); }
        catch (e) { toast(errText(e), 'bad'); }
        refreshBar();
    }
    const onKey = (e) => {
        if (!(e.ctrlKey || e.metaKey) || ['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) return;
        if (e.key.toLowerCase() === 'z') { e.preventDefault(); step(e.shiftKey ? 1 : -1); }
        if (e.key.toLowerCase() === 's') { e.preventDefault(); if (canEdit) save(); }
    };
    addEventListener('keydown', onKey);
    const onUnload = (e) => { if (JSON.stringify(normalizeDesign(d)) !== saved) { e.preventDefault(); e.returnValue = ''; } };
    addEventListener('beforeunload', onUnload);

    /* ───── عناصر التحكم ───── */
    const dis = !canEdit;
    const group = (key, ic, open, ...body) => h('details.dz-group', { open }, h('summary', icon(ic), h('span', t(`design.g_${key}`)), icon('chevron-left')), h('div.dz-group-b', body));
    const row = (label, ...c) => h('div.dz-row', h('label.dz-label', label), h('div.dz-ctl', c));
    const seg = (value, options, labelOf, onPick) => h('div.dz-seg', { role: 'radiogroup' }, options.map((o) => h('button', { type: 'button', role: 'radio', 'aria-checked': String(o === value), class: o === value ? 'on' : '', disabled: dis, on: { click: () => onPick(o) } }, labelOf(o))));
    const colorIn = (value, fallback, onSet, clearable) => h('div.dz-color',
        h('input', { type: 'color', value: value || fallback, disabled: dis, on: { input: (e) => onSet(e.target.value) } }),
        h('input.input.mono', { value: value || '', placeholder: clearable ? t('design.inherit') : fallback, dir: 'ltr', disabled: dis, on: { change: (e) => onSet(e.target.value.trim()) } }),
        clearable && value ? h('button.btn.xs.ghost', { type: 'button', title: t('design.inherit'), disabled: dis, on: { click: () => onSet('') } }, icon('x')) : null);
    const slider = (value, min, max, stepV, onSet, fmt = (v) => v) => {
        const out = h('output.dz-out', fmt(value));
        return h('div.dz-slider', h('input', { type: 'range', min, max, step: stepV, value, disabled: dis, on: { input: (e) => { out.textContent = fmt(Number(e.target.value)); onSet(Number(e.target.value)); } } }), out);
    };
    const toggle = (checked, label, onSet) => h('label.check', h('span.switch', h('input', { type: 'checkbox', checked, disabled: dis, on: { change: (e) => onSet(e.target.checked) } }), h('span')), label);
    const text2 = (obj, base, max, area) => h('div.dz-two', ['ar', 'en'].map((l) => h(area ? 'textarea.textarea' : 'input.input', { value: area ? null : obj[`${base}_${l}`], maxlength: max, rows: area ? 3 : null, dir: l === 'ar' ? 'rtl' : 'ltr', placeholder: t(`design.lang_${l}`), disabled: dis, on: { input: (e) => { obj[`${base}_${l}`] = e.target.value; changed(); } } }, area ? obj[`${base}_${l}`] : null)));
    const imagePick = (value, onSet) => h('div.dz-image',
        value ? h('div.dz-thumb', { style: { backgroundImage: `url("${value}")` } }) : h('div.dz-thumb.empty', icon('image')),
        h('div.dz-image-actions',
            h('label.btn.sm', { class: dis ? 'disabled' : '' }, icon('upload'), t('design.upload'), h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', hidden: true, disabled: dis, on: { change: async (e) => {
                const f = e.target.files?.[0]; if (!f) return;
                try { const url = await readFileAsDataUrl(f, 1800, 0.82); if (url.length > MAX_IMAGE_CHARS) return toast(t('design.image_large'), 'bad', 5000); onSet(url); } catch { toast(t('design.image_bad'), 'bad'); }
            } } })),
            value ? h('button.btn.sm.ghost', { type: 'button', disabled: dis, on: { click: () => onSet(null) } }, icon('trash'), t('common.delete')) : null),
        h('small.muted', t('design.image_hint')));

    const layoutTile = (k) => h('button.dz-tile', { type: 'button', class: d.layout === k ? 'on' : '', 'aria-pressed': String(d.layout === k), disabled: dis, on: { click: () => { d.layout = k; changed({ redraw: true, commitNow: true }); } } },
        h(`div.dz-mini.m-${k}`, h('i'), h('i'), h('i')), h('span', t(`design.layout_${k}`)));
    const sectionList = () => h('div.dz-sections', d.sections.map((s, i) => h('div.dz-sec', { class: s.on ? '' : 'off', draggable: !dis, on: {
        dragstart: (e) => { e.dataTransfer.setData('text/plain', String(i)); e.currentTarget.classList.add('drag'); },
        dragend: (e) => e.currentTarget.classList.remove('drag'),
        dragover: (e) => e.preventDefault(),
        drop: (e) => { e.preventDefault(); const from = Number(e.dataTransfer.getData('text/plain')); if (Number.isNaN(from) || from === i) return; const [m] = d.sections.splice(from, 1); d.sections.splice(i, 0, m); changed({ redraw: true, commitNow: true }); },
    } },
        h('span.dz-grip', '⋮⋮'),
        toggle(s.on, t(`design.sec_${s.key}`), (v) => { s.on = v; changed({ redraw: true, commitNow: true }); }),
        h('div.dz-sec-move',
            h('button.btn.xs.ghost.icon', { type: 'button', 'aria-label': t('design.move_up'), disabled: dis || i === 0, on: { click: () => { [d.sections[i - 1], d.sections[i]] = [d.sections[i], d.sections[i - 1]]; changed({ redraw: true, commitNow: true }); } } }, '▲'),
            h('button.btn.xs.ghost.icon', { type: 'button', 'aria-label': t('design.move_down'), disabled: dis || i === d.sections.length - 1, on: { click: () => { [d.sections[i + 1], d.sections[i]] = [d.sections[i], d.sections[i + 1]]; changed({ redraw: true, commitNow: true }); } } }, '▼')))));

    const panel = h('div.dz-panel');
    function drawPanel() {
        const scroll = panel.scrollTop;
        const openState = [...panel.querySelectorAll('details')].map((x) => x.open);
        const bg = d.background;
        clear(panel,
            group('presets', 'zap', true,
                h('div.dz-presets', Object.keys(PRESETS).map((k) => h('button.dz-preset', { type: 'button', disabled: dis, on: { click: () => { d = normalizeDesign(mergeDesign(d, PRESETS[k])); changed({ redraw: true, commitNow: true }); toast(t('design.preset_applied', { name: t(`design.preset_${k}`) }), 'ok', 1800); } } },
                    h('span.dz-preset-sw', { style: { background: `linear-gradient(135deg, ${PRESET_SWATCH[k][0]} 50%, ${PRESET_SWATCH[k][1]} 50%)` } }), h('b', t(`design.preset_${k}`)), h('small', t(`design.preset_${k}_hint`))))),
                h('button.btn.sm.ghost', { type: 'button', disabled: dis, on: { click: async () => { if (await confirm(t('design.reset_confirm'))) { d = normalizeDesign(DEFAULT_DESIGN); changed({ redraw: true, commitNow: true }); } } } }, icon('refresh'), t('design.reset'))),
            group('layout', 'grid', true, h('div.dz-tiles', LAYOUTS.map(layoutTile))),
            group('colors', 'sun', false,
                row(t('design.primary'), colorIn(d.theme.primary, '#0f6e56', (v) => { d.theme.primary = v; changed({ redraw: !v }); }, true)),
                row(t('design.accent'), colorIn(d.theme.accent, '#b8862b', (v) => { d.theme.accent = v; changed({ redraw: !v }); }, true)),
                row(t('design.mode'), seg(d.theme.mode, MODES, (m) => t(`design.mode_${m}`), (m) => { d.theme.mode = m; changed({ redraw: true, commitNow: true }); })),
                row(t('design.radius'), slider(d.theme.radius, 0, 32, 1, (v) => { d.theme.radius = v; changed(); }, (v) => `${v}px`)),
                row(t('design.font'), h('select.select', { disabled: dis, on: { change: (e) => { d.theme.font = e.target.value; changed({ commitNow: true }); } } }, PAGE_FONTS.map((f) => h('option', { value: f, selected: f === d.theme.font, style: f ? { fontFamily: f } : null }, f || t('design.inherit')))))),
            group('background', 'layers', false,
                row(t('design.bg_kind'), seg(bg.kind, BG_KINDS, (k) => t(`design.bg_${k}`), (k) => { bg.kind = k; changed({ redraw: true, commitNow: true }); })),
                bg.kind !== 'image' ? row(t(bg.kind === 'solid' ? 'design.color' : 'design.from'), colorIn(bg.from, '#0f6e56', (v) => { bg.from = v; changed(); })) : null,
                ['gradient', 'animated', 'pattern'].includes(bg.kind) ? row(t('design.to'), colorIn(bg.to, '#0b3b31', (v) => { bg.to = v; changed(); })) : null,
                ['gradient', 'animated', 'pattern'].includes(bg.kind) ? row(t('design.angle'), slider(bg.angle, 0, 360, 5, (v) => { bg.angle = v; changed(); }, (v) => `${v}°`)) : null,
                bg.kind === 'pattern' ? row(t('design.pattern'), seg(bg.pattern, PATTERNS, (p) => t(`design.pattern_${p}`), (p) => { bg.pattern = p; changed({ redraw: true, commitNow: true }); })) : null,
                bg.kind === 'image' ? row(t('design.bg_image'), imagePick(bg.image, (v) => { bg.image = v; changed({ redraw: true, commitNow: true }); })) : null,
                bg.kind === 'image' ? row(t('design.overlay'), slider(bg.overlay, 0, 0.9, 0.05, (v) => { bg.overlay = v; changed(); }, (v) => `${Math.round(v * 100)}%`)) : null),
            group('hero', 'image', false,
                row(t('design.cover'), imagePick(d.hero.cover, (v) => { d.hero.cover = v; changed({ redraw: true, commitNow: true }); })),
                d.hero.cover ? row(t('design.overlay'), slider(d.hero.overlay, 0, 0.9, 0.05, (v) => { d.hero.overlay = v; changed(); }, (v) => `${Math.round(v * 100)}%`)) : null,
                row(t('design.height'), seg(d.hero.height, HERO_HEIGHTS, (x) => t(`design.height_${x}`), (x) => { d.hero.height = x; changed({ redraw: true, commitNow: true }); })),
                row(t('design.align'), seg(d.hero.align, ALIGNS, (x) => t(`design.align_${x}`), (x) => { d.hero.align = x; changed({ redraw: true, commitNow: true }); })),
                row(t('design.title'), text2(d.hero, 'title', 160)), h('small.muted.dz-note', t('design.title_hint')),
                row(t('design.subtitle'), text2(d.hero, 'subtitle', 400, true)),
                h('div.dz-toggles', toggle(d.hero.show_logo, t('design.show_logo'), (v) => { d.hero.show_logo = v; changed({ commitNow: true }); }), toggle(d.hero.parallax, t('design.parallax'), (v) => { d.hero.parallax = v; changed({ commitNow: true }); }))),
            group('sections', 'list', false, h('small.muted.dz-note', t('design.sections_hint')), sectionList(),
                d.sections.find((s) => s.key === 'custom')?.on ? h('div.dz-custom', row(t('design.custom_title'), text2(d.custom, 'title', 120)), row(t('design.custom_body'), text2(d.custom, 'body', 3000, true))) : null,
                d.sections.find((s) => s.key === 'location')?.on ? row(t('design.maps_url'), h('input.input', { value: d.maps_url, dir: 'ltr', placeholder: 'https://maps.app.goo.gl/…', disabled: dis, on: { change: (e) => { d.maps_url = e.target.value.trim(); changed({ commitNow: true }); if (e.target.value && !d.maps_url) toast(t('design.maps_bad'), 'warn'); } } })) : null),
            group('form', 'file-text', false,
                row(t('design.form_style'), seg(d.form.style, FORM_STYLES, (x) => t(`design.form_${x}`), (x) => { d.form.style = x; changed({ redraw: true, commitNow: true }); })),
                row(t('design.button'), h('div.dz-btns', BUTTONS.map((b) => h('button', { type: 'button', class: `dz-btn b-${b} ${d.form.button === b ? 'on' : ''}`, disabled: dis, on: { click: () => { d.form.button = b; changed({ redraw: true, commitNow: true }); } } }, t(`design.button_${b}`))))),
                row(t('design.cta'), text2(d.form, 'cta', 60)),
                row(t('design.success'), text2(d.form, 'success', 300, true)),
                h('div.dz-toggles', toggle(d.form.confetti, t('design.confetti'), (v) => { d.form.confetti = v; changed({ commitNow: true }); }))),
            group('motion', 'activity', false,
                row(t('design.entrance'), seg(d.motion.entrance, ENTRANCES, (x) => t(`design.entrance_${x}`), (x) => { d.motion.entrance = x; changed({ redraw: true, commitNow: true }); })),
                h('div.dz-toggles', toggle(d.motion.hover, t('design.hover'), (v) => { d.motion.hover = v; changed({ commitNow: true }); }), toggle(d.motion.sticky_cta, t('design.sticky'), (v) => { d.motion.sticky_cta = v; changed({ commitNow: true }); })),
                h('button.btn.sm', { type: 'button', on: { click: () => { frame.contentWindow?.scrollTo(0, 0); push(); } } }, icon('eye'), t('design.replay'))));
        [...panel.querySelectorAll('details')].forEach((x, i) => { if (openState.length) x.open = openState[i]; });
        panel.scrollTop = scroll;
    }

    /* ───── المشاركة ───── */
    const link = `${location.origin}/m/r/${eventId}`;
    const live = event.open_registration && ['published', 'running'].includes(event.status);
    const share = h('div.dz-share',
        live ? null : h('div.hint-box.warn', icon('alert'), h('div', !event.open_registration ? t('design.not_open') : t('design.not_published'))),
        h('div.dz-share-row', h('div.mono.dz-link', link),
            h('button.btn.sm', { type: 'button', on: { click: () => copy(link) } }, icon('copy'), t('design.copy_link')),
            h('a.btn.sm', { href: link, target: '_blank', rel: 'noopener' }, icon('link'), t('design.open_page')),
            h('button.btn.sm', { type: 'button', on: { click: () => {
                const blob = new Blob([qrSvg(link, 600)], { type: 'image/svg+xml' });
                const a = h('a', { href: URL.createObjectURL(blob), download: `event-${eventId}-qr.svg` }); document.body.append(a); a.click(); a.remove();
            } } }, icon('qr'), t('design.download_qr'))),
        h('div.dz-qr', qrEl(link, 112), h('small.muted', t('design.qr_hint'))));

    const deviceSeg = h('div.dz-seg.dz-device-seg', ['phone', 'desktop'].map((k) => h('button', { type: 'button', class: k === device ? 'on' : '', 'aria-pressed': String(k === device), on: { click: (e) => {
        device = k; stage.className = `dz-stage ${k}`; [...e.currentTarget.parentNode.children].forEach((b) => { b.classList.toggle('on', b === e.currentTarget); b.setAttribute('aria-pressed', String(b === e.currentTarget)); });
        stage.querySelector('.dz-device').style.height = ''; fit();
    } } }, icon(k === 'phone' ? 'phone' : 'monitor'), t(`design.device_${k}`))));

    root.append(
        h('div.dz-bar.card', h('div.dz-bar-l', h('h2', icon('image'), t('design.title_page')), status), h('div.dz-bar-r', deviceSeg, undoBtn, redoBtn, saveBtn)),
        h('div.dz', panel, h('div.dz-right', h('div.card.dz-preview', stage), h('div.card', h('div.card-b', share)))));
    drawPanel();
    refreshBar();
    return () => { removeEventListener('message', onMsg); removeEventListener('keydown', onKey); removeEventListener('beforeunload', onUnload); ro.disconnect(); clearTimeout(commitTimer); };
}
