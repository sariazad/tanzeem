// تنظيم — واجهة الكشك (بلا تدخل بشري): ترحيب ← اختيار اللغة ← مسح QR الدعوة أو تسجيل فوري ← التحقق ← صورة (اختياري) ← طباعة البطاقة ← نجاح.
// مهلة خمول تعيد الشاشة للبداية، أزرار كبيرة، ومتوافقة مع معايير الوصول. تعمل كـ PWA بملء الشاشة.
import '../core/style.css';
import './kiosk.css';
import { h, icon, clear } from '../core/dom.js';
import { t, setLang, getLang, pick, fmtDate, fmtTime, opt } from '../core/i18n.js';
import { api, setDeviceToken } from '../core/api.js';
import { applyBranding, loadBranding, setTheme } from '../core/theme.js';
import { connect } from '../core/ws.js';
import { startScanner, capturePhoto } from '../core/scanner.js';
import { printSvg } from '../core/printing.js';
import { beep, errText } from '../core/ui.js';

const VERSION = '1.0.0';
const preview = new URLSearchParams(location.search).has('preview');
const root = document.getElementById('root');
const st = { token: preview ? null : localStorage.getItem('tz_device'), info: null, idle: null, stop: null, ws: null };
setTheme('light');

async function boot() {
    if (preview) { st.info = demoInfo(await loadBranding()); return welcome(); }
    if (!st.token) return pairScreen();
    setDeviceToken(st.token);
    try { st.info = await api(`/api/device/me?v=${VERSION}`); }
    catch (e) {
        if (e.status === 401) { localStorage.removeItem('tz_device'); st.token = null; return pairScreen(); }
        return fatal(errText(e), true);
    }
    applyBranding(st.info.branding);
    if (!st.ws) {
        st.ws = connect({ query: `device=${encodeURIComponent(st.token)}` });
        st.ws.on('command', (c) => {
            if (c.cmd === 'reload' || c.cmd === 'restart' || c.cmd === 'update') location.reload();
            if (c.cmd === 'identify') { document.body.animate([{ filter: 'invert(1)' }, { filter: 'none' }], { duration: 400, iterations: 6 }); }
            if (c.cmd === 'unpair') { localStorage.removeItem('tz_device'); location.reload(); }
        });
        st.ws.on('config', (info) => { st.info = info; applyBranding(info.branding); welcome(); });
        setInterval(() => st.ws.send({ type: 'heartbeat', version: VERSION }), 30_000);
    }
    welcome();
}

function demoInfo(branding) {
    return { name: 'Preview', config: { idle_seconds: 60, allow_walkin: true, capture_photo: true, languages: ['ar', 'en'], print_mode: 'browser' }, branding,
        event: { id: 0, title_ar: 'ملتقى التحول الرقمي 2026', title_en: 'Digital Transformation Forum 2026', starts_at: new Date().toISOString(), form: [] } }; // i18n-ok: بيانات
}

/* ───────── الشاشات ───────── */
function screen(...children) {
    stopCam();
    const b = st.info?.branding || {};
    clear(root, h('div.k-shell', { dir: getLang() === 'ar' ? 'rtl' : 'ltr' },
        h('header.k-head', h('div.k-brand', b.logo ? h('img', { src: b.logo, alt: '' }) : icon('layers'), h('span', pick(b, 'name'))), st.info?.event ? h('div.k-event', pick(st.info.event, 'title')) : null),
        h('main.k-main', ...children)));
    armIdle();
}
function armIdle() {
    clearTimeout(st.idle);
    const sec = st.info?.config?.idle_seconds || 45;
    st.idle = setTimeout(() => welcome(), sec * 1000);
}
['pointerdown', 'keydown'].forEach((ev) => document.addEventListener(ev, () => { if (st.idle) armIdle(); }, { passive: true }));
const stopCam = () => { st.stop?.(); st.stop = null; };

function pairScreen() {
    let code = '';
    const disp = h('div.k-code', '— — — — — —');
    const err = h('div.k-err', { role: 'alert' });
    const press = (d) => { if (d === '⌫') code = code.slice(0, -1); else if (code.length < 6) code += d; disp.textContent = code.padEnd(6, '•').split('').join(' '); if (code.length === 6) go(); };
    const go = async () => {
        try {
            const r = await api('/api/device/pair', { method: 'POST', body: { code, version: VERSION } });
            localStorage.setItem('tz_device', r.token);
            st.token = r.token;
            boot();
        } catch (e) { err.textContent = errText(e); code = ''; disp.textContent = '— — — — — —'; beep(false); }
    };
    clear(root, h('div.k-shell', h('main.k-main', h('div.k-card', { style: { maxWidth: '520px' } }, icon('key', 'k-big-ico'), h('h1', t('kiosk_ui.pair_title')), h('p', t('kiosk_ui.pair_sub')), disp, err,
        h('div.k-pad', ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'].map((d) => (d ? h('button.k-key', { type: 'button', 'aria-label': d === '⌫' ? t('common.remove') : d, on: { click: () => press(d) } }, d) : h('span'))))))));
}

function welcome() {
    clearTimeout(st.idle); st.idle = null;
    stopCam();
    const c = st.info.config;
    const ev = st.info.event;
    const b = st.info.branding || {};
    clear(root, h('div.k-shell.k-welcome', { dir: getLang() === 'ar' ? 'rtl' : 'ltr' },
        h('div.k-hero', h('div.k-logo', b.logo ? h('img', { src: b.logo, alt: '' }) : icon('layers')),
            h('h1', (getLang() === 'ar' ? c.welcome_ar : c.welcome_en) || t('kiosk_ui.welcome')),
            ev ? h('div.k-ev', h('b', pick(ev, 'title')), h('div', `${fmtDate(ev.starts_at)} · ${fmtTime(ev.starts_at)}`)) : h('div.k-err', t('kiosk_ui.no_event')),
            h('p', c.exit_mode ? t('kiosk_ui.exit_sub') : t('kiosk_ui.welcome_sub'))),
        h('div.k-langs', (c.languages || ['ar', 'en']).map((l) => h('button.k-btn.k-primary', { type: 'button', disabled: !ev, on: { click: () => { setLang(l, { silent: true }); start(); } } }, l === 'ar' ? 'ابدأ — العربية' : 'Start — English'))),
        h('div.k-foot', pick(b, 'slogan'))));
}

function start() {
    const c = st.info.config;
    if (c.exit_mode) return scanScreen('out');
    if (!c.allow_walkin) return scanScreen('in');
    screen(h('div.k-card', h('h1', t('kiosk_ui.how')), h('div.k-choices',
        h('button.k-choice', { type: 'button', on: { click: () => scanScreen('in') } }, icon('qr', 'k-big-ico'), h('b', t('kiosk_ui.have_qr')), h('span', t('kiosk_ui.have_qr_sub'))),
        h('button.k-choice', { type: 'button', on: { click: registerScreen } }, icon('user-check', 'k-big-ico'), h('b', t('kiosk_ui.register')), h('span', t('kiosk_ui.register_sub')))),
    h('button.k-btn.k-ghost', { type: 'button', on: { click: welcome } }, t('common.back'))));
}

function scanScreen(direction) {
    const cam = h('div.k-cam');
    const input = h('input.k-hidden-input', { 'aria-label': t('kiosk_ui.scan_title'), autocomplete: 'off', on: { keydown: (e) => { if (e.key === 'Enter' && e.target.value.trim()) { const v = e.target.value.trim(); e.target.value = ''; handle(v); } } } });
    screen(h('div.k-card', h('h1', direction === 'out' ? t('kiosk_ui.scan_exit') : t('kiosk_ui.scan_title')), h('p', t('kiosk_ui.scan_sub')), cam, input,
        h('button.k-btn.k-ghost', { type: 'button', on: { click: welcome } }, t('common.cancel'))));
    input.focus();
    let done = false;
    const handle = async (raw) => {
        if (done) return;
        done = true;
        const m = raw.match(/\/m\/p\/(TZ1\.[^/?#\s]+)/);
        const token = m ? decodeURIComponent(m[1]) : raw;
        await verify({ token, direction });
    };
    startScanner(cam, handle, { facing: 'user' }).then((s) => { st.stop = s; }).catch(() => { cam.replaceChildren(h('div.k-muted', icon('scan'), ' ', t('kiosk_ui.use_scanner'))); });
}

async function verify(body) {
    screen(h('div.k-card', h('div.spinner', { style: { width: '56px', height: '56px', borderWidth: '5px' } }), h('h2', t('kiosk_ui.verifying'))));
    if (preview) return success({ visitor: { id: 0, name_ar: 'عبدالله بن محمد', name_en: 'Abdullah Mohammed', org_name: 'جامعة الملك سعود', has_photo: false }, direction: body.direction || 'in' }, null); // i18n-ok: بيانات
    try {
        const r = await api('attendance/scan', { method: 'POST', body: { ...body, method: 'kiosk' } });
        if (!r.ok) return failure(r.code);
        beep(true);
        if (r.direction === 'out') return success(r, null);
        if (st.info.config.capture_photo && !r.visitor.has_photo) return photoScreen(r);
        return printBadge(r);
    } catch (e) { failure(e.code || 'network', errText(e)); }
}

function photoScreen(r) {
    const box = h('div.k-cam');
    let cap = null;
    screen(h('div.k-card', h('h1', t('kiosk_ui.photo_title')), h('p', t('kiosk_ui.photo_sub')), box,
        h('div.k-row', h('button.k-btn.k-ghost', { type: 'button', on: { click: () => { cap?.stop(); printBadge(r); } } }, t('kiosk_ui.skip')),
            h('button.k-btn.k-primary', { type: 'button', on: { click: async () => {
                if (!cap) return;
                const photo = cap.snap();
                cap.stop();
                try { await api('attendance/photo', { method: 'POST', body: { visitor_id: r.visitor.id, subject_id: r.subject.id, photo } }); } catch { /* نكمل بلا صورة */ }
                printBadge(r);
            } } }, icon('camera'), t('kiosk_ui.take_photo')))));
    capturePhoto(box).then((c) => { cap = c; st.stop = () => c.stop(); }).catch(() => printBadge(r));
}

async function printBadge(r) {
    const mode = st.info.config.print_mode || 'auto';
    if (mode === 'none') return success(r, null);
    screen(h('div.k-card', icon('printer', 'k-big-ico'), h('h2', t('kiosk_ui.printing'))));
    try {
        const p = await api('print', { method: 'POST', body: { visitor_id: r.visitor.id, subject_id: r.subject.id, subject_type: r.subject.type, lang: getLang() } });
        if (p.via === 'browser' && mode !== 'agent') {
            await printSvg(p.svg, p.width_mm, p.height_mm);
            api(`print/${p.job_id}/result`, { method: 'POST', body: { ok: true } }).catch(() => {});
        }
        success(r, p);
    } catch (e) { success(r, null, errText(e)); }
}

function success(r, p, printErr) {
    beep(true);
    const v = r.visitor;
    screen(h('div.k-card.k-ok', h('div.k-check', icon(r.direction === 'out' ? 'log-out' : 'check')),
        h('h1', r.direction === 'out' ? t('kiosk_ui.bye', { name: pick(v, 'name').split(' ')[0] }) : t('kiosk_ui.welcome_name', { name: pick(v, 'name').split(' ')[0] })),
        h('p', r.direction === 'out' ? t('kiosk_ui.bye_sub') : printErr ? t('kiosk_ui.print_failed') : p ? t('kiosk_ui.take_badge') : t('kiosk_ui.entry_ok')),
        p?.svg ? h('div.k-badge', { html: p.svg.replace(/width="[\d.]+mm" height="[\d.]+mm"/, 'width="100%"') }) : null,
        h('button.k-btn.k-primary', { type: 'button', on: { click: welcome } }, t('kiosk_ui.done'))));
    clearTimeout(st.idle);
    st.idle = setTimeout(welcome, 9000);
}

function failure(code, msg) {
    beep(false);
    screen(h('div.k-card.k-bad', h('div.k-check', icon('x')), h('h1', t(`scan.${code}`) === `scan.${code}` ? msg || t('errors.generic') : t(`scan.${code}`)), h('p', t('kiosk_ui.see_reception')),
        h('div.k-row', h('button.k-btn.k-ghost', { type: 'button', on: { click: welcome } }, t('kiosk_ui.home')), h('button.k-btn.k-primary', { type: 'button', on: { click: () => scanScreen('in') } }, t('common.retry')))));
}

function registerScreen() {
    const ev = st.info.event;
    const vals = {};
    const errs = h('div.k-err', { role: 'alert' });
    const base = [['name_ar', 'text', true], ['name_en', 'text', false], ['phone', 'tel', true], ['email', 'email', false], ['org_name', 'text', false]];
    const field = (key, type, req, label) => h('label.k-field', h('span', label || t(`f.${key}`), req ? ' *' : ''), h('input', { type, required: req, dir: ['tel', 'email'].includes(type) || key === 'name_en' ? 'ltr' : null, autocomplete: 'off', on: { input: (e) => { vals[key] = e.target.value; } } }));
    const answers = {};
    const dyn = (ev.form || []).filter((f) => f.type !== 'photo').map((f) => {
        const L = getLang();
        const label = f[`label_${L}`] || f.key;
        if (['select', 'radio'].includes(f.type)) return h('label.k-field', h('span', label, f.required ? ' *' : ''), h('select', { on: { change: (e) => { answers[f.key] = e.target.value; } } }, h('option', { value: '' }, '—'), (f.options || []).map((o) => h('option', { value: o.value }, o[`label_${L}`]))));
        if (f.type === 'checkbox') return h('label.k-check', h('input', { type: 'checkbox', on: { change: (e) => { answers[f.key] = e.target.checked; } } }), h('span', label, f.required ? ' *' : ''));
        if (f.type === 'multi') return h('div.k-field', h('span', label), h('div.k-row', { style: { flexWrap: 'wrap' } }, (f.options || []).map((o) => h('label.k-check', h('input', { type: 'checkbox', on: { change: (e) => { const set = new Set(answers[f.key] || []); if (e.target.checked) set.add(o.value); else set.delete(o.value); answers[f.key] = [...set]; } } }), o[`label_${L}`]))));
        return h('label.k-field', h('span', label, f.required ? ' *' : ''), h('input', { type: { number: 'number', email: 'email', phone: 'tel', date: 'date' }[f.type] || 'text', on: { input: (e) => { answers[f.key] = e.target.value; } } }));
    });
    screen(h('form.k-card.k-form', { on: { submit: async (e) => {
        e.preventDefault();
        if (preview) return success({ visitor: { name_ar: vals.name_ar || opt('category', 'guest'), name_en: vals.name_en }, direction: 'in' }, null);
        try {
            const r = await api(`events/${ev.id}/register`, { method: 'POST', body: { ...vals, answers } });
            verify({ token: r.token, direction: 'in' });
        } catch (er) { errs.textContent = er.errors?.length ? er.errors.map((x) => `${t(`f.${x.field}`) === `f.${x.field}` ? x.field : t(`f.${x.field}`)}: ${t(`errors.${x.code}`)}`).join(' — ') : errText(er); beep(false); }
    } } }, h('h1', t('kiosk_ui.register')), h('div.k-fields', base.map(([k, ty, rq]) => field(k, ty, rq)), dyn), errs,
    h('div.k-row', h('button.k-btn.k-ghost', { type: 'button', on: { click: welcome } }, t('common.cancel')), h('button.k-btn.k-primary', { type: 'submit' }, t('kiosk_ui.continue')))));
}

function fatal(msg, retry) {
    clear(root, h('div.k-shell', h('main.k-main', h('div.k-card.k-bad', icon('wifi-off', 'k-big-ico'), h('h1', t('kiosk_ui.offline')), h('p', msg), retry ? h('button.k-btn.k-primary', { type: 'button', on: { click: () => location.reload() } }, t('common.retry')) : null))));
    setTimeout(() => location.reload(), 20_000);
}

if ('serviceWorker' in navigator && !preview) navigator.serviceWorker.register('/sw.js').catch(() => {});
boot();
