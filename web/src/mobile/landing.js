// تنظيم — صفحة الفعالية والتسجيل التفاعلية: تُبنى من تصميم الفعالية (page-design) وتتحدّث حيّاً أثناء التصميم.
// القوالب: غلاف كامل / منقسم / بطاقة / بسيط. الخلفية: لون، تدرج، تدرج متحرك، نقش، صورة.
// عناصر تفاعلية: عدّاد تنازلي حي، شريط المقاعد، ظهور تدريجي عند التمرير، غلاف بحركة parallax، نموذج بخطوات، زر تسجيل ثابت، واحتفال عند النجاح.
import './landing.css';
import { h, icon, clear } from '../core/dom.js';
import { t, getLang, setLang, pick, fmtDate, fmtTime, fmtNum } from '../core/i18n.js';
import { avatar } from '../core/ui.js';
import { normalizeDesign } from '../../../shared/page-design.js';

const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const L = () => getLang();
const tx = (o, base) => (o?.[`${base}_${L()}`] || o?.[`${base}_ar`] || '').trim();

function lum(hex) {
    const n = parseInt(String(hex || '#000000').slice(1), 16);
    const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

/** تطبيق ألوان التصميم وخطه ووضعه على الصفحة (يُستخدم أيضاً في صفحة المشارك). */
export function applyDesignTheme(design, branding = {}) {
    const d = normalizeDesign(design);
    const r = document.documentElement.style;
    r.setProperty('--primary', d.theme.primary || branding.primary || '#0f6e56');
    r.setProperty('--accent', d.theme.accent || branding.accent || '#b8862b');
    r.setProperty('--radius', `${d.theme.radius}px`);
    if (d.theme.font) r.setProperty('--font', `'${d.theme.font}', 'IBM Plex Sans Arabic', Tahoma, system-ui, sans-serif`);
    if (d.theme.mode !== 'auto') document.documentElement.dataset.theme = d.theme.mode;
    return d;
}

function patternImage(kind, light) {
    const w = light ? 'rgba(20,32,28,.09)' : 'rgba(255,255,255,.13)';
    const sc = light ? '#14201c' : 'white';
    if (kind === 'dots') return `radial-gradient(${w} 1.4px, transparent 1.6px)`;
    if (kind === 'grid') return `linear-gradient(${w} 1px, transparent 1px), linear-gradient(90deg, ${w} 1px, transparent 1px)`;
    const svg = kind === 'geo'
        ? `<svg xmlns='http://www.w3.org/2000/svg' width='64' height='64'><g fill='none' stroke='${sc}' stroke-opacity='.16'><path d='M32 6l7 19 19 7-19 7-7 19-7-19-19-7 19-7z'/><rect x='20' y='20' width='24' height='24' transform='rotate(45 32 32)'/></g></svg>`
        : `<svg xmlns='http://www.w3.org/2000/svg' width='120' height='40'><path d='M0 20c20-16 40-16 60 0s40 16 60 0' fill='none' stroke='${sc}' stroke-opacity='.16' stroke-width='2'/></svg>`;
    return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

function backgroundStyle(bg, light) {
    const grad = `linear-gradient(${bg.angle}deg, ${bg.from}, ${bg.to})`;
    switch (bg.kind) {
        case 'solid': return { background: bg.from };
        case 'animated': return { backgroundImage: `linear-gradient(${bg.angle}deg, ${bg.from}, ${bg.to}, ${bg.from}, ${bg.to})`, backgroundSize: '300% 300%' };
        case 'pattern': return { backgroundImage: `${patternImage(bg.pattern, light)}, ${grad}`, backgroundSize: bg.pattern === 'grid' ? '28px 28px, 28px 28px, auto' : bg.pattern === 'dots' ? '18px 18px, auto' : 'auto, auto' };
        case 'image': return bg.image ? { backgroundImage: `linear-gradient(rgba(0,0,0,${bg.overlay}), rgba(0,0,0,${bg.overlay})), url("${bg.image}")`, backgroundSize: 'cover', backgroundPosition: 'center', backgroundAttachment: 'fixed' } : { backgroundImage: grad };
        default: return { backgroundImage: grad };
    }
}

/* ───────── احتفال النجاح ───────── */
function confetti(colors) {
    if (reduced()) return;
    const c = h('canvas.lp-confetti', { 'aria-hidden': 'true' });
    document.body.append(c);
    const ctx = c.getContext('2d');
    const W = (c.width = innerWidth), H = (c.height = innerHeight);
    const ps = Array.from({ length: 160 }, () => ({ x: W / 2 + (Math.random() - 0.5) * W * 0.3, y: H * 0.35, vx: (Math.random() - 0.5) * 14, vy: -Math.random() * 14 - 4, r: Math.random() * 6 + 3, a: Math.random() * 6, c: colors[Math.floor(Math.random() * colors.length)] }));
    const t0 = performance.now();
    (function frame(now) {
        ctx.clearRect(0, 0, W, H);
        for (const p of ps) { p.vy += 0.35; p.x += p.vx; p.y += p.vy; p.a += 0.15; ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.a); ctx.fillStyle = p.c; ctx.fillRect(-p.r / 2, -p.r / 4, p.r, p.r / 2); ctx.restore(); }
        if (now - t0 < 2200) requestAnimationFrame(frame); else c.remove();
    })(t0);
}

/**
 * يرسم الصفحة داخل root ويعيد { update(design) } للمعاينة الحية.
 * data = { event, form, branding, design, extras }, opts = { preview, submit(vals, answers) → { link } }
 */
export function renderLanding(root, data, opts = {}) {
    const vals = {};
    const answers = {};
    let step = 0;
    let pendingErr = null; // خطأ من الخادم يُعرض في الخطوة التي فيها الحقل
    let timers = [];
    let observers = [];
    let onScroll = null;
    let design = normalizeDesign(data.design);
    const ev = data.event;
    const extras = data.extras || { seats: { capacity: 0, registered: 0 }, highlights: [], speakers: [] };
    const fields = (data.form?.fields || []).filter((f) => f.type !== 'photo');

    function cleanup() {
        timers.forEach(clearInterval); timers = [];
        observers.forEach((o) => o.disconnect()); observers = [];
        if (onScroll) removeEventListener('scroll', onScroll), (onScroll = null);
    }

    const seatsLeft = () => (extras.seats.capacity ? Math.max(0, extras.seats.capacity - extras.seats.registered) : Infinity);
    const closed = () => ['ended', 'cancelled'].includes(ev.status) || seatsLeft() === 0;

    /* ───── الأقسام ───── */
    function countdown() {
        const start = new Date(ev.starts_at).getTime(), end = new Date(ev.ends_at).getTime();
        const box = h('div.lp-count');
        const tick = () => {
            const now = Date.now();
            if (now >= end) return clear(box, h('div.lp-count-state', icon('flag'), t('lp.ended')));
            if (now >= start) return clear(box, h('div.lp-count-state.live', h('span.lp-pulse'), t('lp.live_now')));
            let s = Math.floor((start - now) / 1000);
            const parts = [['days', Math.floor(s / 86400)], ['hours', Math.floor((s %= 86400) / 3600)], ['minutes', Math.floor((s %= 3600) / 60)], ['seconds', s % 60]];
            clear(box, parts.map(([k, v]) => h('div.lp-count-cell', h('b', String(v).padStart(2, '0')), h('span', t(`lp.${k}`)))));
        };
        tick();
        timers.push(setInterval(tick, 1000));
        return h('section.lp-sec.lp-r', h('h2.lp-h', icon('clock'), t('lp.starts_in')), box);
    }
    function seats() {
        const { capacity, registered } = extras.seats;
        if (!capacity) return null;
        const pct = Math.min(100, Math.round((registered / capacity) * 100));
        const left = seatsLeft();
        const bar = h('div.lp-bar', h('i', { style: { width: '0%' } }));
        requestAnimationFrame(() => setTimeout(() => { bar.firstChild.style.width = `${pct}%`; }, 150));
        return h('section.lp-sec.lp-r', h('h2.lp-h', icon('users'), t('lp.seats')),
            h('div.lp-seats', h('div', h('b', left === 0 ? t('lp.full') : t('lp.seats_left', { n: fmtNum(left) })), h('span.muted', `${fmtNum(registered)} / ${fmtNum(capacity)}`)), bar,
                pct >= 80 && left > 0 ? h('div.lp-hot', icon('zap'), t('lp.almost_full')) : null));
    }
    function about() {
        const text = ev.description || '';
        return text ? h('section.lp-sec.lp-r', h('h2.lp-h', icon('info'), t('lp.about')), h('p.lp-text', text)) : null;
    }
    function highlights() {
        if (!extras.highlights.length) return null;
        return h('section.lp-sec.lp-r', h('h2.lp-h', icon('star'), t('lp.highlights')),
            h('div.lp-sessions', extras.highlights.map((s) => h('div.lp-session', { class: s.featured ? 'featured' : '' },
                h('div.lp-session-time', h('b', fmtTime(s.starts_at)), h('span', `${t('lp.day')} ${s.day || 1}`)),
                h('div', h('b', pick(s, 'title')), h('div.small.muted', [s.hall, s.track].filter(Boolean).join(' · ')))))));
    }
    function speakers() {
        if (!extras.speakers.length) return null;
        return h('section.lp-sec.lp-r', h('h2.lp-h', icon('award'), t('lp.speakers')),
            h('div.lp-speakers', extras.speakers.map((s) => h('div.lp-speaker', avatar(pick(s, 'name'), null, 56), h('b', pick(s, 'name')), h('span', [s.title, s.org_name].filter(Boolean).join(' · '))))));
    }
    function locationSec() {
        const venue = ev.venue ? pick(ev.venue, 'name') : '';
        const where = [...new Set([ev.location, venue].filter(Boolean))].join(' — ');
        if (!where && !design.maps_url) return null;
        const url = design.maps_url || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(where)}`;
        return h('section.lp-sec.lp-r', h('h2.lp-h', icon('map-pin'), t('lp.location')),
            h('div.lp-loc', h('div', h('b', where || t('lp.location')), h('div.small.muted', `${fmtDate(ev.starts_at)} · ${fmtTime(ev.starts_at)}`)),
                h('a.btn.sm', { href: url, target: '_blank', rel: 'noopener' }, icon('map'), t('lp.open_maps'))));
    }
    function custom() {
        const title = tx(design.custom, 'title'), body = tx(design.custom, 'body');
        return title || body ? h('section.lp-sec.lp-r', title ? h('h2.lp-h', icon('message'), title) : null, body ? h('p.lp-text', body) : null) : null;
    }
    const SECTIONS = { countdown, seats, about, highlights, speakers, location: locationSec, custom };

    /* ───── النموذج ───── */
    const fieldEl = (f) => {
        const label = f[`label_${L()}`] || f.label_ar || f.key;
        const req = f.required ? h('span.req', ' *') : null;
        if (f.type === 'select') return h('div.field', h('label', label, req), h('select.select', { required: !!f.required, on: { change: (e) => { answers[f.key] = e.target.value; } } }, h('option', { value: '' }, '—'), ...(f.options || []).map((o) => h('option', { value: o.value, selected: answers[f.key] === o.value }, o[`label_${L()}`] || o.label_ar))));
        if (f.type === 'radio') return h('div.field', h('label', label, req), h('div.lp-choices', (f.options || []).map((o) => h('label.lp-choice', h('input', { type: 'radio', name: f.key, checked: answers[f.key] === o.value, required: !!f.required, on: { change: () => { answers[f.key] = o.value; } } }), h('span', o[`label_${L()}`] || o.label_ar)))));
        if (f.type === 'checkbox') return h('label.lp-choice.wide', h('input', { type: 'checkbox', checked: !!answers[f.key], required: !!f.required, on: { change: (e) => { answers[f.key] = e.target.checked; } } }), h('span', label, req));
        if (f.type === 'multi') return h('div.field', h('label', label, req), h('div.lp-choices', (f.options || []).map((o) => h('label.lp-choice', h('input', { type: 'checkbox', checked: (answers[f.key] || []).includes(o.value), on: { change: (e) => { const s = new Set(answers[f.key] || []); e.target.checked ? s.add(o.value) : s.delete(o.value); answers[f.key] = [...s]; } } }), h('span', o[`label_${L()}`] || o.label_ar)))));
        if (f.type === 'textarea') return h('div.field', h('label', label, req), h('textarea.textarea', { rows: 3, required: !!f.required, on: { input: (e) => { answers[f.key] = e.target.value; } } }, answers[f.key] || ''));
        return h('div.field', h('label', label, req), h('input.input', { type: { email: 'email', phone: 'tel', number: 'number', date: 'date' }[f.type] || 'text', value: answers[f.key] ?? '', required: !!f.required, pattern: f.pattern && !['email', 'phone', 'number', 'date'].includes(f.type) ? f.pattern : null, title: f.pattern ? t('errors.pattern') : null, min: f.min, max: f.max, dir: ['email', 'phone'].includes(f.type) ? 'ltr' : null, on: { input: (e) => { answers[f.key] = e.target.value; } } }));
    };
    const basic = (k, type, req) => h('div.field', h('label', t(`f.${k}`), req ? h('span.req', ' *') : null), h('input.input', { type, value: vals[k] || '', required: req, autocomplete: { name_ar: 'name', phone: 'tel', email: 'email', org_name: 'organization' }[k] || 'off', dir: ['tel', 'email'].includes(type) ? 'ltr' : null, on: { input: (e) => { vals[k] = e.target.value; } } }));
    const basicFields = () => [basic('name_ar', 'text', true), basic('name_en', 'text', false), basic('phone', 'tel', true), basic('email', 'email', false), basic('org_name', 'text', false)];

    function formCard() {
        const cta = tx(design.form, 'cta') || t('lp.register_now');
        const err = h('div', { role: 'alert' });
        if (pendingErr) { err.append(pendingErr); pendingErr = null; }
        const card = h('section.lp-form.lp-r#lp-form');
        if (closed()) return clear(card, h('div.lp-closed', icon('lock'), h('b', seatsLeft() === 0 ? t('lp.full') : t('lp.closed')), h('span.muted', t('lp.closed_hint'))));
        const steps = design.form.style === 'steps'
            ? [{ k: 'basic', body: basicFields }, ...(fields.length ? [{ k: 'details', body: () => fields.map(fieldEl) }] : []), { k: 'review', body: review }]
            : [{ k: 'all', body: () => [...basicFields(), ...fields.map(fieldEl)] }];
        step = Math.min(step, steps.length - 1);
        const last = step === steps.length - 1;
        const form = h('form.lp-form-body', { novalidate: false, on: { submit: async (e) => {
            e.preventDefault();
            if (!e.target.reportValidity()) return;
            if (!last) { step++; draw(); return; }
            const btn = e.target.querySelector('button[type=submit]');
            btn.disabled = true;
            try {
                const r = opts.preview ? { link: null } : await opts.submit(vals, answers);
                success(r.link);
            } catch (ex) {
                btn.disabled = false;
                const box = h('div.hint-box.bad', icon('alert'), ex.errors?.length ? ex.errors.map((x) => `${fields.find((f) => f.key === x.field)?.[`label_${L()}`] || t(`f.${x.field}`)}: ${t(`errors.${x.code}`)}`).join(' — ') : opts.errText ? opts.errText(ex) : ex.message);
                // نموذج بخطوات: العودة للخطوة التي فيها الحقل المرفوض
                const bad = ex.errors?.[0]?.field;
                const target = bad ? steps.findIndex((st) => (st.k === 'details' ? fields.some((f) => f.key === bad) : st.k === 'basic' && !fields.some((f) => f.key === bad))) : -1;
                if (steps.length > 1 && target >= 0 && target !== step) { step = target; pendingErr = box; draw(); root.querySelector('#lp-form')?.scrollIntoView({ block: 'start' }); return; }
                err.replaceChildren(box);
            }
        } } },
            steps[step].body(), err,
            h('div.lp-form-actions',
                step > 0 ? h('button.btn', { type: 'button', on: { click: () => { step--; draw(); } } }, t('lp.back')) : null,
                h('button.btn.primary.lg.lp-cta', { type: 'submit' }, last ? cta : t('lp.next'), last ? icon('check-circle') : icon(document.dir === 'rtl' ? 'chevron-left' : 'chevron-right'))));
        clear(card, h('div.lp-form-head', h('h2', cta), h('p.muted', `${fmtDate(ev.starts_at)} · ${fmtTime(ev.starts_at)}`)),
            steps.length > 1 ? h('div.lp-steps', { role: 'list' }, steps.map((s, i) => h('div.lp-step', { role: 'listitem', class: i < step ? 'done' : i === step ? 'on' : '', 'aria-current': i === step ? 'step' : null }, h('span', i < step ? '✓' : String(i + 1)), h('em', t(`lp.step_${s.k}`))))) : null,
            steps.length > 1 ? h('div.lp-bar.thin', h('i', { style: { width: `${((step + 1) / steps.length) * 100}%` } })) : null,
            form, opts.preview ? h('div.lp-preview-note', icon('eye'), t('lp.preview_note')) : null);
        return card;
    }
    function review() {
        const rows = [['name_ar', vals.name_ar], ['name_en', vals.name_en], ['phone', vals.phone], ['email', vals.email], ['org_name', vals.org_name]].filter(([, v]) => v)
            .map(([k, v]) => [t(`f.${k}`), v])
            .concat(fields.filter((f) => answers[f.key] != null && answers[f.key] !== '').map((f) => [f[`label_${L()}`] || f.key, Array.isArray(answers[f.key]) ? answers[f.key].join(' · ') : answers[f.key] === true ? '✓' : String(answers[f.key])]));
        return [h('p.muted', t('lp.review_hint')), h('dl.lp-review', rows.flatMap(([k, v]) => [h('dt', k), h('dd', v)]))];
    }
    function success(link) {
        const card = root.querySelector('#lp-form');
        const msg = tx(design.form, 'success') || t('lp.success_default');
        clear(card, h('div.lp-success', h('div.lp-success-ico', icon('check-circle')), h('h2', t('lp.success_title')), h('p', msg), link ? h('a.btn.primary.lg', { href: link }, icon('qr'), t('lp.open_pass')) : null));
        card.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'center' });
        if (design.form.confetti) confetti([getComputedStyle(document.documentElement).getPropertyValue('--primary').trim() || '#0f6e56', getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#b8862b', '#ffffff', '#fbbf24']);
        if (link) setTimeout(() => { location.href = link; }, 2600);
    }

    /* ───── التجميع ───── */
    function hero() {
        const d = design.hero;
        const title = tx(d, 'title') || pick(ev, 'title');
        const sub = tx(d, 'subtitle') || ev.audience || '';
        const logo = d.show_logo && data.branding?.logo ? h('img.lp-logo', { src: data.branding.logo, alt: pick(data.branding, 'name') || '' }) : null;
        const cover = h('div.lp-hero-bg', d.cover ? { style: { backgroundImage: `linear-gradient(rgba(0,0,0,${d.overlay}), rgba(0,0,0,${d.overlay})), url("${d.cover}")` } } : {});
        const el = h(`header.lp-hero.h-${d.height}.a-${d.align}`, { class: d.cover ? 'has-cover' : '' }, cover,
            h('div.lp-hero-in', logo, h('div.lp-chip', icon('calendar'), `${fmtDate(ev.starts_at)} · ${fmtTime(ev.starts_at)}`),
                h('h1.lp-title', title), sub ? h('p.lp-sub', sub) : null,
                ev.location ? h('div.lp-chip.soft', icon('map-pin'), ev.location) : null,
                closed() ? null : h('a.btn.primary.lg.lp-cta.lp-hero-cta', { href: '#lp-form', on: { click: (e) => { e.preventDefault(); root.querySelector('#lp-form')?.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth' }); } } }, tx(design.form, 'cta') || t('lp.register_now'))));
        if (d.parallax && d.cover && !reduced()) {
            onScroll = () => { cover.style.transform = `translateY(${Math.min(scrollY * 0.35, 300)}px) scale(1.08)`; };
            addEventListener('scroll', onScroll, { passive: true });
        }
        return el;
    }

    function draw() {
        cleanup();
        applyDesignTheme(design, data.branding);
        const bg = design.background;
        const light = bg.kind !== 'image' && lum(bg.from) > 0.45 && lum(bg.to) > 0.45;
        const secs = design.sections.filter((s) => s.on).map((s) => SECTIONS[s.key]()).filter(Boolean);
        const topbar = h('div.lp-top', h('a.lp-top-home', { href: '/m', 'aria-label': t('common.back') }, icon('home')),
            h('button.lp-lang', { type: 'button', on: { click: () => { setLang(L() === 'ar' ? 'en' : 'ar'); draw(); } } }, t('common.other_lang')));
        const info = h('div.lp-info', hero(), h('div.lp-sections', secs));
        const formEl = formCard();
        const body = design.layout === 'split' ? h('div.lp-split', info, h('aside.lp-side', formEl))
            : design.layout === 'card' ? h('div.lp-cardwrap', h('div.lp-card', info, formEl))
            : h('div.lp-stack', info, formEl);
        const sticky = design.motion.sticky_cta && !closed() ? h('a.btn.primary.lg.lp-cta.lp-sticky', { href: '#lp-form', on: { click: (e) => { e.preventDefault(); root.querySelector('#lp-form')?.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth' }); } } }, tx(design.form, 'cta') || t('lp.register_now')) : null;
        const page = h('div.lp', {
            class: [`lay-${design.layout}`, `bg-${bg.kind}`, `in-${design.motion.entrance}`, `btn-${design.form.button}`, design.motion.hover ? 'hover' : '', light ? 'on-light' : 'on-dark'].join(' '),
            style: backgroundStyle(bg, light), dir: L() === 'ar' ? 'rtl' : 'ltr',
        }, topbar, body, sticky);
        clear(root, page);
        // ظهور تدريجي عند التمرير
        const els = [...page.querySelectorAll('.lp-r')];
        if (design.motion.entrance === 'none' || reduced() || !('IntersectionObserver' in window)) els.forEach((e) => e.classList.add('in'));
        else {
            const io = new IntersectionObserver((es) => es.forEach((x) => { if (x.isIntersecting) { x.target.classList.add('in'); io.unobserve(x.target); } }), { threshold: 0.12 });
            els.forEach((e, i) => { e.style.transitionDelay = `${Math.min(i, 6) * 60}ms`; io.observe(e); });
            observers.push(io);
        }
        // الزر الثابت يختفي حين يظهر النموذج
        if (sticky && 'IntersectionObserver' in window) {
            const seen = new Set();
            const io2 = new IntersectionObserver((es) => { es.forEach((x) => (x.isIntersecting ? seen.add(x.target) : seen.delete(x.target))); sticky.classList.toggle('hide', seen.size > 0); }, { threshold: 0.05 });
            [formEl, page.querySelector('.lp-hero-cta')].filter(Boolean).forEach((e) => io2.observe(e)); observers.push(io2);
        }
    }

    draw();
    return { update(next) { design = normalizeDesign(next); draw(); }, destroy: cleanup };
}
