// تنظيم — تطبيق الجوال (PWA) بوضعين:
//  • المشارك: الدعوات وتأكيدها، بطاقة QR (تعمل دون اتصال)، الجدول، الإشعارات والتذكيرات، خريطة الفعالية، والتعارف الذكي.
//  • المنظم: الفعاليات المسندة، مسح QR بالكاميرا، أعداد لحظية، وإرسال تنبيه للمشاركين.
import '../core/style.css';
import './mobile.css';
import { h, icon, clear, readFileAsDataUrl } from '../core/dom.js';
import { t, setLang, getLang, pick, fmtDate, fmtTime, fmtNum, fmtAgo, opt } from '../core/i18n.js';
import { api, post } from '../core/api.js';
import { loadBranding, applyBranding } from '../core/theme.js';
import { connect } from '../core/ws.js';
import { qrEl } from '../core/qr.js';
import { startScanner } from '../core/scanner.js';
import { toast, errText, beep, loading, errorState, empty, avatar, badge } from '../core/ui.js';
import { densityColor } from '../core/charts.js';

const root = document.getElementById('root');
const path = location.pathname.replace(/\/+$/, '');
let branding = {};
const store = { get: (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } }, set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } } };

async function boot() {
    branding = await loadBranding();
    let m;
    if ((m = path.match(/^\/m\/i\/([\w-]+)$/))) return participant(m[1]);
    if ((m = path.match(/^\/m\/p\/(TZ1\.[\w.-]+)$/))) return permit(decodeURIComponent(m[1]));
    if ((m = path.match(/^\/m\/r\/(\d+)$/))) return openRegistration(Number(m[1]));
    if (path === '/m/o' || path.startsWith('/m/o/')) return organizer();
    return home();
}
const top = (title, back) => h('header.m-top', back ? h('a.m-back', { href: back, 'aria-label': t('common.back') }, icon(document.dir === 'rtl' ? 'chevron-right' : 'chevron-left')) : h('div.m-logo', branding.logo ? h('img', { src: branding.logo, alt: '' }) : icon('layers')), h('div.m-title', title || pick(branding, 'name')),
    h('button.m-lang', { type: 'button', on: { click: () => { setLang(getLang() === 'ar' ? 'en' : 'ar'); boot(); } } }, t('common.other_lang')));

function home() {
    const saved = store.get('tz_my_invites', []);
    clear(root, h('div.m-app', top(), h('main.m-main',
        h('div.m-hero', h('h1', pick(branding, 'name')), h('p', pick(branding, 'tagline'))),
        saved.length ? h('section', h('h2.m-h', t('m.my_events')), saved.map((s) => h('a.m-card.m-link', { href: `/m/i/${s.token}` }, h('div', h('b', s.title), h('div.small.muted', fmtDate(s.starts_at))), icon('chevron-left')))) : null,
        h('section', { style: { display: 'grid', gap: '12px' } },
            h('a.m-card.m-link', { href: '/m/o' }, h('div.kpi-ico', icon('scan')), h('div', { style: { flex: 1 } }, h('b', t('m.organizer')), h('div.small.muted', t('m.organizer_sub')))),
            h('div.m-card', h('div', { style: { flex: 1 } }, h('b', t('m.participant')), h('div.small.muted', { style: { marginBottom: '10px' } }, t('m.participant_sub')),
                h('form', { style: { display: 'flex', gap: '8px' }, on: { submit: (e) => { e.preventDefault(); const v = e.target.elements.code.value.trim(); const m = v.match(/\/m\/i\/([\w-]+)/); location.href = `/m/i/${m ? m[1] : v}`; } } }, h('input.input', { name: 'code', placeholder: t('m.paste_link'), dir: 'ltr' }), h('button.btn.primary', { type: 'submit' }, t('m.open')))))))));
}

/* ───────── المشارك ───────── */
async function participant(token) {
    clear(root, h('div.m-app', top(), h('main.m-main', loading())));
    let data;
    try { data = await api(`/api/public/inv/${token}`); } catch (e) { return clear(root, h('div.m-app', top(null, '/m'), h('main.m-main', errorState(e)))); }
    applyBranding(data.branding);
    branding = data.branding;
    const ev = data.event;
    const saved = store.get('tz_my_invites', []).filter((x) => x.token !== token);
    store.set('tz_my_invites', [{ token, title: pick(ev, 'title'), starts_at: ev.starts_at }, ...saved].slice(0, 10));
    if (data.qr) store.set(`tz_qr_${token}`, data.qr);
    const tabs = [['invite', 'mail'], ['qr', 'qr'], ['schedule', 'calendar'], ['map', 'map'], ['alerts', 'bell'], ['network', 'share']];
    let tab = data.status === 'confirmed' ? 'qr' : 'invite';
    const body = h('main.m-main');
    const nav = h('nav.m-tabs');
    clear(root, h('div.m-app', top(pick(ev, 'title'), '/m'), body, nav));
    const ws = connect({ query: `inv=${encodeURIComponent(token)}` });
    ws.sub(`announce:${ev.id}`);
    ws.on('announcement', (n) => { toast(n.params.message, n.priority === 'critical' ? 'bad' : '', 8000); if ('Notification' in window && Notification.permission === 'granted') new Notification(pick(ev, 'title'), { body: n.params.message }); if (tab === 'alerts') draw(); });
    function draw() {
        nav.replaceChildren(...tabs.map(([k, ic]) => h('button', { type: 'button', class: k === tab ? 'on' : '', 'aria-label': t(`m.tab_${k}`), on: { click: () => { tab = k; draw(); } } }, icon(ic), h('span', t(`m.tab_${k}`)))));
        ({ invite, qr: myQr, schedule, map, alerts, network })[tab]();
    }
    function invite() {
        const statusBox = { pending: 'info', sent: 'info', confirmed: 'ok', declined: 'warn', cancelled: 'bad', expired: 'bad' }[data.status];
        const answers = {};
        let photo = null;
        const formEl = data.form && ['sent', 'pending', 'declined', 'failed'].includes(data.status) ? h('div', { style: { display: 'grid', gap: '12px', marginTop: '12px' } }, data.form.fields.map((f) => {
            const L = getLang(), label = f[`label_${L}`] || f.key;
            const wrap = h('div.field', { 'data-key': f.key }, h('label', label, f.required ? h('span.req', ' *') : null));
            if (['select'].includes(f.type)) wrap.append(h('select.select', { on: { change: (e) => { answers[f.key] = e.target.value; cond(); } } }, h('option', { value: '' }, '—'), (f.options || []).map((o) => h('option', { value: o.value }, o[`label_${L}`]))));
            else if (f.type === 'radio') wrap.append(h('div', { style: { display: 'flex', gap: '14px', flexWrap: 'wrap' } }, (f.options || []).map((o) => h('label.check', h('input', { type: 'radio', name: f.key, on: { change: () => { answers[f.key] = o.value; cond(); } } }), o[`label_${L}`]))));
            else if (f.type === 'multi') wrap.append(h('div', { style: { display: 'flex', gap: '12px', flexWrap: 'wrap' } }, (f.options || []).map((o) => h('label.check', h('input', { type: 'checkbox', on: { change: (e) => { const s = new Set(answers[f.key] || []); e.target.checked ? s.add(o.value) : s.delete(o.value); answers[f.key] = [...s]; } } }), o[`label_${L}`]))));
            else if (f.type === 'checkbox') return h('label.check', { 'data-key': f.key }, h('input', { type: 'checkbox', on: { change: (e) => { answers[f.key] = e.target.checked; cond(); } } }), label, f.required ? h('span.req', { style: { color: 'var(--bad)' } }, ' *') : null);
            else if (f.type === 'photo') wrap.append(h('input', { type: 'file', accept: 'image/*', capture: 'user', on: { change: async (e) => { photo = await readFileAsDataUrl(e.target.files[0], 600); answers[f.key] = photo; } } }));
            else if (f.type === 'textarea') wrap.append(h('textarea.textarea', { on: { input: (e) => { answers[f.key] = e.target.value; } } }));
            else wrap.append(h('input.input', { type: { email: 'email', phone: 'tel', number: 'number', date: 'date' }[f.type] || 'text', dir: ['email', 'phone', 'national_id'].includes(f.type) ? 'ltr' : null, placeholder: f[`placeholder_${L}`] || '', on: { input: (e) => { answers[f.key] = e.target.value; } } }));
            return wrap;
        })) : null;
        const cond = () => formEl?.querySelectorAll('[data-key]').forEach((el) => { const f = data.form.fields.find((x) => x.key === el.dataset.key); el.style.display = !f.show_if || String(answers[f.show_if.field] ?? '') === String(f.show_if.equals) ? '' : 'none'; });
        cond();
        const err = h('div', { role: 'alert' });
        const respond = async (response) => {
            try { await post(`/api/public/inv/${token}/respond`, { response, answers }); toast(response === 'decline' ? t('m.declined') : t('m.confirmed'), 'ok'); participant(token); }
            catch (e) { err.replaceChildren(h('div.hint-box.bad', icon('alert'), e.errors?.length ? e.errors.map((x) => `${data.form?.fields.find((f) => f.key === x.field)?.[`label_${getLang()}`] || x.field}: ${t(`errors.${x.code}`)}`).join(' — ') : errText(e))); }
        };
        clear(body, h('div.m-card.m-col', h('div.small.muted', t('m.dear', { name: pick(data.visitor, 'name') })), h('h2', pick(ev, 'title')),
            h('div.m-meta', h('div', icon('calendar'), fmtDate(ev.starts_at, { weekday: true })), h('div', icon('clock'), `${fmtTime(ev.starts_at)} — ${fmtTime(ev.ends_at)}`), ev.location ? h('div', icon('map-pin'), ev.location) : null),
            ev.description ? h('p.muted', ev.description) : null,
            h(`div.hint-box.${statusBox}`, icon('info'), t(`m.status_${data.status}`)),
            formEl, err,
            ['sent', 'pending', 'declined', 'failed'].includes(data.status) ? h('div', { style: { display: 'grid', gap: '10px' } }, h('button.btn.primary.lg', { type: 'button', on: { click: () => respond('confirm') } }, icon('check'), t('m.confirm'))) : null,
            data.status === 'confirmed' ? h('div', { style: { display: 'grid', gap: '10px' } }, h('button.btn.primary.lg', { type: 'button', on: { click: () => { tab = 'qr'; draw(); } } }, icon('qr'), t('m.show_qr')), h('a.btn', { href: `/api/public/inv/${token}/calendar.ics` }, icon('calendar'), t('m.add_calendar')), h('button.btn.ghost.danger', { type: 'button', on: { click: () => respond('decline') } }, t('m.decline'))) : null,
            ['sent', 'pending'].includes(data.status) ? h('button.btn.ghost', { type: 'button', on: { click: () => respond('decline') } }, t('m.decline')) : null));
    }
    function myQr() {
        const code = data.qr || store.get(`tz_qr_${token}`, null);
        if (!code) return clear(body, h('div.m-card.m-col', empty(t('m.no_qr'), t('m.no_qr_hint'), h('button.btn.primary', { type: 'button', on: { click: () => { tab = 'invite'; draw(); } } }, t('m.confirm')))));
        clear(body, h('div.m-pass', h('div.m-pass-head', h('div.m-logo', branding.logo ? h('img', { src: branding.logo, alt: '' }) : icon('layers')), h('div', h('b', pick(branding, 'name')), h('div.small', pick(ev, 'title')))),
            h('div.m-pass-body', h('div', { style: { fontSize: '20px', fontWeight: 700 } }, pick(data.visitor, 'name')), h('div.muted', data.visitor.org_name || ''), h('span.chip', opt('category', data.visitor.category)),
                h('div', { style: { margin: '16px 0' } }, qrEl(code, 230)), data.inside ? h('span.badge.ok', t('common.inside')) : h('div.small.muted', t('m.qr_hint')),
                h('div.small.muted', `${fmtDate(ev.starts_at)} · ${fmtTime(ev.starts_at)}`))),
        h('p.small.muted', { style: { textAlign: 'center', marginTop: '14px' } }, t('m.wallet_hint')));
    }
    async function schedule() {
        clear(body, loading());
        try {
            const s = await api(`/api/public/inv/${token}/schedule`);
            const sp = new Map(s.speakers.map((x) => [x.id, x]));
            const days = [...new Set(s.sessions.map((x) => x.day))];
            clear(body, s.sessions.length ? h('div', days.map((d) => h('section', h('h2.m-h', t('sched.day_n', { n: fmtNum(d) })), s.sessions.filter((x) => x.day === d).map((x) => h('div.m-card', { style: { borderInlineStart: x.featured ? '4px solid var(--accent)' : '' } },
                h('div', { style: { width: '62px', flex: 'none', fontWeight: 700 } }, fmtTime(x.starts_at)),
                h('div', { style: { flex: 1 } }, h('b', pick(x, 'title')), h('div.small.muted', [x.hall, x.track].filter(Boolean).join(' · ')), x.speaker_ids.length ? h('div.small', x.speaker_ids.map((i) => pick(sp.get(i), 'name')).filter(Boolean).join(t('common.sep'))) : null)))))) : empty(t('sched.empty')));
        } catch (e) { clear(body, errorState(e)); }
    }
    async function map() {
        clear(body, loading());
        try {
            const m = await api(`/api/public/inv/${token}/map`);
            if (!m.venue) return clear(body, empty(t('map.no_venue')));
            const NS = 'http://www.w3.org/2000/svg';
            const svg = document.createElementNS(NS, 'svg');
            svg.setAttribute('viewBox', `0 0 ${m.venue.map_w} ${m.venue.map_h}`);
            if (m.venue.map_bg) { const img = document.createElementNS(NS, 'image'); img.setAttribute('href', m.venue.map_bg); img.setAttribute('width', m.venue.map_w); img.setAttribute('height', m.venue.map_h); svg.append(img); }
            for (const z of m.zones) {
                const r = document.createElementNS(NS, 'rect');
                Object.entries({ x: z.x, y: z.y, width: z.w, height: z.h, rx: 10, fill: 'var(--primary)', 'fill-opacity': 0.15, stroke: 'var(--primary)', 'stroke-width': 2 }).forEach(([k, v]) => r.setAttribute(k, v));
                const tx = document.createElementNS(NS, 'text');
                Object.entries({ x: z.x + z.w / 2, y: z.y + z.h / 2 + 6, 'text-anchor': 'middle', 'font-size': Math.max(14, Math.min(26, z.w / 8)), fill: 'var(--text)', 'font-weight': 600 }).forEach(([k, v]) => tx.setAttribute(k, v));
                tx.textContent = pick(z, 'name');
                svg.append(r, tx);
            }
            clear(body, h('div.m-card.m-col', h('h2', pick(m.venue, 'name')), h('div.map-wrap', svg), h('div', m.zones.map((z) => h('span.chip', { style: { margin: '3px' } }, pick(z, 'name'))))));
        } catch (e) { clear(body, errorState(e)); }
        void densityColor;
    }
    async function alerts() {
        clear(body, loading());
        try {
            const r = await api(`/api/public/inv/${token}/announcements`);
            clear(body, h('div', 'Notification' in window && Notification.permission === 'default' ? h('button.btn', { type: 'button', style: { marginBottom: '12px', width: '100%' }, on: { click: () => Notification.requestPermission().then(draw) } }, icon('bell'), t('m.enable_notifications')) : null,
                r.rows.length ? r.rows.map((n) => h('div.m-card', h('span.dot', { class: `dot ${n.priority === 'critical' ? 'bad' : n.priority === 'high' ? 'warn' : 'info'}`, style: { marginTop: '8px' } }), h('div', { style: { flex: 1 } }, h('div', n.params.message), h('div.small.faint', fmtAgo(n.created_at))))) : empty(t('m.no_alerts'))));
        } catch (e) { clear(body, errorState(e)); }
    }
    async function network() {
        if (data.status !== 'confirmed') return clear(body, empty(t('m.confirm_first')));
        clear(body, loading());
        try {
            const r = await api(`/api/public/inv/${token}/recommendations`);
            const ints = h('input.input', { placeholder: t('m.interests_hint') });
            clear(body, h('div', h('div.m-card.m-col', h('b', t('m.my_interests')), h('div', { style: { display: 'flex', gap: '8px' } }, ints, h('button.btn', { type: 'button', on: { click: async () => { await api(`/api/public/inv/${token}/interests`, { method: 'PUT', body: { interests: ints.value } }); toast(t('common.saved'), 'ok'); network(); } } }, t('common.save')))),
                h('h2.m-h', icon('sparkles'), ' ', t('net.recommendations')),
                r.rows.length ? r.rows.map((x) => h('div.m-card', avatar(pick(x.person, 'name')), h('div', { style: { flex: 1 } }, h('b', pick(x.person, 'name')), h('div.small.muted', x.person.org_name || ''), h('div', x.shared.map((s) => h('span.chip', { style: { margin: '2px' } }, s)))),
                    h('button.btn.sm.primary', { type: 'button', on: { click: async (e) => { await post(`/api/public/inv/${token}/connect`, { visitor_id: x.person.id }); e.target.closest('.m-card').remove(); toast(t('net.connected'), 'ok'); } } }, t('net.connect')))) : empty(t('net.no_reco'), t('m.add_interests'))));
        } catch (e) { clear(body, errorState(e)); }
    }
    draw();
}

/* تصريح/بطاقة QR عامة (من رابط في رسالة) */
async function permit(token) {
    clear(root, h('div.m-app', top(), h('main.m-main', loading())));
    try {
        const r = await api(`/api/public/permit/${encodeURIComponent(token)}`);
        applyBranding(r.branding);
        const title = r.visit ? r.visit.title : pick(r.event, 'title');
        const when = r.visit || r.event;
        clear(root, h('div.m-app', top(t('m.permit')), h('main.m-main', h('div.m-pass', h('div.m-pass-head', h('div', h('b', pick(r.branding, 'name')), h('div.small', title))),
            h('div.m-pass-body', h('div', { style: { fontSize: '20px', fontWeight: 700 } }, pick(r.visitor, 'name')), h('div.muted', r.visitor.org_name || ''),
                r.ok ? h('div', { style: { margin: '16px 0' } }, qrEl(r.qr, 230)) : h('div.hint-box.bad', { style: { margin: '16px 0' } }, icon('alert'), t(`scan.${r.code}`)),
                h('div.small.muted', `${fmtDate(when.starts_at)} · ${fmtTime(when.starts_at)}`), r.visit?.location ? h('div.small.muted', r.visit.location) : null, r.visit?.host_name ? h('div.small.muted', `${t('f.host_name')}: ${r.visit.host_name}`) : null)))));
    } catch (e) { clear(root, h('div.m-app', top(), h('main.m-main', errorState(e)))); }
}

/* التسجيل المفتوح */
async function openRegistration(eventId) {
    clear(root, h('div.m-app', top(), h('main.m-main', loading())));
    let d;
    try { d = await api(`/api/public/events/${eventId}/register`); } catch (e) { return clear(root, h('div.m-app', top(null, '/m'), h('main.m-main', errorState(e)))); }
    applyBranding(d.branding);
    const vals = {};
    const answers = {};
    const L = getLang();
    const inp = (k, type, req) => h('div.field', h('label', t(`f.${k}`), req ? h('span.req', ' *') : null), h('input.input', { type, required: req, dir: ['tel', 'email'].includes(type) ? 'ltr' : null, on: { input: (e) => { vals[k] = e.target.value; } } }));
    const err = h('div', { role: 'alert' });
    clear(root, h('div.m-app', top(pick(d.event, 'title'), '/m'), h('main.m-main', h('form.m-card.m-col', { on: { submit: async (e) => {
        e.preventDefault();
        try { const r = await post(`/api/public/events/${eventId}/register`, { ...vals, answers }); location.href = r.link; }
        catch (ex) { err.replaceChildren(h('div.hint-box.bad', icon('alert'), ex.errors?.length ? ex.errors.map((x) => `${t(`f.${x.field}`) === `f.${x.field}` ? d.form.fields.find((f) => f.key === x.field)?.[`label_${L}`] || x.field : t(`f.${x.field}`)}: ${t(`errors.${x.code}`)}`).join(' — ') : errText(ex))); }
    } } }, h('h2', t('m.register_title')), h('div.m-meta', h('div', icon('calendar'), `${fmtDate(d.event.starts_at)} · ${fmtTime(d.event.starts_at)}`), d.event.location ? h('div', icon('map-pin'), d.event.location) : null),
    inp('name_ar', 'text', true), inp('name_en', 'text', false), inp('phone', 'tel', true), inp('email', 'email', false), inp('org_name', 'text', false),
    d.form.fields.filter((f) => !['photo'].includes(f.type)).map((f) => {
        const label = f[`label_${L}`] || f.key;
        if (['select'].includes(f.type)) return h('div.field', h('label', label), h('select.select', { on: { change: (e) => { answers[f.key] = e.target.value; } } }, h('option', { value: '' }, '—'), (f.options || []).map((o) => h('option', { value: o.value }, o[`label_${L}`]))));
        if (f.type === 'radio') return h('div.field', h('label', label), h('div', { style: { display: 'flex', gap: '12px', flexWrap: 'wrap' } }, (f.options || []).map((o) => h('label.check', h('input', { type: 'radio', name: f.key, on: { change: () => { answers[f.key] = o.value; } } }), o[`label_${L}`]))));
        if (f.type === 'checkbox') return h('label.check', h('input', { type: 'checkbox', on: { change: (e) => { answers[f.key] = e.target.checked; } } }), label);
        if (f.type === 'multi') return h('div.field', h('label', label), h('div', { style: { display: 'flex', gap: '12px', flexWrap: 'wrap' } }, (f.options || []).map((o) => h('label.check', h('input', { type: 'checkbox', on: { change: (e) => { const s = new Set(answers[f.key] || []); e.target.checked ? s.add(o.value) : s.delete(o.value); answers[f.key] = [...s]; } } }), o[`label_${L}`]))));
        return h('div.field', h('label', label, f.required ? h('span.req', ' *') : null), h('input.input', { type: { email: 'email', phone: 'tel', number: 'number', date: 'date' }[f.type] || 'text', on: { input: (e) => { answers[f.key] = e.target.value; } } }));
    }), err, h('button.btn.primary.lg', { type: 'submit' }, t('m.register'))))));
}

/* ───────── المنظم ───────── */
async function organizer() {
    let me;
    try { me = await api('me'); } catch { location.replace(`/login?next=${encodeURIComponent('/m/o')}`); return; }
    if (me.mfa) { location.replace(`/login?mfa=${me.mfa}&next=/m/o`); return; }
    const evId = Number(path.split('/')[3]) || null;
    if (!evId) {
        const r = await api('events', { query: { size: 100, sort: 'starts_at', dir: 'desc', f_archived: 0 } });
        const mine = r.rows.filter((e) => ['published', 'running'].includes(e.status));
        clear(root, h('div.m-app', top(t('m.organizer'), '/m'), h('main.m-main', h('h2.m-h', t('m.assigned')), mine.length ? mine.map((e) => h('a.m-card.m-link', { href: `/m/o/${e.id}` }, h('div', { style: { flex: 1 } }, h('b', pick(e, 'title')), h('div.small.muted', `${fmtDate(e.starts_at)} · ${fmtTime(e.starts_at)}`), h('div.small', `${t('common.inside')}: ${fmtNum(e.inside)} · ${t('event.registered')}: ${fmtNum(e.registered)}`)), badge('status', e.status))) : empty(t('m.no_assigned')))));
        return;
    }
    const ev = await api(`events/${evId}`);
    const stats = h('div.m-stats');
    const res = h('div', { 'aria-live': 'assertive' });
    const cam = h('div.m-cam');
    let dir = 'auto', stop = null, busy = false;
    const drawStats = (s) => stats.replaceChildren(...[['users', s.inside, t('common.inside')], ['log-in', s.entries, t('common.entries')], ['log-out', s.exits, t('common.exits')]].map(([ic, v, l]) => h('div.m-stat', icon(ic), h('b', fmtNum(v)), h('span', l))));
    drawStats(await api('attendance/stats', { query: { subject_id: evId } }));
    const dirBtns = h('div.btn-group', { style: { width: '100%' } });
    const drawDir = () => dirBtns.replaceChildren(...['auto', 'in', 'out'].map((k) => h('button', { type: 'button', style: { flex: 1 }, class: dir === k ? 'on' : '', on: { click: () => { dir = k; drawDir(); } } }, t(`ci.dir_${k}`))));
    drawDir();
    const scan = async (raw) => {
        if (busy) return;
        busy = true;
        const m = raw.match(/\/m\/p\/(TZ1\.[^/?#\s]+)/);
        try {
            const r = await post('attendance/scan', { token: m ? decodeURIComponent(m[1]) : raw, subject_id: evId, direction: dir, method: 'mobile' });
            beep(r.ok);
            if (navigator.vibrate) navigator.vibrate(r.ok ? 80 : [80, 60, 80]);
            res.replaceChildren(h('div.m-card', { style: { borderInlineStart: `6px solid var(--${r.ok ? 'ok' : 'bad'})` } }, h('div', { style: { flex: 1 } }, h('b', { style: { color: `var(--${r.ok ? 'ok' : 'bad'})` } }, t(`scan.${r.code}`)), r.visitor ? h('div', pick(r.visitor, 'name')) : null, r.visitor?.org_name ? h('div.small.muted', r.visitor.org_name) : null)));
            if (r.stats) drawStats(r.stats);
        } catch (e) { toast(errText(e), 'bad'); }
        setTimeout(() => { busy = false; }, 1200);
    };
    const msg = h('textarea.textarea', { rows: 3, placeholder: t('notif.message') });
    clear(root, h('div.m-app', top(pick(ev, 'title'), '/m/o'), h('main.m-main', stats,
        h('div.m-card.m-col', dirBtns, cam, h('button.btn.primary.lg', { type: 'button', on: { click: async (e) => {
            if (stop) { stop(); stop = null; cam.replaceChildren(); e.target.textContent = t('ci.camera_on'); return; }
            try { stop = await startScanner(cam, scan); e.target.textContent = t('ci.camera_stop'); } catch { toast(t('ci.camera_error'), 'bad'); }
        } } }, t('ci.camera_on')), res),
        me.permissions.notifications?.includes('create') ? h('div.m-card.m-col', h('b', icon('message'), ' ', t('notif.announce')), msg, h('button.btn', { type: 'button', on: { click: async () => { try { await post('notifications/announce', { event_id: evId, message: msg.value, priority: 'high' }); msg.value = ''; toast(t('notif.announced'), 'ok'); } catch (e) { toast(errText(e), 'bad'); } } } }, icon('send'), t('common.send'))) : null)));
    const ws = connect();
    ws.sub(`event:${evId}`);
    ws.on('attendance', (a) => { if (a.subject.id === evId) drawStats(a.stats); });
}

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
boot();
